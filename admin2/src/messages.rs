//! Messagerie privee : on n'ecrit qu'a ses amis.
//!
//! La page demande les nouveaux messages d'une conversation ouverte toutes
//! les quelques secondes (`apres` = dernier id recu) ; lire une conversation
//! marque ses messages comme lus. Le resume (`/api/messagerie`) nourrit la
//! colonne du panneau : conversations, messages non lus, demandes en attente.

use crate::base::{self, maintenant};
use crate::joueurs::{self, Joueur};
use crate::{R, Refus, amis, clans, connecte};
use axum::{
    Json,
    extract::{Path, Query},
    http::{HeaderMap, StatusCode},
};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Longueur d'un message, en caracteres.
pub const TEXTE_MAX: usize = 500;
/// Rafale : pas plus de `RAFALE.1` messages en `RAFALE.0` secondes, prives
/// et clan confondus.
pub const RAFALE: (i64, i64) = (10, 5);
/// Messages rendus a l'ouverture d'une conversation.
const HISTOIRE: i64 = 60;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Message {
    pub id: i64,
    pub de: i64,
    pub texte: String,
    pub cree: i64,
    pub lu: bool,
}

fn message(r: &rusqlite::Row) -> rusqlite::Result<Message> {
    Ok(Message { id: r.get("id")?, de: r.get("de")?, texte: r.get("texte")?, cree: r.get("cree")?, lu: r.get("lu")? })
}

/// Refuse une rafale de messages, prives et clan confondus.
pub fn rafale(c: &Connection, moi: i64) -> R<()> {
    let depuis = maintenant() - RAFALE.0;
    let n: i64 = c.query_row(
        "SELECT (SELECT count(*) FROM messages WHERE de = ?1 AND cree > ?2)
              + (SELECT count(*) FROM clan_messages WHERE de = ?1 AND cree > ?2)",
        params![moi, depuis],
        |r| r.get(0),
    )?;
    if n >= RAFALE.1 {
        return Err(Refus(StatusCode::TOO_MANY_REQUESTS, "Doucement : 5 messages en 10 secondes au plus."));
    }
    Ok(())
}

pub fn envoyer(c: &Connection, moi: i64, lui: i64, brut: &str) -> R<Message> {
    let Some(texte) = joueurs::texte_propre(brut, TEXTE_MAX, true) else {
        return Err(Refus(StatusCode::BAD_REQUEST, "Message vide."));
    };
    if !amis::sont_amis(c, moi, lui) {
        return Err(Refus(StatusCode::FORBIDDEN, "Tu ne peux ecrire qu'a tes amis."));
    }
    rafale(c, moi)?;
    c.execute(
        "INSERT INTO messages (de, a, texte, cree) VALUES (?1, ?2, ?3, ?4)",
        params![moi, lui, texte, maintenant()],
    )?;
    let id = c.last_insert_rowid();
    Ok(c.query_row("SELECT * FROM messages WHERE id = ?1", params![id], message)?)
}

/// Messages entre `moi` et `lui` : les derniers si `apres` vaut 0, sinon
/// ceux venus depuis. Ceux que j'ai recus deviennent lus.
pub fn fil(c: &Connection, moi: i64, lui: i64, apres: i64) -> R<Vec<Message>> {
    let mut q = c.prepare(
        "SELECT * FROM (
             SELECT * FROM messages
             WHERE ((de = ?1 AND a = ?2) OR (de = ?2 AND a = ?1)) AND id > ?3
             ORDER BY id DESC LIMIT ?4
         ) ORDER BY id",
    )?;
    let v: Vec<Message> = q
        .query_map(params![moi, lui, apres, if apres > 0 { 200 } else { HISTOIRE }], message)?
        .collect::<rusqlite::Result<_>>()?;
    c.execute("UPDATE messages SET lu = 1 WHERE a = ?1 AND de = ?2 AND lu = 0", params![moi, lui])?;
    Ok(v)
}

#[derive(Debug, Serialize)]
pub struct Conversation {
    pub avec: Joueur,
    pub dernier: Message,
    pub non_lus: i64,
    /// Encore amis : sinon, on relit sans pouvoir repondre.
    pub ami: bool,
}

/// Conversations, la plus recente d'abord.
pub fn conversations(c: &Connection, moi: i64) -> R<Vec<Conversation>> {
    let mut q = c.prepare(
        "SELECT CASE WHEN de = ?1 THEN a ELSE de END AS autre, max(id) AS dernier,
                sum(CASE WHEN a = ?1 AND lu = 0 THEN 1 ELSE 0 END) AS non_lus
         FROM messages WHERE de = ?1 OR a = ?1
         GROUP BY autre ORDER BY dernier DESC LIMIT 30",
    )?;
    let lignes: Vec<(i64, i64, i64)> = q
        .query_map(params![moi], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut v = Vec::new();
    for (autre, dernier, non_lus) in lignes {
        let Some(avec) = joueurs::par_id(c, autre) else { continue };
        let dernier = c.query_row("SELECT * FROM messages WHERE id = ?1", params![dernier], message)?;
        v.push(Conversation { avec, dernier, non_lus, ami: amis::sont_amis(c, moi, autre) });
    }
    Ok(v)
}

// ------------------------------------------------------------ routes ---

/// Tout ce que la colonne du panneau affiche, en une requete.
pub async fn resume_route(headers: HeaderMap) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    let b = base::base();
    Ok(Json(json!({
        "conversations": conversations(&b, moi.id)?,
        "clan": clans::resume(&b, moi.id),
        "demandes_amis": amis::demandes_recues(&b, moi.id),
    })))
}

#[derive(Deserialize)]
pub struct Apres {
    #[serde(default)]
    apres: i64,
}

pub async fn fil_route(headers: HeaderMap, Path(lui): Path<i64>, Query(a): Query<Apres>) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    let b = base::base();
    let Some(avec) = joueurs::par_id(&b, lui) else {
        return Err(Refus(StatusCode::NOT_FOUND, "Joueur introuvable."));
    };
    Ok(Json(json!({
        "avec": avec,
        "ami": amis::sont_amis(&b, moi.id, lui),
        "messages": fil(&b, moi.id, lui, a.apres)?,
    })))
}

pub async fn envoyer_route(headers: HeaderMap, Path(lui): Path<i64>, Json(corps): Json<Value>) -> R<Json<Message>> {
    let moi = connecte(&headers)?;
    let texte = corps.get("texte").and_then(Value::as_str).unwrap_or("");
    Ok(Json(envoyer(&base::base(), moi.id, lui, texte)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::amis::tests::joueur;
    use crate::amis::{demander, retirer};
    use crate::base::neuve;

    fn amis_ab(c: &Connection) -> (i64, i64) {
        let (a, b) = (joueur(c, "Alpha"), joueur(c, "Bravo"));
        demander(c, a, b).unwrap();
        demander(c, b, a).unwrap();
        (a, b)
    }

    #[test]
    fn on_n_ecrit_qu_a_ses_amis() {
        let c = neuve();
        let (a, b) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"));
        assert_eq!(envoyer(&c, a, b, "salut").unwrap_err().0, StatusCode::FORBIDDEN);
        demander(&c, a, b).unwrap();
        assert!(envoyer(&c, a, b, "salut").is_err(), "une demande en attente suffit pour ecrire");
        demander(&c, b, a).unwrap();
        assert!(envoyer(&c, a, b, "salut").is_ok());
        assert_eq!(envoyer(&c, a, b, "  \u{7} ").unwrap_err().0, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn lire_une_conversation_la_marque_lue() {
        let c = neuve();
        let (a, b) = amis_ab(&c);
        envoyer(&c, a, b, "un").unwrap();
        envoyer(&c, a, b, "deux").unwrap();
        let conv = conversations(&c, b).unwrap();
        assert_eq!(conv.len(), 1);
        assert_eq!((conv[0].non_lus, conv[0].dernier.texte.as_str()), (2, "deux"));
        let f = fil(&c, b, a, 0).unwrap();
        assert_eq!(f.iter().map(|m| m.texte.as_str()).collect::<Vec<_>>(), ["un", "deux"]);
        assert_eq!(conversations(&c, b).unwrap()[0].non_lus, 0);
        // Seuls les messages venus depuis le dernier id.
        let m = envoyer(&c, b, a, "trois").unwrap();
        assert_eq!(fil(&c, a, b, f[1].id).unwrap(), vec![m]);
    }

    #[test]
    fn une_rafale_est_freinee() {
        let c = neuve();
        let (a, b) = amis_ab(&c);
        for i in 0..RAFALE.1 {
            envoyer(&c, a, b, &format!("m{i}")).unwrap();
        }
        assert_eq!(envoyer(&c, a, b, "encore").unwrap_err().0, StatusCode::TOO_MANY_REQUESTS);
        // L'autre peut toujours repondre.
        assert!(envoyer(&c, b, a, "calme").is_ok());
    }

    #[test]
    fn un_message_trop_long_est_coupe() {
        let c = neuve();
        let (a, b) = amis_ab(&c);
        let m = envoyer(&c, a, b, &"x".repeat(2000)).unwrap();
        assert_eq!(m.texte.chars().count(), TEXTE_MAX);
    }

    #[test]
    fn apres_une_rupture_on_relit_sans_repondre() {
        let c = neuve();
        let (a, b) = amis_ab(&c);
        envoyer(&c, a, b, "salut").unwrap();
        retirer(&c, b, a).unwrap();
        let conv = conversations(&c, a).unwrap();
        assert!(!conv[0].ami);
        assert!(envoyer(&c, a, b, "encore").is_err());
    }
}
