//! Skins de voitures crees dans l'admin.
//!
//! La generation et les brouillons sont ceux des arenes (`arenes.rs`, avec
//! `kind: voiture`) ; ici, seulement le catalogue. Un skin est un sprite
//! PNG detoure, deja recadre par l'admin sur la hitbox de la voiture : le
//! jeu l'etire tel quel sur la caisse, comme `car_bleue.png`.

use crate::catalogue::{Collection, Reponse, decode, guard, name_of, num};
use axum::{
    Json,
    extract::{ConnectInfo, Path},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde_json::{Map, Value, json};
use std::net::SocketAddr;

pub const VOITURES: Collection = Collection {
    kind: "voiture",
    dir: "data/voitures",
    url: "/api/voitures/img",
    prefix: "car",
    ext: "png",
    sans_nom: "Voiture créée",
};

/// Skins crees, pour le jeu. Public : c'est une liste de carrosseries.
pub async fn catalog() -> Json<Value> {
    Json(json!({ "voitures": VOITURES.read() }))
}

pub async fn car_image(Path(file): Path<String>) -> Response {
    VOITURES.serve(&file).await
}

/// Accepte un skin : `{ name, image, thumb, cadre: [l, r, t, b] }`. Le
/// cadre, en pixels de l'image generee, est garde pour memoire : l'image
/// envoyee est deja recadree dessus.
pub async fn accept(headers: HeaderMap, info: ConnectInfo<SocketAddr>, Json(body): Json<Value>) -> Reponse {
    if let Err(r) = guard(&headers, info.0) {
        return r;
    }
    let (img, thumb) = match (decode(&body, "image"), decode(&body, "thumb")) {
        (Ok(i), Ok(t)) => (i, t),
        (Err(r), _) | (_, Err(r)) => return r,
    };
    let mut extra = Map::new();
    let cadre: Vec<f64> = body
        .get("cadre")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| num(Some(v), -4000.0, 8000.0)).collect())
        .unwrap_or_default();
    if cadre.len() == 4 {
        extra.insert("cadre".into(), json!(cadre));
    }
    match VOITURES.add(name_of(&body, VOITURES.sans_nom), &img, &thumb, extra) {
        Ok(entry) => (StatusCode::OK, Json(json!({ "voiture": entry }))),
        Err(r) => r,
    }
}

pub async fn remove(headers: HeaderMap, info: ConnectInfo<SocketAddr>, Path(id): Path<String>) -> Reponse {
    if let Err(r) = guard(&headers, info.0) {
        return r;
    }
    VOITURES.remove(&id)
}
