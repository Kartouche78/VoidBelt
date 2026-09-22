use axum::{Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

const DEFAULT_FILE: &str = "data/velocity-leaderboard.json";
const MAX_SCORES: usize = 100;
static WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Serialize, Deserialize)]
pub struct Score {
    name: String,
    time_ms: u64,
    created_at: u64,
}

#[derive(Deserialize)]
pub struct NewScore {
    name: String,
    time_ms: u64,
}

pub async fn list() -> Json<Vec<Score>> {
    Json(read_scores().await)
}

pub async fn submit(
    Json(input): Json<NewScore>,
) -> Result<(StatusCode, Json<Vec<Score>>), (StatusCode, &'static str)> {
    let name = input.name.trim();
    let valid_name = !name.is_empty()
        && name.chars().count() <= 20
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.'));
    if !valid_name {
        return Err((StatusCode::BAD_REQUEST, "Nom invalide"));
    }
    if !(5_000..=600_000).contains(&input.time_ms) {
        return Err((StatusCode::BAD_REQUEST, "Chrono invalide"));
    }

    let _guard = WRITE_LOCK.get_or_init(|| Mutex::new(())).lock().await;
    let mut scores = read_scores().await;
    scores.push(Score {
        name: name.to_string(),
        time_ms: input.time_ms,
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    });
    scores.sort_by_key(|score| score.time_ms);
    scores.truncate(MAX_SCORES);

    let file = data_file();
    if let Some(parent) = Path::new(&file).parent() {
        tokio::fs::create_dir_all(parent).await.map_err(internal)?;
    }
    let json = serde_json::to_vec_pretty(&scores).map_err(internal)?;
    let temporary = format!("{file}.tmp");
    tokio::fs::write(&temporary, json).await.map_err(internal)?;
    tokio::fs::rename(&temporary, &file)
        .await
        .map_err(internal)?;

    Ok((StatusCode::CREATED, Json(scores)))
}

async fn read_scores() -> Vec<Score> {
    let Ok(bytes) = tokio::fs::read(data_file()).await else {
        return Vec::new();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn data_file() -> String {
    std::env::var("VELOCITY_DATA_FILE").unwrap_or_else(|_| DEFAULT_FILE.to_string())
}

fn internal<E>(error: E) -> (StatusCode, &'static str)
where
    E: std::fmt::Display,
{
    tracing::error!(%error, "échec de sauvegarde du classement Velocity");
    (StatusCode::INTERNAL_SERVER_ERROR, "Sauvegarde impossible")
}
