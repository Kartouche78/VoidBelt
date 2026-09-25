// Ouvre vraiment le jeu dans un navigateur et rapporte ce qui casse.
//
// Les verifications precedentes ne voyaient pas grand-chose : `node --check`
// ne lit que la syntaxe, et un DOM de fortune ne sait rien de la mise en
// page. Les deux pannes parties en ligne — l'accueil qui ne se cachait plus
// et le panneau de reglages reste vide — n'etaient visibles que dans un vrai
// navigateur. Celui-ci en pilote un, deja installe sur la machine : rien a
// telecharger.
//
//   npm start          # un terminal : le serveur
//   npm run test:page  # un autre : cette verification
//
// Il ouvre l'accueil, entre dans chaque ecran, et echoue des qu'une erreur
// paraît dans la console, qu'une requete tombe, ou qu'un panneau reste vide.

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const URL = process.env.URL || 'http://127.0.0.1:8080/rl2/';
const NAVIGATEURS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const chemin = NAVIGATEURS.find((p) => existsSync(p));
if (!chemin) {
  console.error('aucun navigateur trouve : renseigne un chemin dans NAVIGATEURS');
  process.exit(1);
}

const nav = await puppeteer.launch({
  executablePath: chemin,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await nav.newPage();

const soucis = [];
page.on('console', (m) => {
  if (m.type() === 'error') soucis.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => soucis.push(`exception: ${e.message}`));
page.on('requestfailed', (r) => soucis.push(`requete perdue: ${r.url()}`));
page.on('response', (r) => {
  if (r.status() >= 400) soucis.push(`${r.status()} sur ${r.url()}`);
});

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (sel) => page.$eval(sel, (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
}).catch(() => false);

let rate = 0;
const verifie = async (quoi, promesse) => {
  const ok = await promesse;
  console.log(`${ok ? 'ok  ' : 'ECHEC'} ${quoi}`);
  if (!ok) rate += 1;
};

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
await attendre(1500);

await verifie("l'accueil s'affiche", visible('#screen-title'));

// Parametres : chaque onglet doit poser quelque chose dans le corps.
await page.click('#btn-settings');
await attendre(400);
await verifie('les parametres s\u2019ouvrent', visible('#screen-settings'));
for (const onglet of ['controls', 'audio', 'match', 'interface']) {
  await page.click(`[data-tab="${onglet}"]`);
  await attendre(250);
  await verifie(
    `onglet ${onglet} rempli`,
    page.$eval('#settings-body', (el) => el.children.length > 0).catch(() => false),
  );
}
await verifie(
  'les parametres se posent sur l\u2019accueil',
  visible('#screen-title'),
);
await page.click('#btn-settings-back');
await attendre(300);

// Jouer : l'accueil disparait derriere les quatre modes. Occasionnel est
// verrouille : c'est la partie privee qui s'ouvre, arenes comprises.
await page.click('#btn-online');
await attendre(600);
await verifie('Jouer montre les modes', visible('#screen-modes'));
await verifie("Jouer cache bien l'accueil", visible('#screen-title').then((v) => !v));
await verifie(
  'quatre cases de mode',
  page.$$eval('#modes-grille .mode', (l) => l.length === 4).catch(() => false),
);
// Occasionnel : le choix des cartes, avant la partie contre le bot.
await page.click('.mode[data-mode="occasionnel"]');
await attendre(600);
await verifie('Occasionnel ouvre le choix des cartes', visible('#screen-stadium'));
await verifie(
  'les cartes sont la',
  page.$$eval('#stadium-list button', (n) => n.length >= 10).catch(() => false),
);
await page.click('#btn-stadium-back');
await attendre(400);
await verifie('Retour revient aux modes', visible('#screen-modes'));

await page.click('.mode[data-mode="prive"]');
await attendre(800);
await verifie('la partie privee s\u2019ouvre', visible('#screen-prive'));
await verifie(
  'les arenes sont la',
  page.$$eval('#prive-arenes .pv-arene', (n) => n.length >= 10).catch(() => false),
);
await page.click('#btn-prive-back');
await attendre(300);

await nav.close();

if (soucis.length) {
  console.error(`\n${soucis.length} probleme(s) releve(s) par le navigateur :`);
  for (const s of [...new Set(soucis)]) console.error(`   ${s}`);
}
process.exit(rate || soucis.length ? 1 : 0);
