//! Appels aux IA d'images, pour les generateurs de l'admin.
//!
//! Une seule operation pour l'instant : partir d'une image (le gabarit, ou
//! une planche deja generee) et la redessiner selon un texte. C'est ce qui
//! garde le terrain a sa place : l'IA peint par-dessus le trace, elle ne
//! l'invente pas.
//!
//! Les cles viennent de `ia.rs` et ne sortent jamais d'ici.

use base64::{Engine, engine::general_purpose::STANDARD as B64};
use serde_json::{Value, json};
use std::time::Duration;

/// Fournisseurs capables de redessiner une image, dans l'ordre de l'admin.
pub const IMAGE_PROVIDERS: &[&str] = &["openai", "google"];

/// Modeles pris quand l'admin n'en a pas choisi dans « Cles API ».
const OPENAI_MODEL: &str = "gpt-image-2.5-sunburst-2026-09-08";
const GOOGLE_MODEL: &str = "gemini-2.5-flash-image";

/// Une image se fait en une a deux minutes chez les deux fournisseurs ;
/// au-dela, on considere l'appel perdu.
const TIMEOUT: Duration = Duration::from_secs(240);

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| format!("client HTTP : {e}"))
}

/// Modele pris par defaut chez un fournisseur.
pub fn default_model(provider: &str) -> &'static str {
    if provider == "google" { GOOGLE_MODEL } else { OPENAI_MODEL }
}

/// Redessine `image` (PNG ou JPEG) selon `prompt`, avec le modele `choisi`
/// (vide : celui des « Cles API », sinon celui par defaut). Rend les octets
/// de l'image produite.
pub async fn redraw(provider: &str, choisi: &str, image: &[u8], prompt: &str) -> Result<Vec<u8>, String> {
    let Some((key, model)) = crate::ia::credentials(provider) else {
        return Err(format!("Aucune cle {provider} : branche-la dans IA & API."));
    };
    let model = if choisi.trim().is_empty() { model } else { choisi.trim().to_string() };
    match provider {
        "openai" => openai(&key, pick(&model, OPENAI_MODEL), image, prompt).await,
        "google" => google(&key, pick(&model, GOOGLE_MODEL), image, prompt).await,
        _ => Err(format!("{provider} ne sait pas redessiner une image.")),
    }
}

/// Modeles d'images que la cle donne reellement, demandes au fournisseur :
/// la liste change plus vite que ce code, on ne la recopie donc pas.
pub async fn image_models(provider: &str) -> Result<Vec<String>, String> {
    let Some((key, _)) = crate::ia::credentials(provider) else {
        return Err(format!("Aucune cle {provider}."));
    };
    let mut out: Vec<String> = match provider {
        "openai" => {
            let res = client()?
                .get("https://api.openai.com/v1/models")
                .bearer_auth(&key)
                .send()
                .await
                .map_err(|e| format!("OpenAI injoignable : {e}"))?;
            if !res.status().is_success() {
                return Err(refus(res, "OpenAI").await);
            }
            let corps: Value = res.json().await.map_err(|e| e.to_string())?;
            corps["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m["id"].as_str())
                // Seuls ceux qui savent retoucher une image : la famille
                // gpt-image, et dall-e-2 (dall-e-3 ne prend pas d'image).
                .filter(|id| id.starts_with("gpt-image") || *id == "dall-e-2")
                .map(str::to_string)
                .collect()
        }
        "google" => {
            let res = client()?
                .get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000")
                .header("x-goog-api-key", &key)
                .send()
                .await
                .map_err(|e| format!("Google injoignable : {e}"))?;
            if !res.status().is_success() {
                return Err(refus(res, "Google").await);
            }
            let corps: Value = res.json().await.map_err(|e| e.to_string())?;
            corps["models"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| {
                    m["supportedGenerationMethods"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(|x| x == "generateContent"))
                })
                .filter_map(|m| m["name"].as_str())
                .map(|n| n.trim_start_matches("models/"))
                .filter(|n| n.contains("image"))
                .map(str::to_string)
                .collect()
        }
        _ => return Err(format!("{provider} ne sait pas redessiner une image.")),
    };
    out.sort();
    out.dedup();
    Ok(out)
}

fn pick<'a>(chosen: &'a str, default: &'a str) -> &'a str {
    if chosen.trim().is_empty() { default } else { chosen.trim() }
}

/// Type d'une image d'apres ses premiers octets.
pub fn mime_of(bytes: &[u8]) -> &'static str {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xFF, 0xD8, ..] => "image/jpeg",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        _ => "application/octet-stream",
    }
}

/// Message d'erreur lisible a partir d'une reponse refusee.
async fn refus(res: reqwest::Response, qui: &str) -> String {
    let code = res.status();
    let corps: Value = res.json().await.unwrap_or(Value::Null);
    let detail = corps
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("sans detail");
    format!("{qui} a refuse ({code}) : {detail}")
}

/// OpenAI : `images/edits`, l'image en piece jointe. On demande le format
/// paysage le plus proche des planches (3:2) ; l'admin le recale ensuite.
async fn openai(key: &str, model: &str, image: &[u8], prompt: &str) -> Result<Vec<u8>, String> {
    let ext = if mime_of(image) == "image/png" { "png" } else { "jpg" };
    let part = reqwest::multipart::Part::bytes(image.to_vec())
        .file_name(format!("gabarit.{ext}"))
        .mime_str(mime_of(image))
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("model", model.to_string())
        .text("prompt", prompt.to_string())
        .text("size", "1536x1024")
        .text("n", "1")
        .part("image", part);
    let res = client()?
        .post("https://api.openai.com/v1/images/edits")
        .bearer_auth(key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("OpenAI injoignable : {e}"))?;
    if !res.status().is_success() {
        return Err(refus(res, "OpenAI").await);
    }
    let corps: Value = res.json().await.map_err(|e| e.to_string())?;
    let b64 = corps
        .pointer("/data/0/b64_json")
        .and_then(Value::as_str)
        .ok_or("OpenAI n'a rendu aucune image.")?;
    B64.decode(b64).map_err(|e| e.to_string())
}

/// Google : `generateContent`, texte et image dans le meme message, et
/// l'image produite revient en ligne dans la reponse.
async fn google(key: &str, model: &str, image: &[u8], prompt: &str) -> Result<Vec<u8>, String> {
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent");
    let body = json!({
        "contents": [{ "parts": [
            { "text": prompt },
            { "inline_data": { "mime_type": mime_of(image), "data": B64.encode(image) } }
        ]}],
        "generationConfig": { "responseModalities": ["TEXT", "IMAGE"] }
    });
    let res = client()?
        .post(url)
        .header("x-goog-api-key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Google injoignable : {e}"))?;
    if !res.status().is_success() {
        return Err(refus(res, "Google").await);
    }
    let corps: Value = res.json().await.map_err(|e| e.to_string())?;
    let parts = corps
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .ok_or("Google n'a rendu aucune image.")?;
    let b64 = parts
        .iter()
        .find_map(|p| {
            p.pointer("/inlineData/data")
                .or_else(|| p.pointer("/inline_data/data"))
                .and_then(Value::as_str)
        })
        .ok_or("Google a repondu sans image (contenu refuse ?).")?;
    B64.decode(b64).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::mime_of;

    #[test]
    fn le_type_se_lit_dans_les_premiers_octets() {
        assert_eq!(mime_of(&[0x89, b'P', b'N', b'G', 0, 0]), "image/png");
        assert_eq!(mime_of(&[0xFF, 0xD8, 0xFF]), "image/jpeg");
        assert_eq!(mime_of(b"bonjour"), "application/octet-stream");
    }
}
