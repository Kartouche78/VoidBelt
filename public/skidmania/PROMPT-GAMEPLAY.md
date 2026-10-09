# Prompt : reproduire la conduite « drift arcade » de PeakDrive

Copie tout ce qui suit (jusqu'à l'annexe incluse) dans ton assistant IA, dans le projet de ton autre jeu.

---

Tu dois implémenter dans mon jeu une conduite de voiture **arcade, centrée sur le drift**, identique à celle de mon prototype PeakDrive (façon Trackmania : réactive, lisible, aucune simulation réaliste). Adapte le code au moteur et au langage de mon projet, mais **garde exactement le modèle et les valeurs ci-dessous**, car c'est la sensation que je veux retrouver. Une implémentation de référence (JavaScript, sans dépendance) est donnée en annexe : traduis-la fidèlement au lieu de la réinventer.

## 1. Principe du modèle (2D, vu du dessus, même en 3D)

- La voiture est un point avec un cap `yaw` et une **vitesse en repère monde** `(vx, vz)`. Pas de roues physiques, pas de suspensions, pas de masse.
- Convention : `forward = (sin yaw, cos yaw)`, `right = (cos yaw, -sin yaw)`.
- À chaque pas, on décompose la vitesse en **`vf` (longitudinale)** et **`vl` (latérale)** puis on :
  1. tourne le cap (yaw) ;
  2. recalcule `vf`/`vl` dans le nouveau repère (la vitesse monde ne change pas quand on tourne : c'est ça qui crée naturellement le dérapage) ;
  3. applique accélération/frein/traînée sur `vf` ;
  4. **amortit `vl` exponentiellement** : `vl *= exp(-grip * dt)` ;
  5. reconstruit `(vx, vz)` et déplace la voiture.
- Le **drift** n'est pas un mode scripté : c'est un `grip` qui s'effondre quand la glisse dépasse un seuil (hystérésis), plus une aide qui garde l'angle contrôlable.
- Pas de temps **fixe à 1/120 s** (accumulateur), le rendu tourne à part.

## 2. Valeurs de réglage (à garder telles quelles au départ)

| Paramètre | Valeur | Rôle |
|---|---|---|
| maxSpeed | 54 m/s (~195 km/h) | vitesse max sans boost |
| accel | 32 m/s² | poussée, s'atténue vers maxSpeed : `accel * throttle * (1 - vf/maxSp)` |
| brake | 52 m/s² | freinage ; en marche arrière, jusqu'à reverseMax = 12 m/s |
| rolling | 0.12 | traînée : `a -= vf * 0.12` |
| maxYaw | 2.3 rad/s | rotation à fond de braquage |
| steerIn / steerOut | 7 / 11 | lissage du volant (vers l'entrée / retour au centre) |
| grip | 9 | amortissement latéral quand ça accroche |
| driftGrip | 2.4 | amortissement latéral pendant la glisse |
| handbrakeGrip | 0.9 | amortissement latéral frein à main tiré |
| slipEnter / slipExit | 6.5 / 3.2 m/s | seuils de |vl| pour décrocher / raccrocher (hystérésis) |
| driftKeep | 0.45 | part de la vitesse latérale perdue qui est rendue en vitesse avant pendant la glisse (la voiture ne s'arrête pas en drift) |
| alignAssist | 2.3 | couple d'auto-alignement en glisse, voir plus bas |
| driftMinAngle / driftMinSpeed | 0.2 rad / 15 m/s | en dessous, ça ne compte pas comme un drift |
| driftFill | 4.5 s | durée d'un drift à grand angle pour remplir la jauge de boost |
| boostDrain | 2.2 s | durée d'une jauge pleine en boostant |
| boostAccel / boostSpeed | 38 m/s² / +16 m/s | poussée et vitesse max supplémentaires pendant le boost |

## 3. Les règles qui font la sensation

**Direction**
- `yawRate = steer * clamp(speed/8, 0, 1) * (marche arrière ? -1 : 1) * maxYaw * (1 - 0.4 * clamp(speed/maxSpeed, 0, 1))` : on ne tourne pas à l'arrêt, et on tourne un peu moins vite à haute vitesse.
- En glisse : `yawRate *= 1.3`. Frein à main : `yawRate *= 1.5`.
- Le volant est lissé (`steer` rejoint l'entrée à 7/s, revient au centre à 11/s).

**Entrée en drift (3 façons)**
- Braquer à fond à haute vitesse : la vitesse latérale dépasse `slipEnter` et la voiture décroche d'elle-même (à ~45 m/s, braquage plein).
- **Frein à main** : si la vitesse > 10 m/s, glisse immédiate, `grip` = 0.9, rotation x1.5, et un freinage léger de 5 m/s². C'est le déclencheur principal.
- Sortie de la glisse : quand `|vl| < slipExit` et que le frein à main est relâché, l'adhérence revient d'un coup (ça « raccroche » proprement).

**Tenue du drift**
- Auto-alignement : en glisse, avec `spd > 6` et `vf > 0`, on ajoute `atan2(vl, vf) * alignAssist` au yawRate. Effet : sans braquer, la voiture se redresse ; plein braquage, l'angle se stabilise vers 20-30° (jusqu'à ~35° juste après un coup de frein à main). Sans cette aide, la voiture part en toupie.
- `driftKeep` : pendant la glisse (hors frein à main), la vitesse latérale perdue est partiellement rendue à `vf`, donc on peut tenir un drift longtemps en gardant (voire en gagnant) de la vitesse.

**Drift, score et boost**
- `drifting = sliding && |slipAngle| > 0.2 rad && speed > 15 m/s`, avec `slipAngle = atan2(vl, vf)`.
- Pendant un drift : `boost += dt * clamp(|slip|/0.5, 0.5, 1.5) / driftFill` (plus l'angle est grand, plus ça charge vite, plafonné à 1) et `points += speed * |slip| * dt * 3`.
- Les points sont **validés** 0.25 s après la fin du drift (petit délai de tolérance pour enchaîner).
- **Le boost n'est jamais automatique.** La jauge (0 à 1) se remplit en driftant, reste stockée, et le joueur la dépense **en maintenant le bouton boost** : tant que le bouton est tenu et la jauge > 0, on ajoute `boostAccel`, on relève la vitesse max de `boostSpeed`, et la jauge baisse de `dt / boostDrain`.
- Au-dessus de la vitesse max : on y revient en douceur (`vf -= (vf - maxSp) * min(1, 3*dt)`).

## 4. Contrôles

- Clavier : flèches / WASD (touches physiques, donc ZQSD marche sur AZERTY), **Espace ou Shift = frein à main**, **B ou E = boost (maintenir)**.
- Manette : stick gauche = direction, RT = gaz, LT = frein, **A ou RB = frein à main, B = boost**.
- ATTENTION au sens : avec la convention ci-dessus et une caméra qui regarde vers `+z`, `+yaw` tourne à GAUCHE à l'écran. J'ai donc **inversé le signe de la direction à l'entrée** (droite = steer négatif). Vérifie dans mon moteur que « droite » tourne bien à droite à l'écran, et corrige le signe à l'entrée uniquement, pas dans la physique.

## 5. Ce qui rend le drift agréable (hors physique)

- **Caméra** : poursuite qui vise un mélange cap/vitesse : `camYaw → yaw + 0.55 * (angle de la vitesse - yaw)`, lissée (`camYaw += diff * min(1, dt*4.5)`), distance `9.5 + speed*0.025`, hauteur ~4.3. On voit ainsi l'angle du drift. FOV `68 + speed*0.35`, +12 pendant le boost, avec un léger tremblement.
- **Feedback visuel** : fumée aux roues arrière et **traces de pneus** quand `|vl| > 4.5` (ou frein à main > 8 m/s), flammes à l'arrière pendant le boost, inclinaison de la carrosserie selon `vl` et le volant, roues avant qui contre-braquent (`steer*0.5 - slip*0.6`).
- **Sons** : moteur synthétique (fréquence selon la vitesse), **crissement de pneus** dont le volume suit `|vl|`, bip au déclenchement du boost.
- **HUD** : vitesse en km/h, **jauge de boost** (se remplit en driftant, s'illumine quand elle est pleine ou active), points du drift en cours, score total.
- Pas de murs dans mon prototype : hors piste l'herbe freine (`vitesse *= exp(-0.9*dt)`) et un retour automatique au dernier checkpoint se fait au-delà de ~70 m de la piste. Adapte à mon jeu si j'ai des murs ; une collision doit alors retirer la vitesse sortante (léger rebond) et peut annuler les points du drift en cours.

## 6. Ce que j'attends de toi

1. Lis mon projet, repère où vit la voiture, l'input et la caméra.
2. Implémente la physique ci-dessus dans un module isolé (idéalement pur, sans dépendance au moteur, testable), avec toutes les valeurs dans un objet `TUNING` modifiable.
3. Branche l'input (clavier + manette), la caméra de poursuite et les effets de la section 5 (au minimum : fumée, traces, jauge de boost, crissement).
4. Teste avec un script qui simule la physique : plein braquage à 45 m/s doit donner un drift stable à ~20-25° ; frein à main + braquage doit lancer un drift à ~35° qui se stabilise vers ~20° ; sans touche boost, la jauge se remplit mais ne se vide jamais ; avec la touche boost, la vitesse monte au-delà de 54 m/s et la jauge se vide en ~2 s.
5. Ne change aucune valeur sans me le dire : si la sensation te semble mauvaise dans mon moteur (échelle différente, gravité, etc.), propose un ajustement au lieu de l'appliquer en silence.

---

## Annexe : implémentation de référence (`car.js`)

```js
// Arcade car physics, centred on drifting. Pure maths: no rendering, runs in Node too.
//
// Frame: heading `yaw`, forward = (sin yaw, cos yaw), right = (cos yaw, -sin yaw).
// Velocity is kept in world space; each step it is split into forward (vf) and lateral (vl)
// components. Lateral velocity is bled off by "grip". Grip collapses once the slide gets big
// enough (hysteresis) -> the car keeps sliding, i.e. drifts.

export const TUNING = {
  maxSpeed: 54,
  accel: 32,
  brake: 52,
  reverseMax: 12,
  rolling: 0.12,

  maxYaw: 2.3,        // rad/s at full lock
  steerIn: 7,         // steering smoothing (towards input)
  steerOut: 11,       // steering smoothing (back to centre)

  grip: 9,            // lateral damping while gripping
  driftGrip: 2.4,     // lateral damping while sliding
  handbrakeGrip: 0.9,
  slipEnter: 6.5,     // |vl| (m/s) above which the car breaks away
  slipExit: 3.2,      // |vl| below which it grips again
  driftKeep: 0.45,    // share of the lateral speed that is turned into forward speed while sliding
  alignAssist: 2.3,   // self-righting torque, keeps the drift angle controllable

  driftMinAngle: 0.2, // rad, below this a slide does not count as a drift
  driftMinSpeed: 15,
  driftFill: 4.5,     // seconds of a full-angle drift needed to fill the boost gauge
  boostDrain: 2.2,    // seconds a full gauge lasts while boosting
  boostAccel: 38,
  boostSpeed: 16,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Car {
  constructor() { this.reset(0, 0, 0); }

  reset(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.vx = 0; this.vz = 0;
    this.steer = 0;
    this.sliding = false;
    this.drifting = false;
    this.slip = 0;          // signed slip angle (rad): velocity direction relative to heading
    this.speed = 0;
    this.vf = 0; this.vl = 0;
    this.driftPoints = 0;
    this.driftEndTimer = 0;
    this.score = 0;
    this.boost = 0;         // boost gauge 0..1, filled by drifting, spent on demand
    this.boosting = false;
    this._wasBoosting = false;
    this.events = [];
  }

  update(dt, input) {
    const T = TUNING;
    const { throttle = 0, brake = 0, steer = 0, handbrake = false, boost: wantBoost = false } = input;

    // steering smoothing
    const rate = Math.abs(steer) > Math.abs(this.steer) ? T.steerIn : T.steerOut;
    this.steer += clamp(steer - this.steer, -rate * dt, rate * dt);

    // --- yaw -------------------------------------------------------------
    {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const vf = this.vx * fx + this.vz * fz;
      const vl = this.vx * rx + this.vz * rz;
      const spd = Math.hypot(this.vx, this.vz);
      const dir = vf >= -0.5 ? 1 : -1;

      let yawRate = this.steer * clamp(spd / 8, 0, 1) * dir *
        T.maxYaw * (1 - 0.4 * clamp(spd / T.maxSpeed, 0, 1));
      if (this.sliding) yawRate *= 1.3;
      if (handbrake) yawRate *= 1.5;
      if (this.sliding && spd > 6 && vf > 0) yawRate += Math.atan2(vl, vf) * T.alignAssist;
      this.yaw += yawRate * dt;
    }

    // --- velocity in the new frame ----------------------------------------
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * rx + this.vz * rz;

    // break away / regain grip
    if (handbrake && Math.hypot(vf, vl) > 10) this.sliding = true;
    else if (!this.sliding && Math.abs(vl) > T.slipEnter) this.sliding = true;
    else if (this.sliding && !handbrake && Math.abs(vl) < T.slipExit) this.sliding = false;

    // longitudinal
    const boosting = wantBoost && this.boost > 0;
    this.boosting = boosting;
    if (boosting && !this._wasBoosting) this.events.push({ type: 'boost' });
    this._wasBoosting = boosting;
    const maxSp = T.maxSpeed + (boosting ? T.boostSpeed : 0);
    let a = 0;
    if (throttle > 0) {
      a += vf < -1 ? T.brake * throttle : T.accel * throttle * (1 - clamp(vf / maxSp, 0, 1));
    }
    if (brake > 0) {
      a += vf > 1 ? -T.brake * brake : -T.accel * 0.5 * brake * (1 - clamp(-vf / T.reverseMax, 0, 1));
    }
    if (boosting) { a += T.boostAccel; this.boost = Math.max(0, this.boost - dt / T.boostDrain); }
    a -= vf * T.rolling;
    if (handbrake) a -= Math.sign(vf) * 5;
    vf += a * dt;
    if (vf > maxSp) vf -= (vf - maxSp) * Math.min(1, 3 * dt);

    // lateral grip
    const g = handbrake ? T.handbrakeGrip : this.sliding ? T.driftGrip : T.grip;
    const vlBefore = vl;
    vl *= Math.exp(-g * dt);
    if (this.sliding && !handbrake && vf > 0) vf += Math.abs(vlBefore - vl) * T.driftKeep;

    this.vx = fx * vf + rx * vl;
    this.vz = fz * vf + rz * vl;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.vf = vf; this.vl = vl;
    this.speed = Math.hypot(this.vx, this.vz);
    this.slip = vf > 0.5 ? Math.atan2(vl, vf) : 0;

    this._driftLogic(dt);
  }

  _driftLogic(dt) {
    const T = TUNING;
    const drifting = this.sliding && Math.abs(this.slip) > T.driftMinAngle && this.speed > T.driftMinSpeed;
    if (drifting) {
      this.driftEndTimer = 0;
      const a = Math.abs(this.slip);
      this.boost = Math.min(1, this.boost + dt * clamp(a / 0.5, 0.5, 1.5) / T.driftFill);
      this.driftPoints += this.speed * a * dt * 3;
    } else if (this.driftPoints > 0) {
      this.driftEndTimer += dt;
      if (this.driftEndTimer > 0.25) this._endDrift();
    }
    this.drifting = drifting;
  }

  _endDrift() {
    const pts = Math.round(this.driftPoints);
    if (pts > 0) { this.score += pts; this.events.push({ type: 'bank', pts }); }
    this.driftPoints = 0; this.driftEndTimer = 0;
  }
}
```
