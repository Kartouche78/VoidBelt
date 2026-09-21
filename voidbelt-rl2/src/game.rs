//! Le deroulement d'un match : engagement, jeu, but, fin et prolongation.

use crate::arena;
use crate::ball::Ball;
use crate::boost::Field;
use crate::bot::Bot;
use crate::car::{Car, Input, KICKOFF_BOOST};
use crate::collide;

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
const STEP: f32 = 1.0 / 120.0;
/// Distance au but en deca de laquelle une frappe degagee compte comme un
/// arret. Plus loin, c'est du jeu ordinaire.
const SAVE_RANGE: f32 = 400.0;

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

pub struct Game {
    pub cars: [Car; CARS],
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
    /// Memorise l'etat supersonique pour n'emettre le son qu'au passage.
    boom: [bool; CARS],
    /// L'engagement d'ouverture nait hors d'un pas de simulation : il serait
    /// efface avant que l'hote ait pu le lire, on le reporte donc sur la
    /// premiere image.
    opening: bool,
    carry: f32,
}

impl Game {
    pub fn new(seed: u32, level: u32, duration: f32) -> Game {
        let mut g = Game {
            cars: [Car::new(0), Car::new(1)],
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
            boom: [false; CARS],
            opening: true,
            carry: 0.0,
        };
        g.kickoff();
        g
    }

    /// Partie en ligne : on demarre dans le salon, sans machine aux
    /// commandes, et c'est l'hote qui declenche le vrai match.
    pub fn warmup(seed: u32, duration: f32) -> Game {
        let mut g = Game::new(seed, 1, duration);
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
        for (i, c) in self.cars.iter_mut().enumerate() {
            let (p, a) = arena::kickoff(i as u8);
            c.reset(p, a, KICKOFF_BOOST);
        }
        self.phase = Phase::Countdown;
        self.timer = COUNTDOWN;
        self.boom = [false; CARS];
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
            let input = self.bot.think(&self.cars[1], &self.ball, &self.pads, dt);
            self.cars[1].input = input;
        }

        for i in 0..CARS {
            self.cars[i].step(dt);
            let sonic = self.cars[i].supersonic();
            if sonic && !self.boom[i] {
                self.events.push((ev::BOOM, i as f32));
            }
            self.boom[i] = sonic;
        }

        let wall = self.ball.step(dt);
        if wall > 60.0 {
            self.events.push((ev::WALL, wall));
        }

        self.pads.tick(dt);
        for i in 0..CARS {
            if let Some(p) = self.pads.collect(&mut self.cars[i]) {
                self.events.push((ev::PAD, p as f32));
            }
            // On garde la balle d'avant le contact : comparer les deux
            // trajectoires dit si le joueur vient de sortir un tir cadre.
            let before = self.ball;
            let force = collide::car_ball(&mut self.cars[i], &mut self.ball);
            if force > 0.0 {
                self.events.push((ev::HIT, force));
                let team = self.cars[i].team;
                let goal = arena::goal_mouth(team == 0);
                let close = (before.pos.x - goal).abs() < SAVE_RANGE;
                if close
                    && before.vel.len() > 170.0
                    && arena::on_target(before.pos, before.vel, team)
                    && !arena::on_target(self.ball.pos, self.ball.vel, team)
                {
                    self.events.push((ev::SAVE, team as f32));
                }
            }
        }

        let (a, b) = self.cars.split_at_mut(1);
        if let Some(bump) = collide::car_car(&mut a[0], &mut b[0]) {
            if bump.demo_a {
                self.events.push((ev::DEMO, 0.0));
            }
            if bump.demo_b {
                self.events.push((ev::DEMO, 1.0));
            }
            if !bump.any_demo() && bump.force > 35.0 {
                self.events.push((ev::BUMP, bump.force));
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
            self.timer = CELEBRATE;
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
