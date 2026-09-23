//! Generateur d'arenes de l'admin : brouillons, retouches, catalogue.
//!
//! Le navigateur prepare tout ce qui est image (gabarit a envoyer, planche
//! finale recalee, miniature) ; le serveur ne fait que relayer vers l'IA et
//! ranger les fichiers. Deux etages sur le disque :
//!
//! - `data/arenes/brouillons/` : ce que l'IA a rendu, en attente de tri ;
//! - `data/arenes/` : les arenes acceptees et `catalog.json`, que le jeu lit
//!   au demarrage pour les ajouter a sa liste de stades.
//!
//! Une demande de plusieurs images devient une tache : elle tourne en fond,
//! trois appels a la fois, et l'admin vient en lire l'avancement.

use crate::catalogue::{
    Collection, Reponse, decode, err, guard, image, name_of, new_id, num, valid_id,
};
use crate::generer::Format;
use axum::{
    Json,
    extract::{ConnectInfo, Path},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::{Map, Value, json};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex, OnceLock},
};
use tokio::sync::Semaphore;

const DRAFTS: &str = "data/arenes/brouillons";

/// Arenes acceptees : planches JPEG, recalees en 1920 x 1080.
pub const ARENES: Collection = Collection {
    dir: "data/arenes",
    url: "/api/arenes/img",
    prefix: "gen",
    ext: "jpg",
    sans_nom: "Arène créée",
};
/// Au-dela, une demande est refusee : cent images, c'est deja une facture.
const MAX_IMAGES: usize = 100;
/// Appels simultanes vers le fournisseur, par tache.
const EN_PARALLELE: usize = 3;

#[derive(Default)]
struct Job {
    total: usize,
    done: Vec<String>,
    errors: Vec<String>,
    cancelled: bool,
}

fn jobs() -> &'static Mutex<HashMap<String, Job>> {
    static JOBS: OnceLock<Mutex<HashMap<String, Job>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Format demande a l'IA selon ce qu'on genere : `kind` vaut `voiture`
/// pour un skin, une arene sinon.
fn format_of(body: &Value) -> Format {
    if body.get("kind").and_then(Value::as_str) == Some("voiture") {
        Format::VOITURE
    } else {
        Format::ARENE
    }
}

fn provider_of(body: &Value) -> Result<String, Reponse> {
    let p = body.get("provider").and_then(Value::as_str).unwrap_or("openai");
    if crate::generer::IMAGE_PROVIDERS.contains(&p) {
        Ok(p.to_string())
    } else {
        Err(err(StatusCode::BAD_REQUEST, "Fournisseur inconnu."))
    }
}

/// Modele demande par l'admin, vide pour celui par defaut. Un nom de
/// modele n'a que des lettres, chiffres, points, tirets et soulignes.
fn model_of(body: &Value) -> String {
    body.get("model")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '/'))
        .take(80)
        .collect()
}

/// Modeles d'images offerts par la cle d'un fournisseur, et celui a
/// preselectionner : celui des « Cles API », sinon celui par defaut.
pub async fn models(
    headers: HeaderMap,
    info: ConnectInfo<SocketAddr>,
    Path(provider): Path<String>,
) -> Reponse {
    if let Err(r) = guard(&headers, info.0) {
        return r;
    }
    if !crate::generer::IMAGE_PROVIDERS.contains(&provider.as_str()) {
        return err(StatusCode::BAD_REQUEST, "Fournisseur inconnu.");
    }
    let prefere = crate::ia::credentials(&provider)
        .map(|(_, m)| m)
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| crate::generer::default_model(&provider).to_string());
    match crate::generer::image_models(&provider).await {
        Ok(liste) => (StatusCode::OK, Json(json!({ "models": liste, "default": prefere }))),
        // Sans reponse du fournisseur, on propose au moins le defaut.
        Err(e) => (StatusCode::OK, Json(json!({ "models": [prefere], "default": prefere, "warning": e }))),
    }
}

fn save_draft(bytes: &[u8]) -> Result<String, String> {
    std::fs::create_dir_all(DRAFTS).map_err(|e| e.to_string())?;
    let id = new_id();
    std::fs::write(format!("{DRAFTS}/{id}.img"), bytes).map_err(|e| e.to_string())?;
    Ok(id)
}

// --------------------------------------------------------------- generer --

/// Lance une tache : `{ provider, prompt, gabarit (base64), n }`.
pub async fn generate(
    headers: HeaderMap,
    info: ConnectInfo<SocketAddr>,
    Json(body): Json<Value>,
) -> Reponse {
    if let Err(r) = guard(&headers, info.0) {
        return r;
    }
    let provider = match provider_of(&body) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let gabarit = match decode(&body, "gabarit") {
        Ok(g) => g,
        Err(r) => return r,
    };
    let prompt = body.get("prompt").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if prompt.is_empty() {
        return err(StatusCode::BAD_REQUEST, "Le prompt est vide.");
    }
    let n = body.get("n").and_then(Value::as_u64).unwrap_or(1).clamp(1, MAX_IMAGES as u64) as usize;
    let model = Arc::new(model_of(&body));
    let format = format_of(&body);
    if crate::ia::credentials(&provider).is_none() {
        return err(StatusCode::BAD_REQUEST, format!("Aucune cle {provider} : branche-la dans IA & API."));
    }

    let job = new_id();
    jobs().lock().expect("taches").insert(job.clone(), Job { total: n, ..Job::default() });
    let (gabarit, prompt) = (Arc::new(gabarit), Arc::new(prompt));
    let slots = Arc::new(Semaphore::new(EN_PARALLELE));
    for _ in 0..n {
        let (job, provider) = (job.clone(), provider.clone());
        let (gabarit, prompt, slots, model) = (gabarit.clone(), prompt.clone(), slots.clone(), model.clone());
        tokio::spawn(async move {
            let _slot = slots.acquire().await;
            let annule = jobs().lock().expect("taches").get(&job).is_none_or(|j| j.cancelled);
            if annule {
                return;
            }
            let out = crate::generer::redraw(&provider, &model, &gabarit, &prompt, format)
                .await
                .and_then(|img| save_draft(&img));
            if let Some(j) = jobs().lock().expect("taches").get_mut(&job) {
                match out {
                    Ok(id) => j.done.push(id),
                    Err(e) => j.errors.push(e),
                }
            }
        });
    }
    (StatusCode::OK, Json(json!({ "job": job, "total": n })))
}

/// Avancement d'une tache.
pub async fn job(Path(id): Path<String>) -> Reponse {
    let all = jobs().lock().expect("taches");
    let Some(j) = all.get(&id) else {
        return err(StatusCode::NOT_FOUND, "Tache inconnue (serveur redemarre ?).");
    };
    let fini = j.cancelled || j.done.len() + j.errors.len() >= j.total;
    (
        StatusCode::OK,
        Json(json!({
            "total": j.total, "done": j.done, "errors": j.errors,
            "cancelled": j.cancelled, "finished": fini,
        })),
    )
}

/// Arrete une tache : les images deja en cours finissent, les autres ne
/// partent pas.
pub async fn cancel(headers: HeaderMap, info: ConnectInfo<SocketAddr>, Path(id): Path<String>) -> Reponse {
    if let Err(r) = guard(&headers, info.0) {
        return r;
    }
    if let Some(j) = jobs().lock().expect("taches").get_mut(&id) {
        j.cancelled = true;
    }
    (StatusCode::OK, Json(json!({ "ok": true })))
}

// ------------------------------------------------------------ brouillons --

/// Sert un brouillon. Sans jeton : une balise `<img>` n'en envoie pas, et
/// l'identifiant ne se devine pas.
pub async fn draft(Path(id): Path<String>) -> Response {
    let id = id.trim_end_matches(".img");
    if !valid_id(id) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match tokio::fs::read(format!("{DRAFTS}/{id}.img")).await {
        Ok(bytes) => image(bytes, "no-store"),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

pub async fn drop_draft(headers: HeaderMap, info: ConnectInfo<SocketAddr>, Path(id): Path<String>) -> Reponse {
    if let Err(r) = guard(&headers, info.0) {
        return r;
    }
    if valid_id(&id) {
        let _ = tokio::fs::remove_file(format!("{DRAFTS}/{id}.img")).await;
    }
    (StatusCode::OK, Json(json!({ "ok": true })))
}

/// Retouche un brouillon : `{ provider, id, prompt }`. L'IA repart de
/// l'image deja produite ; le resultat est un nouveau brouillon, l'ancien
/// reste tant que l'admin ne l'a pas jete.
pub async fn retouch(headers: HeaderMap, info: ConnectInfo<SocketAddr>, Json(body): Json<Value>) -> Reponse {
    if let Err(r) = guard(&headers, info.0) {
        return r;
    }
    let provider = match provider_of(&body) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let id = body.get("id").and_then(Value::as_str).unwrap_or("");
    let prompt = body.get("prompt").and_then(Value::as_str).unwrap_or("").trim();
    if !valid_id(id) || prompt.is_empty() {
        return err(StatusCode::BAD_REQUEST, "Brouillon ou prompt manquant.");
    }
    if crate::ia::credentials(&provider).is_none() {
        return err(StatusCode::BAD_REQUEST, format!("Aucune cle {provider} : branche-la dans IA & API."));
    }
    let Ok(base) = tokio::fs::read(format!("{DRAFTS}/{id}.img")).await else {
        return err(StatusCode::NOT_FOUND, "Brouillon introuvable.");
    };
    match crate::generer::redraw(&provider, &model_of(&body), &base, prompt, format_of(&body))
        .await
        .and_then(|img| save_draft(&img))
    {
        Ok(nouveau) => (StatusCode::OK, Json(json!({ "id": nouveau }))),
        Err(e) => err(StatusCode::BAD_GATEWAY, e),
    }
}

// ------------------------------------------------------------- catalogue --

/// Arenes creees, pour le jeu. Public : c'est une liste de stades.
pub async fn catalog() -> Json<Value> {
    Json(json!({ "stades": ARENES.read() }))
}

/// Planche ou miniature d'une arene acceptee.
pub async fn arena_image(Path(file): Path<String>) -> Response {
    ARENES.serve(&file).await
}

/// Accepte une planche : `{ name, image, thumb, fit: [l, r, t, b], corner,
/// goal: { half, depth, post } }`. L'image est deja recalee au format des
/// planches par l'admin.
pub async fn accept(headers: HeaderMap, info: ConnectInfo<SocketAddr>, Json(body): Json<Value>) -> Reponse {
    if let Err(r) = guard(&headers, info.0) {
        return r;
    }
    let (img, thumb) = match (decode(&body, "image"), decode(&body, "thumb")) {
        (Ok(i), Ok(t)) => (i, t),
        (Err(r), _) | (_, Err(r)) => return r,
    };
    let fit: Vec<f64> = body
        .get("fit")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| num(Some(v), -2000.0, 4000.0)).collect())
        .unwrap_or_default();
    let goal = body.get("goal").cloned().unwrap_or(Value::Null);
    let (Some(corner), Some(half), Some(depth), Some(post)) = (
        num(body.get("corner"), 0.0, 330.0),
        num(goal.get("half"), 30.0, 200.0),
        num(goal.get("depth"), 15.0, 150.0),
        num(goal.get("post"), 0.0, 40.0),
    ) else {
        return err(StatusCode::BAD_REQUEST, "Calage incomplet.");
    };
    if fit.len() != 4 || fit[0] >= fit[1] || fit[2] >= fit[3] {
        return err(StatusCode::BAD_REQUEST, "Contour du terrain invalide.");
    }
    // Taille de la planche en pixels, pour que le jeu la recale juste.
    let size: Vec<f64> = body
        .get("size")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| num(Some(v), 64.0, 8192.0)).collect())
        .filter(|s: &Vec<f64>| s.len() == 2)
        .unwrap_or_else(|| vec![1920.0, 1080.0]);
    let mut extra = Map::new();
    extra.insert("size".into(), json!(size));
    extra.insert("fit".into(), json!(fit));
    extra.insert("corner".into(), json!(corner));
    extra.insert("goal".into(), json!({ "half": half, "depth": depth, "post": post }));
    let entry = match ARENES.add(name_of(&body, ARENES.sans_nom), &img, &thumb, extra) {
        Ok(e) => e,
        Err(r) => return r,
    };
    (StatusCode::OK, Json(json!({ "stade": entry })))
}

/// Retire une arene creee du catalogue, fichiers compris.
pub async fn remove(headers: HeaderMap, info: ConnectInfo<SocketAddr>, Path(id): Path<String>) -> Reponse {
    if let Err(r) = guard(&headers, info.0) {
        return r;
    }
    ARENES.remove(&id)
}
