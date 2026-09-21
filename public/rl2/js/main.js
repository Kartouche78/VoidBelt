// Point d'entree : assemble le moteur Rust, le rendu et les menus.

import { loadEngine, readCar, readEvents, EV, PHASE, STATE } from './wasm.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { Scores } from './scores.js';
import { Menu } from './menu.js';
import { load as loadSettings, save as saveSettings } from './settings.js';
import { Net } from './net.js';

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

  let geom = engine.geometry();
  const padTable = engine.pads();
  const view = new Renderer(document.getElementById('scene'), geom);
  view.setPads(padTable);
  view.setMode(settings.camera);

  const audio = new Audio(settings.audio);
  audio.preload();
  const hud = new Hud(geom);
  const scores = new Scores(document.getElementById('scores'));
  const input = new Input(settings);

  const app = {
    /** `solo` : le moteur local simule. `online` : le serveur simule et on
     *  ne fait qu'envoyer nos commandes et afficher ce qu'il renvoie. */
    mode: 'solo',
    running: false,
    paused: false,
    finished: false,
    last: performance.now(),
  };

  const net = new Net(geom.padCount);

  /** Composition a afficher : un `{ name, team }` par siege. En ligne elle
   *  vient du salon, en solo c'est le joueur contre la machine. Un siege
   *  libere en plein match garde sa voiture mais perd son pseudo. */
  function roster() {
    if (app.mode !== 'online' || !net.room) {
      return [
        { name: settings.name || 'Vous', team: 0 },
        { name: 'Bot', team: 1 },
      ];
    }
    const seats = Math.max(net.cars, ...net.room.players.map((p) => p.slot + 1), 1);
    const out = Array.from({ length: seats }, (_, i) => ({ name: '', team: i % 2 }));
    for (const p of net.room.players) out[p.slot] = { name: p.name, team: p.team & 1 };
    return out;
  }

  const menu = new Menu(settings, input, {
    play: () => startMatch(),
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
    change: (s) => {
      saveSettings(s);
      audio.applyLevels(s.audio);
      view.setMode(s.camera);
    },
  });

  net.onRoom = () => {
    const compo = roster();
    view.setRoster(compo);
    scores.setRoster(compo);
    showTeams(net.room, net.you);
    if (menu.screen === 'online') menu.refreshRooms();
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
      await net.connect(code, menu.playerName());
    } catch (err) {
      menu.status(err.message);
      return;
    }
    audio.unlock();
    audio.applyLevels(settings.audio);
    audio.stopAll();
    app.mode = 'online';
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
    const compo = roster();
    view.setRoster(compo);
    scores.setRoster(compo);
    audio.unlock();
    audio.applyLevels(settings.audio);
    audio.stopAll();
    engine.start(seed(), settings.match.level, settings.match.duration);
    app.running = true;
    app.paused = false;
    app.finished = false;
    app.last = performance.now();
    menu.hide();
  }

  input.onPause = () => {
    // Depuis les parametres, la touche pause sert de retour arriere.
    if (menu.screen === 'settings') {
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
      const live = app.running && !app.paused;
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
      view.update(state, readCar, dt);
      hud.update(state, player, state[STATE.PHASE] | 0, geom.boostMax, lobbyInfo());
      // Le tableau se tient enfonce : on le montre tant que la touche l'est.
      scores.show(!!cmd.scores && app.running && !app.paused);
      scores.update(state);
      // Le crissement suit la glissade reelle, pas le bouton : on n'entend
      // rien tant que les roues tiennent, meme frein a main tire.
      const sliding = live && player.demo <= 0 && Math.abs(player.slip) > 0.22 && player.speed > 90;
      audio.setDrift(sliding, (Math.abs(player.slip) - 0.22) * 1.6);
      audio.setBoost(live && player.demo <= 0 && player.flame > 0, dt);

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

  function handleEvents(buf, state) {
    for (const e of readEvents(buf)) {
      switch (e.code) {
        case EV.HIT:
          if (e.value > 120) view.kick(e.value / 90);
          break;
        case EV.BUMP:
          view.kick(4);
          break;
        case EV.DEMO: {
          // La carcasse n'a pas bouge : c'est la qu'on fait sauter la bombe.
          const victim = readCar(state, e.value | 0);
          view.explode(victim.x, victim.y, e.value | 0);
          break;
        }
        case EV.GOAL:
          audio.goal();
          view.kick(18);
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
