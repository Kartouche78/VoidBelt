// Point d'entree : assemble le moteur Rust, le rendu, le son et l'affichage.

import { loadEngine, S, EV, PHASE } from './moteur.js';
import { Scene } from './scene.js';
import { Car } from './voiture.js';
import { Gates } from './portes.js';
import { poserPanneaux } from './panneaux.js';
import { Effects } from './effets.js';
import { Input } from './entrees.js';
import { Sound, PISTES } from './son.js';
import { Hud, fmt, records } from './hud.js';
import { Diagnostic } from './diagnostic.js';
import { Settings } from './parametres.js';
import { aideSon } from './onglet-commandes.js';
import { recetteUsine, normaliser } from '../creation/son/recettes.js';
import { NUAGES } from './nuages.js';
import { moteurDuJeu, choisirPourLeJeu } from '../creation/son/choix.js';

/** Recette d'un moteur propose (`moteursProposes`) : d'usine, ou le perso. */
function recetteDe(id) {
  try {
    const p = JSON.parse(localStorage.getItem('skidmania.creation.perso'));
    if (p && normaliser(p).id === id) return normaliser(p);
  } catch {
    /* pas de moteur perso */
  }
  return recetteUsine(id);
}

const $ = (id) => document.getElementById(id);
const status = (t) => { $('chargement-etat').textContent = t; };

async function boot() {
  const view = new Scene($('jeu'));
  status('Moteur…');
  const engine = await loadEngine('assets/skidmania.wasm');
  status('Circuit et voiture…');
  const car = new Car();
  await Promise.all([
    view.loadCircuit('assets/Circuit/circuit.glb'),
    car.load(view.scene, 'assets/car/koenigsegg.glb'),
  ]);
  // les pitons rocheux, places d'apres les reperes de la piste
  const points = [];
  for (let s = 0; s < engine.trackLength; s += 25) {
    const p = engine.frame(s).p;
    points.push({ x: p[0], z: p[2] });
  }
  view.rochers(points);
  const gates = new Gates(view.scene, engine);
  // fleches animees au-dessus du muret exterieur des virages
  const panneaux = poserPanneaux(view.scene, engine);
  const fx = new Effects(view.scene);
  const input = new Input();
  const sound = new Sound();
  const hud = new Hud(engine);
  const diag = new Diagnostic();
  // Moteur : la boite du moteur Rust s'etage dessus, le generateur en
  // change de son, et le choix est garde comme celui de la Creation.
  let moteurId = null;
  const poserMoteur = (id) => {
    const r = id === moteurDuJeu().recette.id ? moteurDuJeu().recette : recetteDe(id);
    if (moteurId !== null) choisirPourLeJeu(r, moteurDuJeu().synthese);
    moteurId = id;
    engine.setEngine(r);
    sound.changerMoteur(r);
    hud.moteur(r);
  };
  const settings = new Settings(engine.tuning, (local) => {
    if (local.moteur !== moteurId) poserMoteur(local.moteur);
    sound.setVolume(local.volume / 100);
    for (const p of PISTES) sound.setNiveau(p.id, local[`vol_${p.id}`] / 100);
    input.rumbleOn = local.rumble;
    // camera : 0 proche, 1 eloignee, 2 embarquee (camera.rs)
    engine.cameraMode(local.camera);
    // loopings vecus en embarquee (camera.rs, cam_loop_auto)
    engine.tuning.cam_loop_auto = local.loopEmbarquee ? 1 : 0;
    diag.montrer(local.diagnostic);
  }, input);
  // F1 : gameplay classique (la conduite d'avant la refonte Stadium Car).
  // Chaque gameplay garde ses propres records.
  let classique = false;
  const useRecords = () => {
    records.useSettings(settings.signature() + (classique ? '|classique' : ''));
    hud.reloadRecord(!settings.isDefault() || classique);
  };
  useRecords();

  let mode = 'accueil'; // accueil, course, arrivee
  let splits = [];
  // une course ou l'on s'est teleporte ne peut pas devenir un record
  let teleported = false;
  let finishedAt = 0;
  let rumbleWait = 0;

  // Manette branchee : les indications passent a ses boutons.
  const padMode = (on) => document.body.classList.toggle('manette', on);
  addEventListener('gamepadconnected', () => padMode(true));
  addEventListener('gamepaddisconnected', () => padMode(!!input.pad()));
  addEventListener('keydown', () => padMode(false));
  const bandeau = document.createElement('div');
  bandeau.id = 'bandeau-gameplay';
  document.body.appendChild(bandeau);
  let bandeauFin = 0;
  // indicateur permanent du gameplay en cours, cliquable
  const indicateur = document.createElement('button');
  indicateur.id = 'indicateur-gameplay';
  indicateur.title = 'Changer de gameplay (F1)';
  document.body.appendChild(indicateur);
  const majIndicateur = () => {
    indicateur.innerHTML = '<small>F1</small> ' + (classique ? 'CLASSIQUE' : 'DÉFAUT');
    indicateur.classList.toggle('classique', classique);
  };
  majIndicateur();
  const changerGameplay = () => {
    classique = !classique;
    majIndicateur();
    engine.gameplay(classique ? 1 : 0);
    // changer de conduite en pleine course en fait une course d'essai
    if (mode === 'course') teleported = true;
    useRecords();
    bandeau.textContent = classique ? 'GAMEPLAY CLASSIQUE · F1 POUR REVENIR' : 'GAMEPLAY PAR DÉFAUT';
    bandeau.classList.add('vu');
    clearTimeout(bandeauFin);
    bandeauFin = setTimeout(() => bandeau.classList.remove('vu'), 2200);
    document.body.classList.toggle('classique', classique);
  };
  addEventListener('keydown', (e) => {
    if (e.code !== 'F1') return;
    e.preventDefault();
    changerGameplay();
  });
  indicateur.addEventListener('click', (e) => {
    e.stopPropagation();
    indicateur.blur();
    changerGameplay();
  });

  // F3 : diagnostic de conduite
  addEventListener('keydown', (e) => {
    if (e.code !== 'F3') return;
    e.preventDefault();
    settings.basculer('diagnostic');
  });

  // Reglages modifiables depuis la console : skidmania.tuning.maxSpeed = 60
  window.skidmania = {
    tuning: engine.tuning,
    engine,
    // reglages du ciel en direct : skidmania.nuages.uCouverture.value = 0.6
    nuages: NUAGES,
    seek(s, speed) {
      teleported = true;
      engine.seek(s, speed);
    },
  };

  const restart = () => {
    splits = [];
    teleported = false;
    engine.restart();
    sound.engineStart();
    fx.reset();
    $('arrivee').classList.remove('vu');
    mode = 'course';
  };

  // Le menu met la course en pause. Changer la conduite en pleine course
  // en fait une course d'essai : le chrono ne compte pas.
  let signatureAtOpen = '';
  const openSettings = () => {
    signatureAtOpen = settings.signature();
    document.body.classList.add('reglages');
    settings.show();
    // dans les Parametres, le jeu se tait
    sound.pause(true);
  };
  settings.onClose = () => {
    sound.pause(false);
    document.body.classList.remove('reglages');
    if (settings.signature() !== signatureAtOpen) {
      if (mode === 'course') teleported = true;
      useRecords();
    }
  };
  for (const b of document.querySelectorAll('.ouvrir-reglages')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      b.blur();
      openSettings();
    });
  }

  input.onAction = (a) => {
    if (settings.open) {
      settings.handle(a);
      return;
    }
    if (a === 'menu') {
      openSettings();
      return;
    }
    if (a === 'vue') {
      settings.suivant('camera');
      return;
    }
    if (a === 'mute') {
      const coupe = sound.toggleMute();
      $('son').dataset.coupe = coupe ? '1' : '';
      $('son').textContent = coupe ? 'SON COUPÉ' : aideSon(input.config);
      return;
    }
    if (mode === 'accueil') {
      if (a !== 'confirm') return;
      sound.start();
      $('accueil').classList.remove('vu');
      restart();
      return;
    }
    if (a === 'respawn' && mode === 'course') engine.respawn();
    // A est aussi le frein a main : on attend un peu apres la ligne pour
    // qu'un dernier coup de frein ne relance pas la course
    const settled = performance.now() - finishedAt > 1000;
    if (a === 'restart' || (a === 'confirm' && mode === 'arrivee' && settled)) restart();
  };
  $('accueil').addEventListener('click', (e) => {
    if (!e.target.closest('a')) input.onAction('confirm');
  });
  $('rejouer').addEventListener('click', () => restart());
  // Recommencer depuis le depart, a tout moment : bouton du HUD et des
  // Parametres. Depuis l'accueil, la course demarre.
  const recommencer = () => {
    sound.start();
    $('accueil').classList.remove('vu');
    restart();
  };
  settings.onRestart = recommencer;
  $('recommencer').addEventListener('click', (e) => {
    e.stopPropagation();
    e.currentTarget.blur();
    recommencer();
  });

  const finish = (t, st) => {
    mode = 'arrivee';
    finishedAt = performance.now();
    const old = records.load();
    const score = Math.round(st[S.SCORE]);
    const better = !teleported && (!old || t < old.time);
    if (better) records.save({ time: t, splits: splits.slice(), score });
    hud.record = records.load();
    hud.showBest();
    $('arrivee-temps').textContent = fmt(t);
    $('arrivee-ecart').textContent = teleported
      ? 'COURSE D’ESSAI : PAS DE RECORD'
      : !old
      ? 'PREMIER CHRONO'
      : better ? `NOUVEAU RECORD  -${(old.time - t).toFixed(3)}` : `+${(t - old.time).toFixed(3)} SUR LE RECORD`;
    $('arrivee-ecart').className = better ? 'avance' : 'retard';
    $('arrivee-score').textContent = score.toLocaleString('fr-FR');
    $('arrivee').classList.add('vu');
  };

  const handle = (ev, st) => {
    switch (ev.type) {
      case EV.COUNT: hud.countdown(ev.a); sound.count(ev.a); break;
      case EV.GO: hud.countdown(0); sound.count(0); gates.pass(0); input.rumble(180, 0.6, 0.3); break;
      case EV.CHECKPOINT:
        splits.push(ev.b);
        sound.checkpoint(hud.split(ev.a, ev.b));
        input.rumble(90, 0.5, 0);
        gates.pass(ev.a + 1);
        break;
      case EV.FINISH:
        splits.push(ev.a);
        hud.split(splits.length - 1, ev.a);
        gates.pass(splits.length);
        sound.finish();
        input.rumble(400, 0.8, 0.6);
        finish(ev.a, st);
        break;
      case EV.BOOST: sound.boost(); input.rumble(150, 0.2, 0.5); break;
      case EV.BANK: hud.bank(ev.a); sound.bank(); break;
      case EV.WALL: sound.thud(ev.a); input.rumble(160, 0.3, Math.min(1, ev.a / 12)); break;
      case EV.RESPAWN: fx.marks.last = [null, null]; break;
      case EV.DECOLLAGE: fx.marks.last = [null, null]; break;
      case EV.RECEPTION:
        sound.thud(ev.a);
        input.rumble(140, 0.3, Math.min(1, ev.a / 15 + ev.b));
        break;
      default: break;
    }
  };

  const cam = view.camera;
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const inp = input.read();
    engine.input(inp.throttle, inp.brake, inp.steer, inp.handbrake, inp.boost, inp.lookBack);
    const paused = mode === 'accueil' || settings.open;
    const { state: st, events } = engine.step(paused ? 0 : dt);
    if (mode !== 'accueil') for (const ev of events) handle(ev, st);

    car.update(st, dt);
    fx.update(st, car, dt);
    gates.update(dt);
    panneaux(dt);
    hud.update(st, dt);
    sound.update(st, paused ? { throttle: 0 } : inp);

    // vibration continue : le grain du drift, plus fort pendant le boost
    rumbleWait -= dt;
    if (rumbleWait <= 0 && mode === 'course' && !paused) {
      const vl = Math.abs(st[S.VL]);
      const slide = vl > 4.5 ? Math.min(1, (vl - 4.5) / 12) : 0;
      const boosting = st[S.BOOSTING] > 0 ? 0.35 : 0;
      if (slide > 0 || boosting > 0) {
        input.rumble(110, slide * 0.45 + boosting * 0.3, boosting);
        rumbleWait = 0.1;
      }
    }

    // la camera vient du moteur (camera.rs), calculee sur la pose
    // interpolee ; en embarquee, la voiture est cachee
    car.root.visible = st[S.CAM_MODE] !== 2;
    cam.position.set(st[S.CAM_POS], st[S.CAM_POS + 1], st[S.CAM_POS + 2]);
    cam.up.set(st[S.CAM_UP], st[S.CAM_UP + 1], st[S.CAM_UP + 2]);
    cam.lookAt(st[S.CAM_TARGET], st[S.CAM_TARGET + 1], st[S.CAM_TARGET + 2]);
    diag.update(st, dt);
    if (Math.abs(cam.fov - st[S.FOV]) > 0.01) {
      cam.fov = st[S.FOV];
      cam.updateProjectionMatrix();
    }
    fx.smoke.points.material.uniforms.scale.value =
      view.renderer.domElement.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    view.follow(car.pos, dt);
    view.render();
    document.body.classList.toggle('en-course', st[S.PHASE] !== PHASE.COUNTDOWN || mode !== 'accueil');
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  $('chargement').classList.add('fini');
  $('accueil').classList.add('vu');
}

boot().catch((e) => {
  console.error(e);
  status(`Impossible de lancer le jeu : ${e.message}`);
});
