//! Le dessin du circuit : une suite d'elements que la tortue de `track.rs`
//! enchaine. Angles en degres (positif = droite, ou = monte), rayons et
//! longueurs en metres.
//!
//! Pour modifier le circuit, on edite cette liste, puis on relance
//! `construire-circuit.ps1` : la physique et le modele 3D en derivent tous
//! les deux, ils ne peuvent pas diverger.

#[derive(Clone, Copy, Debug)]
pub enum Seg {
    Straight(f32),
    /// Virage autour de la verticale ; `bank` = devers au plus fort (deg),
    /// `climb` = denivele pris pendant le virage (m, negatif = descend).
    Turn { deg: f32, r: f32, bank: f32, climb: f32 },
    /// Changement de pente.
    Pitch { deg: f32, r: f32 },
    /// Looping complet, decale de `shift` m vers la droite pour que la
    /// sortie passe a cote de l'entree.
    Loop { r: f32, shift: f32 },
    /// Porte de checkpoint a cet endroit ; la derniere est l'arrivee.
    Checkpoint,
    /// Debut (`true`) ou fin (`false`) d'un trou : pas de route entre les
    /// deux, la voiture y vole (vol.rs). Le trace continue dessous, invisible,
    /// pour situer la reception.
    Trou(bool),
    /// Le sol change a partir d'ici (asphalte par defaut).
    Sol(crate::surface::Sol),
}

use Seg::*;

#[allow(dead_code)]
const fn turn(deg: f32, r: f32, bank: f32) -> Seg {
    Turn { deg, r, bank, climb: 0.0 }
}

/// Virage qui monte ou descend en meme temps qu'il tourne.
const fn curve(deg: f32, r: f32, bank: f32, climb: f32) -> Seg {
    Turn { deg, r, bank, climb }
}

const fn pitch(deg: f32, r: f32) -> Seg {
    Pitch { deg, r }
}

// Trace « vertige », taille pour 600 km/h : les virages a 90 degres du
// trace tech gardent leur place, mais la piste ne reste pas a plat. Elle
// grimpe en spirale vers le sommet, plonge a 45 degres vers la mer,
// redescend en tire-bouchon (avec un wallride), remonte en escalier de
// virages, passe une falaise en deux paliers et saute avant l'arrivee. La
// voiture colle a la piste (adherence magnetique) ; la gravite agit le long
// de la route : les montees ralentissent, les descentes relancent.

/// Module droit de Trackmania : toute ligne droite en fait un nombre entier.
pub const BLOC: f32 = 32.0;
const L: Seg = Straight(2.0 * BLOC);

pub const TRACE: &[Seg] = &[
    Straight(3.0 * BLOC),
    // --- envol : spirale qui monte au sommet ----------------------------------
    turn(90.0, 300.0, 14.0),
    L,
    curve(-180.0, 230.0, 24.0, 170.0),
    pitch(10.0, 300.0),
    Straight(2.0 * BLOC),
    pitch(-10.0, 300.0),
    turn(90.0, 90.0, 6.0),
    Checkpoint,
    // --- le grand plongeon : 45 degres vers la mer ------------------------------
    Straight(2.0 * BLOC),
    pitch(-45.0, 180.0),
    Straight(7.0 * BLOC),
    pitch(45.0, 240.0),
    turn(-90.0, 260.0, 12.0),
    L,
    curve(90.0, 120.0, 10.0, -20.0),
    Checkpoint,
    // --- tire-bouchon : plus d'un tour en descendant ----------------------------
    curve(-450.0, 170.0, 26.0, -230.0),
    L,
    // wallride : le virage se releve presque a la verticale
    turn(90.0, 220.0, 75.0),
    Checkpoint,
    Straight(2.0 * BLOC),
    Loop { r: 70.0, shift: 44.0 },
    // --- escalier de virages qui grimpent ---------------------------------------
    curve(90.0, 300.0, 18.0, 130.0),
    turn(-90.0, 100.0, 8.0),
    curve(90.0, 300.0, 18.0, 130.0),
    turn(-90.0, 100.0, 8.0),
    Checkpoint,
    // --- falaise en deux paliers -------------------------------------------------
    pitch(-35.0, 200.0),
    Straight(5.0 * BLOC),
    pitch(35.0, 200.0),
    turn(90.0, 100.0, 8.0),
    L,
    pitch(-35.0, 200.0),
    Straight(5.0 * BLOC),
    pitch(35.0, 200.0),
    Checkpoint,
    // --- derniere equerre, looping, sortie ---------------------------------------
    turn(-90.0, 340.0, 12.0),
    Straight(2.0 * BLOC),
    Loop { r: 65.0, shift: -44.0 },
    curve(-90.0, 300.0, 14.0, 40.0),
    L,
    turn(90.0, 110.0, 8.0),
    // --- le saut : un vide d'une centaine de metres au-dessus de la mer, la
    // reception 6,5 m plus bas, a plat. Il faut ~320 km/h pour passer ; a
    // 470, on se pose une cinquantaine de metres apres le bord.
    Straight(3.0 * BLOC),
    Trou(true),
    pitch(-6.0, 300.0),
    Straight(BLOC),
    pitch(6.0, 300.0),
    Trou(false),
    Straight(6.0 * BLOC),
    Checkpoint,
    Straight(3.0 * BLOC),
];
