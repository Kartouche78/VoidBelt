//! Social en direct : presence des amis, groupes et invitations, nouvelles.
//!
//! Chaque page du jeu d'un joueur connecte garde une connexion ouverte
//! (`social_ws.rs`). Par elle, le serveur pousse :
//!
//!   etat         a l'arrivee : amis et leur statut, groupe, invitations
//!   ami          un ami change de statut (connexion, menu, solo, partie)
//!   amis         la liste d'amis a change (demande acceptee, rupture)
//!   groupe       son groupe a change (ou `null` : plus de groupe)
//!   invitation   un ami l'invite dans son groupe
//!   lancer       le chef lance une partie : rejoindre ce salon
//!   nouvelles    un message ou une demande attend : relire la messagerie
//!   info, erreur une phrase a montrer
//!
//! et recoit : `lieu`, `inviter`, `repondre`, `quitter`, `exclure`,
//! `chef`, `lancer`.
//!
//! Verrous : toujours la base d'abord, puis l'etat social, jamais l'inverse.

use crate::groupes::Groupes;
use crate::presence::{Canal, Presence};
use crate::{amis, base, joueurs};
use rusqlite::Connection;
use serde_json::{Value, json};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

/// Delai avant qu'un joueur deconnecte perde sa place dans son groupe : le
/// temps de recharger la page.
pub const GRACE: Duration = Duration::from_secs(30);

#[derive(Default)]
pub struct Social {
    pub presence: Presence,
    pub groupes: Groupes,
}

pub fn social() -> MutexGuard<'static, Social> {
    static S: OnceLock<Mutex<Social>> = OnceLock::new();
    S.get_or_init(Mutex::default).lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------- lectures ---

fn amis_de(c: &Connection, moi: i64) -> Vec<i64> {
    amis::liste(c, moi).map(|l| l.amis.into_iter().map(|j| j.id).collect()).unwrap_or_default()
}

/// Un joueur tel que la colonne le montre : pseudo, avatar, statut.
fn fiche(c: &Connection, s: &Social, id: i64) -> Value {
    match joueurs::par_id(c, id) {
        Some(j) => json!({ "id": j.id, "pseudo": j.pseudo, "avatar": j.avatar, "statut": s.presence.statut(id) }),
        None => json!({ "id": id, "pseudo": "Joueur", "avatar": "", "statut": s.presence.statut(id) }),
    }
}

fn liste_amis(c: &Connection, s: &Social, moi: i64) -> Vec<Value> {
    amis_de(c, moi).into_iter().map(|id| fiche(c, s, id)).collect()
}

fn groupe(c: &Connection, s: &Social, moi: i64) -> Value {
    match s.groupes.groupe_de(moi) {
        None => Value::Null,
        Some(g) => json!({
            "chef": g.chef,
            "membres": g.membres.iter().map(|&m| fiche(c, s, m)).collect::<Vec<_>>(),
        }),
    }
}

fn envoyer(s: &Social, a: i64, message: Value) {
    s.presence.envoyer(a, &message.to_string());
}

/// Previent que le statut de `moi` a change : ses amis, les membres de son
/// groupe (pas forcement ses amis), et ses propres pages, qui le montrent
/// dans la zone du groupe.
fn annoncer(c: &Connection, s: &Social, moi: i64) {
    let f = fiche(c, s, moi);
    let mut qui = amis_de(c, moi);
    qui.extend(s.groupes.coequipiers(moi));
    qui.push(moi);
    qui.sort_unstable();
    qui.dedup();
    for d in qui {
        if s.presence.en_ligne(d) {
            envoyer(s, d, json!({ "t": "ami", "ami": f }));
        }
    }
}

fn pousser_groupe(c: &Connection, s: &Social, comptes: &[i64]) {
    for &m in comptes {
        envoyer(s, m, json!({ "t": "groupe", "groupe": groupe(c, s, m) }));
    }
}

// ------------------------------------------------ arrivee et depart ---

/// Une page s'ouvre : elle recoit l'etat complet, ses amis la voient.
pub fn arrivee(moi: i64, canal: Canal) -> u64 {
    let b = base::base();
    let mut s = social();
    let t = Instant::now();
    let invitations: Vec<Value> = s.groupes.invitations(moi, t).into_iter().map(|de| fiche(&b, &s, de)).collect();
    let id = s.presence.connecter(moi, canal.clone());
    let etat = json!({
        "t": "etat",
        "moi": moi,
        "amis": liste_amis(&b, &s, moi),
        "groupe": groupe(&b, &s, moi),
        "invitations": invitations,
    });
    let _ = canal.send(etat.to_string());
    annoncer(&b, &s, moi);
    id
}

/// Une page se ferme. Rend vrai si le joueur n'a plus aucune page : ses
/// amis le voient hors ligne, et il a `GRACE` pour revenir avant de perdre
/// sa place dans son groupe (voir `grace`).
pub fn depart(moi: i64, id: u64) -> bool {
    let b = base::base();
    let mut s = social();
    let dernier = s.presence.deconnecter(moi, id);
    if dernier {
        annoncer(&b, &s, moi);
    }
    dernier
}

/// Apres le delai de grace, un joueur toujours absent quitte son groupe.
pub async fn grace(moi: i64) {
    tokio::time::sleep(GRACE).await;
    let b = base::base();
    let mut s = social();
    if s.presence.en_ligne(moi) {
        return;
    }
    let touches = s.groupes.quitter(moi);
    pousser_groupe(&b, &s, &touches);
}

// ------------------------------------------- appels du reste du site ---

/// Envoie un message a toutes les pages d'un joueur.
pub fn signaler(compte: i64, message: Value) {
    envoyer(&social(), compte, message);
}

/// La liste d'amis de `compte` a change : on la lui renvoie.
pub fn pousser_amis(compte: i64) {
    let b = base::base();
    let s = social();
    let amis = liste_amis(&b, &s, compte);
    envoyer(&s, compte, json!({ "t": "amis", "amis": amis }));
}

/// Le serveur de jeu assoit `compte` dans un salon, ou l'en fait sortir.
pub fn salon(compte: i64, code: Option<String>, prive: bool) {
    let b = base::base();
    let mut s = social();
    s.presence.salon(compte, code, prive);
    annoncer(&b, &s, compte);
}

/// Les autres membres du groupe de `compte`.
pub fn coequipiers(compte: i64) -> Vec<i64> {
    social().groupes.coequipiers(compte)
}

// ------------------------------------------------- messages recus ---

fn texte(v: &Value, cle: &str) -> String {
    v.get(cle).and_then(Value::as_str).unwrap_or("").to_string()
}

fn nombre(v: &Value, cle: &str) -> i64 {
    v.get(cle).and_then(Value::as_i64).unwrap_or(0)
}

/// Un message de la page de `moi`.
pub fn recevoir(moi: i64, brut: &str) {
    if brut.len() > 2048 {
        return;
    }
    let Ok(m) = serde_json::from_str::<Value>(brut) else { return };
    let b = base::base();
    let mut s = social();
    let t = Instant::now();
    let erreur = |s: &Social, texte: &str| envoyer(s, moi, json!({ "t": "erreur", "m": texte }));
    let nom = |c: &Connection, id: i64| joueurs::par_id(c, id).map(|j| j.pseudo).unwrap_or_default();

    match m.get("t").and_then(Value::as_str) {
        Some("lieu") => {
            s.presence.lieu(moi, &texte(&m, "lieu"));
            annoncer(&b, &s, moi);
        }
        Some("inviter") => {
            let a = nombre(&m, "a");
            if !amis::sont_amis(&b, moi, a) {
                return erreur(&s, "Tu n'invites que tes amis.");
            }
            if !s.presence.en_ligne(a) {
                return erreur(&s, &format!("{} n'est pas en ligne.", nom(&b, a)));
            }
            if let Err(e) = s.groupes.inviter(moi, a, t) {
                return erreur(&s, e);
            }
            envoyer(&s, a, json!({ "t": "invitation", "de": fiche(&b, &s, moi) }));
            envoyer(&s, moi, json!({ "t": "info", "m": format!("Invitation envoyée à {}.", nom(&b, a)) }));
        }
        Some("repondre") => {
            let de = nombre(&m, "de");
            if m.get("oui").and_then(Value::as_bool) != Some(true) {
                s.groupes.refuser(moi, de);
                envoyer(&s, de, json!({ "t": "info", "m": format!("{} a décliné ton invitation.", nom(&b, moi)) }));
                return;
            }
            match s.groupes.accepter(moi, de, t) {
                Ok(touches) => pousser_groupe(&b, &s, &touches),
                Err(e) => erreur(&s, e),
            }
        }
        Some("quitter") => {
            let touches = s.groupes.quitter(moi);
            pousser_groupe(&b, &s, &touches);
        }
        Some("exclure") => {
            let qui = nombre(&m, "qui");
            match s.groupes.exclure(moi, qui) {
                Ok(touches) => {
                    pousser_groupe(&b, &s, &touches);
                    envoyer(&s, qui, json!({ "t": "info", "m": "Tu as été exclu du groupe." }));
                }
                Err(e) => erreur(&s, e),
            }
        }
        Some("chef") => match s.groupes.passer_chef(moi, nombre(&m, "qui")) {
            Ok(touches) => pousser_groupe(&b, &s, &touches),
            Err(e) => erreur(&s, e),
        },
        // Le chef est entre dans un salon : le groupe le suit.
        Some("lancer") => {
            let code: String = texte(&m, "salon").chars().filter(char::is_ascii_digit).take(4).collect();
            if code.len() != 4 || !s.groupes.est_chef(moi) {
                return;
            }
            let chef = fiche(&b, &s, moi);
            for membre in s.groupes.coequipiers(moi) {
                envoyer(&s, membre, json!({ "t": "lancer", "salon": code, "chef": chef }));
            }
        }
        _ => {}
    }
}
