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
    // Fonder un second clan fait quitter le premier (vide, il disparait).
    let k2 = creer(&c, a, "Second", "SEC", "", true).unwrap();
    assert_eq!(rang_de(&c, a), Some((k2, "chef".into())));
    assert!(par_id(&c, k).is_none());
}

#[test]
fn rejoindre_un_autre_clan_fait_quitter_le_sien() {
    let c = neuve();
    let (a, b, d) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"), joueur(&c, "Delta"));
    let k1 = creer(&c, a, "Premier", "UN", "", true).unwrap();
    rejoindre(&c, b, k1).unwrap();
    let k2 = creer(&c, d, "Deuxieme", "DEUX", "", true).unwrap();
    assert_eq!(rejoindre(&c, a, k1).unwrap_err().0, StatusCode::CONFLICT, "deja dedans");
    // Le chef part chez Delta : Bravo reprend le premier clan.
    assert_eq!(rejoindre(&c, a, k2).unwrap(), "membre");
    assert_eq!(rang_de(&c, a), Some((k2, "membre".into())));
    assert_eq!(rang_de(&c, b), Some((k1, "chef".into())));
    assert_eq!(par_id(&c, k1).unwrap().membres, 1);
}

#[test]
fn une_demande_acceptee_fait_changer_de_clan() {
    let c = neuve();
    let (a, b, d) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"), joueur(&c, "Delta"));
    let k1 = creer(&c, a, "Premier", "UN", "", true).unwrap();
    rejoindre(&c, b, k1).unwrap();
    let k2 = creer(&c, d, "Ferme", "FER", "", false).unwrap();
    // La demande ne fait rien quitter tant qu'elle attend.
    assert_eq!(rejoindre(&c, b, k2).unwrap(), "demande");
    assert_eq!(rang_de(&c, b).map(|r| r.0), Some(k1));
    agir(&c, d, b, "accepter").unwrap();
    assert_eq!(rang_de(&c, b), Some((k2, "membre".into())));
    assert_eq!(par_id(&c, k1).unwrap().membres, 1);
}

#[test]
fn le_chef_modifie_son_clan() {
    let c = neuve();
    let (a, b, d) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"), joueur(&c, "Delta"));
    let k = creer(&c, a, "Ancien Nom", "OLD", "desc", true).unwrap();
    rejoindre(&c, d, k).unwrap();
    creer(&c, b, "Pris", "PRIS", "", true).unwrap();
    let r = |nom, tag| Reglages { nom, tag, ..Default::default() };
    assert_eq!(regler(&c, a, r(Some("pris"), None)).unwrap_err().0, StatusCode::CONFLICT);
    assert_eq!(regler(&c, a, r(None, Some("x"))).unwrap_err().0, StatusCode::BAD_REQUEST);
    assert_eq!(regler(&c, d, r(Some("Vol"), None)).unwrap_err().0, StatusCode::FORBIDDEN, "un membre a renomme le clan");
    // Garder son propre nom en changeant de casse passe.
    regler(&c, a, r(Some("ancien nom"), Some("new"))).unwrap();
    let apres = par_id(&c, k).unwrap();
    assert_eq!((apres.nom.as_str(), apres.tag.as_str(), apres.description.as_str()), ("ancien nom", "NEW", "desc"));
    assert!(fil(&c, a, 0).unwrap().last().unwrap().texte.contains("[NEW]"));
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
    regler(&c, a, Reglages { ouvert: Some(true), ..Default::default() }).unwrap();
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
    assert_eq!(regler(&c, a, Reglages { description: Some("x"), ..Default::default() }).unwrap_err().0, StatusCode::FORBIDDEN);
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
fn le_chef_choisit_la_couleur_du_clan() {
    let c = neuve();
    let (a, b) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"));
    let k = creer(&c, a, "Couleurs", "COL", "", true).unwrap();
    rejoindre(&c, b, k).unwrap();
    assert_eq!(couleur_de(&c, b), "", "une couleur sans choix");
    let couleur = |x| Reglages { couleur: Some(x), ..Default::default() };
    assert_eq!(regler(&c, a, couleur("rouge")).unwrap_err().0, StatusCode::BAD_REQUEST);
    assert_eq!(regler(&c, a, couleur("#12345g")).unwrap_err().0, StatusCode::BAD_REQUEST);
    assert_eq!(regler(&c, b, couleur("#00ff00")).unwrap_err().0, StatusCode::FORBIDDEN);
    regler(&c, a, couleur("#22C55E")).unwrap();
    assert_eq!(couleur_de(&c, a), "#22c55e");
    assert_eq!(couleur_de(&c, b), "#22c55e");
    // Une autre modification ne l'efface pas ; le vide la retire.
    regler(&c, a, Reglages { description: Some("vert"), ..Default::default() }).unwrap();
    assert_eq!(par_id(&c, k).unwrap().couleur, "#22c55e");
    regler(&c, a, couleur("")).unwrap();
    assert_eq!(couleur_de(&c, b), "");
    quitter(&c, b).unwrap();
    assert_eq!(couleur_de(&c, b), "", "hors clan, plus de couleur");
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
