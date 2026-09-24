//! Tables des comptes, dans le meme fichier SQLite que les creations de
//! l'admin (`data/voidbelt.db`). SQLite en mode WAL accepte plusieurs
//! connexions : celle-ci et celle du serveur vivent cote a cote.
//!
//! Chaque module d'`admin2` ajoute ses tables ici, pour qu'un seul schema
//! decrive tout ce qui touche aux joueurs.

use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard, OnceLock};

const FICHIER: &str = "data/voidbelt.db";

/// Connexion partagee. Les operations sont courtes : un verrou suffit.
pub fn base() -> MutexGuard<'static, Connection> {
    static BASE: OnceLock<Mutex<Connection>> = OnceLock::new();
    BASE.get_or_init(|| {
        let _ = std::fs::create_dir_all("data");
        let c = Connection::open(FICHIER).expect("base data/voidbelt.db illisible");
        prepare(&c).expect("schema des comptes");
        Mutex::new(c)
    })
    .lock()
    .unwrap_or_else(|e| e.into_inner())
}

/// Schema des comptes. `IF NOT EXISTS` partout : ouvrir une base existante
/// ne change rien, en creer une la met en place.
pub fn prepare(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;

         -- Un compte par identite Google. `google_sub` est l'identifiant
         -- permanent de Google : une adresse peut changer de main, lui non.
         CREATE TABLE IF NOT EXISTS comptes (
             id                 INTEGER PRIMARY KEY AUTOINCREMENT,
             google_sub         TEXT NOT NULL UNIQUE,
             email              TEXT NOT NULL,
             email_verifie      INTEGER NOT NULL DEFAULT 0,
             nom                TEXT NOT NULL DEFAULT '',
             avatar             TEXT NOT NULL DEFAULT '',
             pseudo             TEXT NOT NULL DEFAULT '',
             role               TEXT NOT NULL DEFAULT 'joueur',
             cree               INTEGER NOT NULL,
             derniere_connexion INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS comptes_par_email ON comptes (email);

         -- Sessions ouvertes. Seule l'empreinte du jeton est gardee : une
         -- base volee ne permet d'ouvrir aucune session.
         CREATE TABLE IF NOT EXISTS sessions (
             empreinte TEXT PRIMARY KEY,
             compte_id INTEGER NOT NULL REFERENCES comptes (id) ON DELETE CASCADE,
             cree      INTEGER NOT NULL,
             expire    INTEGER NOT NULL,
             agent     TEXT NOT NULL DEFAULT ''
         );
         CREATE INDEX IF NOT EXISTS sessions_par_compte ON sessions (compte_id);",
    )
}

/// Secondes depuis 1970.
pub fn maintenant() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
pub fn neuve() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    prepare(&c).unwrap();
    c
}
