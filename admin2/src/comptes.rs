//! Comptes des joueurs : cree ou mis a jour a chaque connexion Google.
//!
//! Tout le monde peut avoir un compte (profil, et bientot la ranked). Le
//! role `admin` n'est donne qu'aux adresses de `ADMIN_EMAILS`, verifiees par
//! Google, et une seule identite Google par adresse peut le recevoir : si
//! l'adresse change un jour de proprietaire, le nouveau n'herite de rien.

use crate::base::maintenant;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Compte {
    pub id: i64,
    pub email: String,
    pub nom: String,
    /// Avatar a afficher : celui choisi par le joueur (adresse de l'API,
    /// commencant par `/`), sinon celui de Google.
    pub avatar: String,
    pub pseudo: String,
    pub role: String,
    /// Creation du compte, en secondes depuis 1970.
    pub cree: i64,
}

impl Compte {
    pub fn est_admin(&self) -> bool {
        self.role == "admin"
    }

    pub(crate) fn depuis(r: &Row) -> rusqlite::Result<Compte> {
        let id: i64 = r.get("id")?;
        let maj: i64 = r.get("avatar_maj")?;
        Ok(Compte {
            id,
            email: r.get("email")?,
            nom: r.get("nom")?,
            // `?v=` change a chaque nouvel avatar : le navigateur ne garde
            // pas l'ancien en cache.
            avatar: if maj > 0 { format!("/api/profil/avatar/{id}?v={maj}") } else { r.get("avatar")? },
            pseudo: r.get("pseudo")?,
            role: r.get("role")?,
            cree: r.get("cree")?,
        })
    }
}

/// Ce que Google dit de la personne qui vient de se connecter.
pub struct Identite {
    pub sub: String,
    pub email: String,
    pub email_verifie: bool,
    pub nom: String,
    pub avatar: String,
}

/// Adresses admin, lues dans `ADMIN_EMAILS` (separees par des virgules).
pub fn admins() -> Vec<String> {
    std::env::var("ADMIN_EMAILS")
        .unwrap_or_default()
        .split(',')
        .map(|e| e.trim().to_lowercase())
        .filter(|e| !e.is_empty())
        .collect()
}

/// Cree le compte a la premiere connexion, le met a jour aux suivantes, et
/// fixe son role.
pub fn connecter(c: &Connection, id: &Identite, admins: &[String]) -> rusqlite::Result<Compte> {
    let email = id.email.trim().to_lowercase();
    let t = maintenant();
    c.execute(
        "INSERT INTO comptes (google_sub, email, email_verifie, nom, avatar, cree, derniere_connexion)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT (google_sub) DO UPDATE SET
             email = excluded.email,
             email_verifie = excluded.email_verifie,
             nom = excluded.nom,
             avatar = excluded.avatar,
             derniere_connexion = excluded.derniere_connexion",
        params![id.sub, email, id.email_verifie, id.nom, id.avatar, t],
    )?;

    // Role admin : adresse autorisee, verifiee par Google, et aucune autre
    // identite Google n'est deja admin sous cette adresse.
    let voulu = id.email_verifie && admins.contains(&email);
    let deja_pris: bool = c.query_row(
        "SELECT EXISTS (SELECT 1 FROM comptes WHERE email = ?1 AND role = 'admin' AND google_sub <> ?2)",
        params![email, id.sub],
        |r| r.get(0),
    )?;
    let role = if voulu && !deja_pris { "admin" } else { "joueur" };
    c.execute("UPDATE comptes SET role = ?1 WHERE google_sub = ?2", params![role, id.sub])?;

    c.query_row("SELECT * FROM comptes WHERE google_sub = ?1", params![id.sub], Compte::depuis)
}

pub fn par_id(c: &Connection, id: i64) -> Option<Compte> {
    c.query_row("SELECT * FROM comptes WHERE id = ?1", params![id], Compte::depuis)
        .optional()
        .ok()
        .flatten()
}

/// Pseudo propre : lettres, chiffres, espaces, tirets et soulignes, 3 a 16
/// caracteres. `None` s'il ne convient pas.
pub fn pseudo_valide(brut: &str) -> Option<String> {
    let p: String = brut.trim().chars().filter(|c| !c.is_control()).collect();
    let ok = (3..=16).contains(&p.chars().count())
        && p.chars().all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_'));
    ok.then_some(p)
}

/// Vrai si un autre compte porte deja ce pseudo, sans tenir compte des
/// majuscules : on doit pouvoir retrouver un joueur par son nom.
pub fn pseudo_pris(c: &Connection, id: i64, pseudo: &str) -> bool {
    c.query_row(
        "SELECT EXISTS (SELECT 1 FROM comptes WHERE lower(pseudo) = lower(?1) AND id <> ?2)",
        params![pseudo, id],
        |r| r.get(0),
    )
    .unwrap_or(true)
}

pub fn changer_pseudo(c: &Connection, id: i64, pseudo: &str) -> rusqlite::Result<()> {
    c.execute("UPDATE comptes SET pseudo = ?1 WHERE id = ?2", params![pseudo, id]).map(|_| ())
}

/// Pose l'avatar choisi par le joueur (image deja verifiee).
pub fn poser_avatar(c: &Connection, id: i64, image: &[u8]) -> rusqlite::Result<()> {
    let t = crate::base::maintenant();
    c.execute(
        "INSERT INTO avatars (compte_id, image, maj) VALUES (?1, ?2, ?3)
         ON CONFLICT (compte_id) DO UPDATE SET image = excluded.image, maj = excluded.maj",
        params![id, image, t],
    )?;
    c.execute("UPDATE comptes SET avatar_maj = ?1 WHERE id = ?2", params![t, id]).map(|_| ())
}

/// Retire l'avatar choisi : celui de Google reprend sa place.
pub fn retirer_avatar(c: &Connection, id: i64) -> rusqlite::Result<()> {
    c.execute("DELETE FROM avatars WHERE compte_id = ?1", params![id])?;
    c.execute("UPDATE comptes SET avatar_maj = 0 WHERE id = ?1", params![id]).map(|_| ())
}

pub fn avatar(c: &Connection, id: i64) -> Option<Vec<u8>> {
    c.query_row("SELECT image FROM avatars WHERE compte_id = ?1", params![id], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::base::neuve;

    fn qui(sub: &str, email: &str, verifie: bool) -> Identite {
        Identite { sub: sub.into(), email: email.into(), email_verifie: verifie, nom: "Nom".into(), avatar: String::new() }
    }

    #[test]
    fn une_connexion_cree_puis_met_a_jour_le_compte() {
        let c = neuve();
        let a = connecter(&c, &qui("1", "Joueur@Gmail.com", true), &[]).unwrap();
        assert_eq!(a.email, "joueur@gmail.com");
        assert_eq!(a.role, "joueur");
        let b = connecter(&c, &qui("1", "nouvelle@gmail.com", true), &[]).unwrap();
        assert_eq!(a.id, b.id, "une deuxieme connexion a cree un second compte");
        assert_eq!(b.email, "nouvelle@gmail.com");
    }

    #[test]
    fn seule_une_adresse_autorisee_et_verifiee_devient_admin() {
        let c = neuve();
        let admins = vec!["moi@gmail.com".to_string()];
        assert!(connecter(&c, &qui("1", "moi@gmail.com", true), &admins).unwrap().est_admin());
        assert!(!connecter(&c, &qui("2", "autre@gmail.com", true), &admins).unwrap().est_admin());
        assert!(!connecter(&c, &qui("3", "moi@gmail.com", false), &admins).unwrap().est_admin(), "adresse non verifiee");
    }

    #[test]
    fn une_adresse_reprise_par_quelqu_un_d_autre_n_herite_pas_du_role() {
        let c = neuve();
        let admins = vec!["moi@gmail.com".to_string()];
        connecter(&c, &qui("original", "moi@gmail.com", true), &admins).unwrap();
        let intrus = connecter(&c, &qui("intrus", "moi@gmail.com", true), &admins).unwrap();
        assert!(!intrus.est_admin(), "une seconde identite Google est devenue admin");
    }

    #[test]
    fn retirer_une_adresse_retire_le_role() {
        let c = neuve();
        connecter(&c, &qui("1", "moi@gmail.com", true), &["moi@gmail.com".into()]).unwrap();
        assert!(!connecter(&c, &qui("1", "moi@gmail.com", true), &[]).unwrap().est_admin());
    }

    #[test]
    fn un_pseudo_ne_se_porte_qu_une_fois() {
        let c = neuve();
        let a = connecter(&c, &qui("1", "a@gmail.com", true), &[]).unwrap();
        let b = connecter(&c, &qui("2", "b@gmail.com", true), &[]).unwrap();
        changer_pseudo(&c, a.id, "Kartouche").unwrap();
        assert!(pseudo_pris(&c, b.id, "kartouche"), "deux joueurs ont le meme pseudo");
        assert!(!pseudo_pris(&c, a.id, "Kartouche"), "on ne peut plus garder son propre pseudo");
    }

    #[test]
    fn l_avatar_choisi_passe_devant_celui_de_google_puis_s_efface() {
        let c = neuve();
        let a = connecter(&c, &qui("1", "a@gmail.com", true), &[]).unwrap();
        poser_avatar(&c, a.id, b"PNG").unwrap();
        let avec = par_id(&c, a.id).unwrap();
        assert!(avec.avatar.starts_with(&format!("/api/profil/avatar/{}?v=", a.id)), "{}", avec.avatar);
        assert_eq!(avatar(&c, a.id).as_deref(), Some(&b"PNG"[..]));
        // Une reconnexion Google ne l'ecrase pas.
        assert!(connecter(&c, &qui("1", "a@gmail.com", true), &[]).unwrap().avatar.starts_with("/api/"));
        retirer_avatar(&c, a.id).unwrap();
        assert_eq!(par_id(&c, a.id).unwrap().avatar, "", "l'avatar de Google n'est pas revenu");
        assert!(avatar(&c, a.id).is_none());
    }

    #[test]
    fn le_pseudo_est_nettoye() {
        assert_eq!(pseudo_valide("  Kartouche78 "), Some("Kartouche78".into()));
        assert_eq!(pseudo_valide("ab"), None);
        assert_eq!(pseudo_valide("<script>"), None);
        assert_eq!(pseudo_valide("un pseudo bien trop long"), None);
    }
}
