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

use axum::{
    Json,
    body::Body,
    extract::{ConnectInfo, Path},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use serde_json::{Map, Value, json};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::Semaphore;

const DIR: &str = "data/arenes";
const DRAFTS: &str = "data/arenes/brouillons";
const CATALOG: &str = "data/arenes/catalog.json";
/// Au-dela, une demande est refusee : cent images, c'est deja une facture.
const MAX_IMAGES: usize = 100;
/// Appels simultanes vers le fournisseur, par tache.
const EN_PARALLELE: usize = 3;

type Reponse = (StatusCode, Json<Value>);

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

/// Identifiant court et imprevisible : un brouillon est servi sans jeton,
/// il ne doit pas se deviner.
fn new_id() -> String {
    static N: AtomicU64 = AtomicU64::new(0);
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos() as u64;
    let n = N.fetch_add(1, Ordering::Relaxed);
    let mut x = t ^ n.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    // Brassage de splitmix64 : deux instants voisins donnent des noms sans
    // rapport.
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    format!("{:016x}", x ^ (x >> 31))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn err(code: StatusCode, msg: impl Into<String>) -> Reponse {
    (code, Json(json!({ "error": msg.into() })))
}

fn guard(headers: &HeaderMap, who: SocketAddr) -> Result<(), Reponse> {
    if crate::rl2::allowed(headers, who) {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Generateur reserve a l'hote du serveur."))
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

fn decode(body: &Value, field: &str) -> Result<Vec<u8>, Reponse> {
    let b64 = body.get(field).and_then(Value::as_str).unwrap_or("");
    // Une adresse `data:` arrive telle quelle depuis un canevas.
    let b64 = b64.split_once(',').map_or(b64, |(_, d)| d);
    B64.decode(b64)
        .ok()
        .filter(|b| !b.is_empty())
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, format!("Image `{field}` illisible.")))
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
            let out = crate::generer::redraw(&provider, &model, &gabarit, &prompt)
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

fn image(bytes: Vec<u8>, cache: &'static str) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, crate::generer::mime_of(&bytes))
        .header(header::CACHE_CONTROL, cache)
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
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
    match crate::generer::redraw(&provider, &model_of(&body), &base, prompt)
        .await
        .and_then(|img| save_draft(&img))
    {
        Ok(nouveau) => (StatusCode::OK, Json(json!({ "id": nouveau }))),
        Err(e) => err(StatusCode::BAD_GATEWAY, e),
    }
}

// ------------------------------------------------------------- catalogue --

fn read_catalog() -> Vec<Value> {
    std::fs::read_to_string(CATALOG)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
}

/// Arenes creees, pour le jeu. Public : c'est une liste de stades.
pub async fn catalog() -> Json<Value> {
    Json(json!({ "stades": read_catalog() }))
}

/// Planche ou miniature d'une arene acceptee.
pub async fn arena_image(Path(file): Path<String>) -> Response {
    let Some(stem) = file.strip_suffix(".jpg") else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !valid_id(stem.trim_end_matches("_min")) || stem.matches('_').count() > 1 {
        return StatusCode::NOT_FOUND.into_response();
    }
    match tokio::fs::read(format!("{DIR}/{file}")).await {
        Ok(bytes) => image(bytes, "public, max-age=86400"),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

fn num(v: Option<&Value>, lo: f64, hi: f64) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|x| x.is_finite()).map(|x| x.clamp(lo, hi).round())
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
    let name: String = body
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(48)
        .collect::<String>()
        .trim()
        .to_string();
    let name = if name.is_empty() { String::from("Arène créée") } else { name };

    let id = format!("gen-{}", &new_id()[..10]);
    let ecrit = std::fs::create_dir_all(DIR)
        .and_then(|_| std::fs::write(format!("{DIR}/{id}.jpg"), &img))
        .and_then(|_| std::fs::write(format!("{DIR}/{id}_min.jpg"), &thumb));
    if let Err(e) = ecrit {
        return err(StatusCode::INTERNAL_SERVER_ERROR, format!("Ecriture impossible : {e}"));
    }
    let mut entry = Map::new();
    entry.insert("id".into(), json!(id));
    entry.insert("name".into(), json!(name));
    entry.insert("art".into(), json!(format!("/api/arenes/img/{id}.jpg")));
    entry.insert("thumb".into(), json!(format!("/api/arenes/img/{id}_min.jpg")));
    entry.insert("size".into(), json!(size));
    entry.insert("fit".into(), json!(fit));
    entry.insert("corner".into(), json!(corner));
    entry.insert("goal".into(), json!({ "half": half, "depth": depth, "post": post }));
    let entry = Value::Object(entry);
    let mut all = read_catalog();
    all.push(entry.clone());
    let text = serde_json::to_string_pretty(&all).unwrap_or_default();
    if std::fs::write(CATALOG, text).is_err() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Catalogue non enregistre.");
    }
    (StatusCode::OK, Json(json!({ "stade": entry })))
}

/// Retire une arene creee du catalogue, fichiers compris.
pub async fn remove(headers: HeaderMap, info: ConnectInfo<SocketAddr>, Path(id): Path<String>) -> Reponse {
    if let Err(r) = guard(&headers, info.0) {
        return r;
    }
    if !valid_id(&id) || !id.starts_with("gen-") {
        return err(StatusCode::BAD_REQUEST, "Seules les arenes creees se retirent ici.");
    }
    let mut all = read_catalog();
    all.retain(|s| s.get("id").and_then(Value::as_str) != Some(id.as_str()));
    let text = serde_json::to_string_pretty(&all).unwrap_or_default();
    let _ = std::fs::write(CATALOG, text);
    let _ = std::fs::remove_file(format!("{DIR}/{id}.jpg"));
    let _ = std::fs::remove_file(format!("{DIR}/{id}_min.jpg"));
    (StatusCode::OK, Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::{new_id, valid_id};

    #[test]
    fn les_identifiants_sont_uniques_et_propres() {
        let a = new_id();
        let b = new_id();
        assert_ne!(a, b);
        assert!(valid_id(&a) && valid_id(&format!("gen-{a}")));
        assert!(!valid_id("../catalog"), "un chemin est passe pour un identifiant");
        assert!(!valid_id(""));
    }
}
