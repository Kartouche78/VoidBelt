//! Groupes : des amis qui jouent ensemble.
//!
//! Un groupe vit en memoire, le temps d'une session de jeu, comme les
//! salons. Pas de plafond de taille. Un membre invite un ami ; l'invitation
//! tient une minute. Accepter fait quitter son ancien groupe. Le chef lance
//! les parties, et tout le groupe le suit, dans la meme equipe.
//!
//! Quand le chef part, le membre arrive juste apres lui prend la main ; un
//! groupe reduit a une personne se dissout.
//!
//! Cette partie ne connait ni la base ni le reseau : on la teste seule.
//! Les amities et la presence se verifient avant (voir `social.rs`).

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Duree de vie d'une invitation.
pub const INVITATION: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, PartialEq)]
pub struct Groupe {
    pub id: u64,
    pub chef: i64,
    /// Membres, chef compris, dans l'ordre d'arrivee.
    pub membres: Vec<i64>,
}

#[derive(Default)]
pub struct Groupes {
    groupes: HashMap<u64, Groupe>,
    /// Groupe de chaque joueur.
    de: HashMap<i64, u64>,
    /// Invitations recues : pour chaque invite, qui l'a invite et quand.
    invitations: HashMap<i64, Vec<(i64, Instant)>>,
    prochain: u64,
}

impl Groupes {
    pub fn groupe_de(&self, compte: i64) -> Option<&Groupe> {
        self.de.get(&compte).and_then(|id| self.groupes.get(id))
    }

    /// Les autres membres du groupe de `compte`.
    pub fn coequipiers(&self, compte: i64) -> Vec<i64> {
        self.groupe_de(compte)
            .map(|g| g.membres.iter().copied().filter(|&m| m != compte).collect())
            .unwrap_or_default()
    }

    pub fn est_chef(&self, compte: i64) -> bool {
        self.groupe_de(compte).is_some_and(|g| g.chef == compte)
    }

    /// `de` invite `a` dans son groupe (ou dans un groupe a creer).
    pub fn inviter(&mut self, de: i64, a: i64, t: Instant) -> Result<(), &'static str> {
        if de == a {
            return Err("C'est toi !");
        }
        if self.de.get(&de).is_some_and(|g| self.de.get(&a) == Some(g)) {
            return Err("Il est deja dans ton groupe.");
        }
        let liste = self.invitations.entry(a).or_default();
        liste.retain(|&(qui, _)| qui != de);
        liste.push((de, t));
        Ok(())
    }

    /// Invitations encore valables recues par `a`, les plus anciennes
    /// d'abord. Les perimees tombent au passage.
    pub fn invitations(&mut self, a: i64, t: Instant) -> Vec<i64> {
        let Some(liste) = self.invitations.get_mut(&a) else { return Vec::new() };
        liste.retain(|&(_, quand)| t.duration_since(quand) < INVITATION);
        let v = liste.iter().map(|&(qui, _)| qui).collect();
        if liste.is_empty() {
            self.invitations.remove(&a);
        }
        v
    }

    pub fn refuser(&mut self, a: i64, de: i64) {
        if let Some(liste) = self.invitations.get_mut(&a) {
            liste.retain(|&(qui, _)| qui != de);
        }
    }

    /// `a` accepte l'invitation de `de`. Rend tous les joueurs dont le
    /// groupe a change (l'ancien groupe de `a` compris).
    pub fn accepter(&mut self, a: i64, de: i64, t: Instant) -> Result<Vec<i64>, &'static str> {
        if !self.invitations(a, t).contains(&de) {
            return Err("Cette invitation n'est plus valable.");
        }
        self.refuser(a, de);
        let mut touches = Vec::new();
        if self.de.contains_key(&a) {
            touches.extend(self.quitter(a));
        }
        let id = match self.de.get(&de) {
            Some(&id) => id,
            None => {
                self.prochain += 1;
                let id = self.prochain;
                self.groupes.insert(id, Groupe { id, chef: de, membres: vec![de] });
                self.de.insert(de, id);
                id
            }
        };
        let g = self.groupes.get_mut(&id).expect("groupe connu");
        g.membres.push(a);
        self.de.insert(a, id);
        touches.extend(g.membres.iter().copied());
        touches.sort_unstable();
        touches.dedup();
        Ok(touches)
    }

    /// `compte` quitte son groupe. Rend les membres restants (a prevenir),
    /// et `compte` lui-meme.
    pub fn quitter(&mut self, compte: i64) -> Vec<i64> {
        let Some(id) = self.de.remove(&compte) else { return Vec::new() };
        let Some(g) = self.groupes.get_mut(&id) else { return vec![compte] };
        g.membres.retain(|&m| m != compte);
        if g.chef == compte
            && let Some(&suivant) = g.membres.first()
        {
            g.chef = suivant;
        }
        let mut touches = g.membres.clone();
        // Seul, on n'est plus un groupe.
        if g.membres.len() < 2 {
            for m in &g.membres {
                self.de.remove(m);
            }
            self.groupes.remove(&id);
        }
        touches.push(compte);
        touches
    }

    /// Le chef exclut un membre.
    pub fn exclure(&mut self, chef: i64, qui: i64) -> Result<Vec<i64>, &'static str> {
        if !self.est_chef(chef) {
            return Err("Seul le chef exclut.");
        }
        if chef == qui || !self.coequipiers(chef).contains(&qui) {
            return Err("Ce joueur n'est pas dans ton groupe.");
        }
        Ok(self.quitter(qui))
    }

    /// Le chef passe la main.
    pub fn passer_chef(&mut self, chef: i64, qui: i64) -> Result<Vec<i64>, &'static str> {
        if !self.est_chef(chef) {
            return Err("Seul le chef passe la main.");
        }
        if !self.coequipiers(chef).contains(&qui) {
            return Err("Ce joueur n'est pas dans ton groupe.");
        }
        let id = self.de[&chef];
        let g = self.groupes.get_mut(&id).expect("groupe connu");
        g.chef = qui;
        Ok(g.membres.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn une_invitation_acceptee_forme_un_groupe() {
        let mut g = Groupes::default();
        let t = Instant::now();
        g.inviter(1, 2, t).unwrap();
        assert_eq!(g.invitations(2, t), vec![1]);
        let touches = g.accepter(2, 1, t).unwrap();
        assert_eq!(touches, vec![1, 2]);
        let groupe = g.groupe_de(2).unwrap();
        assert_eq!((groupe.chef, groupe.membres.clone()), (1, vec![1, 2]));
        assert_eq!(g.coequipiers(1), vec![2]);
        assert!(g.invitations(2, t).is_empty(), "l'invitation est restee");
        assert!(g.accepter(2, 1, t).is_err(), "une invitation a servi deux fois");
    }

    #[test]
    fn pas_de_plafond_et_tout_membre_peut_inviter() {
        let mut g = Groupes::default();
        let t = Instant::now();
        g.inviter(1, 2, t).unwrap();
        g.accepter(2, 1, t).unwrap();
        for n in 3..40 {
            g.inviter(n - 1, n, t).unwrap();
            g.accepter(n, n - 1, t).unwrap();
        }
        assert_eq!(g.groupe_de(1).unwrap().membres.len(), 39);
        assert_eq!(g.groupe_de(39).unwrap().chef, 1);
    }

    #[test]
    fn une_invitation_expire() {
        let mut g = Groupes::default();
        let t = Instant::now();
        g.inviter(1, 2, t).unwrap();
        let tard = t + INVITATION + Duration::from_secs(1);
        assert!(g.invitations(2, tard).is_empty());
        assert!(g.accepter(2, 1, tard).is_err());
    }

    #[test]
    fn accepter_fait_quitter_l_ancien_groupe() {
        let mut g = Groupes::default();
        let t = Instant::now();
        g.inviter(1, 2, t).unwrap();
        g.accepter(2, 1, t).unwrap();
        g.inviter(3, 2, t).unwrap();
        let touches = g.accepter(2, 3, t).unwrap();
        // 1 se retrouve seul : son groupe est dissous, il est prevenu.
        assert!(touches.contains(&1) && touches.contains(&3));
        assert!(g.groupe_de(1).is_none());
        assert_eq!(g.groupe_de(2).unwrap().chef, 3);
    }

    #[test]
    fn le_chef_qui_part_passe_la_main() {
        let mut g = Groupes::default();
        let t = Instant::now();
        for n in [2, 3] {
            g.inviter(1, n, t).unwrap();
            g.accepter(n, 1, t).unwrap();
        }
        g.quitter(1);
        assert_eq!(g.groupe_de(2).unwrap().chef, 2);
        assert_eq!(g.groupe_de(3).unwrap().membres, vec![2, 3]);
        g.quitter(3);
        assert!(g.groupe_de(2).is_none(), "un groupe d'une personne est reste");
    }

    #[test]
    fn seul_le_chef_exclut_et_passe_la_main() {
        let mut g = Groupes::default();
        let t = Instant::now();
        for n in [2, 3] {
            g.inviter(1, n, t).unwrap();
            g.accepter(n, 1, t).unwrap();
        }
        assert!(g.exclure(2, 3).is_err());
        assert!(g.exclure(1, 9).is_err());
        g.exclure(1, 3).unwrap();
        assert!(g.groupe_de(3).is_none());
        assert!(g.passer_chef(2, 1).is_err());
        g.passer_chef(1, 2).unwrap();
        assert!(g.est_chef(2));
    }

    #[test]
    fn on_n_invite_ni_soi_meme_ni_un_membre() {
        let mut g = Groupes::default();
        let t = Instant::now();
        assert!(g.inviter(1, 1, t).is_err());
        g.inviter(1, 2, t).unwrap();
        g.accepter(2, 1, t).unwrap();
        assert!(g.inviter(2, 1, t).is_err());
    }
}
