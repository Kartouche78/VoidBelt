// Point d'entree : assemble le moteur Rust, le rendu et les menus.

import { loadEngine, readCar, readEvents, carsIn, EV, PHASE, STATE } from './wasm.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { Scores } from './scores.js';
import { Menu } from './menu.js';
import { load as loadSettings, save as saveSettings } from './settings.js';
import { API_HTTP, Net } from './net.js';
import { loadCreated, stadiumById } from './stadiums.js';
import { loadSkins } from './skins.js';
import { Debug } from './debug.js';
import { FitEdit } from './fitedit.js';
import { CageEdit } from './cageedit.js';
import { Chat } from './chat.js';
import { Panneau } from './panneau/panneau.js';

const SOLO_SEAT = 0;

/** Charge les reglages publies, s'il y en a. Le serveur fait autorite ;
 *  a defaut on tente le fichier statique, pour que le site sans API tourne
 *  quand meme sur les memes valeurs. Toute erreur laisse les valeurs
 *  d'usine : mieux vaut un jeu d'origine qu'un jeu qui ne demarre pas. */
async function applyPublishedTune(engine) {
  for (const [url, pick] of [
    ['/api/rl2/tune', (d) => d.values],
    ['assets/tune.json', (d) => d],
  ]) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const values = pick(await res.json());
      if (values && typeof values === 'object') {
        engine.setTune(values);
        return;
      }
    } catch {
      // Injoignable ou illisible : on essaie la source suivante.
    }
  }
}

async function boot() {
  const settings = loadSettings();
  const engine = await loadEngine('assets/rl2.wasm');
  engine.start(seed(), settings.match.level, settings.match.duration);
  // Reglages publies depuis /admin. Ils doivent etre pris avant de lire la
  // geometrie : la taille des voitures et de la balle en depend, et le
  // rendu se construit dessus.
  await applyPublishedTune(engine);

  // Arenes creees dans l'admin, et `?stade=…&jouer` pour en essayer une
  // directement depuis son apercu, sans toucher au stade enregistre.
  // Meme chose pour les skins de voitures : `?skin=…` en essaie un.
  await Promise.all([loadCreated(API_HTTP), loadSkins(API_HTTP)]);
  const demande = new URLSearchParams(location.search);
  if (demande.get('stade')) settings.stadium = demande.get('stade');
  if (demande.has('skin')) settings.skin = demande.get('skin');

  let geom = engine.geometry();
  const padTable = engine.pads();
  const view = new Renderer(document.getElementById('scene'), geom);
  view.setPads(padTable);
  view.setMode(settings.camera);

  /** Relit la geometrie apres un changement de reglage et la propage a tout
   *  ce qui se dessine dessus. */
  function refreshGeometry() {
    geom = engine.geometry();
    view.setGeometry(geom);
    hud.setGeometry?.(geom);
    debug?.setGeometry(geom);
  }

  // Cage de base, celle des reglages publies : un stade qui ne declare pas
  // la sienne y revient, au lieu d'heriter de celle du stade precedent.
  const base = engine.tune();
  const cageBase = { half: base.goal_half, depth: base.goal_depth, post: base.post_r };
  const cageOf = (s) => s.goal ?? cageBase;

  /** Pose un stade : son decor, et ses reglages de collision, l'arrondi
   *  de ses coins et la forme de ses cages. */
  function applyStadium(id, editing = false) {
    const s = stadiumById(id);
    const c = cageOf(s);
    engine.setTune({ arena_corner: s.corner, goal_half: c.half, goal_depth: c.depth, post_r: c.post });
    view.setStadium(s, editing);
    refreshGeometry();
    // En calage, le contour n'est plus l'enceinte : c'est le rectangle
    // qu'on promene sur la planche.
    debug?.setFrame(editing ? fit.frame(geom) : null);
    return s;
  }
  // Le stade retenu s'affiche des l'accueil : l'arene tourne en fond
  // derriere le menu, autant que ce soit celle qu'on va jouer.

  const audio = new Audio(settings.audio);
  audio.preload();
  const hud = new Hud(geom);
  const scores = new Scores(document.getElementById('scores'));
  const input = new Input(settings);
  // Calques F1 / F2 / F3. Ils vivent dans la scene du rendu, mais pilotent
  // le moteur pour F3, qui divise les vitesses : c'est ici qu'ils sont
  // branches aux deux.
  const debug = new Debug(view.scene, geom, engine, refreshGeometry);
  const fit = new FitEdit(applyStadium);
  const cages = new CageEdit(cageOf, (id) => applyStadium(id));
  // En ligne, le message passe par le serveur et revient a tout le monde ;
  // en solo il n'y a personne a prevenir, on l'affiche directement.
  const chat = new Chat((groupe, choix) => {
    if (app.mode !== 'online' || !net.connected) return false;
    net.chat(groupe, choix);
    return true;
  }, (siege, texte, son) => {
    view.names.say(siege, texte);
    audio.quickchat(son);
  }, (s) => hud.flash(`Tchat : patiente ${s} s`));
  applyStadium(settings.stadium);

  const app = {
    /** `solo` : le moteur local simule. `online` : le serveur simule et on
     *  ne fait qu'envoyer nos commandes et afficher ce qu'il renvoie. */
    mode: 'solo',
    running: false,
    paused: false,
    finished: false,
    last: performance.now(),
    /// Etat de demolition a l'image precedente, pour entendre la reprise.
    demoAvant: 0,
  };

  const net = new Net(geom.padCount);

  /** Composition a afficher : un `{ name, team }` par siege. En ligne elle
   *  vient du salon, en solo c'est le joueur contre la machine. Un siege
   *  libere en plein match garde sa voiture mais perd son pseudo. */
  function roster() {
    if (app.mode !== 'online' || !net.room) {
      return [
        { name: settings.name || 'Vous', team: 0, skin: settings.skin },
        { name: 'Bot', team: 1 },
      ];
    }
    const seats = Math.max(net.cars, ...net.room.players.map((p) => p.slot + 1), 1);
    const out = Array.from({ length: seats }, (_, i) => ({ name: '', team: i % 2 }));
    for (const p of net.room.players) out[p.slot] = { name: p.name, team: p.team & 1, skin: p.skin };
    return out;
  }

  const menu = new Menu(settings, input, {
    play: () => startMatch(),
    // Onglet Son : le clic vaut geste, le contexte audio peut s'ouvrir.
    ecouter: (id) => {
      audio.unlock();
      audio.applyLevels(settings.audio);
      audio.preview(id);
    },
    host: () => joinOnline(''),
    join: (code) => joinOnline(code),
    resume: () => {
      app.paused = false;
      menu.hide();
    },
    restart: () => (app.mode === 'online' ? net.start() : startMatch()),
    quit: () => {
      if (app.mode === 'online') return leaveOnline(null, 'title');
      app.running = false;
      app.paused = false;
      app.finished = false;
      audio.stopAll();
      return menu.show('title');
    },
    roomStadium: (s) => net.setStadium(s.id, s.corner, cageOf(stadiumById(s.id))),
    change: (s) => {
      saveSettings(s);
      audio.applyLevels(s.audio);
      view.setMode(s.camera);
    },
  });

  net.onRoom = () => {
    // Le stade du salon fait foi en ligne : on ne pose que le decor, la
    // physique des coins etant appliquee par le serveur qui simule.
    const voulu = net.room?.stadium;
    if (voulu && voulu !== app.stadium) {
      app.stadium = voulu;
      view.setStadium(stadiumById(voulu));
    }
    // Le bouton se repeint a chaque fois : l'hote peut changer en cours de
    // route, et c'est lui seul qui a la main dessus.
    if (voulu) showRoomStadium(voulu);
    const compo = roster();
    view.setRoster(compo);
    scores.setRoster(compo);
    showTeams(net.room, net.you);
    if (menu.screen === 'online') menu.refreshRooms();
  };
  // Le siege vient du serveur ; un serveur plus ancien ne donne que le
  // pseudo, qu'on retrouve alors dans le salon.
  net.onChat = (m) => {
    const siege = m.slot ?? net.room?.players.find((p) => p.name === m.from)?.slot ?? -1;
    chat.recu(siege, m.g, m.m);
  };
  net.onClose = () => {
    if (app.mode === 'online') leaveOnline('Connexion au salon perdue.');
  };

  /** Quitte le salon et remonte au menu multijoueur. */
  function leaveOnline(message, screen = 'online') {
    net.close();
    app.mode = 'solo';
    app.running = false;
    app.paused = false;
    app.finished = false;
    audio.stopAll();
    menu.show(screen);
    if (message) menu.status(message);
  }

  /** `code` vide cree un salon ; sinon on rejoint celui-la. */
  async function joinOnline(code) {
    menu.status(code ? `Connexion au salon ${code}…` : 'Creation du salon…');
    try {
      await net.connect(code, menu.playerName(), settings.skin);
    } catch (err) {
      menu.status(err.message);
      return;
    }
    audio.unlock();
    audio.applyLevels(settings.audio);
    audio.stopAll();
    chat.clear();
    view.names.hush();
    app.mode = 'online';
    app.stadium = null;
    app.running = true;
    app.paused = false;
    app.finished = false;
    app.last = performance.now();
    menu.hide();
  }

  // Apercu dans /admin : la page parente pousse ses curseurs, on les
  // applique a chaud. On ne repond qu'a une fenetre qui nous encadre.
  if (window.parent !== window) {
    addEventListener('message', (e) => {
      if (e.source !== window.parent || e.data?.t !== 'rl2-tune') return;
      const applied = engine.setTune(e.data.values);
      geom = engine.geometry();
      view.setGeometry(geom);
      // On accuse reception : l'interface sait ainsi que l'apercu est a jour,
      // et non qu'elle parle dans le vide.
      parent.postMessage({ t: 'rl2-tuned', tune: applied }, '*');
    });
    parent.postMessage({ t: 'rl2-ready' }, '*');
  }

  const kickoff = document.getElementById('btn-kickoff');
  kickoff.onclick = () => net.start();

  const pickStade = document.getElementById('btn-stadium-pick');
  pickStade.onclick = () => menu.showStadiums('salon');

  /** Montre le stade en cours sur le bouton du salon. Seul l'hote peut en
   *  changer : pour les autres, c'est un simple rappel. */
  function showRoomStadium(id) {
    const s = stadiumById(id);
    pickStade.textContent = s.name;
    pickStade.disabled = !net.isHost;
  }

  const teamBtn = [document.getElementById('btn-team-0'), document.getElementById('btn-team-1')];
  const teamSplit = document.getElementById('team-split');
  teamBtn.forEach((b, t) => {
    b.onclick = () => net.setTeam(t);
  });

  /** Reflete la composition du salon sur le selecteur de camp. */
  function showTeams(room, you) {
    if (!room) return;
    const mine = room.players.find((p) => p.id === you)?.team ?? 0;
    const n = [0, 0];
    for (const p of room.players) n[p.team & 1] += 1;
    teamSplit.textContent = `${n[0]} v ${n[1]}`;
    teamBtn.forEach((b, t) => b.classList.toggle('mine', t === mine));
  }

  /** Menu ouvert : la manette le parcourt. Sinon, dans le salon en ligne,
   *  le bouton de validation lance la partie sans passer par la souris. */
  function padMenu() {
    // Confort de navigation : si quoi que ce soit y echoue, on le signale
    // et on continue de jouer. Une image perdue ici noircirait l'ecran,
    // puisque le rendu vient apres.
    try {
      const nav = input.menuPulse();
      if (panneau.ouvert) return panneau.navigate(nav);
      if (menu.screen) return menu.navigate(nav);
      const waiting = !document.getElementById('lobby').hidden;
      if (nav?.ok && waiting && !kickoff.disabled) kickoff.click();
    } catch (err) {
      survive(err);
    }
    return undefined;
  }

  function startMatch() {
    app.mode = 'solo';
    applyStadium(settings.stadium);
    const compo = roster();
    view.setRoster(compo);
    scores.setRoster(compo);
    audio.unlock();
    audio.applyLevels(settings.audio);
    audio.stopAll();
    chat.clear();
    view.names.hush();
    engine.start(seed(), settings.match.level, settings.match.duration);
    app.running = true;
    app.paused = false;
    app.finished = false;
    app.last = performance.now();
    menu.hide();
  }

  // Changement de vue a la volee : Y sur la manette, V au clavier. Le
  // reglage est le meme que celui des parametres, donc le choix se garde.
  input.onCamera = () => {
    settings.camera = settings.camera === 'follow' ? 'arena' : 'follow';
    saveSettings(settings);
    view.setMode(settings.camera);
    hud.flash(settings.camera === 'follow' ? 'Camera : suivi' : 'Camera : arene entiere');
    if (menu.screen === 'settings') menu.renderSettings();
  };

  // Panneau du joueur (profil, amis, clan, messages) : Start ou ², a tout
  // moment.
  const panneau = new Panneau(document.getElementById('shell'), API_HTTP);
  // Retour de la connexion Google, demandee depuis le multijoueur : on y
  // revient, profil ouvert pour choisir son pseudo et son avatar.
  if (demande.get('ecran') === 'multi') {
    history.replaceState(null, '', location.pathname);
    menu.showOnline().then(() => demande.has('profil') && panneau.ouvrirProfil());
  }
  input.onPanneau = () => panneau.basculer();

  input.onPause = () => {
    // Dans les ecrans de menu, la touche pause sert de retour arriere,
    // comme B a la manette.
    if (['settings', 'garage', 'stadium', 'online'].includes(menu.screen)) {
      menu.back();
      return;
    }
    if (!app.running || app.finished) return;
    app.paused = !app.paused;
    if (app.paused) menu.show('pause');
    else menu.hide();
  };

  // Le son ne demarre qu'apres un geste : on en profite pour lancer la nappe.
  const wake = () => {
    audio.unlock();
    audio.applyLevels(settings.audio);
  };
  addEventListener('pointerdown', wake, { once: true });
  addEventListener('keydown', wake, { once: true });

  // Mise au point : reservee au solo. En ligne c'est le serveur qui simule,
  // un gabarit change ici ne montrerait qu'un mensonge a l'ecran.
  addEventListener('keydown', (e) => {
    // En calage, les fleches deplacent la planche et ne conduisent plus :
    // on les prend avant tout le reste.
    if (fit.key(e) || cages.key(e)) {
      e.preventDefault();
      return;
    }
    // F1 a F4, plus les chiffres 1 a 4 en secours : selon le navigateur,
    // certaines touches de fonction ne descendent jamais jusqu'a la page —
    // F3 ouvre la recherche et ne nous arrive pas. Les chiffres, eux, ne
    // sont pris par personne, ni par le jeu ni par le navigateur.
    // F8 double F3 : c'est la seule des quatre que le navigateur confisque,
    // et les chiffres servent maintenant au tchat rapide.
    const DEBUG_KEYS = { F1: 'F1', F2: 'F2', F3: 'F3', F8: 'F3', F4: 'F4', F6: 'F6' };
    const touche = DEBUG_KEYS[e.key];
    if (!touche) return;
    e.preventDefault();
    if (app.mode !== 'solo') {
      hud.flash('Mise au point indisponible en ligne');
      return;
    }
    if (touche === 'F6') {
      // Cages et decor ne se calent pas en meme temps : F6 referme F4.
      if (fit.on) fit.toggle(settings.stadium, geom);
      if (!debug.limits) debug.toggle('F1');
      const on = cages.toggle(settings.stadium);
      hud.flash(`Calage des cages : ${on ? 'ouvert' : 'ferme'}`);
      return;
    }
    if (touche === 'F4') {
      if (cages.on) cages.toggle(settings.stadium);
      // Sans le contour a regler, le calage se ferait a l'aveugle : on
      // l'allume avant d'entrer, pour que le cadre soit pose a temps.
      if (!debug.limits) debug.toggle('F1');
      const on = fit.toggle(settings.stadium, geom);
      hud.flash(`Calage du decor : ${on ? 'ouvert' : 'ferme'}`);
      return;
    }
    // Une panne ici serait muette : rien ne se passerait a l'ecran et on
    // croirait la touche morte, ce qui est deja arrive.
    try {
      const said = debug.toggle(touche);
      if (said) hud.flash(said);
    } catch (err) {
      console.error(err);
      hud.flash('Mise au point en panne, voir la console');
    }
  });

  addEventListener('resize', () => view.resize());
  input.onPadChange = () => {
    if (menu.screen === 'settings') menu.renderSettings();
  };

  /** Resume du salon pour le tableau de bord, `null` en solo. */
  function lobbyInfo() {
    if (app.mode !== 'online' || !net.room) return null;
    return {
      code: net.room.code,
      players: net.room.players.length,
      seats: net.room.players.length,
      host: net.isHost,
    };
  }

  /** Une image de jeu. Isolee de la boucle pour que son echec n'emporte
   *  pas le reste : sans ce filet, la premiere exception fige l'ecran sur
   *  du noir, definitivement. */
  function tick(now) {
      const dt = Math.min((now - app.last) / 1000, 0.25);
      app.last = now;

      // Les entrees se lisent a chaque image, meme menu ouvert : c'est ce qui
      // permet de reprendre la partie et de reassigner un bouton de manette.
      const cmd = input.read();
      padMenu();
      // Tchat rapide : seulement en partie, menu ferme. Ouvert, un menu
      // se sert deja de la croix pour se parcourir.
      const horloge = now / 1000;
      if (app.running && !app.paused && !menu.screen && !fit.on && !cages.on && !panneau.ouvert) {
        chat.pulse(input.chatPulse(), horloge);
      } else {
        chat.cancel();
      }
      chat.update(horloge);
      // Le calage arrete le jeu : on aligne un decor sur une image fixe,
      // pas sur une balle qui roule. Idem pour les cages.
      const live = app.running && !app.paused && !fit.on && !cages.on;
      let state;
      let events = null;
      if (app.mode === 'online') {
        if (live) net.send(cmd);
        state = net.state();
        events = net.events();
      } else {
        if (live) {
          engine.input(SOLO_SEAT, cmd);
          engine.step(dt);
          events = engine.events();
        } else if (!app.running) {
          // Menu d'accueil : l'arene reste affichee, figee en fond.
          engine.step(0);
        }
        state = engine.state();
      }

      // En ligne, la premiere image du serveur peut se faire attendre.
      if (!state) return;

      const me = app.mode === 'online' ? net.slot : SOLO_SEAT;
      view.follow = me;
      if (events) handleEvents(events, state);

      const player = readCar(state, me);
      view.ballGone = (state[STATE.PHASE] | 0) === PHASE.GOAL;
      view.update(state, readCar, dt);
      debug.update(state, readCar, carsIn(state));
      hud.update(state, player, state[STATE.PHASE] | 0, geom.boostMax, lobbyInfo());
      // Le tableau se tient enfonce : on le montre tant que la touche l'est.
      scores.show(!!cmd.scores && app.running && !app.paused);
      scores.update(state);
      // Pendant la celebration d'un but, seule l'ovation s'entend : les
      // voitures roulent encore, mais on coupe tout ce qui vient d'elles
      // jusqu'a la remise en place.
      const fete = (state[STATE.PHASE] | 0) === PHASE.GOAL;
      const aVoiture = live && !fete && player.demo <= 0;

      // Retour d'une demolition : la carcasse reapparait au fond du camp,
      // moteur coupe, et redemarre. C'est l'autre moment ou l'on arrive
      // sur le terrain, avec l'engagement.
      if (app.demoAvant > 0 && player.demo <= 0 && live) audio.engineStart();
      app.demoAvant = player.demo;

      // Le crissement suit la glissade reelle, pas le bouton : on n'entend
      // rien tant que les roues tiennent, meme frein a main tire.
      const sliding = aVoiture && Math.abs(player.slip) > 0.22 && player.speed > 90;
      audio.setDrift(sliding, (Math.abs(player.slip) - 0.22) * 1.6);
      audio.setBoost(aVoiture && player.flame > 0, dt);
      // Moteur : muet tant que les joueurs ne sont pas reposes au sol.
      audio.setEngine(aVoiture, player.speed, cmd.throttle, geom.speedMax);

      // L'ecran de fin n'existe qu'en solo : en ligne le serveur renvoie tout
      // le monde a l'echauffement, on reste donc dans la partie.
      const over = (state[STATE.PHASE] | 0) === PHASE.OVER;
      if (app.mode === 'solo' && app.running && !app.finished && over) {
        app.finished = true;
        audio.stopAll();
        menu.result(state[STATE.SCORE_BLUE] | 0, state[STATE.SCORE_ORANGE] | 0);
      }
  }

  let broken = false;
  function survive(err) {
    // Une panne installee se repete a chaque image : on ne la signale
    // qu'une fois, sinon la console devient illisible.
    if (broken) return;
    broken = true;
    console.error(err);
    const box = document.getElementById('fatal');
    box.hidden = false;
    box.textContent = `Une erreur s'est produite : ${err.message}.`
      + ' Recharge la page avec Ctrl+F5 ; le jeu continue en attendant.';
  }

  requestAnimationFrame(function frame(now) {
    try {
      tick(now);
    } catch (err) {
      survive(err);
    }
    requestAnimationFrame(frame);
  });
  if (demande.has('jouer')) startMatch();

  function handleEvents(buf, state) {
    // Pendant la celebration d'un but, seule l'ovation s'entend.
    const fete = (state[STATE.PHASE] | 0) === PHASE.GOAL;
    for (const e of readEvents(buf)) {
      switch (e.code) {
        case EV.HIT:
          // Aucun contact ne secoue l'ecran, balle, voiture ou coincement :
          // la camera ne bouge qu'au but.
          if (!fete) audio.ballTouch(e.value);
          break;
        case EV.POST:
          if (!fete) audio.post(e.value);
          break;
        case EV.DEMO: {
          // La carcasse n'a pas bouge : c'est la qu'on fait sauter la bombe.
          const victim = readCar(state, e.value | 0);
          view.explode(victim.x, victim.y, e.value | 0);
          break;
        }
        case EV.GOAL:
          audio.goal();
          // La balle explose dans la cage, aux couleurs de qui marque.
          view.explode(state[6], state[7], e.value | 0);
          break;
        case EV.SAVE:
          audio.save();
          break;
        case EV.OVERTIME:
          audio.overtime();
          break;
        case EV.KICKOFF:
          // Page blanche avant le decompte : l'ovation du but precedent, ses
          // braises et ses traces de gomme n'ont plus rien a faire ici.
          audio.hush();
          view.clearEffects();
          audio.countdown();
          // Le demarreur vient apres le silence : joue avant, `hush` le
          // coupait dans l'oeuf. Tout le monde arrive sur le terrain.
          audio.engineStart();
          break;
        default:
          break;
      }
    }
  }
}

function seed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

boot().catch((err) => {
  console.error(err);
  const box = document.getElementById('fatal');
  box.hidden = false;
  box.textContent = `Le jeu n'a pas pu demarrer : ${err.message}`;
});
