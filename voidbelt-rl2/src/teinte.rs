//! Peinture des voitures : le blanc de carrosserie prend une couleur.
//!
//! Les voitures sont dessinees blanches ; en jeu, elles portent la couleur
//! de leur equipe (bleu a gauche, orange a droite) ou celle de leur clan.
//! Seuls les pixels clairs et sans teinte propre (la peinture blanche et
//! ses ombres grises) changent : vitres, pneus, feux, bandes creme et
//! details sombres restent tels quels. La couleur est multipliee par la
//! luminosite d'origine, pour garder le modele ; les reflets les plus vifs
//! restent blancs, sans quoi la carrosserie deviendrait mate.

fn borne(x: f32) -> f32 {
    x.clamp(0.0, 1.0)
}

/// Part de « peinture blanche » d'un pixel, de 0 a 1 : claire, et sans
/// couleur propre.
pub fn part_blanche(r: u8, g: u8, b: u8) -> f32 {
    let (r, g, b) = (r as f32, g as f32, b as f32);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let lum = 0.299 * r + 0.587 * g + 0.114 * b;
    let sat = if max > 0.0 { (max - min) / max } else { 0.0 };
    // Le blanc de carrosserie est a moins de 0,03 de saturation ; les
    // bandes creme, a 0,09 et plus.
    borne((lum - 105.0) / 45.0) * borne((0.07 - sat) / 0.03)
}

/// Repeint en place une image RGBA : le blanc de carrosserie passe a la
/// couleur `(cr, cg, cb)`.
pub fn teinter(px: &mut [u8], cr: u8, cg: u8, cb: u8) {
    let couleur = [cr as f32, cg as f32, cb as f32];
    for p in px.chunks_exact_mut(4) {
        if p[3] == 0 {
            continue;
        }
        let part = part_blanche(p[0], p[1], p[2]);
        if part <= 0.0 {
            continue;
        }
        let lum = 0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32;
        // La couleur prend l'ombre du blanc ; les reflets vifs blanchissent.
        let k = lum / 225.0;
        let reflet = borne((lum - 236.0) / 18.0) * 0.7;
        for i in 0..3 {
            let cible = (couleur[i] * k * (1.0 - reflet) + 255.0 * reflet).min(255.0);
            let v = p[i] as f32;
            p[i] = (v + (cible - v) * part).round().clamp(0.0, 255.0) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn un(r: u8, g: u8, b: u8, a: u8) -> [u8; 4] {
        let mut p = [r, g, b, a];
        teinter(&mut p, 47, 124, 224);
        p
    }

    #[test]
    fn le_blanc_prend_la_couleur() {
        let p = un(225, 225, 225, 255);
        assert_eq!(&p[..3], &[47, 124, 224]);
    }

    #[test]
    fn l_ombre_du_blanc_reste_une_ombre() {
        let clair = un(225, 225, 225, 255);
        let ombre = un(160, 160, 160, 255);
        assert!(ombre[2] < clair[2] && ombre[2] > 100, "{ombre:?}");
    }

    #[test]
    fn les_details_ne_bougent_pas() {
        // Pneu, vitre sombre, feu rouge, bande creme, pixel transparent.
        assert_eq!(un(30, 30, 32, 255), [30, 30, 32, 255]);
        assert_eq!(un(70, 80, 90, 255), [70, 80, 90, 255]);
        assert_eq!(un(200, 30, 40, 255), [200, 30, 40, 255]);
        assert_eq!(un(236, 222, 190, 255), [236, 222, 190, 255]);
        // Les bandes creme de `car_white.png`, relevees sur l'image.
        assert_eq!(un(246, 237, 215, 252), [246, 237, 215, 252]);
        assert_eq!(un(241, 233, 218, 253), [241, 233, 218, 253]);
        assert_eq!(un(255, 255, 255, 0), [255, 255, 255, 0]);
    }

    #[test]
    fn les_reflets_vifs_restent_clairs() {
        let p = un(255, 255, 255, 255);
        assert!(p[0] > 150, "le reflet est devenu mat : {p:?}");
    }
}
