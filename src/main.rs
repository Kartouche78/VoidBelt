//! VOIDBELT ? pages statiques, transmissions et salons Jump'n Bump.

mod jumpnbump;
mod multiplayer;
mod rl2;
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

    // Les salons vivent en mémoire : le routeur qui les expose porte
    // son propre état, fusionné ensuite dans le routeur principal.
    let jnb_hub = jumpnbump::Hub::new();

    let jnb = Router::new()
        .route("/api/jnb/rooms", get(jumpnbump::rooms))
        .route("/api/jnb/ws", get(jumpnbump::ws))
        .with_state(jnb_hub.clone());

    // Le jeu evolue vite : on force la revalidation de ses fichiers. Sans
    // en-tete, le navigateur applique sa propre heuristique et peut servir
    // un module d'hier a cote d'un module d'aujourd'hui — un seul suffit a
    // tout casser.
    let rl2_files = Router::new()
        .nest_service("/rl2", ServeDir::new("public/rl2"))
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ));

    // Les salons RL2 vivent dans leur propre hub : le serveur y simule la
    // partie, il ne se contente pas de relayer.
    let rl2 = Router::new()
        .route("/api/rl2/rooms", get(rl2::rooms))
        .route("/api/rl2/ws", get(rl2::ws))
        .with_state(rl2::Hub::new());

    let multiplayer = Router::new()
        .route("/api/multiplayer/rooms", get(multiplayer::rooms))
        .route("/api/multiplayer/ws", get(multiplayer::ws))
        .with_state(multiplayer::Hub::new(jnb_hub));

    let cors = CorsLayer::new()
        .allow_origin(HeaderValue::from_static("https://voidbelt.com"))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::ACCEPT, header::CONTENT_TYPE]);

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/transmissions", get(transmissions::list))
        .merge(shared)
        .merge(jnb)
        .merge(rl2)
        .merge(rl2_files)
        .merge(multiplayer)
        .nest_service("/home", ServeDir::new("public/home"))
        .nest_service("/arena", ServeDir::new("public/arena"))
        .nest_service("/skilltree", ServeDir::new("public/skilltree"))
        .nest_service("/jumpnbump", ServeDir::new("public/jumpnbump"))
        .nest_service("/multiplayer", ServeDir::new("public/multiplayer"))
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
