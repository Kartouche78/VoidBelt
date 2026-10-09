// Chargement du moteur Rust compile en WebAssembly.
//
// Le module n'utilise aucun binding genere : il expose des fonctions
// `extern "C"` et renvoie des pointeurs dans sa memoire lineaire. On relit
// donc les vues a chaque image, car la memoire peut grandir et invalider
// un `Float32Array` conserve trop longtemps.

/** Champs du tampon d'etat, alignes sur `voidbelt-skidmania/src/state.rs`. */
export const S = {
  PHASE: 0, COUNTDOWN: 1, TIME: 2, SPEED: 3, BOOST: 4, BOOSTING: 5,
  DRIFTING: 6, SLIDING: 7, DRIFT_POINTS: 8, SCORE: 9, SLIP: 10, VL: 11,
  STEER: 12, HANDBRAKE: 13, NEXT_CP: 14, CP_COUNT: 15, PROGRESS: 16,
  LENGTH: 17, WALL_HIT: 18, VF: 19, POS: 20, FWD: 23, UP: 26, RIGHT: 29,
  CAM_POS: 32, CAM_TARGET: 35, CAM_UP: 38, FOV: 41, LAT: 42,
  // boite et moteur : rapport 0 = point mort, -1 = marche arriere
  RPM: 43, GEAR: 44, ENG_CUT: 45, ENG_LIFT: 46, ENG_LOAD: 47, REDLINE: 48,
  SPEEDSLIDE: 49,
  // diagnostic : contact au sol, normale de piste, acceleration, forces
  CONTACT: 50, NORMAL: 51, ACCEL: 54, F_PROP: 55, F_FREIN: 56, F_LAT: 57,
  F_GRAV: 58, F_SS: 59, CAM_MODE: 60, CAM_DIST: 61, PENALITE: 62,
  YAW_RATE: 63, AIR_T: 64, SURFACE: 65, LEN: 66,
};

export const PHASE = { COUNTDOWN: 0, RUNNING: 1, FINISHED: 2 };

/** Types d'evenements, alignes sur `state::events`. */
export const EV = {
  COUNT: 1, GO: 2, CHECKPOINT: 3, FINISH: 4, BOOST: 5, BANK: 6, WALL: 7, RESPAWN: 8,
  DECOLLAGE: 9, RECEPTION: 10,
};

/** Modes de camera (camera.rs). */
export const CAMERAS = [
  ['proche', 'PROCHE'],
  ['loin', 'ÉLOIGNÉE'],
  ['embarquee', 'EMBARQUÉE'],
];

export async function loadEngine(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
  const x = instance.exports;
  x.sm_new();

  const f32 = (ptr, len) => new Float32Array(x.memory.buffer, ptr, len);

  const tuningLen = x.sm_tuning_len();
  // les noms viennent du module (tune.rs) : impossible de se desynchroniser
  const noms = new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.sm_tuning_keys(), x.sm_tuning_keys_len()));
  const TUNING_KEYS = noms.split('\n').slice(0, tuningLen);
  // Reglages modifiables en direct : skidmania.tuning.adherence = 30
  const tuning = {};
  TUNING_KEYS.forEach((k, i) => {
    Object.defineProperty(tuning, k, {
      enumerable: true,
      get: () => f32(x.sm_tuning(), tuningLen)[i],
      set: (v) => { f32(x.sm_tuning(), tuningLen)[i] = v; },
    });
  });

  const checkpoints = [];
  for (let i = 0; i < x.sm_checkpoint_count(); i++) checkpoints.push(x.sm_checkpoint(i));
  /** Trous du trace (pas de route, la voiture vole) : [debut, fin]. */
  const trous = [];
  for (let i = 0; i < x.sm_gap_count(); i++) trous.push([x.sm_gap(i, 0), x.sm_gap(i, 1)]);

  return {
    tuning,
    trackLength: x.sm_track_len(),
    startLine: x.sm_start_line(),
    /** Abscisses des checkpoints ; la derniere est l'arrivee. */
    checkpoints,
    trous,
    input(throttle, brake, steer, handbrake, boost, lookBack) {
      x.sm_input(throttle, brake, steer, handbrake ? 1 : 0, boost ? 1 : 0, lookBack ? 1 : 0);
    },
    /** Avance d'une image ; renvoie l'etat et la liste des evenements. */
    step(dt) {
      const n = x.sm_step(dt);
      const state = f32(x.sm_state(), S.LEN);
      const raw = f32(x.sm_events(), n * 3);
      const events = [];
      for (let i = 0; i < n; i++) {
        events.push({ type: raw[i * 3], a: raw[i * 3 + 1], b: raw[i * 3 + 2] });
      }
      return { state, events };
    },
    respawn: () => x.sm_respawn(),
    /** Moteur choisi (recette de la Creation) : la boite s'y etage. */
    setEngine: (r) => x.sm_engine(r.ralenti, r.zoneRouge, r.rapports, r.passage, r.tempsPassage, r.reactivite),
    /** Camera : 0 exterieure proche, 1 haute et eloignee, 2 embarquee. */
    cameraMode: (n) => x.sm_camera_mode(n),
    restart: () => x.sm_restart(),
    /** Debogage : voiture posee en `s`, lancee a `speed` m/s. Passer par
     *  `skidmania.seek`, qui exclut la course des records. */
    seek: (s, speed = 45) => x.sm_seek(s, speed),
    /** Repere de la piste en `s` : { p, t, r, u }, tableaux [x, y, z]. */
    frame(s) {
      const v = Array.from(f32(x.sm_frame(s), 12));
      return { p: v.slice(0, 3), t: v.slice(3, 6), r: v.slice(6, 9), u: v.slice(9, 12) };
    },
  };
}
