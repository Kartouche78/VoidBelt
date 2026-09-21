//! Interface WebAssembly du jeu.
//!
//! Aucun binding genere : le module exporte des fonctions `extern "C"` et
//! l'hote lit la memoire lineaire aux pointeurs renvoyes, comme le reste
//! des modules Rust du site.

// Modules publics : le serveur du site reutilise ce meme moteur pour
// arbitrer les parties en ligne, il ne s'agit pas que d'une cible wasm.
pub mod arena;
pub mod ball;
pub mod boost;
pub mod bot;
pub mod car;
pub mod collide;
pub mod game;
pub mod pads;
pub mod state;
#[cfg(test)]
mod tests;
pub mod vec;

use car::Input;
use game::Game;

struct Ctx {
    game: Game,
    state: Vec<f32>,
    events: Vec<f32>,
    table: Vec<f32>,
    geom: Vec<f32>,
    seed: u32,
    level: u32,
    duration: f32,
}

static mut CTX: Option<Ctx> = None;

fn ctx() -> &'static mut Ctx {
    unsafe {
        let p = std::ptr::addr_of_mut!(CTX);
        (*p).as_mut().expect("rl_new doit etre appele d'abord")
    }
}

// ------------------------------------------------------------ memoire -----

#[no_mangle]
pub extern "C" fn alloc(len: u32) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(len as usize);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, len: u32) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        let _ = Vec::from_raw_parts(ptr, 0, len as usize);
    }
}

// -------------------------------------------------------------- cycle -----

/// `level` : 0 debutant, 1 confirme, 2 impitoyable. `duration` en secondes.
#[no_mangle]
pub extern "C" fn rl_new(seed: u32, level: u32, duration: f32) {
    let c = Ctx {
        game: Game::new(seed, level, duration),
        state: vec![0.0; state::STATE_LEN],
        events: Vec::with_capacity(64),
        table: state::pad_table(),
        geom: state::geometry(),
        seed,
        level,
        duration,
    };
    unsafe {
        let p = std::ptr::addr_of_mut!(CTX);
        *p = Some(c);
    }
}

/// Rejoue un match avec les memes reglages mais une graine differente.
#[no_mangle]
pub extern "C" fn rl_restart(seed: u32) {
    let c = ctx();
    c.seed = seed;
    c.game = Game::new(seed, c.level, c.duration);
}

#[no_mangle]
pub extern "C" fn rl_set_bot(on: u32) {
    ctx().game.bot_on = on != 0;
}

#[no_mangle]
pub extern "C" fn rl_input(idx: u32, throttle: f32, brake: f32, steer: f32, boost: u32, drift: u32) {
    ctx().game.set_input(
        idx as usize,
        Input {
            throttle: throttle.clamp(0.0, 1.0),
            brake: brake.clamp(0.0, 1.0),
            steer: steer.clamp(-1.0, 1.0),
            boost: boost != 0,
            drift: drift != 0,
        },
    );
}

#[no_mangle]
pub extern "C" fn rl_step(dt: f32) {
    let c = ctx();
    c.game.step(dt);
    state::write_state(&c.game, &mut c.state);
    state::write_events(&c.game, &mut c.events);
}

// -------------------------------------------------------------- sorties ---

#[no_mangle]
pub extern "C" fn rl_state_ptr() -> *const f32 {
    ctx().state.as_ptr()
}

#[no_mangle]
pub extern "C" fn rl_state_len() -> u32 {
    state::STATE_LEN as u32
}

#[no_mangle]
pub extern "C" fn rl_events_ptr() -> *const f32 {
    ctx().events.as_ptr()
}

#[no_mangle]
pub extern "C" fn rl_events_len() -> u32 {
    ctx().events.len() as u32
}

#[no_mangle]
pub extern "C" fn rl_pads_ptr() -> *const f32 {
    ctx().table.as_ptr()
}

#[no_mangle]
pub extern "C" fn rl_pads_len() -> u32 {
    ctx().table.len() as u32
}

/// Constantes de terrain : le rendu les lit une fois au demarrage plutot
/// que de les redeclarer cote JavaScript.
#[no_mangle]
pub extern "C" fn rl_geometry_ptr() -> *const f32 {
    ctx().geom.as_ptr()
}

#[no_mangle]
pub extern "C" fn rl_geometry_len() -> u32 {
    ctx().geom.len() as u32
}
