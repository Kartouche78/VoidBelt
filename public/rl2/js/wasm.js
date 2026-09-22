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
  /// Effectif de la partie : il change quand quelqu'un rejoint un salon,
  /// et c'est lui qui dit ou commencent les plots.
  CAR_COUNT: 12,
  /// Orientation de la balle, quatre composantes : le moteur la calcule,
  /// le rendu la pose telle quelle.
  BALL_SPIN: 13,
  CAR_BASE: 17,
  CAR_STRIDE: 16,
};

/** Debut des plots, derriere les voitures. */
export function padBase(cars) {
  return STATE.CAR_BASE + cars * STATE.CAR_STRIDE;
}

export function stateLen(cars, padCount) {
  return padBase(cars) + padCount;
}

/** Effectif annonce par une image d'etat. */
export function carsIn(state) {
  return Math.max(1, state[STATE.CAR_COUNT] | 0);
}

/** Decalages dans un bloc voiture. */
export const CAR = {
  X: 0, Y: 1, YAW: 2, SPEED: 3, BOOST: 4, DRIFT: 5, DEMO: 6, SONIC: 7, FLAME: 8, SLIP: 9,
  // Compteurs personnels, sur le bareme de Rocket League.
  POINTS: 10, GOALS: 11, ASSISTS: 12, SAVES: 13, SHOTS: 14, DEMOS: 15,
};

/** Codes d'evenements, alignes sur `game.rs`. */
export const EV = {
  WALL: 0, HIT: 1, PAD: 2, BUMP: 3, DEMO: 4,
  GOAL: 5, COUNT: 6, BOOM: 7, KICKOFF: 8, END: 9,
  SAVE: 10, OVERTIME: 11,
  TOUCH: 12, SHOT: 13, CLEAR: 14, EPIC_SAVE: 15,
  ASSIST: 16, SCORER: 17, EXTERMINATION: 18,
};

/** Echelle du monde, unique et alignee sur Rocket League.
 *
 *  Une unite de notre terrain vaut 3,7097 unites Unreal : c'est le facteur
 *  qui fait coincider nos tailles et nos vitesses avec celles du vrai jeu,
 *  du rayon de la balle aux 2300 uu/s du plafond. Comme 1 uu vaut 1 cm et
 *  que km/h = uu/s x 0,036, tout le reste en decoule. Le compteur affiche
 *  donc les vraies vitesses du jeu, 82,8 km/h a fond, et non un chiffre
 *  arcade gonfle. Seul le seuil du supersonique est descendu un peu sous
 *  le sien, pour qu'il se voie sur un terrain deux fois plus court.
 *
 *  Tableau de bord et interface de reglage partagent ces deux constantes,
 *  pour ne jamais annoncer deux vitesses differentes. */
export const UU_PAR_UNITE = 3.7097;
export const KMH_PAR_UNITE = UU_PAR_UNITE * 0.036;
export const METRES_PAR_UNITE = UU_PAR_UNITE * 0.01;

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
    /// Noms des reglages, dans l'ordre exact du tableau. Ils viennent du
    /// wasm et non d'une liste recopiee : les deux ne peuvent pas deriver.
    tuneKeys() {
      const b = new Uint8Array(w.memory.buffer, w.rl_tune_keys_ptr(), w.rl_tune_keys_len());
      return new TextDecoder().decode(b).split(String.fromCharCode(10));
    },
    /// Reglages en cours, sous forme d'objet nomme.
    tune() {
      const v = view(w.rl_tune_ptr(), w.rl_tune_len());
      const keys = this.tuneKeys();
      return Object.fromEntries(keys.map((k, i) => [k, v[i]]));
    },
    /// Valeurs d'usine.
    tuneDefaults() {
      const v = view(w.rl_tune_defaults_ptr(), w.rl_tune_len());
      const keys = this.tuneKeys();
      return Object.fromEntries(keys.map((k, i) => [k, v[i]]));
    },
    /// Applique des reglages nommes. Les noms inconnus sont ignores, les
    /// absents gardent leur valeur : un fichier ecrit avant l'ajout d'un
    /// reglage reste lisible.
    setTune(values) {
      const keys = this.tuneKeys();
      const cur = view(w.rl_tune_ptr(), w.rl_tune_len());
      const out = Float32Array.from(cur);
      keys.forEach((k, i) => {
        const x = Number(values?.[k]);
        if (Number.isFinite(x)) out[i] = x;
      });
      const ptr = w.alloc(out.length * 4);
      new Float32Array(w.memory.buffer, ptr, out.length).set(out);
      w.rl_tune_set(ptr, out.length);
      w.dealloc(ptr, out.length * 4);
      return this.tune();
    },
    geometry() {
      const g = view(w.rl_geometry_ptr(), w.rl_geometry_len());
      return {
        boardW: g[0], boardH: g[1],
        minX: g[2], maxX: g[3], minY: g[4], maxY: g[5],
        corner: g[6], goalHalf: g[7], goalDepth: g[8],
        ballR: g[9], carLen: g[10] * 2, carWid: g[11] * 2,
        boostMax: g[12], speedMax: g[13], padCount: g[14], demoSpeed: g[15], countFrom: g[16],
        goalFront: g[17],
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
    points: s[b + CAR.POINTS] | 0,
    goals: s[b + CAR.GOALS] | 0,
    assists: s[b + CAR.ASSISTS] | 0,
    saves: s[b + CAR.SAVES] | 0,
    shots: s[b + CAR.SHOTS] | 0,
    demos: s[b + CAR.DEMOS] | 0,
  };
}
