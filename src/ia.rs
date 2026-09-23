//! Cles des fournisseurs d'IA, pour les generateurs de l'admin RL2.
//!
//! Les cles ne quittent jamais le serveur : l'admin les envoie une fois, le
//! serveur les range dans `data/ia-keys.json` et ne renvoie ensuite que leur
//! empreinte (« se termine par 4f2a »). Les appels aux fournisseurs se
//! feront d'ici, pas du navigateur : une cle posee dans une page finit
//! toujours par fuiter.
//!
//! Meme garde que les reglages du jeu : la machine hote, ou le jeton
//! `RL2_ADMIN_TOKEN`. Lire les empreintes est protege aussi, pour ne pas
//! annoncer au monde quels comptes sont branches.

use axum::{
    Json,
    extract::ConnectInfo,
    http::{HeaderMap, StatusCode},
};
use serde_json::{Map, Value, json};
use std::net::SocketAddr;

const KEYS_FILE: &str = "data/ia-keys.json";

/// Fournisseurs acceptes. Une liste fermee : on ne range pas n'importe
/// quelle entree qu'un formulaire trafique voudrait glisser dans le fichier.
pub const PROVIDERS: &[&str] = &[
    "openai",
    "anthropic",
    "google",
    "stability",
    "replicate",
    "meshy",
    "tripo",
    "elevenlabs",
];

/// Longueur maximale d'une cle ou d'un nom de modele. Les vraies cles
/// tiennent largement dedans ; au-dela, c'est un collage rate.
const MAX_LEN: usize = 400;

fn read_all() -> Map<String, Value> {
    std::fs::read_to_string(KEYS_FILE)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn write_all(all: &Map<String, Value>) -> bool {
    let text = serde_json::to_string_pretty(all).unwrap_or_default();
    std::fs::create_dir_all("data").is_ok() && std::fs::write(KEYS_FILE, text).is_ok()
}

/// Ce qu'on peut montrer d'une cle : ses quatre derniers caracteres, et
/// seulement si elle est assez longue pour que ca ne la devoile pas.
fn hint(key: &str) -> String {
    let n = key.chars().count();
    if n >= 16 {
        let fin: String = key.chars().skip(n - 4).collect();
        format!("…{fin}")
    } else {
        String::from("••••")
    }
}

/// Etat public d'un fournisseur : branche ou non, empreinte, modele.
fn public(all: &Map<String, Value>) -> Value {
    let mut out = Map::new();
    for id in PROVIDERS {
        let entry = all.get(*id);
        let key = entry.and_then(|e| e.get("key")).and_then(Value::as_str).unwrap_or("");
        let model = entry.and_then(|e| e.get("model")).and_then(Value::as_str).unwrap_or("");
        out.insert(
            (*id).to_string(),
            json!({ "set": !key.is_empty(), "hint": if key.is_empty() { String::new() } else { hint(key) }, "model": model }),
        );
    }
    Value::Object(out)
}

fn refuse() -> (StatusCode, Json<Value>) {
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "error": "Cles reservees a l'hote du serveur." })),
    )
}

pub async fn keys_get(
    headers: HeaderMap,
    info: ConnectInfo<SocketAddr>,
) -> (StatusCode, Json<Value>) {
    if !crate::rl2::allowed(&headers, info.0) {
        return refuse();
    }
    (StatusCode::OK, Json(json!({ "providers": public(&read_all()) })))
}

/// Met a jour un ou plusieurs fournisseurs : `{ "openai": { "key": "...",
/// "model": "..." } }`. Une cle absente reste en place, une cle vide
/// l'efface ; meme regle pour le modele.
pub async fn keys_put(
    headers: HeaderMap,
    info: ConnectInfo<SocketAddr>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if !crate::rl2::allowed(&headers, info.0) {
        return refuse();
    }
    let Some(changes) = body.as_object() else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Objet attendu." })));
    };
    let mut all = read_all();
    let mut n = 0;
    for (id, change) in changes {
        if !PROVIDERS.contains(&id.as_str()) {
            continue;
        }
        let entry = all
            .entry(id.clone())
            .or_insert_with(|| Value::Object(Map::new()));
        let Some(entry) = entry.as_object_mut() else {
            continue;
        };
        for field in ["key", "model"] {
            let Some(v) = change.get(field).and_then(Value::as_str) else {
                continue;
            };
            let v = v.trim();
            if v.chars().count() > MAX_LEN {
                continue;
            }
            if v.is_empty() {
                entry.remove(field);
            } else {
                entry.insert(field.to_string(), Value::String(v.to_string()));
            }
            n += 1;
        }
        if entry.is_empty() {
            all.remove(id);
        }
    }
    if !write_all(&all) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Impossible d'ecrire data/ia-keys.json." })),
        );
    }
    (StatusCode::OK, Json(json!({ "applied": n, "providers": public(&all) })))
}

#[cfg(test)]
mod tests {
    use super::hint;

    /// Derriere nginx, tout arrive de 127.0.0.1 : l'adresse seule ne doit
    /// plus ouvrir l'admin des qu'un en-tete de relais est present.
    #[test]
    fn une_requete_relayee_ne_passe_pas_pour_l_hote() {
        if std::env::var("RL2_ADMIN_TOKEN").is_ok_and(|t| !t.is_empty()) {
            return;
        }
        let local: std::net::SocketAddr = "127.0.0.1:5000".parse().unwrap();
        let dehors: std::net::SocketAddr = "203.0.113.7:5000".parse().unwrap();
        let rien = axum::http::HeaderMap::new();
        let mut relais = axum::http::HeaderMap::new();
        relais.insert("x-forwarded-for", "203.0.113.7".parse().unwrap());
        assert!(crate::rl2::allowed(&rien, local), "la machine hote est refusee");
        assert!(!crate::rl2::allowed(&relais, local), "une requete relayee passe pour l'hote");
        assert!(!crate::rl2::allowed(&rien, dehors), "un visiteur passe pour l'hote");
    }

    #[test]
    fn l_empreinte_ne_montre_que_la_fin() {
        assert_eq!(hint("sk-proj-abcdefghijkl1234"), "…1234");
        assert_eq!(hint("courte"), "••••");
    }
}
