// Point d'entree : assemble le moteur Rust, le rendu et les menus.

import { loadEngine, readCar, readEvents, EV, PHASE, STATE } from './wasm.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { Menu } from './menu.js';
import { load as loadSettings, save as saveSettings } from './settings.js';
import { Net } from './net.js';

const SOLO_SEAT = 0;

async function boot() {
  const settings = loadSettings();
  const engine = await loadEngine('assets/rl2.wasm');
  engine.start(seed(), settings.match.level, settings.match.duration);

  const geom = engine.geometry();
  const padTable = engine.pads();
  const view = new Renderer(document.getElementById('scene'), geom);
  view.setPads(padTable);
  view.setMode(settings.camera);

  const audio = new Audio(settings.audio);
  audio.preload();
  const hud = new Hud(geom);
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

  const net = new Net({
    stateLen: STATE.PAD_BASE + geom.padCount,
    carBase: STATE.CAR_BASE,
    carStride: STATE.CAR_STRIDE,
    cars: 2,
  });

  const menu = new Menu(settings, input, {
    play: () => startMatch(),
    host: () => joinOnline(''),
    join: (code) => joinOnline(code),
    resume: () => {
      app.paused = false;
      menu.hide();
      audio.setMusic(false);
    },
    restart: () => (app.mode === 'online' ? net.start() : startMatch()),
    quit: () => {
      if (app.mode === 'online') return leaveOnline(null, 'title');
      app.running = false;
      app.paused = false;
      app.finished = false;
      audio.stopAll();
      audio.setMusic(true);
      return menu.show('title');
    },
    change: (s) => {
      saveSettings(s);
      audio.applyLevels(s.audio);
      view.setMode(s.camera);
    },
  });

  net.onRoom = () => {
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
    audio.setMusic(true);
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
    audio.setMusic(false);
    app.mode = 'online';
    app.running = true;
    app.paused = false;
    app.finished = false;
    app.last = performance.now();
    menu.hide();
  }

  const kickoff = document.getElementById('btn-kickoff');
  kickoff.onclick = () => net.start();

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
    audio.unlock();
    audio.applyLevels(settings.audio);
    audio.stopAll();
    audio.setMusic(false);
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
    if (!app.running) audio.setMusic(true);
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
      seats: net.room.seats,
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
      audio.setEngine(
        Math.min(player.speed / geom.speedMax, 1),
        player.flame > 0,
        live && player.demo <= 0,
      );
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
        audio.end();
        audio.setMusic(true);
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
          audio.hit(e.value);
          if (e.value > 120) view.kick(e.value / 90);
          break;
        case EV.WALL:
          audio.wall(e.value);
          break;
        case EV.PAD:
          audio.pad(padTable[(e.value | 0) * 3 + 2] > 0.5);
          break;
        case EV.BUMP:
          audio.bump();
          view.kick(4);
          break;
        case EV.DEMO: {
          // La carcasse n'a pas bouge : c'est la qu'on fait sauter la bombe.
          const victim = readCar(state, e.value | 0);
          audio.demo();
          view.explode(victim.x, victim.y, e.value | 0);
          break;
        }
        case EV.GOAL:
          audio.goal();
          view.kick(18);
          break;
        case EV.COUNT:
          audio.count(e.value);
          break;
        case EV.BOOM:
          audio.boom();
          break;
        case EV.SAVE:
          audio.save();
          break;
        case EV.OVERTIME:
          audio.overtime();
          break;
        case EV.KICKOFF:
          if (!audio.countdown()) audio.whistle();
          view.clearEffects();
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
