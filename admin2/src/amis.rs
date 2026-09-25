//! Amis : une demande, puis une amitie une fois acceptee.
//!
//! Demander a quelqu'un qui nous a deja demande accepte sa demande. Retirer
//! sert a tout : refuser une demande, l'annuler, ou rompre une amitie.

use crate::base::{self, maintenant};
use crate::joueurs::{self, Joueur};
use crate::{R, Refus, connecte};
use axum::{
    Json,
    extract::{Path, Query},
    http::{HeaderMap, StatusCode},
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Au-dela, la liste ne tient plus dans le panneau.
pub const AMIS_MAX: i64 = 200;
/// Demandes envoyees et encore sans reponse.
pub const DEMANDES_MAX: i64 = 30;

/// Ce qui me lie a un autre joueur.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Lien {
    Aucun,
    Ami,
    /// J'ai demande, il n'a pas repondu.
    Envoyee,
    /// Il m'a demande.
    Recue,
}

pub fn lien(c: &Connection, moi: i64, lui: i64) -> Lien {
    let ligne: Option<(i64, bool)> = c
        .query_row(
            "SELECT demandeur, acceptee FROM amities
             WHERE (demandeur = ?1 AND receveur = ?2) OR (demandeur = ?2 AND receveur = ?1)",
            params![moi, lui],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .ok()
        .flatten();
    match ligne {
        None => Lien::Aucun,
        Some((_, true)) => Lien::Ami,
        Some((d, false)) if d == moi => Lien::Envoyee,
        Some(_) => Lien::Recue,
    }
}

pub fn sont_amis(c: &Connection, a: i64, b: i64) -> bool {
    lien(c, a, b) == Lien::Ami
}

fn nombre_amis(c: &Connection, id: i64) -> rusqlite::Result<i64> {
    c.query_row(
        "SELECT count(*) FROM amities WHERE acceptee = 1 AND (demandeur = ?1 OR receveur = ?1)",
        params![id],
        |r| r.get(0),
    )
}

/// Demande `lui` en ami, ou accepte sa demande s'il l'a deja faite.
pub fn demander(c: &Connection, moi: i64, lui: i64) -> R<Lien> {
    if moi == lui {
        return Err(Refus(StatusCode::BAD_REQUEST, "C'est toi !"));
    }
    if joueurs::par_id(c, lui).is_none() {
        return Err(Refus(StatusCode::NOT_FOUND, "Joueur introuvable."));
    }
    match lien(c, moi, lui) {
        l @ (Lien::Ami | Lien::Envoyee) => Ok(l),
        Lien::Recue => {
            if nombre_amis(c, moi)? >= AMIS_MAX || nombre_amis(c, lui)? >= AMIS_MAX {
                return Err(Refus(StatusCode::CONFLICT, "Liste d'amis pleine (200 au plus)."));
            }
            c.execute("UPDATE amities SET acceptee = 1 WHERE demandeur = ?1 AND receveur = ?2", params![lui, moi])?;
            Ok(Lien::Ami)
        }
        Lien::Aucun => {
            let en_attente: i64 = c.query_row(
                "SELECT count(*) FROM amities WHERE demandeur = ?1 AND acceptee = 0",
                params![moi],
                |r| r.get(0),
            )?;
            if en_attente >= DEMANDES_MAX {
                return Err(Refus(StatusCode::TOO_MANY_REQUESTS, "Trop de demandes sans reponse : attends un peu."));
            }
            c.execute(
                "INSERT INTO amities (demandeur, receveur, cree) VALUES (?1, ?2, ?3)",
                params![moi, lui, maintenant()],
            )?;
            Ok(Lien::Envoyee)
        }
    }
}

/// Refuse, annule ou rompt : plus rien ne lie les deux joueurs.
pub fn retirer(c: &Connection, moi: i64, lui: i64) -> R<()> {
    c.execute(
        "DELETE FROM amities WHERE (demandeur = ?1 AND receveur = ?2) OR (demandeur = ?2 AND receveur = ?1)",
        params![moi, lui],
    )?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct Liste {
    pub amis: Vec<Joueur>,
    pub recues: Vec<Joueur>,
    pub envoyees: Vec<Joueur>,
}

fn ids(c: &Connection, sql: &str, moi: i64) -> rusqlite::Result<Vec<i64>> {
    let mut q = c.prepare(sql)?;
    q.query_map(params![moi], |r| r.get(0))?.collect()
}

pub fn liste(c: &Connection, moi: i64) -> R<Liste> {
    let mut amis = joueurs::plusieurs(
        c,
        ids(
            c,
            "SELECT CASE WHEN demandeur = ?1 THEN receveur ELSE demandeur END FROM amities
             WHERE acceptee = 1 AND (demandeur = ?1 OR receveur = ?1)",
            moi,
        )?,
    );
    amis.sort_by_key(|j| j.pseudo.to_lowercase());
    Ok(Liste {
        amis,
        recues: joueurs::plusieurs(
            c,
            ids(c, "SELECT demandeur FROM amities WHERE receveur = ?1 AND acceptee = 0 ORDER BY cree DESC", moi)?,
        ),
        envoyees: joueurs::plusieurs(
            c,
            ids(c, "SELECT receveur FROM amities WHERE demandeur = ?1 AND acceptee = 0 ORDER BY cree DESC", moi)?,
        ),
    })
}

/// Joueurs dont le pseudo commence par `q` (2 lettres au moins), avec ce
/// qui me lie a chacun.
pub fn chercher(c: &Connection, moi: i64, q: &str) -> R<Vec<(Joueur, Lien)>> {
    let q = q.trim();
    if q.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let mut req = c.prepare(
        "SELECT id FROM comptes WHERE pseudo LIKE ?1 ESCAPE '\\' AND id <> ?2
         ORDER BY length(pseudo), lower(pseudo) LIMIT 12",
    )?;
    let trouves: Vec<i64> = req
        .query_map(params![format!("{}%", joueurs::motif(q)), moi], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(joueurs::plusieurs(c, trouves).into_iter().map(|j| {
        let l = lien(c, moi, j.id);
        (j, l)
    }).collect())
}

/// Demandes d'ami recues, pour la pastille du panneau.
pub fn demandes_recues(c: &Connection, moi: i64) -> i64 {
    c.query_row(
        "SELECT count(*) FROM amities WHERE receveur = ?1 AND acceptee = 0",
        params![moi],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

// ------------------------------------------------------------ routes ---

pub async fn liste_route(headers: HeaderMap) -> R<Json<Liste>> {
    let moi = connecte(&headers)?;
    Ok(Json(liste(&base::base(), moi.id)?))
}

#[derive(Deserialize)]
pub struct Recherche {
    #[serde(default)]
    q: String,
}

pub async fn chercher_route(headers: HeaderMap, Query(r): Query<Recherche>) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    let trouves = chercher(&base::base(), moi.id, &r.q)?;
    let joueurs: Vec<Value> = trouves
        .into_iter()
        .map(|(j, l)| json!({ "id": j.id, "pseudo": j.pseudo, "avatar": j.avatar, "lien": l }))
        .collect();
    Ok(Json(json!({ "joueurs": joueurs })))
}

pub async fn demander_route(headers: HeaderMap, Path(lui): Path<i64>) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    let l = demander(&base::base(), moi.id, lui)?;
    // Demande recue ou amitie nouee : les deux le voient aussitot.
    crate::social::pousser_amis(moi.id);
    crate::social::pousser_amis(lui);
    crate::social::signaler(lui, json!({ "t": "nouvelles" }));
    Ok(Json(json!({ "lien": l })))
}

pub async fn retirer_route(headers: HeaderMap, Path(lui): Path<i64>) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    retirer(&base::base(), moi.id, lui)?;
    crate::social::pousser_amis(moi.id);
    crate::social::pousser_amis(lui);
    Ok(Json(json!({ "lien": Lien::Aucun })))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::base::neuve;
    use crate::comptes::{Identite, changer_pseudo, connecter};

    /// Un joueur neuf, avec son pseudo.
    pub fn joueur(c: &Connection, pseudo: &str) -> i64 {
        let id = connecter(
            c,
            &Identite { sub: pseudo.into(), email: format!("{pseudo}@x.fr"), email_verifie: true, nom: "Prenom Nom".into(), avatar: String::new() },
            &[],
        )
        .unwrap()
        .id;
        changer_pseudo(c, id, pseudo).unwrap();
        id
    }

    #[test]
    fn une_demande_acceptee_fait_deux_amis() {
        let c = neuve();
        let (a, b) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"));
        assert_eq!(demander(&c, a, b).unwrap(), Lien::Envoyee);
        assert_eq!(lien(&c, b, a), Lien::Recue);
        assert!(!sont_amis(&c, a, b));
        // Redemander ne double pas la demande.
        assert_eq!(demander(&c, a, b).unwrap(), Lien::Envoyee);
        assert_eq!(demander(&c, b, a).unwrap(), Lien::Ami);
        assert!(sont_amis(&c, a, b) && sont_amis(&c, b, a));
        let l = liste(&c, a).unwrap();
        assert_eq!(l.amis.len(), 1);
        assert!(l.recues.is_empty() && l.envoyees.is_empty());
    }

    #[test]
    fn retirer_refuse_ou_rompt() {
        let c = neuve();
        let (a, b) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"));
        demander(&c, a, b).unwrap();
        retirer(&c, b, a).unwrap();
        assert_eq!(lien(&c, a, b), Lien::Aucun);
        demander(&c, a, b).unwrap();
        demander(&c, b, a).unwrap();
        retirer(&c, a, b).unwrap();
        assert!(!sont_amis(&c, a, b));
    }

    #[test]
    fn on_ne_s_ajoute_pas_soi_meme_ni_un_fantome() {
        let c = neuve();
        let a = joueur(&c, "Alpha");
        assert_eq!(demander(&c, a, a).unwrap_err().0, StatusCode::BAD_REQUEST);
        assert_eq!(demander(&c, a, 999).unwrap_err().0, StatusCode::NOT_FOUND);
    }

    #[test]
    fn la_recherche_par_pseudo_ne_montre_pas_l_adresse() {
        let c = neuve();
        let a = joueur(&c, "Alpha");
        joueur(&c, "Kartouche");
        joueur(&c, "Kart_2");
        joueur(&c, "Bravo");
        let r = chercher(&c, a, "kar").unwrap();
        assert_eq!(r.len(), 2);
        assert!(r.iter().all(|(_, l)| *l == Lien::Aucun));
        assert!(chercher(&c, a, "k").unwrap().is_empty(), "une lettre ne suffit pas");
        // `_` n'est pas un joker.
        assert_eq!(chercher(&c, a, "Kart_").unwrap().len(), 1);
        assert!(chercher(&c, a, "alp").unwrap().is_empty(), "on se trouve soi-meme");
        let v = serde_json::to_string(&r[0].0).unwrap();
        assert!(!v.contains('@'), "l'adresse d'un joueur fuit : {v}");
    }
}
