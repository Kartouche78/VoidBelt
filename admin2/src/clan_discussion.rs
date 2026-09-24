//! Discussion d'un clan : messages des membres, annonces du clan (arrivee,
//! depart, promotion...) et compte des non lus. Sous-module de `clans`.

use super::{MessageClan, demandes, mon_rang, par_id, poids, rang_de};
use crate::base::maintenant;
use crate::joueurs;
use crate::messages::{TEXTE_MAX, rafale};
use crate::{R, Refus};
use axum::http::StatusCode;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};


fn message_clan(c: &Connection, r: &rusqlite::Row) -> rusqlite::Result<MessageClan> {
    let de: Option<i64> = r.get("de")?;
    Ok(MessageClan {
        id: r.get("id")?,
        de: de.and_then(|d| joueurs::par_id(c, d)),
        texte: r.get("texte")?,
        cree: r.get("cree")?,
    })
}

pub fn ecrire(c: &Connection, moi: i64, brut: &str) -> R<MessageClan> {
    let (clan, _) = mon_rang(c, moi)?;
    let texte = joueurs::texte_propre(brut, TEXTE_MAX, true).ok_or(Refus(StatusCode::BAD_REQUEST, "Message vide."))?;
    rafale(c, moi)?;
    c.execute(
        "INSERT INTO clan_messages (clan_id, de, texte, cree) VALUES (?1, ?2, ?3, ?4)",
        params![clan, moi, texte, maintenant()],
    )?;
    let id = c.last_insert_rowid();
    Ok(c.query_row("SELECT * FROM clan_messages WHERE id = ?1", params![id], |r| message_clan(c, r))?)
}

/// Discussion du clan : les derniers messages, ou ceux venus depuis
/// `apres`. Tout devient lu.
pub fn fil(c: &Connection, moi: i64, apres: i64) -> R<Vec<MessageClan>> {
    let (clan, _) = mon_rang(c, moi)?;
    let mut q = c.prepare(
        "SELECT * FROM (SELECT * FROM clan_messages WHERE clan_id = ?1 AND id > ?2 ORDER BY id DESC LIMIT ?3)
         ORDER BY id",
    )?;
    let v: Vec<MessageClan> = q
        .query_map(params![clan, apres, if apres > 0 { 200 } else { 60 }], |r| message_clan(c, r))?
        .collect::<rusqlite::Result<_>>()?;
    if let Some(m) = v.last() {
        c.execute("UPDATE clan_membres SET lu = max(lu, ?1) WHERE compte_id = ?2", params![m.id, moi])?;
    }
    Ok(v)
}

/// Pour la colonne du panneau : non lus, dernier message, demandes.
pub fn resume(c: &Connection, moi: i64) -> Option<Value> {
    let (clan, rang) = rang_de(c, moi)?;
    let k = par_id(c, clan)?;
    let non_lus: i64 = c
        .query_row(
            "SELECT count(*) FROM clan_messages
             WHERE clan_id = ?1 AND id > (SELECT lu FROM clan_membres WHERE compte_id = ?2)
               AND (de IS NULL OR de <> ?2)",
            params![clan, moi],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let dernier = c
        .query_row(
            "SELECT * FROM clan_messages WHERE clan_id = ?1 ORDER BY id DESC LIMIT 1",
            params![clan],
            |r| message_clan(c, r),
        )
        .optional()
        .ok()
        .flatten();
    let demandes = if poids(&rang) >= 2 { demandes(c, clan).map(|d| d.len()).unwrap_or(0) } else { 0 };
    Some(json!({ "clan": k, "rang": rang, "non_lus": non_lus, "dernier": dernier, "demandes": demandes }))
}
