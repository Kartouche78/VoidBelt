//! Le deroulement d'un match : engagement, jeu, but, fin et prolongation.

use crate::arena;
use crate::ball::Ball;
use crate::boost::Field;
use crate::bot::Bot;
use crate::car::{Car, Input};
use crate::score::{self, Scoring};
use crate::tune::Tune;
use crate::collide;

/// Nombre de voitures d'un match solo. En ligne, le salon en decide : le
/// moteur n'impose aucune limite, chaque camp s'etale a l'engagement.
pub const CARS: usize = 2;
// Cales sur les pistes de l'habillage, mesurees et non estimees.
// `countdown.mp3` tient une seconde de silence puis frappe a 1, 2, 3 et
// 4 secondes : d'ou quatre secondes de decompte, la premiere sans chiffre
// affiche, et le depart qui tombe pile sur le dernier temps. La plus
// longue des prises de but dure 5,5 s ; la fete en couvre 4,6 et la queue
// deborde sur le silence d'entree du decompte, sans se marcher dessus.
pub const COUNTDOWN: f32 = 4.0;
/// Avance muette et sans chiffre en tete du decompte : `countdown.mp3`
/// garde une seconde de silence avant son premier chiffre.
pub const COUNTDOWN_LEAD: f32 = 1.0;
/// Laisse la place aux commentaires de but, dont le plus long tient
/// l'essentiel de son souffle sur ses quatre premieres secondes.
pub const CELEBRATE: f32 = 4.6;
/// Pas d'integration fixe : la physique reste identique quel que soit
/// le taux de rafraichissement de l'ecran.
pub const STEP: f32 = 1.0 / 120.0;
/// Distance au but en deca de laquelle une frappe degagee compte comme un
/// arret. Plus loin, c'est du jeu ordinaire.
pub const SAVE_RANGE: f32 = 400.0;
/// Temps qu'une voiture doit passer loin de la balle pour qu'un nouveau
/// contact refasse le bruit du choc. Une balle poussee contre un mur, ou
/// portee en dribble, touche la voiture a chaque image, et ses rebonds
/// contre la paroi la decollent une fraction de seconde : sans cette marge
/// le choc repartait en boucle tout le long du frottement.
pub const DECOLLE: f32 = 0.15;
/// Ecart a la paroi en deca duquel la balle compte encore comme collee au
/// mur. Poussee le long d'un muret, elle en rebondit de quelques unites.
pub const FROLE: f32 = 6.0;
/// Repos entre deux arrets ou degagements d'une meme voiture, en
/// secondes : une meme parade, reprise en plusieurs touches, compte une fois.
pub const REPOS_ACTION: f32 = 2.0;
/// Repos entre deux tirs d'une meme voiture : une balle coincee ralentit
/// une fraction de seconde, puis repart vers le but sous la meme poussee.
pub const REPOS_TIR: f32 = 1.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Phase {
    Countdown,
    Play,
    Goal,
    Over,
    /// Salon d'attente jouable : tout roule, mais ni chrono ni score. Les
    /// joueurs s'echauffent en attendant que l'hote lance la partie.
    Warmup,
}

pub mod ev {
    pub const WALL: u32 = 0;
    pub const HIT: u32 = 1;
    pub const PAD: u32 = 2;
    pub const BUMP: u32 = 3;
    pub const DEMO: u32 = 4;
    pub const GOAL: u32 = 5;
    pub const COUNT: u32 = 6;
    pub const BOOM: u32 = 7;
    pub const KICKOFF: u32 = 8;
    pub const END: u32 = 9;
    pub const SAVE: u32 = 10;
    pub const OVERTIME: u32 = 11;
    pub const TOUCH: u32 = 12;
    pub const SHOT: u32 = 13;
    pub const CLEAR: u32 = 14;
    pub const EPIC_SAVE: u32 = 15;
    pub const ASSIST: u32 = 16;
    pub const SCORER: u32 = 17;
    pub const EXTERMINATION: u32 = 18;
    pub const PINCH: u32 = 19;
    /// La balle a tape un poteau. Valeur : vitesse d'impact.
    pub const POST: u32 = 20;
}

/// Compte les voitures de chaque camp.
fn team_sizes(cars: &[Car]) -> [usize; 2] {
    let mut n = [0usize; 2];
    for c in cars {
        n[(c.team & 1) as usize] += 1;
    }
    n
}

/// Fabrique les voitures en donnant a chacune son rang dans son camp.
fn build_cars(teams: &[u8]) -> Vec<Car> {
    let mut sizes = [0usize; 2];
    for &t in teams {
        sizes[(t & 1) as usize] += 1;
    }
    let mut rank = [0usize; 2];
    teams
        .iter()
        .map(|&t| {
            let side = (t & 1) as usize;
            let c = Car::nth(t & 1, rank[side], sizes[side]);
            rank[side] += 1;
            c
        })
        .collect()
}

pub struct Game {
    pub cars: Vec<Car>,
    pub ball: Ball,
    pub pads: Field,
    pub bot: Bot,
    /// `true` quand la voiture 1 est pilotee par la machine.
    pub bot_on: bool,
    pub score: [u32; 2],
    pub phase: Phase,
    pub clock: f32,
    pub timer: f32,
    pub overtime: bool,
    pub duration: f32,
    pub events: Vec<(u32, f32)>,
    /// Reglages de la partie. Modifiables a chaud depuis `/admin`.
    pub tune: Tune,
    /// Points individuels, sur le bareme de Rocket League. Ils vivent a
    /// cote du score par equipe, sans se melanger a lui.
    pub scoring: Scoring,
    /// Memorise l'etat supersonique pour n'emettre le son qu'au passage.
    boom: Vec<bool>,
    /// Secondes depuis le dernier contact de chaque voiture avec la balle :
    /// le choc ne s'entend qu'a la reprise de contact, voir `DECOLLE`.
    colle: Vec<f32>,
    /// Auteur du tir en cours : tant que sa balle file vers le but, il ne
    /// marque pas un tir de plus. Pousser la balle la touche a chaque
    /// image ; sans cela, chaque image comptait un tir.
    tir: Option<usize>,
    /// Repos de chaque voiture avant un nouvel arret ou degagement, puis
    /// avant un nouveau tir.
    repos: Vec<f32>,
    repos_tir: Vec<f32>,
    /// Derniere voiture de chaque camp a avoir touche la balle : un but
    /// devie par un defenseur revient a l'attaquant, comme dans Rocket
    /// League.
    touche_camp: [Option<usize>; 2],
    /// Voiture dont le choc s'est deja fait entendre sur une balle restee
    /// contre un mur. Elle ne resonne plus tant que la balle y frotte ;
    /// un autre joueur, ou une balle decollee, rend la voix.
    muet: Option<usize>,
    /// L'engagement d'ouverture nait hors d'un pas de simulation : il serait
    /// efface avant que l'hote ait pu le lire, on le reporte donc sur la
    /// premiere image.
    opening: bool,
    carry: f32,
}

impl Game {
    pub fn new(seed: u32, level: u32, duration: f32) -> Game {
        Game::with_teams(seed, level, duration, &[0, 1])
    }

    /// Partie a effectif libre : `teams` donne le camp de chaque voiture,
    /// et sa longueur le nombre de joueurs. Rien ne borne cet effectif.
    pub fn with_teams(seed: u32, level: u32, duration: f32, teams: &[u8]) -> Game {
        let teams: Vec<u8> = if teams.is_empty() { vec![0, 1] } else { teams.to_vec() };
        let n = teams.len();
        let mut g = Game {
            cars: build_cars(&teams),
            ball: Ball::new(),
            pads: Field::new(),
            bot: Bot::new(level, seed),
            bot_on: true,
            score: [0, 0],
            phase: Phase::Countdown,
            clock: duration,
            timer: COUNTDOWN,
            overtime: false,
            duration,
            events: Vec::new(),
            tune: Tune::default(),
            scoring: Scoring::new(n),
            boom: vec![false; n],
            colle: vec![DECOLLE; n],
            tir: None,
            repos: vec![0.0; n],
            repos_tir: vec![0.0; n],
            touche_camp: [None, None],
            muet: None,
            opening: true,
            carry: 0.0,
        };
        g.kickoff();
        g
    }

    /// Partie en ligne : on demarre dans le salon, sans machine aux
    /// commandes, et c'est l'hote qui declenche le vrai match.
    pub fn warmup(seed: u32, duration: f32) -> Game {
        Game::warmup_with(seed, duration, &[0, 1])
    }

    /// Salon a effectif libre : `teams` donne le camp de chacun.
    pub fn warmup_with(seed: u32, duration: f32, teams: &[u8]) -> Game {
        let mut g = Game::with_teams(seed, 1, duration, teams);
        g.bot_on = false;
        g.phase = Phase::Warmup;
        g.opening = false;
        g
    }

    /// Quitte l'echauffement pour un match neuf. Sans effet ailleurs.
    pub fn begin(&mut self) {
        if self.phase != Phase::Warmup {
            return;
        }
        self.score = [0, 0];
        self.scoring.reset();
        self.clock = self.duration;
        self.overtime = false;
        self.kickoff();
    }

    /// Renvoie tout le monde au salon, match remis a zero.
    pub fn back_to_warmup(&mut self) {
        self.kickoff();
        self.score = [0, 0];
        self.scoring.reset();
        self.clock = self.duration;
        self.overtime = false;
        self.phase = Phase::Warmup;
    }

    pub fn set_input(&mut self, idx: usize, input: Input) {
        if let Some(c) = self.cars.get_mut(idx) {
            c.input = input;
        }
    }

    fn kickoff(&mut self) {
        self.ball.reset();
        self.pads.reset();
        let sizes = team_sizes(&self.cars);
        for c in self.cars.iter_mut() {
            let (p, a) = arena::kickoff_nth(c.team, c.rank, sizes[c.team as usize]);
            c.reset(p, a, self.tune.kickoff_boost);
        }
        self.phase = Phase::Countdown;
        self.timer = self.tune.countdown;
        self.boom = vec![false; self.cars.len()];
        self.colle = vec![DECOLLE; self.cars.len()];
        self.tir = None;
        self.repos = vec![0.0; self.cars.len()];
        self.repos_tir = vec![0.0; self.cars.len()];
        self.touche_camp = [None, None];
        self.muet = None;
        self.events.push((ev::KICKOFF, 0.0));
    }

    /// Avance le match de `dt` secondes, par pas fixes.
    pub fn step(&mut self, dt: f32) {
        self.events.clear();
        self.scoring.tick(dt);
        if self.opening {
            self.opening = false;
            self.events.push((ev::KICKOFF, 0.0));
        }
        // Un onglet revenu au premier plan peut livrer un `dt` enorme :
        // on le plafonne pour ne pas traverser les murs.
        self.carry += dt.clamp(0.0, 0.25);
        let mut guard = 0;
        while self.carry >= STEP && guard < 64 {
            self.carry -= STEP;
            guard += 1;
            self.tick(STEP);
        }
    }

    fn tick(&mut self, dt: f32) {
        match self.phase {
            Phase::Over => return,
            Phase::Countdown => {
                let before = self.timer.ceil();
                self.timer -= dt;
                if self.timer.ceil() < before && self.timer > 0.0 {
                    self.events.push((ev::COUNT, self.timer.ceil()));
                }
                if self.timer <= 0.0 {
                    self.phase = Phase::Play;
                    self.events.push((ev::COUNT, 0.0));
                }
                return;
            }
            Phase::Goal => {
                // La celebration ne fige plus rien : on continue de rouler,
                // la balle reste ou elle est tombee, et c'est seulement au
                // bout du chronometre qu'on remet tout le monde en place.
                self.timer -= dt;
                if self.timer <= 0.0 {
                    if self.overtime || (self.clock <= 0.0 && self.score[0] != self.score[1]) {
                        self.finish();
                    } else {
                        self.kickoff();
                    }
                    return;
                }
            }
            Phase::Warmup | Phase::Play => {}
        }

        if self.bot_on {
            let input = self
                .bot
                .think(&self.cars[1], &self.ball, &self.pads, dt, &self.tune);
            self.cars[1].input = input;
        }

        for i in 0..self.cars.len() {
            self.cars[i].step(dt, &self.tune);
            let sonic = self.cars[i].supersonic(&self.tune);
            if sonic && !self.boom[i] {
                self.events.push((ev::BOOM, i as f32));
            }
            self.boom[i] = sonic;
        }

        let choc = self.ball.step(dt, &self.tune);
        if choc.force > 60.0 {
            let code = if choc.poteau { ev::POST } else { ev::WALL };
            self.events.push((code, choc.force));
        }
        let (rayon, coin, cage) = (self.tune.ball_radius, self.tune.arena_corner, self.tune.cage());
        for r in self.repos.iter_mut().chain(self.repos_tir.iter_mut()) {
            *r = (*r - dt).max(0.0);
        }
        // La balle ne va plus au but : le tir est fini, son auteur pourra en
        // tenter un autre.
        if let Some(c) = self.tir {
            let team = self.cars.get(c).map_or(0, |c| c.team);
            if !score::is_shot(team, self.ball.pos, self.ball.vel, &cage) {
                self.tir = None;
            }
        }
        if arena::contact(self.ball.pos, rayon + FROLE, coin, &cage).is_none() {
            self.muet = None;
        }

        self.pads.tick(dt);
        for i in 0..self.cars.len() {
            if let Some(p) = self.pads.collect(&mut self.cars[i], &self.tune) {
                self.events.push((ev::PAD, p as f32));
            }
            // On garde la balle d'avant le contact : comparer les deux
            // trajectoires dit si le joueur vient de sortir un tir cadre.
            let before = self.ball;
            let force = collide::car_ball(&mut self.cars[i], &mut self.ball, &self.tune);
            if force <= 0.0 {
                self.colle[i] += dt;
            } else {
                // Tout contact compte pour le jeu, mais seul le premier
                // d'un appui continu fait du bruit.
                let nouveau = self.colle[i] >= DECOLLE;
                if nouveau && self.muet != Some(i) {
                    self.events.push((ev::HIT, force));
                }
                // Un autre joueur reprend la balle : le tir en cours est
                // fini, celui qui l'avait tire pourra en marquer un nouveau.
                // Seule une nouvelle touche compte : une balle coincee
                // contre une voiture la touche a chaque image.
                if nouveau && self.tir.is_some_and(|c| c != i) {
                    self.tir = None;
                }
                self.colle[i] = 0.0;
                if arena::contact(self.ball.pos, rayon + FROLE, coin, &cage).is_some() {
                    self.muet = Some(i);
                }
                // La balle vient d'etre poussee : si une paroi la bloque
                // deja de l'autre cote, les deux surfaces se referment sur
                // elle. Il faut le regarder maintenant, dans la meme image
                // que la frappe — a la suivante, elle aurait deja recule.
                if let Some(mur) =
                    arena::contact(self.ball.pos, rayon, coin, &cage)
                {
                    let fuite =
                        collide::pinch(&self.cars[i], &mut self.ball, &mur, &self.tune);
                    if fuite > 0.0 {
                        self.events.push((ev::PINCH, fuite));
                    }
                }
                let team = self.cars[i].team;
                self.touche_camp[(team & 1) as usize] = Some(i);
                // Les points ne se gagnent qu'en jeu : pendant la celebration
                // d'un but, pousser la balle au fond du filet ne rapporte rien.
                if !matches!(self.phase, Phase::Play | Phase::Warmup) {
                    continue;
                }
                if self.scoring.touch(i) {
                    self.events.push((ev::TOUCH, i as f32));
                }
                let goal = arena::goal_mouth(team == 0);
                let dist = (before.pos.x - goal).abs();
                let close = dist < self.tune.save_range;
                let libre = self.repos[i] <= 0.0;
                if close
                    && libre
                    && before.vel.len() > 170.0
                    && arena::on_target(before.pos, before.vel, team, &cage)
                    && !arena::on_target(self.ball.pos, self.ball.vel, team, &cage)
                {
                    // Proximite du but, de 0 au bord de la zone a 1 sur la
                    // ligne : c'est elle qui distingue l'arret spectaculaire.
                    let pres = 1.0 - (dist / self.tune.save_range).clamp(0.0, 1.0);
                    self.repos[i] = REPOS_ACTION;
                    let epic = self.scoring.save(i, pres);
                    self.events.push((ev::SAVE, i as f32));
                    if epic {
                        self.events.push((ev::EPIC_SAVE, i as f32));
                    }
                } else if score::is_shot(team, self.ball.pos, self.ball.vel, &cage) {
                    if self.tir != Some(i) && self.repos_tir[i] <= 0.0 {
                        self.tir = Some(i);
                        self.repos_tir[i] = REPOS_TIR;
                        self.scoring.shot(i);
                        self.events.push((ev::SHOT, i as f32));
                    }
                } else if libre && score::is_clear(team, before.pos, self.ball.vel, &self.tune) {
                    self.repos[i] = REPOS_ACTION;
                    self.scoring.clear(i);
                    self.events.push((ev::CLEAR, i as f32));
                }
            }
        }

        // Toutes les paires : a dix joueurs les contacts se multiplient, et
        // il n'y a plus de « la » collision mais un carambolage a demeler.
        // Copie locale : `split_at_mut` emprunte `self.cars`, donc `self`.
        let tune = self.tune;
        for i in 0..self.cars.len() {
            for j in (i + 1)..self.cars.len() {
                let (lo, hi) = self.cars.split_at_mut(j);
                let Some(bump) = collide::car_car(&mut lo[i], &mut hi[0], &tune) else {
                    continue;
                };
                if bump.demo_a {
                    self.events.push((ev::DEMO, i as f32));
                    if self.scoring.demo(j) {
                        self.events.push((ev::EXTERMINATION, j as f32));
                    }
                }
                if bump.demo_b {
                    self.events.push((ev::DEMO, j as f32));
                    if self.scoring.demo(i) {
                        self.events.push((ev::EXTERMINATION, i as f32));
                    }
                }
                if !bump.any_demo() && bump.force > 35.0 {
                    self.events.push((ev::BUMP, bump.force));
                }
            }
        }

        // Un but deja encaisse ne se recompte pas : pendant la celebration
        // la balle dort au fond du filet, elle y serait vue a chaque image.
        if self.phase == Phase::Goal {
            return;
        }

        if let Some(team) = arena::conceded(self.ball.pos, self.tune.ball_radius, &self.tune.cage()) {
            let scorer = 1 - team;
            self.events.push((ev::GOAL, scorer as f32));
            // Le buteur est le dernier du camp qui marque a avoir touche la
            // balle : une deviation adverse ne lui vole pas son but. Si aucun
            // de ses joueurs ne l'a touchee, c'est un contre son camp, et
            // personne ne marque.
            if let Some(auteur) = self.touche_camp[scorer as usize] {
                if self.cars.get(auteur).map(|c| c.team) == Some(scorer) {
                    let but = arena::goal_mouth(scorer == 1);
                    let loin = (self.ball.pos.x - but).abs();
                    let teams: Vec<u8> = self.cars.iter().map(|c| c.team).collect();
                    let champ = arena::MAX_X - arena::MIN_X;
                    let passeur =
                        self.scoring
                            .goal(auteur, self.overtime, loin, champ, &teams);
                    self.events.push((ev::SCORER, auteur as f32));
                    if let Some(p) = passeur {
                        self.events.push((ev::ASSIST, p as f32));
                    }
                }
            }
            if self.phase == Phase::Warmup {
                // A l'echauffement le but ne compte pas : la balle repart
                // du centre sans figer la scene, on continue de jouer.
                self.ball.reset();
                return;
            }
            self.score[scorer as usize] += 1;
            self.phase = Phase::Goal;
            self.timer = self.tune.celebrate;
            return;
        }

        if self.phase == Phase::Play && !self.overtime {
            self.clock = (self.clock - dt).max(0.0);
            if self.clock <= 0.0 {
                if self.score[0] == self.score[1] {
                    self.overtime = true;
                    self.events.push((ev::OVERTIME, 0.0));
                } else {
                    self.finish();
                }
            }
        }
    }

    fn finish(&mut self) {
        self.phase = Phase::Over;
        self.events.push((ev::END, self.score[0] as f32 - self.score[1] as f32));
    }
}
