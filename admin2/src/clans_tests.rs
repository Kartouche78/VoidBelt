//! Essais des clans (`clans.rs`).

use super::*;
use crate::amis::tests::joueur;
use crate::base::neuve;

fn rang(c: &Connection, id: i64) -> Option<String> {
    rang_de(c, id).map(|(_, r)| r)
}

#[test]
fn nom_et_tag_sont_verifies() {
    assert_eq!(nom_valide("  Les   Fous du Volant "), Some("Les Fous du Volant".into()));
    assert_eq!(nom_valide("ab"), None);
    assert_eq!(nom_valide("<b>clan</b>"), None);
    assert_eq!(tag_valide(" kx7 "), Some("KX7".into()));
    assert_eq!(tag_valide("TROPLONG"), None);
    assert_eq!(tag_valide("é!"), None);
}

#[test]
fn le_fondateur_est_chef_et_le_nom_est_unique() {
    let c = neuve();
    let (a, b) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"));
    let k = creer(&c, a, "Les Rapides", "rap", "On roule.", true).unwrap();
    assert_eq!(rang(&c, a).as_deref(), Some("chef"));
    assert_eq!(par_id(&c, k).unwrap().tag, "RAP");
    assert_eq!(creer(&c, b, "les rapides", "ZZ", "", true).unwrap_err().0, StatusCode::CONFLICT);
    assert_eq!(creer(&c, b, "Autre", "Rap", "", true).unwrap_err().0, StatusCode::CONFLICT);
    assert_eq!(creer(&c, a, "Second", "SEC", "", true).unwrap_err().0, StatusCode::CONFLICT, "deux clans a la fois");
}

#[test]
fn un_clan_ferme_passe_par_une_demande() {
    let c = neuve();
    let (a, b, d) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"), joueur(&c, "Delta"));
    let k = creer(&c, a, "Ferme", "FER", "", false).unwrap();
    assert_eq!(rejoindre(&c, b, k).unwrap(), "demande");
    assert_eq!(rang(&c, b), None);
    assert_eq!(demandes(&c, k).unwrap().len(), 1);
    // Un simple membre ne peut pas accepter.
    regler(&c, a, None, Some(true)).unwrap();
    rejoindre(&c, d, k).unwrap();
    assert_eq!(agir(&c, d, b, "accepter").unwrap_err().0, StatusCode::FORBIDDEN);
    agir(&c, a, b, "accepter").unwrap();
    assert_eq!(rang(&c, b).as_deref(), Some("membre"));
    assert!(demandes(&c, k).unwrap().is_empty());
}

#[test]
fn les_rangs_se_respectent() {
    let c = neuve();
    let (a, b, d) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"), joueur(&c, "Delta"));
    let k = creer(&c, a, "Rangs", "RNG", "", true).unwrap();
    rejoindre(&c, b, k).unwrap();
    rejoindre(&c, d, k).unwrap();
    agir(&c, a, b, "promouvoir").unwrap();
    assert_eq!(rang(&c, b).as_deref(), Some("officier"));
    // L'officier exclut un membre, pas le chef, et ne nomme personne.
    assert_eq!(agir(&c, b, a, "exclure").unwrap_err().0, StatusCode::FORBIDDEN);
    assert_eq!(agir(&c, b, d, "promouvoir").unwrap_err().0, StatusCode::FORBIDDEN);
    agir(&c, b, d, "exclure").unwrap();
    assert_eq!(rang(&c, d), None);
    // Le chef passe la main.
    agir(&c, a, b, "chef").unwrap();
    assert_eq!((rang(&c, a).as_deref(), rang(&c, b).as_deref()), (Some("officier"), Some("chef")));
    assert_eq!(regler(&c, a, Some("x"), None).unwrap_err().0, StatusCode::FORBIDDEN);
}

#[test]
fn le_chef_qui_part_laisse_sa_place_et_le_dernier_emporte_le_clan() {
    let c = neuve();
    let (a, b, d) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"), joueur(&c, "Delta"));
    let k = creer(&c, a, "Relais", "REL", "", true).unwrap();
    rejoindre(&c, b, k).unwrap();
    rejoindre(&c, d, k).unwrap();
    agir(&c, a, d, "promouvoir").unwrap();
    quitter(&c, a).unwrap();
    assert_eq!(rang(&c, d).as_deref(), Some("chef"), "l'officier devait passer devant le membre plus ancien");
    quitter(&c, d).unwrap();
    assert_eq!(rang(&c, b).as_deref(), Some("chef"));
    quitter(&c, b).unwrap();
    assert!(par_id(&c, k).is_none(), "un clan vide est reste");
}

#[test]
fn la_discussion_compte_les_non_lus() {
    let c = neuve();
    let (a, b) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"));
    let k = creer(&c, a, "Bavards", "BAV", "", true).unwrap();
    rejoindre(&c, b, k).unwrap();
    // L'annonce de son arrivee compte pour le chef, pas pour lui.
    assert_eq!(resume(&c, b).unwrap()["non_lus"], 0);
    assert_eq!(resume(&c, a).unwrap()["non_lus"], 1);
    ecrire(&c, b, "Salut le clan").unwrap();
    let f = fil(&c, a, 0).unwrap();
    assert_eq!(f.last().unwrap().texte, "Salut le clan");
    assert_eq!(f.last().unwrap().de.as_ref().unwrap().pseudo, "Bravo");
    assert_eq!(resume(&c, a).unwrap()["non_lus"], 0);
    let j = joueur(&c, "Juliet");
    assert_eq!(ecrire(&c, j, "coucou").unwrap_err().0, StatusCode::CONFLICT, "hors clan");
}

#[test]
fn dissoudre_efface_tout() {
    let c = neuve();
    let (a, b) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"));
    let k = creer(&c, a, "Ephemere", "EPH", "", true).unwrap();
    rejoindre(&c, b, k).unwrap();
    assert_eq!(dissoudre(&c, b).unwrap_err().0, StatusCode::FORBIDDEN);
    dissoudre(&c, a).unwrap();
    assert!(par_id(&c, k).is_none());
    assert_eq!(rang(&c, b), None);
}
