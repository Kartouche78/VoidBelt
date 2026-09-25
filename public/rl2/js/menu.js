// Menus : accueil, parametres, pause et ecran de fin.
//
// Les panneaux vivent deja dans le HTML ; ce module ne fait que les montrer,
// les remplir et propager les reglages modifies.

import { DEFAULTS, reset } from './settings.js';
import { PANNEAU } from './settings-panel.js';
import { listRooms } from './net.js';
import { GROUPES, renderPicker, stadiumById } from './stadiums.js';
import { CATEGORIES, renderGarage } from './garage.js';
import { gardeMulti } from './multi-connexion.js';
import { brancherModes } from './modes.js';

const $ = (id) => document.getElementById(id);

/** Voisin le plus proche d'un element dans une direction, mesure a
 *  l'ecran. Ce qui est trop de biais ne compte pas : sinon, en bout de
 *  ligne, « a droite » sauterait a la ligne suivante. */
function voisin(depuis, candidats, dx, dy) {
  const a = depuis.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let meilleur = null;
  let score = Infinity;
  for (const el of candidats) {
    if (el === depuis) continue;
    const b = el.getBoundingClientRect();
    const vers = (b.left + b.width / 2 - ax) * dx + (b.top + b.height / 2 - ay) * dy;
    if (vers <= 1) continue;
    const biais = Math.abs((b.left + b.width / 2 - ax) * dy - (b.top + b.height / 2 - ay) * dx);
    if (biais > vers + 8) continue;
    const note = vers + biais * 2;
    if (note < score) {
      score = note;
      meilleur = el;
    }
  }
  return meilleur;
}

/** Ecrans et grilles qui se parcourent en deux dimensions, d'apres la
 *  position a l'ecran : la partie privee pose ses reglages en colonnes. */
const GRILLES = '#stadium-list, #garage-list, #modes-grille, #screen-prive';

const PHASE_FR = {
  warmup: 'echauffement',
  countdown: 'engagement',
  play: 'en match',
  goal: 'but',
  over: 'termine',
};

export class Menu {
  /** `hooks` : play, resume, restart, quit, change(settings). */
  constructor(settings, input, hooks) {
    this.settings = settings;
    this.input = input;
    this.hooks = hooks;
    this.screen = null;
    this.tab = 'controls';

    this.screens = {
      title: $('screen-title'),
      settings: $('screen-settings'),
      pause: $('screen-pause'),
      result: $('screen-result'),
      modes: $('screen-modes'),
      prive: $('screen-prive'),
      online: $('screen-online'),
      stadium: $('screen-stadium'),
      garage: $('screen-garage'),
    };

    this.cursor = null;
    for (const el of Object.values(this.screens)) {
      el.addEventListener('pointermove', (e) => this._followMouse(e));
    }
    this._wire();
    this.show('title');
  }

  get open() {
    return this.screen !== null;
  }

  show(name) {
    this.input.cancelListen();
    // Les parametres sont un calque : ouverts depuis l'accueil, ils se
    // posent dessus au lieu de le remplacer, et la photo reste derriere.
    // Ouverts depuis la pause, c'est la partie qui sert de fond et il n'y
    // a rien d'autre a garder affiche.
    const fond = name === 'settings' && this.from === 'title' ? 'title' : null;
    for (const [key, el] of Object.entries(this.screens)) {
      el.hidden = key !== name && key !== fond;
    }
    $('shell').classList.toggle('menu-open', name !== null);
    this.screen = name;
    if (name === 'settings') this.renderSettings();
    // Le premier element prend le focus : manette et clavier parcourent le
    // menu sans souris des l'ouverture.
    if (name) this._focus(this.items()[0]);
  }

  /** Elements atteignables au clavier ou a la manette, dans l'ordre du DOM. */
  items() {
    if (!this.screen) return [];
    const sel = 'button:not([disabled]), input:not([disabled])';
    // Un element masque (ligne cachee, champ fichier) ne se vise pas.
    return [...this.screens[this.screen].querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0);
  }

  /** Le curseur est a nous, pas au navigateur. `document.activeElement`
   *  bouge a chaque clic, sort des elements qu'on redessine et retombe sur
   *  le corps de page : s'y fier, c'est perdre le repere des qu'on touche
   *  la souris. On garde donc l'element vise et on repeint nous-memes. */
  _focus(el) {
    if (!el) return;
    for (const e of document.querySelectorAll('.pad-focus')) e.classList.remove('pad-focus');
    this.cursor = el;
    el.classList.add('pad-focus');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }

  /** Deplacement dans la grille des stades, d'apres la position a l'ecran
   *  et non l'ordre du document. Renvoie `false` si rien ne se trouve dans
   *  cette direction : on sort alors vers les onglets ou le pied de page,
   *  pour que l'ecran entier reste accessible. */
  _grille(cur, dx, dy) {
    const grille = cur.closest(GRILLES);
    const cases = [...grille.querySelectorAll('button:not([disabled]), input:not([disabled])')];
    const cible = voisin(cur, cases, dx, dy);
    if (cible) {
      this._focus(cible);
      return true;
    }
    if (dy < 0) {
      const onglet = this.screens[this.screen].querySelector('.tabs button.active');
      if (onglet) {
        this._focus(onglet);
        return true;
      }
    }
    if (dy > 0) {
      const pied = this.screens[this.screen].querySelector('.sheet-menu button');
      if (pied) {
        this._focus(pied);
        return true;
      }
    }
    return false;
  }

  /** Element vise, ou le premier de l'ecran s'il a disparu entre-temps. */
  _here(items) {
    if (this.cursor && items.includes(this.cursor)) return this.cursor;
    return null;
  }

  /** Rangee horizontale a laquelle appartient un element, s'il y en a une :
   *  onglets, choix, commandes d'une ligne de reglage, boutons de pied de
   *  panneau. Gauche et droite y circulent, haut et bas en sortent. */
  _lane(el) {
    // `.stack` est une pile, pas une rangee : ses entrees se parcourent en
    // haut et en bas. La traiter comme une rangee faisait sauter la
    // navigation d'un bout a l'autre de la liste pour revenir au depart,
    // et le menu de pause ne repondait plus a la manette.
    return el?.closest('.tabs, .choice, .row-control, .row-actions, .sheet-menu:not(.stack)') ?? null;
  }

  /** Navigation a la manette. `pulse` vient de `Input.menuPulse`. */
  navigate(pulse) {
    if (!pulse || !this.screen) return;
    const items = this.items();
    if (!items.length) return;

    // Onglets a la gachette : LB et RB, comme dans Rocket League.
    if (pulse.tab) {
      this._shiftTab(pulse.tab);
      return;
    }

    const cur = this._here(items);
    const here = cur ? items.indexOf(cur) : -1;
    const lane = this._lane(cur);

    // Une grille ne se parcourt pas comme une liste : la case du dessous
    // n'est pas la suivante dans l'ordre du document, elle est une ligne
    // plus bas. Les quatre directions y servent donc vraiment.
    if (cur?.closest(GRILLES) && (pulse.x || pulse.y)) {
      if (this._grille(cur, pulse.x, pulse.y)) return;
    }

    if (pulse.x) {
      // Sur un curseur, gauche et droite reglent la valeur plutot que de
      // changer d'element : c'est le geste attendu.
      if (cur && cur.type === 'range') {
        const span = Number(cur.max) - Number(cur.min);
        const next = Number(cur.value) + pulse.x * Math.max(1, Math.round(span / 20));
        cur.value = String(Math.min(Number(cur.max), Math.max(Number(cur.min), next)));
        cur.dispatchEvent(new Event('input'));
        return;
      }
      if (lane) {
        const line = items.filter((it) => this._lane(it) === lane);
        const k = line.indexOf(cur);
        this._focus(line[(k + pulse.x + line.length) % line.length]);
        return;
      }
    }

    const step = pulse.y || (lane ? 0 : pulse.x);
    if (step) {
      let i = here < 0 ? (step > 0 ? -1 : 0) : here;
      // On saute le reste de la rangee : haut et bas changent de reglage.
      do {
        i = (i + step + items.length) % items.length;
      } while (lane && this._lane(items[i]) === lane && i !== here);
      this._focus(items[i]);
      return;
    }
    if (pulse.ok && cur && cur.tagName === 'BUTTON') {
      cur.click();
      return;
    }
    if (pulse.back) this.back();
  }

  /** Passe a l'onglet suivant ou precedent, si l'ecran en a. */
  _shiftTab(dir) {
    if (this.screen === 'garage') {
      const ids = CATEGORIES.map(([id]) => id);
      const i = ids.indexOf(this.cat);
      this.cat = ids[((i < 0 ? 0 : i) + dir + ids.length) % ids.length];
      this._garage();
      return;
    }
    if (this.screen === 'stadium') {
      const ids = GROUPES.map(([id]) => id);
      const i = ids.indexOf(this.lot);
      this._pickLot(ids[((i < 0 ? 0 : i) + dir + ids.length) % ids.length]);
      return;
    }
    const tabs = [...(this.screens[this.screen]?.querySelectorAll('[data-tab]') ?? [])];
    if (tabs.length < 2) return;
    const i = tabs.findIndex((b) => b.dataset.tab === this.tab);
    const next = tabs[((i < 0 ? 0 : i) + dir + tabs.length) % tabs.length];
    this.tab = next.dataset.tab;
    this.renderSettings();
    // Le panneau vient d'etre reconstruit : le curseur visait un element
    // qui n'existe plus, on le repose sur l'onglet qu'on vient de choisir.
    this._focus([...this.screens[this.screen].querySelectorAll('[data-tab]')]
      .find((b) => b.dataset.tab === this.tab));
  }

  /** Retour arriere de l'ecran courant, pour le bouton B de la manette. */
  back() {
    const exits = {
      settings: 'btn-settings-back',
      stadium: 'btn-stadium-back',
      garage: 'btn-garage-back',
      modes: 'btn-modes-back',
      prive: 'btn-prive-back',
      online: 'btn-online-back',
      pause: 'btn-resume',
      result: 'btn-result-menu',
    };
    $(exits[this.screen] || '')?.click();
  }

  /** La souris survole un element : le curseur manette le suit, pour que
   *  les deux ne se contredisent jamais a l'ecran. */
  _followMouse(e) {
    const el = e.target.closest?.('button, input');
    if (el && this.screen && this.screens[this.screen].contains(el)) this._focus(el);
  }

  hide() {
    this.cursor = null;
    for (const e of document.querySelectorAll('.pad-focus')) e.classList.remove('pad-focus');
    for (const el of Object.values(this.screens)) el.hidden = true;
    $('shell').classList.remove('menu-open');
    this.screen = null;
  }

  _wire() {
    $('btn-stadium-back').onclick = () => {
      // Depuis un salon on revient au jeu, pas a l'accueil.
      if (this.pourQui === 'salon') return this.hide();
      return this.show('title');
    };
    $('btn-settings').onclick = () => {
      this.from = 'title';
      this.show('settings');
    };
    $('btn-settings-back').onclick = () => this.show(this.from || 'title');
    $('btn-settings-reset').onclick = () => {
      Object.assign(this.settings, reset());
      this.hooks.change(this.settings);
      this.renderSettings();
    };

    $('btn-quit-site').onclick = () => {
      window.location.href = '/';
    };
    $('btn-online').onclick = () => this.show('modes');
    brancherModes(this);
    $('btn-garage').onclick = () => {
      this.cat = 'voiture';
      this.show('garage');
      this._garage();
    };
    $('btn-garage-back').onclick = () => this.show('title');
    $('btn-online-create').onclick = () => this.hooks.host('');
    $('btn-online-refresh').onclick = () => this.refreshRooms();
    $('btn-online-back').onclick = () => this.show('modes');

    $('btn-resume').onclick = () => this.hooks.resume();
    $('btn-pause-settings').onclick = () => {
      this.from = 'pause';
      this.show('settings');
    };
    $('btn-pause-restart').onclick = () => this.hooks.restart();
    $('btn-pause-quit').onclick = () => this.hooks.quit();
    $('btn-result-again').onclick = () => this.hooks.restart();
    $('btn-result-menu').onclick = () => this.hooks.quit();

    for (const b of document.querySelectorAll('[data-tab]')) {
      b.onclick = () => {
        this.tab = b.dataset.tab;
        this.renderSettings();
      };
    }
  }

  /** Grille des stades. En solo, un clic choisit et lance dans la foulee ;
   *  en ligne, il pose le stade du salon et referme. */
  showStadiums(pour = 'solo') {
    this.pourQui = pour;
    // On s'ouvre sur l'onglet du stade en cours : le retrouver sous les
    // yeux vaut mieux que de le chercher.
    this.lot = stadiumById(this.settings.stadium).groupe ?? GROUPES[0][0];
    this._stadiums();
    this.show('stadium');
    // On entre sur un stade, pas sur un onglet : c'est ce qu'on vient
    // choisir, et les gachettes suffisent a changer de lot.
    this._focusStade();
  }

  /** Repeint le selecteur de stade, onglets compris. */
  _stadiums() {
    renderPicker(
      $('stadium-tabs'),
      $('stadium-list'),
      this.lot,
      this.settings.stadium,
      (id) => this._pickLot(id),
      (s) => {
        if (this.pourQui === 'salon') {
          this.hooks.roomStadium(s);
          this.hide();
          return;
        }
        this.settings.stadium = s.id;
        this.hooks.change(this.settings);
        this.hooks.play();
      },
    );
  }

  /** Repeint la personnalisation ; choisir une voiture l'equipe aussitot,
   *  sans quitter l'ecran, pour comparer d'un coup d'oeil. */
  _garage() {
    renderGarage(
      $('garage-tabs'),
      $('garage-list'),
      $('garage-vue'),
      this.cat,
      this.settings.skin || '',
      (id) => {
        this.cat = id;
        this._garage();
      },
      (id) => {
        this.settings.skin = id;
        this.hooks.change(this.settings);
        this._garage();
      },
    );
    // La grille vient d'etre refaite : le curseur retombe sur ce qui est
    // equipe, ou sur l'onglet si l'onglet est encore vide.
    const box = $('garage-list');
    this._focus(box.querySelector('button.active') ?? box.querySelector('button')
      ?? $('garage-tabs').querySelector('button.active'));
  }

  /** Vise le stade en cours dans la grille, ou le premier a defaut. */
  _focusStade() {
    const box = $('stadium-list');
    this._focus(box.querySelector('button.active') ?? box.querySelector('button'));
  }

  /** Change de lot. La grille vient d'etre refaite, donc ce que le curseur
   *  visait n'existe plus : on le repose sur le premier stade du lot. */
  _pickLot(id) {
    this.lot = id;
    this._stadiums();
    this._focusStade();
  }

  /** Pseudo saisi, conserve avec les autres reglages. */
  playerName() {
    const v = $('online-name').value.trim();
    if (v !== this.settings.name) {
      this.settings.name = v;
      this.hooks.change(this.settings);
    }
    return v;
  }

  status(text) {
    $('online-status').textContent = text || '';
  }

  async showOnline() {
    $('online-name').value = this.settings.name || '';
    this.show('online');
    // En ligne, il faut un compte : sans lui, la porte de connexion prend
    // la place des salons.
    const libre = await gardeMulti();
    this._focus(this.items()[0]);
    if (libre) await this.refreshRooms();
  }

  /** Recharge la liste des salons ouverts. */
  async refreshRooms() {
    const box = $('online-list');
    this.status('Recherche des serveurs…');
    let rooms;
    try {
      rooms = await listRooms();
    } catch (err) {
      box.innerHTML = '';
      this.status(`Serveur injoignable : ${err.message}`);
      return;
    }
    box.innerHTML = '';
    if (!rooms.length) {
      this.status('Aucun serveur ouvert pour l’instant. Crée le tien.');
      return;
    }
    this.status('');
    // Les salons ou l'on peut entrer passent devant : c'est ce qu'on vient
    // chercher, les parties pleines ne sont la que pour information.
    // Plus de salon complet : aucun effectif n'est plafonne. Les parties
    // en cours passent derriere celles qui attendent encore au salon.
    rooms.sort((a, b) => (a.phase !== 'warmup') - (b.phase !== 'warmup'));
    for (const r of rooms) box.append(this._roomRow(r));
  }

  _roomRow(room) {
    const el = document.createElement('div');
    const started = room.phase !== 'warmup';
    el.className = started ? 'salon full' : 'salon';
    const left = document.createElement('div');
    const code = document.createElement('b');
    code.textContent = room.code;
    const who = document.createElement('small');
    const names = room.players.map((p) => p.name).join(', ') || 'vide';
    const n = room.players.length;
    who.textContent = `${n} joueur${n > 1 ? 's' : ''} · ${names} · ${PHASE_FR[room.phase] || room.phase}`;
    left.append(code, who);
    const go = document.createElement('button');
    // On rejoint meme une partie lancee : on attend au bord jusqu'au
    // prochain retour au salon.
    go.textContent = started ? 'En cours' : 'Rejoindre';
    go.disabled = false;
    go.onclick = () => this.hooks.join(room.code);
    el.append(left, go);
    return el;
  }

  /** Affiche l'ecran de fin avec le score final. */
  result(blue, orange) {
    const win = blue > orange;
    $('result-title').textContent = blue === orange ? 'Match nul' : win ? 'Victoire' : 'Defaite';
    $('result-score').textContent = `${blue} - ${orange}`;
    $('result-title').className = blue === orange ? '' : win ? 'blue' : 'orange';
    this.show('result');
  }

}

// Le panneau des reglages vit dans son module, mais reste greffe ici : il
// lit `settings`, `input` et `hooks` sur le menu comme avant.
Object.assign(Menu.prototype, PANNEAU);

export { DEFAULTS };
