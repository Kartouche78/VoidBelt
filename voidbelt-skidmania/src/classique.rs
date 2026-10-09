//! Le gameplay « classique » (touche F1) : la conduite d'avant la refonte
//! Stadium Car du 2026-10-09, remise telle quelle a la demande du joueur.
//!
//! Modele PeakDrive accelere trois fois : un point avec un cap, la vitesse
//! laterale rongee exponentiellement par le grip, un drift qui apparait
//! quand la glisse depasse un seuil (hysteresis), plafond de 600 km/h, pas
//! de gravite le long de la piste. Les murets retirent la vitesse sortante
//! avec un leger rebond et coutent jusqu'a 45 % de la vitesse.
//!
//! Il partage la voiture, la piste, le vol, la boite et la camera du jeu ;
//! seuls la conduite au sol et les murets changent.

use crate::car::{Car, CarEvent, Input, PLAFOND};
use crate::vec::clamp;

/// Les reglages de cette nuit-la (PeakDrive x3).
pub struct Reglages {
    pub max_speed: f32,
    pub accel: f32,
    pub brake: f32,
    pub reverse_max: f32,
    pub rolling: f32,
    pub max_yaw: f32,
    pub steer_in: f32,
    pub steer_out: f32,
    pub grip: f32,
    pub drift_grip: f32,
    pub handbrake_grip: f32,
    pub slip_enter: f32,
    pub slip_exit: f32,
    pub drift_keep: f32,
    pub align_assist: f32,
    pub drift_min_angle: f32,
    pub drift_min_speed: f32,
    pub drift_fill: f32,
    pub boost_drain: f32,
    pub boost_accel: f32,
    pub boost_speed: f32,
    pub grip_speed_loss: f32,
    pub drift_drag: f32,
    pub slide_boost: f32,
    pub wall_friction: f32,
}

const X: f32 = 3.0;

pub const REGLAGES: Reglages = Reglages {
    max_speed: 100.0 * X,
    accel: 60.0 * X,
    brake: 52.0 * X,
    reverse_max: 12.0,
    rolling: 0.12,
    max_yaw: 2.3,
    steer_in: 7.0,
    steer_out: 11.0,
    grip: 9.0,
    drift_grip: 2.4,
    handbrake_grip: 0.9,
    slip_enter: 6.5 * X,
    slip_exit: 3.2 * X,
    drift_keep: 0.25,
    align_assist: 2.3,
    drift_min_angle: 0.2,
    drift_min_speed: 15.0 * X,
    drift_fill: 4.5,
    boost_drain: 2.2,
    boost_accel: 38.0 * X,
    boost_speed: 16.0 * X,
    grip_speed_loss: 0.45,
    drift_drag: 1.8,
    slide_boost: 9.0 * X,
    wall_friction: 2.0,
};

/// `Math.sign` : zero reste zero.
fn sign(v: f32) -> f32 {
    if v > 0.0 {
        1.0
    } else if v < 0.0 {
        -1.0
    } else {
        0.0
    }
}

/// Un pas de conduite au sol, modele classique.
pub fn pas(c: &mut Car, dt: f32, input: Input, t: &Reglages) {
    let speed0 = c.speed;
    // lissage du volant
    let rate = if input.steer.abs() > c.steer.abs() { t.steer_in } else { t.steer_out };
    c.steer += clamp(input.steer - c.steer, -rate * dt, rate * dt);

    // --- cap ---------------------------------------------------------------
    {
        let (fx, fz) = (c.yaw.sin(), c.yaw.cos());
        let (rx, rz) = (c.yaw.cos(), -c.yaw.sin());
        let vf = c.vx * fx + c.vz * fz;
        let vl = c.vx * rx + c.vz * rz;
        let spd = c.vx.hypot(c.vz);
        let dir = if vf >= -0.5 { 1.0 } else { -1.0 };
        let mut yaw_rate = c.steer
            * clamp(spd / 8.0, 0.0, 1.0)
            * dir
            * t.max_yaw
            * (1.0 - 0.4 * clamp(spd / t.max_speed, 0.0, 1.0));
        if c.sliding {
            yaw_rate *= 1.3;
        }
        if input.handbrake {
            yaw_rate *= 1.5;
        }
        if c.sliding && spd > 6.0 && vf > 0.0 {
            yaw_rate += vl.atan2(vf) * t.align_assist;
        }
        c.yaw_rate = yaw_rate;
        c.yaw += yaw_rate * dt;
    }

    // --- vitesse dans le nouveau repere --------------------------------------
    let (fx, fz) = (c.yaw.sin(), c.yaw.cos());
    let (rx, rz) = (c.yaw.cos(), -c.yaw.sin());
    let mut vf = c.vx * fx + c.vz * fz;
    let mut vl = c.vx * rx + c.vz * rz;

    // decrocher / raccrocher
    if input.handbrake && vf.hypot(vl) > 10.0 {
        c.sliding = true;
    } else if !c.sliding && vl.abs() > t.slip_enter {
        c.sliding = true;
    } else if c.sliding && !input.handbrake && vl.abs() < t.slip_exit {
        c.sliding = false;
    }

    // longitudinal
    let boosting = input.boost && c.boost > 0.0;
    if boosting && !c.boosting {
        c.events.push(CarEvent::Boost);
    }
    c.boosting = boosting;
    let max_sp = t.max_speed + if boosting { t.boost_speed } else { 0.0 };
    let mut a = 0.0;
    if input.throttle > 0.0 {
        a += if vf < -1.0 {
            t.brake * input.throttle
        } else {
            t.accel * input.throttle * (1.0 - clamp(vf / max_sp, 0.0, 1.0))
        };
    }
    if input.brake > 0.0 {
        a += if vf > 1.0 {
            -t.brake * input.brake
        } else {
            -t.accel * 0.5 * input.brake * (1.0 - clamp(-vf / t.reverse_max, 0.0, 1.0))
        };
    }
    if boosting {
        a += t.boost_accel;
        c.boost = (c.boost - dt / t.boost_drain).max(0.0);
    }
    a -= vf * t.rolling;
    if input.handbrake {
        a -= sign(vf) * 5.0;
    }
    vf += a * dt;
    if vf > max_sp {
        vf -= (vf - max_sp) * (3.0 * dt).min(1.0);
    }

    // adherence laterale ; le grip fond avec la vitesse
    let haut = clamp(vf.hypot(vl) / t.max_speed, 0.0, 1.0);
    let g = if input.handbrake {
        t.handbrake_grip
    } else if c.sliding {
        t.drift_grip
    } else {
        t.grip * (1.0 - t.grip_speed_loss * haut)
    };
    let vl_before = vl;
    vl *= (-g * dt).exp();
    c.speedslide = false;
    if c.sliding && !input.handbrake && vf > 0.0 {
        vf += (vl_before - vl).abs() * t.drift_keep;
        // trainee du drift : sin^2 de l'angle
        let a = vl.atan2(vf);
        let s = a.sin();
        vf -= vf * t.drift_drag * s * s * dt;
        // speedslide : fenetre etroite autour de 7 degres, a fond et vite
        let a = a.abs();
        let fenetre = clamp(1.0 - (a - 0.12).abs() / 0.07, 0.0, 1.0);
        if fenetre > 0.0 && input.throttle > 0.9 && vf > t.max_speed * 0.4 && t.slide_boost > 0.0 {
            vf += t.slide_boost * fenetre * dt;
            c.speedslide = true;
        }
    }

    let v = vf.hypot(vl);
    if v > PLAFOND {
        vf *= PLAFOND / v;
        vl *= PLAFOND / v;
    }

    c.vx = fx * vf + rx * vl;
    c.vz = fz * vf + rz * vl;
    c.x += c.vx * dt;
    c.z += c.vz * dt;

    c.vf = vf;
    c.vl = vl;
    c.speed = c.vx.hypot(c.vz);
    c.accel = (c.speed - speed0) / dt;
    c.slip = if vf > 0.5 { vl.atan2(vf) } else { 0.0 };
    c.penalite = 0.0;

    // drift : points et jauge de boost
    let drifting = c.sliding && c.slip.abs() > t.drift_min_angle && c.speed > t.drift_min_speed;
    if drifting {
        c.drift_end_timer = 0.0;
        let a = c.slip.abs();
        c.boost = (c.boost + dt * clamp(a / 0.5, 0.5, 1.5) / t.drift_fill).min(1.0);
        c.drift_points += c.speed * a * dt * 3.0;
    } else if c.drift_points > 0.0 {
        c.drift_end_timer += dt;
        if c.drift_end_timer > 0.25 {
            let pts = c.drift_points.round() as u32;
            if pts > 0 {
                c.score += pts;
                c.events.push(CarEvent::Bank(pts));
            }
            c.drift_points = 0.0;
            c.drift_end_timer = 0.0;
        }
    }
    c.drifting = drifting;
}

/// Murets classiques : vitesse sortante retiree avec un leger rebond,
/// frottement, et jusqu'a 45 % de perte sur un choc franc. Renvoie la vitesse
/// d'impact si c'est un vrai choc.
pub fn murs(c: &mut Car, dt: f32, wall: f32, t: &Reglages) -> (f32, Option<f32>) {
    if c.x.abs() <= wall {
        return (0.0, None);
    }
    let side = c.x.signum();
    c.x = wall * side;
    let out = c.vx * side;
    c.vz *= (-t.wall_friction * dt).exp();
    let mut choc = None;
    if out > 0.0 {
        c.vx -= out * 1.2 * side;
        if out > 2.0 {
            let v = c.vx.hypot(c.vz).max(1.0);
            let perte = (out / v * 1.2).min(0.45) * (t.wall_friction / 2.0).min(1.0);
            c.vz *= 1.0 - perte;
            c.cancel_drift();
            choc = Some(out);
        }
    }
    c.speed = c.vx.hypot(c.vz);
    (out.max(0.0), choc)
}
