//! Orientation de la balle : un quaternion, et rien de plus que ce qu'il
//! faut pour la faire rouler.
//!
//! Elle vit ici plutot que dans le rendu pour deux raisons. La premiere est
//! qu'une rotation ne se deduit pas d'un instant : elle s'accumule, donc
//! c'est un etat, et l'etat appartient au moteur. La seconde est le jeu en
//! ligne — deux navigateurs qui integrent chacun de leur cote, avec leur
//! propre cadence, verraient la balle tourner differemment.
//!
//! Le repere est celui du dessin : x vers la droite, y vers le haut, z vers
//! l'observateur. L'ordonnee du moteur, elle, descend ; la conversion se
//! fait en posant l'axe, une bonne fois, dans `Ball::step`.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quat {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

impl Quat {
    pub const IDENTITE: Quat = Quat { x: 0.0, y: 0.0, z: 0.0, w: 1.0 };

    /// Rotation de `angle` radians autour d'un axe, normalise au passage.
    pub fn autour(x: f32, y: f32, z: f32, angle: f32) -> Quat {
        let n = (x * x + y * y + z * z).sqrt();
        if n < 1e-9 {
            return Quat::IDENTITE;
        }
        let (s, c) = (angle * 0.5).sin_cos();
        Quat { x: x / n * s, y: y / n * s, z: z / n * s, w: c }
    }

    /// `self` puis `o` : la rotation de droite s'applique en premier.
    pub fn mul(self, o: Quat) -> Quat {
        Quat {
            x: self.w * o.x + self.x * o.w + self.y * o.z - self.z * o.y,
            y: self.w * o.y - self.x * o.z + self.y * o.w + self.z * o.x,
            z: self.w * o.z + self.x * o.y - self.y * o.x + self.z * o.w,
            w: self.w * o.w - self.x * o.x - self.y * o.y - self.z * o.z,
        }
    }

    /// Remet a l'unite. A rappeler regulierement : quelques milliers de
    /// produits accumules et la rotation se met a etirer ce qu'elle tourne.
    pub fn norm(self) -> Quat {
        let n = (self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w).sqrt();
        if n < 1e-9 {
            return Quat::IDENTITE;
        }
        Quat { x: self.x / n, y: self.y / n, z: self.z / n, w: self.w / n }
    }
}

impl Default for Quat {
    fn default() -> Quat {
        Quat::IDENTITE
    }
}
