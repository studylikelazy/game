import { BUILDINGS, EXITS, WORLD, seeded, type Actor, type GameState, type Player } from './game';

const TAU = Math.PI * 2;
const FIRES: readonly [number, number][] = [[811, 1046], [1270, 780], [1570, 660]];

type Aim = { x: number; y: number; hot: boolean };
type Tree = { x: number; y: number; size: number; pine: boolean; tint: number };
type FxParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  glow: boolean;
};
type BloodDecal = { x: number; y: number; size: number; rotation: number; alpha: number };
type DamageNumber = { x: number; y: number; value: number; life: number; maxLife: number; color: string; size: number };
type RingFx = { x: number; y: number; life: number; maxLife: number; from: number; to: number; color: string; width: number; glow: boolean };

/** Canvas presentation layer. It intentionally only observes GameState: combat rules stay in game.ts. */
export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  terrain: HTMLCanvasElement;
  camera = { x: 1040, y: 930, zoom: .69 };
  width = 0;
  height = 0;
  dpr = 1;
  /** Set by main.ts every frame so visual accessibility never changes gameplay. */
  reducedMotion = false;

  private trees: Tree[] = [];
  private observer: ResizeObserver;
  private prevHp = new Map<string, number>();
  private fireEmbers: FxParticle[] = [];
  private hitParticles: FxParticle[] = [];
  private blood: BloodDecal[] = [];
  private damageNumbers: DamageNumber[] = [];
  private rings: RingFx[] = [];
  private lastDrawTime: number | null = null;
  private emberClock = 0;
  private randomState = 0x4a534845;
  private shake = 0;
  private wasLobby = true;
  private shakeX = 0;
  private shakeY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.terrain = document.createElement('canvas');
    this.terrain.width = WORLD.width;
    this.terrain.height = WORLD.height;
    this.buildTerrain();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    this.dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = r.width * this.dpr;
    this.canvas.height = r.height * this.dpr;
  }

  screenToWorld(x: number, y: number) {
    return { x: (x - this.width / 2) / this.camera.zoom + this.camera.x, y: (y - this.height / 2) / this.camera.zoom + this.camera.y };
  }

  private random() {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  private buildTerrain() {
    const c = this.terrain.getContext('2d')!;
    const r = seeded(1947);
    c.fillStyle = '#3c4338';
    c.fillRect(0, 0, WORLD.width, WORLD.height);
    for (let i = 0; i < 1900; i++) {
      const x = r() * WORLD.width;
      const y = r() * WORLD.height;
      const size = 10 + r() * 80;
      c.fillStyle = ['#4f594619', '#1a251f22', '#626b5118', '#776d4c17'][i % 4];
      c.beginPath();
      c.ellipse(x, y, size * 1.7, size, r() * TAU, 0, TAU);
      c.fill();
    }

    // Old river; crossings remain traversable for an approachable first raid.
    c.beginPath();
    c.moveTo(2070, -50);
    c.bezierCurveTo(1850, 480, 2380, 740, 2070, 1100);
    c.bezierCurveTo(1870, 1380, 2020, 1590, 2280, 1900);
    c.strokeStyle = '#172522';
    c.lineWidth = 145;
    c.stroke();
    c.strokeStyle = '#31423c';
    c.lineWidth = 122;
    c.stroke();
    c.strokeStyle = '#294445';
    c.lineWidth = 103;
    c.stroke();
    c.strokeStyle = '#a9b3a212';
    c.lineWidth = 1;
    for (let i = 0; i < 700; i++) {
      const x = 1930 + r() * 350;
      const y = r() * WORLD.height;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + r() * 24 + 5, y - 3);
      c.stroke();
    }

    const road = (points: number[][], width: number) => {
      c.beginPath();
      c.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) c.lineTo(points[i][0], points[i][1]);
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.strokeStyle = '#0b1411aa';
      c.lineWidth = width + 19;
      c.stroke();
      c.strokeStyle = '#655e47';
      c.lineWidth = width;
      c.stroke();
      c.strokeStyle = '#93866226';
      c.lineWidth = width - 14;
      c.stroke();
    };
    road([[230, 1500], [520, 1320], [710, 1170], [865, 930], [871, 690], [900, 470], [1220, 390], [1450, 525], [1680, 510], [1840, 250]], 74);
    road([[430, 750], [850, 708], [1160, 700], [1360, 890], [1570, 990], [1860, 1180], [2150, 1450]], 63);
    road([[880, 955], [1140, 1090], [1250, 1350], [1620, 1440]], 42);

    // Footprints, stones and moss keep the map illustrated without external assets.
    for (let i = 0; i < 11500; i++) {
      const x = r() * WORLD.width;
      const y = r() * WORLD.height;
      c.fillStyle = ['#aaa17a20', '#0b141127', '#91976019', '#26312799'][i % 4];
      c.fillRect(x, y, 1 + r() * 3, 1 + r() * 2);
    }

    c.fillStyle = '#69634f38';
    c.fillRect(798, 580, 162, 336);
    for (let y = 583; y < 916; y += 14) {
      for (let x = 800; x < 955; x += 22) {
        c.fillStyle = r() > .5 ? '#9e99811e' : '#222b244e';
        c.fillRect(x + (y % 28 ? 8 : 0), y, 18, 10);
      }
    }

    const wall = (x: number, y: number, w: number, h: number) => {
      c.fillStyle = '#0b14118c';
      c.fillRect(x + 9, y + 13, w, h);
      c.fillStyle = '#555a4d';
      c.fillRect(x, y, w, h);
      c.fillStyle = '#8c8c71';
      c.fillRect(x, y, w, 3);
      c.strokeStyle = '#202a24';
      c.lineWidth = 1;
      for (let a = 0; a < w; a += 19) c.strokeRect(x + a, y, Math.min(19, w - a), h);
    };
    wall(600, 432, 211, 14);
    wall(868, 432, 220, 14);
    wall(585, 443, 15, 140);
    wall(585, 810, 15, 190);
    wall(598, 986, 183, 15);
    wall(1000, 986, 235, 15);
    wall(1219, 840, 15, 146);
    for (let i = 0; i < 45; i++) {
      const x = 560 + r() * 690;
      const y = 977 + r() * 50;
      c.fillStyle = '#575949';
      c.fillRect(x, y, r() * 9 + 3, r() * 6 + 3);
    }

    // Roofs live on the terrain, so actors still read as standing in front of them.
    for (const b of BUILDINGS) {
      c.fillStyle = '#0b14119c';
      c.fillRect(b.x + 18, b.y + 23, b.w + 7, b.h + 7);
      c.fillStyle = '#756c52';
      c.fillRect(b.x - 3, b.y + 7, b.w + 6, b.h + 9);
      c.fillStyle = '#1a211c';
      c.fillRect(b.x + b.w * .4, b.y + b.h, 27, 16);
      c.fillStyle = b.roof === 'red' ? '#513933' : '#374342';
      c.fillRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16);
      c.fillStyle = b.roof === 'red' ? '#704b3d' : '#4d5a57';
      c.beginPath();
      c.moveTo(b.x - 8, b.y - 8);
      c.lineTo(b.x + b.w / 2, b.y + 7);
      c.lineTo(b.x + b.w / 2, b.y + b.h - 6);
      c.lineTo(b.x - 8, b.y + b.h + 8);
      c.closePath();
      c.fill();
      c.strokeStyle = '#11191477';
      c.lineWidth = 2;
      for (let y = b.y - 5; y < b.y + b.h + 7; y += 10) {
        c.beginPath();
        c.moveTo(b.x - 7, y);
        c.lineTo(b.x + b.w / 2, y + 8);
        c.lineTo(b.x + b.w + 7, y);
        c.stroke();
      }
      c.strokeStyle = '#a58f6270';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(b.x + b.w / 2, b.y - 8);
      c.lineTo(b.x + b.w / 2, b.y + b.h + 8);
      c.stroke();
      c.fillStyle = '#2b312d';
      c.fillRect(b.x + b.w - 30, b.y + 17, 16, 25);
      c.fillStyle = '#777a69';
      c.fillRect(b.x + b.w - 32, b.y + 14, 20, 9);
      c.fillStyle = '#171c19';
      c.fillRect(b.x + b.w - 29, b.y + 16, 14, 4);
      c.fillStyle = '#907a56';
      c.fillRect(b.x + b.w * .4 - 4, b.y + b.h + 14, 36, 5);
    }

    // Well.
    c.fillStyle = '#0b141180';
    c.beginPath();
    c.ellipse(891, 755, 32, 23, 0, 0, TAU);
    c.fill();
    c.fillStyle = '#707365';
    c.beginPath();
    c.arc(882, 744, 24, 0, TAU);
    c.fill();
    c.fillStyle = '#1a3534';
    c.beginPath();
    c.arc(882, 744, 16, 0, TAU);
    c.fill();
    c.fillStyle = '#433827';
    c.fillRect(854, 734, 5, 22);
    c.fillRect(905, 734, 5, 22);
    c.fillStyle = '#7e6747';
    c.fillRect(852, 732, 60, 7);

    for (const [x, y] of [[1160, 960], [480, 1220], [1660, 610]]) {
      c.fillStyle = '#0b141180';
      c.beginPath();
      c.ellipse(x + 15, y + 20, 55, 28, .3, 0, TAU);
      c.fill();
      c.fillStyle = '#736b50';
      c.beginPath();
      c.moveTo(x, y - 30);
      c.lineTo(x - 40, y + 30);
      c.lineTo(x + 42, y + 24);
      c.closePath();
      c.fill();
      c.fillStyle = '#484936';
      c.beginPath();
      c.moveTo(x, y - 30);
      c.lineTo(x + 42, y + 24);
      c.lineTo(x + 18, y + 33);
      c.closePath();
      c.fill();
      c.fillStyle = '#282d23';
      c.beginPath();
      c.moveTo(x, y - 15);
      c.lineTo(x - 12, y + 30);
      c.lineTo(x + 10, y + 28);
      c.closePath();
      c.fill();
    }

    for (let i = 0; i < 80; i++) {
      const x = 620 + r() * 620;
      const y = 430 + r() * 560;
      if (BUILDINGS.some(b => x > b.x - 15 && x < b.x + b.w + 15 && y > b.y - 15 && y < b.y + b.h + 25)) continue;
      if (i % 3 === 0) {
        c.fillStyle = '#443e30';
        c.fillRect(x, y, 14, 13);
        c.strokeStyle = '#807653';
        c.lineWidth = 1;
        c.strokeRect(x, y, 14, 13);
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 14, y + 13);
        c.stroke();
      } else {
        c.fillStyle = '#303a2f';
        c.beginPath();
        c.ellipse(x, y, 4 + r() * 5, 3 + r() * 3, .2, 0, TAU);
        c.fill();
      }
    }

    const nearRoad = (x: number, y: number) => (Math.abs(x - (900 - (y - 700) * .56)) < 110 && y > 430) || (Math.abs(y - (700 + Math.max(0, x - 1160) * .68)) < 85 && x > 410) || (y < 570 && x > 1200 && x < 1840);
    for (let i = 0; i < 660; i++) {
      const x = r() * WORLD.width;
      const y = r() * WORLD.height;
      if (x > 1960 || nearRoad(x, y) || (x > 540 && x < 1270 && y > 380 && y < 1050) || BUILDINGS.some(b => x > b.x - 70 && x < b.x + b.w + 70 && y > b.y - 70 && y < b.y + b.h + 80) || EXITS.some(e => Math.hypot(e.x - x, e.y - y) < 100)) continue;
      this.trees.push({ x, y, size: 24 + r() * 30, pine: r() > .66, tint: r() });
    }
    this.trees.sort((a, b) => a.y - b.y);
    for (const t of this.trees) this.tree(c, t.x, t.y, t.size, t.pine, t.tint);
  }

  private tree(c: CanvasRenderingContext2D, x: number, y: number, s: number, pine: boolean, tint: number) {
    c.fillStyle = '#0b14118a';
    c.beginPath();
    c.ellipse(x + 18, y + 18, s * .9, s * .5, .6, 0, TAU);
    c.fill();
    c.fillStyle = '#403826';
    c.fillRect(x - 3, y - 10, 6, 30);
    if (pine) {
      const colors = ['#172a25', '#22372f', '#304638'];
      for (let i = 0; i < 3; i++) {
        c.fillStyle = colors[i];
        c.beginPath();
        c.moveTo(x, y - s * 1.5 + i * s * .18);
        c.lineTo(x - s * (.8 - i * .2), y + s * (.35 - i * .3));
        c.lineTo(x + s * (.7 - i * .2), y + s * (.35 - i * .3));
        c.closePath();
        c.fill();
      }
      c.strokeStyle = '#87905f1e';
      c.beginPath();
      c.moveTo(x - 2, y - s * 1.4);
      c.lineTo(x - s * .58, y + s * .07);
      c.stroke();
    } else {
      const palette = tint > .84 ? ['#4a422a', '#625735', '#796842'] : tint > .5 ? ['#263b2c', '#38503a', '#4c6042'] : ['#1d332c', '#2e4638', '#3e5642'];
      c.fillStyle = palette[0];
      c.beginPath();
      for (let i = 0; i < 13; i++) {
        const angle = i / 13 * TAU;
        const rad = s * (.8 + Math.sin(i * 8 + tint * 10) * .17);
        const px = x + Math.cos(angle) * rad;
        const py = y - 14 + Math.sin(angle) * rad * .8;
        i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
      }
      c.closePath();
      c.fill();
      for (let j = 0; j < 6; j++) {
        const a = j * 2.4;
        c.fillStyle = palette[j % 2 + 1];
        c.beginPath();
        c.ellipse(x + Math.cos(a) * s * .36 - 4, y - 21 + Math.sin(a) * s * .3, s * .47, s * .37, a, 0, TAU);
        c.fill();
      }
      c.fillStyle = '#9ba06b12';
      c.beginPath();
      c.ellipse(x - 10, y - s * .45, s * .42, s * .23, -.6, 0, TAU);
      c.fill();
    }
  }

  private resetRaidFx() {
    this.prevHp.clear();
    this.fireEmbers = [];
    this.hitParticles = [];
    this.blood = [];
    this.damageNumbers = [];
    this.rings = [];
    this.shake = 0;
    this.emberClock = 0;
  }

  private observeHp(state: GameState, playerId: string, lobby: boolean) {
    const seen = new Set<string>();
    const actors: Actor[] = [...state.enemies, ...state.players];
    for (const actor of actors) {
      seen.add(actor.id);
      const oldHp = this.prevHp.get(actor.id);
      if (!lobby && oldHp !== undefined && actor.hp < oldHp) this.spawnHit(actor, oldHp - actor.hp, actor.id === playerId, actor.hp <= 0);
      this.prevHp.set(actor.id, actor.hp);
    }
    for (const id of this.prevHp.keys()) if (!seen.has(id)) this.prevHp.delete(id);
  }

  private spawnHit(actor: Actor, loss: number, self: boolean, defeated: boolean) {
    const amount = Math.max(1, Math.round(loss));
    const color = self ? '#ff7a5c' : amount >= 25 ? '#ffcf6b' : '#f2ead6';
    this.damageNumbers.push({ x: actor.x + (this.random() - .5) * 12, y: actor.y - 30, value: amount, life: .8, maxLife: .8, color, size: self ? 17 : amount >= 25 ? 19 : 15 });
    if (this.damageNumbers.length > 26) this.damageNumbers.splice(0, this.damageNumbers.length - 26);

    if (this.reducedMotion) return;
    this.rings.push({ x: actor.x, y: actor.y, life: .32, maxLife: .32, from: 9, to: 58, color: self ? '#ff805f' : '#ffd78d', width: 2.2, glow: true });
    this.addBlood(actor.x, actor.y, defeated ? 19 : 11, defeated ? .65 : .44);
    const droplets = defeated ? 20 : 9;
    for (let i = 0; i < droplets; i++) {
      const angle = this.random() * TAU;
      const speed = (defeated ? 42 : 26) + this.random() * (defeated ? 105 : 72);
      const life = .32 + this.random() * .45;
      this.hitParticles.push({
        x: actor.x + Math.cos(angle) * 5,
        y: actor.y - 4 + Math.sin(angle) * 5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 38,
        life,
        maxLife: life,
        size: 1.5 + this.random() * (defeated ? 3.5 : 2.4),
        color: i % 3 === 0 ? '#ffd18a' : '#7f2022',
        gravity: i % 3 === 0 ? 18 : 165,
        glow: i % 3 === 0,
      });
    }
    if (this.hitParticles.length > 150) this.hitParticles.splice(0, this.hitParticles.length - 150);

    if (self) this.shake = Math.min(12, this.shake + 7);
    if (defeated) {
      this.rings.push({ x: actor.x, y: actor.y, life: .65, maxLife: .65, from: 20, to: 240, color: '#8d2427', width: 3, glow: true });
      this.shake = Math.min(12, this.shake + 3.5);
      for (let i = 0; i < 14; i++) {
        const angle = this.random() * TAU;
        const speed = 80 + this.random() * 145;
        const life = .38 + this.random() * .36;
        this.hitParticles.push({ x: actor.x, y: actor.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 24, life, maxLife: life, size: 2 + this.random() * 3, color: '#6f1e25', gravity: 92, glow: false });
      }
    }
  }

  private addBlood(x: number, y: number, size: number, alpha: number) {
    this.blood.push({ x: x + (this.random() - .5) * 10, y: y + 8 + (this.random() - .5) * 8, size, rotation: this.random() * TAU, alpha });
    if (this.blood.length > 48) this.blood.splice(0, this.blood.length - 48);
  }

  private spawnEmber() {
    const [x, y] = FIRES[Math.floor(this.random() * FIRES.length)];
    const life = .9 + this.random() * 1.35;
    this.fireEmbers.push({
      x: x + (this.random() - .5) * 13,
      y: y - 6 + (this.random() - .5) * 5,
      vx: (this.random() - .5) * 14,
      vy: -22 - this.random() * 34,
      life,
      maxLife: life,
      size: 1 + this.random() * 1.9,
      color: this.random() > .35 ? '#ffbf66' : '#ff713f',
      gravity: -5,
      glow: true,
    });
  }

  private advanceFx(dt: number) {
    const motion = !this.reducedMotion;
    if (motion) {
      if (!this.fireEmbers.length) for (let i = 0; i < 12; i++) this.spawnEmber();
      this.emberClock += dt;
      while (this.emberClock >= .07 && this.fireEmbers.length < 48) {
        this.emberClock -= .07;
        this.spawnEmber();
      }
      for (const particle of this.fireEmbers) {
        particle.life -= dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += particle.gravity * dt;
      }
      this.fireEmbers = this.fireEmbers.filter(particle => particle.life > 0);
      for (const particle of this.hitParticles) {
        particle.life -= dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += particle.gravity * dt;
      }
      this.hitParticles = this.hitParticles.filter(particle => particle.life > 0);
      for (const ring of this.rings) ring.life -= dt;
      this.rings = this.rings.filter(ring => ring.life > 0);
      this.shake *= Math.pow(.06, dt);
    } else {
      this.fireEmbers = [];
      this.hitParticles = [];
      this.rings = [];
      this.shake = 0;
    }

    for (const number of this.damageNumbers) {
      number.life -= dt;
      if (!this.reducedMotion) number.y -= 29 * dt / Math.max(.55, this.camera.zoom);
    }
    this.damageNumbers = this.damageNumbers.filter(number => number.life > 0);
  }

  draw(state: GameState, playerId: string, lobby: boolean, fullMap: boolean, time: number, aim?: Aim) {
    const c = this.ctx;
    const w = this.width;
    const h = this.height;
    if (!w || !h) return;

    if (lobby && !this.wasLobby) this.resetRaidFx();
    this.wasLobby = lobby;
    const dt = this.lastDrawTime === null ? 1 / 60 : Math.min(.1, Math.max(0, time - this.lastDrawTime));
    this.lastDrawTime = time;
    this.observeHp(state, playerId, lobby);
    this.advanceFx(dt);

    const p = state.players.find(player => player.id === playerId);
    if (lobby) {
      this.camera.x = 1050;
      this.camera.y = 895;
      this.camera.zoom = Math.max(w / 1800, h / 1360);
    } else if (fullMap) {
      this.camera.x = 1200;
      this.camera.y = 900;
      this.camera.zoom = Math.min(w / 2460, h / 1860);
    } else if (p) {
      this.camera.x += (p.x - this.camera.x) * .13;
      this.camera.y += (p.y - this.camera.y) * .13;
      this.camera.zoom += (1.16 - this.camera.zoom) * .1;
    }

    this.shakeX = this.reducedMotion ? 0 : Math.sin(time * 89.7) * this.shake * .72;
    this.shakeY = this.reducedMotion ? 0 : Math.cos(time * 117.1) * this.shake * .52;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#0b1411';
    c.fillRect(0, 0, w, h);
    c.save();
    c.translate(w / 2 + this.shakeX, h / 2 + this.shakeY);
    c.scale(this.camera.zoom, this.camera.zoom);
    c.translate(-this.camera.x, -this.camera.y);
    c.drawImage(this.terrain, 0, 0);

    this.drawBlood(c);
    if (!lobby && p && !fullMap) this.drawPlayerAura(c, p);
    this.drawFires(c, time);
    this.drawFireEmbers(c);
    this.drawLoot(c, state, lobby, time);
    this.drawExits(c);
    for (const enemy of state.enemies) if (enemy.hp > 0 && !lobby) this.actor(c, enemy, false, false, enemy.kind);
    this.drawArrows(c, state);
    for (const player of state.players) if (player.status !== 'extracted' && !lobby) this.actor(c, player, true, player.id === playerId);
    for (const enemy of state.enemies) if (enemy.hp > 0 && enemy.swing > 0 && !lobby) this.drawSlash(c, enemy, false);
    for (const player of state.players) {
      if (player.status !== 'alive' || player.swing <= 0 || player.weapon === 'bow' || lobby) continue;
      this.drawSlash(c, player, player.id === playerId);
    }
    this.drawCombatFx(c);

    if (lobby) {
      this.mapLabel(c, 903, 655, '01', '灰の集落', true);
      this.mapLabel(c, 1485, 300, '02', '忘れられた修道院', false);
      this.mapLabel(c, 1580, 1180, '03', '野盗の野営地', false);
      c.save();
      c.translate(460, 1310);
      c.rotate(Math.PI / 4);
      c.fillStyle = '#d5b185';
      c.fillRect(-6, -6, 12, 12);
      c.restore();
      c.font = '12px "Noto Sans JP", sans-serif';
      c.fillStyle = '#d3cfb9';
      c.fillText('出撃地点', 482, 1314);
    }
    c.restore();

    this.drawAtmosphere(c, w, h, lobby, p, time);
    if (!lobby && p && !fullMap) this.minimap(c, state, p, w - 160, h < 430 ? 52 : 62);
    if (!lobby && !fullMap && aim) this.drawReticle(c, aim, time);
  }

  private drawPlayerAura(c: CanvasRenderingContext2D, p: Player) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    const glow = c.createRadialGradient(p.x, p.y, 8, p.x, p.y, 260);
    glow.addColorStop(0, '#ffd38b42');
    glow.addColorStop(.18, '#e9a44e24');
    glow.addColorStop(.55, '#b7652b0d');
    glow.addColorStop(1, '#b7652b00');
    c.fillStyle = glow;
    c.fillRect(p.x - 260, p.y - 260, 520, 520);
    c.restore();
  }

  private drawFires(c: CanvasRenderingContext2D, time: number) {
    for (let i = 0; i < FIRES.length; i++) {
      const [x, y] = FIRES[i];
      const wobble = this.reducedMotion ? 0 : Math.sin(time * 6.5 + i * 1.7) * 4 + Math.sin(time * 11.7 + i) * 2;
      c.save();
      c.globalCompositeOperation = 'lighter';
      const glow = c.createRadialGradient(x, y, 1, x, y, 96 + wobble);
      glow.addColorStop(0, '#ffd07a62');
      glow.addColorStop(.22, '#ff9a3e35');
      glow.addColorStop(.58, '#d9632416');
      glow.addColorStop(1, '#d9632400');
      c.fillStyle = glow;
      c.fillRect(x - 106, y - 106, 212, 212);
      c.restore();

      c.fillStyle = '#17130f';
      c.beginPath();
      c.ellipse(x, y + 4, 15, 9, 0, 0, TAU);
      c.fill();
      c.strokeStyle = '#55351f';
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(x - 10, y + 5);
      c.lineTo(x + 10, y - 1);
      c.moveTo(x - 9, y - 1);
      c.lineTo(x + 11, y + 6);
      c.stroke();
      const flameLean = this.reducedMotion ? 0 : Math.sin(time * 8 + i) * 3;
      c.fillStyle = '#f16b2d';
      c.beginPath();
      c.moveTo(x - 8, y + 4);
      c.quadraticCurveTo(x - 11 + flameLean, y - 9, x + flameLean * .7, y - 27 - wobble * .35);
      c.quadraticCurveTo(x + 12, y - 8, x + 8, y + 4);
      c.closePath();
      c.fill();
      c.fillStyle = '#ffd477';
      c.beginPath();
      c.moveTo(x - 4, y + 3);
      c.quadraticCurveTo(x - 3 + flameLean * .4, y - 6, x + flameLean * .45, y - 17 - wobble * .2);
      c.quadraticCurveTo(x + 6, y - 6, x + 4, y + 3);
      c.closePath();
      c.fill();
    }
  }

  private drawFireEmbers(c: CanvasRenderingContext2D) {
    if (this.reducedMotion) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const ember of this.fireEmbers) {
      const alpha = Math.max(0, ember.life / ember.maxLife);
      c.globalAlpha = alpha * .9;
      c.fillStyle = ember.color;
      c.shadowColor = ember.color;
      c.shadowBlur = 6;
      c.beginPath();
      c.arc(ember.x, ember.y, ember.size, 0, TAU);
      c.fill();
    }
    c.restore();
  }

  private drawLoot(c: CanvasRenderingContext2D, state: GameState, lobby: boolean, time: number) {
    for (const loot of state.loot) {
      if (loot.opened) continue;
      c.save();
      c.translate(loot.x, loot.y);
      c.fillStyle = '#0b14118a';
      c.beginPath();
      c.ellipse(4, 8, 20, 10, 0, 0, TAU);
      c.fill();
      if (loot.kind === 'herb') {
        for (let i = 0; i < 5; i++) {
          c.fillStyle = i % 2 ? '#7f925f' : '#4f724b';
          c.beginPath();
          c.ellipse(Math.cos(i * 2.4) * 8, Math.sin(i * 2.4) * 8, 4, 10, i * 2.4, 0, TAU);
          c.fill();
        }
      } else if (loot.kind === 'body') {
        c.fillStyle = '#63483a';
        c.beginPath();
        c.ellipse(0, 0, 13, 10, .4, 0, TAU);
        c.fill();
        c.strokeStyle = '#8c7655';
        c.stroke();
      } else {
        c.fillStyle = '#5b3e2d';
        c.fillRect(-15, -10, 30, 22);
        c.fillStyle = '#805b3d';
        c.fillRect(-15, -11, 30, 7);
        c.fillStyle = '#a38a57';
        c.fillRect(-10, -11, 3, 23);
        c.fillRect(8, -11, 3, 23);
        c.fillStyle = '#c1a96f';
        c.fillRect(-3, -2, 6, 5);
      }
      if (!lobby) {
        c.strokeStyle = '#d5b87c80';
        c.lineWidth = 1.3;
        c.beginPath();
        c.arc(0, 0, 23 + (this.reducedMotion ? 0 : Math.sin(time * 3) * 2), 0, TAU);
        c.stroke();
      }
      c.restore();
    }
  }

  private drawExits(c: CanvasRenderingContext2D) {
    for (const exit of EXITS) {
      c.save();
      c.translate(exit.x, exit.y);
      c.strokeStyle = '#a1b58b99';
      c.fillStyle = '#a1b58b0b';
      c.lineWidth = 1.5;
      c.setLineDash([8, 8]);
      c.beginPath();
      c.arc(0, 0, 62, 0, TAU);
      c.stroke();
      c.fill();
      c.setLineDash([]);
      c.strokeStyle = '#bed4a3';
      c.lineWidth = 2.5;
      c.strokeRect(-12, -14, 18, 25);
      c.beginPath();
      c.moveTo(-3, 0);
      c.lineTo(20, 0);
      c.moveTo(13, -7);
      c.lineTo(20, 0);
      c.lineTo(13, 7);
      c.stroke();
      c.font = '12px "Noto Sans JP", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#d9e2bd';
      c.fillText(exit.name, 0, 87);
      c.restore();
    }
  }

  private drawArrows(c: CanvasRenderingContext2D, state: GameState) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const arrow of state.arrows) {
      const tailX = arrow.x - arrow.vx * .042;
      const tailY = arrow.y - arrow.vy * .042;
      const trail = c.createLinearGradient(tailX, tailY, arrow.x, arrow.y);
      trail.addColorStop(0, '#ffcf7a00');
      trail.addColorStop(.56, '#e9b85b88');
      trail.addColorStop(1, '#fff1bd');
      c.strokeStyle = trail;
      c.lineWidth = 4;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(tailX, tailY);
      c.lineTo(arrow.x, arrow.y);
      c.stroke();
      c.strokeStyle = '#fff3c4';
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(tailX, tailY);
      c.lineTo(arrow.x, arrow.y);
      c.stroke();
      const angle = Math.atan2(arrow.vy, arrow.vx);
      c.fillStyle = '#fff5cf';
      c.shadowColor = '#ffd27a';
      c.shadowBlur = 10;
      c.beginPath();
      c.moveTo(arrow.x + Math.cos(angle) * 5, arrow.y + Math.sin(angle) * 5);
      c.lineTo(arrow.x + Math.cos(angle + 2.5) * 4, arrow.y + Math.sin(angle + 2.5) * 4);
      c.lineTo(arrow.x + Math.cos(angle - 2.5) * 4, arrow.y + Math.sin(angle - 2.5) * 4);
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  private drawBlood(c: CanvasRenderingContext2D) {
    for (const decal of this.blood) {
      c.save();
      c.translate(decal.x, decal.y);
      c.rotate(decal.rotation);
      c.globalAlpha = decal.alpha;
      c.fillStyle = '#581e23';
      c.beginPath();
      c.ellipse(0, 0, decal.size, decal.size * .42, 0, 0, TAU);
      c.fill();
      c.fillStyle = '#8a2b2d';
      c.globalAlpha = decal.alpha * .48;
      c.beginPath();
      c.ellipse(-decal.size * .2, -decal.size * .1, decal.size * .45, decal.size * .16, 0, 0, TAU);
      c.fill();
      c.restore();
    }
  }

  private drawCombatFx(c: CanvasRenderingContext2D) {
    if (!this.reducedMotion) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const ring of this.rings) {
        const age = 1 - ring.life / ring.maxLife;
        const eased = 1 - (1 - age) * (1 - age);
        c.globalAlpha = (1 - age) * .9;
        c.strokeStyle = ring.color;
        c.lineWidth = ring.width;
        c.shadowColor = ring.glow ? ring.color : 'transparent';
        c.shadowBlur = ring.glow ? 11 : 0;
        c.beginPath();
        c.arc(ring.x, ring.y, ring.from + (ring.to - ring.from) * eased, 0, TAU);
        c.stroke();
      }
      for (const particle of this.hitParticles) {
        const alpha = Math.max(0, particle.life / particle.maxLife);
        c.globalAlpha = alpha;
        c.fillStyle = particle.color;
        c.shadowColor = particle.glow ? particle.color : 'transparent';
        c.shadowBlur = particle.glow ? 10 : 0;
        c.beginPath();
        c.arc(particle.x, particle.y, particle.size * (.6 + alpha * .4), 0, TAU);
        c.fill();
      }
      c.restore();
    }

    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const number of this.damageNumbers) {
      const alpha = Math.max(0, number.life / number.maxLife);
      c.globalAlpha = alpha;
      c.font = `700 ${number.size / Math.max(.55, this.camera.zoom)}px Georgia, "Noto Sans JP", serif`;
      c.fillStyle = number.color;
      c.strokeStyle = '#0b1411cc';
      c.lineWidth = 3 / Math.max(.55, this.camera.zoom);
      c.shadowColor = number.color;
      c.shadowBlur = 8 / Math.max(.55, this.camera.zoom);
      c.strokeText(String(number.value), number.x, number.y);
      c.fillText(String(number.value), number.x, number.y);
    }
    c.restore();
  }

  private drawSlash(c: CanvasRenderingContext2D, actor: Actor, self: boolean) {
    const duration = self ? .22 : .3;
    const progress = Math.max(0, Math.min(1, 1 - actor.swing / duration));
    const warm = self ? '#ffd27c' : '#ff6b5c';
    const pale = self ? '#fff0b8' : '#ffb19b';
    c.save();
    c.translate(actor.x, actor.y);
    c.rotate(actor.angle);
    c.globalCompositeOperation = 'lighter';
    for (let layer = 0; layer < 3; layer++) {
      const radius = (self ? 53 : 39) + layer * 4;
      c.globalAlpha = (.72 - layer * .18) * (1 - progress * .32);
      c.strokeStyle = layer === 0 ? pale : warm;
      c.lineWidth = (6 - layer * 1.4) / Math.max(.7, this.camera.zoom);
      c.shadowColor = warm;
      c.shadowBlur = (14 - layer * 3) / Math.max(.7, this.camera.zoom);
      c.beginPath();
      c.arc(0, 0, radius, -2.35 + progress * .7 + layer * .035, .46 + progress * .72 + layer * .02);
      c.stroke();
    }
    const trail = c.createLinearGradient(6, 0, 72, 0);
    trail.addColorStop(0, `${warm}00`);
    trail.addColorStop(.5, warm);
    trail.addColorStop(1, pale);
    c.globalAlpha = .82 * (1 - progress * .25);
    c.strokeStyle = trail;
    c.lineWidth = 3 / Math.max(.7, this.camera.zoom);
    c.beginPath();
    c.moveTo(12, -7);
    c.quadraticCurveTo(38 + progress * 11, -25, 70 + progress * 8, -12);
    c.stroke();
    c.restore();
  }

  private drawAtmosphere(c: CanvasRenderingContext2D, w: number, h: number, lobby: boolean, p: Player | undefined, time: number) {
    const vignette = c.createRadialGradient(w * .5, h * .1, h * .1, w * .5, h * .1, Math.max(w, h) * .76);
    vignette.addColorStop(0, '#070e0d00');
    vignette.addColorStop(.57, '#070e0d20');
    vignette.addColorStop(1, '#070e0da8');
    c.fillStyle = vignette;
    c.fillRect(0, 0, w, h);
    const top = c.createLinearGradient(0, 0, 0, h);
    top.addColorStop(0, '#07100e65');
    top.addColorStop(.4, '#80908007');
    top.addColorStop(1, '#070e0d38');
    c.fillStyle = top;
    c.fillRect(0, 0, w, h);
    if (!this.reducedMotion) {
      for (let i = 0; i < 25; i++) {
        const x = (i * 137.9 + time * (3 + i % 4)) % w;
        const y = (i * 81.4 - time * 6 + h * 100) % h;
        c.fillStyle = `rgba(221,210,168,${.09 + Math.sin(time + i) * .06})`;
        c.fillRect(x, y, i % 3 === 0 ? 2 : 1, 2);
      }
    }
    if (!lobby && p?.hurt) {
      c.fillStyle = `rgba(165,48,34,${p.hurt * .65})`;
      c.fillRect(0, 0, w, h);
    }
  }

  private drawReticle(c: CanvasRenderingContext2D, aim: Aim, time: number) {
    const x = this.width / 2 + (aim.x - this.camera.x) * this.camera.zoom + this.shakeX;
    const y = this.height / 2 + (aim.y - this.camera.y) * this.camera.zoom + this.shakeY;
    if (x < -28 || x > this.width + 28 || y < -28 || y > this.height + 28) return;
    const pulse = aim.hot && !this.reducedMotion ? Math.sin(time * 15) * 1.6 + 1.8 : 0;
    const color = aim.hot ? '#ffd17d' : '#e4dfc4';
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 1.5;
    c.shadowColor = aim.hot ? '#ff9d4b' : '#d9cfaa';
    c.shadowBlur = aim.hot ? 11 : 4;
    c.globalAlpha = .95;
    c.beginPath();
    c.arc(x, y, 13 + pulse, 0, TAU);
    c.stroke();
    const inner = 16 + pulse;
    const outer = 21 + pulse;
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      c.beginPath();
      c.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
      c.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
      c.stroke();
    }
    c.beginPath();
    c.arc(x, y, 2.1, 0, TAU);
    c.fill();
    c.restore();
  }

  private mapLabel(c: CanvasRenderingContext2D, x: number, y: number, n: string, text: string, main: boolean) {
    c.save();
    c.translate(x, y);
    c.fillStyle = '#0b1411e8';
    c.strokeStyle = main ? '#ba9c69' : '#95a59166';
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(-17, -20, 34, 34, 2);
    c.fill();
    c.stroke();
    c.font = '13px Georgia';
    c.fillStyle = main ? '#d7bb86' : '#c2c7ac';
    c.textAlign = 'center';
    c.fillText(n, 0, 2);
    c.fillStyle = '#0b1411dc';
    c.fillRect(-text.length * 7 - 12, 24, text.length * 14 + 24, 28);
    c.font = '13px "Noto Sans JP", sans-serif';
    c.fillStyle = '#e0dfc6';
    c.fillText(text, 0, 43);
    c.restore();
  }

  private actor(c: CanvasRenderingContext2D, actor: Actor, player: boolean, self: boolean, kind = '') {
    c.save();
    c.translate(actor.x, actor.y);
    if (actor.hp <= 0) {
      c.fillStyle = '#5d202699';
      c.beginPath();
      c.ellipse(0, 0, 18, 11, .4, 0, TAU);
      c.fill();
      c.restore();
      return;
    }
    c.fillStyle = '#0b1411a8';
    c.beginPath();
    c.ellipse(3, 9, 17, 11, 0, 0, TAU);
    c.fill();
    if (self) {
      c.strokeStyle = '#e8d29a99';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(0, 0, 23, 0, TAU);
      c.stroke();
    }
    c.save();
    c.rotate(actor.angle + Math.PI / 2);
    if (kind === 'wolf') {
      c.fillStyle = actor.hurt ? '#c6a789' : '#777b71';
      c.beginPath();
      c.ellipse(0, 1, 10, 18, 0, 0, TAU);
      c.fill();
      c.fillStyle = '#aaad98';
      c.beginPath();
      c.moveTo(-8, -8);
      c.lineTo(-10, -20);
      c.lineTo(-4, -16);
      c.lineTo(0, -26);
      c.lineTo(5, -16);
      c.lineTo(10, -20);
      c.lineTo(8, -8);
      c.fill();
    } else {
      c.fillStyle = '#25251f';
      c.fillRect(-9, 9, 7, 9);
      c.fillRect(3, 9, 7, 9);
      c.fillStyle = actor.hurt ? '#dba88c' : self ? '#a99b70' : player ? '#8d665d' : kind === 'knight' ? '#73807b' : '#704d3d';
      c.beginPath();
      c.moveTo(-13, -7);
      c.quadraticCurveTo(0, -14, 13, -7);
      c.lineTo(15, 15);
      c.quadraticCurveTo(0, 21, -14, 14);
      c.closePath();
      c.fill();
      c.fillStyle = self ? '#3f5d4d' : '#383d31';
      c.fillRect(-8, 0, 16, 11);
      c.fillStyle = '#b09f83';
      c.beginPath();
      c.arc(0, -8, 8, 0, TAU);
      c.fill();
      c.fillStyle = '#515c56';
      c.beginPath();
      c.arc(0, -10, 8, Math.PI, TAU);
      c.fill();
      c.fillRect(-8, -11, 16, 3);
      const bow = player && (actor as Player).weapon === 'bow';
      c.save();
      c.translate(16, -2);
      c.rotate(actor.swing > 0 ? -1 + actor.swing * 9 : .2);
      if (bow) {
        c.strokeStyle = '#ac8d5d';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(0, -3, 20, -Math.PI / 2, Math.PI / 2);
        c.stroke();
        c.strokeStyle = '#d1c29c';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(0, -23);
        c.lineTo(0, 17);
        c.stroke();
      } else {
        c.fillStyle = '#c7cbbb';
        c.beginPath();
        c.moveTo(-2, 1);
        c.lineTo(-3, -26);
        c.lineTo(0, -33);
        c.lineTo(3, -26);
        c.lineTo(2, 1);
        c.fill();
        c.fillStyle = '#9f8c61';
        c.fillRect(-7, 0, 14, 3);
        c.fillStyle = '#523a29';
        c.fillRect(-2, 3, 4, 9);
      }
      c.restore();
      c.fillStyle = '#54472f';
      c.beginPath();
      c.ellipse(-15, -2, 6, 12, .2, 0, TAU);
      c.fill();
      c.strokeStyle = '#978c6e';
      c.lineWidth = 2;
      c.stroke();
    }
    c.restore();
    if (!self) {
      c.fillStyle = '#101712';
      c.fillRect(-17, -34, 34, 4);
      c.fillStyle = player ? '#b56e60' : '#a9895b';
      c.fillRect(-17, -34, 34 * actor.hp / actor.maxHp, 4);
    }
    if (player && !self) {
      c.font = '10px "Noto Sans JP", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#e6d7be';
      c.fillText((actor as Player).name, 0, -41);
    }
    c.restore();
  }

  private minimap(c: CanvasRenderingContext2D, state: GameState, p: Player, x: number, y: number) {
    c.save();
    c.fillStyle = '#0b1411ed';
    c.fillRect(x - 7, y - 7, 150, 118);
    c.strokeStyle = '#999d7055';
    c.lineWidth = 1;
    c.strokeRect(x - 7, y - 7, 150, 118);
    c.globalAlpha = .65;
    c.drawImage(this.terrain, x, y, 136, 102);
    c.globalAlpha = 1;
    for (const exit of EXITS) {
      c.fillStyle = '#c5d9a3';
      c.fillRect(x + exit.x / WORLD.width * 136 - 2, y + exit.y / WORLD.height * 102 - 2, 4, 4);
    }
    // Living hostiles are deliberately visible on the tactical view.
    c.fillStyle = '#df554f';
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0) continue;
      c.fillRect(x + enemy.x / WORLD.width * 136 - 1.5, y + enemy.y / WORLD.height * 102 - 1.5, 3, 3);
    }
    c.fillStyle = '#ffdb9a';
    c.beginPath();
    c.arc(x + p.x / WORLD.width * 136, y + p.y / WORLD.height * 102, 3, 0, TAU);
    c.fill();
    c.fillStyle = '#c5c9b3';
    c.font = '9px "Noto Sans JP", sans-serif';
    c.fillText('M  戦域マップ', x, y - 14);
    c.restore();
  }
}
