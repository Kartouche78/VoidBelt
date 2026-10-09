// Banc d'essai d'un son moteur, hors du jeu : la Creation s'en sert pour
// faire entendre une recette. Repris de Skidball (`banc-moteur.js`).
//
// Une voiture simulee (vitesse de 0 a 1 de la vitesse maximale) roule sous
// l'accelerateur ; la meme boite et le meme generateur qu'en jeu
// (`moteur.js`) en tirent le son. Un compte-tours dessine le regime, le
// rapport et ce que fait le moteur (coupure, rupteur, pression turbo).

import { Boite, Moteur, rendreScenario } from './moteur.js';

/** Scenarios : une suite de `[duree (s), gaz, frein]`, en boucle ou non. */
export const SCENARIOS = {
  ralenti: { nom: 'Ralenti', etapes: [[3, 0, 1]] },
  pleine: { nom: 'Pleine charge', etapes: [[1.2, 0, 1], [9, 1, 0], [2.5, 0, 0]] },
  lever: { nom: 'Lever de pied', etapes: [[3.5, 1, 0], [3, 0, 0]] },
  rupteur: { nom: 'Rupteur', etapes: [[1, 0, 1], [3.5, 1, 0, true], [1.5, 0, 0, true]] },
  tour: { nom: 'Tour de piste', etapes: [[1.5, 0, 1], [5, 1, 0], [1.2, 0, 0], [0.8, 0, 0.6], [3, 1, 0], [1.5, 0.35, 0], [1.6, 0, 0], [2.5, 0, 1]], boucle: true },
};

/** Voiture simulee du banc : elle accelere de moins en moins pres de sa
 *  vitesse maximale, perd un peu en roue libre, et freine fort. Rend
 *  l'etat de la boite apres un pas. */
function avancer(sim, moteur, e, dt) {
  const coupe = sim.etat?.coupure && e.gaz > 0.1;
  const acc = coupe ? 0 : e.gaz * 0.3 * Math.pow(Math.max(0, 1 - sim.v), 0.7);
  sim.v += (acc - 0.035 * sim.v - e.frein * 0.45) * dt;
  sim.v = Math.max(0, Math.min(1, sim.v));
  // Rupteur : on tient le premier rapport, la voiture ne va pas plus vite.
  if (e.bloque && moteur?.boite) {
    moteur.boite.rapport = 1;
    sim.v = Math.min(sim.v, 0.2);
  }
  sim.etat = moteur?.maj({ vitesse: sim.v, gaz: e.gaz, glisse: 0 }, dt) ?? null;
  if (sim.etat) sim.etat.gaz = e.gaz;
  return sim.etat;
}

/** Etape d'un scenario a l'instant `t` (secondes). */
function etapeA(scenario, t) {
  const total = scenario.etapes.reduce((a, e) => a + e[0], 0);
  if (t >= total) {
    if (!scenario.boucle) return { gaz: 0, frein: 1, bloque: false, fini: true };
    t %= total;
  }
  for (const [duree, g, f, bloque] of scenario.etapes) {
    if (t < duree) return { gaz: g, frein: f, bloque: !!bloque };
    t -= duree;
  }
  return { gaz: 0, frein: 1, bloque: false };
}

/** Rend un scenario hors ligne (sans haut-parleur), plus vite que le temps
 *  reel : `AudioBuffer` stereo. Sert au telechargement d'un son, et aux
 *  essais automatiques. */
export async function rendreHorsLigne(recette, nom = 'tour', duree = null, version = 'v2') {
  const scenario = SCENARIOS[nom] ?? SCENARIOS.tour;
  const total = duree ?? scenario.etapes.reduce((a, e) => a + e[0], 0);
  const pas = 1 / 60;
  // Le scenario est ecrit d'avance, image par image, comme dans le jeu ;
  // le generateur le recoit d'un bloc (voir `rendreScenario`).
  const etats = [];
  let t = 0;
  const enregistreur = {
    boite: new Boite(recette),
    maj(entree, dt) {
      const e = this.boite.maj(entree, Math.min(dt, 0.1));
      etats.push({ t, rpm: e.rpm, charge: e.charge, coupure: e.coupure, lever: e.lever, gaz: entree.gaz ?? 0 });
      return e;
    },
  };
  const sim = { v: 0, etat: null };
  for (let k = 0; k * pas < total; k += 1) {
    t = k * pas;
    avancer(sim, enregistreur, etapeA(scenario, t), pas);
  }
  return rendreScenario(recette, etats, total, 48000, { version });
}

/** WAV 16 bits d'un `AudioBuffer`, pour le telechargement. */
export function enWav(buffer) {
  const n = buffer.length;
  const canaux = buffer.numberOfChannels;
  const octets = 44 + n * canaux * 2;
  const vue = new DataView(new ArrayBuffer(octets));
  const ecrire = (o, s) => [...s].forEach((c, i) => vue.setUint8(o + i, c.charCodeAt(0)));
  ecrire(0, 'RIFF');
  vue.setUint32(4, octets - 8, true);
  ecrire(8, 'WAVEfmt ');
  vue.setUint32(16, 16, true);
  vue.setUint16(20, 1, true);
  vue.setUint16(22, canaux, true);
  vue.setUint32(24, buffer.sampleRate, true);
  vue.setUint32(28, buffer.sampleRate * canaux * 2, true);
  vue.setUint16(32, canaux * 2, true);
  vue.setUint16(34, 16, true);
  ecrire(36, 'data');
  vue.setUint32(40, n * canaux * 2, true);
  const donnees = [...Array(canaux)].map((_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < canaux; c += 1) {
      vue.setInt16(o, Math.max(-1, Math.min(1, donnees[c][i])) * 32767, true);
      o += 2;
    }
  }
  return vue.buffer;
}

/** Banc dans le canevas `toile` (le compte-tours). Le son ne demarre qu'a
 *  la premiere action : le navigateur exige un geste. */
export function creerBanc(toile) {
  let ctx = null;
  let sortie = null;
  let moteur = null;
  let recette = null;
  const sim = { v: 0, etat: null };
  let gazManuel = null;
  let scenario = null;
  let tempsScenario = 0;
  let anim = 0;
  let avant = 0;

  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      sortie = ctx.createGain();
      sortie.gain.value = 0.9;
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -2;
      lim.ratio.value = 12;
      sortie.connect(lim).connect(ctx.destination);
      moteur = new Moteur(ctx, sortie);
      if (recette) moteur.configurer(recette);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function poser(r) {
    recette = r;
    moteur?.configurer(r);
    dessiner();
  }

  /** Lance un scenario (`SCENARIOS`) ; `null` rend la main a l'accelerateur. */
  function jouer(nom) {
    audio();
    scenario = SCENARIOS[nom] ?? null;
    tempsScenario = 0;
    gazManuel = scenario ? null : (gazManuel ?? 0);
    boucle();
  }

  /** Accelerateur tenu a la main, de 0 a 1 (le scenario s'arrete). */
  function gaz(valeur) {
    audio();
    scenario = null;
    gazManuel = valeur;
    boucle();
  }

  function pas(dt) {
    const e = scenario ? etapeA(scenario, tempsScenario) : { gaz: gazManuel ?? 0, frein: 0, bloque: false };
    if (scenario) tempsScenario += dt;
    avancer(sim, moteur, e, dt);
  }

  function boucle() {
    cancelAnimationFrame(anim);
    avant = performance.now();
    const image = (t) => {
      if (!toile.isConnected) {
        arreter();
        return;
      }
      const dt = Math.min(0.05, (t - avant) / 1000);
      avant = t;
      pas(dt);
      dessiner();
      anim = requestAnimationFrame(image);
    };
    anim = requestAnimationFrame(image);
  }

  function arreter() {
    cancelAnimationFrame(anim);
    moteur?.couper();
    scenario = null;
    gazManuel = null;
    sim.v = 0;
    sim.etat = null;
    dessiner();
  }

  function dessiner() {
    const g = toile.getContext('2d');
    const w = toile.clientWidth || toile.width;
    const h = toile.clientHeight || toile.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (toile.width !== Math.round(w * dpr)) {
      toile.width = Math.round(w * dpr);
      toile.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!recette) return;
    const zr = recette.zoneRouge;
    const max = Math.ceil((zr * 1.1) / 1000) * 1000;
    const cx = w / 2;
    const cy = h * 0.56;
    const R = Math.min(w, h) * 0.42;
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    const angle = (rpm) => a0 + (a1 - a0) * Math.min(1, rpm / max);
    g.lineCap = 'round';
    // Cadran et zone rouge.
    g.lineWidth = R * 0.09;
    g.strokeStyle = '#ffffff18';
    g.beginPath();
    g.arc(cx, cy, R, a0, a1);
    g.stroke();
    g.strokeStyle = '#ff3d3d';
    g.beginPath();
    g.arc(cx, cy, R, angle(zr), a1);
    g.stroke();
    // Graduations, tous les mille tours.
    g.fillStyle = '#c9c1dd';
    g.font = `${Math.round(R * 0.11)}px Space Mono, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Une graduation tous les mille tours, tous les deux mille sur un moteur
    // qui monte tres haut (une F1), pour que les chiffres restent lisibles.
    const pasGrad = max > 12000 ? 2000 : 1000;
    for (let k = 0; k <= max; k += pasGrad) {
      const a = angle(k);
      g.strokeStyle = k >= zr ? '#ff6b6b' : '#ffffff66';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8);
      g.lineTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9);
      g.stroke();
      g.fillText(String(k / 1000), cx + Math.cos(a) * R * 0.66, cy + Math.sin(a) * R * 0.66);
    }
    // Aiguille.
    const etat = sim.etat;
    const rpm = etat?.rpm ?? 0;
    const a = angle(rpm);
    g.strokeStyle = '#f07a25';
    g.lineWidth = R * 0.035;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92);
    g.stroke();
    g.fillStyle = '#f07a25';
    g.beginPath();
    g.arc(cx, cy, R * 0.07, 0, Math.PI * 2);
    g.fill();
    // Rapport, regime, et ce que fait le moteur.
    g.fillStyle = '#fff';
    g.font = `italic 800 ${Math.round(R * 0.32)}px 'Exo 2', sans-serif`;
    g.fillText(etat ? String(etat.rapport) : '–', cx, cy + R * 0.42);
    g.font = `${Math.round(R * 0.1)}px Space Mono, monospace`;
    g.fillStyle = '#c9c1dd';
    g.fillText(`${Math.round(rpm / 10) * 10} tr/min`, cx, cy + R * 0.66);
    const marques = [];
    if (etat?.coupure && etat?.lever) marques.push('FREIN MOTEUR');
    else if (etat?.coupure && rpm > zr * 0.97) marques.push('RUPTEUR');
    else if (etat?.coupure) marques.push('PASSAGE');
    if (recette.turbo > 0 && etat?.gaz > 0.3) marques.push('TURBO');
    g.fillStyle = '#ffb36b';
    g.font = `700 ${Math.round(R * 0.085)}px Space Mono, monospace`;
    g.fillText(marques.join(' · '), cx, cy - R * 0.32);
    // Vitesse de la voiture simulee.
    g.fillStyle = '#ffffff22';
    g.fillRect(w * 0.15, h - 14, w * 0.7, 5);
    g.fillStyle = '#8b5cf6';
    g.fillRect(w * 0.15, h - 14, w * 0.7 * sim.v, 5);
  }

  return { poser, jouer, gaz, arreter, dessiner, get etat() { return sim.etat; } };
}
