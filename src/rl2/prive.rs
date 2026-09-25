//! Reglages d'un salon prive, choisis par l'hote avant de creer le lobby :
//! effectif par equipe, nombre de manches, duree d'une manche, boosts,
//! demolitions, reapparition instantanee, et le nom des deux equipes.
//!
//! Un salon prive n'apparait pas dans la liste publique : on y entre par
//! son code, ou en suivant un ami (groupe, « rejoindre sa partie »).
//!
//! Les interrupteurs passent par le `Tune` du salon : le moteur n'a rien a
//! savoir des salons prives, il joue avec les valeurs qu'on lui donne.

use serde_json::{Value, json};
use voidbelt_rl2::tune::Tune;

/// Durees d'une manche proposees, en minutes.
pub const DUREES: [u32; 5] = [2, 3, 5, 7, 10];
/// Nombres de manches proposes (au meilleur de).
pub const MANCHES: [u32; 4] = [1, 3, 5, 7];
/// Sans demolition : un seuil de vitesse que personne n'atteint.
const JAMAIS: f32 = 1.0e9;
/// Reapparition instantanee : le temps de voir l'explosion.
const REAPPARITION_EXPRESS: f32 = 0.3;

#[derive(Clone, Debug, PartialEq)]
pub struct Reglages {
    pub prive: bool,
    /// Joueurs par equipe au plus ; 0 : sans limite (salon public).
    pub par_equipe: usize,
    pub manches: u32,
    pub minutes: u32,
    pub boosts: bool,
    pub demolitions: bool,
    pub reapparition: bool,
    pub noms: [String; 2],
}

impl Default for Reglages {
    /// Un salon public : rien ne change par rapport au jeu de base.
    fn default() -> Reglages {
        Reglages {
            prive: false,
            par_equipe: 0,
            manches: 1,
            minutes: 5,
            boosts: true,
            demolitions: true,
            reapparition: false,
            noms: ["Bleu".into(), "Orange".into()],
        }
    }
}

/// Nom d'equipe propre : sans caracteres de controle, 16 au plus.
fn nom_propre(brut: &str, defaut: &str) -> String {
    let n: String = brut.trim().chars().filter(|c| !c.is_control()).take(16).collect();
    let n = n.trim().to_string();
    if n.is_empty() { defaut.to_string() } else { n }
}

impl Reglages {
    /// Lit un message `reglages` de l'hote. Toute valeur hors des choix
    /// proposes garde la valeur actuelle.
    pub fn lire(&mut self, v: &Value) {
        let entier = |cle: &str| v.get(cle).and_then(Value::as_u64).map(|n| n as u32);
        let oui = |cle: &str| v.get(cle).and_then(Value::as_bool);
        if let Some(n) = entier("par_equipe").filter(|n| (1..=4).contains(n)) {
            self.par_equipe = n as usize;
        }
        if let Some(n) = entier("manches").filter(|n| MANCHES.contains(n)) {
            self.manches = n;
        }
        if let Some(n) = entier("minutes").filter(|n| DUREES.contains(n)) {
            self.minutes = n;
        }
        if let Some(b) = oui("boosts") {
            self.boosts = b;
        }
        if let Some(b) = oui("demolitions") {
            self.demolitions = b;
        }
        if let Some(b) = oui("reapparition") {
            self.reapparition = b;
        }
        if let Some(noms) = v.get("noms").and_then(Value::as_array) {
            let defauts = ["Bleu", "Orange"];
            for (i, d) in defauts.iter().enumerate() {
                if let Some(n) = noms.get(i).and_then(Value::as_str) {
                    self.noms[i] = nom_propre(n, d);
                }
            }
        }
    }

    pub fn secondes(&self) -> f32 {
        self.minutes as f32 * 60.0
    }

    /// Manches a gagner pour remporter la serie.
    pub fn a_gagner(&self) -> u32 {
        self.manches / 2 + 1
    }

    /// Les reglages du jeu, interrupteurs appliques.
    pub fn appliquer(&self, mut t: Tune) -> Tune {
        if !self.boosts {
            t.pad_big_amount = 0.0;
            t.pad_small_amount = 0.0;
            t.kickoff_boost = 0.0;
        }
        if !self.demolitions {
            t.demo_speed = JAMAIS;
        }
        if self.reapparition {
            t.demo_time = REAPPARITION_EXPRESS;
        }
        t
    }

    /// Une equipe de `n` joueurs peut-elle en accueillir un de plus ?
    pub fn place(&self, n: usize) -> bool {
        self.par_equipe == 0 || n < self.par_equipe
    }

    pub fn public(&self, serie: [u32; 2]) -> Value {
        json!({
            "prive": self.prive,
            "par_equipe": self.par_equipe,
            "manches": self.manches,
            "minutes": self.minutes,
            "boosts": self.boosts,
            "demolitions": self.demolitions,
            "reapparition": self.reapparition,
            "noms": self.noms,
            "serie": serie,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seuls_les_choix_proposes_passent() {
        let mut r = Reglages::default();
        r.lire(&json!({ "par_equipe": 2, "manches": 3, "minutes": 7, "boosts": false }));
        assert_eq!((r.par_equipe, r.manches, r.minutes, r.boosts), (2, 3, 7, false));
        r.lire(&json!({ "par_equipe": 40, "manches": 4, "minutes": 999 }));
        assert_eq!((r.par_equipe, r.manches, r.minutes), (2, 3, 7), "valeur aberrante acceptee");
        assert_eq!(r.a_gagner(), 2);
    }

    #[test]
    fn les_noms_d_equipe_sont_nettoyes() {
        let mut r = Reglages::default();
        r.lire(&json!({ "noms": ["  Les Comètes\u{7} ", ""] }));
        assert_eq!(r.noms, ["Les Comètes".to_string(), "Orange".to_string()]);
        r.lire(&json!({ "noms": ["abcdefghijklmnopqrstuvwxyz"] }));
        assert_eq!(r.noms[0].chars().count(), 16);
    }

    #[test]
    fn les_interrupteurs_changent_le_jeu() {
        let base = Tune::default();
        assert_eq!(Reglages::default().appliquer(base), base, "un salon public change le jeu");
        let r = Reglages { boosts: false, demolitions: false, reapparition: true, ..Reglages::default() };
        let t = r.appliquer(base);
        assert_eq!((t.pad_big_amount, t.pad_small_amount, t.kickoff_boost), (0.0, 0.0, 0.0));
        assert!(t.demo_speed > t.speed_max * 100.0);
        assert!(t.demo_time < 1.0);
    }

    #[test]
    fn l_effectif_est_borne() {
        let r = Reglages { par_equipe: 1, ..Reglages::default() };
        assert!(r.place(0) && !r.place(1));
        assert!(Reglages::default().place(99), "un salon public refuse du monde");
    }
}
