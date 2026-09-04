/* ============================================================
   VOIDBELT // SHUTDOWN
   ------------------------------------------------------------
   Une ville a la grille, une Fennec, une manette. Rien d'autre
   pour l'instant : pas de trafic, pas de chrono, pas d'objectif.
   On pose le sol, on trace les rues, et on fait tourner les roues.

   Le fichier se lit de haut en bas :
     1. rendu, ciel et lumiere
     2. textures fabriquees a la volee (aucun fichier image)
     3. la ville : chaussee, trottoirs, immeubles
     4. la voiture : chargement du modele et demontage des roues
     5. les commandes : manette d'abord, clavier en secours
     6. la conduite
     7. camera
     8. interface
   ============================================================ */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;
/* Amortissement independant de la cadence : la meme douceur a 60 ou 144 Hz. */
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

/* ============================================================
   1. RENDU, CIEL ET LUMIERE
   ============================================================ */

const canvas = $("city");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .25, 2400);

/* Le ciel est une bande verticale peinte dans un canevas, posee en fond
   equirectangulaire. La meme image sert d'environnement : c'est elle que
   la carrosserie reflete, donc le ciel et la voiture ne peuvent pas se
   contredire. */
function skyTexture(){
  const c = document.createElement("canvas");
  c.width = 8; c.height = 512;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(.000, "#16233c");
  g.addColorStop(.320, "#3d5a80");
  g.addColorStop(.455, "#8ea2bd");
  g.addColorStop(.500, "#e0a877");
  g.addColorStop(.560, "#4a4640");
  g.addColorStop(1.00, "#1a1917");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 512);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const sky = skyTexture();
scene.background = sky;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(sky).texture;
scene.fog = new THREE.FogExp2(0x63708a, .0032);

/* Un soleil rasant de fin de journee. Son ombre ne couvre qu'un carre
   d'une centaine de metres : il suit la voiture, le reste de la ville
   n'en a pas besoin. */
const sun = new THREE.DirectionalLight(0xffd8b0, 3.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 260;
sun.shadow.camera.left = -52;
sun.shadow.camera.right = 52;
sun.shadow.camera.top = 52;
sun.shadow.camera.bottom = -52;
sun.shadow.bias = -.0005;
sun.shadow.normalBias = .05;
const SUN_OFF = new THREE.Vector3(-58, 52, 34);
sun.position.copy(SUN_OFF);
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xa8bcd6, 0x3a3630, 1.7));

/* ============================================================
   2. TEXTURES FABRIQUEES A LA VOLEE
   Aucun fichier image pour le decor : tout est peint dans un
   canevas au chargement. Les motifs se raccordent d'un bord a
   l'autre, donc une seule tuile suffit pour toute la ville.
   ============================================================ */

function canvasOf(size){
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

function finish(cv){
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  return t;
}

/* Un bruit pixel par pixel : sans correlation, donc raccordable dans
   tous les sens sans y penser. */
function grain(ctx, size, r, g, b, spread){
  const img = ctx.createImageData(size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4){
    const n = (Math.random() - .5) * spread;
    d[i]     = clamp(r + n, 0, 255);
    d[i + 1] = clamp(g + n, 0, 255);
    d[i + 2] = clamp(b + n, 0, 255);
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* Une tache posee neuf fois, decalee d'une tuile dans chaque sens : ce
   qui deborde d'un bord revient par le bord oppose. */
function blob(ctx, size, x, y, r, color){
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++){
    const cx = x + dx * size, cy = y + dy * size;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
}

const ROAD = 12;          // largeur d'une rue, en metres
const PX   = 512;         // une tuile carree de ROAD metres de cote
const M    = PX / ROAD;   // pixels par metre

function asphaltCanvas(){
  const c = canvasOf(PX), ctx = c.getContext("2d");
  grain(ctx, PX, 78, 79, 84, 28);
  for (let i = 0; i < 22; i++)
    blob(ctx, PX, Math.random() * PX, Math.random() * PX, 30 + Math.random() * 100,
         Math.random() < .5 ? "rgba(18,18,20,.45)" : "rgba(96,96,100,.22)");
  return c;
}

/* La rue : deux rives continues et un axe discontinu. La tuile fait ROAD
   metres de cote, la largeur tient donc en une seule tuile et seule la
   longueur se repete. */
function roadTexture(){
  const c = asphaltCanvas(), ctx = c.getContext("2d");
  const w = .16 * M;
  ctx.fillStyle = "rgba(224,219,204,.82)";
  ctx.fillRect(.8 * M - w / 2, 0, w, PX);
  ctx.fillRect(PX - .8 * M - w / 2, 0, w, PX);
  /* 3 m de trait, 3 m de vide : deux motifs entiers par tuile */
  const dash = 3 * M;
  ctx.fillStyle = "rgba(224,219,204,.66)";
  for (let y = 0; y < PX; y += dash * 2) ctx.fillRect(PX / 2 - w / 2, y, w, dash);
  return finish(c);
}

/* Le carrefour : le meme bitume, sans marquage, plus les traces de ceux
   qui sont repartis trop vite. */
function crossTexture(){
  const c = asphaltCanvas(), ctx = c.getContext("2d");
  ctx.strokeStyle = "rgba(22,22,24,.42)";
  ctx.lineWidth = .22 * M;
  for (let i = 0; i < 5; i++){
    const x = (.2 + Math.random() * .6) * PX;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 60, PX * .35, x - 40, PX * .7, x + (Math.random() - .5) * 90, PX);
    ctx.stroke();
  }
  return finish(c);
}

const PAVE = 4;   // cote d'une dalle de trottoir, en metres
function paveTexture(){
  const c = canvasOf(256), ctx = c.getContext("2d");
  grain(ctx, 256, 158, 155, 147, 22);
  for (let i = 0; i < 10; i++)
    blob(ctx, 256, Math.random() * 256, Math.random() * 256, 40 + Math.random() * 60, "rgba(66,66,64,.22)");
  ctx.strokeStyle = "rgba(56,56,54,.65)";
  ctx.lineWidth = 3;
  for (let i = 0; i <= 2; i++){
    const p = i * 128;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(256, p); ctx.stroke();
  }
  return finish(c);
}

function plainTexture(r, g, b, spread){
  const c = canvasOf(128);
  grain(c.getContext("2d"), 128, r, g, b, spread);
  return finish(c);
}

/* La facade : une tuile de deux travees sur deux etages. Les fenetres
   allumees sont peintes une seconde fois dans une image d'emission, pour
   que la ville se pique de jaune maintenant que le jour tombe. */
const BAY = 4, FLOOR = 3.4;
function facadeTextures(){
  const map = canvasOf(256), lit = canvasOf(256);
  const a = map.getContext("2d"), b = lit.getContext("2d");
  grain(a, 256, 152, 151, 154, 20);
  b.fillStyle = "#000";
  b.fillRect(0, 0, 256, 256);
  /* une seule fenetre allumee sur les quatre : la tuile sert a toute la
     ville, un tirage par fenetre ferait varier le quartier entier d'une
     visite a l'autre */
  const litOne = (Math.random() * 4) | 0;

  for (let fy = 0; fy < 2; fy++){
    a.fillStyle = "rgba(52,52,56,.5)";        // bandeau de plancher
    a.fillRect(0, fy * 128, 256, 16);
    for (let fx = 0; fx < 2; fx++){
      const x = fx * 128 + 26, y = fy * 128 + 30, w = 76, h = 74;
      a.fillStyle = "#0e131b";
      a.fillRect(x, y, w, h);
      /* un reflet en diagonale, sinon la vitre est un trou noir */
      const g = a.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, "rgba(150,178,205,.30)");
      g.addColorStop(.55, "rgba(150,178,205,.04)");
      g.addColorStop(1, "rgba(150,178,205,.16)");
      a.fillStyle = g;
      a.fillRect(x, y, w, h);
      a.strokeStyle = "rgba(40,40,44,.9)";
      a.lineWidth = 4;
      a.strokeRect(x, y, w, h);
      if (fy * 2 + fx === litOne){
        b.fillStyle = "rgba(255,196,120,.85)";
        b.fillRect(x + 3, y + 3, w - 6, h - 6);
      }
    }
  }
  return { map: finish(map), lit: finish(lit) };
}

/* ============================================================
   3. LA VILLE
   Une grille reguliere : N pates de maisons carres separes par
   des rues de meme largeur. Tout ce qui partage une texture est
   fondu dans une seule geometrie, sinon le decor coute plus cher
   a dessiner que la voiture.
   ============================================================ */

const BLOCK = 66;                 // cote d'un pate de maisons
const CELL  = BLOCK + ROAD;       // pas de la grille
const N     = 8;                  // pates de maisons par cote
const HALF  = N * CELL / 2;
const CURB  = .16;                // hauteur du trottoir
const WALK  = 5;                  // largeur du trottoir devant les murs

const roadAt  = (i) => -HALF + i * CELL;              // axe de la rue i (0..N)
const blockAt = (i) => -HALF + i * CELL + CELL / 2;   // centre du pate i (0..N-1)

const WHITE = [1, 1, 1];

/* Un assembleur de quadrilateres. On lui empile des dalles et des pans
   de mur, il rend un seul maillage. La teinte est portee par les
   sommets : deux immeubles de couleurs differentes restent dans le meme
   appel de dessin. */
function Surface(){
  const pos = [], uvs = [], nrm = [], col = [], idx = [];
  let n = 0;

  const api = {
    face(v, uv, nml, tint){
      const t = tint || WHITE;
      for (let i = 0; i < 4; i++){
        pos.push(v[i][0], v[i][1], v[i][2]);
        uvs.push(uv[i][0], uv[i][1]);
        nrm.push(nml[0], nml[1], nml[2]);
        col.push(t[0], t[1], t[2]);
      }
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      n += 4;
    },

    /* Dalle horizontale, face vers le haut. `swap` fait courir la
       texture le long de x plutot que de z : c'est ce qui oriente les
       marquages des rues est-ouest. */
    slab(x, z, w, d, y, ur, vr, swap, tint){
      const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
      const uv = swap ? [[0, 0], [ur, 0], [ur, vr], [0, vr]]
                      : [[0, 0], [0, vr], [ur, vr], [ur, 0]];
      api.face([[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], uv, [0, 1, 0], tint);
    },

    /* Pan vertical de (x0,z0) a (x1,z1) : la normale sort a droite du
       trajet, donc on fait le tour d'un batiment dans le sens qui met
       les faces dehors. `us` et `vs` comptent les repetitions au metre. */
    wall(x0, z0, x1, z1, y0, y1, us, vs, tint){
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz), h = y1 - y0;
      const u = len * us, v = h * vs;
      api.face([[x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]],
               [[0, 0], [u, 0], [u, v], [0, v]],
               [-dz / len, 0, dx / len], tint);
    },

    mesh(material, cast, receive){
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, material);
      m.castShadow = !!cast;
      m.receiveShadow = !!receive;
      scene.add(m);
      return m;
    }
  };
  return api;
}

/* Un tirage reproductible : la ville est la meme a chaque visite. */
function mulberry32(seed){
  return function(){
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --- le sol, sous tout le reste --- */
const dirt = plainTexture(84, 80, 74, 24);
dirt.repeat.set(160, 160);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2400, 2400),
  new THREE.MeshStandardMaterial({ map: dirt, roughness: 1, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -.02;   // juste sous la chaussee, pour ne pas la contrarier
ground.receiveShadow = true;
scene.add(ground);

/* --- la chaussee : troncons de rue puis carrefours, sans recouvrement,
       donc sans bagarre de profondeur la ou ils se touchent --- */
const roads = Surface();
const RUN = Math.round((BLOCK / ROAD) * 2) / 2;   // repetitions sur un troncon
for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++){
  roads.slab(roadAt(i), blockAt(j), ROAD, BLOCK, 0, 1, RUN, false);   // nord-sud
  roads.slab(blockAt(j), roadAt(i), BLOCK, ROAD, 0, 1, RUN, true);    // est-ouest
}
roads.mesh(new THREE.MeshStandardMaterial({
  map: roadTexture(), roughness: .92, metalness: 0, vertexColors: true
}), false, true);

const crossings = Surface();
for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++)
  crossings.slab(roadAt(i), roadAt(j), ROAD, ROAD, 0, 1, 1, false);
crossings.mesh(new THREE.MeshStandardMaterial({
  map: crossTexture(), roughness: .92, metalness: 0, vertexColors: true
}), false, true);

/* --- trottoirs : le dessus des dalles, puis la bordure qui les tient --- */
const walks = Surface(), curbs = Surface();
const WR = BLOCK / PAVE;
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++){
  const cx = blockAt(i), cz = blockAt(j), h = BLOCK / 2;
  walks.slab(cx, cz, BLOCK, BLOCK, CURB, WR, WR, false);
  const x0 = cx - h, x1 = cx + h, z0 = cz - h, z1 = cz + h;
  curbs.wall(x1, z0, x0, z0, 0, CURB, .5, 3);   // sud
  curbs.wall(x0, z1, x1, z1, 0, CURB, .5, 3);   // nord
  curbs.wall(x0, z0, x0, z1, 0, CURB, .5, 3);   // ouest
  curbs.wall(x1, z1, x1, z0, 0, CURB, .5, 3);   // est
}
walks.mesh(new THREE.MeshStandardMaterial({
  map: paveTexture(), roughness: .95, metalness: 0, vertexColors: true
}), false, true);
curbs.mesh(new THREE.MeshStandardMaterial({
  map: plainTexture(176, 172, 163, 16), roughness: .9, metalness: 0, vertexColors: true
}), false, true);

/* --- les immeubles : jusqu'a quatre par pate, poses sur le trottoir et
       en retrait des bords. `solids` garde leur emprise, c'est contre
       elle que la voiture butera. --- */
const fronts = Surface(), roofs = Surface();
const solids = [];
const TINTS = [
  [1.00, .98, .94], [.86, .88, .95], [1.00, .90, .82],
  [.82, .86, .84], [.94, .90, .98], [.90, .93, 1.00]
];
const rnd = mulberry32(0x5EEDCAFE);

function tower(x, z, w, d, h, tint){
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  const y0 = CURB, y1 = CURB + h;
  /* on arrondit a un nombre entier de travees et d'etages : une fenetre
     coupee en deux a l'angle se voit tout de suite */
  const uw = Math.max(1, Math.round(w / (BAY * 2))) / w;
  const ud = Math.max(1, Math.round(d / (BAY * 2))) / d;
  const vh = Math.max(1, Math.round(h / (FLOOR * 2))) / h;
  fronts.wall(x1, z0, x0, z0, y0, y1, uw, vh, tint);
  fronts.wall(x0, z1, x1, z1, y0, y1, uw, vh, tint);
  fronts.wall(x0, z0, x0, z1, y0, y1, ud, vh, tint);
  fronts.wall(x1, z1, x1, z0, y0, y1, ud, vh, tint);
  roofs.slab(x, z, w, d, y1, w / 8, d / 8, false, tint);
  return { x0, x1, z0, z1 };
}

for (let i = 0; i < N; i++) for (let j = 0; j < N; j++){
  const cx = blockAt(i), cz = blockAt(j);
  const inner = BLOCK - WALK * 2, lot = inner / 2;
  const list = [];
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++){
    if (rnd() < .12) continue;                       // une dent creuse de temps en temps
    const w = lot - 2 - rnd() * 6, d = lot - 2 - rnd() * 6;
    const h = 8 + rnd() * rnd() * 40;
    list.push(tower(cx - inner / 2 + lot / 2 + a * lot,
                    cz - inner / 2 + lot / 2 + b * lot,
                    w, d, h, TINTS[(rnd() * TINTS.length) | 0]));
  }
  solids.push(list);
}

const facade = facadeTextures();
fronts.mesh(new THREE.MeshStandardMaterial({
  map: facade.map, emissive: 0xffb066, emissiveMap: facade.lit, emissiveIntensity: .55,
  roughness: .62, metalness: .1, vertexColors: true
}), true, true);
roofs.mesh(new THREE.MeshStandardMaterial({
  map: plainTexture(112, 110, 105, 26), roughness: .96, metalness: 0, vertexColors: true
}), true, true);

/* La hauteur du sol sous un point : zero sur la chaussee, la bordure sur
   un pate de maisons. C'est tout le relief de la ville. */
function curbAt(x, z){
  const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
  if (i < 0 || j < 0 || i >= N || j >= N) return 0;
  return (Math.abs(x - blockAt(i)) < BLOCK / 2 && Math.abs(z - blockAt(j)) < BLOCK / 2) ? CURB : 0;
}

/* ============================================================
   4. LA VOITURE
   Le modele arrive du fichier glTF avec ses quatre roues en
   noeuds separes. On les detache du chassis pour les remonter
   sur des pivots a nous : un pour tourner, un pour braquer.
   ============================================================ */

const CAR_LEN = 4.05;              // longueur voulue, en metres
const KEYS = ["FR", "FL", "BR", "BL"];

const carRoot = new THREE.Group();   // position dans la ville + cap
const shell   = new THREE.Group();   // la caisse seule : elle tangue et roule
carRoot.add(shell);
carRoot.visible = false;
scene.add(carRoot);

const wheels = [];
let WB = 2.5;   // empattement, mesure sur le modele au chargement
const MAX_HP = 100;
const HIT_DISTANCE = 2.45;
const drivers = [];
const hitTimes = new Map();
const debris = [];
let localDriver = null;

const boxOf = (o) => new THREE.Box3().setFromObject(o);
const centreOf = (o) => boxOf(o).getCenter(new THREE.Vector3());

function buildCar(model){
  model.updateWorldMatrix(true, true);

  /* Les roues portent leur place dans leur nom : FR, FL, BR, BL. Le
     parcours descend l'arbre, donc le premier noeud qui correspond est
     le groupe entier ; ses enfants repetent le meme mot, on les ignore. */
  const found = {};
  model.traverse((o) => {
    const m = /(?:^|[^A-Za-z])(FR|FL|BR|BL)(?:[^A-Za-z]|$)/.exec(String(o.name).replace(/_/g, " "));
    if (m && !found[m[1]]) found[m[1]] = o;
  });
  const complete = KEYS.every((k) => found[k]);

  const fix = new THREE.Group();
  fix.add(model);
  shell.add(fix);
  carRoot.updateMatrixWorld(true);

  if (complete){
    /* Le modele arrive oriente n'importe comment. Plutot que de decoder
       ses matrices, on lit son orientation dans la position de ses
       roues : l'avant est du cote des roues avant, la droite du cote des
       roues droites. Le reste suit par produit vectoriel. */
    const c = {};
    for (const k of KEYS) c[k] = centreOf(found[k]);
    const fwd = c.FR.clone().add(c.FL).multiplyScalar(.5)
      .sub(c.BR.clone().add(c.BL).multiplyScalar(.5)).normalize();
    const up = new THREE.Vector3().crossVectors(c.FR.clone().sub(c.FL).normalize(), fwd).normalize();
    /* Rien ne dit que la roue nommee « droite » soit a droite : selon
       l'export, ce produit vectoriel peut sortir la tete en bas. On le
       recale sur la seule chose dont on soit sur, c'est que la caisse
       est au-dessus de l'essieu. */
    const axle = c.FR.clone().add(c.FL).add(c.BR).add(c.BL).multiplyScalar(.25);
    if (up.dot(boxOf(model).getCenter(new THREE.Vector3()).sub(axle)) < 0) up.negate();
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    /* On veut l'avant sur -Z, la droite sur +X, le haut sur +Y : la base
       transposee est exactement la rotation qui y mene. */
    fix.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate()).transpose()
    );
  } else {
    console.warn("SHUTDOWN : roues introuvables dans le modele, la voiture reste d'une piece");
    fix.rotation.y = Math.PI;
  }

  /* Mise a l'echelle sur la longueur, puis calage : l'origine de la
     voiture est au centre des quatre contacts au sol. */
  carRoot.updateMatrixWorld(true);
  const b0 = boxOf(fix);
  fix.scale.setScalar(CAR_LEN / Math.max(.001, b0.max.z - b0.min.z));
  carRoot.updateMatrixWorld(true);

  const b1 = boxOf(fix);
  let mid;
  if (complete){
    const w = KEYS.map((k) => centreOf(found[k]));
    mid = w[0].clone().add(w[1]).add(w[2]).add(w[3]).multiplyScalar(.25);
    WB = w[0].clone().add(w[1]).multiplyScalar(.5)
      .distanceTo(w[2].clone().add(w[3]).multiplyScalar(.5));
  } else {
    mid = b1.getCenter(new THREE.Vector3());
  }
  fix.position.set(-mid.x, -b1.min.y, -mid.z);
  carRoot.updateMatrixWorld(true);

  /* Demontage des roues. Chacune passe sous un pivot de rotation ; les
     deux roues avant recoivent en plus un pivot de braquage au-dessus.
     Les pivots pendent de `carRoot` et non de `shell` : la caisse tangue
     dans les virages, les roues restent au sol. */
  if (complete) for (const k of KEYS){
    const node = found[k];
    const box = boxOf(node);
    const front = k[0] === "F";
    const spin = new THREE.Object3D();
    const mount = front ? new THREE.Object3D() : spin;

    mount.position.copy(carRoot.worldToLocal(box.getCenter(new THREE.Vector3())));
    carRoot.add(mount);
    if (front) mount.add(spin);
    carRoot.updateMatrixWorld(true);
    spin.attach(node);   // le noeud change de parent sans bouger d'un pixel

    wheels.push({
      spin, mount, front,
      radius: Math.max(box.max.y - box.min.y, box.max.z - box.min.z) / 2
    });
  }

  /* Les matieres du fichier sont reglees pour un studio : le pneu y est
     declare metallique a 84 % et la jante a 100 %. Dehors, un metal noir
     ne renvoie que le bitume, et la roue devient un trou. On desserre le
     metal juste assez pour qu'on voie la gomme et les rayons tourner. */
  carRoot.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])){
      if (!m) continue;
      m.envMapIntensity = 1.35;
      if (/tread/i.test(m.name)){ m.metalness = .05; m.roughness = .85; m.color.setScalar(.04); }
      else if (/rim/i.test(m.name)){ m.metalness = .45; m.roughness = .34; }
    }
  });

  carRoot.visible = true;
  initDrivers();
  respawn();
  ready();
}

const manager = new THREE.LoadingManager();
manager.onProgress = (url, done, total) => progress(done / Math.max(1, total));
new GLTFLoader(manager).load(
  "models/fennec/scene.gltf",
  (gltf) => buildCar(gltf.scene),
  undefined,
  (err) => {
    console.error(err);
    $("s-loadmsg").textContent = "LE MODELE N'A PAS PU ETRE CHARGE.";
  }
);

/* ============================================================
   5. LES COMMANDES
   La manette est la commande de reference ; le clavier reprend
   les memes actions pour ceux qui n'en ont pas sous la main.
   ============================================================ */

const held = new Set();
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  held.add(e.code);
  if (e.code === "Escape") togglePause();
  else if (e.code === "KeyR") respawn();
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => held.delete(e.code));
addEventListener("blur", () => held.clear());

const down = (...codes) => codes.some((c) => held.has(c));

/* Un manche de manette n'est jamais tout a fait au centre : on ignore le
   premier dixieme, et on etire le reste pour ne pas perdre de course. */
function dead(v, d = .12){
  if (Math.abs(v) < d) return 0;
  return (v - Math.sign(v) * d) / (1 - d);
}

let padName = "";
function activePad(){
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const g of list) if (g && g.connected) return g;
  return null;
}

function trigger(g, i){
  const b = g.buttons[i];
  if (!b) return 0;
  return typeof b.value === "number" ? b.value : (b.pressed ? 1 : 0);
}

const prevButtons = [];

/* Renvoie l'etat des commandes, manette et clavier fondus ensemble.
   Direction : positif vers la gauche, comme le lacet. */
function controls(){
  let steer = 0, gas = 0, brake = 0, hand = 0, look = 0, tilt = 0;
  const g = activePad();

  if (g){
    padName = g.id.replace(/\s*\([^)]*\)\s*/g, " ").trim().slice(0, 26) || "MANETTE";
    steer = -dead(g.axes[0] || 0);
    gas = trigger(g, 7);
    brake = trigger(g, 6);
    hand = g.buttons[0] && g.buttons[0].pressed ? 1 : 0;
    look = -dead(g.axes[2] || 0, .18);
    tilt = -dead(g.axes[3] || 0, .18);
    /* triangle remet la voiture droite, start met en pause */
    if (g.buttons[3] && g.buttons[3].pressed && !prevButtons[3]) respawn();
    if (g.buttons[9] && g.buttons[9].pressed && !prevButtons[9]) togglePause();
    for (let i = 0; i < g.buttons.length; i++){
      const on = g.buttons[i].pressed;
      prevButtons[i] = on;
    }
  } else {
    padName = "";
  }

  /* Le clavier ne remplace la manette que sur ce qu'elle ne demande pas. */
  if (down("KeyA", "KeyQ", "ArrowLeft")) steer = 1;
  else if (down("KeyD", "ArrowRight")) steer = -1;
  if (down("KeyW", "KeyZ", "ArrowUp")) gas = Math.max(gas, 1);
  if (down("KeyS", "ArrowDown")) brake = Math.max(brake, 1);
  if (down("Space")) hand = 1;

  return { steer: clamp(steer, -1, 1), gas, brake, hand, look, tilt, pad: !!g };
}

/* ============================================================
   6. LA CONDUITE
   Modele de bicyclette : la voiture avance dans l'axe de son
   capot, et c'est l'angle des roues avant qui la fait pivoter.
   Simple, stable, et les roues disent la verite.
   ============================================================ */

const TOP = 46;          // vitesse de pointe, m/s (~165 km/h)
const REV_TOP = 13;      // en marche arriere
const ENGINE = 14;       // poussee, m/s2
const BRAKE = 26;
const HAND = 20;         // frein a main
const DRAG = ENGINE / (TOP * TOP);
const ROLLRES = .8;      // resistance au roulement
const MAX_STEER = .60;   // braquage maximal, radians

let speed = 0, yaw = 0, steerAngle = 0, lift = 0, yawRate = 0, accel = 0;

function respawn(){
  if (localDriver && !localDriver.alive) return;
  const x = localDriver ? localDriver.spawnX : 0;
  const z = localDriver ? localDriver.spawnZ : 0;
  const spawnYaw = localDriver ? localDriver.spawnYaw : 0;
  carRoot.position.set(x, 0, z);
  carRoot.rotation.y = spawnYaw;
  shell.rotation.set(0, 0, 0);
  speed = 0; yaw = spawnYaw; steerAngle = 0; lift = 0; yawRate = 0; accel = 0;
  camFrom.set(x, 3, z + 7);
  camAim.set(x, .85, z);
}

function cloneCar(tint){
  const root = carRoot.clone(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const source = Array.isArray(o.material) ? o.material : [o.material];
    const copies = source.map((material) => {
      const copy = material.clone();
      if (copy.color && !/tread|rim/i.test(copy.name)) copy.color.lerp(new THREE.Color(tint), .48);
      return copy;
    });
    o.material = Array.isArray(o.material) ? copies : copies[0];
  });
  scene.add(root);
  return root;
}

function initDrivers(){
  carRoot.visible = false;
}

const DRIVER_TINTS = [0xff4d00, 0x48cfe0, 0xffc857, 0xd66efd];

function createDriver(info){
  const local = info.id === net.id;
  const root = local ? carRoot : cloneCar(DRIVER_TINTS[info.color % DRIVER_TINTS.length]);
  const driver = {
    id: info.id, name: info.name, root, local,
    hp: info.hp, alive: info.alive, velocity: new THREE.Vector3(),
    targetX: info.x, targetZ: info.z, targetYaw: info.yaw,
    spawnX: info.x, spawnZ: info.z, spawnYaw: info.yaw,
    respawnRequested: false
  };
  root.position.set(info.x, 0, info.z);
  root.rotation.y = info.yaw;
  root.visible = info.alive;
  drivers.push(driver);
  if (local){
    localDriver = driver;
    yaw = info.yaw;
    speed = 0;
  }
  return driver;
}

function syncRoster(players){
  const incoming = new Set(players.map((player) => player.id));
  for (let i = drivers.length - 1; i >= 0; i--){
    const driver = drivers[i];
    if (incoming.has(driver.id)) continue;
    if (!driver.local) scene.remove(driver.root);
    drivers.splice(i, 1);
  }
  for (const info of players){
    let driver = drivers.find((item) => item.id === info.id);
    if (!driver) driver = createDriver(info);
    driver.name = info.name;
    driver.hp = info.hp;
    if (driver.alive && !info.alive) destroyDriver(driver);
    else if (!driver.alive && info.alive) reviveDriver(driver, info);
  }
  buildHealthHud();
}

function buildHealthHud(){
  const hud = $("s-health");
  hud.innerHTML = "";
  for (const driver of drivers){
    const row = document.createElement("div");
    row.className = "shp" + (driver.local ? " local" : "");
    row.innerHTML = '<span class="shp-name"></span><b class="shp-value"></b>' +
      '<span class="shp-track"><i></i></span>';
    row.querySelector(".shp-name").textContent = driver.name;
    hud.appendChild(row);
    driver.hud = row;
  }
}

function updateHealthHud(){
  for (const driver of drivers){
    if (!driver.hud) continue;
    driver.hud.classList.toggle("dead", !driver.alive);
    driver.hud.style.setProperty("--hp", clamp(driver.hp, 0, MAX_HP) + "%");
    driver.hud.querySelector(".shp-value").textContent = driver.alive ? driver.hp + " PV" : "DETRUIT";
  }
}

const debrisGeometry = new THREE.BoxGeometry(.22, .16, .32);
function explode(driver){
  for (let i = 0; i < 14; i++){
    const material = new THREE.MeshBasicMaterial({
      color: i % 3 ? 0xff4d00 : 0xede7da, transparent: true
    });
    const bit = new THREE.Mesh(debrisGeometry, material);
    bit.position.copy(driver.root.position).add(new THREE.Vector3(0, .8, 0));
    scene.add(bit);
    debris.push({
      mesh: bit,
      velocity: new THREE.Vector3((Math.random() - .5) * 10, 3 + Math.random() * 7, (Math.random() - .5) * 10),
      spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      life: 1.25
    });
  }
}

function destroyDriver(driver){
  if (!driver.alive) return;
  driver.hp = 0;
  driver.alive = false;
  driver.root.visible = false;
  driver.velocity.set(0, 0, 0);
  driver.respawnRequested = false;
  if (driver.local) speed = 0;
  explode(driver);
}

function reviveDriver(driver, state){
  driver.hp = state.hp === undefined ? MAX_HP : state.hp;
  driver.alive = true;
  driver.root.visible = true;
  driver.root.position.set(state.x, 0, state.z);
  driver.root.rotation.y = state.yaw;
  driver.targetX = state.x;
  driver.targetZ = state.z;
  driver.targetYaw = state.yaw;
  driver.spawnX = state.x;
  driver.spawnZ = state.z;
  driver.spawnYaw = state.yaw;
  driver.velocity.set(0, 0, 0);
  driver.respawnRequested = false;
  if (driver.local){
    yaw = state.yaw;
    speed = 0;
    shell.rotation.set(0, 0, 0);
    camFrom.set(state.x, 3, state.z + 7);
    camAim.set(state.x, .85, state.z);
  }
}

function step(dt){
  const c = controls();
  const v = Math.abs(speed);

  /* Plus on va vite, moins on braque : sinon la voiture se retourne sur
     une pichenette a 150. */
  const limit = MAX_STEER * (.30 + .70 / (1 + v * v / 210));
  const want = c.steer * limit;
  const rate = c.steer === 0 ? 9 : 6.5 - 3.2 * Math.min(1, v / 30);
  steerAngle += clamp(want - steerAngle, -rate * dt, rate * dt);

  accel = c.gas * ENGINE;
  if (c.brake > 0) accel -= c.brake * (speed > .4 ? BRAKE : ENGINE * .6);
  if (c.hand > 0) accel -= Math.sign(speed) * c.hand * HAND;
  accel -= DRAG * speed * v + ROLLRES * Math.sign(speed);

  speed = clamp(speed + accel * dt, -REV_TOP, TOP);
  if (!c.gas && !c.brake && Math.abs(speed) < .45) speed = 0;

  yawRate = (speed / WB) * Math.tan(steerAngle);
  yaw += yawRate * dt;
  carRoot.rotation.y = yaw;
  carRoot.position.x -= Math.sin(yaw) * speed * dt;
  carRoot.position.z -= Math.cos(yaw) * speed * dt;
  bump();

  /* Le trottoir se monte : la caisse s'y hisse au lieu d'y sauter. */
  lift += (curbAt(carRoot.position.x, carRoot.position.z) - lift) * damp(11, dt);
  carRoot.position.y = lift;

  /* Les roues. L'avant parcourt un peu plus de chemin que le centre
     quand il braque, d'ou le cosinus. */
  for (const w of wheels){
    const d = w.front ? speed * dt / Math.max(.25, Math.cos(steerAngle)) : speed * dt;
    w.spin.rotation.x = (w.spin.rotation.x - d / w.radius) % TAU;
    if (w.front) w.mount.rotation.y = steerAngle;
  }

  /* Transfert de masse : le nez se leve a l'acceleration, la caisse
     penche vers l'exterieur du virage. */
  const pitch = clamp(accel * .0052, -.05, .05);
  const roll = clamp(-yawRate * speed * .0042, -.07, .07);
  shell.rotation.x += (pitch - shell.rotation.x) * damp(8, dt);
  shell.rotation.z += (roll - shell.rotation.z) * damp(8, dt);

  return c;
}

function angleDelta(from, to){
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function stepRemoteDrivers(dt){
  for (const driver of drivers){
    if (driver.local || !driver.alive) continue;
    driver.root.position.x += (driver.targetX - driver.root.position.x) * damp(12, dt);
    driver.root.position.z += (driver.targetZ - driver.root.position.z) * damp(12, dt);
    driver.root.position.y = curbAt(driver.root.position.x, driver.root.position.z);
    driver.root.rotation.y += angleDelta(driver.root.rotation.y, driver.targetYaw) * damp(14, dt);
  }
}

function collideCars(now){
  if (localDriver && localDriver.alive){
    localDriver.velocity.set(-Math.sin(yaw) * speed, 0, -Math.cos(yaw) * speed);
  }
  for (let i = 0; i < drivers.length; i++) for (let j = i + 1; j < drivers.length; j++){
    const a = drivers[i], b = drivers[j];
    if (!a.alive || !b.alive) continue;
    if (!a.local && !b.local) continue;
    let nx = b.root.position.x - a.root.position.x;
    let nz = b.root.position.z - a.root.position.z;
    let distance = Math.hypot(nx, nz);
    if (distance >= HIT_DISTANCE) continue;
    if (distance < .001){ nx = 1; nz = 0; distance = 1; }
    else { nx /= distance; nz /= distance; }

    const local = a.local ? a : b;
    const sign = a.local ? -1 : 1;
    const overlap = HIT_DISTANCE - distance;
    local.root.position.x += nx * overlap * sign;
    local.root.position.z += nz * overlap * sign;
    const key = a.id < b.id ? a.id + ":" + b.id : b.id + ":" + a.id;
    if (now >= (hitTimes.get(key) || 0)){
      sendLocalState(now, true);
      speed *= -.18;
      hitTimes.set(key, now + 280);
    }
  }
}

function stepDebris(dt){
  for (let i = debris.length - 1; i >= 0; i--){
    const bit = debris[i];
    bit.life -= dt;
    if (bit.life <= 0){
      scene.remove(bit.mesh);
      bit.mesh.material.dispose();
      debris.splice(i, 1);
      continue;
    }
    bit.velocity.y -= 12 * dt;
    bit.mesh.position.addScaledVector(bit.velocity, dt);
    bit.mesh.rotation.x += bit.spin.x * dt;
    bit.mesh.rotation.y += bit.spin.y * dt;
    bit.mesh.rotation.z += bit.spin.z * dt;
    bit.mesh.material.opacity = Math.min(1, bit.life * 1.5);
  }
}

/* Les immeubles arretent la voiture. Ils sont ranges par pate de
   maisons : il suffit de regarder le pate courant et ses voisins. */
const CAR_R = 1.2;
function bump(){
  const gi = Math.floor((carRoot.position.x + HALF) / CELL);
  const gj = Math.floor((carRoot.position.z + HALF) / CELL);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++){
    const i = gi + a, j = gj + b;
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    for (const s of solids[i * N + j]) push(s);
  }
}

function push(s){
  const px = carRoot.position.x, pz = carRoot.position.z;
  const qx = clamp(px, s.x0, s.x1), qz = clamp(pz, s.z0, s.z1);
  let nx = px - qx, nz = pz - qz;
  const d = Math.hypot(nx, nz);
  let out;

  if (d > 1e-4){
    if (d >= CAR_R) return;
    nx /= d; nz /= d;
    out = CAR_R - d;
  } else {
    /* centre a l'interieur du mur : on ressort par la face la plus proche */
    const l = px - s.x0, r = s.x1 - px, n = pz - s.z0, f = s.z1 - pz;
    const m = Math.min(l, r, n, f);
    nx = m === l ? -1 : m === r ? 1 : 0;
    nz = nx !== 0 ? 0 : (m === n ? -1 : 1);
    out = m + CAR_R;
  }

  carRoot.position.x += nx * out;
  carRoot.position.z += nz * out;

  /* On ne garde que ce qui longe le mur : de plein fouet la voiture
     s'arrete, en rasant elle continue. */
  const into = -(-Math.sin(yaw) * nx - Math.cos(yaw) * nz) * Math.sign(speed);
  if (into > 0) speed *= 1 - .92 * clamp(into, 0, 1);
}

/* ============================================================
   7. MULTIJOUEUR
   Le serveur Rust arbitre les salons, les impacts et les PV.
   ============================================================ */

const LOCAL_SERVER = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const HTTP_SERVER = LOCAL_SERVER ? location.origin : "https://api.voidbelt.com";
const WS_SERVER = LOCAL_SERVER
  ? (location.protocol === "https:" ? "wss://" : "ws://") + location.host
  : "wss://api.voidbelt.com";
const net = { id: 0, room: "", socket: null, pingTimer: null, stateAt: 0, respawnAt: 0 };

function sendNet(message){
  if (net.socket && net.socket.readyState === WebSocket.OPEN)
    net.socket.send(JSON.stringify(message));
}

function beginOnline(){
  started = true;
  paused = false;
  $("s-intro").hidden = true;
  $("s-pause").hidden = true;
  if (window.PageScroll) PageScroll.lock();
}

function connectServer(code){
  if (net.socket) net.socket.close();
  const name = ($("s-name").value || "Pilote").trim().slice(0, 14);
  try { localStorage.setItem("shutdown.name", name); } catch (_) { /* private mode */ }
  const url = WS_SERVER + "/api/shutdown/ws?name=" + encodeURIComponent(name) +
    (code ? "&room=" + encodeURIComponent(code) : "");
  const socket = new WebSocket(url);
  net.socket = socket;
  $("s-net-state").textContent = "CONNEXION AU SERVEUR…";
  socket.addEventListener("open", () => {
    net.pingTimer = setInterval(() => sendNet({ t: "ping" }), 25000);
  });
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch (_) { return; }
    handleNet(message);
  });
  socket.addEventListener("close", () => {
    clearInterval(net.pingTimer);
    if (net.socket !== socket) return;
    net.socket = null;
    leaveServer("CONNEXION PERDUE — REJOIGNEZ UN SERVEUR");
  });
  socket.addEventListener("error", () => {
    $("s-net-state").textContent = "SERVEUR INJOIGNABLE";
  });
}

function handleNet(message){
  if (message.t === "joined"){
    net.id = message.id;
    net.room = message.room;
    $("s-room").textContent = "SERVEUR " + message.room;
  } else if (message.t === "roster"){
    syncRoster(message.players || []);
    if (localDriver) beginOnline();
  } else if (message.t === "s"){
    const driver = drivers.find((item) => item.id === message.id);
    if (driver && !driver.local){
      driver.targetX = message.x;
      driver.targetZ = message.z;
      driver.targetYaw = message.yaw;
      driver.velocity.set(message.vx || 0, 0, message.vz || 0);
    }
  } else if (message.t === "hit"){
    const a = drivers.find((item) => item.id === message.a);
    const b = drivers.find((item) => item.id === message.b);
    if (a){ a.hp = message.hp_a; if (!message.alive_a) destroyDriver(a); }
    if (b){ b.hp = message.hp_b; if (!message.alive_b) destroyDriver(b); }
    if (localDriver && !localDriver.alive) net.respawnAt = performance.now() + 4500;
  } else if (message.t === "respawn"){
    const driver = drivers.find((item) => item.id === message.id);
    if (driver) reviveDriver(driver, message);
  } else if (message.t === "left"){
    const driver = drivers.find((item) => item.id === message.id);
    if (driver && !driver.local){ scene.remove(driver.root); drivers.splice(drivers.indexOf(driver), 1); }
    buildHealthHud();
  } else if (message.t === "error"){
    const socket = net.socket;
    net.socket = null;
    if (socket) socket.close();
    leaveServer(message.m);
  }
}

function sendLocalState(now, force = false){
  if (!localDriver || !localDriver.alive || (!force && now - net.stateAt < 50)) return;
  net.stateAt = now;
  const vx = -Math.sin(yaw) * speed, vz = -Math.cos(yaw) * speed;
  localDriver.velocity.set(vx, 0, vz);
  sendNet({ t: "s", x: carRoot.position.x, z: carRoot.position.z, yaw, vx, vz });
}

function leaveServer(status){
  started = false;
  paused = false;
  net.id = 0;
  net.room = "";
  $("s-room").textContent = "DISTRICT 04";
  $("s-pause").hidden = true;
  $("s-intro").hidden = false;
  $("s-net-state").textContent = status || "CHOISISSEZ UN SERVEUR";
  for (const driver of drivers) if (!driver.local) scene.remove(driver.root);
  drivers.length = 0;
  localDriver = null;
  carRoot.visible = false;
  buildHealthHud();
  if (window.PageScroll) PageScroll.unlock();
  refreshRooms();
}

function refreshRooms(){
  fetch(HTTP_SERVER + "/api/shutdown/rooms", { headers: { accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then((rooms) => {
      $("s-net-state").textContent = rooms.length + " SERVEUR(S) OUVERT(S)";
      const list = $("s-rooms");
      list.innerHTML = "";
      for (const room of rooms){
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sbtn ghost sroom";
        button.disabled = room.players.length >= room.max;
        const code = document.createElement("b");
        code.textContent = room.code;
        const count = document.createElement("small");
        count.textContent = room.players.length + "/" + room.max;
        button.append(code, count);
        button.addEventListener("click", () => connectServer(room.code));
        list.appendChild(button);
      }
    })
    .catch(() => { $("s-net-state").textContent = "SERVEUR MULTIJOUEUR INJOIGNABLE"; });
}

/* ============================================================
   8. CAMERA
   Une poursuite molle, assez basse pour garder les roues dans le
   cadre. Le manche droit fait tourner le regard autour de la
   voiture sans toucher a sa trajectoire.
   ============================================================ */

const camFrom = new THREE.Vector3(0, 4, 9);
const camAim = new THREE.Vector3(0, 1.1, 0);
let lookYaw = 0, lookTilt = 0;

function moveCamera(dt, c){
  lookYaw += ((c.look || 0) * 1.15 - lookYaw) * damp(8, dt);
  lookTilt += ((c.tilt || 0) * .5 - lookTilt) * damp(8, dt);

  const v = Math.abs(speed);
  const back = 5.5 + v * .05;
  const high = 1.62 + v * .009 + lookTilt * 3.2;
  const a = yaw + lookYaw;

  const want = new THREE.Vector3(
    carRoot.position.x + Math.sin(a) * back,
    carRoot.position.y + high,
    carRoot.position.z + Math.cos(a) * back
  );
  camFrom.lerp(want, damp(6.5, dt));
  /* la camera ne traverse ni la chaussee ni un trottoir */
  camFrom.y = Math.max(camFrom.y, curbAt(camFrom.x, camFrom.z) + .55);
  camera.position.copy(camFrom);

  camAim.lerp(new THREE.Vector3(carRoot.position.x, carRoot.position.y + .85, carRoot.position.z),
              damp(9, dt));
  camera.lookAt(camAim);

  const fov = 60 + Math.min(16, v * .38);
  if (Math.abs(camera.fov - fov) > .01){
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  sun.position.copy(carRoot.position).add(SUN_OFF);
  sun.target.position.copy(carRoot.position);
}

/* ============================================================
   8. INTERFACE
   ============================================================ */

let started = false, paused = false, loaded = false;

function progress(p){
  const bar = $("s-bar");
  if (bar) bar.style.width = Math.round(clamp(p, 0, 1) * 100) + "%";
}

function ready(){
  loaded = true;
  $("s-load").hidden = true;
  $("s-intro").hidden = false;
  try { $("s-name").value = localStorage.getItem("shutdown.name") || "Pilote"; } catch (_) { /* private mode */ }
  refreshRooms();
}

function togglePause(){
  if (!started) return;
  paused = !paused;
  $("s-pause").hidden = !paused;
  if (window.PageScroll) paused ? PageScroll.unlock() : PageScroll.lock();
}

$("s-create").addEventListener("click", () => connectServer(""));
$("s-join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = $("s-code").value.replace(/\D/g, "").slice(0, 4);
  if (code.length === 4) connectServer(code);
  else $("s-net-state").textContent = "LE CODE DOIT CONTENIR 4 CHIFFRES";
});
$("s-code").addEventListener("input", () => {
  $("s-code").value = $("s-code").value.replace(/\D/g, "").slice(0, 4);
});
$("s-menu").addEventListener("click", togglePause);
$("s-resume").addEventListener("click", togglePause);
$("s-reset").addEventListener("click", () => { respawn(); togglePause(); });
$("s-quit").addEventListener("click", () => {
  const socket = net.socket;
  net.socket = null;
  if (socket) socket.close();
  leaveServer("SERVEUR QUITTE");
});
setInterval(() => { if (loaded && !started) refreshRooms(); }, 4000);

addEventListener("gamepadconnected", () => { if (!started && loaded) padHint(); });
addEventListener("gamepaddisconnected", () => padHint());

function padHint(){
  const el = $("s-pad");
  if (!el) return;
  el.textContent = padName ? "MANETTE " + padName : "AUCUNE MANETTE — CLAVIER ACTIF";
  el.classList.toggle("on", !!padName);
}

let hudAt = 0;
function hud(now){
  if (now - hudAt < 66) return;
  hudAt = now;
  $("s-speed").textContent = String(Math.round(Math.abs(speed) * 3.6)).padStart(3, "0");
  $("s-gear").textContent = speed < -.5 ? "R" : speed > .5 ? "D" : "N";
  updateHealthHud();
  padHint();
}

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

/* ============================================================
   BOUCLE
   ============================================================ */

let last = performance.now();
const idle = { steer: 0, gas: 0, brake: 0, hand: 0, look: 0, tilt: 0, pad: false };

renderer.setAnimationLoop((now) => {
  const dt = Math.min(.05, (now - last) / 1000) || 0;
  last = now;

  let c = idle;
  if (paused){ /* la ville se fige ; la camera, elle, revient se ranger */ }
  else if (started){
    if (localDriver && localDriver.alive) c = step(dt);
    else {
      controls();
      if (localDriver && now >= net.respawnAt && !localDriver.respawnRequested){
        localDriver.respawnRequested = true;
        sendNet({ t: "respawn" });
      }
    }
    stepRemoteDrivers(dt);
    sendLocalState(now);
    collideCars(now);
    stepDebris(dt);
  }
  else controls();   // on lit quand meme la manette : un bouton lance la partie

  moveCamera(dt, c);
  hud(now);

  renderer.render(scene, camera);
});
