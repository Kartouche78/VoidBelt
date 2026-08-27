/* ============================================================
   VOIDBELT // VELOCITY
   ------------------------------------------------------------
   Course anti-gravite dans la ceinture du Vide. Aucun sol,
   aucun horizon : un ruban d'energie ferme sur lui-meme,
   suspendu au milieu des asteroides, sous une geante gazeuse.

   Le fichier se lit de haut en bas :
     1. rendu et post-traitement
     2. textures fabriquees a la volee (aucun fichier image)
     3. le vide : etoiles, nebuleuses, soleil, planetes, ceinture
     4. le circuit : courbe fermee, devers, tablier, portiques
     5. le vaisseau
     6. la conduite (position sur le ruban + ecart lateral)
     7. cameras
     8. interface, chronos, classement
   ============================================================ */

import * as THREE from "three";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/* ============================================================
   1. RENDU
   ============================================================ */

const canvas = $("race");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05060f, 0.00026);

const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.4, 26000);
camera.position.set(0, 40, 0);

/* Le halo (bloom) est ce qui donne au neon son epaisseur. Il arrive par
   un import optionnel : si le reseau le refuse, on rend en direct. */
let composer = null, bloom = null;
try {
  const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
    import("three/addons/postprocessing/EffectComposer.js"),
    import("three/addons/postprocessing/RenderPass.js"),
    import("three/addons/postprocessing/UnrealBloomPass.js"),
    import("three/addons/postprocessing/OutputPass.js")
  ]);
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.55, 0.72);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.setSize(innerWidth, innerHeight);
} catch (e) {
  console.info("Velocity : rendu sans halo.", e);
}

/* ============================================================
   2. TEXTURES FABRIQUEES
   ============================================================ */

function paint(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* point lumineux, pour les etoiles et les poussieres */
const SPARK = paint(64, 64, (g, w) => {
  const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  r.addColorStop(0, "#fff"); r.addColorStop(.28, "rgba(255,255,255,.75)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, w, w);
});

/* voile de nebuleuse : plusieurs bulles molles superposees */
function cloud(r, gg, b) {
  return paint(256, 256, (g, w) => {
    g.clearRect(0, 0, w, w);
    for (let i = 0; i < 7; i++) {
      const x = w / 2 + (Math.random() - .5) * w * .42;
      const y = w / 2 + (Math.random() - .5) * w * .42;
      const rad = w * (.16 + Math.random() * .3);
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, `rgba(${r},${gg},${b},.24)`);
      grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grd; g.fillRect(0, 0, w, w);
    }
  });
}

/* revetement du tablier : u traverse la largeur, v file le long du ruban */
function deckSkin(glow) {
  return paint(256, 256, (g, w, h) => {
    const on = (c) => (glow ? c : c);
    g.fillStyle = glow ? "#01020a" : "#232a37";
    g.fillRect(0, 0, w, h);

    if (!glow) {
      /* panneaux et rivets */
      for (let y = 0; y < h; y += 32) {
        g.fillStyle = y % 64 ? "#262e3c" : "#1d2430";
        g.fillRect(0, y, w, 30);
      }
      g.fillStyle = "rgba(237,231,218,.10)";
      for (let y = 0; y < h; y += 32) g.fillRect(0, y + 30, w, 2);
      for (let i = 0; i < 320; i++) {
        g.fillStyle = `rgba(237,231,218,${Math.random() * .07})`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      /* bandes de guidage */
      g.fillStyle = "rgba(237,231,218,.16)";
      g.fillRect(38, 0, 3, h); g.fillRect(w - 41, 0, 3, h);
    }

    /* lisieres lumineuses : cyan a gauche, orange a droite */
    g.fillStyle = on("#5FEBF7"); g.fillRect(0, 0, 15, h);
    g.fillStyle = on("#FF4D00"); g.fillRect(w - 15, 0, 15, h);

    /* axe central en pointilles */
    g.fillStyle = on("#EDE7DA");
    for (let y = 0; y < h; y += 96) g.fillRect(w / 2 - 4, y, 8, 52);

    /* chevrons pales de part et d'autre de l'axe */
    g.strokeStyle = on(glow ? "#22384a" : "rgba(95,235,247,.22)");
    g.lineWidth = 3;
    for (let y = 0; y < h; y += 64) {
      g.beginPath();
      g.moveTo(w * .30, y + 40); g.lineTo(w * .5, y + 8); g.lineTo(w * .70, y + 40);
      g.stroke();
    }
  });
}

/* plaque de surtension : chevrons oranges */
const PAD = paint(128, 256, (g, w, h) => {
  g.fillStyle = "#160800"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#FF4D00";
  for (let y = -40; y < h; y += 56) {
    g.beginPath();
    g.moveTo(6, y + 44); g.lineTo(w / 2, y); g.lineTo(w - 6, y + 44);
    g.lineTo(w - 6, y + 66); g.lineTo(w / 2, y + 22); g.lineTo(6, y + 66);
    g.closePath(); g.fill();
  }
});

/* damier de la ligne de depart */
const GRID = paint(256, 32, (g, w, h) => {
  for (let x = 0; x < w; x += 16)
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = ((x / 16 + y / 16) % 2) ? "#EDE7DA" : "#111318";
      g.fillRect(x, y, 16, 16);
    }
});

/* geante gazeuse : bandes horizontales et une tempete */
const GIANT = paint(1024, 512, (g, w, h) => {
  const band = ["#c2551f", "#8f3a16", "#e08a49", "#6d2c12", "#d9a069", "#a34a1d", "#f0c199", "#7b3314"];
  let y = 0;
  while (y < h) {
    const t = 8 + Math.random() * 46;
    g.fillStyle = band[(Math.random() * band.length) | 0];
    g.fillRect(0, y, w, t);
    y += t;
  }
  /* on adoucit les jointures */
  g.globalAlpha = .35;
  for (let i = 0; i < 220; i++) {
    g.fillStyle = band[(Math.random() * band.length) | 0];
    g.beginPath();
    g.ellipse(Math.random() * w, Math.random() * h, 40 + Math.random() * 180, 4 + Math.random() * 12, 0, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  g.fillStyle = "#efd0a8";
  g.beginPath(); g.ellipse(w * .68, h * .62, 96, 42, 0, 0, TAU); g.fill();
  g.fillStyle = "#b9642c";
  g.beginPath(); g.ellipse(w * .68, h * .62, 62, 24, 0, 0, TAU); g.fill();
});

/* lune de glace */
const MOON = paint(512, 256, (g, w, h) => {
  g.fillStyle = "#8fa9b4"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 340; i++) {
    const r = 3 + Math.random() * 24;
    g.fillStyle = `rgba(${Math.random() < .5 ? "58,78,90" : "190,214,222"},${.1 + Math.random() * .35})`;
    g.beginPath(); g.arc(Math.random() * w, Math.random() * h, r, 0, TAU); g.fill();
  }
  g.strokeStyle = "rgba(95,235,247,.35)"; g.lineWidth = 2;
  for (let i = 0; i < 16; i++) {
    g.beginPath();
    g.moveTo(Math.random() * w, Math.random() * h);
    g.lineTo(Math.random() * w, Math.random() * h);
    g.stroke();
  }
});

/* anneau de la geante */
const RING = paint(512, 32, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  for (let x = 0; x < w; x++) {
    const a = Math.random() < .12 ? 0 : .18 + Math.abs(Math.sin(x * .11)) * .5 * Math.random();
    g.fillStyle = `rgba(${210 + Math.random() * 40 | 0},${150 + Math.random() * 60 | 0},${110 + Math.random() * 50 | 0},${a})`;
    g.fillRect(x, 0, 1, h);
  }
});

/* ============================================================
   3. LE VIDE
   ============================================================ */

/* --- fond : degrade sombre plus quelques voiles diffus --- */
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    hi: { value: new THREE.Color(0x05060f) },
    lo: { value: new THREE.Color(0x0b0714) },
    warm: { value: new THREE.Color(0x1d0c08) },
    cool: { value: new THREE.Color(0x061620) }
  },
  vertexShader: `varying vec3 vD; void main(){ vD = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `
    uniform vec3 hi, lo, warm, cool; varying vec3 vD;
    float band(vec3 d, vec3 axis, float w){ return exp(-pow(dot(d,normalize(axis)),2.)/w); }
    void main(){
      vec3 d = normalize(vD);
      vec3 c = mix(lo, hi, smoothstep(-.8, .8, d.y));
      c += warm * band(d, vec3(1., .25, .55), .18) * 1.5;
      c += cool * band(d, vec3(-.7, -.1, .6), .22) * 1.3;
      c += vec3(.035,.03,.06) * band(d, vec3(.1, 1., .2), .55);
      gl_FragColor = vec4(c, 1.);
    }`
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(19000, 32, 20), skyMat));

/* --- etoiles : deux couches, la plus proche un peu plus grosse --- */
function starLayer(count, radius, size, spread) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const tint = [
    [1, 1, 1], [.93, .91, .85], [.62, .92, .97], [1, .74, .5], [.8, .84, 1]
  ];
  for (let i = 0; i < count; i++) {
    const u = Math.random() * TAU, v = Math.acos(2 * Math.random() - 1);
    const r = radius * (1 + (Math.random() - .5) * spread);
    pos[i * 3] = Math.sin(v) * Math.cos(u) * r;
    pos[i * 3 + 1] = Math.cos(v) * r;
    pos[i * 3 + 2] = Math.sin(v) * Math.sin(u) * r;
    const t = tint[(Math.random() * tint.length) | 0], b = .45 + Math.random() * .55;
    col[i * 3] = t[0] * b; col[i * 3 + 1] = t[1] * b; col[i * 3 + 2] = t[2] * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size, map: SPARK, vertexColors: true, transparent: true, depthWrite: false,
    sizeAttenuation: false, blending: THREE.AdditiveBlending, fog: false
  }));
  pts.frustumCulled = false;
  scene.add(pts);
  return pts;
}
starLayer(7000, 15000, 1.9, .3);
starLayer(900, 12000, 4.2, .35);

/* --- nebuleuses --- */
[[255, 77, 0, 8200, -5200, 3400, 7000],
 [95, 235, 247, -7600, 2600, -6200, 8200],
 [140, 60, 200, -2400, -6400, 8600, 6400],
 [255, 150, 60, 4200, 6200, -8400, 5600]].forEach(([r, g, b, x, y, z, s]) => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: cloud(r, g, b), color: 0xffffff, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: .85, fog: false
  }));
  sp.position.set(x, y, z); sp.scale.set(s, s, 1);
  scene.add(sp);
});

/* --- soleil lointain et lumieres --- */
const SUN_DIR = new THREE.Vector3(-.42, .52, -.74).normalize();
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: SPARK, color: 0xfff0d2, transparent: true, blending: THREE.AdditiveBlending,
  depthWrite: false, fog: false
}));
sunSprite.position.copy(SUN_DIR).multiplyScalar(13500);
sunSprite.scale.set(3200, 3200, 1);
scene.add(sunSprite);

const sun = new THREE.DirectionalLight(0xffe9cc, 2.9);
sun.position.copy(SUN_DIR).multiplyScalar(1000);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x2a3550, 0x0a0710, 1.05));
const rim = new THREE.DirectionalLight(0x5febf7, .95);
rim.position.set(600, -260, 700);
scene.add(rim);
scene.add(new THREE.AmbientLight(0x2c3550, .42));

/* Un environnement, meme sommaire, evite que les metaux rendent noirs :
   sans reflet a capter, le tablier et la coque disparaissent. */
{
  const env = paint(512, 256, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#1a2338"); sky.addColorStop(.5, "#0a0d18"); sky.addColorStop(1, "#120a12");
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const hot = g.createRadialGradient(w * .32, h * .3, 0, w * .32, h * .3, w * .22);
    hot.addColorStop(0, "#fff4dd"); hot.addColorStop(.25, "#6a5540"); hot.addColorStop(1, "transparent");
    g.fillStyle = hot; g.fillRect(0, 0, w, h);
    const cool = g.createRadialGradient(w * .78, h * .62, 0, w * .78, h * .62, w * .3);
    cool.addColorStop(0, "#2a5f74"); cool.addColorStop(1, "transparent");
    g.fillStyle = cool; g.fillRect(0, 0, w, h);
  });
  env.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(env).texture;
  scene.environmentIntensity = .55;
  pmrem.dispose();
  env.dispose();
}

/* --- geante gazeuse, son anneau, et deux lunes --- */
const giant = new THREE.Mesh(
  new THREE.SphereGeometry(2600, 64, 40),
  new THREE.MeshStandardMaterial({ map: GIANT, roughness: 1, metalness: 0, fog: false })
);
giant.position.set(-6200, 1500, -11000);
scene.add(giant);

const ringGeo = new THREE.RingGeometry(3500, 5600, 160, 4);
{ /* les UV natives d'un anneau ne sont pas radiales : on les refait */
  const p = ringGeo.attributes.position, uv = ringGeo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), r = Math.hypot(x, y);
    uv.setXY(i, (Math.atan2(y, x) / TAU + .5) * 6, (r - 3500) / 2100);
  }
  uv.needsUpdate = true;
}
RING.wrapS = THREE.RepeatWrapping;
const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
  map: RING, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false, opacity: .9
}));
ring.position.copy(giant.position);
ring.rotation.set(-Math.PI / 2 + .34, 0, .18);
scene.add(ring);

const iceMoon = new THREE.Mesh(
  new THREE.SphereGeometry(760, 48, 32),
  new THREE.MeshStandardMaterial({ map: MOON, roughness: .92, metalness: .05, fog: false })
);
iceMoon.position.set(7200, 2400, -6400);
scene.add(iceMoon);

const redMoon = new THREE.Mesh(
  new THREE.SphereGeometry(340, 32, 24),
  new THREE.MeshStandardMaterial({ color: 0x54291c, roughness: 1, flatShading: true, fog: false })
);
redMoon.position.set(-3200, -1800, 5200);
scene.add(redMoon);

/* ============================================================
   4. LE CIRCUIT
   ------------------------------------------------------------
   Une boucle fermee qui monte, plonge et se devers dans les
   virages. Tout le jeu se lit ensuite dans deux nombres :
   la distance parcourue le long du ruban, et l'ecart lateral.
   ============================================================ */

const HALF = 17;        /* demi-largeur du tablier, en metres */
const THICK = 2.6;      /* epaisseur du caisson sous le tablier */
const RIDE = 1.35;      /* hauteur de sustentation du vaisseau */
const DIV = 1200;       /* nombre d'echantillons le long de la boucle */

const control = [];
for (let i = 0; i < 18; i++) {
  const a = (i / 18) * TAU;
  const r = 640 + Math.sin(a * 3 + .4) * 155 + Math.cos(a * 2 - .8) * 92;
  control.push(new THREE.Vector3(
    Math.cos(a) * r,
    Math.sin(a * 2.3) * 105 + Math.sin(a * 1.4 + 2) * 62,
    Math.sin(a) * r
  ));
}
const curve = new THREE.CatmullRomCurve3(control, true, "catmullrom", .5);
const LEN = curve.getLength();
const DS = LEN / DIV;

const P = [], T = [], U = [], SD = [];
const K = new Float32Array(DIV);
const BANK = new Float32Array(DIV);

for (let i = 0; i < DIV; i++) {
  P.push(curve.getPointAt(i / DIV));
  T.push(curve.getTangentAt(i / DIV).normalize());
}
/* courbure signee : positive quand le ruban tourne a gauche */
const tmp = new THREE.Vector3();
for (let i = 0; i < DIV; i++) {
  tmp.crossVectors(T[i], T[(i + 1) % DIV]);
  K[i] = tmp.dot(WORLD_UP) / DS;
}
function smooth(arr, radius, passes) {
  const n = arr.length, out = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let d = -radius; d <= radius; d++) s += arr[(i + d + n * 2) % n];
      out[i] = s / (radius * 2 + 1);
    }
    arr.set(out);
  }
}
smooth(K, 6, 2);
for (let i = 0; i < DIV; i++) BANK[i] = clamp(-K[i] * 128, -.68, .68);
smooth(BANK, 5, 2);

for (let i = 0; i < DIV; i++) {
  /* verticale redressee perpendiculairement au ruban, puis inclinee */
  const up = WORLD_UP.clone().addScaledVector(T[i], -WORLD_UP.dot(T[i])).normalize();
  up.applyAxisAngle(T[i], BANK[i]).normalize();
  U.push(up);
  SD.push(new THREE.Vector3().crossVectors(T[i], up).normalize()); /* la droite */
}

/* lecture continue : un point quelconque du ruban, interpole */
const frame = { p: new THREE.Vector3(), t: new THREE.Vector3(), u: new THREE.Vector3(), s: new THREE.Vector3(), k: 0, bank: 0 };
function frameAt(dist) {
  const f = ((dist / DS) % DIV + DIV) % DIV;
  const i = Math.floor(f), j = (i + 1) % DIV, a = f - i;
  frame.p.copy(P[i]).lerp(P[j], a);
  frame.t.copy(T[i]).lerp(T[j], a).normalize();
  frame.u.copy(U[i]).lerp(U[j], a).normalize();
  frame.s.crossVectors(frame.t, frame.u).normalize();
  frame.k = K[i] * (1 - a) + K[j] * a;
  frame.bank = BANK[i] * (1 - a) + BANK[j] * a;
  return frame;
}

/* --- tablier : un ruban texture, legerement au-dessus du caisson --- */
{
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= DIV; i++) {
    const m = i % DIV, v = (i * DS) / 46;
    for (const side of [-1, 1]) {
      const q = P[m].clone().addScaledVector(SD[m], side * HALF).addScaledVector(U[m], .07);
      pos.push(q.x, q.y, q.z);
      uv.push((side + 1) / 2, v);
    }
    if (i < DIV) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const skin = deckSkin(false), glow = deckSkin(true);
  for (const t of [skin, glow]) { t.wrapT = THREE.RepeatWrapping; t.wrapS = THREE.ClampToEdgeWrapping; }
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: skin, emissiveMap: glow, emissive: 0xffffff, emissiveIntensity: 1.25,
    roughness: .58, metalness: .22
  })));
}

/* --- caisson : la tranche visible du ruban, vu de cote ou de dessous --- */
{
  const section = [[-HALF, 0], [HALF, 0], [HALF - 2.4, -THICK], [-HALF + 2.4, -THICK]];
  const pos = [], idx = [];
  for (let i = 0; i <= DIV; i++) {
    const m = i % DIV;
    for (const [sx, sy] of section) {
      const q = P[m].clone().addScaledVector(SD[m], sx).addScaledVector(U[m], sy);
      pos.push(q.x, q.y, q.z);
    }
    if (i < DIV) {
      const a = i * 4, b = (i + 1) * 4;
      for (let c = 0; c < 4; c++) {
        const c2 = (c + 1) % 4;
        idx.push(a + c, a + c2, b + c, a + c2, b + c2, b + c);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x1a1e28, roughness: .5, metalness: .65, flatShading: true
  })));
}

/* --- lisieres : deux tubes de lumiere continus --- */
for (const side of [-1, 1]) {
  const pts = [];
  for (let i = 0; i < DIV; i += 4) {
    pts.push(P[i].clone().addScaledVector(SD[i], side * (HALF - .5)).addScaledVector(U[i], .45));
  }
  const edge = new THREE.CatmullRomCurve3(pts, true, "catmullrom", .5);
  scene.add(new THREE.Mesh(
    new THREE.TubeGeometry(edge, DIV, .3, 6, true),
    new THREE.MeshBasicMaterial({ color: side < 0 ? 0x5febf7 : 0xff4d00, fog: false })
  ));
}

/* --- lames lumineuses le long des bords : elles donnent la vitesse --- */
{
  const step = 9, count = Math.floor(DIV / step);
  const geo = new THREE.BoxGeometry(.26, 2.9, 1.1);
  const dummy = new THREE.Object3D();
  for (const side of [-1, 1]) {
    const mesh = new THREE.InstancedMesh(geo,
      new THREE.MeshBasicMaterial({ color: side < 0 ? 0x2fd0e6 : 0xff5f1a, fog: false }), count);
    for (let n = 0; n < count; n++) {
      const i = n * step;
      dummy.position.copy(P[i]).addScaledVector(SD[i], side * (HALF + .9)).addScaledVector(U[i], 1.2);
      dummy.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(SD[i], U[i], T[i]));
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }
}

/* --- portiques : des arches sombres a franchir --- */
{
  const step = 42, count = Math.floor(DIV / step);
  const dummy = new THREE.Object3D();
  const metal = new THREE.MeshStandardMaterial({ color: 0x171a22, roughness: .4, metalness: .9, flatShading: true });
  const neon = new THREE.MeshBasicMaterial({ color: 0xedE7da, fog: false });

  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 15, 1.3), metal, count * 2);
  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(HALF * 2 + 8, 1.5, 2.1), metal, count);
  const strip = new THREE.InstancedMesh(new THREE.BoxGeometry(HALF * 2 + 5, .28, .5), neon, count);

  for (let n = 0; n < count; n++) {
    const i = n * step;
    const basis = new THREE.Matrix4().makeBasis(SD[i], U[i], T[i]);
    for (const side of [-1, 1]) {
      dummy.position.copy(P[i]).addScaledVector(SD[i], side * (HALF + 3.2)).addScaledVector(U[i], 6.6);
      dummy.quaternion.setFromRotationMatrix(basis);
      dummy.updateMatrix();
      posts.setMatrixAt(n * 2 + (side < 0 ? 0 : 1), dummy.matrix);
    }
    dummy.position.copy(P[i]).addScaledVector(U[i], 14.2);
    dummy.quaternion.setFromRotationMatrix(basis);
    dummy.updateMatrix(); beams.setMatrixAt(n, dummy.matrix);

    dummy.position.copy(P[i]).addScaledVector(U[i], 13.1);
    dummy.updateMatrix(); strip.setMatrixAt(n, dummy.matrix);
  }
  [posts, beams, strip].forEach((m) => { m.instanceMatrix.needsUpdate = true; scene.add(m); });
}

/* --- plaques de surtension --- */
const PADS = [];
{
  const geo = new THREE.PlaneGeometry(HALF * .85, 30);
  const mat = new THREE.MeshBasicMaterial({ map: PAD, fog: false, transparent: true, opacity: .95 });
  for (let n = 0; n < 9; n++) {
    const i = Math.floor((n / 9) * DIV + 62) % DIV;
    const lane = n % 3 === 0 ? 0 : n % 3 === 1 ? -HALF * .48 : HALF * .48;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(P[i]).addScaledVector(SD[i], lane).addScaledVector(U[i], .16);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(SD[i], U[i], T[i]));
    mesh.rotateX(-Math.PI / 2);
    scene.add(mesh);
    PADS.push({ s: i * DS, x: lane, half: HALF * .43, cool: 0 });
  }
}

/* --- portes de secteur et ligne de depart --- */
const SECTORS = 3;
const GATE_S = [];
{
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x5febf7, fog: false });
  for (let n = 1; n < SECTORS; n++) {
    const i = Math.floor((n / SECTORS) * DIV);
    GATE_S.push(i * DS);
    const g = new THREE.Mesh(new THREE.TorusGeometry(HALF + 6, .55, 8, 56), ringMat);
    g.position.copy(P[i]).addScaledVector(U[i], 2.4);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(SD[i], U[i], T[i]));
    scene.add(g);
  }

  /* depart / arrivee : anneau clair, damier au sol, deux mats */
  const i = 0;
  const basis = new THREE.Matrix4().makeBasis(SD[i], U[i], T[i]);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(HALF + 7, .9, 10, 64),
    new THREE.MeshBasicMaterial({ color: 0xff4d00, fog: false }));
  arch.position.copy(P[i]).addScaledVector(U[i], 2.4);
  arch.quaternion.setFromRotationMatrix(basis);
  scene.add(arch);

  GRID.wrapS = THREE.RepeatWrapping; GRID.repeat.set(10, 1);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, 4),
    new THREE.MeshBasicMaterial({ map: GRID, fog: false }));
  line.position.copy(P[i]).addScaledVector(U[i], .18);
  line.quaternion.setFromRotationMatrix(basis);
  line.rotateX(-Math.PI / 2);
  scene.add(line);
}

/* ============================================================
   CEINTURE D'ASTEROIDES
   Ils tournent lentement sur eux-memes, jamais sur le ruban.
   ============================================================ */

const BELT_MAX = 1500;
let belt = null, beltData = null;
{
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x5b5045, roughness: .96, metalness: .08, flatShading: true });
  belt = new THREE.InstancedMesh(geo, mat, BELT_MAX);
  belt.frustumCulled = false;
  beltData = new Array(BELT_MAX);

  const dummy = new THREE.Object3D();
  for (let n = 0; n < BELT_MAX; n++) {
    /* on place autour de la boucle, mais toujours loin du tablier */
    let p, tries = 0;
    do {
      const i = (Math.random() * DIV) | 0;
      const away = (Math.random() < .5 ? -1 : 1) * (155 + Math.pow(Math.random(), .7) * 980);
      p = P[i].clone()
        .addScaledVector(SD[i], away)
        .addScaledVector(U[i], (Math.random() - .42) * 460)
        .addScaledVector(T[i], (Math.random() - .5) * 240);
      tries++;
    } while (tries < 4 && p.distanceTo(P[0]) < 90);

    const scale = 2 + Math.pow(Math.random(), 2.6) * 46;
    beltData[n] = {
      p, scale,
      rot: new THREE.Euler(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU),
      spin: (Math.random() - .5) * .22,
      wob: (Math.random() - .5) * .16,
      squash: .5 + Math.random() * .9
    };
    dummy.position.copy(p);
    dummy.rotation.copy(beltData[n].rot);
    dummy.scale.set(scale, scale * beltData[n].squash, scale * (.7 + Math.random() * .6));
    dummy.updateMatrix();
    belt.setMatrixAt(n, dummy.matrix);
  }
  belt.instanceMatrix.needsUpdate = true;
  belt.count = 900;
  scene.add(belt);
}

/* quelques blocs monumentaux, pour l'echelle */
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a4139, roughness: 1, flatShading: true });
  for (let n = 0; n < 10; n++) {
    const i = ((n / 10) * DIV + 40) | 0;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat);
    rock.position.copy(P[i])
      .addScaledVector(SD[i], (n % 2 ? 1 : -1) * (240 + Math.random() * 300))
      .addScaledVector(U[i], -60 - Math.random() * 220);
    const s = 90 + Math.random() * 160;
    rock.scale.set(s, s * (.5 + Math.random() * .6), s * (.6 + Math.random() * .7));
    rock.rotation.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
    scene.add(rock);
  }
}

/* poussieres : le seul reperage visuel quand on quitte le ruban des yeux */
const dust = (() => {
  const N = 900, pos = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x9fb2c4, size: 1.4, map: SPARK, transparent: true, opacity: .55,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  }));
  pts.frustumCulled = false;
  scene.add(pts);
  return { pts, pos, N, ready: false };
})();

/* trainees de vitesse : des segments qui filent le long du regard */
const STREAK_N = 160;
const streaks = (() => {
  const pos = new Float32Array(STREAK_N * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const seg = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: 0xbfe9ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false
  }));
  seg.frustumCulled = false;
  scene.add(seg);
  const base = [];
  for (let i = 0; i < STREAK_N; i++) base.push(new THREE.Vector3());
  return { seg, pos, base, ready: false };
})();

/* ============================================================
   5. LE VAISSEAU
   Modele oriente vers +Z : lookAt() l'aligne alors sur la piste.
   ============================================================ */

const ship = new THREE.Group();
const shipSkin = new THREE.Group();      /* masque en vue cockpit */
ship.add(shipSkin);
scene.add(ship);

{
  const bone = new THREE.MeshStandardMaterial({ color: 0xd9d3c6, roughness: .3, metalness: .85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: .35, metalness: .9 });
  const hot = new THREE.MeshStandardMaterial({ color: 0xff4d00, emissive: 0xff4d00, emissiveIntensity: 1.3, roughness: .4 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0a1a22, roughness: .06, metalness: .5,
    emissive: 0x5febf7, emissiveIntensity: .5, transparent: true, opacity: .92
  });

  /* fuselage : un fuseau a quatre pans, pointe vers l'avant */
  const hullGeo = new THREE.CylinderGeometry(.1, 1.25, 5.4, 4, 1);
  hullGeo.rotateX(Math.PI / 2); hullGeo.rotateZ(Math.PI / 4);
  const hull = new THREE.Mesh(hullGeo, bone);
  hull.position.z = .4;
  shipSkin.add(hull);

  /* dos du fuselage, plus sombre */
  const spineGeo = new THREE.BoxGeometry(1.1, .5, 3.4);
  const spine = new THREE.Mesh(spineGeo, dark);
  spine.position.set(0, .5, -.5);
  shipSkin.add(spine);

  /* verriere */
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(.72, 20, 14, 0, TAU, 0, Math.PI / 2), glass);
  canopy.scale.set(1, .7, 1.9);
  canopy.position.set(0, .42, .55);
  shipSkin.add(canopy);

  /* ailerons */
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.5, .18, 1.7), bone);
    wing.position.set(side * 1.7, -.1, -.9);
    wing.rotation.z = side * .16;
    wing.rotation.y = side * -.2;
    shipSkin.add(wing);

    const tip = new THREE.Mesh(new THREE.BoxGeometry(.24, 1.1, 1.2), hot);
    tip.position.set(side * 2.8, .3, -1.1);
    shipSkin.add(tip);

    /* nacelles et tuyeres */
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(.46, .54, 3.2, 12), dark);
    nac.rotation.x = Math.PI / 2;
    nac.position.set(side * 1.55, -.12, -1.2);
    shipSkin.add(nac);

    const ringM = new THREE.Mesh(new THREE.TorusGeometry(.5, .09, 6, 16), hot);
    ringM.position.set(side * 1.55, -.12, -2.7);
    shipSkin.add(ringM);
  }

  /* bande orange sur le nez */
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(.36, .1, 2.2), hot);
  stripe.position.set(0, .34, 1.7);
  shipSkin.add(stripe);
}

/* tuyeres : deux cones additifs qui s'allongent avec la poussee */
const flames = [];
for (const side of [-1, 1]) {
  const geo = new THREE.ConeGeometry(.42, 3.4, 12, 1, true);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -1.7);
  const f = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0x8fe9ff, transparent: true, opacity: .85,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  }));
  f.position.set(side * 1.55, -.12, -2.9);
  ship.add(f);
  flames.push(f);
}

/* coussin de sustentation, projete sur le tablier */
const cushion = new THREE.Mesh(
  new THREE.PlaneGeometry(6.4, 8.4),
  new THREE.MeshBasicMaterial({
    map: SPARK, color: 0x5febf7, transparent: true, opacity: .5,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  })
);
cushion.rotation.x = -Math.PI / 2;
cushion.position.y = -1.15;
shipSkin.add(cushion);

const shipLight = new THREE.PointLight(0x9fe8ff, 3, 26, 2);
ship.add(shipLight);

/* ============================================================
   6. CONDUITE
   ============================================================ */

const MAX_V = 132;         /* vitesse de croisiere, m/s      */
const BOOST_V = 179;       /* vitesse sous surtension        */
const TURN_RATE = 1.18;    /* rotation commandee, rad/s      */
const MAX_HEADING = 1.35;  /* garde une progression en piste */
const LAPS = 2;
const WALL = HALF - 2.6;

const drive = {
  s: 0, x: 0, v: 0, vx: 0,
  heading: 0, yaw: 0, roll: 0, pitch: 0,
  boost: 100, boosting: false,
  shake: 0, top: 0, hits: 0, hitCool: 0, bob: 0
};

let state = "menu";        /* menu | count | race | done */
let lap = 1, sector = 0;
let raceStart = 0, lapStart = 0, sectorStart = 0, elapsed = 0;
let lapTimes = [], bestLap = null, bestLapRef = null, splitRef = null;
let curSplits = [], lastSplits = [], pilot = "";

/* --- touches --- */
const DEFAULTS = { throttle: "KeyW", brake: "KeyS", left: "KeyA", right: "KeyD", boost: "Space" };
const ALIAS = {
  throttle: ["ArrowUp", "KeyZ"], brake: ["ArrowDown"],
  left: ["ArrowLeft", "KeyQ"], right: ["ArrowRight"], boost: []
};
const LABEL = {
  throttle: "ACCÉLÉRER", brake: "FREINER", left: "INCLINER À GAUCHE",
  right: "INCLINER À DROITE", boost: "SURTENSION"
};
let binds = { ...DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem("velocity.binds") || "{}");
  for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === "string") binds[k] = saved[k];
} catch (e) { /* reglages illisibles : on garde les touches d'origine */ }

const keys = Object.create(null);
const held = (a) => !!keys[binds[a]] || ALIAS[a].some((c) => keys[c]);
const motionForward = new THREE.Vector3();

/* --- boucle de simulation --- */
function step(dt) {
  const racing = state === "race";
  const throttle = racing && held("throttle");
  const brake = racing && held("brake");
  const steer = racing ? (held("right") ? 1 : 0) - (held("left") ? 1 : 0) : 0;

  /* surtension : elle vide la reserve, les plaques la remplissent */
  drive.boosting = racing && held("boost") && drive.boost > 1;
  if (drive.boosting) drive.boost = Math.max(0, drive.boost - 30 * dt);
  else drive.boost = Math.min(100, drive.boost + 5.5 * dt);

  /* vitesse longitudinale */
  const target = drive.boosting ? BOOST_V : MAX_V;
  if (throttle) drive.v += (target - drive.v) * (1 - Math.exp(-1.25 * dt));
  else drive.v -= 16 * dt;
  if (brake) drive.v -= 78 * dt;
  drive.v -= .0011 * drive.v * drive.v * dt;      /* trainee            */
  drive.v -= Math.abs(drive.vx) * .16 * dt;        /* penalite de derive */
  drive.v = clamp(drive.v, 0, 205);

  /* cap libre : sans input, le vaisseau conserve sa direction dans
     le monde au lieu d'epouser automatiquement la courbe du circuit. */
  const track = frameAt(drive.s);
  drive.heading = clamp(drive.heading + steer * TURN_RATE * dt, -MAX_HEADING, MAX_HEADING);
  motionForward.copy(track.t).applyAxisAngle(track.u, -drive.heading).normalize();

  const distance = racing ? drive.v * dt : 0;
  const forwardStep = Math.max(0, motionForward.dot(track.t)) * distance;
  drive.x += motionForward.dot(track.s) * distance;
  drive.vx = motionForward.dot(track.s) * drive.v;

  /* murs d'energie */
  drive.hitCool = Math.max(0, drive.hitCool - dt);
  if (Math.abs(drive.x) > WALL) {
    drive.x = Math.sign(drive.x) * WALL;
    drive.heading *= -.28;
    drive.vx *= -.28;
    motionForward.copy(track.t).applyAxisAngle(track.u, -drive.heading).normalize();
    drive.v *= Math.exp(-1.5 * dt);              /* on rape le long du mur */
    drive.shake = .55;
    /* le choc franc ne coute cher qu'une fois, pas a chaque image */
    if (racing && drive.hitCool <= 0) { drive.v *= .86; drive.hits++; drive.hitCool = .45; flash(); }
    warn(true);
  } else if (Math.abs(drive.x) > WALL - 2.4) warn(true);
  else warn(false);

  /* plaques de surtension */
  for (const pad of PADS) {
    pad.cool = Math.max(0, pad.cool - dt);
    if (!racing || pad.cool > 0) continue;
    let d = drive.s - pad.s;
    d -= Math.round(d / LEN) * LEN;
    if (Math.abs(d) < 15 && Math.abs(drive.x - pad.x) < pad.half) {
      pad.cool = 1.2;
      drive.boost = Math.min(100, drive.boost + 34);
      drive.v = Math.min(BOOST_V, drive.v + 9);
      say("SURTENSION +34");
    }
  }

  /* progression projetee sur la piste, sans guidage de la direction */
  if (racing) {
    const before = drive.s;
    drive.s += forwardStep;
    progress(before, drive.s);
    if (drive.s >= LEN) drive.s -= LEN;

    /* Le repere de la piste tourne sous le vaisseau. On recalcule
       l'angle relatif pour conserver le meme cap dans le monde. */
    const nextTrack = frameAt(drive.s);
    drive.heading = clamp(
      Math.atan2(motionForward.dot(nextTrack.s), motionForward.dot(nextTrack.t)),
      -MAX_HEADING,
      MAX_HEADING
    );
  } else if (state === "count") {
    drive.v = Math.max(0, drive.v - 40 * dt);
  }

  drive.top = Math.max(drive.top, drive.v);

  /* assiette visuelle : elle represente le cap commande, sans le corriger */
  drive.yaw += (drive.heading - drive.yaw) * (1 - Math.exp(-10 * dt));
  const rollT = -steer * .3 - drive.heading * .18;
  drive.roll += (rollT - drive.roll) * (1 - Math.exp(-5.5 * dt));
  drive.pitch += ((brake ? .06 : throttle ? -.05 : 0) - drive.pitch) * (1 - Math.exp(-4 * dt));
  drive.bob += dt * (2.4 + drive.v * .045);
  drive.shake *= Math.exp(-4.2 * dt);
}

/* --- position et orientation du vaisseau dans le monde --- */
const fwd = new THREE.Vector3(), upv = new THREE.Vector3(), look = new THREE.Vector3();
function placeShip() {
  const f = frameAt(drive.s);
  upv.copy(f.u);
  fwd.copy(f.t).applyAxisAngle(upv, -drive.yaw).normalize();

  ship.position.copy(f.p)
    .addScaledVector(f.s, drive.x)
    .addScaledVector(upv, RIDE + Math.sin(drive.bob) * .13);

  ship.up.copy(upv);
  ship.lookAt(look.copy(ship.position).add(fwd));
  ship.rotateZ(drive.roll);
  ship.rotateX(drive.pitch);

  /* tuyeres et coussin reagissent a la poussee */
  const push = clamp(drive.v / MAX_V, 0, 1.4) * (drive.boosting ? 1.7 : 1);
  for (const fl of flames) {
    fl.scale.set(.55 + push * .22, .55 + push * .22, .3 + push * .75);
    fl.material.color.setHex(drive.boosting ? 0xffb066 : 0x8fe9ff);
    fl.material.opacity = .2 + push * .42;
  }
  cushion.material.opacity = .16 + push * .14;
  shipLight.intensity = 2.5 + push * 4;
  shipLight.color.setHex(drive.boosting ? 0xffb066 : 0x9fe8ff);
}

/* ============================================================
   7. CAMERAS
   ============================================================ */

let camMode = 0;                      /* 0 poursuite, 1 cockpit */
const CAM_NAMES = ["POURSUITE", "COCKPIT"];
const camPos = new THREE.Vector3(), camAim = new THREE.Vector3(), camUp = new THREE.Vector3();
let camReady = false;

function moveCamera(dt) {
  const push = clamp(drive.v / MAX_V, 0, 1.5);

  if (state === "menu") {
    /* survol de presentation tant que le pilote n'a pas lance le run */
    const t = performance.now() * .00004;
    const f = frameAt(t * LEN * 6 % LEN);
    camPos.copy(f.p)
      .addScaledVector(f.u, 26 + Math.sin(t * 40) * 8)
      .addScaledVector(f.s, Math.sin(t * 27) * 46);
    camAim.copy(f.p).addScaledVector(f.t, 120);
    camUp.copy(f.u);
    camera.position.lerp(camPos, 1 - Math.exp(-2.2 * dt));
  } else if (camMode === 1) {
    camPos.copy(ship.position).addScaledVector(upv, 1.15).addScaledVector(fwd, .9);
    camAim.copy(ship.position).addScaledVector(fwd, 60).addScaledVector(upv, 1.4);
    camUp.copy(upv).applyAxisAngle(fwd, drive.roll * .85);
    camera.position.copy(camPos);
  } else {
    /* La poursuite reste ancree sur l'axe du circuit : elle ne recentre
       plus artificiellement le vaisseau lorsqu'il se decale lateralement. */
    const track = frameAt(drive.s);
    camPos.copy(track.p)
      .addScaledVector(track.u, 3.9 + push * .9)
      .addScaledVector(fwd, -(11.4 + push * 3.6));
    camAim.copy(track.p).addScaledVector(fwd, 34).addScaledVector(track.u, 2.2);
    camUp.copy(upv).applyAxisAngle(fwd, drive.roll * .5);
    camera.position.lerp(camPos, camReady ? 1 - Math.exp(-11 * dt) : 1);
  }
  camReady = true;

  if (drive.shake > .01) {
    camera.position.x += (Math.random() - .5) * drive.shake * 2.4;
    camera.position.y += (Math.random() - .5) * drive.shake * 2.4;
    camera.position.z += (Math.random() - .5) * drive.shake * 2.4;
  }
  camera.up.copy(camUp);
  camera.lookAt(camAim);

  const fovT = (camMode === 1 ? 72 : 62) + push * 16 + (drive.boosting ? 8 : 0);
  camera.fov += (fovT - camera.fov) * (1 - Math.exp(-4 * dt));
  camera.updateProjectionMatrix();

  shipSkin.visible = !(camMode === 1 && state !== "menu");
}

/* --- poussieres et trainees suivent la camera --- */
function ambience(dt) {
  const c = camera.position;
  for (let i = 0; i < dust.N; i++) {
    const o = i * 3;
    if (!dust.ready ||
        Math.abs(dust.pos[o] - c.x) > 420 ||
        Math.abs(dust.pos[o + 1] - c.y) > 420 ||
        Math.abs(dust.pos[o + 2] - c.z) > 420) {
      dust.pos[o] = c.x + (Math.random() - .5) * 700;
      dust.pos[o + 1] = c.y + (Math.random() - .5) * 700;
      dust.pos[o + 2] = c.z + (Math.random() - .5) * 700;
    }
  }
  dust.ready = true;
  dust.pts.geometry.attributes.position.needsUpdate = true;

  const push = clamp((drive.v - 55) / 130, 0, 1);
  streaks.seg.material.opacity = push * push * (drive.boosting ? .7 : .26);
  if (push > .02 || !streaks.ready) {
    const len = 5 + push * 34;
    for (let i = 0; i < STREAK_N; i++) {
      const b = streaks.base[i], o = i * 6;
      if (!streaks.ready || b.distanceToSquared(c) > 40000 || b.lengthSq() === 0) {
        const a = Math.random() * TAU, r = 24 + Math.random() * 78;
        b.copy(c)
          .addScaledVector(fwd, 30 + Math.random() * 130)
          .addScaledVector(camera.up, Math.sin(a) * r)
          .addScaledVector(new THREE.Vector3().crossVectors(fwd, camera.up), Math.cos(a) * r);
      }
      streaks.pos[o] = b.x; streaks.pos[o + 1] = b.y; streaks.pos[o + 2] = b.z;
      streaks.pos[o + 3] = b.x - fwd.x * len;
      streaks.pos[o + 4] = b.y - fwd.y * len;
      streaks.pos[o + 5] = b.z - fwd.z * len;
    }
    streaks.ready = true;
    streaks.seg.geometry.attributes.position.needsUpdate = true;
  }
}

/* --- rotation lente de la ceinture --- */
const beltDummy = new THREE.Object3D();
function turnBelt(dt) {
  const n = belt.count;
  for (let i = 0; i < n; i++) {
    const d = beltData[i];
    d.rot.y += d.spin * dt;
    d.rot.x += d.wob * dt;
    beltDummy.position.copy(d.p);
    beltDummy.rotation.copy(d.rot);
    beltDummy.scale.set(d.scale, d.scale * d.squash, d.scale);
    beltDummy.updateMatrix();
    belt.setMatrixAt(i, beltDummy.matrix);
  }
  belt.instanceMatrix.needsUpdate = true;

  giant.rotation.y += dt * .006;
  ring.rotation.z += dt * .002;
  iceMoon.rotation.y -= dt * .012;
  redMoon.rotation.x += dt * .008;
}

/* ============================================================
   8. CHRONOS, SECTEURS, TOURS
   ============================================================ */

const fmt = (ms) => {
  if (ms == null) return "--:--.---";
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, n = Math.floor(ms % 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(n).padStart(3, "0")}`;
};
const gap = (ms) => (ms >= 0 ? "+" : "−") + (Math.abs(ms) / 1000).toFixed(3);

function progress(before, after) {
  const now = performance.now();

  /* portes de secteur intermediaires */
  for (let n = 0; n < GATE_S.length; n++) {
    const g = GATE_S[n];
    if (before < g && after >= g && sector === n) {
      closeSector(now);
    }
  }
  /* ligne d'arrivee */
  if (after >= LEN) {
    closeSector(now);
    const t = now - lapStart;
    lapTimes.push(t);
    if (bestLap == null || t < bestLap) { bestLap = t; splitRef = curSplits.slice(); }
    $("v-best").textContent = fmt(bestLap);

    lastSplits = curSplits.slice();
    if (lap >= LAPS) { finish(now); return; }
    lap++;
    sector = 0; curSplits = [];
    lapStart = now; sectorStart = now;
    $("v-lap").textContent = lap;
    say(lap === LAPS ? "DERNIER TOUR" : "TOUR " + lap);
    renderSplits();
  }
}

function closeSector(now) {
  const t = now - sectorStart;
  curSplits[sector] = t;
  if (splitRef && splitRef[sector] != null) {
    const d = t - splitRef[sector];
    const el = $("v-delta");
    el.textContent = "SECTEUR " + (sector + 1) + "  " + gap(d);
    el.classList.add("on");
    el.classList.toggle("good", d < 0);
    clearTimeout(closeSector.tid);
    closeSector.tid = setTimeout(() => el.classList.remove("on"), 2600);
  }
  sector = Math.min(sector + 1, SECTORS - 1);
  sectorStart = now;
  renderSplits();
}

function renderSplits() {
  let html = "";
  for (let i = 0; i < SECTORS; i++) {
    const shown = curSplits[i] != null ? curSplits[i] : lastSplits[i];
    const cls = curSplits[i] != null ? "done" : i === sector ? "on" : shown != null ? "done" : "";
    html += `<div class="${cls}">S${i + 1} <b>${shown != null ? fmt(shown).slice(3) : "--.---"}</b></div>`;
  }
  $("v-splits").innerHTML = html;
}

/* ============================================================
   INTERFACE
   ============================================================ */

let warnOn = false;
function warn(on) {
  if (on === warnOn) return;
  warnOn = on;
  $("v-warn").classList.toggle("on", on);
}
function flash() {
  const el = $("v-flash");
  el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
}
function say(text) {
  const el = $("v-event");
  el.textContent = text;
  el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
}

function hud() {
  $("v-speed").textContent = String(Math.round(drive.v * 3.6)).padStart(3, "0");
  $("v-speedbar").style.transform = `scaleX(${(drive.v / BOOST_V).toFixed(3)})`;
  $("v-boostbar").style.transform = `scaleX(${(drive.boost / 100).toFixed(3)})`;
  $("v-boostpct").textContent = Math.round(drive.boost);
  document.querySelector(".vboost").classList.toggle("hot", drive.boosting);
  $("v-gripbar").style.transform = `scaleX(${clamp(1 - Math.abs(drive.vx) / 26, 0, 1).toFixed(3)})`;
  if (state === "race") $("v-time").textContent = fmt(performance.now() - raceStart);

  const canopy = document.querySelector(".canopy");
  canopy.style.setProperty("--tilt-x", `${(-drive.yaw * 90).toFixed(1)}px`);
  canopy.style.setProperty("--tilt-r", `${(-drive.roll * 16).toFixed(2)}deg`);
}

/* --- navigation par defilement : bloquee pendant la course --- */
function navLock(on) {
  const ps = window.PageScroll;
  if (!ps) return;
  on ? ps.lock() : ps.unlock();
}

/* ============================================================
   DEROULEMENT DU RUN
   ============================================================ */

let countTimer = 0;

function reset() {
  clearInterval(countTimer);
  state = "count";
  navLock(true);
  lap = 1; sector = 0; lapTimes = []; curSplits = []; lastSplits = [];
  bestLap = bestLapRef; splitRef = null;
  drive.s = 0; drive.x = 0; drive.v = 0; drive.vx = 0;
  drive.heading = 0; drive.yaw = 0; drive.roll = 0; drive.pitch = 0;
  drive.boost = 100; drive.top = 0; drive.hits = 0; drive.shake = 0;
  camReady = false;
  PADS.forEach((p) => (p.cool = 0));

  $("v-result").hidden = true;
  $("v-settings").hidden = true;
  $("v-lap").textContent = "1";
  $("v-time").textContent = "00:00.000";
  $("v-best").textContent = fmt(bestLap);
  $("v-delta").classList.remove("on");
  renderSplits();

  const box = $("v-count");
  let n = 3;
  box.className = "vcount";
  box.innerHTML = "<b>3</b>";
  countTimer = setInterval(() => {
    n--;
    if (n > 0) box.innerHTML = `<b>${n}</b>`;
    else if (n === 0) { box.className = "vcount go"; box.innerHTML = "<b>GO</b>"; }
    else {
      clearInterval(countTimer);
      box.innerHTML = "";
      state = "race";
      raceStart = lapStart = sectorStart = performance.now();
    }
  }, 900);
}

function begin() {
  const input = $("v-name"), name = input.value.trim();
  if (!name) {
    $("v-nameerr").textContent = "Un identifiant est nécessaire pour entrer en piste.";
    input.focus(); return;
  }
  if (!/^[\p{L}\p{N} ._-]{1,20}$/u.test(name)) {
    $("v-nameerr").textContent = "20 caractères max : lettres, chiffres, espace, . _ -";
    input.focus(); return;
  }
  pilot = name;
  try { localStorage.setItem("velocity.pilot", name); } catch (e) { /* stockage refuse */ }
  $("v-nameerr").textContent = "";

  const intro = $("v-intro");
  intro.classList.add("out");
  setTimeout(() => { intro.hidden = true; intro.classList.remove("out"); }, 380);
  music.set(true);
  reset();
}

async function finish(now) {
  state = "done";
  navLock(false);
  elapsed = now - raceStart;
  const record = bestLapRef == null || bestLap < bestLapRef;
  if (bestLap != null) {
    bestLapRef = record ? bestLap : bestLapRef;
    try { localStorage.setItem("velocity.bestlap", String(bestLapRef)); } catch (e) { /* ignore */ }
  }

  $("v-verdict").textContent = record ? "NOUVEAU MEILLEUR TOUR" : "RUN TERMINÉ";
  $("v-final").textContent = fmt(elapsed);
  $("v-finalbest").textContent = fmt(bestLap);
  $("v-finaltop").textContent = String(Math.round(drive.top * 3.6)).padStart(3, "0");
  $("v-finalhits").textContent = drive.hits;
  $("v-save").textContent = "ENREGISTREMENT DU CHRONO…";
  $("v-save").classList.remove("ok");
  $("v-result").hidden = false;

  submit(Math.round(elapsed));
}

/* ============================================================
   CLASSEMENT — le serveur d'abord, le navigateur en secours
   ============================================================ */

const API = "https://api.voidbelt.com/api/velocity/leaderboard";

function localScores() {
  try { return JSON.parse(localStorage.getItem("velocity.scores") || "[]"); }
  catch (e) { return []; }
}
function keepLocal(entry) {
  try {
    const all = localScores().concat([entry]).sort((a, b) => a.time_ms - b.time_ms).slice(0, 50);
    localStorage.setItem("velocity.scores", JSON.stringify(all));
    return all;
  } catch (e) { return localScores(); }
}

function drawBoard(scores, mine) {
  const rows = scores.slice(0, 12).map((s, i) => {
    const cls = [i < 3 ? "top" : "", mine && s.name === mine && s.time_ms === mine.time_ms ? "me" : ""].join(" ");
    return `<li class="${cls}"><i>${String(i + 1).padStart(2, "0")}</i><span>${esc(s.name)}</span><time>${fmt(s.time_ms)}</time></li>`;
  }).join("") || '<li class="none">Aucun chrono enregistré</li>';
  $("v-board0").innerHTML = rows;
  $("v-board1").innerHTML = rows;
  const n = String(Math.min(scores.length, 99)).padStart(2, "0");
  $("v-boardn").textContent = n;
  $("v-boardn2").textContent = n;
}
function esc(v) { const n = document.createElement("span"); n.textContent = v; return n.innerHTML; }

async function loadBoard() {
  try {
    const r = await fetch(API, { headers: { accept: "application/json" } });
    if (r.ok) { drawBoard(await r.json()); return; }
  } catch (e) { /* hors ligne ou site statique */ }
  drawBoard(localScores());
}

async function submit(ms) {
  const entry = { name: pilot, time_ms: ms, created_at: Math.floor(Date.now() / 1000) };
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: pilot, time_ms: ms })
    });
    if (!r.ok) throw new Error(await r.text());
    drawBoard(await r.json(), entry);
    $("v-save").textContent = "CHRONO ENREGISTRÉ — " + pilot.toUpperCase();
    $("v-save").classList.add("ok");
    keepLocal(entry);
    return;
  } catch (e) {
    drawBoard(keepLocal(entry), entry);
    $("v-save").textContent = "CHRONO GARDÉ SUR CET APPAREIL — SERVEUR INJOIGNABLE";
  }
}

/* ============================================================
   REGLAGES
   ============================================================ */

let listening = "";
let wasRacing = false, pausedAt = 0;

function drawBinds() {
  $("v-binds").innerHTML = Object.keys(DEFAULTS).map((a) =>
    `<div class="vbind"><span>${LABEL[a]}</span>` +
    `<button type="button" data-a="${a}" class="${listening === a ? "wait" : ""}">` +
    `${listening === a ? "PRESSEZ UNE TOUCHE" : keyName(binds[a])}</button></div>`).join("");
}
function keyName(code) {
  return code.replace("Key", "").replace("Digit", "").replace("Arrow", "FLÈCHE ")
    .replace("Space", "ESPACE").replace("Shift", "MAJ ").replace("Control", "CTRL ");
}

function openSet() {
  if (!$("v-settings").hidden) return;
  wasRacing = state === "race";
  if (wasRacing) { state = "pause"; pausedAt = performance.now(); }
  for (const k in keys) keys[k] = false;
  $("v-settings").hidden = false;
  navLock(false);
  drawBinds();
}
function closeSet() {
  if ($("v-settings").hidden) return;
  $("v-settings").hidden = true;
  listening = "";
  if (wasRacing) {
    const off = performance.now() - pausedAt;
    raceStart += off; lapStart += off; sectorStart += off;
    state = "race";
    navLock(true);
  }
  wasRacing = false;
}

const BELT_LEVELS = [420, 900, 1500];
const BELT_NAMES = ["BASSE", "MOYENNE", "DENSE"];
function setBelt(level) {
  belt.count = BELT_LEVELS[level];
  $("v-qualv").value = BELT_NAMES[level];
  try { localStorage.setItem("velocity.belt", String(level)); } catch (e) { /* ignore */ }
}

/* ============================================================
   ENTREES CLAVIER ET BOUTONS
   ============================================================ */

addEventListener("keydown", (e) => {
  if (listening) {
    if (e.code !== "Escape") {
      binds[listening] = e.code;
      try { localStorage.setItem("velocity.binds", JSON.stringify(binds)); } catch (err) { /* ignore */ }
      listening = ""; drawBinds();
    }
    e.preventDefault(); return;
  }
  const typing = document.activeElement && document.activeElement.tagName === "INPUT";

  if (e.code === "Escape") {
    e.preventDefault();
    $("v-settings").hidden ? openSet() : closeSet();
    return;
  }
  if (typing) { if (e.key === "Enter") begin(); return; }

  if (e.code === "KeyC" && state !== "menu") { e.preventDefault(); toggleCam(); return; }
  if (e.code === "KeyR" && (state === "done" || state === "race")) { e.preventDefault(); reset(); return; }

  keys[e.code] = true;
  if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
});
addEventListener("keyup", (e) => { keys[e.code] = false; });
addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

function toggleCam() {
  camMode = camMode ? 0 : 1;
  camReady = false;
  $("v-camname").textContent = CAM_NAMES[camMode];
  try { localStorage.setItem("velocity.cam", String(camMode)); } catch (e) { /* ignore */ }
}

$("v-go").addEventListener("click", begin);
$("v-again").addEventListener("click", reset);
$("v-pause").addEventListener("click", openSet);
$("v-resume").addEventListener("click", closeSet);
$("v-cam").addEventListener("click", toggleCam);
$("v-redo").addEventListener("click", () => { closeSet(); wasRacing = false; reset(); });
$("v-rebind").addEventListener("click", () => {
  binds = { ...DEFAULTS };
  try { localStorage.setItem("velocity.binds", JSON.stringify(binds)); } catch (e) { /* ignore */ }
  drawBinds();
});
$("v-binds").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-a]");
  if (b) { listening = b.dataset.a; drawBinds(); }
});
$("v-name").addEventListener("input", () => { $("v-nameerr").textContent = ""; });

/* ============================================================
   BANDE-SON — le seul element repris de l'ancienne version
   ============================================================ */

const music = Track("vtrack", "velocity.volume", 35);
const volumeUI = VolumeUI(music);
volumeUI.add("f-mute", "f-volr", "f-volv");
music.set(true);

$("v-vol").addEventListener("input", (e) => {
  music.setLevel(parseInt(e.target.value, 10) || 0);
  $("v-volv").value = music.level();
  volumeUI.sync();
});
$("v-qual").addEventListener("input", (e) => setBelt(parseInt(e.target.value, 10) || 0));

/* ============================================================
   DEMARRAGE
   ============================================================ */

try {
  $("v-name").value = localStorage.getItem("velocity.pilot") || "";
  const bl = parseFloat(localStorage.getItem("velocity.bestlap"));
  if (bl > 0) { bestLapRef = bl; bestLap = bl; }
  const cam = parseInt(localStorage.getItem("velocity.cam"), 10);
  if (cam === 1) toggleCam();
  const bd = parseInt(localStorage.getItem("velocity.belt"), 10);
  $("v-qual").value = Number.isFinite(bd) ? bd : 1;
} catch (e) { /* stockage indisponible : valeurs par defaut */ }

setBelt(parseInt($("v-qual").value, 10) || 0);
$("v-vol").value = music.level();
$("v-volv").value = music.level();
$("v-best").textContent = fmt(bestLap);
renderSplits();
drawBinds();
loadBoard();

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (composer) composer.setSize(innerWidth, innerHeight);
  if (bloom) bloom.setSize(innerWidth, innerHeight);
});

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(.05, (now - last) / 1000) || 0;
  last = now;

  step(dt);
  placeShip();
  moveCamera(dt);
  ambience(dt);
  turnBelt(dt);
  hud();

  if (composer) composer.render(dt);
  else renderer.render(scene, camera);
});
