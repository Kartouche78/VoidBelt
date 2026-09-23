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

/// Demi-hauteur de la bouche de but, et profondeur des filets, par
/// defaut. La profondeur suit le fond du filet peint sur les calques de
/// cage : a 90, une voiture s'y enfoncait d'une largeur de caisse au-dela
/// du dessin. Chaque stade peut s'en ecarter, voir `Cage`.
pub const GOAL_HALF: f32 = 86.0;
pub const GOAL_DEPTH: f32 = 67.0;
/// Retrait de la bouche de but par rapport au muret. Il vaut zero : la
/// bouche est dans le plan du muret, qui file donc droit d'un coin a
/// l'autre. Une bouche en retrait creusait une poche entre le montant et
/// le muret, qu'il fallait rattraper par un biseau ; le muret n'etait
/// alors plus une ligne droite, et une planche de stade non plus.
pub const GOAL_FRONT: f32 = 0.0;
/// Rayon d'arrondi des poteaux. Le montant est l'angle ou le muret se
/// retourne en joue de filet ; arrondi, il renvoie une balle selon l'endroit
/// ou elle le mord, de plein fouet comme en biais, au lieu d'un angle vif
/// qui la laissait filer d'un cote ou de l'autre.
pub const POST_R: f32 = 10.0;
/// Surepaisseur du poteau. Le montant est un disque d'un rayon de poteau
/// plus cette valeur, affleurant le muret : il ne deborde jamais sur le
/// terrain, mais mord d'autant sur la bouche du but, cote joue.
pub const POST_BULGE: f32 = 2.0;

/// Forme des buts d'un stade : demi-ouverture, profondeur du filet et
/// rayon des poteaux. Chaque planche peint ses cages a sa facon, et F6 les
/// cale en jeu ; ce sont des reglages (`goal_half`, `goal_depth`, `post_r`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cage {
    pub half: f32,
    pub depth: f32,
    pub post: f32,
}

impl Cage {
    pub const FACTORY: Cage = Cage { half: GOAL_HALF, depth: GOAL_DEPTH, post: POST_R };

    /// Bornee a ce qui reste un but : un reglage aberrant ne doit ni fermer
    /// la bouche, ni l'ouvrir sur toute la largeur du muret.
    pub fn new(half: f32, depth: f32, post: f32) -> Cage {
        Cage {
            half: half.clamp(30.0, 200.0),
            depth: depth.clamp(15.0, 150.0),
            post: post.clamp(0.0, 40.0),
        }
    }
}


/// Le tir allait-il au but de cette equipe ? On prolonge la trajectoire
/// jusqu'au plan de but et on regarde si elle passe dans la bouche. Sert a
/// reconnaitre un arret : une balle cadree qui ne l'est plus.
pub fn on_target(p: V2, v: V2, team: u8, cage: &Cage) -> bool {
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
    (p.y + v.y * t - CY).abs() < cage.half
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
pub fn in_goal_lane(y: f32, cage: &Cage) -> bool {
    (y - CY).abs() < cage.half
}

/// Equipe dont le but vient d'etre franchi, une fois la balle entierement
/// derriere la ligne. 0 = bleu (but a gauche), 1 = orange (but a droite).
pub fn conceded(p: V2, r: f32, cage: &Cage) -> Option<u8> {
    if !in_goal_lane(p.y, cage) {
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
/// `post` dit si c'est l'arrondi d'un poteau qui a ete touche, et non un
/// muret ou le filet : le poteau a son propre bruit.
pub struct Hit {
    pub n: V2,
    pub depth: f32,
    pub post: bool,
}

fn push(n: V2, depth: f32) -> Option<Hit> {
    if depth > 0.0 {
        Some(Hit { n, depth, post: false })
    } else {
        None
    }
}

/// Contact d'un disque de rayon `r` avec l'enceinte. La bouche des buts est
/// ouverte : on y bascule sur les parois du filet, poteaux compris.
pub fn contact(p: V2, r: f32, corner: f32, cage: &Cage) -> Option<Hit> {
    // Un arrondi ne peut deborder de la demi-largeur du terrain, ni etre
    // negatif : une valeur aberrante venue d'un reglage ferait un terrain
    // sans milieu plutot que d'echouer franchement.
    let corner = corner.clamp(0.0, (MAX_Y - MIN_Y) * 0.5);
    let ecart = (p.y - CY).abs();
    // Autour des buts, c'est le montant qui borne : muret, poteau et joue de
    // filet y forment un seul solide. La bande est elargie d'un rayon de
    // mobile et d'un rayon de poteau, pour qu'un corps qui arrive par
    // l'exterieur trouve l'arrondi avant le muret droit.
    let but = if ecart < cage.half + cage.post + POST_BULGE + r {
        goal_contact(p, r, cage)
    } else {
        None
    };
    // Face a la bouche, rien d'autre ne borne : l'enceinte la fermerait,
    // puisque le muret arrete un mobile a un rayon de son plan. Au-dela de
    // l'arrondi du poteau, en revanche, le muret reprend — et avec lui les
    // coins, qu'une cage tres ouverte pourrait sinon venir chevaucher.
    if ecart < cage.half + cage.post {
        return but;
    }
    deepest(but, enclosure(p, r, corner))
}

/// Le plus enfonce de deux contacts : c'est lui qu'il faut resoudre.
fn deepest(a: Option<Hit>, b: Option<Hit>) -> Option<Hit> {
    match (a, b) {
        (Some(a), Some(b)) => Some(if a.depth > b.depth { a } else { b }),
        (a, b) => a.or(b),
    }
}

/// Rectangle a coins arrondis : on ramene le centre dans le rectangle
/// interieur, la distance restante decrit aussi bien les bords droits
/// (distance nulle sur un axe) que les arcs de coin.
fn enclosure(p: V2, r: f32, corner: f32) -> Option<Hit> {
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

/// Contact pres d'un but : fond du filet, et le solide qui entoure la
/// bouche — muret d'un cote du poteau, joue du filet de l'autre, le
/// poteau arrondi entre les deux.
///
/// On travaille dans le repere du poteau le plus proche : `u` croit en
/// s'enfoncant dans le filet, `w` en s'eloignant de l'axe du but au-dela
/// du poteau. Le solide est le quart de plan `u >= 0, w >= 0`, coin
/// arrondi du rayon du poteau : le muret en est la face `u = 0`, la joue la face
/// `w = 0`. Un seul calcul donne donc les trois surfaces et leurs
/// raccords, sans jamais laisser d'angle par ou la balle se faufile.
fn goal_contact(p: V2, r: f32, cage: &Cage) -> Option<Hit> {
    let left = p.x < CX;
    // Sens qui s'enfonce dans le filet, et cote du poteau le plus proche.
    let sx = if left { -1.0 } else { 1.0 };
    let sy = if p.y < CY { -1.0 } else { 1.0 };
    let u = (p.x - goal_mouth(left)) * sx;
    let w = (p.y - CY).abs() - cage.half;
    let rp = cage.post;

    let fond = if u + r > cage.depth {
        Some(Hit { n: v2(-sx, 0.0), depth: u + r - cage.depth, post: false })
    } else {
        None
    };

    // Distance au quart de plan retreci du rayon du poteau, puis on regonfle.
    let d = v2(u - u.max(rp), w - w.max(rp));
    let l = d.len();
    let (n, depth) = if l > 1e-6 {
        (d.mul(1.0 / l), r + rp - l)
    } else if u < w {
        // Centre en plein dans le montant : on ressort par la face la plus
        // proche, cote terrain ou cote filet.
        (v2(-1.0, 0.0), u + r)
    } else {
        (v2(0.0, -1.0), w + r)
    };
    // Sur une face droite, l'un des deux ecarts est nul : muret ou joue.
    // Les deux a la fois, c'est l'arrondi, donc le poteau.
    let arrondi = l > 1e-6 && d.x != 0.0 && d.y != 0.0;
    let montant = push(v2(n.x * sx, n.y * sy), depth).map(|h| Hit { post: arrondi, ..h });

    // Le poteau lui-meme : un disque plus large que l'arrondi, recule
    // d'autant dans le filet pour affleurer le muret sans le depasser. Il
    // deborde donc la joue de `POST_BULGE`, vers l'axe du but.
    let c = v2(u - (rp + POST_BULGE), w - rp);
    let lc = c.len();
    let poteau = if lc > 1e-6 {
        let nc = c.mul(1.0 / lc);
        push(v2(nc.x * sx, nc.y * sy), r + rp + POST_BULGE - lc).map(|h| Hit { post: true, ..h })
    } else {
        None
    };
    deepest(fond, deepest(montant, poteau))
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
