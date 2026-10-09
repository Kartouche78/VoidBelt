//! Skid Mania : course contre la montre sur une piste en l'air, conduite
//! facon Stadium Car de Trackmania (voir README-CONDUITE.md).
//!
//! Aucun binding genere : le module exporte des fonctions `extern "C"` et
//! l'hote lit la memoire lineaire aux pointeurs renvoyes, comme le reste
//! des modules Rust du site. Le JavaScript ne fait que lire les entrees et
//! dessiner.

pub mod boite;
pub mod camera;
pub mod car;
pub mod classique;
pub mod game;
pub mod mur;
pub mod state;
pub mod surface;
pub mod suspension;
#[cfg(test)]
mod tests;
pub mod trace;
pub mod track;
pub mod track_check;
pub mod tune;
pub mod vec;
pub mod vol;

use car::Input;
use game::Game;
use track::Track;

struct Ctx {
    game: Game,
    state: Vec<f32>,
    events: Vec<f32>,
    scratch: Vec<f32>,
    keys: String,
}

static mut CTX: Option<Ctx> = None;

fn ctx() -> &'static mut Ctx {
    unsafe {
        let p = std::ptr::addr_of_mut!(CTX);
        (*p).as_mut().expect("sm_new doit etre appele d'abord")
    }
}

/// Construit la piste et place la voiture sur la grille.
#[no_mangle]
pub extern "C" fn sm_new() {
    let c = Ctx {
        game: Game::new(Track::build()),
        state: vec![0.0; state::LEN],
        events: vec![],
        scratch: vec![0.0; 12],
        keys: tune::keys_blob(),
    };
    unsafe { *std::ptr::addr_of_mut!(CTX) = Some(c) };
}

/// Entrees du joueur ; `steer` positif = droite.
#[no_mangle]
pub extern "C" fn sm_input(throttle: f32, brake: f32, steer: f32, handbrake: u32, boost: u32, look_back: u32) {
    ctx().game.input = Input {
        throttle: throttle.clamp(0.0, 1.0),
        brake: brake.clamp(0.0, 1.0),
        steer: steer.clamp(-1.0, 1.0),
        handbrake: handbrake != 0,
        boost: boost != 0,
        look_back: look_back != 0,
    };
}

/// Avance d'une image (secondes) et remplit l'etat et les evenements.
/// La physique avance a pas fixe ; la camera tourne ensuite sur la pose
/// interpolee de cette image. Renvoie le nombre d'evenements.
#[no_mangle]
pub extern "C" fn sm_step(dt: f32) -> u32 {
    let c = ctx();
    let alpha = c.game.advance(dt);
    let g = &mut c.game;
    let p = g.pose(alpha);
    g.cam.update(dt.clamp(0.0, 0.1), &p, g.input.look_back, &g.tune, &g.track);
    state::write(g, &p, &g.cam, &mut c.state);
    state::events(&c.game.events, &mut c.events);
    let n = c.game.events.len() as u32;
    c.game.events.clear();
    n
}

#[no_mangle]
pub extern "C" fn sm_state() -> *const f32 {
    ctx().state.as_ptr()
}

#[no_mangle]
pub extern "C" fn sm_events() -> *const f32 {
    ctx().events.as_ptr()
}

#[no_mangle]
pub extern "C" fn sm_respawn() {
    ctx().game.respawn();
}

/// Moteur choisi (recette de la Creation) : la boite s'y adapte.
#[no_mangle]
pub extern "C" fn sm_engine(ralenti: f32, zone_rouge: f32, rapports: u32, passage: f32, temps_passage: f32, reactivite: f32) {
    let g = &mut ctx().game;
    let ralenti = ralenti.clamp(400.0, 6000.0);
    let m = boite::Moteur {
        ralenti,
        zone_rouge: zone_rouge.clamp(ralenti + 1000.0, 22000.0),
        rapports: rapports.clamp(1, 9),
        passage: passage.clamp(0.6, 0.99),
        temps_passage: temps_passage.clamp(0.03, 0.5),
        reactivite: reactivite.clamp(0.0, 1.0),
    };
    let v = boite::vitesse_de_pointe(&g.tune);
    g.boite.regler(m, v);
}

/// Gameplay : 0 Stadium Car (defaut), 1 classique (celui d'avant la refonte).
#[no_mangle]
pub extern "C" fn sm_gameplay(n: u32) {
    ctx().game.classique = n == 1;
}

/// Mode de camera : 0 exterieure proche, 1 haute et eloignee, 2 embarquee.
#[no_mangle]
pub extern "C" fn sm_camera_mode(mode: u32) {
    ctx().game.cam.mode = mode.min(camera::EMBARQUEE);
}

/// Noms des reglages, separes par des sauts de ligne (`sm_tuning_keys_len`
/// octets).
#[no_mangle]
pub extern "C" fn sm_tuning_keys() -> *const u8 {
    ctx().keys.as_ptr()
}

#[no_mangle]
pub extern "C" fn sm_tuning_keys_len() -> u32 {
    ctx().keys.len() as u32
}

/// Trous du trace : nombre, puis debut (`fin` = 0) ou fin (`fin` = 1).
#[no_mangle]
pub extern "C" fn sm_gap_count() -> u32 {
    ctx().game.track.trous.len() as u32
}

#[no_mangle]
pub extern "C" fn sm_gap(i: u32, fin: u32) -> f32 {
    ctx().game.track.trous.get(i as usize).map(|t| if fin != 0 { t.1 } else { t.0 }).unwrap_or(0.0)
}

/// Debogage, depuis la console : `skidmania.engine.seek(1380)`.
#[no_mangle]
pub extern "C" fn sm_seek(s: f32, speed: f32) {
    ctx().game.seek(s, speed);
}

#[no_mangle]
pub extern "C" fn sm_restart() {
    ctx().game.restart();
}

/// Les reglages de conduite, modifiables en place (voir `tune.rs`).
#[no_mangle]
pub extern "C" fn sm_tuning() -> *mut f32 {
    &mut ctx().game.tune as *mut tune::Tuning as *mut f32
}

#[no_mangle]
pub extern "C" fn sm_tuning_len() -> u32 {
    tune::COUNT as u32
}

/// Repere de la piste a l'abscisse `s` : p, t, r, u (12 floats).
#[no_mangle]
pub extern "C" fn sm_frame(s: f32) -> *const f32 {
    let c = ctx();
    let f = c.game.track.frame_at(s);
    for (i, v) in [f.p, f.t, f.r, f.u].iter().enumerate() {
        c.scratch[i * 3] = v.x;
        c.scratch[i * 3 + 1] = v.y;
        c.scratch[i * 3 + 2] = v.z;
    }
    c.scratch.as_ptr()
}

#[no_mangle]
pub extern "C" fn sm_track_len() -> f32 {
    ctx().game.track.len
}

#[no_mangle]
pub extern "C" fn sm_start_line() -> f32 {
    ctx().game.track.start_line
}

#[no_mangle]
pub extern "C" fn sm_checkpoint_count() -> u32 {
    ctx().game.track.checkpoints.len() as u32
}

#[no_mangle]
pub extern "C" fn sm_checkpoint(i: u32) -> f32 {
    ctx().game.track.checkpoints.get(i as usize).copied().unwrap_or(0.0)
}
