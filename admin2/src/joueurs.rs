//! Ce que les autres joueurs voient d'un compte : son pseudo et son avatar,
//! jamais son adresse e-mail.
//!
//! Sans pseudo choisi, on montre le prenom donne par Google, pas le nom
//! complet.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Joueur {
    pub id: i64,
    pub pseudo: String,
    pub avatar: String,
}

/// Nom montre aux autres : le pseudo, sinon le prenom.
pub fn nom_public(pseudo: &str, nom: &str) -> String {
    if !pseudo.is_empty() {
        return pseudo.to_string();
    }
    nom.split_whitespace().next().unwrap_or("Joueur").to_string()
}

pub fn par_id(c: &Connection, id: i64) -> Option<Joueur> {
    c.query_row(
        "SELECT pseudo, nom, avatar, avatar_maj FROM comptes WHERE id = ?1",
        params![id],
        |r| {
            let maj: i64 = r.get(3)?;
            Ok(Joueur {
                id,
                pseudo: nom_public(&r.get::<_, String>(0)?, &r.get::<_, String>(1)?),
                avatar: if maj > 0 { format!("/api/profil/avatar/{id}?v={maj}") } else { r.get(2)? },
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

/// Les joueurs de `ids`, dans le meme ordre ; les comptes disparus sautent.
pub fn plusieurs(c: &Connection, ids: impl IntoIterator<Item = i64>) -> Vec<Joueur> {
    ids.into_iter().filter_map(|id| par_id(c, id)).collect()
}

/// Echappe `%`, `_` et `\` pour un `LIKE ... ESCAPE '\'`.
pub fn motif(q: &str) -> String {
    q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// Texte libre propre : sans caracteres de controle (sauf les retours a la
/// ligne si `lignes`), sans blancs autour, `max` caracteres au plus.
pub fn texte_propre(brut: &str, max: usize, lignes: bool) -> Option<String> {
    let t: String = brut
        .trim()
        .chars()
        .filter(|c| !c.is_control() || (lignes && *c == '\n'))
        .take(max)
        .collect();
    let t = t.trim().to_string();
    (!t.is_empty()).then_some(t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sans_pseudo_on_ne_montre_que_le_prenom() {
        assert_eq!(nom_public("Kart", "Jean Dupont"), "Kart");
        assert_eq!(nom_public("", "Jean Dupont"), "Jean");
        assert_eq!(nom_public("", ""), "Joueur");
    }

    #[test]
    fn le_texte_est_nettoye() {
        assert_eq!(texte_propre("  salut\u{7}  ", 10, false).as_deref(), Some("salut"));
        assert_eq!(texte_propre("a\nb", 10, true).as_deref(), Some("a\nb"));
        assert_eq!(texte_propre("a\nb", 10, false).as_deref(), Some("ab"));
        assert_eq!(texte_propre("   ", 10, true), None);
        assert_eq!(texte_propre("abcdef", 3, false).as_deref(), Some("abc"));
        assert_eq!(motif("a_b%"), "a\\_b\\%");
    }
}
