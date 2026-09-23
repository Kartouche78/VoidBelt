//! Geometrie du stade et rebonds sur les murs.
//!
//! Le repere monde est celui des planches PNG (1672 x 941) : un pixel de
//! `terrain.png` compose vaut une unite. Les bornes ci-dessous ne suivent
//! plus une planche en particulier : chaque stade recale son decor dessus,
//! et `assets/stadium/Gabarit.jpg` en porte le trace exact.

use crate::vec::{v2, V2};

pub const BOARD_W: f32 = 1672.0;
pub const BOARD_H: f32 = 941.0;

// Faces interieures des murets, relevees sur la decoupe transparente de
// `stade.png`. La planche du terrain se pose desormais a l'echelle 1:1 sur
// celle du stade : ces bornes sont donc directement celles du dessin.
pub const MIN_X: f32 = 173.0;
pub const MAX_X: f32 = 1498.0;
// Cinq unites gagnees en haut et en bas sur la mesure d'origine (130 et
// 779) : l'aire de jeu passe de 649 a 659 de haut. Le centre, lui, ne
// bouge pas, donc engagements et cages restent ou ils etaient.
pub const MIN_Y: f32 = 125.0;
pub const MAX_Y: f32 = 784.0;
/// Rayon d'arrondi des coins, par defaut. Chaque stade peint les siens a
/// sa facon : la valeur en vigueur est un reglage (`arena_corner`), celle-ci
/// n'est que le point de depart, celui de la planche d'origine.
pub const CORNER: f32 = 46.0;

pub const CX: f32 = (MIN_X + MAX_X) * 0.5;
pub const CY: f32 = (MIN_Y + MAX_Y) * 0.5;

/// Demi-hauteur de la bouche de but, et profondeur des filets. La
/// profondeur suit le fond du filet peint sur les calques de cage : a 90,
/// une voiture s'y enfoncait d'une largeur de caisse au-dela du dessin.
pub const GOAL_HALF: f32 = 86.0;
pub const GOAL_DEPTH: f32 = 67.0;
/// Retrait de la bouche de but par rapport au muret. Il vaut zero : la
/// bouche est dans le plan du muret, qui file donc droit d'un coin a
/// l'autre. Une bouche en retrait creusait une poche entre le montant et
/// le muret, qu'il fallait rattraper par un biseau ; le muret n'etait
/// alors plus une ligne droite, et une planche de stade non plus.
pub const GOAL_FRONT: f32 = 0.0;


/// Le tir allait-il au but de cette equipe ? On prolonge la trajectoire
/// jusqu'au plan de but et on regarde si elle passe dans la bouche. Sert a
/// reconnaitre un arret : une balle cadree qui ne l'est plus.
pub fn on_target(p: V2, v: V2, team: u8) -> bool {
    let mouth = goal_mouth(team == 0);
    let dx = mouth - p.x;
    // Il faut aller vers ce but, et assez vite pour que ce soit un tir.
    if dx * v.x <= 0.0 || v.x.abs() < 60.0 {
        return false;
    }
    let t = dx / v.x;
    if !(0.0..=2.5).contains(&t) {
        return false;
    }
    (p.y + v.y * t - CY).abs() < GOAL_HALF
}

/// Plan de la bouche de but d'un cote ou de l'autre.
pub fn goal_mouth(left: bool) -> f32 {
    if left {
        MIN_X + GOAL_FRONT
    } else {
        MAX_X - GOAL_FRONT
    }
}

/// Renvoie `true` si `y` est dans la bande verticale des buts.
pub fn in_goal_lane(y: f32) -> bool {
    (y - CY).abs() < GOAL_HALF
}

/// Equipe dont le but vient d'etre franchi, une fois la balle entierement
/// derriere la ligne. 0 = bleu (but a gauche), 1 = orange (but a droite).
pub fn conceded(p: V2, r: f32) -> Option<u8> {
    if !in_goal_lane(p.y) {
        return None;
    }
    if p.x + r < goal_mouth(true) {
        Some(0)
    } else if p.x - r > goal_mouth(false) {
        Some(1)
    } else {
        None
    }
}

/// Position de reprise d'engagement d'une equipe : dos au but, face au centre.
pub fn kickoff(team: u8) -> (V2, f32) {
    kickoff_nth(team, 0, 1)
}

/// Placement d'engagement de la `rank`-ieme voiture d'un camp qui en compte
/// `count`. Seule sur son camp elle prend l'axe, comme en un contre un ;
/// a plusieurs le camp s'etale en hauteur et se met en quinconce, pour que
/// personne ne demarre dans le pare-chocs du voisin.
pub fn kickoff_nth(team: u8, rank: usize, count: usize) -> (V2, f32) {
    let room = (MAX_Y - MIN_Y) * 0.5 - 70.0;
    let spread = room.min(70.0 * count as f32);
    let off = if count <= 1 {
        0.0
    } else {
        (rank as f32 / (count - 1) as f32 - 0.5) * 2.0
    };
    let y = CY + off * spread;
    let back = 300.0 + (rank % 2) as f32 * 70.0;
    if team == 0 {
        (v2(MIN_X + back, y), 0.0)
    } else {
        (v2(MAX_X - back, y), std::f32::consts::PI)
    }
}

/// Point de reapparition apres une demolition : au fond de son camp.
pub fn respawn(team: u8, rank: usize) -> (V2, f32) {
    // Decale le long du fond : a dix joueurs, plusieurs carcasses peuvent
    // revenir en meme temps et ne doivent pas reapparaitre l'une dans l'autre.
    let room = (MAX_Y - MIN_Y) * 0.5 - 60.0;
    let step = 90.0 * (rank / 2) as f32;
    let side = if rank % 2 == 0 { -1.0 } else { 1.0 };
    let y = (CY + side * (210.0 + step).min(room)).clamp(MIN_Y + 60.0, MAX_Y - 60.0);
    if team == 0 {
        (v2(MIN_X + 70.0, y), 0.0)
    } else {
        (v2(MAX_X - 70.0, y), std::f32::consts::PI)
    }
}

/// Un contact resolu : normale sortante et profondeur de penetration.
pub struct Hit {
    pub n: V2,
    pub depth: f32,
}

fn push(n: V2, depth: f32) -> Option<Hit> {
    if depth > 0.0 {
        Some(Hit { n, depth })
    } else {
        None
    }
}

/// Contact d'un disque de rayon `r` avec l'enceinte. La bouche des buts est
/// ouverte : on y bascule sur les parois du filet, poteaux compris.
pub fn contact(p: V2, r: f32, corner: f32) -> Option<Hit> {
    // Un arrondi ne peut deborder de la demi-largeur du terrain, ni etre
    // negatif : une valeur aberrante venue d'un reglage ferait un terrain
    // sans milieu plutot que d'echouer franchement.
    let corner = corner.clamp(0.0, (MAX_Y - MIN_Y) * 0.5);
    // Dans la bande des buts, la bouche est ouverte sur toute la hauteur du
    // muret : seul le filet borne, et rien ne barre l'entree. Y laisser
    // l'enceinte la fermerait, puisque le muret arrete un mobile a un rayon
    // de son plan, donc avant qu'il ait pu franchir la ligne.
    if in_goal_lane(p.y) {
        return net_contact(p, r);
    }
    // Rectangle a coins arrondis : on ramene le centre dans le rectangle
    // interieur, la distance restante decrit aussi bien les bords droits
    // (distance nulle sur un axe) que les arcs de coin. Les murets sont
    // deux lignes droites, la bouche des buts s'y ouvre sans decrochement.
    let qx = p.x.clamp(MIN_X + corner, MAX_X - corner);
    let qy = p.y.clamp(MIN_Y + corner, MAX_Y - corner);
    let d = p.sub(v2(qx, qy));
    let l = d.len();
    if l <= corner - r {
        return None;
    }
    let n = if l > 1e-6 { d.mul(-1.0 / l) } else { v2(0.0, 1.0) };
    push(n, l - (corner - r))
}

/// Parois interieures d'un filet : fond et deux joues, la bouche reste libre.
fn net_contact(p: V2, r: f32) -> Option<Hit> {
    let left = p.x < CX;
    let mouth = goal_mouth(left);
    let back = if left {
        mouth - GOAL_DEPTH
    } else {
        mouth + GOAL_DEPTH
    };
    if left && p.x - r < back {
        return push(v2(1.0, 0.0), back - (p.x - r));
    }
    if !left && p.x + r > back {
        return push(v2(-1.0, 0.0), (p.x + r) - back);
    }
    // Les joues ne mordent qu'une fois la bouche franchie, sinon elles
    // repousseraient une balle qui longe simplement la ligne de but.
    let inside = if left { p.x < mouth } else { p.x > mouth };
    if !inside {
        return None;
    }
    if p.y - r < CY - GOAL_HALF {
        return push(v2(0.0, 1.0), (CY - GOAL_HALF) - (p.y - r));
    }
    if p.y + r > CY + GOAL_HALF {
        return push(v2(0.0, -1.0), (p.y + r) - (CY + GOAL_HALF));
    }
    None
}

/// Applique un contact : on ressort le mobile puis on reflechit la vitesse,
/// `rest` pour le rebond normal et `fric` pour le glissement tangentiel.
pub fn bounce(p: &mut V2, v: &mut V2, h: &Hit, rest: f32, fric: f32) -> f32 {
    *p = p.add(h.n.mul(h.depth));
    let vn = v.dot(h.n);
    if vn >= 0.0 {
        return 0.0;
    }
    let t = h.n.perp();
    let vt = v.dot(t);
    *v = h.n.mul(-vn * rest).add(t.mul(vt * fric));
    -vn
}
