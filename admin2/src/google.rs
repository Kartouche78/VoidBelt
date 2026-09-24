//! Connexion avec Google, en OpenID Connect.
//!
//! 1. `/api/auth/google/connexion` : on prepare un `state` (contre la
//!    falsification), un `nonce` (contre le rejeu) et un verificateur PKCE
//!    (contre le vol du code), puis on envoie chez Google.
//! 2. Google renvoie sur `/api/auth/google/callback` avec un code a usage
//!    unique. Le serveur l'echange directement aupres de Google, avec le
//!    verificateur PKCE et le secret client, contre un jeton d'identite.
//! 3. Sa signature est verifiee contre les cles publiques de Google, ainsi
//!    que son emetteur, son destinataire, sa date et le `nonce`.
//! 4. Le compte est cree ou mis a jour, une session ouverte, et le
//!    navigateur renvoye d'ou il venait.
//!
//! Reglages, par variables d'environnement du serveur :
//!   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   l'« ID client OAuth » Google
//!   AUTH_URL      adresse publique de ce serveur (https://api.voidbelt.com)
//!   ADMIN_EMAILS  adresses qui recoivent le role admin

use crate::base::{base, maintenant};
use crate::comptes::{Identite, admins, connecter};
use crate::sessions;
use axum::{
    extract::{ConnectInfo, Query},
    http::{HeaderMap, StatusCode, header},
    response::{Html, IntoResponse, Response},
};
use openidconnect::{
    AuthorizationCode, ClientId, ClientSecret, CsrfToken, EndpointMaybeSet, EndpointNotSet, EndpointSet,
    IssuerUrl, Nonce, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, TokenResponse,
    core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata},
    reqwest,
};
use serde::Deserialize;
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex, OnceLock},
};

type Client = CoreClient<EndpointSet, EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointMaybeSet, EndpointMaybeSet>;

/// Temps laisse pour se connecter chez Google, en secondes.
const ATTENTE: i64 = 600;
/// Demandes de connexion par adresse IP et par fenetre de dix minutes.
const TENTATIVES: u32 = 30;

/// Adresse publique de ce serveur, sans barre finale.
pub fn url_publique() -> String {
    std::env::var("AUTH_URL")
        .unwrap_or_else(|_| "http://localhost:8080".into())
        .trim_end_matches('/')
        .to_string()
}

pub fn https() -> bool {
    url_publique().starts_with("https://")
}

/// Google est-il branche ? Sans ID client, la connexion est impossible.
pub fn configure() -> bool {
    std::env::var("GOOGLE_CLIENT_ID").is_ok_and(|v| !v.is_empty())
        && std::env::var("GOOGLE_CLIENT_SECRET").is_ok_and(|v| !v.is_empty())
}

/// Client HTTP sans redirections : en suivre ouvrirait la porte a des
/// requetes detournees vers le reseau interne.
fn http() -> reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::ClientBuilder::new()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("client HTTP")
    })
    .clone()
}

/// Client OpenID Connect, construit une fois depuis la configuration
/// publiee par Google. Refait si la premiere tentative a echoue.
async fn client() -> Result<Arc<Client>, String> {
    static CLIENT: Mutex<Option<Arc<Client>>> = Mutex::new(None);
    if let Some(c) = CLIENT.lock().unwrap_or_else(|e| e.into_inner()).clone() {
        return Ok(c);
    }
    let id = std::env::var("GOOGLE_CLIENT_ID").map_err(|_| "GOOGLE_CLIENT_ID manquant")?;
    let secret = std::env::var("GOOGLE_CLIENT_SECRET").map_err(|_| "GOOGLE_CLIENT_SECRET manquant")?;
    let emetteur = IssuerUrl::new("https://accounts.google.com".into()).map_err(|e| e.to_string())?;
    let meta = CoreProviderMetadata::discover_async(emetteur, &http())
        .await
        .map_err(|e| format!("Google injoignable : {e}"))?;
    let retour = RedirectUrl::new(format!("{}/api/auth/google/callback", url_publique())).map_err(|e| e.to_string())?;
    let c = Arc::new(
        CoreClient::from_provider_metadata(meta, ClientId::new(id), Some(ClientSecret::new(secret)))
            .set_redirect_uri(retour),
    );
    *CLIENT.lock().unwrap_or_else(|e| e.into_inner()) = Some(c.clone());
    Ok(c)
}

/// Connexion commencee, en attente du retour de Google.
struct Attente {
    verificateur: String,
    nonce: String,
    retour: String,
    expire: i64,
}

fn attentes() -> &'static Mutex<HashMap<String, Attente>> {
    static A: OnceLock<Mutex<HashMap<String, Attente>>> = OnceLock::new();
    A.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Faux quand une adresse IP a trop demande de connexions recemment.
fn autorise(ip: &str) -> bool {
    static COMPTES: OnceLock<Mutex<HashMap<String, (u32, i64)>>> = OnceLock::new();
    let mut m = COMPTES.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    let t = maintenant();
    m.retain(|_, (_, debut)| t - *debut < ATTENTE);
    let e = m.entry(ip.to_string()).or_insert((0, t));
    e.0 += 1;
    e.0 <= TENTATIVES
}

/// Adresse du visiteur. Derriere nginx, la vraie est dans `X-Real-IP`.
fn ip(headers: &HeaderMap, who: SocketAddr) -> String {
    headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .unwrap_or_else(|| who.ip().to_string())
}

/// Ou renvoyer apres la connexion. Seules nos propres pages sont admises :
/// une adresse libre ferait de la connexion un tremplin vers n'importe
/// quel site.
pub fn retour_sur(demande: Option<&str>) -> String {
    let defaut = format!("{}/rl2/admin/", url_publique());
    let Some(d) = demande else { return defaut };
    let mut sures = vec![
        url_publique(),
        "https://voidbelt.com".into(),
        "https://www.voidbelt.com".into(),
        "http://localhost:8080".into(),
        "http://127.0.0.1:8080".into(),
    ];
    sures.extend(std::env::var("AUTH_RETOURS").unwrap_or_default().split(',').map(|s| s.trim().to_string()));
    let ok = sures
        .iter()
        .filter(|s| !s.is_empty())
        .any(|s| d == s || d.starts_with(&format!("{s}/")) || d.starts_with(&format!("{s}?")) || d.starts_with(&format!("{s}#")));
    if ok && !d.contains(['\r', '\n']) { d.to_string() } else { defaut }
}

fn page(titre: &str, texte: &str, retour: &str) -> Response {
    let echappe = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;");
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>{t}</title>\
         <body style=\"font-family:system-ui;background:#070a0f;color:#e8edf4;display:grid;place-items:center;height:100vh;margin:0\">\
         <div style=\"max-width:460px;text-align:center\"><h1 style=\"font-size:20px\">{t}</h1><p style=\"color:#8294a8\">{x}</p>\
         <p><a style=\"color:#f07a25\" href=\"{r}\">Revenir</a></p></div>",
        t = echappe(titre),
        x = echappe(texte),
        r = echappe(retour),
    );
    (StatusCode::FORBIDDEN, Html(html)).into_response()
}

#[derive(Deserialize)]
pub struct DemandeConnexion {
    retour: Option<String>,
}

/// Etape 1 : envoie chez Google.
pub async fn connexion(
    headers: HeaderMap,
    ConnectInfo(who): ConnectInfo<SocketAddr>,
    Query(q): Query<DemandeConnexion>,
) -> Response {
    let retour = retour_sur(q.retour.as_deref());
    if !configure() {
        return page("Connexion indisponible", "La connexion Google n'est pas encore configuree sur ce serveur.", &retour);
    }
    if !autorise(&ip(&headers, who)) {
        return page("Trop de tentatives", "Patiente quelques minutes avant de reessayer.", &retour);
    }
    let client = match client().await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("connexion Google : {e}");
            return page("Connexion indisponible", "Google ne repond pas pour l'instant. Reessaie dans un moment.", &retour);
        }
    };
    let (defi, verificateur) = PkceCodeChallenge::new_random_sha256();
    let (url, state, nonce) = client
        .authorize_url(CoreAuthenticationFlow::AuthorizationCode, CsrfToken::new_random, Nonce::new_random)
        .add_scope(Scope::new("email".into()))
        .add_scope(Scope::new("profile".into()))
        .add_extra_param("prompt", "select_account")
        .set_pkce_challenge(defi)
        .url();
    {
        let mut a = attentes().lock().unwrap_or_else(|e| e.into_inner());
        let t = maintenant();
        a.retain(|_, x| x.expire > t);
        if a.len() > 1000 {
            return page("Trop de tentatives", "Trop de connexions en cours. Reessaie dans un moment.", &retour);
        }
        a.insert(
            state.secret().clone(),
            Attente { verificateur: verificateur.secret().clone(), nonce: nonce.secret().clone(), retour, expire: t + ATTENTE },
        );
    }
    (StatusCode::SEE_OTHER, [(header::LOCATION, url.to_string())]).into_response()
}

#[derive(Deserialize)]
pub struct RetourGoogle {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// Etape 2 : Google revient avec un code ; on verifie tout, puis on ouvre
/// la session.
pub async fn callback(headers: HeaderMap, Query(q): Query<RetourGoogle>) -> Response {
    let defaut = retour_sur(None);
    // Le `state` doit etre l'un des notres, et il ne sert qu'une fois.
    let attente = q
        .state
        .as_deref()
        .and_then(|s| attentes().lock().unwrap_or_else(|e| e.into_inner()).remove(s))
        .filter(|a| a.expire > maintenant());
    let Some(attente) = attente else {
        return page("Connexion refusee", "Cette demande de connexion est inconnue ou a expire. Recommence depuis l'admin.", &defaut);
    };
    if let Some(e) = q.error {
        let texte = if e == "access_denied" { "Connexion annulee." } else { "Google a refuse la connexion." };
        return page("Connexion interrompue", texte, &attente.retour);
    }
    let Some(code) = q.code else {
        return page("Connexion refusee", "Google n'a pas rendu de code.", &attente.retour);
    };
    let identite = match verifier(code, &attente).await {
        Ok(i) => i,
        Err(e) => {
            tracing::warn!("connexion Google refusee : {e}");
            return page("Connexion refusee", "L'identite rendue par Google n'a pas pu etre verifiee.", &attente.retour);
        }
    };
    let agent = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let ouverte = {
        let c = base();
        connecter(&c, &identite, &admins()).and_then(|compte| sessions::ouvrir(&c, compte.id, &agent).map(|j| (compte, j)))
    };
    match ouverte {
        Ok((compte, jeton)) => {
            tracing::info!("connexion : compte {} ({})", compte.id, compte.role);
            (
                StatusCode::SEE_OTHER,
                [(header::LOCATION, attente.retour), (header::SET_COOKIE, sessions::cookie(Some(&jeton), https()))],
            )
                .into_response()
        }
        Err(e) => {
            tracing::warn!("connexion : base indisponible : {e}");
            page("Connexion impossible", "Le serveur n'a pas pu ouvrir la session.", &attente.retour)
        }
    }
}

/// Echange le code et verifie le jeton d'identite.
async fn verifier(code: String, a: &Attente) -> Result<Identite, String> {
    let client = client().await?;
    let reponse = client
        .exchange_code(AuthorizationCode::new(code))
        .map_err(|e| e.to_string())?
        .set_pkce_verifier(PkceCodeVerifier::new(a.verificateur.clone()))
        .request_async(&http())
        .await
        .map_err(|e| format!("echange du code : {e}"))?;
    let jeton = reponse.id_token().ok_or("pas de jeton d'identite")?;
    let claims = jeton
        .claims(&client.id_token_verifier(), &Nonce::new(a.nonce.clone()))
        .map_err(|e| format!("jeton invalide : {e}"))?;
    Ok(Identite {
        sub: claims.subject().to_string(),
        email: claims.email().map(|e| e.to_string()).ok_or("pas d'adresse e-mail")?,
        email_verifie: claims.email_verified().unwrap_or(false),
        nom: claims.name().and_then(|n| n.get(None)).map(|n| n.to_string()).unwrap_or_default(),
        avatar: claims.picture().and_then(|p| p.get(None)).map(|p| p.to_string()).unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::retour_sur;

    #[test]
    fn seules_nos_pages_servent_de_retour() {
        assert_eq!(retour_sur(Some("https://voidbelt.com/rl2/admin/#arenes")), "https://voidbelt.com/rl2/admin/#arenes");
        assert_eq!(retour_sur(Some("http://localhost:8080/rl2/admin/")), "http://localhost:8080/rl2/admin/");
        let defaut = retour_sur(None);
        for piege in [
            "https://evil.com/",
            "https://voidbelt.com.evil.com/",
            "https://voidbelt.comx/",
            "javascript:alert(1)",
            "//evil.com",
            "https://voidbelt.com/\r\nSet-Cookie: x=1",
        ] {
            assert_eq!(retour_sur(Some(piege)), defaut, "{piege} accepte comme retour");
        }
    }
}
