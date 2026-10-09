// Diagnostic de conduite (F3, ou Parametres > Conduite) : ce que le moteur
// Rust calcule, lu dans le tampon d'etat. Rien n'est recalcule ici.

import { S, CAMERAS } from './moteur.js';

const SOLS = ['asphalte', 'terre', 'herbe', 'glace', 'plastique'];
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const signe = (v, d = 1) => `${v >= 0 ? '+' : ''}${f(v, d)}`;

export class Diagnostic {
  constructor() {
    this.el = document.createElement('pre');
    this.el.id = 'diagnostic';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.attente = 0;
  }

  montrer(oui) {
    this.el.hidden = !oui;
  }

  /** Une image ; le texte est rafraichi dix fois par seconde. */
  update(st, dt) {
    if (this.el.hidden) return;
    this.attente -= dt;
    if (this.attente > 0) return;
    this.attente = 0.1;
    const sol = st[S.CONTACT] > 0.5;
    const cam = CAMERAS[st[S.CAM_MODE]]?.[1] ?? '?';
    this.el.textContent = [
      'DIAGNOSTIC (F3)',
      `vitesse      ${f(st[S.SPEED] * 3.6, 0)} km/h  (${f(st[S.SPEED])} m/s)`,
      `accel        ${signe(st[S.ACCEL])} m/s²`,
      `laterale     ${signe(st[S.VL])} m/s   glisse ${signe(st[S.SLIP] * 57.2958)}°`,
      `rotation     ${signe(st[S.YAW_RATE], 2)} rad/s`,
      `contact      ${sol ? 'au sol' : `en vol ${f(st[S.AIR_T], 2)} s`}  ${SOLS[st[S.SURFACE]] ?? ''}`,
      `normale      ${f(st[S.NORMAL], 2)} ${f(st[S.NORMAL + 1], 2)} ${f(st[S.NORMAL + 2], 2)}`,
      `rapport      ${st[S.GEAR]}  ${f(st[S.RPM], 0)} tr/min`,
      `penalite     ${f(st[S.PENALITE] * 100, 0)} %`,
      'forces (m/s²)',
      `  propulsion ${signe(st[S.F_PROP])}   freins ${signe(st[S.F_FREIN])}`,
      `  laterale   ${signe(st[S.F_LAT])}   gravite ${signe(st[S.F_GRAV])}`,
      `  speedslide ${signe(st[S.F_SS], 2)}`,
      `camera       ${cam}  FOV ${f(st[S.FOV], 0)}°  ${f(st[S.CAM_DIST])} m`,
    ].join('\n');
  }
}
