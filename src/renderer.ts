import { hasSwordArt, LONGSWORD_URL, swordSpriteRect } from './weaponArt';
import { chestMaterial, dominantElement, ELEMENT_COLORS, facingPose, swingPose, weaponAppearance } from './appearance';
import { BUILDINGS, EXITS, ITEMS, WORLD, seeded, type Actor, type GameState, type Item, type Player } from './game';
import { RARITIES, baseOf, isGear, type Gear, type Rarity } from './items';

const TAU = Math.PI * 2;
/** Braziers that anchor the warm pools of light in the ruined village. Audio uses these for crackle placement. */
export const FIRES: readonly [number, number][] = [[811, 1046], [1270, 780], [1570, 660]];
/** High-DPI canvases are capped near this many backbuffer pixels; phones still keep up to 2x. */
const MAX_BACKBUFFER_PIXELS = 2_000_000;
/** Extra screen pixels kept around the visible rectangle so screen shake never reveals a culling edge. */
const VIEW_MARGIN_PX = 16;
/** Characters are painted at this multiple of their collision size so they stay readable. */
const ACTOR_SCALE = 1.34;
const MINIMAP_W = 136;
const MINIMAP_H = 102;
/** The lighting field is solved at this fraction of the viewport and upsampled, so light cost is resolution independent. */
const LIGHT_SCALE = .22;
/** Ash-grey darkness that multiplies over the scene; lights add back on top of it. */
const AMBIENT_RAID = '#626875';
const AMBIENT_MAP = '#828b99';
const AMBIENT_BASE = '#98a0ac';

/** Item rarity drives the loot beam, ground glow and label colour, exactly like an action RPG drop filter. */
const RARITY: Record<string, { color: string; beam: number; glow: number }> = {
  normal: { color: '#cfd2c2', beam: 0, glow: .18 },
  magic: { color: '#6d8cf0', beam: 46, glow: .3 },
  rare: { color: '#f0dc63', beam: 74, glow: .42 },
  unique: { color: '#ff9a3c', beam: 112, glow: .6 },
  // Legacy names kept so older data still renders.
  common: { color: '#cfd2c2', beam: 0, glow: .18 },
  uncommon: { color: '#6d8cf0', beam: 46, glow: .3 },
  epic: { color: '#bb74ef', beam: 104, glow: .55 },
};

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
/** A short-lived melee slash or bow muzzle flash spawned when an accepted attack lands. */
type AttackFx = { x: number; y: number; angle: number; life: number; maxLife: number; range: number; color: string; kind: 'melee' | 'bow'; };
/** A pooled light: warm braziers, cold waypoints, rarity beams and the player's own aura. */
type Light = { x: number; y: number; radius: number; r: number; g: number; b: number; intensity: number; flicker: number };

/** Canvas presentation layer. It intentionally only observes GameState: combat rules stay in game.ts. */
export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  terrain: HTMLCanvasElement;
  /** Pre-scaled terrain for the tactical minimap, built once instead of scaling the full world every frame. */
  private minimapTerrain: HTMLCanvasElement;
  /** Static vignette and top haze, rebuilt only when the canvas size changes. */
  private atmosphere: HTMLCanvasElement | null = null;
  /** Downscaled lighting field. Multiplied over the scene so tiles far from a flame fall into ash-grey shadow. */
  private lightMap: HTMLCanvasElement;
  private lightCtx: CanvasRenderingContext2D;
  /** Two-stage downsample used for the additive bloom pass. */
  private bloomA: HTMLCanvasElement;
  private bloomACtx: CanvasRenderingContext2D;
  private bloomB: HTMLCanvasElement;
  private bloomBCtx: CanvasRenderingContext2D;
  /** Tiling grain plate for the film-grain pass. */
  private grain: HTMLCanvasElement;
  /** The grain plate pre-tiled across the viewport, rebuilt only on resize. */
  private grainView: HTMLCanvasElement | null = null;
  /** Drifting mist plate. */
  private mist: HTMLCanvasElement;
  private view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  camera = { x: 1040, y: 930, zoom: .69 };
  width = 0;
  height = 0;
  dpr = 1;
  /** Set by main.ts every frame so visual accessibility never changes gameplay. */
  reducedMotion = false;

  /** The frame's state, cached so the lighting pass can read it without threading it through every call. */
  private lastState: GameState;
  private trees: Tree[] = [];
  /** Lanterns and sconces baked into the world art, kept as light sources. */
  private lanterns: { x: number; y: number; hue: number }[] = [];
  private observer: ResizeObserver;
  private prevHp = new Map<string, number>();
  private defeatedAt = new Map<string, number>();
  private fireEmbers: FxParticle[] = [];
  private hitParticles: FxParticle[] = [];
  private blood: BloodDecal[] = [];
  private damageNumbers: DamageNumber[] = [];
  private rings: RingFx[] = [];
  private attackFx: AttackFx[] = [];
  private prevAttackSerial = new Map<string, number>();
  private lastDrawTime: number | null = null;
  private emberClock = 0;
  private randomState = 0x4a534845;
  private shake = 0;
  // A reusable isolated actor surface: material shading cannot touch the terrain underneath.
  private swordImage = new Image();
  private figure = document.createElement('canvas');
  private figureCtx: CanvasRenderingContext2D | null = null;
  private materialGrain: CanvasPattern | null = null;
  private gait = new Map<string, { x: number; y: number; phase: number; speed: number }>();
  private wasLobby = true;
  private shakeX = 0;
  private shakeY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.swordImage.src = LONGSWORD_URL;
    this.canvas = canvas;
    this.lastState = { time: 0, duration: 0, players: [], enemies: [], loot: [], arrows: [], pvp: false, ended: false, sequence: 0, rng: 0x9E3779B9 };
    this.ctx = canvas.getContext('2d')!;
    this.terrain = document.createElement('canvas');
    this.terrain.width = WORLD.width;
    this.terrain.height = WORLD.height;
    this.buildTerrain();
    this.minimapTerrain = document.createElement('canvas');
    this.minimapTerrain.width = MINIMAP_W * 2;
    this.minimapTerrain.height = MINIMAP_H * 2;
    const mm = this.minimapTerrain.getContext('2d')!;
    mm.drawImage(this.terrain, 0, 0, this.minimapTerrain.width, this.minimapTerrain.height);
    mm.fillStyle = '#0a0f14cc';
    mm.fillRect(0, 0, this.minimapTerrain.width, this.minimapTerrain.height);

    this.lightMap = document.createElement('canvas');
    this.lightCtx = this.lightMap.getContext('2d')!;
    this.bloomA = document.createElement('canvas');
    this.bloomACtx = this.bloomA.getContext('2d')!;
    this.bloomB = document.createElement('canvas');
    this.bloomBCtx = this.bloomB.getContext('2d')!;
    this.grain = document.createElement('canvas');
    this.mist = document.createElement('canvas');
    this.buildPlates();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    // Scale down only on high-DPI screens whose backbuffer would exceed the pixel budget.
    const area = Math.max(1, r.width * r.height);
    this.dpr = Math.max(1, Math.min(devicePixelRatio, 2, Math.sqrt(MAX_BACKBUFFER_PIXELS / area)));
    this.canvas.width = Math.max(1, Math.floor(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * this.dpr));
    const lw = Math.max(2, Math.ceil(r.width * LIGHT_SCALE));
    const lh = Math.max(2, Math.ceil(r.height * LIGHT_SCALE));
    this.lightMap.width = lw;
    this.lightMap.height = lh;
    this.lightCtx = this.lightMap.getContext('2d')!;
    this.bloomA.width = Math.max(2, Math.ceil(r.width / 6));
    this.bloomA.height = Math.max(2, Math.ceil(r.height / 6));
    this.bloomB.width = Math.max(2, Math.ceil(r.width / 16));
    this.bloomB.height = Math.max(2, Math.ceil(r.height / 16));
    this.bloomACtx = this.bloomA.getContext('2d')!;
    this.bloomBCtx = this.bloomB.getContext('2d')!;
    this.buildGrainView();
    this.buildAtmosphere();
  }

  /** Film grain and mist plates never change, so they are generated once at construction. */
  private buildPlates() {
    this.grain.width = 160;
    this.grain.height = 160;
    const g = this.grain.getContext('2d')!;
    const image = g.createImageData(160, 160);
    const r = seeded(7771);
    for (let i = 0; i < image.data.length; i += 4) {
      const v = 118 + r() * 137;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 44;
    }
    g.putImageData(image, 0, 0);

    this.mist.width = 320;
    this.mist.height = 200;
    const m = this.mist.getContext('2d')!;
    const mr = seeded(4242);
    for (let i = 0; i < 70; i++) {
      const x = mr() * 320;
      const y = mr() * 200;
      const rad = 34 + mr() * 60;
      const blob = m.createRadialGradient(x, y, 0, x, y, rad);
      blob.addColorStop(0, 'rgba(196,208,220,.14)');
      blob.addColorStop(1, 'rgba(196,208,220,0)');
      m.fillStyle = blob;
      m.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    m.globalCompositeOperation = 'destination-in';
    const edge = m.createRadialGradient(160, 100, 20, 160, 100, 160);
    edge.addColorStop(0, 'rgba(0,0,0,1)');
    edge.addColorStop(.45, 'rgba(0,0,0,.42)');
    edge.addColorStop(.8, 'rgba(0,0,0,.08)');
    edge.addColorStop(1, 'rgba(0,0,0,0)');
    m.fillStyle = edge;
    m.fillRect(0, 0, 320, 200);
    m.globalCompositeOperation = 'source-over';
  }

  private buildGrainView() {
    const tile = this.grain;
    const w = Math.ceil(this.width) + tile.width * 2;
    const h = Math.ceil(this.height) + tile.height * 2;
    if (w <= 0 || h <= 0 || !tile.width) { this.grainView = null; return; }
    const layer = document.createElement('canvas');
    layer.width = w;
    layer.height = h;
    const c = layer.getContext('2d')!;
    for (let x = 0; x < w; x += tile.width) for (let y = 0; y < h; y += tile.height) c.drawImage(tile, x, y);
    this.grainView = layer;
  }

  /** Vignette and top haze depend only on the viewport size, so they are cached in a layer. */
  private buildAtmosphere() {
    const w = this.width;
    const h = this.height;
    if (!w || !h) { this.atmosphere = null; return; }
    const layer = document.createElement('canvas');
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const c = layer.getContext('2d')!;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Cold moonlight wash: the upper third stays readable, the corners fall away into black.
    const vignette = c.createRadialGradient(w * .5, h * .34, h * .12, w * .5, h * .34, Math.max(w, h) * .78);
    vignette.addColorStop(0, '#04070c00');
    vignette.addColorStop(.45, '#04070c16');
    vignette.addColorStop(.78, '#04070c4d');
    vignette.addColorStop(1, '#04070cad');
    c.fillStyle = vignette;
    c.fillRect(0, 0, w, h);
    const top = c.createLinearGradient(0, 0, 0, h);
    top.addColorStop(0, '#050a1273');
    top.addColorStop(.45, '#0a101a12');
    top.addColorStop(1, '#03060b52');
    c.fillStyle = top;
    c.fillRect(0, 0, w, h);
    // Slight lateral colour separation, kept at a level where it reads as lens character rather than a bug.
    const left = c.createLinearGradient(0, 0, w * .34, 0);
    left.addColorStop(0, '#1b3a5a18');
    left.addColorStop(1, '#1b3a5a00');
    c.fillStyle = left;
    c.fillRect(0, 0, w * .34, h);
    const right = c.createLinearGradient(w, 0, w * .66, 0);
    right.addColorStop(0, '#5a2a1b16');
    right.addColorStop(1, '#5a2a1b00');
    c.fillStyle = right;
    c.fillRect(w * .66, 0, w * .34, h);
    this.atmosphere = layer;
  }

  /** World-space rectangle currently on screen, expanded by a small screen-space margin. */
  private updateView() {
    const zoom = this.camera.zoom;
    const halfW = (this.width / 2 + VIEW_MARGIN_PX) / zoom;
    const halfH = (this.height / 2 + VIEW_MARGIN_PX) / zoom;
    this.view = { x0: this.camera.x - halfW, y0: this.camera.y - halfH, x1: this.camera.x + halfW, y1: this.camera.y + halfH };
  }

  private inView(x: number, y: number, pad: number) {
    const v = this.view;
    return x >= v.x0 - pad && x <= v.x1 + pad && y >= v.y0 - pad && y <= v.y1 + pad;
  }

  screenToWorld(x: number, y: number) {
    return { x: (x - this.width / 2 - this.shakeX) / this.camera.zoom + this.camera.x, y: (y - this.height / 2 - this.shakeY) / this.camera.zoom + this.camera.y };
  }

  private random() {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  // ---------------------------------------------------------------- terrain art

  private buildTerrain() {
    const c = this.terrain.getContext('2d')!;
    const r = seeded(1947);
    const W = WORLD.width;
    const H = WORLD.height;

    c.fillStyle = '#211d19';
    c.fillRect(0, 0, W, H);
    // Low-frequency soil variation: broad tonal plates first, then per-pixel grit.
    const tones = ['#332c24', '#191510', '#3d3327', '#2a3128', '#120f0c', '#38301f'];
    for (let i = 0; i < 2600; i++) {
      const x = r() * W;
      const y = r() * H;
      const size = 26 + r() * 130;
      c.fillStyle = tones[i % tones.length] + '7a';
      c.beginPath();
      c.ellipse(x, y, size * 1.7, size, r() * TAU, 0, TAU);
      c.fill();
    }
    // Dead grass fields around the village, cold and desaturated.
    for (let i = 0; i < 900; i++) {
      const x = r() * W;
      const y = r() * H;
      const size = 40 + r() * 120;
      c.globalAlpha = .2 + r() * .22;
      c.fillStyle = ['#2f3a2b', '#3b442e', '#233020', '#46402d'][i % 4];
      c.beginPath();
      c.ellipse(x, y, size * 1.5, size, r() * TAU, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;

    this.drawRiver(c, r);
    this.drawRoads(c, r);
    this.drawVillage(c, r);
    this.drawRuins(c, r);
    this.drawGraveyard(c, r);
    this.drawGroundDetail(c, r);

    this.drawProps(c, r);

    const nearRoad = (x: number, y: number) => (Math.abs(x - (900 - (y - 700) * .56)) < 110 && y > 430) || (Math.abs(y - (700 + Math.max(0, x - 1160) * .68)) < 85 && x > 410) || (y < 570 && x > 1200 && x < 1840);
    for (let i = 0; i < 660; i++) {
      const x = r() * W;
      const y = r() * H;
      if (x > 1960 || nearRoad(x, y) || (x > 540 && x < 1270 && y > 380 && y < 1050) || BUILDINGS.some(b => x > b.x - 70 && x < b.x + b.w + 70 && y > b.y - 70 && y < b.y + b.h + 80) || EXITS.some(e => Math.hypot(e.x - x, e.y - y) < 100)) continue;
      this.trees.push({ x, y, size: 24 + r() * 30, pine: r() > .62, tint: r() });
    }
    this.trees.sort((a, b) => a.y - b.y);
    for (const t of this.trees) this.tree(c, t.x, t.y, t.size, t.pine, t.tint);
  }

  /** A shallow, half-frozen river with muddy banks and reeds. */
  private drawRiver(c: CanvasRenderingContext2D, r: () => number) {
    const path = () => {
      c.beginPath();
      c.moveTo(2070, -50);
      c.bezierCurveTo(1850, 480, 2380, 740, 2070, 1100);
      c.bezierCurveTo(1870, 1380, 2020, 1590, 2280, 1900);
    };
    c.lineCap = 'round';
    path(); c.strokeStyle = '#2b2419'; c.lineWidth = 186; c.stroke();
    path(); c.strokeStyle = '#242c28'; c.lineWidth = 158; c.stroke();
    path(); c.strokeStyle = '#16262b'; c.lineWidth = 132; c.stroke();
    path(); c.strokeStyle = '#1d3540'; c.lineWidth = 116; c.stroke();
    path(); c.strokeStyle = '#2a4956'; c.lineWidth = 84; c.stroke();
    // Current lines and foam reading the flow direction.
    for (let i = 0; i < 420; i++) {
      const t = r();
      const x = 1930 + r() * 330;
      const y = t * WORLD.height;
      c.strokeStyle = i % 5 === 0 ? '#9fc0cb2e' : '#5f8a9a22';
      c.lineWidth = .8 + r() * 1.6;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + r() * 26 + 6, y - 4 - r() * 5);
      c.stroke();
    }
    // Reeds along the waterline.
    for (let i = 0; i < 320; i++) {
      const x = 1880 + r() * 430;
      const y = r() * WORLD.height;
      if (Math.abs(x - (2060 + Math.sin(y * .0035) * 90)) > 118) continue;
      c.strokeStyle = ['#43502f', '#38452a', '#4d5a35'][i % 3];
      c.lineWidth = 1.2;
      for (let b = 0; b < 3; b++) {
        c.beginPath();
        c.moveTo(x + b * 3, y);
        c.quadraticCurveTo(x + b * 3 + 4, y - 14, x + b * 3 + (b - 1) * 7, y - 25 - r() * 12);
        c.stroke();
      }
    }
  }

  /** Cobbled trade roads: dark mortar, irregular stones, cart ruts and standing water. */
  private drawRoads(c: CanvasRenderingContext2D, r: () => number) {
    const road = (points: number[][], width: number) => {
      const stroke = (style: string, w: number) => {
        c.beginPath();
        c.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i++) c.lineTo(points[i][0], points[i][1]);
        c.lineJoin = 'round';
        c.lineCap = 'round';
        c.strokeStyle = style;
        c.lineWidth = w;
        c.stroke();
      };
      stroke('#14100dcc', width + 24);
      stroke('#37301f', width + 18);
      stroke('#4a4232', width);
      stroke('#5b5240', width - 12);
      stroke('#38321f', width - 26);
      // Cobbles only where the road already is, sampled along the segment.
      for (let i = 0; i < width * 6; i++) {
        const seg = Math.floor(r() * (points.length - 1));
        const t = r();
        const x = points[seg][0] + (points[seg + 1][0] - points[seg][0]) * t + (r() - .5) * width;
        const y = points[seg][1] + (points[seg + 1][1] - points[seg][1]) * t + (r() - .5) * width;
        c.fillStyle = ['#6b6350', '#575040', '#78705a', '#443e30'][i % 4] + 'aa';
        c.beginPath();
        c.ellipse(x, y, 3 + r() * 7, 2 + r() * 5, r() * TAU, 0, TAU);
        c.fill();
      }
      // Cart ruts, keeping the road readable as a used path.
      c.strokeStyle = '#1b1712a8';
      c.lineWidth = width * .18;
      c.setLineDash([26, 18]);
      c.beginPath();
      c.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) c.lineTo(points[i][0], points[i][1]);
      c.stroke();
      c.setLineDash([]);
    };
    road([[230, 1500], [520, 1320], [710, 1170], [865, 930], [871, 690], [900, 470], [1220, 390], [1450, 525], [1680, 510], [1840, 250]], 74);
    road([[430, 750], [850, 708], [1160, 700], [1360, 890], [1570, 990], [1860, 1180], [2150, 1450]], 63);
    road([[880, 955], [1140, 1090], [1250, 1350], [1620, 1440]], 42);
    // Puddles catch the moonlight and read as wet stone.
    for (let i = 0; i < 34; i++) {
      const x = 300 + r() * 1700;
      const y = 300 + r() * 1200;
      const size = 12 + r() * 30;
      c.fillStyle = '#12222a99';
      c.beginPath();
      c.ellipse(x, y, size, size * .5, r() * TAU, 0, TAU);
      c.fill();
      c.fillStyle = '#8fb4c01f';
      c.beginPath();
      c.ellipse(x - size * .18, y - size * .12, size * .5, size * .22, 0, 0, TAU);
      c.fill();
    }
  }

  /** The ruined village: cobbled plaza, stone walls, timber houses with slate and rust roofs. */
  private drawVillage(c: CanvasRenderingContext2D, r: () => number) {
    c.fillStyle = '#4a4436';
    c.fillRect(798, 580, 162, 336);
    c.fillStyle = '#171410';
    c.fillRect(798, 580, 162, 336);
    for (let y = 582; y < 918; y += 10) {
      for (let x = 799; x < 957; x += 15) {
        const px = x + (y % 20 ? 7 : 0);
        if (r() < .18) continue;
        const w = 10 + r() * 6;
        const h = 6 + r() * 3.5;
        c.fillStyle = ['#5b5546', '#4a4538', '#645e4c', '#413d33'][Math.floor(r() * 4)];
        c.fillRect(px, y, w, h);
        if (r() > .45) {
          c.fillStyle = '#8f887144';
          c.fillRect(px, y, w, 1.2);
        }
        c.fillStyle = '#0d0b0866';
        c.fillRect(px, y + h, w, 1.6);
      }
    }
    // Dirt and moss settling into the joints keeps the paving from reading as a grid.
    for (let i = 0; i < 150; i++) {
      const x = 790 + r() * 180;
      const y = 572 + r() * 360;
      c.globalAlpha = .28 + r() * .34;
      c.fillStyle = ['#2b3020', '#1d1913', '#3a3527', '#26301f'][i % 4];
      c.beginPath();
      c.ellipse(x, y, 8 + r() * 26, 5 + r() * 16, r() * TAU, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;
    for (let i = 0; i < 240; i++) {
      const x = 790 + r() * 180;
      const y = 570 + r() * 360;
      c.fillStyle = r() > .6 ? '#2c3a28aa' : '#1412107a';
      c.beginPath();
      c.ellipse(x, y, 3 + r() * 9, 2 + r() * 6, r() * TAU, 0, TAU);
      c.fill();
    }

    const wall = (x: number, y: number, w: number, h: number) => {
      c.fillStyle = '#07090baa';
      c.fillRect(x + 10, y + 14, w, h);
      c.fillStyle = '#3f3d37';
      c.fillRect(x, y, w, h);
      // Individual blocks with lit top edges give the wall volume without a 3D pass.
      for (let by = y; by < y + h; by += 13) {
        let bx = x + ((by / 13) % 2 ? 9 : 0);
        while (bx < x + w) {
          const bw = Math.min(19 + r() * 8, x + w - bx);
          if (bw < 4) break;
          c.fillStyle = ['#5c594f', '#524f46', '#676356', '#454339'][Math.floor(r() * 4)];
          c.fillRect(bx, by, bw - 2, 11);
          c.fillStyle = '#8b867488';
          c.fillRect(bx, by, bw - 2, 1.8);
          c.fillStyle = '#14120f99';
          c.fillRect(bx, by + 10, bw - 2, 2);
          bx += bw + 2;
        }
      }
      c.strokeStyle = '#2a2823';
      c.lineWidth = 1.5;
      c.strokeRect(x, y, w, h);
      // Ragged, moss-eaten crown.
      for (let i = 0; i < w / 7; i++) {
        const mx = x + r() * w;
        c.fillStyle = r() > .55 ? '#3c4a2faa' : '#57544a';
        c.fillRect(mx, y - 3 - r() * 4, 4 + r() * 12, 4 + r() * 5);
      }
    };
    wall(600, 432, 211, 14);
    wall(868, 432, 220, 14);
    wall(585, 443, 15, 140);
    wall(585, 810, 15, 190);
    wall(598, 986, 183, 15);
    wall(1000, 986, 235, 15);
    wall(1219, 840, 15, 146);
    for (let i = 0; i < 60; i++) {
      const x = 560 + r() * 690;
      const y = 977 + r() * 58;
      c.fillStyle = i % 4 ? '#454339' : '#2d3a2a';
      c.fillRect(x, y, r() * 11 + 3, r() * 7 + 3);
    }

    // Roofs live on the terrain, so actors still read as standing in front of them.
    for (const b of BUILDINGS) {
      c.fillStyle = '#07090bbd';
      c.fillRect(b.x + 20, b.y + 26, b.w + 9, b.h + 9);
      c.fillStyle = '#312b21';
      c.fillRect(b.x - 6, b.y + 4, b.w + 12, b.h + 14);
      c.fillStyle = b.roof === 'red' ? '#3d211d' : '#262b30';
      c.fillRect(b.x - 11, b.y - 11, b.w + 22, b.h + 22);
      c.fillStyle = b.roof === 'red' ? '#7c4436' : '#4b545c';
      c.beginPath();
      c.moveTo(b.x - 11, b.y - 11);
      c.lineTo(b.x + b.w / 2, b.y + 8);
      c.lineTo(b.x + b.w / 2, b.y + b.h - 7);
      c.lineTo(b.x - 11, b.y + b.h + 11);
      c.closePath();
      c.fill();
      // Shingle rows.
      let row = 0;
      for (let y = b.y - 7; y < b.y + b.h + 9; y += 9) {
        row++;
        c.strokeStyle = row % 2 ? '#0b0e11cc' : '#161a1ec4';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(b.x - 10, y);
        c.lineTo(b.x + b.w / 2, y + 9);
        c.lineTo(b.x + b.w + 10, y);
        c.stroke();
        for (let x = b.x - 10; x < b.x + b.w + 10; x += 13) {
          c.fillStyle = '#ffffff18';
          c.fillRect(x + (row % 2 ? 5 : 0), y + 3, 9, 1.8);
        }
      }
      c.strokeStyle = '#8e7c56c4';
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(b.x + b.w / 2, b.y - 13);
      c.lineTo(b.x + b.w / 2, b.y + b.h + 12);
      c.stroke();
      c.strokeStyle = '#f0dfae40';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(b.x + b.w / 2 - 1, b.y - 13);
      c.lineTo(b.x + b.w / 2 - 1, b.y + b.h + 12);
      c.stroke();
      // Rafter ends poking out of the eaves.
      for (let x = b.x - 6; x < b.x + b.w + 6; x += 16) {
        c.fillStyle = '#31281e';
        c.fillRect(x, b.y + b.h + 10, 5, 6);
      }
      // Brick chimney with a soot cap.
      c.fillStyle = '#3b322a';
      c.fillRect(b.x + b.w - 34, b.y + 12, 20, 30);
      for (let y = 12; y < 42; y += 8) {
        c.fillStyle = '#2a241d';
        c.fillRect(b.x + b.w - 34, b.y + y, 20, 1.4);
      }
      c.fillStyle = '#585049';
      c.fillRect(b.x + b.w - 37, b.y + 8, 26, 7);
      c.fillStyle = '#0b0d0f';
      c.fillRect(b.x + b.w - 32, b.y + 10, 16, 4);
      // Door and shutter details on the visible south face.
      c.fillStyle = '#161310';
      c.fillRect(b.x + b.w * .4, b.y + b.h, 30, 17);
      c.fillStyle = '#3a2c1e';
      c.fillRect(b.x + b.w * .4 - 3, b.y + b.h + 13, 36, 6);
      c.fillStyle = '#0d0f12';
      c.fillRect(b.x + 16, b.y + b.h - 26, 12, 12);
      c.fillRect(b.x + b.w - 34, b.y + b.h - 26, 12, 12);
      // Sconce lantern beside every doorway: a guaranteed warm pool of light at night.
      const lx = b.x + b.w * .4 - 12;
      const ly = b.y + b.h - 4;
      c.fillStyle = '#232019';
      c.fillRect(lx - 4, ly - 18, 3, 18);
      c.fillStyle = '#5d4a2e';
      c.fillRect(lx - 9, ly - 24, 13, 8);
      c.fillStyle = '#ffcf86';
      c.fillRect(lx - 7, ly - 22, 9, 5);
      this.lanterns.push({ x: lx - 2, y: ly - 20, hue: 0 });
    }

    // Well.
    c.fillStyle = '#07090b8f';
    c.beginPath();
    c.ellipse(891, 758, 37, 27, 0, 0, TAU);
    c.fill();
    c.fillStyle = '#4d4a43';
    c.beginPath();
    c.arc(882, 744, 27, 0, TAU);
    c.fill();
    c.fillStyle = '#0a1a20';
    c.beginPath();
    c.arc(882, 744, 19, 0, TAU);
    c.fill();
    c.fillStyle = '#6d6860';
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU;
      c.fillRect(882 + Math.cos(a) * 24 - 3, 744 + Math.sin(a) * 24 - 2, 7, 5);
    }
    c.fillStyle = '#3a2c1c';
    c.fillRect(854, 730, 6, 26);
    c.fillRect(905, 730, 6, 26);
    c.fillStyle = '#54402a';
    c.fillRect(850, 726, 62, 8);
    c.fillStyle = '#6f5636';
    c.fillRect(850, 726, 62, 3);
    c.strokeStyle = '#1b1610';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(882, 744, 19, 0, TAU);
    c.stroke();

    // Stone circles and burnt campsites where the braziers burn.
    for (const [x, y] of FIRES) this.brazier(c, x, y, r);
  }

  /** Static brazier art; the flame itself is animated and lit at draw time. */
  private brazier(c: CanvasRenderingContext2D, x: number, y: number, r: () => number) {
    c.fillStyle = '#07090b88';
    c.beginPath();
    c.ellipse(x + 14, y + 18, 54, 27, .3, 0, TAU);
    c.fill();
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * TAU;
      const px = x + Math.cos(a) * (30 + r() * 14);
      const py = y + Math.sin(a) * (18 + r() * 10) + 8;
      c.fillStyle = ['#4a4841', '#3e3c36', '#585349'][i % 3];
      c.beginPath();
      c.ellipse(px, py, 7 + r() * 7, 5 + r() * 5, r() * TAU, 0, TAU);
      c.fill();
      c.fillStyle = '#6d675a44';
      c.beginPath();
      c.ellipse(px - 2, py - 2, 4 + r() * 4, 3 + r() * 2, 0, 0, TAU);
      c.fill();
    }
    c.fillStyle = '#2a2721';
    c.beginPath();
    c.ellipse(x, y + 4, 21, 13, 0, 0, TAU);
    c.fill();
    c.fillStyle = '#141210';
    c.beginPath();
    c.ellipse(x, y + 2, 15, 9, 0, 0, TAU);
    c.fill();
    c.strokeStyle = '#3c372e';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(x - 13, y + 6);
    c.lineTo(x + 13, y + 1);
    c.moveTo(x - 12, y);
    c.lineTo(x + 14, y + 7);
    c.stroke();
    for (let i = 0; i < 6; i++) {
      c.fillStyle = '#3b3128';
      c.beginPath();
      c.ellipse(x + (r() - .5) * 16, y + 1 + (r() - .5) * 7, 4 + r() * 5, 3 + r() * 3, r() * TAU, 0, TAU);
      c.fill();
    }
  }

  /** Collapsed arches, broken columns and cracked statues — the gothic silhouette layer. */
  private drawRuins(c: CanvasRenderingContext2D, r: () => number) {
    // A broken monastery arch to the north-east.
    const arch = (x: number, y: number, w: number, h: number, lean: number) => {
      c.save();
      c.translate(x, y);
      c.rotate(lean);
      c.fillStyle = '#07090ba8';
      c.beginPath();
      c.ellipse(12, 16, w * .8, h * .34, 0, 0, TAU);
      c.fill();
      c.fillStyle = '#3d3b35';
      c.fillRect(-w / 2, -h / 2, 20, h);
      c.fillRect(w / 2 - 20, -h / 2, 20, h);
      c.beginPath();
      c.arc(0, -h / 2, w / 2, Math.PI, TAU);
      c.lineWidth = 20;
      c.strokeStyle = '#3d3b35';
      c.stroke();
      c.strokeStyle = '#5d584e';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(0, -h / 2, w / 2 + 9, Math.PI, TAU);
      c.stroke();
      for (let i = -w / 2; i < w / 2; i += 17) {
        c.fillStyle = '#100e0c66';
        c.fillRect(i, -h / 2 - 4, 2, h * .34 + 6);
      }
      c.restore();
    };
    arch(1520, 330, 96, 150, .04);
    arch(720, 1360, 84, 118, -.06);
    arch(1960, 900, 74, 104, .1);

    for (let i = 0; i < 26; i++) {
      const x = r() * WORLD.width;
      const y = r() * WORLD.height;
      if (BUILDINGS.some(b => x > b.x - 60 && x < b.x + b.w + 60 && y > b.y - 60 && y < b.y + b.h + 60)) continue;
      c.fillStyle = '#07090b77';
      c.beginPath();
      c.ellipse(x + 9, y + 11, 22 + r() * 16, 11 + r() * 8, .4, 0, TAU);
      c.fill();
      const kind = i % 3;
      if (kind === 0) {
        // Fallen column drum.
        c.fillStyle = '#4b4942';
        c.beginPath();
        c.ellipse(x, y, 17 + r() * 5, 9 + r() * 4, r() * TAU, 0, TAU);
        c.fill();
        c.strokeStyle = '#6f6a5e66';
        c.lineWidth = 2;
        c.stroke();
        c.fillStyle = '#33312c';
        c.beginPath();
        c.ellipse(x, y + 3, 12, 6, 0, 0, TAU);
        c.fill();
      } else if (kind === 1) {
        // Cracked flagstone.
        c.fillStyle = '#413e37';
        c.beginPath();
        c.roundRect(x - 20, y - 14, 40 + r() * 14, 28 + r() * 10, 3);
        c.fill();
        c.strokeStyle = '#5c574c77';
        c.lineWidth = 1.4;
        c.stroke();
        c.strokeStyle = '#14120faa';
        c.beginPath();
        c.moveTo(x - 14, y - 10);
        c.lineTo(x - 2, y + 2);
        c.lineTo(x + 9, y - 4);
        c.stroke();
      } else {
        // Toppled gravestone.
        c.save();
        c.translate(x, y);
        c.rotate((r() - .5) * .9);
        c.fillStyle = '#3a3833';
        c.beginPath();
        c.roundRect(-11, -22, 22, 34, 9);
        c.fill();
        c.fillStyle = '#57534a44';
        c.beginPath();
        c.roundRect(-8, -19, 16, 28, 7);
        c.fill();
        c.restore();
      }
    }
  }

  /** A forgotten churchyard: rows of leaning stones inside a bent iron fence. */
  private drawGraveyard(c: CanvasRenderingContext2D, r: () => number) {
    c.fillStyle = '#2a2a24';
    c.beginPath();
    c.ellipse(1740, 950, 190, 130, -.2, 0, TAU);
    c.fill();
    c.globalAlpha = .22;
    c.fillStyle = '#272c22';
    c.beginPath();
    c.ellipse(1760, 990, 150, 96, 0, 0, TAU);
    c.fill();
    c.globalAlpha = .12;
    c.fillStyle = '#3a4430';
    c.beginPath();
    c.ellipse(1730, 960, 110, 62, -.3, 0, TAU);
    c.fill();
    c.globalAlpha = 1;
    for (let i = 0; i < 26; i++) {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const x = 1646 + col * 44 + (r() - .5) * 13 + row * 7;
      const y = 900 + row * 34 + (r() - .5) * 11;
      const lean = (r() - .5) * .42;
      c.fillStyle = '#07090b8f';
      c.beginPath();
      c.ellipse(x + 7, y + 9, 15, 7, .3, 0, TAU);
      c.fill();
      c.save();
      c.translate(x, y);
      c.rotate(lean);
      c.fillStyle = i % 4 === 0 ? '#4c4740' : '#3c3833';
      c.beginPath();
      if (i % 6 === 0) {
        c.moveTo(-11, 8);
        c.lineTo(-11, -8);
        c.quadraticCurveTo(0, -26, 11, -8);
        c.lineTo(11, 8);
        c.closePath();
      } else c.roundRect(-10, -16, 20, 24, i % 3 === 0 ? 3 : 8);
      c.fill();
      c.fillStyle = '#6b655a4d';
      c.fillRect(-10, -16, 20, 3);
      c.strokeStyle = '#191713';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, -12);
      c.lineTo(0, 4);
      c.moveTo(-5, -7);
      c.lineTo(5, -7);
      c.stroke();
      c.fillStyle = '#2c3a28aa';
      c.beginPath();
      c.ellipse(-6, -2 + r() * 8, 4, 3, 0, 0, TAU);
      c.fill();
      c.restore();
    }
    // Iron fence with spear tips, two sides only so the yard stays enterable.
    c.strokeStyle = '#22242a';
    c.lineWidth = 2.2;
    for (let i = 0; i <= 12; i++) {
      const x = 1580 + i * 8;
      c.beginPath();
      c.moveTo(x, 840 + i * 2);
      c.lineTo(x, 880 + i * 2);
      c.stroke();
      c.fillStyle = '#2c2f36';
      c.beginPath();
      c.moveTo(x - 3, 840 + i * 2);
      c.lineTo(x, 832 + i * 2);
      c.lineTo(x + 3, 840 + i * 2);
      c.closePath();
      c.fill();
    }
    c.strokeStyle = '#22242a';
    c.lineWidth = 3;
    for (const dy of [0, 40]) {
      c.beginPath();
      c.moveTo(1580, 840 + dy);
      c.lineTo(1676, 864 + dy);
      c.stroke();
    }
  }

  /** Ground texture: tufts, pebbles, cracks, bone fragments, ash. */
  private drawGroundDetail(c: CanvasRenderingContext2D, r: () => number) {
    for (let i = 0; i < 5200; i++) {
      const x = r() * WORLD.width;
      const y = r() * WORLD.height;
      c.strokeStyle = ['#5a6640cc', '#485234cc', '#6d6b4a99', '#39432ecc'][i % 4];
      c.lineWidth = 1;
      const blade = 3 + r() * 7;
      for (let b = 0; b < 3; b++) {
        c.beginPath();
        c.moveTo(x + b * 2, y);
        c.lineTo(x + b * 2 + (r() - .5) * 6, y - blade * (.6 + r() * .6));
        c.stroke();
      }
    }
    for (let i = 0; i < 4200; i++) {
      const x = r() * WORLD.width;
      const y = r() * WORLD.height;
      c.fillStyle = ['#867f6b52', '#14121044', '#a99f865c', '#333a2c88'][i % 4];
      c.fillRect(x, y, 1 + r() * 3.4, 1 + r() * 2.4);
    }
    for (let i = 0; i < 620; i++) {
      const x = r() * WORLD.width;
      const y = r() * WORLD.height;
      c.strokeStyle = '#16141055';
      c.lineWidth = .8;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (r() - .5) * 34, y + (r() - .5) * 30);
      c.stroke();
    }
    for (let i = 0; i < 90; i++) {
      const x = r() * WORLD.width;
      const y = r() * WORLD.height;
      const a = r() * TAU;
      c.fillStyle = '#bdb49a6b';
      c.save();
      c.translate(x, y);
      c.rotate(a);
      c.fillRect(-5, -.8, 10, 1.7);
      c.beginPath();
      c.arc(-6, 0, 1.8, 0, TAU);
      c.arc(6, 0, 1.8, 0, TAU);
      c.fill();
      c.restore();
    }
    // Ash drift around the braziers.
    for (const [x, y] of FIRES) {
      for (let i = 0; i < 260; i++) {
        const a = r() * TAU;
        const d = r() * 74;
        c.fillStyle = i % 3 ? '#514a4128' : '#6a61524a';
        c.beginPath();
        c.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * .6, 2 + r() * 5, 1 + r() * 3, a, 0, TAU);
        c.fill();
      }
    }
  }

  /** Barrels, carts, crates, fences, dead bushes and logs scattered along the roads. */
  private drawProps(c: CanvasRenderingContext2D, r: () => number) {
    const shadow = (x: number, y: number, rx: number, ry: number) => {
      c.fillStyle = '#04060899';
      c.beginPath();
      c.ellipse(x + 5, y + 7, rx, ry, .35, 0, TAU);
      c.fill();
    };
    const barrel = (x: number, y: number) => {
      shadow(x, y, 14, 7);
      c.fillStyle = '#4a3220';
      c.beginPath();
      c.roundRect(x - 11, y - 15, 22, 26, 5);
      c.fill();
      c.fillStyle = '#5d4028';
      c.beginPath();
      c.roundRect(x - 9, y - 14, 10, 24, 4);
      c.fill();
      c.fillStyle = '#2f3740';
      c.fillRect(-11 + x, y - 9, 22, 3);
      c.fillRect(-11 + x, y + 4, 22, 3);
      c.fillStyle = '#7a5b38';
      c.beginPath();
      c.ellipse(x, y - 15, 11, 4, 0, 0, TAU);
      c.fill();
      c.strokeStyle = '#2a1c10';
      c.lineWidth = 1;
      c.stroke();
      for (let i = 0; i < 5; i++) {
        c.fillStyle = '#2a1c1066';
        c.fillRect(x - 8 + i * 4, y - 13, 1.2, 22);
      }
    };
    const crate = (x: number, y: number) => {
      shadow(x, y, 14, 7);
      c.fillStyle = '#3d2a1a';
      c.beginPath();
      c.roundRect(x - 12, y - 13, 24, 22, 2);
      c.fill();
      c.fillStyle = '#553a22';
      c.fillRect(x - 11, y - 12, 22, 20);
      c.strokeStyle = '#2b1d11';
      c.lineWidth = 2.4;
      c.beginPath();
      c.moveTo(x - 11, y - 12);
      c.lineTo(x + 11, y + 8);
      c.moveTo(x + 11, y - 12);
      c.lineTo(x - 11, y + 8);
      c.stroke();
      c.fillStyle = '#7d5c37';
      c.fillRect(x - 11, y - 13, 22, 2);
    };
    const cart = (x: number, y: number, lean: number) => {
      c.save();
      c.translate(x, y);
      c.rotate(lean);
      shadow(0, 4, 26, 9);
      c.fillStyle = '#3a2716';
      c.beginPath();
      c.roundRect(-26, -20, 52, 26, 3);
      c.fill();
      c.fillStyle = '#4c3520';
      c.fillRect(-24, -18, 48, 22);
      for (let i = 0; i < 6; i++) c.fillStyle = '#2c1d10aa', c.fillRect(-24 + i * 8, -18, 1.6, 22);
      c.fillStyle = '#31200f';
      c.beginPath();
      c.arc(-18, 10, 9, 0, TAU);
      c.arc(18, 10, 9, 0, TAU);
      c.fill();
      c.strokeStyle = '#8a7050';
      c.lineWidth = 1.6;
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05;
        c.beginPath();
        c.moveTo(-18 + Math.cos(a) * 8, 10 + Math.sin(a) * 8);
        c.lineTo(-18 - Math.cos(a) * 8, 10 - Math.sin(a) * 8);
        c.moveTo(18 + Math.cos(a) * 8, 10 + Math.sin(a) * 8);
        c.lineTo(18 - Math.cos(a) * 8, 10 - Math.sin(a) * 8);
        c.stroke();
      }
      // A spilled load keeps it from looking like a parked prop.
      c.fillStyle = '#7a5b38';
      c.beginPath();
      c.ellipse(-34, 14, 11, 4, .2, 0, TAU);
      c.fill();
      c.restore();
    };
    const fence = (x: number, y: number, count: number, angle: number) => {
      c.save();
      c.translate(x, y);
      c.rotate(angle);
      c.strokeStyle = '#2c2418';
      c.lineWidth = 3;
      for (let i = 0; i < count; i++) {
        const px = i * 17;
        const h = 22 + r() * 10;
        c.beginPath();
        c.moveTo(px, 6);
        c.lineTo(px + (r() - .5) * 4, -h);
        c.stroke();
      }
      c.lineWidth = 2.4;
      c.strokeStyle = '#3a3020';
      c.beginPath();
      c.moveTo(0, -12);
      c.lineTo((count - 1) * 17, -14);
      c.moveTo(0, -2);
      c.lineTo((count - 1) * 17, -3);
      c.stroke();
      c.restore();
    };
    const bush = (x: number, y: number, size: number) => {
      c.fillStyle = '#04060877';
      c.beginPath();
      c.ellipse(x + 4, y + 5, size * 1.1, size * .55, .3, 0, TAU);
      c.fill();
      c.strokeStyle = '#3d3524';
      c.lineWidth = 1.4;
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * TAU;
        c.beginPath();
        c.moveTo(x, y);
        c.quadraticCurveTo(x + Math.cos(a) * size * .5, y + Math.sin(a) * size * .4 - size * .3, x + Math.cos(a) * size, y + Math.sin(a) * size * .5 - size * .5);
        c.stroke();
      }
      c.fillStyle = '#2f3a26';
      c.beginPath();
      c.ellipse(x, y - size * .35, size * .6, size * .35, 0, 0, TAU);
      c.fill();
    };
    const log = (x: number, y: number, angle: number, len: number) => {
      c.save();
      c.translate(x, y);
      c.rotate(angle);
      c.fillStyle = '#04060899';
      c.beginPath();
      c.ellipse(4, 7, len * .55, 8, 0, 0, TAU);
      c.fill();
      c.fillStyle = '#33261a';
      c.beginPath();
      c.roundRect(-len / 2, -9, len, 17, 8);
      c.fill();
      c.fillStyle = '#453321';
      c.beginPath();
      c.roundRect(-len / 2 + 2, -8, len - 4, 12, 7);
      c.fill();
      c.fillStyle = '#6a5334';
      c.beginPath();
      c.ellipse(-len / 2 + 4, -1, 4, 7, 0, 0, TAU);
      c.fill();
      c.strokeStyle = '#3b2a19';
      c.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.ellipse(-len / 2 + 4, -1, 1.2 + i, 2.2 + i, 0, 0, TAU);
        c.stroke();
      }
      c.strokeStyle = '#241a10aa';
      c.lineWidth = 1.2;
      for (let i = 0; i < 5; i++) {
        const px = -len / 2 + 8 + i * (len / 6);
        c.beginPath();
        c.moveTo(px, -8);
        c.lineTo(px + 2, 6);
        c.stroke();
      }
      c.restore();
    };
    const bones = (x: number, y: number) => {
      
      c.fillStyle = '#9c9682aa';
      c.save();
      c.translate(x, y);
      c.rotate(r() * TAU);
      c.fillRect(-9, -.9, 18, 1.8);
      c.beginPath();
      c.arc(-10, 0, 2.2, 0, TAU);
      c.arc(10, 0, 2.2, 0, TAU);
      c.fill();
      c.restore();
    };

    // Clutter stands beside the roads and around the ruined houses.
    const spots: [number, number][] = [
      [820, 960], [880, 1010], [960, 940], [700, 700], [640, 940], [1040, 700], [1120, 780],
      [1420, 400], [1520, 420], [1600, 560], [780, 470], [900, 520], [1010, 560], [1550, 1050],
      [960, 1300], [1020, 1320], [700, 1180], [1180, 300], [1620, 900], [1300, 620], [480, 1300],
      [560, 700], [1840, 700], [1720, 1030], [1240, 1420], [1360, 1350],
    ];
    let kind = 0;
    for (const [x, y] of spots) {
      kind++;
      if (kind % 6 === 1) barrel(x + (r() - .5) * 16, y + (r() - .5) * 12);
      else if (kind % 6 === 2) crate(x + (r() - .5) * 16, y + (r() - .5) * 12);
      else if (kind % 6 === 3) bush(x + (r() - .5) * 20, y + (r() - .5) * 16, 12 + r() * 7);
      else if (kind % 6 === 4) log(x, y, r() * TAU, 40 + r() * 34);
      else if (kind % 6 === 5) cart(x, y, (r() - .5) * .7);
      else fence(x, y, 4 + Math.floor(r() * 3), (r() - .5) * .6);
    }
    for (const [x, y] of [[760, 1040], [1330, 760], [1660, 660], [1120, 1180], [520, 900]]) barrel(x, y);
    for (const [x, y] of [[1640, 1150], [900, 1180], [1460, 620], [430, 1180], [1900, 480]]) crate(x, y);
    for (let i = 0; i < 34; i++) bush(r() * WORLD.width, r() * WORLD.height, 10 + r() * 8);
    for (let i = 0; i < 16; i++) log(r() * WORLD.width, r() * WORLD.height, r() * TAU, 34 + r() * 30);
    for (let i = 0; i < 26; i++) bones(r() * WORLD.width, r() * WORLD.height);
  }

  private tree(c: CanvasRenderingContext2D, x: number, y: number, s: number, pine: boolean, tint: number) {
    c.fillStyle = '#040608a6';
    c.beginPath();
    c.ellipse(x + 22, y + 16, s * 1.02, s * .46, .62, 0, TAU);
    c.fill();
    if (pine) {
      c.fillStyle = '#221a13';
      c.fillRect(x - 3.5, y - 12, 7, 32);
      const colors = ['#1b2c25', '#263c30', '#32503a', '#3b5c3f'];
      for (let i = 0; i < 4; i++) {
        c.fillStyle = colors[i];
        c.beginPath();
        c.moveTo(x, y - s * 1.72 + i * s * .22);
        c.lineTo(x - s * (.92 - i * .17), y + s * (.4 - i * .3));
        c.lineTo(x + s * (.82 - i * .17), y + s * (.4 - i * .3));
        c.closePath();
        c.fill();
        c.strokeStyle = '#00000055';
        c.lineWidth = 1;
        c.stroke();
      }
      // Moonlight catching the outer needles plus a bright tip keeps pines from flattening out.
      c.strokeStyle = '#9fb98b40';
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(x - 2, y - s * 1.6);
      c.lineTo(x - s * .6, y + s * .1);
      c.stroke();
      c.strokeStyle = '#c3d8b644';
      c.beginPath();
      c.moveTo(x + 1, y - s * 1.68);
      c.lineTo(x + s * .5, y + s * .05);
      c.stroke();
    } else {
      // Bare, wind-bent trees: trunk, tapered limbs, and a thin canopy of remaining leaves.
      c.strokeStyle = '#2a2016';
      c.lineCap = 'round';
      c.lineWidth = s * .16;
      c.beginPath();
      c.moveTo(x, y + 16);
      c.quadraticCurveTo(x + (tint - .5) * 10, y - s * .5, x + (tint - .5) * 22, y - s * 1.3);
      c.stroke();
      for (let i = 0; i < 6; i++) {
        const h = y - s * (.45 + i * .16);
        const dir = i % 2 ? 1 : -1;
        c.lineWidth = s * (.1 - i * .012);
        c.strokeStyle = i > 3 ? '#332619' : '#2f2318';
        c.beginPath();
        c.moveTo(x + (tint - .5) * i * 3, h);
        c.quadraticCurveTo(x + dir * s * .5, h - s * .3, x + dir * s * (.72 + tint * .2), h - s * (.55 + i * .04));
        c.stroke();
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(x + dir * s * .72, h - s * .55);
        c.lineTo(x + dir * s * (.86 + tint * .2), h - s * .74);
        c.stroke();
      }
      const palette = tint > .86 ? ['#4a4126', '#5b4e2c', '#6a5a34'] : tint > .5 ? ['#22392a', '#2c4830', '#35553a'] : ['#1b2d22', '#243a2b', '#2d4834'];
      // A dark mass under the clusters keeps the canopy from floating.
      c.fillStyle = '#141c16';
      c.globalAlpha = .5;
      c.beginPath();
      c.ellipse(x - 4, y - s * .86, s * .95, s * .6, 0, 0, TAU);
      c.fill();
      for (let j = 0; j < 7; j++) {
        const a = j * 2.2;
        c.fillStyle = palette[j % 3];
        c.globalAlpha = .88;
        c.beginPath();
        c.ellipse(x + Math.cos(a) * s * .5 - 3, y - s * .95 + Math.sin(a) * s * .38, s * .42, s * .3, a, 0, TAU);
        c.fill();
      }
      c.globalAlpha = 1;
      // Rim light on the canopy edge facing the moon.
      c.strokeStyle = '#b8ccab3d';
      c.lineWidth = 1.2;
      c.beginPath();
      c.ellipse(x - s * .18, y - s * 1.06, s * .46, s * .33, -.4, Math.PI * .8, Math.PI * 1.75);
      c.stroke();
    }
  }

  // ---------------------------------------------------------------- fx state

  private resetRaidFx() {
    this.prevHp.clear();
    this.defeatedAt.clear();
    this.gait.clear();
    this.fireEmbers = [];
    this.hitParticles = [];
    this.blood = [];
    this.damageNumbers = [];
    this.rings = [];
    this.attackFx = [];
    this.prevAttackSerial.clear();
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
      if (actor.hp <= 0 && !this.defeatedAt.has(actor.id)) this.defeatedAt.set(actor.id, state.time);
      this.prevHp.set(actor.id, actor.hp);
    }
    for (const id of this.prevHp.keys()) if (!seen.has(id)) { this.prevHp.delete(id); this.defeatedAt.delete(id); }
  }

  /** Spawns a slash / muzzle flash whenever an accepted attack serial advances. */
  private observeAttacks(state: GameState, playerId: string, lobby: boolean) {
    if (lobby) { this.prevAttackSerial.clear(); return; }
    const seen = new Set<string>();
    for (const player of state.players) {
      seen.add(player.id);
      const serial = player.attackSerial ?? 0;
      const previous = this.prevAttackSerial.get(player.id);
      if (previous !== undefined && serial > previous) {
        const usingBow = player.weapon === 'bow';
        const color = player.id === playerId ? '#ffe0a3' : '#ff8a7a';
        this.attackFx.push({
          x: player.x,
          y: player.y,
          angle: player.angle,
          life: usingBow ? .18 : .26,
          maxLife: usingBow ? .18 : .26,
          range: usingBow ? 40 : 74,
          color,
          kind: usingBow ? 'bow' : 'melee',
        });
        if (this.attackFx.length > 40) this.attackFx.splice(0, this.attackFx.length - 40);
      }
      this.prevAttackSerial.set(player.id, serial);
    }
    for (const id of this.prevAttackSerial.keys()) if (!seen.has(id)) this.prevAttackSerial.delete(id);
  }

  private spawnHit(actor: Actor, loss: number, self: boolean, defeated: boolean) {
    const amount = Math.max(1, Math.round(loss));
    const color = self ? '#ff6a52' : amount >= 25 ? '#ffd05e' : '#efe6cf';
    this.damageNumbers.push({ x: actor.x + (this.random() - .5) * 12, y: actor.y - 34, value: amount, life: .85, maxLife: .85, color, size: self ? 18 : amount >= 25 ? 21 : 15 });
    if (this.damageNumbers.length > 26) this.damageNumbers.splice(0, this.damageNumbers.length - 26);

    if (this.reducedMotion) return;
    this.rings.push({ x: actor.x, y: actor.y, life: .34, maxLife: .34, from: 9, to: 60, color: self ? '#ff6b4a' : '#ffcf7d', width: 2.2, glow: true });
    this.addBlood(actor.x, actor.y, defeated ? 19 : 11, defeated ? .68 : .46);
    const droplets = defeated ? 24 : 10;
    for (let i = 0; i < droplets; i++) {
      const angle = this.random() * TAU;
      const speed = (defeated ? 42 : 26) + this.random() * (defeated ? 108 : 74);
      const life = .32 + this.random() * .45;
      this.hitParticles.push({
        x: actor.x + Math.cos(angle) * 5,
        y: actor.y - 4 + Math.sin(angle) * 5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 38,
        life,
        maxLife: life,
        size: 1.5 + this.random() * (defeated ? 3.5 : 2.4),
        color: i % 3 === 0 ? '#ffd18a' : '#6d1a1d',
        gravity: i % 3 === 0 ? 18 : 165,
        glow: i % 3 === 0,
      });
    }
    if (this.hitParticles.length > 160) this.hitParticles.splice(0, this.hitParticles.length - 160);

    if (self) this.shake = Math.min(12, this.shake + 7);
    if (defeated) {
      this.rings.push({ x: actor.x, y: actor.y, life: .7, maxLife: .7, from: 20, to: 250, color: '#7c1f22', width: 3, glow: true });
      this.shake = Math.min(12, this.shake + 3.5);
      for (let i = 0; i < 16; i++) {
        const angle = this.random() * TAU;
        const speed = 80 + this.random() * 150;
        const life = .4 + this.random() * .4;
        this.hitParticles.push({ x: actor.x, y: actor.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 24, life, maxLife: life, size: 2 + this.random() * 3, color: '#611a20', gravity: 92, glow: false });
      }
    }
  }

  private addBlood(x: number, y: number, size: number, alpha: number) {
    this.blood.push({ x: x + (this.random() - .5) * 12, y: y + 9 + (this.random() - .5) * 9, size, rotation: this.random() * TAU, alpha });
    for (let i = 0; i < 3; i++) this.blood.push({ x: x + (this.random() - .5) * 30, y: y + 9 + (this.random() - .5) * 26, size: size * (.2 + this.random() * .3), rotation: this.random() * TAU, alpha: alpha * .7 });
    if (this.blood.length > 70) this.blood.splice(0, this.blood.length - 70);
  }

  private spawnEmber() {
    const [x, y] = FIRES[Math.floor(this.random() * FIRES.length)];
    const life = 1 + this.random() * 1.5;
    this.fireEmbers.push({
      x: x + (this.random() - .5) * 15,
      y: y - 8 + (this.random() - .5) * 6,
      vx: (this.random() - .5) * 16,
      vy: -24 - this.random() * 38,
      life,
      maxLife: life,
      size: .9 + this.random() * 1.9,
      color: this.random() > .3 ? '#ffb95e' : '#ff6a34',
      gravity: -6,
      glow: true,
    });
  }

  private advanceFx(dt: number) {
    const motion = !this.reducedMotion;
    if (motion) {
      if (!this.fireEmbers.length) for (let i = 0; i < 14; i++) this.spawnEmber();
      this.emberClock += dt;
      while (this.emberClock >= .06 && this.fireEmbers.length < 54) {
        this.emberClock -= .06;
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
      for (const fx of this.attackFx) fx.life -= dt;
      this.attackFx = this.attackFx.filter(fx => fx.life > 0);
      this.shake *= Math.pow(.06, dt);
    } else {
      this.fireEmbers = [];
      this.hitParticles = [];
      this.rings = [];
      this.attackFx = [];
      this.shake = 0;
    }

    for (const number of this.damageNumbers) {
      number.life -= dt;
      if (!this.reducedMotion) number.y -= 29 * dt / Math.max(.55, this.camera.zoom);
    }
    this.damageNumbers = this.damageNumbers.filter(number => number.life > 0);
  }

  // ---------------------------------------------------------------- frame

  draw(state: GameState, playerId: string, lobby: boolean, fullMap: boolean, time: number, aim?: Aim) {
    const c = this.ctx;
    const w = this.width;
    const h = this.height;
    if (!w || !h) return;

    if (lobby && !this.wasLobby) this.resetRaidFx();
    this.wasLobby = lobby;
    const dt = this.lastDrawTime === null ? 1 / 60 : Math.min(.1, Math.max(0, time - this.lastDrawTime));
    this.lastDrawTime = time;
    this.lastState = state;
    this.observeHp(state, playerId, lobby);
    this.observeAttacks(state, playerId, lobby);
    this.advanceFx(dt);

    this.observeMovement(state, dt);
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
      this.camera.zoom += (1.42 - this.camera.zoom) * .1;
    }

    this.shakeX = this.reducedMotion ? 0 : Math.sin(time * 89.7) * this.shake * .72;
    this.shakeY = this.reducedMotion ? 0 : Math.cos(time * 117.1) * this.shake * .52;
    this.updateView();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = '#05070a';
    c.fillRect(0, 0, w, h);
    c.save();
    c.translate(w / 2 + this.shakeX, h / 2 + this.shakeY);
    c.scale(this.camera.zoom, this.camera.zoom);
    c.translate(-this.camera.x, -this.camera.y);
    this.drawTerrain(c);

    this.drawBlood(c);
    if (!lobby && p && !fullMap) this.drawPlayerAura(c, p);
    this.drawGradedShadow(c);

    // Depth-sorted world: everything painted back to front so silhouettes overlap correctly.
    for (const loot of state.loot) if (!loot.opened) this.drawLoot(c, loot, state, lobby, time);
    for (const exit of EXITS) this.drawExit(c, exit, time);
    for (let i = 0; i < FIRES.length; i++) this.drawBrazier(c, FIRES[i][0], FIRES[i][1], i, time);
    for (const actor of this.actorsInDrawOrder(state, playerId, lobby)) {
      const isPlayer = 'status' in actor;
      const held = isPlayer ? this.heldWeapon(actor as Player) : this.enemyWeapon(actor as { kind?: string; phase?: number });
      const glow = isPlayer ? this.heldGlow(actor as Player) : this.enemyGlow(actor as { kind?: string; elite?: boolean });
      this.actor(c, actor, isPlayer, actor.id === playerId, isPlayer ? '' : (actor as { kind?: string }).kind, held, glow, time);
    }
    for (const enemy of state.enemies) if (enemy.hp > 0 && enemy.swing > 0 && !lobby && this.inView(enemy.x, enemy.y, 120)) this.drawSlash(c, enemy, false, this.enemyGlow(enemy as { kind?: string; elite?: boolean }));
    for (const player of state.players) {
      if (player.status !== 'alive' || player.swing <= 0 || player.weapon === 'bow' || lobby || !this.inView(player.x, player.y, 120)) continue;
      this.drawSlash(c, player, player.id === playerId, this.heldGlow(player));
    }
    for (const fx of this.attackFx) if (this.inView(fx.x, fx.y, 120)) this.drawAttackFx(c, fx);
    this.drawArrows(c, state);
    this.drawCombatFx(c);
    this.drawFireEmbers(c);
    if (!this.reducedMotion) this.drawBeams(c, state, lobby, time);

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

    // Lighting, bloom and atmosphere are all screen-space passes.
    this.applyLighting(c, w, h, time, lobby, fullMap, p);
    this.applyBloom(c, w, h);
    this.drawAtmosphere(c, w, h, lobby, p, time);
    if (!lobby && p && !fullMap) this.minimap(c, state, p, w - 160, h < 430 ? 52 : 62);
    if (!lobby && !fullMap && aim) this.drawReticle(c, aim, time);
  }

  /** Entities sorted by their feet so nearer sprites overlap the ones behind them. */
  private actorsInDrawOrder(state: GameState, playerId: string, lobby: boolean): Actor[] {
    const list: Actor[] = [];
    if (!lobby) for (const enemy of state.enemies) if ((enemy.hp > 0 || state.time - (this.defeatedAt.get(enemy.id) ?? -Infinity) < 12) && this.inView(enemy.x, enemy.y, 90)) list.push(enemy);
    for (const player of state.players) if (player.status !== 'extracted' && !lobby && this.inView(player.x, player.y, 90)) list.push(player);
    if (lobby) {
      const hero = state.players.find(player => player.id === playerId);
      if (hero) list.push(hero);
    }
    return list.sort((a, b) => a.y - b.y);
  }

  /** Draws only the part of the world that is on screen; the full terrain bitmap is never scaled per frame. */
  private drawTerrain(c: CanvasRenderingContext2D) {
    const sx = Math.max(0, Math.floor(this.view.x0));
    const sy = Math.max(0, Math.floor(this.view.y0));
    const ex = Math.min(WORLD.width, Math.ceil(this.view.x1));
    const ey = Math.min(WORLD.height, Math.ceil(this.view.y1));
    if (ex <= sx || ey <= sy) return;
    c.drawImage(this.terrain, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);
  }

  /** A single soft shadow tint over the world sells the dusk lighting before the light pass lands. */
  private drawGradedShadow(c: CanvasRenderingContext2D) {
    const v = this.view;
    const grad = c.createLinearGradient(v.x0, v.y0, v.x0, v.y1);
    grad.addColorStop(0, '#0a142445');
    grad.addColorStop(.5, '#0a142410');
    grad.addColorStop(1, '#0a142438');
    c.fillStyle = grad;
    c.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
  }

  private drawPlayerAura(c: CanvasRenderingContext2D, p: Player) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    const glow = c.createRadialGradient(p.x, p.y, 6, p.x, p.y, 96);
    glow.addColorStop(0, '#ffce8a0a');
    glow.addColorStop(.3, '#e0964a06');
    glow.addColorStop(.7, '#a85c2602');
    glow.addColorStop(1, '#a85c2600');
    c.fillStyle = glow;
    c.fillRect(p.x - 96, p.y - 96, 192, 192);
    c.restore();
  }

  private drawBrazier(c: CanvasRenderingContext2D, x: number, y: number, index: number, time: number) {
    if (!this.inView(x, y, 130)) return;
    const flicker = this.reducedMotion ? 0 : Math.sin(time * 7.3 + index * 2.1) * .5 + Math.sin(time * 13.7 + index) * .5;
    const lift = 26 + flicker * 5;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const glow = c.createRadialGradient(x, y, 1, x, y, 84);
    glow.addColorStop(0, '#ffb9661c');
    glow.addColorStop(.26, '#ff8a2e10');
    glow.addColorStop(.62, '#c94a1a06');
    glow.addColorStop(1, '#c94a1a00');
    c.fillStyle = glow;
    c.fillRect(x - 88, y - 88, 176, 176);
    c.restore();

    const lean = this.reducedMotion ? 0 : Math.sin(time * 8 + index) * 2.4;
    /** One teardrop flame: wide base tapering to a licking tip that leans in the wind. */
    const flame = (halfWidth: number, height: number, color: string, sway: number, squash: number) => {
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(x - halfWidth, y + 5 * squash);
      c.bezierCurveTo(x - halfWidth * 1.18, y - height * .34 + 5, x + sway - halfWidth * .42, y - height * .74, x + sway, y - height + 5 * squash);
      c.bezierCurveTo(x + sway + halfWidth * .5, y - height * .7, x + halfWidth * 1.16, y - height * .3 + 5, x + halfWidth, y + 5 * squash);
      c.quadraticCurveTo(x, y + 12 * squash, x - halfWidth, y + 5 * squash);
      c.closePath();
      c.fill();
    };
    flame(10, lift + 15, '#a8300f', lean * 1.5, 1.1);
    flame(8.4, lift + 11, '#e0551c', lean * 1.25, 1);
    flame(6.2, lift + 7, '#f78c24', lean, .92);
    flame(4, lift + 2, '#ffd070', lean * .7, .84);
    flame(2.2, lift * .34, '#fff3c8', lean * .4, .8);
  }

  private drawFireEmbers(c: CanvasRenderingContext2D) {
    if (this.reducedMotion) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const ember of this.fireEmbers) {
      if (!this.inView(ember.x, ember.y, ember.size + 6)) continue;
      const alpha = Math.max(0, ember.life / ember.maxLife);
      c.globalAlpha = alpha * .85;
      c.fillStyle = ember.color;
      c.shadowColor = ember.color;
      c.shadowBlur = 7;
      c.beginPath();
      c.arc(ember.x, ember.y, ember.size, 0, TAU);
      c.fill();
    }
    c.restore();
  }

  /** Rarity is the best item in the container, matching how action RPG drop filters read loot. */
  private lootRarity(items: Item[]) {
    let best = -1;
    let key: Rarity = 'normal';
    for (const item of items) {
      const rarity: Rarity = isGear(item) ? item.rarity : ITEMS[item.kind].rarity;
      const rank = (['normal', 'magic', 'rare', 'unique'] as Rarity[]).indexOf(rarity);
      if (rank > best) { best = rank; key = rarity; }
    }
    return { ...(RARITY[key] ?? RARITY.normal), key };
  }

  private drawLoot(c: CanvasRenderingContext2D, loot: GameState['loot'][number], state: GameState, lobby: boolean, time: number) {
    if (!this.inView(loot.x, loot.y, 80)) return;
    const rarity = this.lootRarity(loot.items);
    const pulse = this.reducedMotion ? 0 : Math.sin(time * 2.4 + loot.x * .01);
    c.save();
    c.translate(loot.x, loot.y);
    c.fillStyle = '#04060899';
    c.beginPath();
    c.ellipse(4, 9, 21, 10, 0, 0, TAU);
    c.fill();
    if (loot.kind === 'herb') {
      c.strokeStyle = '#2b3a24';
      c.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05;
        c.beginPath();
        c.moveTo(0, 4);
        c.quadraticCurveTo(Math.cos(a) * 7, -4, Math.cos(a) * 11, -13 - Math.sin(i) * 4);
        c.stroke();
        c.fillStyle = i % 2 ? '#5f8a52' : '#3f6b41';
        c.beginPath();
        c.ellipse(Math.cos(a) * 11, -13 - Math.sin(i) * 4, 3.4, 7, a * .4, 0, TAU);
        c.fill();
        c.fillStyle = '#9fd08a55';
        c.beginPath();
        c.ellipse(Math.cos(a) * 11 - 1, -14 - Math.sin(i) * 4, 1.2, 3.4, a * .4, 0, TAU);
        c.fill();
      }
    } else if (loot.kind === 'body') {
      c.fillStyle = '#2c1f1a';
      c.beginPath();
      c.ellipse(0, 0, 15, 11, .5, 0, TAU);
      c.fill();
      c.fillStyle = '#43301f';
      c.beginPath();
      c.ellipse(-3, -2, 11, 8, .5, 0, TAU);
      c.fill();
      c.strokeStyle = '#6b5a3f';
      c.lineWidth = 1.4;
      c.beginPath();
      c.arc(-3, -2, 11, .4, 3.4);
      c.stroke();
      c.fillStyle = '#7e1f20aa';
      c.beginPath();
      c.ellipse(6, 6, 12, 6, .2, 0, TAU);
      c.fill();
    } else {
      // Oak chest with iron banding and a brass lock.
      c.fillStyle = '#3a2517';
      c.beginPath();
      c.roundRect(-17, -12, 34, 25, 3);
      c.fill();
      c.fillStyle = '#4f3520';
      c.beginPath();
      c.roundRect(-17, -12, 34, 11, 3);
      c.fill();
      c.fillStyle = '#63452a';
      c.fillRect(-17, -4, 34, 4);
      c.strokeStyle = '#2b3440';
      c.lineWidth = 2.6;
      c.beginPath();
      c.moveTo(-13, -13);
      c.lineTo(-13, 14);
      c.moveTo(13, -13);
      c.lineTo(13, 14);
      c.stroke();
      c.fillStyle = '#8a7340';
      c.fillRect(-4, -3, 8, 7);
      c.fillStyle = '#d8bd72';
      c.fillRect(-2, -1, 4, 3);
      for (let i = 0; i < 5; i++) {
        c.fillStyle = '#2b1c11aa';
        c.fillRect(-14 + i * 6, -11, 1.4, 22);
      }
    }

    // A gear inside the container is previewed as a floating silhouette so the
    // drop reads as an item drop and not just a box.
    const preview = loot.items.find(item => isGear(item));
    if (preview) {
      const gear = preview as Gear;
      const base = baseOf(gear);
      const tint = RARITY[gear.rarity]?.color ?? '#cfd2c2';
      c.save();
      c.translate(0, -34 - pulse * 2);
      c.globalAlpha = .9;
      c.fillStyle = '#0a0d12cc';
      c.beginPath();
      c.arc(0, 0, 10, 0, TAU);
      c.fill();
      c.strokeStyle = tint;
      c.lineWidth = 1.4;
      c.beginPath();
      c.arc(0, 0, 10, 0, TAU);
      c.stroke();
      c.fillStyle = tint;
      const kind = base && 'kind' in base ? base.kind : 'sword';
      c.beginPath();
      if (kind === 'bow' || kind === 'crossbow') {
        c.arc(-2, 0, 6, -Math.PI / 2, Math.PI / 2);
        c.lineWidth = 1.6;
        c.strokeStyle = tint;
        c.stroke();
      } else if (kind === 'axe' || kind === 'mace') {
        c.rect(-1.2, -6, 2.4, 12);
        c.rect(-1, -7, 7, 4);
      } else if (kind === 'dagger') {
        c.moveTo(0, -7);
        c.lineTo(2.4, 1);
        c.lineTo(-2.4, 1);
      } else if (kind === 'greatsword') {
        c.moveTo(-1.8, -8);
        c.lineTo(1.8, -8);
        c.lineTo(1.2, 5);
        c.lineTo(-1.2, 5);
      } else {
        c.moveTo(0, -8);
        c.lineTo(2.6, -3);
        c.lineTo(1.8, 5);
        c.lineTo(-1.8, 5);
        c.lineTo(-2.6, -3);
      }
      c.closePath();
      c.fill();
      c.restore();
    }

    // Ground glow and vertical beam keyed to rarity.
    c.save();
    c.globalCompositeOperation = 'lighter';
    const groundGlow = c.createRadialGradient(0, 2, 1, 0, 2, 28 + pulse * 3);
    groundGlow.addColorStop(0, `${rarity.color}${rarity.glow > .4 ? '77' : '3a'}`);
    groundGlow.addColorStop(1, `${rarity.color}00`);
    c.fillStyle = groundGlow;
    c.fillRect(-34, -32, 68, 68);
    c.restore();

    if (!lobby) {
      c.strokeStyle = `${rarity.color}66`;
      c.lineWidth = 1.3;
      c.setLineDash([9, 7]);
      c.beginPath();
      c.arc(0, 0, 25 + pulse * 2, 0, TAU);
      c.stroke();
      c.setLineDash([]);
    }
    c.restore();
  }

  /** Tall additive beams so rare and epic drops read across the whole screen. */
  private drawBeams(c: CanvasRenderingContext2D, state: GameState, lobby: boolean, time: number) {
    if (lobby) return;
    c.save();
    for (const loot of state.loot) {
      if (loot.opened) continue;
      const rarity = this.lootRarity(loot.items);
      if (!rarity.beam || !this.inView(loot.x, loot.y, 40)) continue;
      const height = rarity.beam * 2.3;
      const pulse = Math.sin(time * 2 + loot.x * .02) * .12 + .88;
      const beam = c.createLinearGradient(loot.x, loot.y - height, loot.x, loot.y);
      beam.addColorStop(0, `${rarity.color}00`);
      beam.addColorStop(.58, `${rarity.color}1e`);
      beam.addColorStop(1, `${rarity.color}66`);
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = pulse;
      c.fillStyle = beam;
      c.beginPath();
      c.moveTo(loot.x - 7, loot.y);
      c.lineTo(loot.x - 2, loot.y - height);
      c.lineTo(loot.x + 2, loot.y - height);
      c.lineTo(loot.x + 7, loot.y);
      c.closePath();
      c.fill();
      const halo = c.createRadialGradient(loot.x, loot.y, 1, loot.x, loot.y, height * .34);
      halo.addColorStop(0, `${rarity.color}1c`);
      halo.addColorStop(1, `${rarity.color}00`);
      c.fillStyle = halo;
      c.fillRect(loot.x - height * .34, loot.y - height * .34, height * .68, height * .68);
    }
    c.restore();
  }

  private drawExit(c: CanvasRenderingContext2D, exit: typeof EXITS[number], time: number) {
    if (!this.inView(exit.x, exit.y, 150)) return;
    const breathe = this.reducedMotion ? 0 : Math.sin(time * 1.6 + exit.x * .01) * 5;
    c.save();
    c.translate(exit.x, exit.y);
    // Worn stone ring on the ground.
    c.strokeStyle = '#585c4e66';
    c.lineWidth = 5;
    c.beginPath();
    c.arc(0, 0, 62, 0, TAU);
    c.stroke();
    for (let i = 0; i < 22; i++) {
      const a = i / 22 * TAU;
      c.fillStyle = i % 3 ? '#4e5046' : '#63665a';
      c.beginPath();
      c.ellipse(Math.cos(a) * 62, Math.sin(a) * 62, 7, 5, a, 0, TAU);
      c.fill();
    }
    // Rune-lit arch.
    c.save();
    c.globalCompositeOperation = 'lighter';
    const pool = c.createRadialGradient(0, 0, 4, 0, 0, 78 + breathe);
    pool.addColorStop(0, '#a9ffe036');
    pool.addColorStop(.4, '#57d8a61e');
    pool.addColorStop(1, '#3fb98f00');
    c.fillStyle = pool;
    c.fillRect(-90, -90, 180, 180);
    c.restore();
    c.strokeStyle = '#8ef0cf';
    c.lineWidth = 2;
    c.setLineDash([11, 9]);
    c.beginPath();
    c.arc(0, 0, 46, time * .16, time * .16 + TAU);
    c.stroke();
    c.setLineDash([]);
    c.save();
    c.globalCompositeOperation = 'lighter';
    const gate = c.createLinearGradient(0, -56, 0, 12);
    gate.addColorStop(0, '#b6ffe400');
    gate.addColorStop(1, '#8ef0cf5e');
    c.fillStyle = gate;
    c.beginPath();
    c.moveTo(-15, 10);
    c.quadraticCurveTo(-16, -46, 0, -54);
    c.quadraticCurveTo(16, -46, 15, 10);
    c.closePath();
    c.fill();
    c.restore();
    c.strokeStyle = '#d6ffe9';
    c.lineWidth = 2.4;
    c.beginPath();
    c.moveTo(-14, 12);
    c.quadraticCurveTo(-15, -45, 0, -53);
    c.quadraticCurveTo(15, -45, 14, 12);
    c.stroke();
    c.font = '600 12px "Noto Sans JP", sans-serif';
    c.textAlign = 'center';
    c.fillStyle = '#d9ffe9';
    c.shadowColor = '#0a1a14';
    c.shadowBlur = 6;
    c.fillText(exit.name, 0, 88);
    c.shadowBlur = 0;
    c.restore();
  }

  private drawArrows(c: CanvasRenderingContext2D, state: GameState) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const arrow of state.arrows) {
      if (!this.inView(arrow.x, arrow.y, 70)) continue;
      const element = dominantElement(arrow.damage);
      const color = element ? ELEMENT_COLORS[element] : '#ffce7a';
      const tailX = arrow.x - arrow.vx * .048;
      const tailY = arrow.y - arrow.vy * .048;
      const trail = c.createLinearGradient(tailX, tailY, arrow.x, arrow.y);
      trail.addColorStop(0, `${color}00`);
      trail.addColorStop(.56, `${color}aa`);
      trail.addColorStop(1, '#fff0ba');
      c.strokeStyle = trail;
      c.lineWidth = 4.5;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(tailX, tailY);
      c.lineTo(arrow.x, arrow.y);
      c.stroke();
      c.strokeStyle = '#fff6d2';
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(tailX, tailY);
      c.lineTo(arrow.x, arrow.y);
      c.stroke();
      const angle = Math.atan2(arrow.vy, arrow.vx);
      c.fillStyle = '#fff6d4';
      c.shadowColor = color;
      c.shadowBlur = 12;
      c.beginPath();
      c.moveTo(arrow.x + Math.cos(angle) * 6, arrow.y + Math.sin(angle) * 6);
      c.lineTo(arrow.x + Math.cos(angle + 2.5) * 4, arrow.y + Math.sin(angle + 2.5) * 4);
      c.lineTo(arrow.x + Math.cos(angle - 2.5) * 4, arrow.y + Math.sin(angle - 2.5) * 4);
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  private drawBlood(c: CanvasRenderingContext2D) {
    for (const decal of this.blood) {
      if (!this.inView(decal.x, decal.y, decal.size)) continue;
      c.save();
      c.translate(decal.x, decal.y);
      c.rotate(decal.rotation);
      c.globalAlpha = decal.alpha;
      c.fillStyle = '#3d1116';
      c.beginPath();
      c.ellipse(0, 0, decal.size, decal.size * .42, 0, 0, TAU);
      c.fill();
      c.fillStyle = '#6a1c1f';
      c.globalAlpha = decal.alpha * .5;
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
        if (!this.inView(ring.x, ring.y, ring.to)) continue;
        const age = 1 - ring.life / ring.maxLife;
        const eased = 1 - (1 - age) * (1 - age);
        c.globalAlpha = (1 - age) * .9;
        c.strokeStyle = ring.color;
        c.lineWidth = ring.width;
        c.shadowColor = ring.glow ? ring.color : 'transparent';
        c.shadowBlur = ring.glow ? 12 : 0;
        c.beginPath();
        c.arc(ring.x, ring.y, ring.from + (ring.to - ring.from) * eased, 0, TAU);
        c.stroke();
      }
      for (const particle of this.hitParticles) {
        if (!this.inView(particle.x, particle.y, particle.size + 4)) continue;
        const alpha = Math.max(0, particle.life / particle.maxLife);
        c.globalAlpha = alpha;
        c.fillStyle = particle.color;
        c.shadowColor = particle.glow ? particle.color : 'transparent';
        c.shadowBlur = particle.glow ? 11 : 0;
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
      if (!this.inView(number.x, number.y, 60)) continue;
      const alpha = Math.max(0, number.life / number.maxLife);
      const scale = 1 / Math.max(.55, this.camera.zoom);
      c.globalAlpha = Math.min(1, alpha * 1.5);
      c.font = `700 ${number.size * scale}px Georgia, "Noto Sans JP", serif`;
      c.fillStyle = number.color;
      c.strokeStyle = '#05070acc';
      c.lineWidth = 3.4 * scale;
      c.shadowColor = number.color;
      c.shadowBlur = 9 * scale;
      c.strokeText(String(number.value), number.x, number.y);
      c.fillText(String(number.value), number.x, number.y);
    }
    c.restore();
  }

  private drawAttackFx(c: CanvasRenderingContext2D, fx: AttackFx) {
    const progress = 1 - fx.life / fx.maxLife;
    c.save();
    c.translate(fx.x, fx.y);
    c.rotate(fx.angle);
    c.globalCompositeOperation = 'lighter';
    if (fx.kind === 'melee') {
      const radius = fx.range * (.55 + progress * .75);
      c.globalAlpha = (1 - progress) * .9;
      c.strokeStyle = fx.color;
      c.lineWidth = 3.2 / Math.max(.7, this.camera.zoom);
      c.shadowColor = fx.color;
      c.shadowBlur = 16 / Math.max(.7, this.camera.zoom);
      c.beginPath();
      c.arc(0, 0, radius, -1.9 + progress * .5, .35 + progress * .45);
      c.stroke();
      c.globalAlpha = (1 - progress) * .45;
      c.fillStyle = fx.color;
      c.beginPath();
      c.arc(0, 0, 6, 0, Math.PI * 2);
      c.fill();
    } else {
      c.globalAlpha = (1 - progress) * .95;
      c.fillStyle = fx.color;
      c.shadowColor = fx.color;
      c.shadowBlur = 18 / Math.max(.7, this.camera.zoom);
      c.beginPath();
      c.arc(0, 0, 5 + progress * 9, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = (1 - progress) * .55;
      c.strokeStyle = fx.color;
      c.lineWidth = 2 / Math.max(.7, this.camera.zoom);
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(26 + progress * 18, 0);
      c.stroke();
    }
    c.restore();
  }

  private drawSlash(c: CanvasRenderingContext2D, actor: Actor, self: boolean, glow?: string | null) {
    const duration = self ? .22 : .3;
    const progress = Math.max(0, Math.min(1, 1 - actor.swing / duration));
    const warm = glow ?? (self ? '#ffd27c' : '#ff6b5c');
    const pale = glow ? '#fff4e2' : self ? '#fff0b8' : '#ffb19b';
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

  // ---------------------------------------------------------------- lighting & post

  private pushLight(lights: Light[], x: number, y: number, radius: number, r: number, g: number, b: number, intensity: number, flicker = 0) {
    if (!this.inView(x, y, radius)) return;
    lights.push({ x, y, radius, r, g, b, intensity, flicker });
  }

  /** Collects every light in the scene, then resolves it on a downscaled field. */
  private gatherLights(state: GameState, lobby: boolean, time: number, p: Player | undefined) {
    const lights: Light[] = [];
    for (let i = 0; i < FIRES.length; i++) {
      const [x, y] = FIRES[i];
      const flicker = this.reducedMotion ? 0 : Math.sin(time * 6.1 + i * 2.3) * .07 + Math.sin(time * 11.3 + i) * .04;
      this.pushLight(lights, x, y, 224, 255, 172, 92, .58 + flicker, flicker);
    }
    for (const lantern of this.lanterns) this.pushLight(lights, lantern.x, lantern.y, 116, 255, 174, 96, .4);
    for (const exit of EXITS) this.pushLight(lights, exit.x, exit.y, 196, 118, 246, 200, .4);
    for (const loot of state.loot) {
      if (loot.opened) continue;
      const rarity = this.lootRarity(loot.items);
      const rgb = rarity.key === 'unique' ? [255, 154, 60] : rarity.key === 'rare' ? [240, 220, 99] : rarity.key === 'magic' ? [109, 140, 240] : [190, 205, 210];
      this.pushLight(lights, loot.x, loot.y, 46 + rarity.beam * .52, rgb[0], rgb[1], rgb[2], .14 + rarity.glow * .26);
    }
    for (const arrow of state.arrows) {
      const element = dominantElement(arrow.damage);
      const color = element ? ELEMENT_COLORS[element] : '#ffbe6e';
      const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
      this.pushLight(lights, arrow.x, arrow.y, 48, rgb[0], rgb[1], rgb[2], .34);
    }
    for (const player of state.players) {
      if (player.status !== 'alive') continue;
      const self = player.id === p?.id;
      this.pushLight(lights, player.x, player.y, self ? 124 : 96, 255, 214, 166, self ? .22 : .08);
    }
    if (!lobby) for (const actor of [...state.players, ...state.enemies]) {
      if (actor.hp <= 0 || actor.swing <= 0) continue;
      const color = 'status' in actor ? this.heldGlow(actor as Player) : this.enemyGlow(actor);
      if (!color) continue;
      const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
      this.pushLight(lights, actor.x + Math.cos(actor.angle) * 35, actor.y + Math.sin(actor.angle) * 35, 95, rgb[0], rgb[1], rgb[2], .3);
    }
    // A cold key light so the far side of the map never reads as pure black.
    this.pushLight(lights, this.camera.x, this.camera.y, Math.max(this.width, this.height) / this.camera.zoom * .95, 150, 178, 216, lobby ? .34 : .06);
    return lights;
  }

  private applyLighting(c: CanvasRenderingContext2D, w: number, h: number, time: number, lobby: boolean, fullMap: boolean, p: Player | undefined) {
    const lw = this.lightMap.width;
    const lh = this.lightMap.height;
    const lights = this.gatherLights(this.lastState, lobby, time, p);
    const lc = this.lightCtx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    lc.fillStyle = lobby ? AMBIENT_BASE : fullMap ? AMBIENT_MAP : AMBIENT_RAID;
    lc.fillRect(0, 0, lw, lh);
    lc.save();
    lc.setTransform(LIGHT_SCALE, 0, 0, LIGHT_SCALE, 0, 0);
    lc.translate(w / 2 + this.shakeX, h / 2 + this.shakeY);
    lc.scale(this.camera.zoom, this.camera.zoom);
    lc.translate(-this.camera.x, -this.camera.y);
    lc.globalCompositeOperation = 'lighter';
    for (const light of lights) {
      const gradient = lc.createRadialGradient(light.x, light.y, 0, light.x, light.y, light.radius);
      const a = Math.max(0, light.intensity);
      gradient.addColorStop(0, `rgba(${light.r},${light.g},${light.b},${Math.min(1, a)})`);
      gradient.addColorStop(.42, `rgba(${light.r},${light.g},${light.b},${Math.min(1, a * .46)})`);
      gradient.addColorStop(.74, `rgba(${light.r},${light.g},${light.b},${Math.min(1, a * .14)})`);
      gradient.addColorStop(1, `rgba(${light.r},${light.g},${light.b},0)`);
      lc.fillStyle = gradient;
      lc.fillRect(light.x - light.radius, light.y - light.radius, light.radius * 2, light.radius * 2);
    }
    lc.restore();
    // Squaring the field: a cheap brightness threshold that also builds the bloom source.
    const ba = this.bloomACtx;
    ba.setTransform(1, 0, 0, 1, 0, 0);
    ba.globalCompositeOperation = 'source-over';
    ba.clearRect(0, 0, this.bloomA.width, this.bloomA.height);
    // Threshold out ambient light before bloom: darkness must not become a grey veil.
    ba.filter = 'brightness(.85) contrast(3)';
    ba.drawImage(this.lightMap, 0, 0, this.bloomA.width, this.bloomA.height);
    ba.filter = 'none';
    ba.globalCompositeOperation = 'multiply';
    ba.drawImage(this.lightMap, 0, 0, this.bloomA.width, this.bloomA.height);
    ba.globalCompositeOperation = 'source-over';

    c.save();
    c.globalCompositeOperation = 'multiply';
    c.imageSmoothingEnabled = true;
    c.drawImage(this.lightMap, 0, 0, w, h);
    c.restore();
    // Screen compositing the squared field gives fire and magic a bleed without a second light pass.
    c.save();
    c.globalCompositeOperation = 'screen';
    c.globalAlpha = .14;
    c.drawImage(this.bloomA, 0, 0, w, h);
    c.restore();
  }

  /** Two-stage downsample bloom: bright light and magic bleed past their own edges. */
  private applyBloom(c: CanvasRenderingContext2D, w: number, h: number) {
    if (this.reducedMotion || w < 40 || h < 40) return;
    const b = this.bloomBCtx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, this.bloomB.width, this.bloomB.height);
    b.drawImage(this.bloomA, 0, 0, this.bloomB.width, this.bloomB.height);
    b.globalCompositeOperation = 'lighter';
    b.globalAlpha = .7;
    b.drawImage(this.bloomA, -this.bloomB.width * .05, -this.bloomB.height * .05, this.bloomB.width * 1.1, this.bloomB.height * 1.1);
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = .09;
    c.drawImage(this.bloomA, 0, 0, w, h);
    c.globalAlpha = .07;
    c.drawImage(this.bloomB, 0, 0, w, h);
    c.restore();
  }

  private drawAtmosphere(c: CanvasRenderingContext2D, w: number, h: number, lobby: boolean, p: Player | undefined, time: number) {
    if (this.atmosphere) c.drawImage(this.atmosphere, 0, 0, w, h);
    if (!lobby && !this.reducedMotion) {
      // Drifting mist ridges.
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = .017;
      for (let i = 0; i < 2; i++) {
        const ox = ((time * (9 + i * 5)) % (w + 900)) - 450;
        const oy = h * (.16 + i * .46) + Math.sin(time * .2 + i) * 26;
        c.drawImage(this.mist, ox, oy, w * 1.3, h * .9);
      }
      c.restore();
      // Floating ash.
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 34; i++) {
        const x = (i * 137.9 + time * (4 + i % 5)) % w;
        const y = (i * 81.4 - time * 9 + h * 100) % h;
        c.fillStyle = `rgba(226,214,178,${.07 + Math.sin(time * 1.4 + i) * .05})`;
        c.fillRect(x, y, i % 3 === 0 ? 2 : 1, 2);
      }
      c.restore();
      // Film grain, kept subtle enough to read as texture rather than noise.
      c.save();
      c.globalAlpha = .055;
      c.globalCompositeOperation = 'overlay';
      if (this.grainView) {
        const gx = (time * 97) % 160;
        const gy = (time * 61) % 160;
        c.drawImage(this.grainView, gx, gy);
      }
      c.restore();
    }
    if (!lobby && p && p.hurt > 0) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = `rgba(150,24,16,${p.hurt * .5})`;
      c.fillRect(0, 0, w, h);
      c.restore();
    }
  }

  private drawReticle(c: CanvasRenderingContext2D, aim: Aim, time: number) {
    const x = this.width / 2 + (aim.x - this.camera.x) * this.camera.zoom + this.shakeX;
    const y = this.height / 2 + (aim.y - this.camera.y) * this.camera.zoom + this.shakeY;
    if (x < -28 || x > this.width + 28 || y < -28 || y > this.height + 28) return;
    const pulse = aim.hot && !this.reducedMotion ? Math.sin(time * 15) * 1.6 + 1.8 : 0;
    const color = aim.hot ? '#ffd17d' : '#e6dfc0';
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 1.4;
    c.shadowColor = aim.hot ? '#ff9d4b' : '#d9cfaa';
    c.shadowBlur = aim.hot ? 12 : 4;
    c.globalAlpha = .92;
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
    c.fillStyle = '#05070ae8';
    c.strokeStyle = main ? '#c2a468' : '#8d9a8a66';
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(-17, -20, 34, 34, 2);
    c.fill();
    c.stroke();
    c.font = '13px Georgia';
    c.fillStyle = main ? '#d7bb86' : '#c2c7ac';
    c.textAlign = 'center';
    c.fillText(n, 0, 2);
    c.fillStyle = '#05070adc';
    c.fillRect(-text.length * 7 - 12, 24, text.length * 14 + 24, 28);
    c.font = '13px "Noto Sans JP", sans-serif';
    c.fillStyle = '#e0dfc6';
    c.fillText(text, 0, 43);
    c.restore();
  }

  // ---------------------------------------------------------------- actors

  private observeMovement(state: GameState, dt: number) {
    const seen = new Set<string>();
    for (const a of [...state.players, ...state.enemies]) {
      seen.add(a.id);
      const prev = this.gait.get(a.id);
      const d = prev ? Math.hypot(a.x - prev.x, a.y - prev.y) : 0;
      const speed = d > 50 || dt <= 0 ? 0 : Math.min(480, d / dt);
      this.gait.set(a.id, { x: a.x, y: a.y, phase: (prev?.phase ?? 0) + Math.min(d, 25) * .11, speed: speed * .3 + (prev?.speed ?? 0) * .7 });
    }
    for (const id of this.gait.keys()) if (!seen.has(id)) this.gait.delete(id);
  }

  private figureSurface() {
    if (this.figureCtx) return this.figureCtx;
    this.figure.width = this.figure.height = 576;
    this.figureCtx = this.figure.getContext('2d')!;
    const grain = document.createElement('canvas');
    grain.width = grain.height = 64;
    const gc = grain.getContext('2d')!;
    const image = gc.createImageData(64, 64);
    const random = seeded(19403);
    for (let i = 0; i < image.data.length; i += 4) {
      const shade = random() > .5 ? 220 : 12;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = shade;
      image.data[i + 3] = 90 + random() * 110;
    }
    gc.putImageData(image, 0, 0);
    this.materialGrain = this.figureCtx.createPattern(grain, 'repeat');
    return this.figureCtx;
  }

  private drawActorShadow(c: CanvasRenderingContext2D, soft: number) {
    const g = c.createRadialGradient(3, 11, 1, 3, 11, 27);
    g.addColorStop(0, `rgba(3,5,8,${soft})`);
    g.addColorStop(.55, `rgba(3,5,8,${soft * .55})`);
    g.addColorStop(1, 'rgba(3,5,8,0)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(3, 11, 25, 12, .1, 0, TAU);
    c.fill();
    c.fillStyle = `rgba(3,5,8,${soft * .9})`;
    c.beginPath();
    c.ellipse(2, 10, 15, 8, .12, 0, TAU);
    c.fill();
  }

  /** The weapon kind a player is holding, taken from the gear in the active slot. */
  private heldWeapon(player: Player): string {
    return weaponAppearance(player).kind;
  }

  /** Enchant glow of the held weapon, coloured by rarity like an action RPG item filter. */
  private heldGlow(player: Player): string | null {
    return weaponAppearance(player).color;
  }

  /** Hostiles carry crude varied arms; knights heft two-handers. */
  private enemyWeapon(actor: { kind?: string; phase?: number }): string {
    if (actor.kind === 'knight') return 'greatsword';
    const pick = Math.floor((actor.phase ?? 0) * 3.1) % 3;
    return pick === 0 ? 'sword' : pick === 1 ? 'axe' : 'mace';
  }

  /** Knights smoulder with furnace light, elites carry champion gold. */
  private enemyGlow(actor: { kind?: string; elite?: boolean }): string | null {
    if (actor.elite) return '#ffc46a';
    return actor.kind === 'knight' ? '#ff7a4a' : null;
  }

  // ---------------------------------------------------------------- metals & materials

  /** Multi-stop steel: dark backing, brushed mid, specular crest. Used by blades and plate. */
  private steel(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, dark = '#1e242a', mid = '#78848e', light = '#c2ced7') {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, dark);
    g.addColorStop(.38, mid);
    g.addColorStop(.62, light);
    g.addColorStop(1, mid);
    return g;
  }

  private wood(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#2b2012');
    g.addColorStop(.45, '#7c5d33');
    g.addColorStop(1, '#33240f');
    return g;
  }

  /** Enchant overlay: a luminous edge line and soft haze for magic-and-better gear. */
  private enchant(c: CanvasRenderingContext2D, glow: string | null | undefined, x0: number, y0: number, x1: number, y1: number, width = 1.7) {
    if (!glow) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const line = c.createLinearGradient(x0, y0, x1, y1);
    line.addColorStop(0, `${glow}00`);
    line.addColorStop(.5, `${glow}77`);
    line.addColorStop(1, `${glow}ee`);
    c.strokeStyle = line;
    c.lineWidth = width;
    c.shadowColor = glow;
    c.shadowBlur = 6;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const haze = c.createRadialGradient(mx, my, 1, mx, my, 30);
    haze.addColorStop(0, `${glow}2a`);
    haze.addColorStop(1, `${glow}00`);
    c.fillStyle = haze;
    c.fillRect(mx - 30, my - 30, 60, 60);
    c.restore();
  }

  /**
   * The weapon in the fighter's hand. Every piece is built from gradients, bevels and
   * wrap details so steel reads as steel at gameplay size, matching the painted terrain.
   */
  private weapon(c: CanvasRenderingContext2D, kind: string, glow?: string | null) {
    if (hasSwordArt(kind) && this.swordImage.complete && this.swordImage.naturalWidth > 0) {
      const rect = swordSpriteRect(kind);
      c.save();
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.shadowColor = '#020409b3'; c.shadowBlur = 1.5;
      c.drawImage(this.swordImage, rect.x, rect.y, rect.width, rect.height);
      c.restore();
      this.enchant(c, glow, -.5, rect.y + 3, -.5, -3, 1.1);
      return;
    }
    switch (kind) {
      case 'katana': {
        // Blade: gentle curve, dark spine, bright cutting edge and a wavy hamon.
        const blade = c.createLinearGradient(-2.4, 0, 3, 0);
        blade.addColorStop(0, '#252c33');
        blade.addColorStop(.35, '#8d99a3');
        blade.addColorStop(.7, '#dbe6ec');
        blade.addColorStop(1, '#5b6771');
        c.fillStyle = blade;
        c.beginPath();
        c.moveTo(-1.4, 1);
        c.quadraticCurveTo(3.2, -18, 1.4, -37);
        c.lineTo(3, -36.2);
        c.quadraticCurveTo(4.8, -18, .6, 1.6);
        c.closePath();
        c.fill();
        c.strokeStyle = '#f2f8fb';
        c.lineWidth = .9;
        c.beginPath();
        c.moveTo(.4, .4);
        c.quadraticCurveTo(4.2, -18, 2.2, -35.6);
        c.stroke();
        // Hamon: the temper line along the edge.
        c.strokeStyle = '#cfe0eccc';
        c.lineWidth = 1.1;
        c.beginPath();
        c.moveTo(-.2, -2);
        c.quadraticCurveTo(2.2, -12, 1.2, -22);
        c.quadraticCurveTo(.6, -29, 1.6, -34);
        c.stroke();
        // Tsuba, grip wrap and cap.
        c.fillStyle = this.steel(c, -6, 0, 6, 4, '#241f14', '#8a7442', '#d8bc72');
        c.beginPath();
        c.ellipse(0, 3, 5.4, 2.1, 0, 0, TAU);
        c.fill();
        c.fillStyle = '#23262c';
        c.fillRect(-1.7, 3.6, 3.4, 10);
        c.strokeStyle = '#6e6250';
        c.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
          c.beginPath();
          c.moveTo(-1.7, 5 + i * 1.9);
          c.lineTo(1.7, 6.2 + i * 1.9);
          c.stroke();
        }
        c.fillStyle = '#3c4148';
        c.beginPath();
        c.arc(0, 14.4, 2, 0, TAU);
        c.fill();
        this.enchant(c, glow, 1.4, -34, .6, -2);
        break;
      }
      case 'axe': {
        // Haft with grain plus a bearded head with a honed edge.
        c.fillStyle = this.wood(c, -2.6, 0, 2.6, 0);
        c.fillRect(-2.1, -31, 4.2, 42);
        c.strokeStyle = '#22180c88';
        c.lineWidth = .8;
        for (let i = 0; i < 3; i++) {
          c.beginPath();
          c.moveTo(-1 + i, -28);
          c.lineTo(-.6 + i, 8);
          c.stroke();
        }
        c.fillStyle = '#241a10';
        c.fillRect(-2.6, 4, 5.2, 7);
        c.strokeStyle = '#7c6448';
        c.lineWidth = .9;
        for (let i = 0; i < 4; i++) {
          c.beginPath();
          c.moveTo(-2.6, 5 + i * 1.8);
          c.lineTo(2.6, 6 + i * 1.8);
          c.stroke();
        }
        const head = c.createLinearGradient(0, -32, 16, -12);
        head.addColorStop(0, '#2a3239');
        head.addColorStop(.45, '#8b98a2');
        head.addColorStop(.8, '#cfdbe3');
        head.addColorStop(1, '#4a555e');
        c.fillStyle = head;
        c.beginPath();
        c.moveTo(1, -33);
        c.quadraticCurveTo(17, -30, 15.5, -11.5);
        c.quadraticCurveTo(12, -16.5, 9.5, -17);
        c.quadraticCurveTo(7, -22, 1, -19.5);
        c.closePath();
        c.fill();
        c.strokeStyle = '#f4fafc';
        c.lineWidth = 1.3;
        c.beginPath();
        c.moveTo(15.2, -29);
        c.quadraticCurveTo(18.4, -21, 15.4, -11.8);
        c.stroke();
        c.fillStyle = '#20262bcc';
        c.beginPath();
        c.moveTo(1, -31.5);
        c.quadraticCurveTo(6, -28, 5, -19);
        c.lineTo(1, -19.5);
        c.closePath();
        c.fill();
        c.fillStyle = '#c8d2d8';
        c.beginPath();
        c.arc(2.2, -28, 1.1, 0, TAU);
        c.arc(2.2, -23, 1.1, 0, TAU);
        c.fill();
        this.enchant(c, glow, 15, -28, 15, -13);
        break;
      }
      case 'mace': {
        c.fillStyle = this.wood(c, -2.3, 0, 2.3, 0);
        c.fillRect(-1.9, -15, 3.8, 25);
        c.fillStyle = '#241a10';
        c.fillRect(-2.3, 5, 4.6, 6);
        // Flanged head: a core with four visible plates.
        c.fillStyle = this.steel(c, -8, -28, 8, -12, '#222a31', '#7f8b95', '#c9d5dd');
        c.beginPath();
        c.roundRect(-6.5, -28, 13, 15, 2.4);
        c.fill();
        for (const [dx, skew] of [[-8.6, -.18], [8.6, .18]] as const) {
          c.fillStyle = this.steel(c, dx - 3, -28, dx + 3, -12, '#1c2228', '#6d7982', '#b8c4cc');
          c.beginPath();
          c.moveTo(dx + skew * 10, -27);
          c.lineTo(dx + (dx < 0 ? -3.4 : 3.4), -24.5);
          c.lineTo(dx + (dx < 0 ? -3.4 : 3.4), -13.5);
          c.lineTo(dx + skew * 10, -12);
          c.closePath();
          c.fill();
          c.strokeStyle = '#d7e2e9aa';
          c.lineWidth = .9;
          c.stroke();
        }
        c.fillStyle = this.steel(c, -3, -31, 3, -26, '#242c33', '#8b98a2', '#d3dee5');
        c.beginPath();
        c.moveTo(0, -32.5);
        c.lineTo(3, -27);
        c.lineTo(-3, -27);
        c.closePath();
        c.fill();
        c.fillStyle = '#0f1418';
        c.fillRect(-6.5, -21.5, 13, 2);
        c.fillStyle = '#aab6be';
        c.beginPath();
        c.arc(0, -27.5, 1.2, 0, TAU);
        c.fill();
        this.enchant(c, glow, -6, -26, 6, -16);
        break;
      }
      case 'dagger': {
        const blade = c.createLinearGradient(-2, 0, 2.4, 0);
        blade.addColorStop(0, '#242b32');
        blade.addColorStop(.4, '#8b98a2');
        blade.addColorStop(.75, '#e2ecf1');
        blade.addColorStop(1, '#4d5860');
        c.fillStyle = blade;
        c.beginPath();
        c.moveTo(-1.7, 1);
        c.lineTo(-2.6, -13);
        c.lineTo(0, -21.5);
        c.lineTo(2.6, -13);
        c.lineTo(1.7, 1);
        c.closePath();
        c.fill();
        c.strokeStyle = '#f4fafc';
        c.lineWidth = .8;
        c.beginPath();
        c.moveTo(0, -20);
        c.lineTo(0, 1);
        c.stroke();
        c.fillStyle = this.steel(c, -5, 0, 5, 3, '#20262c', '#77828b', '#c4d0d8');
        c.beginPath();
        c.roundRect(-4.6, .4, 9.2, 2.8, 1.2);
        c.fill();
        c.fillStyle = '#2c2114';
        c.fillRect(-1.5, 3.2, 3, 8);
        c.strokeStyle = '#8a6f4a';
        c.lineWidth = .8;
        for (let i = 0; i < 3; i++) {
          c.beginPath();
          c.moveTo(-1.5, 4.6 + i * 2);
          c.lineTo(1.5, 5.6 + i * 2);
          c.stroke();
        }
        c.fillStyle = '#b98d4c';
        c.beginPath();
        c.arc(0, 12, 1.7, 0, TAU);
        c.fill();
        this.enchant(c, glow, 0, -19, 0, -2);
        break;
      }
      case 'greatsword': {
        // Long two-hander with a fullered ridge and drooping quillons.
        const blade = c.createLinearGradient(-4, 0, 4, 0);
        blade.addColorStop(0, '#1f262c');
        blade.addColorStop(.3, '#79858f');
        blade.addColorStop(.55, '#d5e0e7');
        blade.addColorStop(.8, '#7c8892');
        blade.addColorStop(1, '#242c33');
        c.fillStyle = blade;
        c.beginPath();
        c.moveTo(-3.6, 2);
        c.lineTo(-4.8, -31);
        c.lineTo(0, -43.5);
        c.lineTo(4.8, -31);
        c.lineTo(3.6, 2);
        c.closePath();
        c.fill();
        c.fillStyle = '#2a323999';
        c.fillRect(-1.2, -29, 2.4, 29);
        c.strokeStyle = '#eff6fa';
        c.lineWidth = 1.1;
        c.beginPath();
        c.moveTo(-3.6, 0);
        c.lineTo(-4.5, -30);
        c.lineTo(0, -42);
        c.stroke();
        c.beginPath();
        c.moveTo(3.6, 0);
        c.lineTo(4.5, -30);
        c.stroke();
        // Guard.
        const guard = c.createLinearGradient(-11, 0, 11, 4);
        guard.addColorStop(0, '#252c32');
        guard.addColorStop(.5, '#8d99a3');
        guard.addColorStop(1, '#2b333a');
        c.fillStyle = guard;
        c.beginPath();
        c.moveTo(-11, 1.6);
        c.quadraticCurveTo(0, 4.6, 11, 1.6);
        c.lineTo(10, 4.6);
        c.quadraticCurveTo(0, 7.2, -10, 4.6);
        c.closePath();
        c.fill();
        c.fillStyle = '#b98d4c';
        c.fillRect(-2, .6, 4, 2.2);
        // Grip and wheel pommel.
        c.fillStyle = '#24222a';
        c.fillRect(-2.4, 4, 4.8, 12);
        c.strokeStyle = '#6e6250';
        c.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
          c.beginPath();
          c.moveTo(-2.4, 6 + i * 2);
          c.lineTo(2.4, 7.2 + i * 2);
          c.stroke();
        }
        c.fillStyle = this.steel(c, -3, 16, 3, 21, '#20262c', '#78848e', '#c8d4dc');
        c.beginPath();
        c.arc(0, 18.6, 3.1, 0, TAU);
        c.fill();
        c.fillStyle = '#e7eef3';
        c.beginPath();
        c.arc(-.9, 17.7, .9, 0, TAU);
        c.fill();
        this.enchant(c, glow, 0, -40, 0, -4, 2.1);
        break;
      }
      case 'crossbow': {
        // Tiller, steel prod, drawn string and a nocked bolt.
        c.fillStyle = this.wood(c, -3, 0, 3, 0);
        c.beginPath();
        c.moveTo(-2.6, 12);
        c.lineTo(-2.2, -10);
        c.lineTo(2.2, -10);
        c.lineTo(2.6, 12);
        c.closePath();
        c.fill();
        c.strokeStyle = '#22180c88';
        c.lineWidth = .8;
        c.beginPath();
        c.moveTo(-1, 10);
        c.lineTo(-.6, -8);
        c.stroke();
        c.fillStyle = this.steel(c, -14, -18, 14, -12, '#20272d', '#7c8892', '#cbd7de');
        c.beginPath();
        c.moveTo(-13, -13.2);
        c.quadraticCurveTo(-6, -19.5, -1.8, -17.2);
        c.lineTo(-1.8, -13.8);
        c.quadraticCurveTo(-6, -15.8, -13, -10.2);
        c.closePath();
        c.fill();
        c.beginPath();
        c.moveTo(13, -13.2);
        c.quadraticCurveTo(6, -19.5, 1.8, -17.2);
        c.lineTo(1.8, -13.8);
        c.quadraticCurveTo(6, -15.8, 13, -10.2);
        c.closePath();
        c.fill();
        c.strokeStyle = '#d9e2e8';
        c.lineWidth = .9;
        c.beginPath();
        c.moveTo(-13, -11.6);
        c.quadraticCurveTo(0, -16, 13, -11.6);
        c.stroke();
        c.strokeStyle = '#cbbb92';
        c.lineWidth = 1.1;
        c.beginPath();
        c.moveTo(-13, -11.6);
        c.lineTo(0, -8);
        c.lineTo(13, -11.6);
        c.stroke();
        // Bolt.
        c.fillStyle = '#6b5535';
        c.fillRect(-1, -18, 2, 12);
        c.fillStyle = this.steel(c, -2, -22, 2, -17, '#242b31', '#8b98a2', '#dce6ec');
        c.beginPath();
        c.moveTo(-1.8, -18);
        c.lineTo(0, -22.4);
        c.lineTo(1.8, -18);
        c.closePath();
        c.fill();
        c.fillStyle = '#b9564a';
        c.beginPath();
        c.moveTo(-1, -6.8);
        c.lineTo(-3.2, -3.6);
        c.lineTo(-1, -4.4);
        c.closePath();
        c.moveTo(1, -6.8);
        c.lineTo(3.2, -3.6);
        c.lineTo(1, -4.4);
        c.closePath();
        c.fill();
        c.fillStyle = this.steel(c, -2, 12, 2, 18, '#20262c', '#77828b', '#c4d0d8');
        c.beginPath();
        c.roundRect(-2.4, 11, 4.8, 5, 1.4);
        c.fill();
        this.enchant(c, glow, 0, -21, 0, -6);
        break;
      }
      case 'bow': {
        // Recurve limbs with lamination, a wrapped grip, string and nocked arrow.
        const limb = c.createLinearGradient(-12, -20, 6, 12);
        limb.addColorStop(0, '#33250f');
        limb.addColorStop(.5, '#8a6a37');
        limb.addColorStop(1, '#2c2110');
        c.strokeStyle = limb;
        c.lineWidth = 3.4;
        c.beginPath();
        c.moveTo(1.6, -21.5);
        c.quadraticCurveTo(-11, -14, -8.4, -1);
        c.quadraticCurveTo(-6.6, 8, 2.2, 17.5);
        c.stroke();
        c.strokeStyle = '#c9a86e66';
        c.lineWidth = 1.1;
        c.beginPath();
        c.moveTo(1, -20.5);
        c.quadraticCurveTo(-9.4, -13.4, -7, -1);
        c.quadraticCurveTo(-5.2, 7.4, 1.8, 16.4);
        c.stroke();
        // Antler nocks.
        c.fillStyle = '#d8cba5';
        c.beginPath();
        c.arc(1.8, -21.7, 1.5, 0, TAU);
        c.arc(2.2, 17.7, 1.5, 0, TAU);
        c.fill();
        // Grip wrap.
        c.fillStyle = '#241a10';
        c.fillRect(-6.8, -3.4, 4.6, 8.6);
        c.strokeStyle = '#7c6448';
        c.lineWidth = .9;
        for (let i = 0; i < 4; i++) {
          c.beginPath();
          c.moveTo(-6.8, -2 + i * 2);
          c.lineTo(-2.2, -.8 + i * 2);
          c.stroke();
        }
        // String with a slight brace height.
        c.strokeStyle = '#e6ddc2';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(1.8, -21.5);
        c.lineTo(2, -1);
        c.lineTo(2.2, 17.5);
        c.stroke();
        // Nocked arrow.
        c.fillStyle = '#6b5535';
        c.fillRect(1.2, -12, 1.7, 15);
        c.fillStyle = this.steel(c, 1, -18, 3, -12, '#242b31', '#8b98a2', '#dce6ec');
        c.beginPath();
        c.moveTo(1.2, -12.2);
        c.lineTo(2.2, -17.4);
        c.lineTo(3.4, -12.2);
        c.closePath();
        c.fill();
        c.fillStyle = '#b9564a';
        c.beginPath();
        c.moveTo(1.4, 2.4);
        c.lineTo(-1.2, 5.8);
        c.lineTo(1.4, 5);
        c.closePath();
        c.moveTo(3, 2.4);
        c.lineTo(5.6, 5.8);
        c.lineTo(3, 5);
        c.closePath();
        c.fill();
        this.enchant(c, glow, 1.6, -20, 2, 16);
        break;
      }
      default: {
        // Arming sword: tapered blade, fuller, curved guard, wrapped grip.
        const blade = c.createLinearGradient(-3, 0, 3, 0);
        blade.addColorStop(0, '#20272d');
        blade.addColorStop(.32, '#7e8a94');
        blade.addColorStop(.58, '#d3dee5');
        blade.addColorStop(.85, '#828e98');
        blade.addColorStop(1, '#262e35');
        c.fillStyle = blade;
        c.beginPath();
        c.moveTo(-2.8, 1);
        c.lineTo(-3.8, -27.5);
        c.lineTo(0, -36);
        c.lineTo(3.8, -27.5);
        c.lineTo(2.8, 1);
        c.closePath();
        c.fill();
        c.fillStyle = '#2b333a99';
        c.fillRect(-1, -25.5, 2, 25);
        c.strokeStyle = '#f2f8fb';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(-2.8, -.5);
        c.lineTo(-3.6, -27);
        c.lineTo(0, -34.8);
        c.stroke();
        c.strokeStyle = '#5b6771';
        c.lineWidth = .7;
        c.beginPath();
        c.moveTo(2.8, -.5);
        c.lineTo(3.6, -27);
        c.stroke();
        // Cross-guard with warm collar.
        const guard = c.createLinearGradient(-8, 0, 8, 3.4);
        guard.addColorStop(0, '#252c32');
        guard.addColorStop(.5, '#93a0aa');
        guard.addColorStop(1, '#2b333a');
        c.fillStyle = guard;
        c.beginPath();
        c.moveTo(-8, .2);
        c.quadraticCurveTo(-4, -1.4, 0, -.4);
        c.quadraticCurveTo(4, -1.4, 8, .2);
        c.lineTo(7.4, 3);
        c.quadraticCurveTo(0, 5, -7.4, 3);
        c.closePath();
        c.fill();
        c.fillStyle = '#b98d4c';
        c.beginPath();
        c.roundRect(-1.6, -.6, 3.2, 3.6, 1);
        c.fill();
        // Grip wrap and pommel.
        c.fillStyle = '#2a2116';
        c.fillRect(-1.9, 3, 3.8, 9.4);
        c.strokeStyle = '#7c6448';
        c.lineWidth = .85;
        for (let i = 0; i < 4; i++) {
          c.beginPath();
          c.moveTo(-1.9, 4.4 + i * 2);
          c.lineTo(1.9, 5.5 + i * 2);
          c.stroke();
        }
        c.fillStyle = this.steel(c, -2.6, 12, 2.6, 16.5, '#20262c', '#77828b', '#c4d0d8');
        c.beginPath();
        c.arc(0, 14.3, 2.7, 0, TAU);
        c.fill();
        c.fillStyle = '#e7eef3';
        c.beginPath();
        c.arc(-.8, 13.5, .8, 0, TAU);
        c.fill();
        this.enchant(c, glow, 0, -33, 0, -3);
        break;
      }
    }
  }

  /** Elemental accents remain attached to the blade; they never imply a new attack/hitbox. */
  private drawEnchantment(c: CanvasRenderingContext2D, player: Player, time: number) {
    const appearance = weaponAppearance(player);
    const element = appearance.element;
    if (!element) return;
    const clock = this.reducedMotion ? 0 : time;
    const color = ELEMENT_COLORS[element];
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = color;
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 5;
    c.lineWidth = .8;
    const tip = appearance.kind === 'dagger' ? -19 : appearance.kind === 'greatsword' ? -59 : appearance.kind === 'sword' ? -47 : appearance.kind === 'mace' ? -24 : -30;
    if (element === 'fire') {
      for (let i = 0; i < 5; i++) {
        const t = (clock * .7 + i * .2) % 1;
        const y = -4 + (tip + 4) * (i / 5);
        c.globalAlpha = .6 * (1 - t);
        c.beginPath();
        c.moveTo(-1, y + 4);
        c.quadraticCurveTo(-6 - t * 4, y - 2, Math.sin(clock * 3 + i) * 3, y - 8 - t * 6);
        c.quadraticCurveTo(5, y - 3, 1, y + 4);
        c.fill();
      }
    } else if (element === 'cold') {
      c.globalAlpha = .65;
      for (let i = 0; i < 5; i++) {
        const y = -4 + (tip + 4) * i / 5;
        const x = i % 2 ? -2.2 : 2.2;
        c.beginPath();
        c.moveTo(x, y - 3); c.lineTo(x + 2.5, y); c.lineTo(x, y + 2); c.lineTo(x - 1.5, y);
        c.closePath(); c.stroke();
      }
    } else {
      // Continuous low amplitude arc, not a strobing full-screen flash.
      c.globalAlpha = .55;
      c.beginPath(); c.moveTo(0, -3);
      for (let i = 1; i <= 8; i++) c.lineTo(Math.sin(clock * 6 + i * 2.2) * 3.5, -3 + (tip + 3) * i / 8);
      c.stroke();
    }
    c.restore();
  }

  private drawHeldWeapon(c: CanvasRenderingContext2D, actor: Actor, player: boolean, held: string, glow: string | null, time: number) {
    const pose = facingPose(actor.angle);
    const attack = actor.swing > 0 ? swingPose(actor.swing, player ? .22 : .3) : .08;
    const reach = actor.swing > 0 ? 3 : 0;
    const handX = pose.side * (13 + reach);
    const handY = 1 + Math.sin(actor.angle) * 5;
    c.save();
    c.strokeStyle = '#302b24'; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(pose.side * 14, -5); c.lineTo(handX, handY); c.stroke();
    c.translate(handX, handY);
    c.rotate(pose.weaponAngle + attack);
    this.weapon(c, held, glow);
    if (player) this.drawEnchantment(c, actor as Player, time);
    // Gloved fingers close over the grip rather than leaving a floating weapon.
    c.fillStyle = '#473b2a';
    c.beginPath(); c.roundRect(-3, 5, 6, 4, 1.5); c.fill();
    c.strokeStyle = '#a28c6666'; c.lineWidth = .6;
    for (let y = 6; y < 9; y++) { c.beginPath(); c.moveTo(-2, y); c.lineTo(2, y); c.stroke(); }
    c.restore();
  }

  private actor(c: CanvasRenderingContext2D, actor: Actor, player: boolean, self: boolean, kind = '', held = 'sword', glow: string | null = null, time = 0) {
    c.save();
    c.translate(actor.x, actor.y);
    c.scale(ACTOR_SCALE, ACTOR_SCALE);
    if (actor.hp <= 0) {
      // Corpses remain briefly as grounded, identifiable remains instead of vanishing on impact.
      const age = this.lastState.time - (this.defeatedAt.get(actor.id) ?? this.lastState.time);
      c.globalAlpha = Math.max(.25, 1 - Math.max(0, age - 8) / 4);
      c.rotate(.35 + Math.sin(actor.x) * .3);
      c.fillStyle = '#2e0b11a8';
      c.beginPath(); c.ellipse(0, 3, 25, 12, 0, 0, TAU); c.fill();
      if (kind === 'wolf') {
        c.fillStyle = this.steel(c, -20, -5, 10, 7, '#22261f', '#555a4c', '#777967');
        c.beginPath(); c.ellipse(-3, 0, 17, 8, .1, 0, TAU); c.fill();
        c.beginPath(); c.moveTo(10, -5); c.lineTo(22, -1); c.lineTo(17, 6); c.closePath(); c.fill();
      } else {
        const cloth = player ? '#313b25' : kind === 'knight' ? '#252c35' : '#443021';
        c.fillStyle = cloth;
        c.beginPath(); c.moveTo(-22, -6); c.lineTo(-5, -11); c.lineTo(9, -7);
        c.lineTo(18, 3); c.lineTo(5, 8); c.lineTo(1, 5); c.lineTo(-16, 11); c.closePath(); c.fill();
        c.fillStyle = this.steel(c, -12, -8, 6, 6, '#252c31', '#59646b', '#829097');
        c.beginPath(); c.ellipse(-4, -1, 9, 6, .2, 0, TAU); c.fill();
        c.beginPath(); c.ellipse(11, 0, 5, 4, -.2, 0, TAU); c.fill();
        c.strokeStyle = '#b29b665e'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(-18, -2); c.lineTo(2, 5); c.stroke();
        c.save(); c.translate(-3, 13); c.rotate(Math.PI / 2 + .3); c.scale(.65, .65);
        this.weapon(c, held); c.restore();
      }
      c.restore();
      return;
    }
    this.drawActorShadow(c, .55);

    if (self) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      const halo = c.createRadialGradient(0, 0, 2, 0, 0, 32);
      halo.addColorStop(0, '#ffe0a426');
      halo.addColorStop(.55, '#ffcb7a10');
      halo.addColorStop(1, '#ffe0a400');
      c.fillStyle = halo;
      c.fillRect(-32, -32, 64, 64);
      c.restore();
      c.strokeStyle = '#e8d29a80';
      c.lineWidth = 1.3;
      c.beginPath();
      c.ellipse(0, 5, 22, 11, 0, 0, TAU);
      c.stroke();
    }
    if (player && (actor as Player).es > 0) {
      c.save(); c.globalCompositeOperation = 'lighter';
      const pulse = this.reducedMotion ? .2 : .18 + Math.sin(time * 2.2) * .05;
      c.strokeStyle = `rgba(115,194,255,${pulse})`; c.lineWidth = 1.4;
      c.beginPath(); c.ellipse(0, -3, 27, 24, 0, 0, TAU); c.stroke(); c.restore();
    }
    c.save();
    if (kind === 'wolf') c.rotate(actor.angle + Math.PI / 2);
    const f = this.figureSurface();
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, this.figure.width, this.figure.height);
    f.setTransform(3, 0, 0, 3, 288, 288);
    const motion = this.gait.get(actor.id);
    const stride = this.reducedMotion ? 0 : Math.sin(motion?.phase ?? 0) * Math.min(1, (motion?.speed ?? 0) / 100);
    f.save();
    f.translate(0, Math.abs(stride) * -1.2);
    if (player && (actor as Player).dodge > 0 && !this.reducedMotion) {
      f.scale(1.12, .82);
    }
    if (kind === 'wolf') this.wolf(f, actor, this.reducedMotion ? 0 : time, stride);
    else {
      const pose = facingPose(actor.angle);
      // Feet are the world anchor. Body elevation is independent of aim rotation.
      f.translate(0, -14);
      f.scale(pose.width, 1.08);
      this.humanoid(f, actor, player, self, kind, held, glow, this.reducedMotion ? 0 : time, stride);
    }
    f.restore();
    // Fine stable grain across opaque sprite pixels, not over the surrounding map.
    f.globalCompositeOperation = 'source-atop';
    f.globalAlpha = .1;
    f.fillStyle = this.materialGrain!;
    f.fillRect(-96, -96, 192, 192);
    f.globalAlpha = 1;
    f.globalCompositeOperation = 'source-over';
    c.drawImage(this.figure, -96, -96, 192, 192);
    c.restore();
    if (!self) {
      // Hostile plates and health bars read like an action RPG enemy frame, drawn unscaled and crisp.
      const scale = 1 / ACTOR_SCALE;
      c.save();
      c.scale(scale, scale);
      const w = 34;
      c.fillStyle = '#05070ac9';
      const top = kind === 'wolf' ? -48 : -70;
      c.fillRect(-w / 2 - 1, top, w + 2, 6);
      c.fillStyle = '#1d1f22';
      c.fillRect(-w / 2, top + 1, w, 4);
      c.fillStyle = player ? '#c2564c' : '#b8894a';
      c.fillRect(-w / 2, top + 1, w * actor.hp / actor.maxHp, 4);
      c.strokeStyle = '#00000066';
      c.lineWidth = 1;
      c.strokeRect(-w / 2, top + 1, w, 4);
      c.restore();
    }
    if (player && !self) {
      c.font = '10px "Noto Sans JP", sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#e2d3b8';
      c.shadowColor = '#05070a';
      c.shadowBlur = 4;
      c.fillText((actor as Player).name, 0, -59);
      c.shadowBlur = 0;
    }
    c.restore();
  }

  private wolf(c: CanvasRenderingContext2D, actor: Actor, time: number, stride = 0) {
    const elite = (actor as { elite?: boolean }).elite === true;
    const hurt = actor.hurt > 0;
    const lunge = actor.swing > 0 ? Math.min(1, actor.swing / .3) : 0;
    const fur = hurt ? '#c79a88' : elite ? '#4c3a36' : '#6e726a';
    const furDark = hurt ? '#8a6b60' : elite ? '#241b19' : '#424740';
    const furLight = hurt ? '#e8c2ad' : elite ? '#8a625a' : '#9aa094';
    const eye = elite ? '#ff5f3c' : '#ffb14a';
    const tailSway = Math.sin(time * 2.2 + actor.x * .05) * 4;

    // Tail: thick brush with tufts, drifting behind the run.
    c.fillStyle = furDark;
    c.beginPath();
    c.moveTo(0, 18);
    c.quadraticCurveTo(10 + tailSway, 25, 6 + tailSway * 1.4, 35);
    c.quadraticCurveTo(1 + tailSway, 30, -1, 22);
    c.closePath();
    c.fill();
    c.strokeStyle = fur;
    c.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      c.beginPath();
      c.moveTo(1 + i * 1.4 + tailSway * .5, 21 + i * 2.4);
      c.lineTo(5 + i * 1.1 + tailSway, 23 + i * 2.6);
      c.stroke();
    }

    // Hind legs and forelegs with paw definition.
    c.fillStyle = furDark;
    c.beginPath();
    c.ellipse(-8, 9, 4.4, 7.5, .28, 0, TAU);
    c.fill();
    c.beginPath();
    c.ellipse(8, 9, 4.4, 7.5, -.28, 0, TAU);
    c.fill();
    for (const side of [-1, 1]) {
      c.save(); c.translate(0, side * stride * 3.5);
      c.fillStyle = '#2b2e28';
      c.beginPath();
      c.roundRect(side * 9 - 3.2, 13, 6.4, 7.2, 2);
      c.fill();
      c.fillStyle = '#1c1f1a';
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.moveTo(side * 9 - 2 + i * 2, 19);
        c.lineTo(side * 9 - 1 + i * 2, 21.5);
        c.lineTo(side * 9 + i * 2, 19);
        c.closePath();
        c.fill();
      }
      c.restore();
    }

    // Body mass: haunch, barrel and chest, each lit from the top.
    const body = c.createLinearGradient(0, -8, 0, 18);
    body.addColorStop(0, furLight);
    body.addColorStop(.45, fur);
    body.addColorStop(1, furDark);
    c.fillStyle = body;
    c.beginPath();
    c.ellipse(0, 4, 11.5, 19, 0, 0, TAU);
    c.fill();
    c.fillStyle = fur;
    c.beginPath();
    c.ellipse(-1.2, 1, 9, 15, 0, 0, TAU);
    c.fill();
    // Belly shadow and haunch swirl.
    c.fillStyle = `${furDark}cc`;
    c.beginPath();
    c.ellipse(2, 10, 6, 8, .3, 0, TAU);
    c.fill();
    c.strokeStyle = `${furDark}99`;
    c.lineWidth = 1.3;
    c.beginPath();
    c.arc(-7, 4, 5, 3.6, 6.1);
    c.stroke();

    // Fur strokes over the spine, shoulder and flanks.
    c.strokeStyle = `${furLight}66`;
    c.lineWidth = 1.1;
    for (let i = 0; i < 11; i++) {
      const fx = -8 + i * 1.6;
      const fy = -2 + i * 1.9;
      c.beginPath();
      c.moveTo(fx, fy);
      c.lineTo(fx + 3.2, fy + 1.8);
      c.stroke();
    }
    c.strokeStyle = '#1f211d55';
    for (let i = 0; i < 8; i++) {
      c.beginPath();
      c.moveTo(-6 + i * 1.7, 2 + i * 2);
      c.lineTo(-1.5 + i * 1.7, 4 + i * 2);
      c.stroke();
    }

    // Shoulder ruff: layered zigzag fur around the neck.
    c.fillStyle = fur;
    c.beginPath();
    c.moveTo(-11, -8);
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * 1.05 + (i / 8) * Math.PI * .9;
      c.lineTo(Math.cos(a) * (13 + (i % 2) * 2.2), -8 + Math.sin(a) * (11 + (i % 2) * 1.6));
    }
    c.closePath();
    c.fill();
    c.fillStyle = furLight;
    c.beginPath();
    c.ellipse(-2, -11, 10, 8.2, 0, 0, TAU);
    c.fill();

    // Head: skull, muzzle, jaw and fangs. The mouth opens while biting.
    const jaw = lunge * 3.2;
    c.fillStyle = fur;
    c.beginPath();
    c.ellipse(0, -17, 7.8, 9, 0, 0, TAU);
    c.fill();
    c.fillStyle = furDark;
    c.beginPath();
    c.moveTo(-10, -13);
    c.lineTo(-12.5, -27);
    c.lineTo(-5, -21);
    c.lineTo(0, -31.5);
    c.lineTo(5, -21);
    c.lineTo(12.5, -27);
    c.lineTo(10, -13);
    c.closePath();
    c.fill();
    // Inner ears.
    c.fillStyle = '#5c4238';
    c.beginPath();
    c.moveTo(-9, -16);
    c.lineTo(-11, -25);
    c.lineTo(-5.6, -20);
    c.closePath();
    c.moveTo(9, -16);
    c.lineTo(11, -25);
    c.lineTo(5.6, -20);
    c.closePath();
    c.fill();
    // Muzzle bridge and nose.
    const muzzle = c.createLinearGradient(0, -24, 0, -10);
    muzzle.addColorStop(0, furLight);
    muzzle.addColorStop(1, furDark);
    c.fillStyle = muzzle;
    c.beginPath();
    c.ellipse(0, -19 + jaw * .3, 5.2, 6.6, 0, 0, TAU);
    c.fill();
    c.fillStyle = '#22241f';
    c.beginPath();
    c.moveTo(-2.8, -24.4);
    c.quadraticCurveTo(0, -27, 2.8, -24.4);
    c.quadraticCurveTo(0, -22.2, -2.8, -24.4);
    c.closePath();
    c.fill();
    c.fillStyle = '#45423c';
    c.beginPath();
    c.ellipse(-.9, -25.2, .9, .6, 0, 0, TAU);
    c.fill();
    // Jaw and fangs when snarling.
    c.fillStyle = furDark;
    c.beginPath();
    c.ellipse(0, -12.6 + jaw, 4.6, 2.6 + jaw * .35, 0, 0, TAU);
    c.fill();
    if (lunge > .02 || actor.swing > 0) {
      c.fillStyle = '#1a0d0d';
      c.beginPath();
      c.ellipse(0, -13.4 + jaw * .6, 3.4, 1.8 + jaw * .3, 0, 0, TAU);
      c.fill();
      c.fillStyle = '#efe6d4';
      for (const side of [-1, 1]) {
        c.beginPath();
        c.moveTo(side * 1.4, -15.2 + jaw * .5);
        c.lineTo(side * 2.3, -12.4 + jaw * .6);
        c.lineTo(side * 2.9, -15 + jaw * .5);
        c.closePath();
        c.fill();
      }
    }
    // Amber eyes with the predator glow of the reference art.
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const ex of [-3.7, 3.7]) {
      const glow = c.createRadialGradient(ex, -21, .4, ex, -21, 6);
      glow.addColorStop(0, eye);
      glow.addColorStop(.35, `${eye}99`);
      glow.addColorStop(1, `${eye}00`);
      c.fillStyle = glow;
      c.fillRect(ex - 6, -27, 12, 12);
      c.fillStyle = eye;
      c.beginPath();
      c.ellipse(ex, -21, 2, 1.45, 0, 0, TAU);
      c.fill();
    }
    c.restore();

    // Cold rim along the spine, warm brazier bounce under the belly.
    c.strokeStyle = '#b8cfe455';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(-1, -12, 9, 3.4, 5.6);
    c.stroke();
    c.fillStyle = '#ff9d4d20';
    c.beginPath();
    c.ellipse(0, 12, 10, 5, 0, 0, TAU);
    c.fill();
  }

  private humanoid(c: CanvasRenderingContext2D, actor: Actor, player: boolean, self: boolean, kind: string, held = 'sword', glow: string | null = null, time = 0, stride = 0) {
    const pose = facingPose(actor.angle);
    const knight = kind === 'knight';
    const bandit = !player && !knight;
    const loadout = player ? (actor as Player).loadout : undefined;
    const material = knight ? 'chain' : chestMaterial(loadout?.chest);
    const helmet = knight || loadout?.helmet?.base === 'steel_helm';
    const shield = !player || (!!loadout?.offhand && !weaponAppearance(actor as Player).twoHanded && (actor as Player).weapon !== 'bow');
    const elite = !player && (actor as { elite?: boolean }).elite === true;
    const hurt = actor.hurt > 0;
    const sway = Math.sin(time * 1.5 + actor.x * .04) * 1.3;

    // Palettes: the hero reads green-and-brass, allies russet, knights dark steel with gold.
    const clothTop = hurt ? '#d69a80' : self ? '#5d6c47' : player ? '#74423a' : knight ? '#3c4650' : '#61462c';
    const clothDeep = hurt ? '#9a6a5b' : self ? '#2e3723' : player ? '#351e1a' : knight ? '#1b2128' : '#2f2012';
    const leather = self ? '#7a5d38' : player ? '#66462e' : knight ? '#39424b' : '#553c22';
    const plate = hurt ? '#e6bda4' : knight ? '#8b98a2' : self ? '#8d948c' : player ? '#8a8f94' : '#6f7773';
    const plateDeep = knight ? '#333c45' : '#3a4146';
    const trim = elite ? '#f0c164' : knight ? '#c9a24a' : self ? '#b98d4c' : player ? '#a5713c' : '#7d5f36';
    const eyeGlow = elite ? '#ff7a4a' : self ? '#ffd9a0' : player ? '#ffd9a0' : knight ? '#ff6b3c' : '#e8c46a';

    if (pose.back) this.drawHeldWeapon(c, actor, player, held, glow, time);

    // ---- cloak behind the body, with painted folds
    const cloak = c.createLinearGradient(0, -16, 0, 22);
    cloak.addColorStop(0, clothTop);
    cloak.addColorStop(.55, clothDeep);
    cloak.addColorStop(1, '#100e0a');
    c.fillStyle = cloak;
    c.beginPath();
    c.moveTo(-13, -13);
    c.quadraticCurveTo(-19 - sway, 0, -15 - sway * 1.7, 20);
    c.quadraticCurveTo(0, 25, 15 + sway * 1.2, 21);
    c.quadraticCurveTo(19, 0, 13, -13);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(255,232,196,.12)';
    c.lineWidth = 1.5;
    for (const dx of [-9, -3, 4, 10]) {
      c.beginPath();
      c.moveTo(dx, -7);
      c.quadraticCurveTo(dx + sway * .7, 6, dx + sway * 1.5, 19);
      c.stroke();
    }
    c.strokeStyle = 'rgba(0,0,0,.32)';
    for (const dx of [-6, 1, 7]) {
      c.beginPath();
      c.moveTo(dx, -4);
      c.quadraticCurveTo(dx + sway * .8, 8, dx + sway * 1.6, 20);
      c.stroke();
    }

    // ---- articulated gait: left and right feet alternate, even when aiming elsewhere.
    for (const side of [-1, 1]) {
      c.save();
      c.translate(0, side * stride * 3.4);
      c.fillStyle = clothDeep;
      c.beginPath();
      c.roundRect(side * 7 - 4.2, 1, 8.4, 13, 2.4);
      c.fill();
      const greave = c.createLinearGradient(side * 7 - 4, 0, side * 7 + 4, 0);
      greave.addColorStop(0, plateDeep);
      greave.addColorStop(.5, plate);
      greave.addColorStop(1, plateDeep);
      c.fillStyle = greave;
      c.beginPath();
      c.roundRect(side * 7 - 3.8, 5, 7.6, 8.4, 2);
      c.fill();
      c.strokeStyle = 'rgba(240,248,255,.4)';
      c.lineWidth = .8;
      c.beginPath();
      c.moveTo(side * 7 - 2.6, 6.2);
      c.lineTo(side * 7 - 2.6, 12.4);
      c.stroke();
      c.fillStyle = '#1a1712';
      c.beginPath();
      c.roundRect(side * 7 - 4.6, 13.2, 9.2, 6.2, 2.2);
      c.fill();
      c.fillStyle = 'rgba(255,214,160,.14)';
      c.fillRect(side * 7 - 4, 13.8, 8, 1.2);
      c.restore();
    }

    // ---- torso: under-strap, breastplate, belt
    const vest = c.createLinearGradient(0, -13, 0, 10);
    vest.addColorStop(0, leather);
    vest.addColorStop(1, clothDeep);
    c.fillStyle = vest;
    c.beginPath();
    c.moveTo(-13.5, -9);
    c.quadraticCurveTo(0, -15.5, 13.5, -9);
    c.lineTo(15, 12);
    c.quadraticCurveTo(0, 18.5, -14.5, 12);
    c.closePath();
    c.fill();

    const cuirass = c.createLinearGradient(-12, -12, 10, 12);
    cuirass.addColorStop(0, plateDeep);
    cuirass.addColorStop(.34, plate);
    cuirass.addColorStop(.58, '#c9d4db');
    cuirass.addColorStop(.82, plate);
    cuirass.addColorStop(1, plateDeep);
    c.fillStyle = cuirass;
    c.beginPath();
    c.moveTo(-11, -8.5);
    c.quadraticCurveTo(0, -13.5, 11, -8.5);
    c.lineTo(10.6, 8.5);
    c.quadraticCurveTo(0, 13.5, -10.6, 8.5);
    c.closePath();
    c.fill();
    // Worn materials: interlocking chain rings, stitched hide, or ribbed woven cloth.
    c.save();
    c.beginPath();
    c.moveTo(-10, -8); c.lineTo(10, -8); c.lineTo(9, 9); c.lineTo(-9, 9); c.closePath();
    c.clip();
    if (material !== 'chain') {
      const fabric = c.createLinearGradient(-10, -8, 10, 9);
      fabric.addColorStop(0, material === 'cloth' ? '#716273' : '#6c5237');
      fabric.addColorStop(.45, material === 'cloth' ? '#483d55' : '#48331f');
      fabric.addColorStop(1, '#191719');
      c.fillStyle = fabric;
      c.fillRect(-12, -10, 24, 22);
    }
    if (material === 'chain') {
      for (let y = -7; y < 10; y += 2.3) for (let x = -10; x < 11; x += 2.5) {
        const offset = Math.floor((y + 7) / 2.3) % 2 ? 1.2 : 0;
        c.strokeStyle = '#17212ab3'; c.lineWidth = .65;
        c.beginPath(); c.ellipse(x + offset, y, 1.05, .8, -.25, 0, TAU); c.stroke();
        c.strokeStyle = '#e4eef17a'; c.lineWidth = .4;
        c.beginPath(); c.arc(x + offset, y - .2, .8, 3.3, 5.6); c.stroke();
      }
    } else {
      c.strokeStyle = material === 'cloth' ? '#c3b2cc45' : '#c0a0726b';
      c.lineWidth = .55;
      for (let x = -9; x <= 9; x += material === 'cloth' ? 2 : 5) {
        c.beginPath(); c.moveTo(x, -8); c.quadraticCurveTo(x - 2, 0, x + 1, 9); c.stroke();
      }
      if (material === 'leather') for (let y = -6; y < 8; y += 2) {
        c.beginPath(); c.moveTo(-8, y); c.lineTo(-7, y + .7); c.stroke();
      }
    }
    c.restore();
    // Centre ridge and top collar highlight.
    c.strokeStyle = 'rgba(255,255,255,.34)';
    c.lineWidth = 1.3;
    c.beginPath();
    c.moveTo(0, -11.5);
    c.lineTo(0, 11.5);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.2)';
    c.beginPath();
    c.moveTo(-9, -7.2);
    c.quadraticCurveTo(0, -11, 9, -7.2);
    c.stroke();
    // Breastplate fluting.
    c.strokeStyle = 'rgba(20,26,32,.4)';
    c.lineWidth = .9;
    for (const dy of [-3.4, 1.2, 5.8]) {
      c.beginPath();
      c.moveTo(-8.4, dy);
      c.quadraticCurveTo(0, dy + 2.2, 8.4, dy);
      c.stroke();
    }
    // Chest straps with buckles.
    c.strokeStyle = '#2b2114';
    c.lineWidth = 3.2;
    c.beginPath();
    c.moveTo(-10, -8);
    c.lineTo(9, 5.5);
    c.stroke();
    c.strokeStyle = '#6e5530';
    c.lineWidth = 1.1;
    c.beginPath();
    c.moveTo(-10, -8);
    c.lineTo(9, 5.5);
    c.stroke();
    c.fillStyle = trim;
    c.fillRect(-3.2, -2.2, 3.4, 2.6);
    // Belt, buckle and pouches.
    c.fillStyle = '#241b11';
    c.fillRect(-12, 8, 24, 4.2);
    c.fillStyle = trim;
    c.beginPath();
    c.roundRect(-2.6, 8, 5.2, 4.2, 1);
    c.fill();
    c.fillStyle = '#15100a';
    c.fillRect(-1.1, 9.1, 2.2, 2);
    for (const side of [-1, 1]) {
      c.fillStyle = leather;
      c.beginPath();
      c.roundRect(side * 8 - 3, 11.4, 6, 5.2, 1.4);
      c.fill();
      c.strokeStyle = 'rgba(255,222,180,.22)';
      c.lineWidth = .8;
      c.stroke();
    }
    // Form shading across the whole torso so the figure sits in the firelight.
    c.save();
    c.globalCompositeOperation = 'source-atop';
    const formShade = c.createLinearGradient(0, -13, 0, 20);
    formShade.addColorStop(0, 'rgba(255,240,220,.14)');
    formShade.addColorStop(.55, 'rgba(0,0,0,0)');
    formShade.addColorStop(1, 'rgba(0,0,0,.4)');
    c.fillStyle = formShade;
    c.fillRect(-20, -18, 40, 42);
    c.restore();

    // ---- pauldrons: layered lames with rivets and rims
    for (const side of [-1, 1]) {
      const pauldron = c.createLinearGradient(side * 10, -14, side * 20, -2);
      pauldron.addColorStop(0, plateDeep);
      pauldron.addColorStop(.5, plate);
      pauldron.addColorStop(1, plateDeep);
      c.fillStyle = pauldron;
      c.beginPath();
      c.moveTo(side * 8.5, -11);
      c.quadraticCurveTo(side * 21, -12.5, side * 19.5, -1);
      c.quadraticCurveTo(side * 16, 3, side * 10.5, 1);
      c.closePath();
      c.fill();
      c.fillStyle = plateDeep;
      c.beginPath();
      c.moveTo(side * 11, -6.5);
      c.quadraticCurveTo(side * 19.5, -7, side * 18.2, .6);
      c.quadraticCurveTo(side * 15.5, 2.6, side * 11.8, 1.4);
      c.closePath();
      c.fill();
      c.strokeStyle = trim;
      c.lineWidth = 1.15;
      c.beginPath();
      c.moveTo(side * 8.5, -11);
      c.quadraticCurveTo(side * 21, -12.5, side * 19.5, -1);
      c.stroke();
      c.fillStyle = '#dce6ec';
      for (const [rx, ry] of [[side * 12.5, -9], [side * 17.5, -6.2]]) {
        c.beginPath();
        c.arc(rx, ry, 1, 0, TAU);
        c.fill();
      }
    }

    // ---- arms and bracers
    for (const side of [-1, 1]) {
      c.fillStyle = clothDeep;
      c.beginPath();
      c.ellipse(side * 14, 3.5, 4.6, 8.5, side * -.16, 0, TAU);
      c.fill();
      const bracer = c.createLinearGradient(side * 12, 0, side * 18, 0);
      bracer.addColorStop(0, plateDeep);
      bracer.addColorStop(.5, plate);
      bracer.addColorStop(1, plateDeep);
      c.fillStyle = bracer;
      c.beginPath();
      c.roundRect(side * 15.9 - 3.5, 5, 7, 7.4, 2);
      c.fill();
      c.strokeStyle = trim;
      c.lineWidth = .9;
      c.beginPath();
      c.moveTo(side * 12.8, 8);
      c.lineTo(side * 19.2, 8);
      c.moveTo(side * 12.8, 11);
      c.lineTo(side * 19.2, 11);
      c.stroke();
    }

    if (pose.back) {
      // Rear cloak, central seam and shoulder harness replace the front breastplate.
      const backCloth = c.createLinearGradient(-10, -8, 12, 17);
      backCloth.addColorStop(0, clothTop); backCloth.addColorStop(.48, clothDeep); backCloth.addColorStop(1, '#141312');
      c.fillStyle = backCloth;
      c.beginPath(); c.moveTo(-11, -10); c.quadraticCurveTo(0, -14, 11, -10);
      c.lineTo(13, 16); c.quadraticCurveTo(0, 20, -13, 16); c.closePath(); c.fill();
      c.strokeStyle = '#d8c7a026'; c.lineWidth = 1;
      for (const x of [-8, -3, 4, 9]) {
        c.beginPath(); c.moveTo(x, -8); c.quadraticCurveTo(x - 2, 4, x + sway, 15); c.stroke();
      }
      c.strokeStyle = '#251a11'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(-9, -10); c.lineTo(8, 10); c.stroke();
    }

    c.save();
    c.translate(pose.headX, 0);
    // ---- head: helmet follows worn gear rather than always showing a hood.
    if (helmet) {
      // Neck guard.
      c.fillStyle = plateDeep;
      c.beginPath();
      c.roundRect(-7.5, -13.5, 15, 5.5, 2);
      c.fill();
      // Great helm.
      const helm = c.createLinearGradient(-8, -26, 8, -10);
      helm.addColorStop(0, '#2c343c');
      helm.addColorStop(.45, '#8b98a2');
      helm.addColorStop(.8, '#4a545c');
      helm.addColorStop(1, '#242b31');
      c.fillStyle = helm;
      c.beginPath();
      c.moveTo(-8.2, -13);
      c.quadraticCurveTo(-9.6, -24, 0, -27);
      c.quadraticCurveTo(9.6, -24, 8.2, -13);
      c.quadraticCurveTo(0, -9.5, -8.2, -13);
      c.closePath();
      c.fill();
      // Brow ridge and visor slit.
      c.fillStyle = '#141a20';
      c.fillRect(-7.4, -18.6, 14.8, 3.8);
      c.strokeStyle = '#b9c5cd';
      c.lineWidth = 1.15;
      c.beginPath();
      c.moveTo(-7.8, -19.6);
      c.quadraticCurveTo(0, -22.4, 7.8, -19.6);
      c.stroke();
      // Slit glow.
      c.save();
      c.globalCompositeOperation = 'lighter';
      const slit = c.createLinearGradient(-7, 0, 7, 0);
      slit.addColorStop(0, `${eyeGlow}00`);
      slit.addColorStop(.22, eyeGlow);
      slit.addColorStop(.78, eyeGlow);
      slit.addColorStop(1, `${eyeGlow}00`);
      c.fillStyle = slit;
      c.shadowColor = eyeGlow;
      c.shadowBlur = 8;
      c.fillRect(-6.6, -18, 13.2, 2.5);
      c.restore();
      // Crest ridge and plume.
      c.fillStyle = trim;
      c.beginPath();
      c.moveTo(-1.2, -27);
      c.quadraticCurveTo(0, -29.2, 1.2, -27);
      c.lineTo(.9, -20);
      c.lineTo(-.9, -20);
      c.closePath();
      c.fill();
      const plume = c.createLinearGradient(0, -31, 0, -18);
      plume.addColorStop(0, elite ? '#e8b04c' : '#a83232');
      plume.addColorStop(1, '#4c1414');
      c.fillStyle = plume;
      c.beginPath();
      c.moveTo(0, -28.2);
      c.quadraticCurveTo(6 + sway, -33, 13.5 + sway * 1.6, -30.5);
      c.quadraticCurveTo(8 + sway, -26.5, 3.5, -26);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(0, -27.4);
      c.quadraticCurveTo(5 + sway * .8, -30, 10.5 + sway * 1.3, -27.6);
      c.quadraticCurveTo(6 + sway, -25, 2.8, -24.6);
      c.closePath();
      c.fill();
    } else {
      // Hooded head with a face lost in shadow and two burning eyes.
      c.fillStyle = clothDeep;
      c.beginPath();
      c.moveTo(-10.4, -9);
      c.quadraticCurveTo(-11.5, -25, 1.2, -26.5);
      c.quadraticCurveTo(11.5, -24.5, 10.2, -9);
      c.quadraticCurveTo(4, -6, 0, -6.5);
      c.quadraticCurveTo(-5, -6.4, -10.4, -9);
      c.closePath();
      c.fill();
      const hood = c.createLinearGradient(-8, -24, 8, -8);
      hood.addColorStop(0, clothTop);
      hood.addColorStop(.6, clothDeep);
      hood.addColorStop(1, '#120e09');
      c.fillStyle = hood;
      c.beginPath();
      c.moveTo(-8.6, -11);
      c.quadraticCurveTo(-9, -23.5, .6, -24.8);
      c.quadraticCurveTo(9.2, -23, 8.6, -11);
      c.quadraticCurveTo(0, -8, -8.6, -11);
      c.closePath();
      c.fill();
      // Face void.
      c.fillStyle = '#0b0906';
      c.beginPath();
      c.ellipse(0, -14.2, 6.6, 5.2, 0, 0, TAU);
      c.fill();
      if (bandit) {
        // Rag mask across the mouth.
        c.fillStyle = '#3c2a1e';
        c.beginPath();
        c.ellipse(0, -10.6, 6.4, 3.2, 0, 0, TAU);
        c.fill();
        c.strokeStyle = '#573d29';
        c.lineWidth = .8;
        c.beginPath();
        c.moveTo(-5.6, -11.4);
        c.quadraticCurveTo(0, -9.4, 5.6, -11.4);
        c.stroke();
      }
      // Eye glow.
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const ex of [-2.6, 2.6]) {
        const glowEye = c.createRadialGradient(ex, -15, .3, ex, -15, 5.4);
        glowEye.addColorStop(0, eyeGlow);
        glowEye.addColorStop(.32, `${eyeGlow}88`);
        glowEye.addColorStop(1, `${eyeGlow}00`);
        c.fillStyle = glowEye;
        c.fillRect(ex - 5.4, -20.4, 10.8, 10.8);
        c.fillStyle = eyeGlow;
        c.beginPath();
        c.ellipse(ex, -15, 1.35, .95, 0, 0, TAU);
        c.fill();
      }
      c.restore();
      // Hood peak shadow.
      c.strokeStyle = 'rgba(255,232,200,.16)';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(-8, -17.5);
      c.quadraticCurveTo(0, -23.5, 8.2, -17.2);
      c.stroke();
    }

    if (pose.back) {
      c.fillStyle = helmet ? this.steel(c, -8, -25, 8, -10, '#242b32', plate, '#b8c6cf') : clothDeep;
      c.beginPath(); c.moveTo(-8, -12); c.quadraticCurveTo(-10, -25, 0, -26);
      c.quadraticCurveTo(10, -25, 8, -12); c.quadraticCurveTo(0, -9, -8, -12); c.fill();
      c.strokeStyle = helmet ? '#e2edf07a' : '#b9ac8555'; c.lineWidth = .8;
      c.beginPath(); c.moveTo(0, -24); c.lineTo(0, -12); c.stroke();
    }
    c.restore();

    // ---- off-hand shield: do not display equipment the traveller does not wear.
    if (shield) {
    c.save();
    c.translate(-pose.side * 17, -1);
    c.rotate(-.12);
    if (knight) {
      // Kite shield.
      const face = c.createLinearGradient(-8, -12, 8, 14);
      face.addColorStop(0, '#3b444c');
      face.addColorStop(.45, '#232b32');
      face.addColorStop(1, '#141a20');
      c.fillStyle = face;
      c.beginPath();
      c.moveTo(0, -13.5);
      c.quadraticCurveTo(9, -12, 8.6, -2);
      c.quadraticCurveTo(7, 8, 0, 15.5);
      c.quadraticCurveTo(-7, 8, -8.6, -2);
      c.quadraticCurveTo(-9, -12, 0, -13.5);
      c.closePath();
      c.fill();
      c.strokeStyle = trim;
      c.lineWidth = 1.5;
      c.stroke();
      c.fillStyle = trim;
      c.fillRect(-1.4, -10, 2.8, 20);
      c.fillRect(-6, -2.6, 12, 2.8);
      c.fillStyle = '#c9a24a55';
      c.beginPath();
      c.arc(0, -2, 3.4, 0, TAU);
      c.fill();
    } else {
      // Round shield: planks, iron rim and a boss.
      const face = c.createRadialGradient(-3, -5, 2, 0, 0, 12);
      face.addColorStop(0, self ? '#87704c' : player ? '#8a6547' : '#7a6244');
      face.addColorStop(1, '#2c2114');
      c.fillStyle = face;
      c.beginPath();
      c.arc(0, 0, 11, 0, TAU);
      c.fill();
      c.strokeStyle = '#1c140c';
      c.lineWidth = 1;
      for (const dx of [-5.4, 0, 5.4]) {
        c.beginPath();
        c.moveTo(dx, -10.2);
        c.lineTo(dx, 10.2);
        c.stroke();
      }
      c.strokeStyle = plate;
      c.lineWidth = 2.4;
      c.beginPath();
      c.arc(0, 0, 10.4, 0, TAU);
      c.stroke();
      c.fillStyle = plateDeep;
      c.beginPath();
      c.arc(0, 0, 4, 0, TAU);
      c.fill();
      c.fillStyle = plate;
      c.beginPath();
      c.arc(-1, -1.2, 1.7, 0, TAU);
      c.fill();
    }
    c.restore();

    }

    // Weapons aim independently from the upright torso and disappear behind it when facing away.
    if (!pose.back) this.drawHeldWeapon(c, actor, player, held, glow, time);

    // ---- light: cold rim from the sky, warm bounce from the braziers
    c.strokeStyle = '#cfe4f5a8';
    c.lineWidth = 1.8;
    c.beginPath();
    c.moveTo(-12, -9);
    c.quadraticCurveTo(0, -18, 12, -9);
    c.stroke();
    c.strokeStyle = '#ffb0664d';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(-13, 6);
    c.quadraticCurveTo(-15, 13, -11, 17);
    c.moveTo(13, 6);
    c.quadraticCurveTo(15, 13, 11, 17);
    c.stroke();
    c.fillStyle = '#ffb0661c';
    c.beginPath();
    c.ellipse(0, 15, 13, 7.5, 0, 0, TAU);
    c.fill();

    // Enchanted gear sheds motes of light, like the glowing weapons of the reference art.
    if (glow) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const pulse = (Math.sin(time * 2.6 + i * 2.1 + actor.x) + 1) / 2;
        const sx = 14 + Math.sin(time * 1.4 + i * 1.7) * 5;
        const sy = -8 - i * 7 - pulse * 6;
        c.fillStyle = glow;
        c.globalAlpha = .16 + pulse * .3;
        c.beginPath();
        c.arc(sx, sy, .9 + pulse, 0, TAU);
        c.fill();
      }
      c.restore();
    }

    // A hurt body flashes pale along the silhouette so damage stays readable mid-fight.
    if (hurt) {
      c.strokeStyle = '#ffd3bb66';
      c.lineWidth = 2.2;
      c.beginPath();
      c.ellipse(0, -2, 17, 20, 0, 0, TAU);
      c.stroke();
    }
  }

  // ---------------------------------------------------------------- hud

  private minimap(c: CanvasRenderingContext2D, state: GameState, p: Player, x: number, y: number) {
    c.save();
    c.fillStyle = '#05070af2';
    c.fillRect(x - 8, y - 8, 152, 120);
    c.strokeStyle = '#c2a4687a';
    c.lineWidth = 1;
    c.strokeRect(x - 7, y - 7, 150, 118);
    c.strokeStyle = '#c2a4682e';
    c.strokeRect(x - 5, y - 5, 146, 114);
    c.globalAlpha = .78;
    c.drawImage(this.minimapTerrain, x, y, MINIMAP_W, MINIMAP_H);
    c.globalAlpha = 1;
    for (const exit of EXITS) {
      c.fillStyle = '#a9ffe0';
      c.shadowColor = '#57d8a6';
      c.shadowBlur = 5;
      c.fillRect(x + exit.x / WORLD.width * MINIMAP_W - 2, y + exit.y / WORLD.height * MINIMAP_H - 2, 4, 4);
    }
    c.shadowBlur = 0;
    // Living hostiles are deliberately visible on the tactical view.
    c.fillStyle = '#e0534c';
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0) continue;
      c.fillRect(x + enemy.x / WORLD.width * MINIMAP_W - 1.5, y + enemy.y / WORLD.height * MINIMAP_H - 1.5, 3, 3);
    }
    for (const loot of state.loot) {
      if (loot.opened) continue;
      const rarity = this.lootRarity(loot.items);
      c.fillStyle = rarity.color;
      c.fillRect(x + loot.x / WORLD.width * MINIMAP_W - 1.5, y + loot.y / WORLD.height * MINIMAP_H - 1.5, 3, 3);
    }
    for (const other of state.players) {
      if (other.id === p.id || other.status !== 'alive') continue;
      c.fillStyle = '#e8b06a';
      c.fillRect(x + other.x / WORLD.width * MINIMAP_W - 1.5, y + other.y / WORLD.height * MINIMAP_H - 1.5, 3, 3);
    }
    c.fillStyle = '#ffe1a3';
    c.shadowColor = '#ffc46a';
    c.shadowBlur = 6;
    c.beginPath();
    c.arc(x + p.x / WORLD.width * MINIMAP_W, y + p.y / WORLD.height * MINIMAP_H, 3, 0, TAU);
    c.fill();
    c.shadowBlur = 0;
    c.fillStyle = '#c2a468';
    c.font = '9px "Noto Sans JP", sans-serif';
    c.fillText('M  戦域図', x, y - 14);
    c.restore();
  }

}
