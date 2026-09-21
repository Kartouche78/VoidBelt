// Chargement du moteur Rust compile en WebAssembly.
//
// Le module n'utilise aucun binding genere : il expose des fonctions
// `extern "C"` et renvoie des pointeurs dans sa memoire lineaire. On relit
// donc les vues a chaque image, car la memoire peut grandir et invalider
// un `Float32Array` conserve trop longtemps.

/** Champs du tampon d'etat, alignes sur `state.rs`. */
export const STATE = {
  PHASE: 0,
  CLOCK: 1,
  SCORE_BLUE: 2,
  SCORE_ORANGE: 3,
  TIMER: 4,
  OVERTIME: 5,
  BALL_X: 6,
  BALL_Y: 7,
  BALL_VX: 8,
  BALL_VY: 9,
  BALL_ROLL: 10,
  LAST_TOUCH: 11,
  CAR_BASE: 12,
  CAR_STRIDE: 10,
  PAD_BASE: 32,
};

/** Decalages dans un bloc voiture. */
export const CAR = {
  X: 0, Y: 1, YAW: 2, SPEED: 3, BOOST: 4, DRIFT: 5, DEMO: 6, SONIC: 7, FLAME: 8, SLIP: 9,
};

/** Codes d'evenements, alignes sur `game.rs`. */
export const EV = {
  WALL: 0, HIT: 1, PAD: 2, BUMP: 3, DEMO: 4,
  GOAL: 5, COUNT: 6, BOOM: 7, KICKOFF: 8, END: 9,
};

export const PHASE = { COUNTDOWN: 0, PLAY: 1, GOAL: 2, OVER: 3, WARMUP: 4 };

export async function loadEngine(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`moteur introuvable (${res.status})`);
  let mod;
  try {
    mod = await WebAssembly.instantiateStreaming(res.clone(), {});
  } catch {
    // Certains serveurs statiques n'annoncent pas `application/wasm`.
    mod = await WebAssembly.instantiate(await res.arrayBuffer(), {});
  }
  const w = mod.instance.exports;
  const view = (ptr, len) => new Float32Array(w.memory.buffer, ptr, len);

  return {
    /** level: 0 debutant, 1 confirme, 2 impitoyable. */
    start(seed, level, duration) {
      w.rl_new(seed >>> 0, level >>> 0, duration);
    },
    restart(seed) {
      w.rl_restart(seed >>> 0);
    },
    setBot(on) {
      w.rl_set_bot(on ? 1 : 0);
    },
    input(idx, c) {
      w.rl_input(idx, c.throttle, c.brake, c.steer, c.boost ? 1 : 0, c.drift ? 1 : 0);
    },
    step(dt) {
      w.rl_step(dt);
    },
    state() {
      return view(w.rl_state_ptr(), w.rl_state_len());
    },
    /** `[nombre, code, valeur, ...]` */
    events() {
      return view(w.rl_events_ptr(), w.rl_events_len());
    },
    pads() {
      return view(w.rl_pads_ptr(), w.rl_pads_len()).slice();
    },
    geometry() {
      const g = view(w.rl_geometry_ptr(), w.rl_geometry_len());
      return {
        boardW: g[0], boardH: g[1],
        minX: g[2], maxX: g[3], minY: g[4], maxY: g[5],
        corner: g[6], goalHalf: g[7], goalDepth: g[8],
        ballR: g[9], carLen: g[10] * 2, carWid: g[11] * 2,
        boostMax: g[12], speedMax: g[13], padCount: g[14], demoSpeed: g[15], countFrom: g[16],
      };
    },
  };
}

/** Parcourt le tampon d'evenements d'une image. */
export function* readEvents(buf) {
  const n = buf[0] | 0;
  for (let i = 0; i < n; i += 1) {
    yield { code: buf[1 + i * 2] | 0, value: buf[2 + i * 2] };
  }
}

/** Extrait le bloc d'une voiture sous forme d'objet. */
export function readCar(s, i) {
  const b = STATE.CAR_BASE + i * STATE.CAR_STRIDE;
  return {
    x: s[b + CAR.X],
    y: s[b + CAR.Y],
    yaw: s[b + CAR.YAW],
    speed: s[b + CAR.SPEED],
    boost: s[b + CAR.BOOST],
    drift: s[b + CAR.DRIFT] > 0.5,
    demo: s[b + CAR.DEMO],
    sonic: s[b + CAR.SONIC] > 0.5,
    flame: s[b + CAR.FLAME],
    slip: s[b + CAR.SLIP],
  };
}
