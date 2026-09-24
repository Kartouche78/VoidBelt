//! Base des creations de l'admin : arenes, voitures, et ce qui suivra.
//!
//! Tout ce qui est valide dans l'admin vit ici, images comprises, dans un
//! seul fichier SQLite (`data/voidbelt.db`). C'est lui que le jeu lit pour
//! tous les joueurs, et c'est lui qu'on sauvegarde : un fichier, rien
//! d'eparpille. Les ecritures passent par des transactions, deux
//! validations simultanees ne peuvent donc plus s'ecraser comme le
//! faisait le `catalog.json` relu puis reecrit.
//!
//! Une sauvegarde complete est faite au demarrage puis chaque jour dans
//! `data/sauvegardes/` ; on garde les quatorze dernieres.

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value};
use std::{
    path::Path,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const FICHIER: &str = "data/voidbelt.db";
const SAUVEGARDES: &str = "data/sauvegardes";
const GARDER: usize = 14;
const RYTHME: Duration = Duration::from_secs(24 * 3600);

/// Une creation telle que la base la rend : ses champs communs, et ceux
/// propres a sa sorte (`meta`), deja lus.
pub struct Creation {
    pub id: String,
    pub name: String,
    pub meta: Map<String, Value>,
}

fn base() -> &'static Mutex<Connection> {
    static BASE: OnceLock<Mutex<Connection>> = OnceLock::new();
    BASE.get_or_init(|| {
        let _ = std::fs::create_dir_all("data");
        let c = Connection::open(FICHIER).expect("base data/voidbelt.db illisible");
        prepare(&c).expect("schema de la base");
        Mutex::new(c)
    })
}

/// Schema. `IF NOT EXISTS` partout : ouvrir une base existante ne change
/// rien, en creer une la met en place.
fn prepare(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS creations (
             id         TEXT PRIMARY KEY,
             kind       TEXT NOT NULL,
             name       TEXT NOT NULL,
             meta       TEXT NOT NULL DEFAULT '{}',
             image      BLOB NOT NULL,
             thumb      BLOB NOT NULL,
             created_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS creations_par_sorte ON creations (kind, created_at);",
    )
}

fn maintenant() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64
}

fn lis_meta(texte: &str) -> Map<String, Value> {
    serde_json::from_str::<Value>(texte)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

// -------------------------------------------------------------- lecture --

pub fn list(kind: &str) -> Vec<Creation> {
    list_in(&base().lock().expect("base"), kind)
}

fn list_in(c: &Connection, kind: &str) -> Vec<Creation> {
    let Ok(mut q) = c.prepare("SELECT id, name, meta FROM creations WHERE kind = ?1 ORDER BY created_at, id") else {
        return Vec::new();
    };
    q.query_map(params![kind], |r| {
        Ok(Creation {
            id: r.get(0)?,
            name: r.get(1)?,
            meta: lis_meta(&r.get::<_, String>(2)?),
        })
    })
    .map(|lignes| lignes.flatten().collect())
    .unwrap_or_default()
}

/// Image (`miniature` faux) ou miniature d'une creation.
pub fn image(kind: &str, id: &str, miniature: bool) -> Option<Vec<u8>> {
    image_in(&base().lock().expect("base"), kind, id, miniature)
}

fn image_in(c: &Connection, kind: &str, id: &str, miniature: bool) -> Option<Vec<u8>> {
    let colonne = if miniature { "thumb" } else { "image" };
    c.query_row(
        &format!("SELECT {colonne} FROM creations WHERE kind = ?1 AND id = ?2"),
        params![kind, id],
        |r| r.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

// ------------------------------------------------------------ ecriture --

pub fn add(kind: &str, id: &str, name: &str, meta: &Map<String, Value>, image: &[u8], thumb: &[u8]) -> Result<(), String> {
    add_in(&base().lock().expect("base"), kind, id, name, meta, image, thumb, maintenant())
}

#[allow(clippy::too_many_arguments)]
fn add_in(
    c: &Connection,
    kind: &str,
    id: &str,
    name: &str,
    meta: &Map<String, Value>,
    image: &[u8],
    thumb: &[u8],
    quand: i64,
) -> Result<(), String> {
    let meta = serde_json::to_string(meta).unwrap_or_else(|_| String::from("{}"));
    c.execute(
        "INSERT INTO creations (id, kind, name, meta, image, thumb, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, kind, name, meta, image, thumb, quand],
    )
    .map(|_| ())
    .map_err(|e| format!("Base : {e}"))
}

/// Retire une creation. Rend vrai si elle existait.
pub fn remove(kind: &str, id: &str) -> bool {
    base()
        .lock()
        .expect("base")
        .execute("DELETE FROM creations WHERE kind = ?1 AND id = ?2", params![kind, id])
        .map(|n| n > 0)
        .unwrap_or(false)
}

// ------------------------------------------------------------- reprise --

/// Reprend les creations d'avant la base : le `catalog.json` d'un dossier
/// et ses images. Une seule fois : le catalogue est ensuite renomme en
/// `catalog.json.repris`, fichiers laisses en place par prudence. Rend le
/// nombre de creations reprises.
pub fn reprendre(kind: &str, dir: &str, ext: &str) -> usize {
    let c = base().lock().expect("base");
    reprendre_in(&c, kind, dir, ext)
}

fn reprendre_in(c: &Connection, kind: &str, dir: &str, ext: &str) -> usize {
    let catalogue = Path::new(dir).join("catalog.json");
    let Ok(texte) = std::fs::read_to_string(&catalogue) else {
        return 0;
    };
    let entrees = serde_json::from_str::<Value>(&texte)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    let mut repris = 0;
    for (rang, e) in entrees.iter().enumerate() {
        let Some(obj) = e.as_object() else { continue };
        let Some(id) = obj.get("id").and_then(Value::as_str) else { continue };
        let name = obj.get("name").and_then(Value::as_str).unwrap_or(id);
        let (Ok(image), Ok(thumb)) = (
            std::fs::read(Path::new(dir).join(format!("{id}.{ext}"))),
            std::fs::read(Path::new(dir).join(format!("{id}_min.{ext}"))),
        ) else {
            continue;
        };
        let mut meta = obj.clone();
        for cle in ["id", "name", "art", "thumb"] {
            meta.remove(cle);
        }
        // L'ordre du catalogue devient l'ordre de creation.
        if add_in(c, kind, id, name, &meta, &image, &thumb, rang as i64).is_ok() {
            repris += 1;
        }
    }
    let _ = std::fs::rename(&catalogue, Path::new(dir).join("catalog.json.repris"));
    repris
}

// ---------------------------------------------------------- sauvegarde --

/// Copie complete et coherente de la base, meme en pleine ecriture :
/// `VACUUM INTO` lit un instantane. Rend le chemin ecrit.
pub fn sauvegarder() -> Result<String, String> {
    std::fs::create_dir_all(SAUVEGARDES).map_err(|e| e.to_string())?;
    let chemin = format!("{SAUVEGARDES}/voidbelt-{}.db", horodatage());
    base()
        .lock()
        .expect("base")
        .execute("VACUUM INTO ?1", params![chemin])
        .map_err(|e| format!("Sauvegarde : {e}"))?;
    elaguer();
    Ok(chemin)
}

/// Date et heure UTC, triables comme du texte : `20260924T081500Z`.
fn horodatage() -> String {
    let s = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    let (jours, reste) = (s.div_euclid(86_400), s.rem_euclid(86_400));
    // Calendrier civil depuis le 1er janvier 1970 (algorithme de Hinnant).
    let z = jours + 719_468;
    let ere = z.div_euclid(146_097);
    let j = z - ere * 146_097;
    let a = (j - j / 1460 + j / 36_524 - j / 146_096) / 365;
    let jour_an = j - (365 * a + a / 4 - a / 100);
    let m = (5 * jour_an + 2) / 153;
    let jour = jour_an - (153 * m + 2) / 5 + 1;
    let mois = if m < 10 { m + 3 } else { m - 9 };
    let annee = a + ere * 400 + i64::from(mois <= 2);
    format!(
        "{annee:04}{mois:02}{jour:02}T{:02}{:02}{:02}Z",
        reste / 3600,
        (reste % 3600) / 60,
        reste % 60
    )
}

/// Ne garde que les `GARDER` sauvegardes les plus recentes.
fn elaguer() {
    let Ok(dir) = std::fs::read_dir(SAUVEGARDES) else { return };
    let mut noms: Vec<_> = dir
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "db"))
        .collect();
    noms.sort();
    let trop = noms.len().saturating_sub(GARDER);
    for p in noms.into_iter().take(trop) {
        let _ = std::fs::remove_file(p);
    }
}

/// Ouvre la base, reprend les anciennes creations, sauvegarde, puis
/// sauvegarde chaque jour. A appeler une fois au demarrage du serveur.
pub fn demarrer(anciens: &[(&str, &str, &str)]) {
    for (kind, dir, ext) in anciens {
        let n = reprendre(kind, dir, ext);
        if n > 0 {
            tracing::info!("base : {n} {kind}(s) reprise(s) de {dir}/catalog.json");
        }
    }
    tokio::spawn(async {
        loop {
            match tokio::task::spawn_blocking(sauvegarder).await {
                Ok(Ok(chemin)) => tracing::info!("base sauvegardee : {chemin}"),
                Ok(Err(e)) => tracing::warn!("{e}"),
                Err(e) => tracing::warn!("sauvegarde interrompue : {e}"),
            }
            tokio::time::sleep(RYTHME).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn neuve() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        prepare(&c).unwrap();
        c
    }

    #[test]
    fn une_creation_se_relit_puis_se_retire() {
        let c = neuve();
        let mut meta = Map::new();
        meta.insert("corner".into(), Value::from(83));
        add_in(&c, "arene", "gen-1", "Glaces", &meta, b"IMG", b"MIN", 1).unwrap();
        add_in(&c, "voiture", "car-1", "Mx5", &Map::new(), b"CAR", b"C", 2).unwrap();
        let arenes = list_in(&c, "arene");
        assert_eq!(arenes.len(), 1, "les sortes se melangent");
        assert_eq!(arenes[0].name, "Glaces");
        assert_eq!(arenes[0].meta["corner"], 83);
        assert_eq!(image_in(&c, "arene", "gen-1", false).as_deref(), Some(&b"IMG"[..]));
        assert_eq!(image_in(&c, "arene", "gen-1", true).as_deref(), Some(&b"MIN"[..]));
        assert_eq!(image_in(&c, "voiture", "gen-1", false), None, "une arene servie comme voiture");
        c.execute("DELETE FROM creations WHERE id = 'gen-1'", []).unwrap();
        assert!(list_in(&c, "arene").is_empty());
    }

    #[test]
    fn un_identifiant_ne_s_ecrit_pas_deux_fois() {
        let c = neuve();
        add_in(&c, "voiture", "car-1", "A", &Map::new(), b"1", b"1", 1).unwrap();
        assert!(add_in(&c, "voiture", "car-1", "B", &Map::new(), b"2", b"2", 2).is_err());
        assert_eq!(list_in(&c, "voiture")[0].name, "A", "la premiere a ete ecrasee");
    }

    #[test]
    fn les_anciennes_creations_sont_reprises() {
        let dir = std::env::temp_dir().join(format!("voidbelt-reprise-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("car-a.png"), b"A").unwrap();
        std::fs::write(dir.join("car-a_min.png"), b"a").unwrap();
        std::fs::write(
            dir.join("catalog.json"),
            r#"[{"id":"car-a","name":"Mx5","art":"/x","thumb":"/y","cadre":[0,1,0,1]},
                {"id":"car-perdue","name":"Sans image"}]"#,
        )
        .unwrap();
        let c = neuve();
        let d = dir.to_str().unwrap();
        assert_eq!(reprendre_in(&c, "voiture", d, "png"), 1, "une voiture sans image a ete reprise");
        let v = list_in(&c, "voiture");
        assert_eq!(v[0].name, "Mx5");
        assert!(v[0].meta.contains_key("cadre") && !v[0].meta.contains_key("art"));
        assert!(dir.join("catalog.json.repris").exists(), "le catalogue sera repris a chaque demarrage");
        assert_eq!(reprendre_in(&c, "voiture", d, "png"), 0, "reprise faite deux fois");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn l_horodatage_se_trie_comme_une_date() {
        let h = horodatage();
        assert_eq!(h.len(), 16);
        assert!(h.starts_with("20") && h.ends_with('Z'), "{h}");
    }
}
