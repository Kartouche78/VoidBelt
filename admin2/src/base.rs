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
         CREATE INDEX IF NOT EXISTS sessions_par_compte ON sessions (compte_id);

         -- Avatar choisi par le joueur, a la place de celui de Google.
         CREATE TABLE IF NOT EXISTS avatars (
             compte_id INTEGER PRIMARY KEY REFERENCES comptes (id) ON DELETE CASCADE,
             image     BLOB NOT NULL,
             maj       INTEGER NOT NULL
         );

         -- Amities : une demande (`acceptee` = 0), puis une amitie. Une
         -- seule ligne par paire, dans un sens ou dans l'autre.
         CREATE TABLE IF NOT EXISTS amities (
             demandeur INTEGER NOT NULL REFERENCES comptes (id) ON DELETE CASCADE,
             receveur  INTEGER NOT NULL REFERENCES comptes (id) ON DELETE CASCADE,
             acceptee  INTEGER NOT NULL DEFAULT 0,
             cree      INTEGER NOT NULL,
             PRIMARY KEY (demandeur, receveur),
             CHECK (demandeur <> receveur)
         );
         CREATE INDEX IF NOT EXISTS amities_recues ON amities (receveur);

         -- Messages prives, entre amis.
         CREATE TABLE IF NOT EXISTS messages (
             id    INTEGER PRIMARY KEY AUTOINCREMENT,
             de    INTEGER NOT NULL REFERENCES comptes (id) ON DELETE CASCADE,
             a     INTEGER NOT NULL REFERENCES comptes (id) ON DELETE CASCADE,
             texte TEXT NOT NULL,
             cree  INTEGER NOT NULL,
             lu    INTEGER NOT NULL DEFAULT 0
         );
         CREATE INDEX IF NOT EXISTS messages_envoyes ON messages (de, a, id);
         CREATE INDEX IF NOT EXISTS messages_recus ON messages (a, lu);

         -- Clans : un nom et un tag uniques, sans tenir compte des
         -- majuscules. Ouvert : on entre directement ; ferme : on demande.
         CREATE TABLE IF NOT EXISTS clans (
             id          INTEGER PRIMARY KEY AUTOINCREMENT,
             nom         TEXT NOT NULL UNIQUE COLLATE NOCASE,
             tag         TEXT NOT NULL UNIQUE COLLATE NOCASE,
             description TEXT NOT NULL DEFAULT '',
             ouvert      INTEGER NOT NULL DEFAULT 1,
             image       BLOB,
             image_maj   INTEGER NOT NULL DEFAULT 0,
             cree        INTEGER NOT NULL
         );

         -- Un clan par joueur au plus. `lu` : dernier message du clan lu.
         CREATE TABLE IF NOT EXISTS clan_membres (
             compte_id INTEGER PRIMARY KEY REFERENCES comptes (id) ON DELETE CASCADE,
             clan_id   INTEGER NOT NULL REFERENCES clans (id) ON DELETE CASCADE,
             rang      TEXT NOT NULL DEFAULT 'membre',
             entre     INTEGER NOT NULL,
             lu        INTEGER NOT NULL DEFAULT 0
         );
         CREATE INDEX IF NOT EXISTS clan_membres_par_clan ON clan_membres (clan_id);

         -- Demandes pour entrer dans un clan ferme.
         CREATE TABLE IF NOT EXISTS clan_demandes (
             clan_id   INTEGER NOT NULL REFERENCES clans (id) ON DELETE CASCADE,
             compte_id INTEGER NOT NULL REFERENCES comptes (id) ON DELETE CASCADE,
             cree      INTEGER NOT NULL,
             PRIMARY KEY (clan_id, compte_id)
         );

         -- Discussion du clan. `de` vide : annonce du clan (arrivee,
         -- depart, promotion...).
         CREATE TABLE IF NOT EXISTS clan_messages (
             id      INTEGER PRIMARY KEY AUTOINCREMENT,
             clan_id INTEGER NOT NULL REFERENCES clans (id) ON DELETE CASCADE,
             de      INTEGER REFERENCES comptes (id) ON DELETE SET NULL,
             texte   TEXT NOT NULL,
             cree    INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS clan_messages_par_clan ON clan_messages (clan_id, id);",
    )?;
    // Colonnes ajoutees apres coup : une base deja en service les recoit
    // ici, une base neuve aussi.
    ajoute_colonne(c, "comptes", "avatar_maj", "INTEGER NOT NULL DEFAULT 0")?;
    // Couleur unie du clan (`#rrggbb`), vide sans couleur choisie.
    ajoute_colonne(c, "clans", "couleur", "TEXT NOT NULL DEFAULT ''")
}

/// Ajoute une colonne si elle manque. `CREATE TABLE IF NOT EXISTS` ne
/// touche pas une table existante : c'est ainsi que le schema evolue.
fn ajoute_colonne(c: &Connection, table: &str, colonne: &str, def: &str) -> rusqlite::Result<()> {
    let existe: bool = c.query_row(
        &format!("SELECT EXISTS (SELECT 1 FROM pragma_table_info('{table}') WHERE name = ?1)"),
        [colonne],
        |r| r.get(0),
    )?;
    if !existe {
        c.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {colonne} {def};"))?;
    }
    Ok(())
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
