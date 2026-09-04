//! Stable multiplayer gateway shared by all Voidbelt games.
//!
//! Public rooms expose their game kind. The gateway keeps one URL for
//! browsers while dispatching each socket to authoritative game rules.

use crate::{jumpnbump, shutdown};
use axum::{
    Json,
    extract::{
        Query, State,
        ws::{Message, WebSocketUpgrade},
    },
    response::Response,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

pub struct Hub {
    jumpnbump: Arc<jumpnbump::Hub>,
    shutdown: Arc<shutdown::Hub>,
}

impl Hub {
    pub fn new(jumpnbump: Arc<jumpnbump::Hub>, shutdown: Arc<shutdown::Hub>) -> Arc<Self> {
        Arc::new(Self {
            jumpnbump,
            shutdown,
        })
    }
}

#[derive(Deserialize)]
pub struct RoomQuery {
    game: Option<String>,
}

#[derive(Deserialize)]
pub struct JoinQuery {
    #[serde(default)]
    game: String,
    #[serde(default)]
    room: String,
    #[serde(default)]
    name: String,
    #[serde(default, rename = "priv")]
    private: String,
}

fn tagged(mut rooms: Value, game: &str) -> Vec<Value> {
    let Some(list) = rooms.as_array_mut() else {
        return Vec::new();
    };
    for room in list.iter_mut() {
        room["game"] = json!(game);
    }
    std::mem::take(list)
}

pub async fn rooms(Query(query): Query<RoomQuery>, State(hub): State<Arc<Hub>>) -> Json<Value> {
    let game = query
        .game
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut list = Vec::new();
    if game.is_empty() || game == "jumpnbump" {
        list.extend(tagged(jumpnbump::room_list(&hub.jumpnbump), "jumpnbump"));
    }
    if game.is_empty() || game == "shutdown" {
        list.extend(tagged(shutdown::room_list(&hub.shutdown), "shutdown"));
    }
    list.sort_by(|a, b| {
        a["game"]
            .as_str()
            .cmp(&b["game"].as_str())
            .then_with(|| a["code"].as_str().cmp(&b["code"].as_str()))
    });
    Json(Value::Array(list))
}

pub async fn ws(
    upgrade: WebSocketUpgrade,
    Query(query): Query<JoinQuery>,
    State(hub): State<Arc<Hub>>,
) -> Response {
    upgrade.on_upgrade(move |mut socket| async move {
        match query.game.to_ascii_lowercase().as_str() {
            "jumpnbump" => {
                jumpnbump::session(
                    socket,
                    jumpnbump::JoinParams {
                        room: query.room,
                        name: query.name,
                        priv_: query.private,
                    },
                    hub.jumpnbump.clone(),
                )
                .await;
            }
            "shutdown" => {
                shutdown::session(
                    socket,
                    shutdown::JoinParams {
                        room: query.room,
                        name: query.name,
                    },
                    hub.shutdown.clone(),
                )
                .await;
            }
            _ => {
                let _ = socket
                    .send(Message::Text(
                        json!({ "t": "error", "m": "Jeu multijoueur inconnu." })
                            .to_string()
                            .into(),
                    ))
                    .await;
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_tag_identifies_its_game() {
        let rooms = json!([{ "code": "1234", "players": [] }]);
        let tagged = tagged(rooms, "shutdown");
        assert_eq!(tagged[0]["game"], "shutdown");
    }
}
