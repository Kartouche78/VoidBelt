// Client des parties en ligne.
//
// Le serveur fait tourner le moteur et diffuse l'etat ; on ne lui envoie que
// nos commandes. Cette classe rend `state()` et `events()` dans le format
// exact du moteur local, pour que la boucle de jeu n'ait rien a savoir du
// reseau : elle change juste de fournisseur.

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const HTTP = LOCAL ? location.origin : 'https://api.voidbelt.com';
const WS = LOCAL
  ? `${location.protocol === 'https:' ? 'wss://' : 'ws://'}${location.host}`
  : 'wss://api.voidbelt.com';

/** On affiche le monde legerement dans le passe, pour avoir toujours deux
 *  images encadrant l'instant rendu et lisser la gigue du reseau. */
const DELAY = 0.07;

/** Champs a interpoler : tout ce qui bouge en continu. Le reste (phase,
 *  score, chronos, plots) se prend tel quel dans la derniere image. */
function smoothFields(stateLen, carBase, carStride, cars) {
  const idx = [6, 7, 8, 9, 10];
  for (let c = 0; c < cars; c += 1) {
    const b = carBase + c * carStride;
    idx.push(b, b + 1, b + 3, b + 4);
  }
  return { idx, angles: [...Array(cars).keys()].map((c) => carBase + c * carStride + 2), stateLen };
}

export async function listRooms() {
  const res = await fetch(`${HTTP}/api/rl2/rooms`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`salons indisponibles (${res.status})`);
  const data = await res.json();
  return Array.isArray(data.rooms) ? data.rooms : [];
}

function lerpAngle(a, b, k) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export class Net {
  /** `layout` vient de `wasm.js` : le meme decoupage des deux cotes. */
  constructor(layout) {
    this.layout = layout;
    this.sock = null;
    this.you = 0;
    this.slot = 0;
    this.room = null;
    this.onRoom = null;
    this.onClose = null;
    this.pending = [0];
    this.prev = null;
    this.curr = null;
    this.out = null;
    this.cmd = new Float32Array(4);
  }

  get connected() {
    return this.sock && this.sock.readyState === WebSocket.OPEN;
  }

  get isHost() {
    return this.room && this.room.host === this.you;
  }

  /** `code` vide cree un salon. Resout une fois le salon rejoint. */
  connect(code, name) {
    return new Promise((resolve, reject) => {
      const url = `${WS}/api/rl2/ws?room=${encodeURIComponent(code || '')}&name=${encodeURIComponent(name || '')}`;
      const sock = new WebSocket(url);
      sock.binaryType = 'arraybuffer';
      this.sock = sock;
      let settled = false;

      sock.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return this._frame(ev.data);
        const msg = JSON.parse(ev.data);
        if (msg.t === 'error') {
          settled = true;
          sock.close();
          return reject(new Error(msg.m));
        }
        if (msg.t === 'hello') {
          this.you = msg.you;
          this.slot = msg.slot;
          this.room = msg.room;
          settled = true;
          resolve(msg.room);
        }
        if (msg.t === 'room') this.room = msg.room;
        this.onRoom?.(this.room);
        return undefined;
      };
      sock.onerror = () => {
        if (!settled) reject(new Error('serveur injoignable'));
      };
      sock.onclose = () => {
        this.sock = null;
        if (!settled) reject(new Error('connexion refusee'));
        else this.onClose?.();
      };
    });
  }

  close() {
    this.onClose = null;
    this.sock?.close();
    this.sock = null;
    this.prev = null;
    this.curr = null;
    this.room = null;
  }

  /** Demande au serveur de lancer le match. Ignoree si on n'est pas hote. */
  start() {
    if (this.connected) this.sock.send(JSON.stringify({ t: 'start' }));
  }

  send(c) {
    if (!this.connected) return;
    this.cmd[0] = c.throttle;
    this.cmd[1] = c.brake;
    this.cmd[2] = c.steer;
    this.cmd[3] = (c.boost ? 1 : 0) | (c.drift ? 2 : 0);
    this.sock.send(this.cmd.buffer);
  }

  _frame(buffer) {
    const all = new Float32Array(buffer);
    const len = this.layout.stateLen;
    if (all.length < len) return;
    const data = all.slice(0, len);
    // Les evenements s'empilent jusqu'a la prochaine image affichee : a
    // 60 Hz des deux cotes il en arrive parfois deux entre deux rendus, et
    // on ne veut pas perdre un but ou une explosion.
    const n = all.length > len ? all[len] | 0 : 0;
    for (let i = 0; i < n; i += 1) {
      this.pending.push(all[len + 1 + i * 2], all[len + 2 + i * 2]);
      this.pending[0] += 1;
    }
    this.prev = this.curr;
    this.curr = { at: performance.now() / 1000, data };
    if (!this.prev) this.prev = this.curr;
    if (!this.out) this.out = new Float32Array(len);
  }

  /** Etat a afficher, interpole entre les deux dernieres images recues. */
  state() {
    if (!this.curr) return null;
    const { prev, curr, out } = this;
    out.set(curr.data);
    const span = curr.at - prev.at;
    if (span <= 1e-4) return out;
    const k = Math.max(0, Math.min(1, (performance.now() / 1000 - DELAY - prev.at) / span));
    const { idx, angles } = this.fields();
    for (const i of idx) out[i] = prev.data[i] + (curr.data[i] - prev.data[i]) * k;
    for (const i of angles) out[i] = lerpAngle(prev.data[i], curr.data[i], k);
    return out;
  }

  fields() {
    if (!this._fields) {
      const l = this.layout;
      this._fields = smoothFields(l.stateLen, l.carBase, l.carStride, l.cars);
    }
    return this._fields;
  }

  events() {
    const out = this.pending;
    this.pending = [0];
    return out;
  }
}

export { HTTP, WS };
