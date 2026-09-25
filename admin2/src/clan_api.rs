//! Routes des clans. La logique vit dans `clans.rs` ; ici, on lit la
//! requete, on verifie la session et on repond.

use crate::base;
use crate::clans::{self, poids};
use crate::profil::type_image;
use crate::{R, Refus, connecte};
use axum::{
    Json,
    extract::{Path, Query},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use serde::Deserialize;
use serde_json::{Value, json};

/// Image du clan : la page la reduit a 256 x 256.
const IMAGE_MAX: usize = 512 * 1024;

fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

/// Mon clan, ses membres, et ses demandes si mon rang me laisse y repondre.
/// Sans clan : les clans ou j'ai demande a entrer.
pub async fn mon_clan(headers: HeaderMap) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    let b = base::base();
    let Some((id, rang)) = clans::rang_de(&b, moi.id) else {
        return Ok(Json(json!({ "clan": null, "demandes_envoyees": clans::mes_demandes(&b, moi.id)? })));
    };
    let demandes = if poids(&rang) >= 2 { clans::demandes(&b, id)? } else { Vec::new() };
    Ok(Json(json!({
        "clan": clans::par_id(&b, id),
        "rang": rang,
        "moi": moi.id,
        "membres": clans::membres(&b, id)?,
        "demandes": demandes,
    })))
}

#[derive(Deserialize)]
pub struct Recherche {
    #[serde(default)]
    q: String,
}

pub async fn chercher(headers: HeaderMap, Query(r): Query<Recherche>) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    let b = base::base();
    Ok(Json(json!({ "clans": clans::chercher(&b, &r.q)?, "demandes_envoyees": clans::mes_demandes(&b, moi.id)? })))
}

#[derive(Deserialize)]
pub struct Creation {
    nom: String,
    tag: String,
    #[serde(default)]
    description: String,
    #[serde(default = "vrai")]
    ouvert: bool,
}

fn vrai() -> bool {
    true
}

pub async fn creer(headers: HeaderMap, Json(c): Json<Creation>) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    let id = clans::creer(&base::base(), moi.id, &c.nom, &c.tag, &c.description, c.ouvert)?;
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
pub struct Reglages {
    nom: Option<String>,
    tag: Option<String>,
    description: Option<String>,
    ouvert: Option<bool>,
    couleur: Option<String>,
}

/// Le chef modifie son clan : nom, tag, description, ouvert ou ferme,
/// couleur.
pub async fn regler(headers: HeaderMap, Json(r): Json<Reglages>) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    let reglages = clans::Reglages {
        nom: r.nom.as_deref(),
        tag: r.tag.as_deref(),
        description: r.description.as_deref(),
        ouvert: r.ouvert,
        couleur: r.couleur.as_deref(),
    };
    clans::regler(&base::base(), moi.id, reglages)?;
    Ok(ok())
}

/// `{ "image": "data:image/png;base64,..." }`, ou `{ "image": null }` pour
/// la retirer.
pub async fn poser_image(headers: HeaderMap, Json(corps): Json<Value>) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    let image = match corps.get("image").and_then(Value::as_str) {
        None => None,
        Some(brut) => {
            let brut = brut.split_once(',').map_or(brut, |(_, d)| d);
            let image = B64.decode(brut).map_err(|_| Refus(StatusCode::BAD_REQUEST, "Image illisible."))?;
            if image.len() > IMAGE_MAX {
                return Err(Refus(StatusCode::PAYLOAD_TOO_LARGE, "Image trop lourde (512 Ko au plus)."));
            }
            if type_image(&image).is_none() {
                return Err(Refus(StatusCode::BAD_REQUEST, "Seules les images PNG, JPEG et WebP sont acceptees."));
            }
            Some(image)
        }
    };
    clans::poser_image(&base::base(), moi.id, image.as_deref())?;
    Ok(ok())
}

/// Image d'un clan. Publique : tout le monde voit les ecussons.
pub async fn image(Path(id): Path<i64>) -> Response {
    let Some(image) = clans::image(&base::base(), id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(mime) = type_image(&image) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    (
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "public, max-age=604800, immutable"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        image,
    )
        .into_response()
}

pub async fn rejoindre(headers: HeaderMap, Path(id): Path<i64>) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    let etat = clans::rejoindre(&base::base(), moi.id, id)?;
    Ok(Json(json!({ "etat": etat })))
}

pub async fn annuler(headers: HeaderMap, Path(id): Path<i64>) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    clans::annuler_demande(&base::base(), moi.id, id)?;
    Ok(ok())
}

pub async fn quitter(headers: HeaderMap) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    clans::quitter(&base::base(), moi.id)?;
    Ok(ok())
}

pub async fn dissoudre(headers: HeaderMap) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    clans::dissoudre(&base::base(), moi.id)?;
    Ok(ok())
}

/// `{ "action": "accepter" | "refuser" | "exclure" | "promouvoir" |
/// "retrograder" | "chef" }`.
pub async fn agir(headers: HeaderMap, Path(cible): Path<i64>, Json(corps): Json<Value>) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    let action = corps.get("action").and_then(Value::as_str).unwrap_or("");
    clans::agir(&base::base(), moi.id, cible, action)?;
    Ok(ok())
}

#[derive(Deserialize)]
pub struct Apres {
    #[serde(default)]
    apres: i64,
}

pub async fn fil(headers: HeaderMap, Query(a): Query<Apres>) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    Ok(Json(json!({ "messages": clans::fil(&base::base(), moi.id, a.apres)? })))
}

pub async fn ecrire(headers: HeaderMap, Json(corps): Json<Value>) -> R<Json<clans::MessageClan>> {
    let moi = connecte(&headers)?;
    let texte = corps.get("texte").and_then(Value::as_str).unwrap_or("");
    let (m, membres) = {
        let b = base::base();
        let m = clans::ecrire(&b, moi.id, texte)?;
        let membres: Vec<i64> = clans::rang_de(&b, moi.id)
            .and_then(|(k, _)| clans::membres(&b, k).ok())
            .unwrap_or_default()
            .into_iter()
            .map(|x| x.joueur.id)
            .collect();
        (m, membres)
    };
    // Les autres membres l'apprennent tout de suite.
    for id in membres.into_iter().filter(|&id| id != moi.id) {
        crate::social::signaler(id, json!({ "t": "nouvelles" }));
    }
    Ok(Json(m))
}
