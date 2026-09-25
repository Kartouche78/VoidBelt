//! Presence : qui est connecte, et ou.
//!
//! Un joueur est en ligne tant qu'une page du jeu garde sa connexion
//! sociale ouverte (`social_ws.rs`) ; il peut en avoir plusieurs (deux
//! onglets). La page dit ou elle en est (menus, solo) ; le serveur de jeu,
//! lui, dit dans quel salon le joueur est assis : ce lieu-la ne se declare
//! pas, il se constate.
//!
//! Tout vit en memoire : un redemarrage du serveur remet chacun hors ligne,
//! et les pages se reconnectent aussitot.

use serde::Serialize;
use std::collections::HashMap;
use tokio::sync::mpsc::UnboundedSender;

/// Canal vers une page ouverte : des messages JSON.
pub type Canal = UnboundedSender<String>;

/// Ce que les amis voient d'un joueur.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Statut {
    pub en_ligne: bool,
    /// `menu`, `solo` ou `partie` ; vide hors ligne.
    pub lieu: String,
    /// Code du salon en ligne ou il joue : ses amis peuvent l'y rejoindre.
    pub salon: Option<String>,
}

#[derive(Default)]
pub struct Presence {
    canaux: HashMap<i64, Vec<(u64, Canal)>>,
    lieux: HashMap<i64, String>,
    salons: HashMap<i64, String>,
    prochain: u64,
}

impl Presence {
    /// Nouvelle page ouverte ; rend son numero, pour la fermer ensuite.
    pub fn connecter(&mut self, compte: i64, canal: Canal) -> u64 {
        self.prochain += 1;
        self.canaux.entry(compte).or_default().push((self.prochain, canal));
        self.prochain
    }

    /// Page fermee. Rend vrai si c'etait la derniere du joueur.
    pub fn deconnecter(&mut self, compte: i64, id: u64) -> bool {
        let Some(v) = self.canaux.get_mut(&compte) else { return false };
        v.retain(|(n, _)| *n != id);
        if !v.is_empty() {
            return false;
        }
        self.canaux.remove(&compte);
        self.lieux.remove(&compte);
        true
    }

    pub fn en_ligne(&self, compte: i64) -> bool {
        self.canaux.contains_key(&compte)
    }

    /// Lieu declare par la page : `menu` ou `solo`.
    pub fn lieu(&mut self, compte: i64, lieu: &str) {
        let lieu = if lieu == "solo" { "solo" } else { "menu" };
        self.lieux.insert(compte, lieu.into());
    }

    /// Salon constate par le serveur de jeu.
    pub fn salon(&mut self, compte: i64, code: Option<String>) {
        match code {
            Some(c) => self.salons.insert(compte, c),
            None => self.salons.remove(&compte),
        };
    }

    pub fn statut(&self, compte: i64) -> Statut {
        if !self.en_ligne(compte) {
            return Statut::default();
        }
        let salon = self.salons.get(&compte).cloned();
        let lieu = if salon.is_some() {
            "partie".into()
        } else {
            self.lieux.get(&compte).cloned().unwrap_or_else(|| "menu".into())
        };
        Statut { en_ligne: true, lieu, salon }
    }

    /// Envoie un message a toutes les pages ouvertes d'un joueur.
    pub fn envoyer(&self, compte: i64, message: &str) {
        for (_, c) in self.canaux.get(&compte).into_iter().flatten() {
            let _ = c.send(message.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn en_ligne_tant_qu_une_page_reste_ouverte() {
        let mut p = Presence::default();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let a = p.connecter(7, tx.clone());
        let b = p.connecter(7, tx);
        assert!(p.en_ligne(7));
        assert!(!p.deconnecter(7, a), "un onglet reste ouvert");
        assert!(p.en_ligne(7));
        p.envoyer(7, "coucou");
        assert_eq!(rx.try_recv().unwrap(), "coucou");
        assert!(p.deconnecter(7, b));
        assert!(!p.en_ligne(7));
        assert_eq!(p.statut(7), Statut::default());
    }

    #[test]
    fn le_salon_passe_devant_le_lieu_declare() {
        let mut p = Presence::default();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        p.connecter(1, tx);
        assert_eq!(p.statut(1).lieu, "menu");
        p.lieu(1, "solo");
        assert_eq!(p.statut(1).lieu, "solo");
        p.lieu(1, "n'importe quoi");
        assert_eq!(p.statut(1).lieu, "menu");
        p.salon(1, Some("4821".into()));
        assert_eq!(p.statut(1), Statut { en_ligne: true, lieu: "partie".into(), salon: Some("4821".into()) });
        p.salon(1, None);
        assert_eq!(p.statut(1).salon, None);
    }
}
