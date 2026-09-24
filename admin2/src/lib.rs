//! Admin2 : tout ce qui touche aux comptes des joueurs de Voidbelt.
//!
//!   google    connexion avec Google (OpenID Connect)
//!   sessions  la preuve de connexion, requete apres requete
//!   comptes   comptes, roles (joueur, admin) et profils
//!   ranked    le classement, a venir
//!   base      le schema de tout ce qui precede
//!
//! Le serveur monte `routes()` et demande `est_admin()` avant toute action
//! de l'admin : generer, valider, regler, gerer les cles.

pub mod base;
pub mod comptes;
pub mod google;
pub mod ranked;
pub mod sessions;

use axum::{
    Json, Router,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use comptes::Compte;
use serde_json::{Value, json};

/// Ouvre la base et met son schema en place. A appeler au demarrage du
/// serveur : une base illisible doit l'empecher de partir, pas echouer a la
/// premiere connexion.
pub fn demarrer() {
    drop(base::base());
    if !google::configure() {
        tracing::warn!("connexion Google non configuree : GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET manquent");
    }
}

/// Compte de la session portee par la requete, s'il y en a une valide.
pub fn compte_de(headers: &HeaderMap) -> Option<Compte> {
    let jeton = sessions::jeton(headers)?;
    sessions::compte(&base::base(), &jeton)
}

/// Vrai si la requete vient d'un admin connecte.
pub fn est_admin(headers: &HeaderMap) -> bool {
    compte_de(headers).is_some_and(|c| c.est_admin())
}

/// Routes des comptes, a fusionner dans celles du serveur.
pub fn routes() -> Router {
    Router::new()
        .route("/api/auth/google/connexion", get(google::connexion))
        .route("/api/auth/google/callback", get(google::callback))
        .route("/api/auth/moi", get(moi))
        .route("/api/auth/deconnexion", post(deconnexion))
        .route("/api/profil", get(profil).put(changer_profil))
}

/// Qui suis-je ? L'admin s'en sert pour savoir s'il doit proposer de se
/// connecter.
async fn moi(headers: HeaderMap) -> Json<Value> {
    let compte = compte_de(&headers);
    Json(json!({
        "connecte": compte.is_some(),
        "admin": compte.as_ref().is_some_and(Compte::est_admin),
        "compte": compte,
        "google": google::configure(),
    }))
}

async fn deconnexion(headers: HeaderMap) -> Response {
    if let Some(j) = sessions::jeton(&headers) {
        sessions::fermer(&base::base(), &j);
    }
    (
        StatusCode::OK,
        [(header::SET_COOKIE, sessions::cookie(None, google::https()))],
        Json(json!({ "ok": true })),
    )
        .into_response()
}

fn non_connecte() -> Response {
    (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Connecte-toi d'abord." }))).into_response()
}

/// Profil du joueur connecte.
async fn profil(headers: HeaderMap) -> Response {
    match compte_de(&headers) {
        Some(c) => Json(json!({ "compte": c })).into_response(),
        None => non_connecte(),
    }
}

/// Change son pseudo : `{ "pseudo": "..." }`.
async fn changer_profil(headers: HeaderMap, Json(corps): Json<Value>) -> Response {
    let Some(c) = compte_de(&headers) else { return non_connecte() };
    let Some(pseudo) = corps.get("pseudo").and_then(Value::as_str).and_then(comptes::pseudo_valide) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Pseudo de 3 a 16 caracteres : lettres, chiffres, espaces, - et _." })),
        )
            .into_response();
    };
    let b = base::base();
    if comptes::changer_pseudo(&b, c.id, &pseudo).is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Pseudo non enregistre." }))).into_response();
    }
    Json(json!({ "compte": comptes::par_id(&b, c.id) })).into_response()
}
