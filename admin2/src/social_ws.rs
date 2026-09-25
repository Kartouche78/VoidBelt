//! Connexion sociale d'une page : ouverte tant que la page du jeu l'est,
//! pour un joueur connecte. Tout le sens des messages est dans `social.rs`.

use crate::{compte_de, social};
use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use tokio::sync::mpsc::unbounded_channel;

pub async fn ws(upgrade: WebSocketUpgrade, headers: HeaderMap) -> Response {
    let Some(c) = compte_de(&headers) else {
        return (StatusCode::UNAUTHORIZED, "Connecte-toi d'abord.").into_response();
    };
    upgrade.on_upgrade(move |socket| session(socket, c.id))
}

async fn session(mut socket: WebSocket, moi: i64) {
    let (tx, mut rx) = unbounded_channel::<String>();
    let id = social::arrivee(moi, tx);
    loop {
        tokio::select! {
            sortant = rx.recv() => match sortant {
                Some(texte) => {
                    if socket.send(Message::Text(texte.into())).await.is_err() {
                        break;
                    }
                }
                None => break,
            },
            entrant = socket.recv() => match entrant {
                Some(Ok(Message::Text(texte))) => social::recevoir(moi, &texte),
                Some(Ok(_)) => {}
                _ => break,
            },
        }
    }
    if social::depart(moi, id) {
        tokio::spawn(social::grace(moi));
    }
}
