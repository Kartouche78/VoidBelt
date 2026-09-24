//! Clans : creation, entree, rangs et discussion.
//!
//! Trois rangs : chef, officier, membre. Le chef regle le clan (description,
//! ouvert ou ferme, image), nomme et destitue les officiers, passe la main
//! ou dissout. Chef et officiers acceptent les demandes et excluent les
//! rangs en dessous d'eux. Un joueur n'est que dans un clan a la fois.
//!
//! Quand le chef s'en va, l'officier le plus ancien prend sa place, sinon
//! le membre le plus ancien ; le dernier qui part emporte le clan.

use crate::base::maintenant;
use crate::joueurs::{self, Joueur};
use crate::messages::{TEXTE_MAX, rafale};
use crate::{R, Refus};
use axum::http::StatusCode;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::{Value, json};

pub const MEMBRES_MAX: i64 = 50;
pub const DESCRIPTION_MAX: usize = 200;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Clan {
    pub id: i64,
    pub nom: String,
    pub tag: String,
    pub description: String,
    pub ouvert: bool,
    /// Adresse de l'image (sur l'API), vide sans image.
    pub image: String,
    pub cree: i64,
    pub membres: i64,
}

#[derive(Debug, Serialize)]
pub struct Membre {
    pub joueur: Joueur,
    pub rang: String,
    pub entre: i64,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct MessageClan {
    pub id: i64,
    /// Auteur ; vide pour une annonce du clan.
    pub de: Option<Joueur>,
    pub texte: String,
    pub cree: i64,
}

/// Poids d'un rang : on n'agit que sur les rangs plus bas que le sien.
pub fn poids(rang: &str) -> u8 {
    match rang {
        "chef" => 3,
        "officier" => 2,
        _ => 1,
    }
}

/// Nom de clan : 3 a 24 caracteres, lettres, chiffres, espaces, `-_'.`.
pub fn nom_valide(brut: &str) -> Option<String> {
    let n: String = brut.split_whitespace().collect::<Vec<_>>().join(" ");
    let ok = (3..=24).contains(&n.chars().count())
        && n.chars().all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '\'' | '.'));
    ok.then_some(n)
}

/// Tag : 2 a 5 lettres ou chiffres, en majuscules.
pub fn tag_valide(brut: &str) -> Option<String> {
    let t = brut.trim().to_uppercase();
    ((2..=5).contains(&t.chars().count()) && t.chars().all(|c| c.is_ascii_alphanumeric())).then_some(t)
}

fn clan(r: &rusqlite::Row) -> rusqlite::Result<Clan> {
    let id: i64 = r.get("id")?;
    let maj: i64 = r.get("image_maj")?;
    Ok(Clan {
        id,
        nom: r.get("nom")?,
        tag: r.get("tag")?,
        description: r.get("description")?,
        ouvert: r.get("ouvert")?,
        image: if maj > 0 { format!("/api/clans/{id}/image?v={maj}") } else { String::new() },
        cree: r.get("cree")?,
        membres: r.get("membres")?,
    })
}

const CLAN: &str = "SELECT clans.*, (SELECT count(*) FROM clan_membres m WHERE m.clan_id = clans.id) AS membres FROM clans";

pub fn par_id(c: &Connection, id: i64) -> Option<Clan> {
    c.query_row(&format!("{CLAN} WHERE id = ?1"), params![id], clan).optional().ok().flatten()
}

/// Clan et rang d'un joueur.
pub fn rang_de(c: &Connection, moi: i64) -> Option<(i64, String)> {
    c.query_row("SELECT clan_id, rang FROM clan_membres WHERE compte_id = ?1", params![moi], |r| {
        Ok((r.get(0)?, r.get(1)?))
    })
    .optional()
    .ok()
    .flatten()
}

fn mon_rang(c: &Connection, moi: i64) -> R<(i64, String)> {
    rang_de(c, moi).ok_or(Refus(StatusCode::CONFLICT, "Tu n'es dans aucun clan."))
}

/// Ce que l'icone du panneau montre du clan d'un joueur.
pub fn bref(c: &Connection, moi: i64) -> Option<Value> {
    let (id, rang) = rang_de(c, moi)?;
    let k = par_id(c, id)?;
    Some(json!({ "id": k.id, "nom": k.nom, "tag": k.tag, "image": k.image, "rang": rang }))
}

/// Message du clan lui-meme : arrivee, depart, promotion.
fn annonce(c: &Connection, clan: i64, texte: String) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO clan_messages (clan_id, de, texte, cree) VALUES (?1, NULL, ?2, ?3)",
        params![clan, texte, maintenant()],
    )
    .map(|_| ())
}

fn nom_de(c: &Connection, id: i64) -> String {
    joueurs::par_id(c, id).map(|j| j.pseudo).unwrap_or_else(|| "Un joueur".into())
}

/// Entre dans le clan : ses anciennes demandes tombent, et l'histoire deja
/// ecrite compte comme lue (l'annonce de l'arrivee se pose donc avant).
fn entrer(c: &Connection, moi: i64, clan: i64, rang: &str) -> rusqlite::Result<()> {
    c.execute("DELETE FROM clan_demandes WHERE compte_id = ?1", params![moi])?;
    c.execute(
        "INSERT INTO clan_membres (compte_id, clan_id, rang, entre, lu)
         VALUES (?1, ?2, ?3, ?4, (SELECT coalesce(max(id), 0) FROM clan_messages WHERE clan_id = ?2))",
        params![moi, clan, rang, maintenant()],
    )
    .map(|_| ())
}

pub fn creer(c: &Connection, moi: i64, nom: &str, tag: &str, description: &str, ouvert: bool) -> R<i64> {
    if rang_de(c, moi).is_some() {
        return Err(Refus(StatusCode::CONFLICT, "Quitte d'abord ton clan."));
    }
    let nom = nom_valide(nom).ok_or(Refus(StatusCode::BAD_REQUEST, "Nom de 3 a 24 caracteres : lettres, chiffres, espaces."))?;
    let tag = tag_valide(tag).ok_or(Refus(StatusCode::BAD_REQUEST, "Tag de 2 a 5 lettres ou chiffres."))?;
    let pris: bool = c.query_row(
        "SELECT EXISTS (SELECT 1 FROM clans WHERE nom = ?1 COLLATE NOCASE OR tag = ?2 COLLATE NOCASE)",
        params![nom, tag],
        |r| r.get(0),
    )?;
    if pris {
        return Err(Refus(StatusCode::CONFLICT, "Ce nom ou ce tag est deja pris."));
    }
    let description = joueurs::texte_propre(description, DESCRIPTION_MAX, false).unwrap_or_default();
    let tx = c.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO clans (nom, tag, description, ouvert, cree) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![nom, tag, description, ouvert, maintenant()],
    )?;
    let id = tx.last_insert_rowid();
    annonce(&tx, id, format!("{} fonde le clan [{tag}] {nom}.", nom_de(&tx, moi)))?;
    entrer(&tx, moi, id, "chef")?;
    tx.commit()?;
    Ok(id)
}

/// Clans dont le nom ou le tag contient `q` ; sans `q`, les plus peuples.
pub fn chercher(c: &Connection, q: &str) -> R<Vec<Clan>> {
    let q = q.trim();
    let mut req = c.prepare(&format!(
        "{CLAN} WHERE ?1 = '' OR nom LIKE ?2 ESCAPE '\\' OR tag LIKE ?2 ESCAPE '\\'
         ORDER BY membres DESC, lower(nom) LIMIT 20"
    ))?;
    let v = req
        .query_map(params![q, format!("%{}%", joueurs::motif(q))], clan)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(v)
}

/// Rejoint un clan ouvert, ou demande a entrer dans un clan ferme. Rend
/// `"membre"` ou `"demande"`.
pub fn rejoindre(c: &Connection, moi: i64, id: i64) -> R<&'static str> {
    if rang_de(c, moi).is_some() {
        return Err(Refus(StatusCode::CONFLICT, "Quitte d'abord ton clan."));
    }
    let k = par_id(c, id).ok_or(Refus(StatusCode::NOT_FOUND, "Clan introuvable."))?;
    if k.membres >= MEMBRES_MAX {
        return Err(Refus(StatusCode::CONFLICT, "Ce clan est complet (50 membres)."));
    }
    if !k.ouvert {
        c.execute(
            "INSERT OR IGNORE INTO clan_demandes (clan_id, compte_id, cree) VALUES (?1, ?2, ?3)",
            params![id, moi, maintenant()],
        )?;
        return Ok("demande");
    }
    let tx = c.unchecked_transaction()?;
    annonce(&tx, id, format!("{} rejoint le clan.", nom_de(&tx, moi)))?;
    entrer(&tx, moi, id, "membre")?;
    tx.commit()?;
    Ok("membre")
}

pub fn annuler_demande(c: &Connection, moi: i64, id: i64) -> R<()> {
    c.execute("DELETE FROM clan_demandes WHERE clan_id = ?1 AND compte_id = ?2", params![id, moi])?;
    Ok(())
}

/// Clans ou j'attends une reponse.
pub fn mes_demandes(c: &Connection, moi: i64) -> R<Vec<i64>> {
    let mut q = c.prepare("SELECT clan_id FROM clan_demandes WHERE compte_id = ?1")?;
    let v = q.query_map(params![moi], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(v)
}

pub fn membres(c: &Connection, clan: i64) -> R<Vec<Membre>> {
    let mut q = c.prepare("SELECT compte_id, rang, entre FROM clan_membres WHERE clan_id = ?1 ORDER BY entre")?;
    let lignes: Vec<(i64, String, i64)> = q
        .query_map(params![clan], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut v: Vec<Membre> = lignes
        .into_iter()
        .filter_map(|(id, rang, entre)| Some(Membre { joueur: joueurs::par_id(c, id)?, rang, entre }))
        .collect();
    v.sort_by_key(|m| std::cmp::Reverse(poids(&m.rang)));
    Ok(v)
}

pub fn demandes(c: &Connection, clan: i64) -> R<Vec<Joueur>> {
    let mut q = c.prepare("SELECT compte_id FROM clan_demandes WHERE clan_id = ?1 ORDER BY cree")?;
    let ids: Vec<i64> = q.query_map(params![clan], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(joueurs::plusieurs(c, ids))
}

/// Quitte son clan. Le chef qui part passe la main ; le dernier emporte le
/// clan.
pub fn quitter(c: &Connection, moi: i64) -> R<()> {
    let (clan, rang) = mon_rang(c, moi)?;
    let tx = c.unchecked_transaction()?;
    tx.execute("DELETE FROM clan_membres WHERE compte_id = ?1", params![moi])?;
    let successeur: Option<i64> = tx
        .query_row(
            "SELECT compte_id FROM clan_membres WHERE clan_id = ?1
             ORDER BY rang = 'officier' DESC, entre LIMIT 1",
            params![clan],
            |r| r.get(0),
        )
        .optional()?;
    match successeur {
        None => {
            tx.execute("DELETE FROM clans WHERE id = ?1", params![clan])?;
        }
        Some(s) => {
            annonce(&tx, clan, format!("{} quitte le clan.", nom_de(&tx, moi)))?;
            if rang == "chef" {
                tx.execute("UPDATE clan_membres SET rang = 'chef' WHERE compte_id = ?1", params![s])?;
                annonce(&tx, clan, format!("{} devient chef.", nom_de(&tx, s)))?;
            }
        }
    }
    tx.commit()?;
    Ok(())
}

/// Actions du chef et des officiers sur un membre ou une demande :
/// `accepter`, `refuser`, `exclure`, `promouvoir`, `retrograder`, `chef`.
pub fn agir(c: &Connection, moi: i64, cible: i64, action: &str) -> R<()> {
    let (clan, rang) = mon_rang(c, moi)?;
    let interdit = Refus(StatusCode::FORBIDDEN, "Ton rang ne le permet pas.");
    if poids(&rang) < 2 {
        return Err(interdit);
    }
    let tx = c.unchecked_transaction()?;
    match action {
        "accepter" | "refuser" => {
            let n = tx.execute("DELETE FROM clan_demandes WHERE clan_id = ?1 AND compte_id = ?2", params![clan, cible])?;
            if n == 0 {
                return Err(Refus(StatusCode::NOT_FOUND, "Cette demande n'existe plus."));
            }
            if action == "accepter" {
                if rang_de(&tx, cible).is_some() {
                    return Err(Refus(StatusCode::CONFLICT, "Ce joueur a deja rejoint un autre clan."));
                }
                if par_id(&tx, clan).is_some_and(|k| k.membres >= MEMBRES_MAX) {
                    return Err(Refus(StatusCode::CONFLICT, "Le clan est complet (50 membres)."));
                }
                annonce(&tx, clan, format!("{} rejoint le clan.", nom_de(&tx, cible)))?;
                entrer(&tx, cible, clan, "membre")?;
            }
        }
        _ => {
            let Some((son_clan, son_rang)) = rang_de(&tx, cible).filter(|(k, _)| *k == clan) else {
                return Err(Refus(StatusCode::NOT_FOUND, "Ce joueur n'est pas dans ton clan."));
            };
            debug_assert_eq!(son_clan, clan);
            if cible == moi || poids(&son_rang) >= poids(&rang) {
                return Err(interdit);
            }
            let nom = nom_de(&tx, cible);
            match action {
                "exclure" => {
                    tx.execute("DELETE FROM clan_membres WHERE compte_id = ?1", params![cible])?;
                    annonce(&tx, clan, format!("{nom} est exclu du clan."))?;
                }
                "promouvoir" | "retrograder" | "chef" if rang != "chef" => return Err(interdit),
                "promouvoir" if son_rang == "membre" => {
                    tx.execute("UPDATE clan_membres SET rang = 'officier' WHERE compte_id = ?1", params![cible])?;
                    annonce(&tx, clan, format!("{nom} devient officier."))?;
                }
                "retrograder" if son_rang == "officier" => {
                    tx.execute("UPDATE clan_membres SET rang = 'membre' WHERE compte_id = ?1", params![cible])?;
                    annonce(&tx, clan, format!("{nom} redevient membre."))?;
                }
                "chef" => {
                    tx.execute("UPDATE clan_membres SET rang = 'officier' WHERE compte_id = ?1", params![moi])?;
                    tx.execute("UPDATE clan_membres SET rang = 'chef' WHERE compte_id = ?1", params![cible])?;
                    annonce(&tx, clan, format!("{nom} devient chef."))?;
                }
                _ => return Err(Refus(StatusCode::BAD_REQUEST, "Action inconnue.")),
            }
        }
    }
    tx.commit()?;
    Ok(())
}

fn chef(c: &Connection, moi: i64) -> R<i64> {
    match mon_rang(c, moi)? {
        (clan, r) if r == "chef" => Ok(clan),
        _ => Err(Refus(StatusCode::FORBIDDEN, "Seul le chef regle le clan.")),
    }
}

/// Reglages du chef : description, clan ouvert ou ferme.
pub fn regler(c: &Connection, moi: i64, description: Option<&str>, ouvert: Option<bool>) -> R<()> {
    let clan = chef(c, moi)?;
    if let Some(d) = description {
        let d = joueurs::texte_propre(d, DESCRIPTION_MAX, false).unwrap_or_default();
        c.execute("UPDATE clans SET description = ?1 WHERE id = ?2", params![d, clan])?;
    }
    if let Some(o) = ouvert {
        c.execute("UPDATE clans SET ouvert = ?1 WHERE id = ?2", params![o, clan])?;
    }
    Ok(())
}

/// Image du clan (deja verifiee), ou `None` pour la retirer.
pub fn poser_image(c: &Connection, moi: i64, image: Option<&[u8]>) -> R<()> {
    let clan = chef(c, moi)?;
    let maj = if image.is_some() { maintenant().max(1) } else { 0 };
    c.execute("UPDATE clans SET image = ?1, image_maj = ?2 WHERE id = ?3", params![image, maj, clan])?;
    Ok(())
}

pub fn image(c: &Connection, id: i64) -> Option<Vec<u8>> {
    c.query_row("SELECT image FROM clans WHERE id = ?1", params![id], |r| r.get(0)).optional().ok().flatten().flatten()
}

pub fn dissoudre(c: &Connection, moi: i64) -> R<()> {
    let clan = chef(c, moi)?;
    c.execute("DELETE FROM clans WHERE id = ?1", params![clan])?;
    Ok(())
}

// --------------------------------------------------------- discussion ---

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

#[cfg(test)]
#[path = "clans_tests.rs"]
mod tests;
