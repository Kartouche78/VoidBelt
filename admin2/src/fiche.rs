//! Fiche publique d'un joueur, ouverte depuis la recherche du panneau :
//! pseudo, avatar, role, anciennete, clan, et ce qui me lie a lui. Jamais
//! son adresse e-mail. Son statut en ligne n'est montre qu'a ses amis.

use crate::amis::{self, Lien};
use crate::{R, Refus, base, clans, comptes, connecte, joueurs};
use axum::{Json, extract::Path, http::{HeaderMap, StatusCode}};
use rusqlite::Connection;
use serde_json::{Value, json};

/// La fiche de `lui` vue par `moi`, sans le statut (ajoute par la route).
pub fn fiche(c: &Connection, moi: i64, lui: i64) -> R<(Value, Lien)> {
    let j = joueurs::par_id(c, lui).ok_or(Refus(StatusCode::NOT_FOUND, "Joueur introuvable."))?;
    let compte = comptes::par_id(c, lui).ok_or(Refus(StatusCode::NOT_FOUND, "Joueur introuvable."))?;
    let clan = clans::rang_de(c, lui).and_then(|(id, rang)| {
        let k = clans::par_id(c, id)?;
        Some(json!({ "id": k.id, "nom": k.nom, "tag": k.tag, "image": k.image, "rang": rang }))
    });
    let l = if moi == lui { Lien::Aucun } else { amis::lien(c, moi, lui) };
    Ok((
        json!({
            "id": j.id,
            "pseudo": j.pseudo,
            "avatar": j.avatar,
            "role": compte.role,
            "cree": compte.cree,
            "clan": clan,
            "lien": l,
            "moi": moi == lui,
        }),
        l,
    ))
}

pub async fn route(headers: HeaderMap, Path(lui): Path<i64>) -> R<Json<Value>> {
    let moi = connecte(&headers)?;
    let (mut f, l) = fiche(&base::base(), moi.id, lui)?;
    if l == Lien::Ami {
        f["statut"] = json!(crate::social::social().presence.statut(lui));
    }
    Ok(Json(json!({ "joueur": f })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::amis::{demander, tests::joueur};
    use crate::base::neuve;

    #[test]
    fn la_fiche_montre_le_lien_sans_l_adresse() {
        let c = neuve();
        let (a, b) = (joueur(&c, "Alpha"), joueur(&c, "Bravo"));
        let (f, l) = fiche(&c, a, b).unwrap();
        assert_eq!(l, Lien::Aucun);
        assert_eq!(f["pseudo"], "Bravo");
        assert!(f["clan"].is_null());
        assert!(!f.to_string().contains('@'), "l'adresse fuit : {f}");
        demander(&c, a, b).unwrap();
        assert_eq!(fiche(&c, b, a).unwrap().1, Lien::Recue);
        clans::creer(&c, b, "Les Rapides", "RAP", "", true).unwrap();
        assert_eq!(fiche(&c, a, b).unwrap().0["clan"]["tag"], "RAP");
        assert_eq!(fiche(&c, a, 999).unwrap_err().0, StatusCode::NOT_FOUND);
        assert_eq!(fiche(&c, a, a).unwrap().0["moi"], true);
    }
}
