//! VOIDBELT — serveur du site.
//!
//! Sert les trois pages — accueil, arène, Velocity — et leurs
//! ressources partagées comme des fichiers statiques, et expose une
//! petite API JSON pour le contenu qui n'a pas sa place dans le
//! JavaScript : l'archive de répliques de l'accueil et le classement
//! de Velocity.
//!
//! Chaque page a son dossier sous `public/` (`home/`, `arena/`,
//! `velocity/`) ; seul `public/index.html` reste à la racine, parce que
//! c'est lui que sert `/`.

mod leaderboard;
mod transmissions;

use axum::{
    Json, Router,
    http::{HeaderValue, Method, header},
    routing::get,
};
use std::net::SocketAddr;
use tower_http::{
    compression::CompressionLayer, cors::CorsLayer, services::ServeDir,
    set_header::SetResponseHeaderLayer, trace::TraceLayer,
};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "voidbelt_server=info,tower_http=info".into()),
        )
        .init();

    // Le dossier partage (feuilles de style, scripts, pistes audio) change
    // rarement une fois deploye : autant laisser le navigateur le garder
    // en cache plutot que de le redemander a chaque page. La reponse est
    // scopee a ce seul sous-routeur avant fusion, pour ne pas coiffer
    // l'API ou les pages, elles, jamais mises en cache.
    let shared = Router::new()
        .nest_service("/shared", ServeDir::new("public/shared"))
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=86400"),
        ));

    let cors = CorsLayer::new()
        .allow_origin(HeaderValue::from_static("https://voidbelt.com"))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::ACCEPT, header::CONTENT_TYPE]);

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/transmissions", get(transmissions::list))
        .route(
            "/api/velocity/leaderboard",
            get(leaderboard::list).post(leaderboard::submit),
        )
        .merge(shared)
        .nest_service("/home", ServeDir::new("public/home"))
        .nest_service("/arena", ServeDir::new("public/arena"))
        .nest_service("/velocity", ServeDir::new("public/velocity"))
        .nest_service("/skilltree", ServeDir::new("public/skilltree"))
        .fallback_service(ServeDir::new("public"))
        .layer(cors)
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http());

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("impossible d'écouter sur {addr}: {e}"));

    tracing::info!("VOIDBELT en écoute sur http://127.0.0.1:{port}");
    axum::serve(listener, app)
        .await
        .expect("le serveur s'est arrêté sur une erreur");
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}
