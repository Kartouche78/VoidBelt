//! Sessions : ce qui prouve, requete apres requete, qu'on s'est connecte.
//!
//! Le jeton de session est 256 bits d'aleatoire du systeme. Il ne vit que
//! dans un cookie `HttpOnly` (le JavaScript ne peut pas le lire),
//! `SameSite=Strict` (un autre site ne peut pas s'en servir), `Secure` en
//! HTTPS. La base n'en garde que l'empreinte SHA-256.

use crate::base::maintenant;
use crate::comptes::Compte;
use axum::http::HeaderMap;
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

pub const COOKIE: &str = "vb_session";
/// Duree d'une session : au-dela, Google redemande la connexion.
pub const DUREE: i64 = 12 * 3600;

fn hex(octets: &[u8]) -> String {
    octets.iter().map(|o| format!("{o:02x}")).collect()
}

pub fn empreinte(jeton: &str) -> String {
    hex(&Sha256::digest(jeton.as_bytes()))
}

/// Jeton imprevisible, en hexadecimal.
pub fn aleatoire() -> String {
    let mut o = [0u8; 32];
    getrandom::fill(&mut o).expect("aleatoire du systeme indisponible");
    hex(&o)
}

/// Ouvre une session pour un compte ; rend le jeton a poser en cookie.
pub fn ouvrir(c: &Connection, compte: i64, agent: &str) -> rusqlite::Result<String> {
    let jeton = aleatoire();
    let t = maintenant();
    let agent: String = agent.chars().take(200).collect();
    c.execute(
        "INSERT INTO sessions (empreinte, compte_id, cree, expire, agent) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![empreinte(&jeton), compte, t, t + DUREE, agent],
    )?;
    // Menage au passage : les sessions expirees ne servent plus a rien.
    c.execute("DELETE FROM sessions WHERE expire < ?1", params![t])?;
    Ok(jeton)
}

/// Compte d'une session valide, ou `None`.
pub fn compte(c: &Connection, jeton: &str) -> Option<Compte> {
    c.query_row(
        "SELECT comptes.* FROM sessions JOIN comptes ON comptes.id = sessions.compte_id
         WHERE sessions.empreinte = ?1 AND sessions.expire > ?2",
        params![empreinte(jeton), maintenant()],
        Compte::depuis,
    )
    .optional()
    .ok()
    .flatten()
}

pub fn fermer(c: &Connection, jeton: &str) {
    let _ = c.execute("DELETE FROM sessions WHERE empreinte = ?1", params![empreinte(jeton)]);
}

/// Jeton de session lu dans les cookies de la requete.
pub fn jeton(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(axum::http::header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|p| p.trim().split_once('='))
        .find(|(k, _)| *k == COOKIE)
        .map(|(_, v)| v.to_string())
        .filter(|v| v.len() == 64 && v.chars().all(|c| c.is_ascii_hexdigit()))
}

/// En-tete `Set-Cookie` qui pose le jeton, ou l'efface (`None`).
pub fn cookie(jeton: Option<&str>, https: bool) -> String {
    let secure = if https { "; Secure" } else { "" };
    match jeton {
        Some(j) => format!("{COOKIE}={j}; Path=/; HttpOnly; SameSite=Strict; Max-Age={DUREE}{secure}"),
        None => format!("{COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::base::neuve;
    use crate::comptes::{Identite, connecter};

    fn joueur(c: &Connection) -> i64 {
        let id = Identite { sub: "s".into(), email: "a@b.c".into(), email_verifie: true, nom: String::new(), avatar: String::new() };
        connecter(c, &id, &[]).unwrap().id
    }

    #[test]
    fn une_session_ouverte_donne_son_compte_puis_se_ferme() {
        let c = neuve();
        let id = joueur(&c);
        let j = ouvrir(&c, id, "test").unwrap();
        assert_eq!(compte(&c, &j).map(|x| x.id), Some(id));
        assert!(compte(&c, &aleatoire()).is_none(), "un jeton invente a ouvert une session");
        fermer(&c, &j);
        assert!(compte(&c, &j).is_none(), "la session survit a la deconnexion");
    }

    #[test]
    fn la_base_ne_garde_pas_le_jeton() {
        let c = neuve();
        let j = ouvrir(&c, joueur(&c), "").unwrap();
        let garde: String = c.query_row("SELECT empreinte FROM sessions", [], |r| r.get(0)).unwrap();
        assert_ne!(garde, j);
        assert_eq!(garde, empreinte(&j));
    }

    #[test]
    fn une_session_expiree_ne_vaut_plus_rien() {
        let c = neuve();
        let j = ouvrir(&c, joueur(&c), "").unwrap();
        c.execute("UPDATE sessions SET expire = 0", []).unwrap();
        assert!(compte(&c, &j).is_none());
    }

    #[test]
    fn le_cookie_est_lu_et_verrouille() {
        let j = aleatoire();
        let mut h = HeaderMap::new();
        h.insert("cookie", format!("autre=1; {COOKIE}={j}; x=y").parse().unwrap());
        assert_eq!(jeton(&h).as_deref(), Some(j.as_str()));
        h.insert("cookie", format!("{COOKIE}=pas-un-jeton").parse().unwrap());
        assert!(jeton(&h).is_none(), "un cookie malforme est passe");
        let pose = cookie(Some(&j), true);
        for attendu in ["HttpOnly", "SameSite=Strict", "Secure", "Path=/"] {
            assert!(pose.contains(attendu), "cookie sans {attendu}");
        }
    }
}
