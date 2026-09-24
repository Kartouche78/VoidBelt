//! Admin2 : tout ce qui touche aux comptes des joueurs de Voidbelt.
//!
//!   google    connexion avec Google (OpenID Connect)
//!   sessions  la preuve de connexion, requete apres requete
//!   comptes   comptes et roles (joueur, admin)
//!   profil    pseudo et avatar du joueur connecte
//!   joueurs   ce que les autres voient d'un joueur
//!   amis      demandes et amities
//!   messages  messagerie privee entre amis
//!   clans     creation et gestion des clans ; `clan_api` leurs routes et
//!             leur discussion
//!   ranked    le classement, a venir
//!   base      le schema de tout ce qui precede
//!
//! Le serveur monte `routes()` et demande `est_admin()` avant toute action
//! de l'admin : generer, valider, regler, gerer les cles.

pub mod amis;
pub mod base;
pub mod clan_api;
pub mod clans;
pub mod comptes;
pub mod google;
pub mod joueurs;
pub mod messages;
pub mod profil;
pub mod ranked;
pub mod sessions;

use axum::{
    Json, Router,
    extract::ConnectInfo,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post, put},
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

/// Vrai si la requete vient de la machine du serveur elle-meme, et non
/// d'un visiteur relaye par nginx (qui arrive lui aussi de `127.0.0.1`,
/// mais avec un en-tete de relais). Sert aux essais en local, sans Google.
pub fn machine_hote(headers: &HeaderMap, who: std::net::SocketAddr) -> bool {
    let relayee = headers.contains_key("x-forwarded-for") || headers.contains_key("x-real-ip");
    who.ip().is_loopback() && !relayee
}

/// Couleur du clan d'un compte (`#rrggbb`), vide sans clan ou sans
/// couleur : le salon de jeu en peint la voiture du joueur.
pub fn couleur_clan(compte: i64) -> String {
    clans::couleur_de(&base::base(), compte)
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
        .route("/api/profil", get(profil::lire).put(profil::changer))
        .route("/api/profil/avatar", put(profil::poser_avatar).delete(profil::retirer_avatar))
        .route("/api/profil/avatar/{id}", get(profil::avatar))
        .route("/api/amis", get(amis::liste_route))
        .route("/api/amis/chercher", get(amis::chercher_route))
        .route("/api/amis/{id}", post(amis::demander_route).delete(amis::retirer_route))
        .route("/api/messagerie", get(messages::resume_route))
        .route("/api/messages/{id}", get(messages::fil_route).post(messages::envoyer_route))
        .route("/api/clan", get(clan_api::mon_clan).put(clan_api::regler).delete(clan_api::dissoudre))
        .route("/api/clan/image", put(clan_api::poser_image))
        .route("/api/clan/quitter", post(clan_api::quitter))
        .route("/api/clan/membres/{id}", post(clan_api::agir))
        .route("/api/clan/messages", get(clan_api::fil).post(clan_api::ecrire))
        .route("/api/clans", get(clan_api::chercher).post(clan_api::creer))
        .route("/api/clans/{id}/image", get(clan_api::image))
        .route("/api/clans/{id}/rejoindre", post(clan_api::rejoindre).delete(clan_api::annuler))
}

/// Refus d'une action, avec le code HTTP et la phrase montree au joueur.
#[derive(Debug, PartialEq)]
pub struct Refus(pub StatusCode, pub &'static str);

pub type R<T> = Result<T, Refus>;

impl From<rusqlite::Error> for Refus {
    fn from(e: rusqlite::Error) -> Self {
        tracing::warn!("base : {e}");
        Refus(StatusCode::INTERNAL_SERVER_ERROR, "Erreur de la base, reessaie.")
    }
}

impl IntoResponse for Refus {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

/// Le compte de la requete, ou un refus « connecte-toi ».
pub(crate) fn connecte(headers: &HeaderMap) -> R<Compte> {
    compte_de(headers).ok_or(Refus(StatusCode::UNAUTHORIZED, "Connecte-toi d'abord."))
}

/// Qui suis-je ? L'admin s'en sert pour savoir s'il doit proposer de se
/// connecter.
async fn moi(headers: HeaderMap, ConnectInfo(who): ConnectInfo<std::net::SocketAddr>) -> Json<Value> {
    let compte = compte_de(&headers);
    // Le clan du joueur, pour l'icone du panneau.
    let mut vu = json!(compte);
    if let (Some(c), Some(o)) = (&compte, vu.as_object_mut()) {
        o.insert("clan".into(), json!(clans::bref(&base::base(), c.id)));
    }
    Json(json!({
        "connecte": compte.is_some(),
        "admin": compte.as_ref().is_some_and(Compte::est_admin),
        "compte": vu,
        "google": google::configure(),
        // Le multijoueur demande un compte, sauf sur la machine du serveur.
        "multi_libre": machine_hote(&headers, who),
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
