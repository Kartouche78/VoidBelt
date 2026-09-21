//! Points individuels, sur le bareme de Rocket League.
//!
//! A ne pas confondre avec le score du match, qui compte les buts par
//! equipe : un but ajoute 1 au tableau d'affichage et 100 au compteur
//! personnel du buteur. Les deux vivent cote a cote sans se melanger.
//!
//! Les regles de detection sont des adaptations, pas le moteur d'origine :
//! Rocket League ne publie pas ses seuils. Ce qui est repris fidelement,
//! ce sont les baremes.

use crate::tune::Tune;

/// Bareme officiel, hors modes speciaux et mutateurs.
pub mod points {
    pub const TOUCH: u32 = 2;
    pub const SHOT: u32 = 10;
    pub const CLEAR: u32 = 20;
    pub const SAVE: u32 = 50;
    /// Un arret spectaculaire vaut 75, et non 50 plus 75.
    pub const EPIC_SAVE: u32 = 75;
    pub const ASSIST: u32 = 50;
    pub const GOAL: u32 = 100;
    /// Une demolition ne rapporte rien ; seule la serie compte.
    pub const DEMOLITION: u32 = 0;
    pub const EXTERMINATION: u32 = 20;

    // Bonus, cumulables avec l'action qui les declenche.
    pub const HAT_TRICK: u32 = 25;
    pub const PLAYMAKER: u32 = 25;
    pub const SAVIOR: u32 = 25;
    pub const OVERTIME_GOAL: u32 = 25;
    pub const LONG_GOAL: u32 = 20;
}

/// Seuils des series, tels que Rocket League les annonce.
const SERIE: u32 = 3;
const EXTERMINATION_AT: u32 = 7;
/// Delai minimal entre deux touches recompensees : sans lui, rouler contre
/// la balle rapporterait deux points par image.
const TOUCH_COOLDOWN: f32 = 1.0;
/// Au-dela, une touche ne compte plus comme passe decisive.
const ASSIST_WINDOW: f32 = 5.0;
/// Un arret est spectaculaire quand la balle allait entrer de tres pres.
const EPIC_FRACTION: f32 = 0.35;
/// Un but est « lointain » au-dela de cette part de la longueur du terrain.
const LONG_GOAL_FRACTION: f32 = 0.45;

#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct Stats {
    pub points: u32,
    pub goals: u32,
    pub assists: u32,
    pub saves: u32,
    pub shots: u32,
    pub demos: u32,
    pub touches: u32,
}

/// Compteurs individuels de la partie.
pub struct Scoring {
    pub stats: Vec<Stats>,
    /// Derniere voiture a avoir touche la balle, et depuis combien de temps.
    last: Option<(usize, f32)>,
    /// Avant-derniere : c'est elle qui peut valoir une passe decisive.
    before: Option<(usize, f32)>,
    /// Empeche de recompenser chaque image de contact.
    cooldown: Vec<f32>,
}

impl Scoring {
    pub fn new(cars: usize) -> Scoring {
        Scoring {
            stats: vec![Stats::default(); cars],
            last: None,
            before: None,
            cooldown: vec![0.0; cars],
        }
    }

    pub fn reset(&mut self) {
        for s in self.stats.iter_mut() {
            *s = Stats::default();
        }
        self.last = None;
        self.before = None;
        for c in self.cooldown.iter_mut() {
            *c = 0.0;
        }
    }

    pub fn tick(&mut self, dt: f32) {
        for c in self.cooldown.iter_mut() {
            *c = (*c - dt).max(0.0);
        }
        for slot in [&mut self.last, &mut self.before] {
            if let Some((_, age)) = slot {
                *age += dt;
            }
        }
    }

    fn add(&mut self, car: usize, n: u32) {
        if let Some(s) = self.stats.get_mut(car) {
            s.points += n;
        }
    }

    /// Contact avec la balle. Renvoie `true` si la touche a ete comptee,
    /// pour que l'hote sache qu'il peut l'annoncer.
    pub fn touch(&mut self, car: usize) -> bool {
        // Memoire des porteurs : elle sert aux passes decisives, et se tient
        // a jour meme quand la touche elle-meme ne rapporte rien.
        if self.last.map(|(c, _)| c) != Some(car) {
            self.before = self.last;
            self.last = Some((car, 0.0));
        } else {
            self.last = Some((car, 0.0));
        }
        if self.cooldown.get(car).copied().unwrap_or(0.0) > 0.0 {
            return false;
        }
        if let Some(c) = self.cooldown.get_mut(car) {
            *c = TOUCH_COOLDOWN;
        }
        if let Some(s) = self.stats.get_mut(car) {
            s.touches += 1;
        }
        self.add(car, points::TOUCH);
        true
    }

    pub fn shot(&mut self, car: usize) {
        if let Some(s) = self.stats.get_mut(car) {
            s.shots += 1;
        }
        self.add(car, points::SHOT);
    }

    pub fn clear(&mut self, car: usize) {
        self.add(car, points::CLEAR);
    }

    /// Arret. `closeness` vaut 0 au bord de la zone et 1 sur la ligne : en
    /// dessous d'`EPIC_FRACTION` du but, l'arret devient spectaculaire.
    pub fn save(&mut self, car: usize, closeness: f32) -> bool {
        let epic = closeness > 1.0 - EPIC_FRACTION;
        self.add(car, if epic { points::EPIC_SAVE } else { points::SAVE });
        let serie = if let Some(s) = self.stats.get_mut(car) {
            s.saves += 1;
            s.saves == SERIE
        } else {
            false
        };
        if serie {
            self.add(car, points::SAVIOR);
        }
        epic
    }

    /// Demolition reussie. Renvoie `true` quand elle declenche l'extermination.
    pub fn demo(&mut self, car: usize) -> bool {
        self.add(car, points::DEMOLITION);
        let serie = if let Some(s) = self.stats.get_mut(car) {
            s.demos += 1;
            s.demos == EXTERMINATION_AT
        } else {
            false
        };
        if serie {
            self.add(car, points::EXTERMINATION);
        }
        serie
    }

    /// But marque. Renvoie le passeur decisif s'il y en a un.
    ///
    /// `distance` est celle du dernier contact au but, `field` la longueur
    /// du terrain : leur rapport dit si le but etait lointain.
    pub fn goal(
        &mut self,
        scorer: usize,
        overtime: bool,
        distance: f32,
        field: f32,
        teams: &[u8],
    ) -> Option<usize> {
        self.add(scorer, points::GOAL);
        let serie = if let Some(s) = self.stats.get_mut(scorer) {
            s.goals += 1;
            s.goals == SERIE
        } else {
            false
        };
        if serie {
            self.add(scorer, points::HAT_TRICK);
        }
        if overtime {
            self.add(scorer, points::OVERTIME_GOAL);
        }
        if field > 1.0 && distance / field > LONG_GOAL_FRACTION {
            self.add(scorer, points::LONG_GOAL);
        }

        // Passe decisive : le dernier coequipier a avoir touche avant le
        // buteur, dans la fenetre. Un adversaire ne compte pas, et le buteur
        // ne se passe pas la balle a lui-meme.
        let passeur = self.before.filter(|&(c, age)| {
            c != scorer
                && age <= ASSIST_WINDOW
                && teams.get(c) == teams.get(scorer)
                && teams.get(c).is_some()
        });
        if let Some((c, _)) = passeur {
            self.add(c, points::ASSIST);
            let serie = if let Some(s) = self.stats.get_mut(c) {
                s.assists += 1;
                s.assists == SERIE
            } else {
                false
            };
            if serie {
                self.add(c, points::PLAYMAKER);
            }
        }
        self.last = None;
        self.before = None;
        passeur.map(|(c, _)| c)
    }

    /// Derniere voiture a avoir touche la balle.
    pub fn last_touch(&self) -> Option<usize> {
        self.last.map(|(c, _)| c)
    }
}

/// Un tir est cadre si la balle part vers le but adverse et y entrerait.
pub fn is_shot(team: u8, pos: crate::vec::V2, vel: crate::vec::V2) -> bool {
    crate::arena::on_target(pos, vel, 1 - team)
}

/// Un degagement : la balle quitte la zone defensive de son camp, poussee
/// vers l'exterieur, apres avoir ete dangereusement proche.
pub fn is_clear(team: u8, pos: crate::vec::V2, vel: crate::vec::V2, t: &Tune) -> bool {
    let own = crate::arena::goal_mouth(team == 0);
    let dist = (pos.x - own).abs();
    if dist > t.save_range {
        return false;
    }
    // Vers l'exterieur : la composante horizontale s'eloigne du but.
    let vers_exterieur = if team == 0 { vel.x } else { -vel.x };
    vers_exterieur > 120.0
}
