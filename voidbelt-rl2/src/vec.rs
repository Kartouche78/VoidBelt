//! Un vecteur 2D minimal : le terrain est vu de dessus, tout tient en x/y.

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct V2 {
    pub x: f32,
    pub y: f32,
}

pub const fn v2(x: f32, y: f32) -> V2 {
    V2 { x, y }
}

impl V2 {
    pub const ZERO: V2 = v2(0.0, 0.0);

    /// Vecteur unitaire pointant dans la direction `a` (radians).
    pub fn dir(a: f32) -> V2 {
        v2(a.cos(), a.sin())
    }

    pub fn add(self, o: V2) -> V2 {
        v2(self.x + o.x, self.y + o.y)
    }

    pub fn sub(self, o: V2) -> V2 {
        v2(self.x - o.x, self.y - o.y)
    }

    pub fn mul(self, k: f32) -> V2 {
        v2(self.x * k, self.y * k)
    }

    pub fn dot(self, o: V2) -> f32 {
        self.x * o.x + self.y * o.y
    }

    /// Le vecteur tourne d'un quart de tour : sert de repere lateral.
    pub fn perp(self) -> V2 {
        v2(-self.y, self.x)
    }

    pub fn len(self) -> f32 {
        self.dot(self).sqrt()
    }

    pub fn angle(self) -> f32 {
        self.y.atan2(self.x)
    }

    /// Renvoie `ZERO` plutot que des `NaN` quand la longueur est nulle.
    pub fn norm(self) -> V2 {
        let l = self.len();
        if l > 1e-6 {
            self.mul(1.0 / l)
        } else {
            V2::ZERO
        }
    }

    /// Raccourcit le vecteur s'il depasse `max`, sans jamais l'allonger.
    pub fn clamp_len(self, max: f32) -> V2 {
        let l = self.len();
        if l > max && l > 1e-6 {
            self.mul(max / l)
        } else {
            self
        }
    }
}

/// Ramene un ecart d'angle dans `-PI..PI`, seule forme exploitable par un
/// correcteur proportionnel : sans ca le bot fait le tour du cadran.
pub fn wrap_angle(a: f32) -> f32 {
    let tau = std::f32::consts::TAU;
    let mut r = a % tau;
    if r > std::f32::consts::PI {
        r -= tau;
    } else if r < -std::f32::consts::PI {
        r += tau;
    }
    r
}
