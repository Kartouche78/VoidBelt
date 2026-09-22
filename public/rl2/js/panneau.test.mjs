// Verification du panneau de reglages, sans navigateur.
//
// `node --check` ne valide que la syntaxe : il a laisse passer un `$`
// oublie a la decoupe, et l'onglet Commandes est reste vide en ligne. On
// monte donc un DOM de fortune et on fait vraiment tourner chaque onglet.
//
//   node public/rl2/js/panneau.test.mjs

import { PANNEAU } from './settings-panel.js';
import { DEFAULTS } from './settings.js';

function element(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    set innerHTML(_) { this.children = []; },
    set textContent(v) { this.text = v; },
    append(...n) { this.children.push(...n); },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
}

const corps = element();
globalThis.document = {
  createElement: (t) => element(t),
  getElementById: (id) => (id === 'settings-body' ? corps : element()),
  querySelectorAll: () => [],
};

const menu = Object.assign(Object.create(PANNEAU), {
  settings: structuredClone(DEFAULTS),
  input: { pad: () => null, listen() {}, cancelListen() {} },
  hooks: { change() {} },
});

let rate = 0;
for (const onglet of ['controls', 'audio', 'match', 'interface']) {
  menu.tab = onglet;
  try {
    menu.renderSettings();
    const n = corps.children.length;
    if (n === 0) {
      console.error(`ECHEC ${onglet} : panneau vide`);
      rate += 1;
    } else {
      console.log(`ok   ${onglet.padEnd(10)} ${n} lignes`);
    }
  } catch (err) {
    console.error(`ECHEC ${onglet} : ${err.message}`);
    rate += 1;
  }
}
process.exit(rate ? 1 : 0);
