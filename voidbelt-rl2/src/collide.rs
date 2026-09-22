//! Contacts entre mobiles : frappe de balle, bourrade et demolition.

use crate::ball::Ball;
use crate::tune::Tune;
use crate::car::Car;
use crate::arena;

/// Restitution voiture / balle : presque nulle, Rocket League ajoute a la
/// place une poussee dediee (ci-dessous) pour donner du punch aux frappes.
pub const BALL_REST: f32 = 0.05;
pub const CAR_REST: f32 = 0.25;
/// Part de la vitesse de rapprochement rendue en poussee. La bousculade doit
/// se sentir sans catapulter : au-dela du seuil c'est une demolition, en
/// dessous cela reste une epaule dans l'epaule.
pub const BUMP_GAIN: f32 = 0.30;
/// Poussee plancher, pour qu'un contact au ralenti ecarte quand meme.
pub const BUMP_FLOOR: f32 = 30.0;
/// Plafond de la bousculade. Sans lui, un choc juste sous le seuil de
/// demolition enverrait la voiture a l'autre bout du terrain.
pub const BUMP_CAP: f32 = 120.0;
pub const CAR_R: f32 = 12.40;

/// Poussee supplementaire d'une frappe selon la vitesse du chassis, reprise
/// de la table du jeu (0, 500, 1000, 1500, 1750, 2300 uu/s) ramenee a notre
/// echelle : elle croit vite puis sature, d'ou les frappes molles a l'arret.
pub const PUSH: [(f32, f32); 6] = [
    (0.0, 0.0),
    (134.7, 43.1),
    (269.5, 70.3),
    (404.3, 88.4),
    (471.6, 94.3),
    (619.8, 110.8),
];

/// Vitesses des six paliers de la table de poussee. Seules les hauteurs se
/// reglent : deplacer aussi les abscisses rendrait la courbe illisible dans
/// l'interface pour un gain nul.
fn push_curve(t: &Tune) -> [(f32, f32); 6] {
    let y = [t.push_0, t.push_1, t.push_2, t.push_3, t.push_4, t.push_5];
    let mut out = PUSH;
    for (i, slot) in out.iter_mut().enumerate() {
        slot.1 = y[i];
    }
    out
}

fn push_scale(speed: f32, tune: &Tune) -> f32 {
    let table = push_curve(tune);
    let mut prev = table[0];
    for &cur in table.iter().skip(1) {
        if speed <= cur.0 {
            let k = (speed - prev.0) / (cur.0 - prev.0).max(1e-6);
            return prev.1 + (cur.1 - prev.1) * k;
        }
        prev = cur;
    }
    table[table.len() - 1].1
}

/// Vitesse de fermeture minimale pour qu'un coincement se declenche, en
/// unites/s. En dessous, une voiture qui pousse tranquillement la balle
/// contre un muret la pousse, simplement.
pub const PINCH_MIN: f32 = 140.0;
/// Multiplicateur applique a cette vitesse de fermeture.
pub const PINCH_GAIN: f32 = 2.6;
/// Plafond de sortie. La balle plafonne de toute facon a `ball_max_speed` ;
/// celui-ci borne le coincement lui-meme, pour qu'il reste une frappe
/// exceptionnelle et non un raccourci vers la vitesse maximale.
pub const PINCH_MAX: f32 = 1400.0;
/// Part de l'echappee dirigee loin de la paroi, pour ne pas y rester colle.
pub const PINCH_LIFT: f32 = 0.22;

/// Frappe de balle. Renvoie la force du contact, `0` s'il n'y a pas touche.
pub fn car_ball(c: &mut Car, b: &mut Ball, t: &Tune) -> f32 {
    if c.demo > 0.0 {
        return 0.0;
    }
    let contact = c.nearest(b.pos, t);
    let d = b.pos.sub(contact);
    let dist = d.len();
    if dist >= t.ball_radius {
        return 0.0;
    }
    // Chassis et balle confondus : on retombe sur l'axe centre a centre.
    let n = if dist > 1e-4 {
        d.mul(1.0 / dist)
    } else {
        let away = b.pos.sub(c.pos);
        if away.len() > 1e-4 {
            away.norm()
        } else {
            c.fwd()
        }
    };
    b.pos = b.pos.add(n.mul(t.ball_radius - dist));

    let vn = b.vel.sub(c.vel).dot(n);
    let mut impact = 0.0;
    if vn < 0.0 {
        let j = -(1.0 + t.ball_rest) * vn * (t.car_mass / (t.car_mass + t.ball_mass).max(1e-3));
        b.vel = b.vel.add(n.mul(j));
        c.vel = c.vel.sub(n.mul(j * t.ball_mass / t.car_mass.max(1e-3)));
        impact = -vn;
    }
    let dir = b.pos.sub(c.pos).norm();
    let extra = push_scale(c.speed(), t);
    b.vel = b.vel.add(dir.mul(extra)).clamp_len(t.ball_max_speed);
    b.last_touch = c.team as i8;
    impact + extra
}

/// Resultat d'une bourrade : intensite du choc et sort de chaque voiture.
pub struct Bump {
    pub force: f32,
    pub demo_a: bool,
    pub demo_b: bool,
}

impl Bump {
    pub fn any_demo(&self) -> bool {
        self.demo_a || self.demo_b
    }
}

/// Contact entre deux voitures. Au-dela du seuil de vitesse, le choc
/// demolit : la victime repart de son fond de terrain apres trois secondes.
/// Un frontal entre deux voitures lancees fait sauter les deux.
pub fn car_car(a: &mut Car, b: &mut Car, t: &Tune) -> Option<Bump> {
    if a.demo > 0.0 || b.demo > 0.0 {
        return None;
    }
    let d = b.pos.sub(a.pos);
    let dist = d.len();
    if dist >= t.contact_radius * 2.0 {
        return None;
    }
    let n = if dist > 1e-4 {
        d.mul(1.0 / dist)
    } else {
        a.fwd()
    };
    let overlap = t.contact_radius * 2.0 - dist;
    a.pos = a.pos.sub(n.mul(overlap * 0.5));
    b.pos = b.pos.add(n.mul(overlap * 0.5));

    let vn = b.vel.sub(a.vel).dot(n);
    if vn >= 0.0 {
        return None;
    }

    // Le verdict se lit sur les vitesses d'avant le choc : l'impulsion qui
    // suit ralentit justement celui qui arrive, et masquerait le contact.
    // On ne demolit pas son propre camp : entre coequipiers, meme lances,
    // le contact se contente de bousculer.
    let foes = a.team != b.team;
    let a_hits = foes && a.lethal(t) && a.vel.dot(n) > 0.0;
    let b_hits = foes && b.lethal(t) && b.vel.dot(n) < 0.0;
    // Elan que chacun amene dans le choc, lu lui aussi avant l'impulsion :
    // apres, les deux vitesses ont deja ete echangees et ne disent plus qui
    // fonçait sur qui.
    let into_a = a.vel.dot(n).max(0.0);
    let into_b = (-b.vel.dot(n)).max(0.0);

    let j = -(1.0 + t.car_rest) * vn * 0.5;
    a.vel = a.vel.sub(n.mul(j));
    b.vel = b.vel.add(n.mul(j));

    // Chacun detruit l'autre s'il arrive assez vite dessus : le frontal
    // entre deux lancees ne fait donc pas de survivant.
    if b_hits {
        a.demolish(t);
    }
    if a_hits {
        b.demolish(t);
    }
    if !a_hits && !b_hits {
        let kick = ((-vn) * t.bump_gain).clamp(t.bump_floor, t.bump_cap.max(t.bump_floor));
        // La bousculade part sur celui qui l'encaisse. Partagee en deux, elle
        // renverrait l'assaillant en arriere autant que sa victime en avant ;
        // on la repartit donc a l'inverse de l'elan que chacun amene dans le
        // choc, pour que ce soit bien la direction de l'impact qui pousse.
        let total = into_a + into_b;
        let (share_a, share_b) = if total > 1e-4 {
            (into_b / total, into_a / total)
        } else {
            (0.5, 0.5)
        };
        a.vel = a.vel.sub(n.mul(kick * share_a));
        b.vel = b.vel.add(n.mul(kick * share_b));
    }
    Some(Bump {
        force: -vn,
        demo_a: b_hits,
        demo_b: a_hits,
    })
}

/// Coincement : la balle prise entre une voiture et une paroi.
///
/// Les deux surfaces se referment l'une sur l'autre et la balle n'a plus
/// de place pour reculer : elle fuse le long de la paroi, dans une
/// direction qui n'est celle d'aucun des deux. Plus la voiture pousse
/// perpendiculairement au mur, moins il reste d'echappatoire et plus la
/// sortie est vive — c'est le coin qui se referme.
///
/// Rien de tout cela n'est un cas particulier ajoute a la main dans le
/// vrai jeu : c'est ce que donne la resolution de deux contacts dans la
/// meme image. Ici, ou les contacts sont traites l'un apres l'autre, il
/// faut le poser explicitement.
///
/// Renvoie la vitesse de sortie, `0` s'il n'y a pas eu coincement.
pub fn pinch(car: &Car, ball: &mut Ball, mur: &arena::Hit, t: &Tune) -> f32 {
    if car.demo > 0.0 {
        return 0.0;
    }
    // Vitesse a laquelle la voiture referme le coin. `mur.n` sort de la
    // paroi vers le terrain : la voiture s'en approche quand sa vitesse
    // pointe a l'oppose.
    let vers_mur = -car.vel.dot(mur.n);
    let lance = car.speed();
    if vers_mur < t.pinch_min || lance < 1e-3 {
        return 0.0;
    }
    // Un contre un quand la voiture fonce droit dans la paroi, zero quand
    // elle la longe : c'est ce facteur qui fait qu'un coincement rate ne
    // donne rien et qu'un coincement franc part comme un coup de fusil.
    let aligne = vers_mur / lance;
    let tangente = mur.n.perp();
    // La balle sort du cote ou il lui reste de la place : celui ou elle
    // glisse deja, la voiture ne faisant que departager les cas douteux.
    let glisse = ball.vel.dot(tangente) + car.vel.dot(tangente) * 0.5;
    let sens = if glisse >= 0.0 { 1.0 } else { -1.0 };

    let vitesse = (vers_mur * t.pinch_gain * aligne).min(t.pinch_max);
    // Un coincement mou ne doit pas ralentir une balle deja lancee.
    if vitesse <= ball.vel.len() {
        return 0.0;
    }
    // On decolle legerement de la paroi, sinon la balle y reste plaquee et
    // se fait coincer a nouveau a l'image suivante.
    let dir = tangente
        .mul(sens)
        .add(mur.n.mul(t.pinch_lift))
        .norm();
    ball.vel = dir.mul(vitesse).clamp_len(t.ball_max_speed);
    vitesse
}
