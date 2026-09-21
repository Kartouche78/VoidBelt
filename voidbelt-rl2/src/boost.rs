//! Les 34 plots de boost releves sur `pads_boost.png` : 6 gros, 28 petits,
//! exactement la dotation d'un terrain de Rocket League.

use crate::car::Car;
use crate::tune::Tune;
use crate::pads::PADS;
use crate::vec::v2;

pub const COUNT: usize = PADS.len();
pub const BIG_AMOUNT: f32 = 100.0;
pub const SMALL_AMOUNT: f32 = 12.0;
pub const BIG_DELAY: f32 = 10.0;
pub const SMALL_DELAY: f32 = 4.0;
/// Rayons de ramassage, calques sur le disque dessine plus un debord de la
/// largeur d'une voiture : on ramasse en frolant le plot, pas a trois metres.
pub const BIG_R: f32 = 28.0;
pub const SMALL_R: f32 = 18.0;

/// Temps restant avant reapparition, `0` quand le plot est disponible.
#[derive(Clone)]
pub struct Field {
    pub cooldown: [f32; COUNT],
}

impl Field {
    pub fn new() -> Field {
        Field {
            cooldown: [0.0; COUNT],
        }
    }

    pub fn reset(&mut self) {
        self.cooldown = [0.0; COUNT];
    }

    pub fn tick(&mut self, dt: f32) {
        for c in self.cooldown.iter_mut() {
            if *c > 0.0 {
                *c = (*c - dt).max(0.0);
            }
        }
    }

    /// Ramasse les plots atteints par la voiture. Renvoie l'index du dernier
    /// plot pris, pour que l'hote declenche le son correspondant.
    pub fn collect(&mut self, car: &mut Car, t: &Tune) -> Option<usize> {
        if car.demo > 0.0 || car.boost >= t.boost_max {
            return None;
        }
        let mut taken = None;
        for (i, &(x, y, big)) in PADS.iter().enumerate() {
            if self.cooldown[i] > 0.0 {
                continue;
            }
            let r = if big { t.pad_big_radius } else { t.pad_small_radius };
            if car.pos.sub(v2(x, y)).len() > r {
                continue;
            }
            car.add_boost(if big { t.pad_big_amount } else { t.pad_small_amount }, t);
            self.cooldown[i] = if big { t.pad_big_delay } else { t.pad_small_delay };
            taken = Some(i);
            if car.boost >= t.boost_max {
                break;
            }
        }
        taken
    }

    /// Plot disponible le plus interessant pour une voiture : on compare la
    /// valeur du plot au detour qu'il impose.
    pub fn best_for(&self, from: crate::vec::V2, want_big: bool) -> Option<crate::vec::V2> {
        let mut best: Option<(f32, crate::vec::V2)> = None;
        for (i, &(x, y, big)) in PADS.iter().enumerate() {
            if self.cooldown[i] > 0.0 || (want_big && !big) {
                continue;
            }
            let p = v2(x, y);
            let cost = from.sub(p).len() / if big { 2.2 } else { 1.0 };
            if best.map_or(true, |(c, _)| cost < c) {
                best = Some((cost, p));
            }
        }
        best.map(|(_, p)| p)
    }
}
