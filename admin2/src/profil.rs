//! Profil du joueur connecte : pseudo, avatar, et ce que le panneau du jeu
//! affiche de lui.
//!
//! L'adresse e-mail et le mot de passe appartiennent a Google : on les
//! montre, on ne les change pas ici.

use crate::{base, comptes, compte_de};
use axum::{
    Json,
    extract::Path,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use serde_json::{Value, json};

/// Plus lourd, ce n'est pas un avatar : la page les reduit a 256 x 256.
const AVATAR_MAX: usize = 512 * 1024;

fn erreur(code: StatusCode, texte: &str) -> Response {
    (code, Json(json!({ "error": texte }))).into_response()
}

fn non_connecte() -> Response {
    erreur(StatusCode::UNAUTHORIZED, "Connecte-toi d'abord.")
}

fn profil_de(id: i64) -> Response {
    Json(json!({ "compte": comptes::par_id(&base::base(), id) })).into_response()
}

pub async fn lire(headers: HeaderMap) -> Response {
    match compte_de(&headers) {
        Some(c) => profil_de(c.id),
        None => non_connecte(),
    }
}

/// Change son pseudo : `{ "pseudo": "..." }`.
pub async fn changer(headers: HeaderMap, Json(corps): Json<Value>) -> Response {
    let Some(c) = compte_de(&headers) else { return non_connecte() };
    let Some(pseudo) = corps.get("pseudo").and_then(Value::as_str).and_then(comptes::pseudo_valide) else {
        return erreur(StatusCode::BAD_REQUEST, "Pseudo de 3 a 16 caracteres : lettres, chiffres, espaces, - et _.");
    };
    let b = base::base();
    if comptes::pseudo_pris(&b, c.id, &pseudo) {
        return erreur(StatusCode::CONFLICT, "Ce pseudo est deja pris.");
    }
    if comptes::changer_pseudo(&b, c.id, &pseudo).is_err() {
        return erreur(StatusCode::INTERNAL_SERVER_ERROR, "Pseudo non enregistre.");
    }
    drop(b);
    profil_de(c.id)
}

/// Type d'une image d'apres ses premiers octets : seuls PNG, JPEG et WebP
/// passent, quoi que pretende l'envoi.
pub fn type_image(o: &[u8]) -> Option<&'static str> {
    match o {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        _ => None,
    }
}

/// Pose son avatar : `{ "image": "data:image/png;base64,..." }`.
pub async fn poser_avatar(headers: HeaderMap, Json(corps): Json<Value>) -> Response {
    let Some(c) = compte_de(&headers) else { return non_connecte() };
    let brut = corps.get("image").and_then(Value::as_str).unwrap_or("");
    let brut = brut.split_once(',').map_or(brut, |(_, d)| d);
    let Ok(image) = B64.decode(brut) else {
        return erreur(StatusCode::BAD_REQUEST, "Image illisible.");
    };
    if image.len() > AVATAR_MAX {
        return erreur(StatusCode::PAYLOAD_TOO_LARGE, "Avatar trop lourd (512 Ko au plus).");
    }
    if type_image(&image).is_none() {
        return erreur(StatusCode::BAD_REQUEST, "Seules les images PNG, JPEG et WebP sont acceptees.");
    }
    if comptes::poser_avatar(&base::base(), c.id, &image).is_err() {
        return erreur(StatusCode::INTERNAL_SERVER_ERROR, "Avatar non enregistre.");
    }
    profil_de(c.id)
}

/// Retire son avatar : celui de Google revient.
pub async fn retirer_avatar(headers: HeaderMap) -> Response {
    let Some(c) = compte_de(&headers) else { return non_connecte() };
    if comptes::retirer_avatar(&base::base(), c.id).is_err() {
        return erreur(StatusCode::INTERNAL_SERVER_ERROR, "Avatar non retire.");
    }
    profil_de(c.id)
}

/// Sert l'avatar d'un joueur. Public : les autres joueurs le verront dans
/// la messagerie et les salons.
pub async fn avatar(Path(id): Path<i64>) -> Response {
    let Some(image) = comptes::avatar(&base::base(), id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(mime) = type_image(&image) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    (
        [
            (header::CONTENT_TYPE, mime),
            // L'adresse change a chaque nouvel avatar (`?v=`) : on peut garder.
            (header::CACHE_CONTROL, "public, max-age=604800, immutable"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        image,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::type_image;

    #[test]
    fn seules_les_vraies_images_passent() {
        assert_eq!(type_image(&[0x89, b'P', b'N', b'G', 0]), Some("image/png"));
        assert_eq!(type_image(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(type_image(b"<svg onload=alert(1)>"), None, "un SVG est passe pour un avatar");
        assert_eq!(type_image(b"GIF89a"), None);
    }
}
