// Ce qui est reellement en trois dimensions dans une scene vue de dessus :
// la balle, et la lumiere qui l'eclaire.
//
// Tout le reste — terrain, decor, voitures, plots — reste des planches
// peintes, affichees telles quelles sans etre eclairees. Elles portent deja
// leur propre lumiere, celle du dessin. Les sources ajoutees ici ne touchent
// donc que la balle, seul objet a materiau sensible a la lumiere ; l'ombre,
// elle, se pose sur une surface transparente tendue au-dessus du terrain,
// qui ne montre que les ombres et ne noircit pas la planche.

import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

/** Duree d'un tour complet du soleil, en secondes. Assez lent pour qu'une
 *  ombre ne bouge pas sous les yeux, assez vif pour qu'un match en voie le
 *  quart : le terrain ne s'eclaire pas de la meme facon au bout de cinq
 *  minutes qu'au coup d'envoi. */
const CYCLE = 240;
/** Hauteur du soleil. Il ne se couche jamais vraiment : sous cette barre,
 *  les ombres s'allongeraient jusqu'a sortir du terrain. */
const HAUTEUR = 0.72;
/** Teintes traversees dans le tour : chaude au ras, franche au zenith. */
const RASANT = new THREE.Color(0xffb870);
const ZENITH = new THREE.Color(0xfff4e2);

/** Lumiere du stade et son cycle. Renvoie de quoi l'avancer. */
export function makeSky(scene, geom) {
  const { boardW: w, boardH: h } = geom;
  const centre = new THREE.Vector3(w / 2, -h / 2, 0);

  // Un fond d'ambiance genereux : la balle ne doit jamais devenir une
  // silhouette noire du cote oppose au soleil.
  scene.add(new THREE.AmbientLight(0xdfe7f5, 1.35));

  const soleil = new THREE.DirectionalLight(0xfff0dd, 1.5);
  soleil.castShadow = true;
  soleil.target.position.copy(centre);
  scene.add(soleil, soleil.target);

  // La camera d'ombre couvre le terrain entier : une fois posee, elle ne
  // bouge plus, seul le soleil tourne autour.
  const c = soleil.shadow.camera;
  c.left = -w / 2;
  c.right = w / 2;
  c.top = h / 2;
  c.bottom = -h / 2;
  c.near = 1;
  c.far = w * 2;
  soleil.shadow.mapSize.set(1024, 1024);
  soleil.shadow.bias = -0.0015;

  // Receveur d'ombres : invisible, il ne rend que ce qui l'assombrit. Sans
  // lui il faudrait rendre le terrain sensible a la lumiere, ce qui
  // eteindrait le dessin du stade.
  const sol = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    // Sans `depthWrite`, il ne s'interpose pas dans l'ordre d'affichage :
    // toute la scene est faite de plans transparents empiles par leur cote.
    new THREE.ShadowMaterial({ opacity: 0.32, depthWrite: false }),
  );
  // Au-dessus du decor et des plots, sous les traces de gomme : l'ombre
  // passe donc sur le terrain et sur les plots, mais pas sur les voitures.
  sol.position.set(w / 2, -h / 2, 2.6);
  sol.receiveShadow = true;
  scene.add(sol);

  const rayon = Math.max(w, h) * 0.85;
  return function avance(temps) {
    const t = (temps % CYCLE) / CYCLE;
    const a = t * Math.PI * 2;
    soleil.position.set(
      centre.x + Math.cos(a) * rayon,
      centre.y + Math.sin(a) * rayon * 0.55,
      rayon * HAUTEUR,
    );
    // Deux passages au ras par tour : le soleil se rechauffe et faiblit
    // en bord de course, comme au lever et au coucher.
    const bas = Math.abs(Math.sin(a));
    soleil.color.copy(RASANT).lerp(ZENITH, 1 - bas);
    soleil.intensity = 1.15 + (1 - bas) * 0.55;
  };
}

/** Les huit lampes Area de `ball.blend`, aux coins d'un cube autour de la
 *  balle (rayon 1) et tournees vers elle. glTF ne sait pas decrire une
 *  lampe de surface : l'export les perd, on les recopie donc ici, position
 *  et teinte. Blender est en Z vers le haut, comme cette scene. */
const LAMPES = [
  [-3.1, -4.0, 4.1, 0xffd69e], [3.1, -4.0, 4.1, 0xffffff],
  [-3.1, 4.0, 4.1, 0xb39670], [3.1, 4.0, 4.1, 0xffffff],
  [-3.1, 4.0, -4.1, 0xffd69e], [3.1, 4.0, -4.1, 0xffffff],
  [-3.1, -4.0, -4.1, 0xb39670], [3.1, -4.0, -4.1, 0xffffff],
];
/** Eclat des panneaux : c'est lui qui regle la clarte de la balle. */
const ECLAT = 60;
/** Le fond gris du monde de Blender, qui debouche les zones sans lampe. */
const FOND = 0x303030;

/** Le studio de Blender, reduit a son reflet. La balle est metallique : un
 *  metal ne renvoie que ce qui l'entoure, et sans entourage il vire au noir.
 *  On photographie donc une fois les panneaux lumineux tout autour d'un
 *  point, et la balle s'y reflete. Ils ne tournent pas avec elle : un
 *  reflet appartient au monde, pas a l'objet. */
function studio(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOND);
  const panneau = new THREE.PlaneGeometry(1, 1);
  for (const [x, y, z, teinte] of LAMPES) {
    const lampe = new THREE.Mesh(panneau, new THREE.MeshBasicMaterial({
      color: new THREE.Color(teinte).multiplyScalar(ECLAT),
      side: THREE.DoubleSide,
    }));
    lampe.position.set(x, y, z);
    lampe.lookAt(0, 0, 0);
    scene.add(lampe);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const carte = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  return carte;
}

/** Charge la balle en trois dimensions. Tant qu'elle n'est pas la, c'est
 *  le disque peint qui tient le role : un reseau lent ne doit pas priver
 *  de balle, et un fichier absent non plus. */
export function makeBall(groupe, geom, renderer, onReady) {
  new GLTFLoader().load(
    'assets/ball/ball.glb',
    (gltf) => {
      const modele = gltf.scene;
      const boite = new THREE.Box3().setFromObject(modele);
      const taille = boite.getSize(new THREE.Vector3());
      const centre = boite.getCenter(new THREE.Vector3());
      const rayon = Math.max(taille.x, taille.y, taille.z) / 2;
      const reflet = studio(renderer);

      modele.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = false;
        // On recentre la geometrie elle-meme, et non l'objet. Deplacer
        // l'objet laisse le pivot a l'origine du modele : la balle se
        // mettait alors a graviter autour d'un point decale au lieu de
        // tourner sur elle-meme, ce qui ne ressemblait plus a rien.
        o.geometry.translate(-centre.x, -centre.y, -centre.z);
        // Le dessin de la balle vient de sa texture : on ne veut pas que
        // le moteur de rendu la reinterprete comme une couleur lineaire.
        if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
        o.material.envMap = reflet;
      });
      // Le modele arrive a la taille ou il a ete dessine : on le ramene au
      // rayon que le moteur applique, quel qu'il soit.
      if (rayon > 1e-6) modele.scale.setScalar(geom.ballR / rayon);
      groupe.add(modele);
      onReady?.(modele);
    },
    undefined,
    (err) => console.warn('balle 3D indisponible, on garde le disque :', err),
  );
}

/** Pose l'orientation calculee par le moteur. Rien ne s'accumule ici :
 *  une rotation est un etat, elle appartient a la simulation, et deux
 *  clients en ligne doivent voir la meme balle tourner pareil. */
export function applySpin(modele, state, base) {
  if (!modele) return;
  modele.quaternion.set(state[base], state[base + 1], state[base + 2], state[base + 3]);
}
