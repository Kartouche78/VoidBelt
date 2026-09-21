//! Le deroulement d'un match : engagement, jeu, but, fin et prolongation.

use crate::arena;
use crate::ball::Ball;
use crate::boost::Field;
use crate::bot::Bot;
use crate::car::{Car, Input};
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
    /// Memorise l'etat supersonique pour n'emettre le son qu'au passage.
    boom: Vec<bool>,
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
            boom: vec![false; n],
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
        self.clock = self.duration;
        self.overtime = false;
        self.kickoff();
    }

    /// Renvoie tout le monde au salon, match remis a zero.
    pub fn back_to_warmup(&mut self) {
        self.kickoff();
        self.score = [0, 0];
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
        self.events.push((ev::KICKOFF, 0.0));
    }

    /// Avance le match de `dt` secondes, par pas fixes.
    pub fn step(&mut self, dt: f32) {
        self.events.clear();
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
                self.timer -= dt;
                if self.timer <= 0.0 {
                    if self.overtime || (self.clock <= 0.0 && self.score[0] != self.score[1]) {
                        self.finish();
                    } else {
                        self.kickoff();
                    }
                }
                return;
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

        let wall = self.ball.step(dt, &self.tune);
        if wall > 60.0 {
            self.events.push((ev::WALL, wall));
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
            if force > 0.0 {
                self.events.push((ev::HIT, force));
                let team = self.cars[i].team;
                let goal = arena::goal_mouth(team == 0);
                let close = (before.pos.x - goal).abs() < self.tune.save_range;
                if close
                    && before.vel.len() > 170.0
                    && arena::on_target(before.pos, before.vel, team)
                    && !arena::on_target(self.ball.pos, self.ball.vel, team)
                {
                    self.events.push((ev::SAVE, team as f32));
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
                }
                if bump.demo_b {
                    self.events.push((ev::DEMO, j as f32));
                }
                if !bump.any_demo() && bump.force > 35.0 {
                    self.events.push((ev::BUMP, bump.force));
                }
            }
        }

        if let Some(team) = arena::conceded(self.ball.pos, crate::ball::RADIUS) {
            let scorer = 1 - team;
            self.events.push((ev::GOAL, scorer as f32));
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
