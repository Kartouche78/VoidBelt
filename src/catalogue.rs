//! Catalogues d'objets crees dans l'admin : arenes, skins de voitures.
//!
//! Chaque sorte d'objet est une `Collection` : un dossier sous `data/`, un
//! `catalog.json` que le jeu lit, et des images servies par l'API. Les
//! outils communs aux generateurs (identifiants, garde, decodage) vivent
//! ici aussi.

use axum::{
    Json,
    body::Body,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use serde_json::{Map, Value, json};
use std::{
    net::SocketAddr,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

pub type Reponse = (StatusCode, Json<Value>);

/// Une sorte d'objet cree.
pub struct Collection {
    /// Dossier des fichiers et du catalogue.
    pub dir: &'static str,
    /// Adresse publique des images, sans barre finale.
    pub url: &'static str,
    /// Prefixe des identifiants : il dit d'ou vient un objet.
    pub prefix: &'static str,
    /// Extension des images : `jpg` pour les planches, `png` pour garder la
    /// transparence des voitures.
    pub ext: &'static str,
    /// Nom donne a un objet que l'admin n'a pas nomme.
    pub sans_nom: &'static str,
}

/// Identifiant court et imprevisible : un brouillon est servi sans jeton,
/// il ne doit pas se deviner.
pub fn new_id() -> String {
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

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn err(code: StatusCode, msg: impl Into<String>) -> Reponse {
    (code, Json(json!({ "error": msg.into() })))
}

pub fn guard(headers: &HeaderMap, who: SocketAddr) -> Result<(), Reponse> {
    if crate::rl2::allowed(headers, who) {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Generateur reserve a l'hote du serveur."))
    }
}

/// Image en base64 d'un champ du corps. Une adresse `data:` arrive telle
/// quelle depuis un canevas.
pub fn decode(body: &Value, field: &str) -> Result<Vec<u8>, Reponse> {
    let b64 = body.get(field).and_then(Value::as_str).unwrap_or("");
    let b64 = b64.split_once(',').map_or(b64, |(_, d)| d);
    B64.decode(b64)
        .ok()
        .filter(|b| !b.is_empty())
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, format!("Image `{field}` illisible.")))
}

pub fn num(v: Option<&Value>, lo: f64, hi: f64) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|x| x.is_finite()).map(|x| x.clamp(lo, hi).round())
}

/// Nom saisi dans l'admin, sans caracteres de controle ni longueur folle.
pub fn name_of(body: &Value, sans_nom: &str) -> String {
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
    if name.is_empty() { sans_nom.to_string() } else { name }
}

pub fn image(bytes: Vec<u8>, cache: &'static str) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, crate::generer::mime_of(&bytes))
        .header(header::CACHE_CONTROL, cache)
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

impl Collection {
    fn catalog_path(&self) -> String {
        format!("{}/catalog.json", self.dir)
    }

    pub fn read(&self) -> Vec<Value> {
        std::fs::read_to_string(self.catalog_path())
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
    }

    fn write(&self, all: &[Value]) -> bool {
        let text = serde_json::to_string_pretty(all).unwrap_or_default();
        std::fs::write(self.catalog_path(), text).is_ok()
    }

    /// Image ou miniature d'un objet accepte.
    pub async fn serve(&self, file: &str) -> Response {
        let Some(stem) = file.strip_suffix(&format!(".{}", self.ext)) else {
            return StatusCode::NOT_FOUND.into_response();
        };
        if !valid_id(stem.trim_end_matches("_min")) || stem.matches('_').count() > 1 {
            return StatusCode::NOT_FOUND.into_response();
        }
        match tokio::fs::read(format!("{}/{file}", self.dir)).await {
            Ok(bytes) => image(bytes, "public, max-age=86400"),
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        }
    }

    /// Range un objet : ses deux images, puis son entree au catalogue avec
    /// les champs propres a sa sorte (`extra`). Rend l'entree ecrite.
    pub fn add(&self, name: String, img: &[u8], thumb: &[u8], extra: Map<String, Value>) -> Result<Value, Reponse> {
        let id = format!("{}-{}", self.prefix, &new_id()[..10]);
        let ext = self.ext;
        let ecrit = std::fs::create_dir_all(self.dir)
            .and_then(|_| std::fs::write(format!("{}/{id}.{ext}", self.dir), img))
            .and_then(|_| std::fs::write(format!("{}/{id}_min.{ext}", self.dir), thumb));
        if let Err(e) = ecrit {
            return Err(err(StatusCode::INTERNAL_SERVER_ERROR, format!("Ecriture impossible : {e}")));
        }
        let mut entry = Map::new();
        entry.insert("id".into(), json!(id));
        entry.insert("name".into(), json!(name));
        entry.insert("art".into(), json!(format!("{}/{id}.{ext}", self.url)));
        entry.insert("thumb".into(), json!(format!("{}/{id}_min.{ext}", self.url)));
        entry.extend(extra);
        let entry = Value::Object(entry);
        let mut all = self.read();
        all.push(entry.clone());
        if !self.write(&all) {
            return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Catalogue non enregistre."));
        }
        Ok(entry)
    }

    /// Retire un objet du catalogue, fichiers compris.
    pub fn remove(&self, id: &str) -> Reponse {
        if !valid_id(id) || !id.starts_with(&format!("{}-", self.prefix)) {
            return err(StatusCode::BAD_REQUEST, "Identifiant inconnu.");
        }
        let mut all = self.read();
        all.retain(|s| s.get("id").and_then(Value::as_str) != Some(id));
        self.write(&all);
        let _ = std::fs::remove_file(format!("{}/{id}.{}", self.dir, self.ext));
        let _ = std::fs::remove_file(format!("{}/{id}_min.{}", self.dir, self.ext));
        (StatusCode::OK, Json(json!({ "ok": true })))
    }
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
