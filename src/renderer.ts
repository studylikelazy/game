import { BUILDINGS, EXITS, WORLD, seeded, type Actor, type GameState, type Player } from './game';

const TAU = Math.PI * 2;
export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  terrain: HTMLCanvasElement;
  camera = { x: 1040, y: 930, zoom: .69 };
  width = 0; height = 0; dpr = 1;
  private trees: { x: number; y: number; size: number; pine: boolean; tint: number }[] = [];
  private observer: ResizeObserver;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d')!;
    this.terrain = document.createElement('canvas'); this.terrain.width = WORLD.width; this.terrain.height = WORLD.height;
    this.buildTerrain();
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas); this.resize();
  }
  resize() { const r = this.canvas.getBoundingClientRect(); this.width = r.width; this.height = r.height; this.dpr = Math.min(devicePixelRatio, 2); this.canvas.width = r.width * this.dpr; this.canvas.height = r.height * this.dpr; }
  screenToWorld(x: number, y: number) { return { x: (x - this.width / 2) / this.camera.zoom + this.camera.x, y: (y - this.height / 2) / this.camera.zoom + this.camera.y }; }
  private buildTerrain() {
    const c = this.terrain.getContext('2d')!, r = seeded(1947);
    c.fillStyle = '#485046'; c.fillRect(0, 0, WORLD.width, WORLD.height);
    for (let i = 0; i < 1900; i++) {
      const x = r() * 2400, y = r() * 1800, size = 10 + r() * 80;
      c.fillStyle = ['#56604719', '#242e261a', '#68705b14', '#8e886514'][i % 4]; c.beginPath(); c.ellipse(x, y, size * 1.7, size, r() * TAU, 0, TAU); c.fill();
    }
    // Old river, all crossings remain traversable for an approachable first raid.
    c.beginPath(); c.moveTo(2070, -50); c.bezierCurveTo(1850, 480, 2380, 740, 2070, 1100); c.bezierCurveTo(1870, 1380, 2020, 1590, 2280, 1900);
    c.strokeStyle = '#303e39'; c.lineWidth = 145; c.stroke(); c.strokeStyle = '#536158'; c.lineWidth = 122; c.stroke(); c.strokeStyle = '#344e4d'; c.lineWidth = 103; c.stroke();
    c.strokeStyle = '#a9b3a212'; c.lineWidth = 1;
    for (let i = 0; i < 700; i++) { const x = 1930 + r() * 350, y = r() * 1800; c.beginPath(); c.moveTo(x, y); c.lineTo(x + r() * 24 + 5, y - 3); c.stroke(); }
    const road = (points: number[][], width: number) => { c.beginPath(); c.moveTo(points[0][0], points[0][1]); for (let i = 1; i < points.length; i++) c.lineTo(points[i][0], points[i][1]); c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = '#343c3266'; c.lineWidth = width + 19; c.stroke(); c.strokeStyle = '#77725a'; c.lineWidth = width; c.stroke(); c.strokeStyle = '#8b806028'; c.lineWidth = width - 14; c.stroke(); };
    road([[230, 1500], [520, 1320], [710, 1170], [865, 930], [871, 690], [900, 470], [1220, 390], [1450, 525], [1680, 510], [1840, 250]], 74);
    road([[430, 750], [850, 708], [1160, 700], [1360, 890], [1570, 990], [1860, 1180], [2150, 1450]], 63);
    road([[880, 955], [1140, 1090], [1250, 1350], [1620, 1440]], 42);
    // Footprints, stones and moss make the map read as an illustrated environment.
    for (let i = 0; i < 11500; i++) {
      const x = r() * 2400, y = r() * 1800;
      c.fillStyle = ['#b1ad892b', '#192a292b', '#a8ac761e', '#313b3099'][i % 4]; c.fillRect(x, y, 1 + r() * 3, 1 + r() * 2);
    }
    // Village courtyard.
    c.fillStyle = '#817d6740'; c.fillRect(798, 580, 162, 336);
    for (let y = 583; y < 916; y += 14) for (let x = 800; x < 955; x += 22) { c.fillStyle = r() > .5 ? '#9e998127' : '#3d443549'; c.fillRect(x + (y % 28 ? 8 : 0), y, 18, 10); }
    // Broken perimeter wall.
    const wall = (x: number, y: number, w: number, h: number) => { c.fillStyle = '#1d29296b'; c.fillRect(x + 9, y + 13, w, h); c.fillStyle = '#727769'; c.fillRect(x, y, w, h); c.fillStyle = '#a1a18a'; c.fillRect(x, y, w, 3); c.strokeStyle = '#343e36'; c.lineWidth = 1; for (let a = 0; a < w; a += 19) { c.strokeRect(x + a, y, Math.min(19, w - a), h); } };
    wall(600, 432, 211, 14); wall(868, 432, 220, 14); wall(585, 443, 15, 140); wall(585, 810, 15, 190); wall(598, 986, 183, 15); wall(1000, 986, 235, 15); wall(1219, 840, 15, 146);
    for (let i = 0; i < 45; i++) { const x = 560 + r() * 690, y = 977 + r() * 50; c.fillStyle = '#757765'; c.fillRect(x, y, r() * 9 + 3, r() * 6 + 3); }
    // Roofs are drawn into terrain so actors correctly collide with their footprint.
    for (const b of BUILDINGS) {
      c.fillStyle = '#15231e80'; c.fillRect(b.x + 18, b.y + 23, b.w + 7, b.h + 7);
      c.fillStyle = '#a29574'; c.fillRect(b.x - 3, b.y + 7, b.w + 6, b.h + 9);
      c.fillStyle = '#282d24'; c.fillRect(b.x + b.w * .4, b.y + b.h, 27, 16);
      c.fillStyle = b.roof === 'red' ? '#765846' : '#596365'; c.fillRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16);
      c.fillStyle = b.roof === 'red' ? '#9a7456' : '#748180'; c.beginPath(); c.moveTo(b.x - 8, b.y - 8); c.lineTo(b.x + b.w / 2, b.y + 7); c.lineTo(b.x + b.w / 2, b.y + b.h - 6); c.lineTo(b.x - 8, b.y + b.h + 8); c.closePath(); c.fill();
      c.strokeStyle = '#272f2d55'; c.lineWidth = 2;
      for (let y = b.y - 5; y < b.y + b.h + 7; y += 10) { c.beginPath(); c.moveTo(b.x - 7, y); c.lineTo(b.x + b.w / 2, y + 8); c.lineTo(b.x + b.w + 7, y); c.stroke(); }
      c.strokeStyle = '#c1ad7e55'; c.lineWidth = 3; c.beginPath(); c.moveTo(b.x + b.w / 2, b.y - 8); c.lineTo(b.x + b.w / 2, b.y + b.h + 8); c.stroke();
      c.fillStyle = '#3b4039'; c.fillRect(b.x + b.w - 30, b.y + 17, 16, 25); c.fillStyle = '#9b9d86'; c.fillRect(b.x + b.w - 32, b.y + 14, 20, 9); c.fillStyle = '#292d28'; c.fillRect(b.x + b.w - 29, b.y + 16, 14, 4);
      c.fillStyle = '#b8a078'; c.fillRect(b.x + b.w * .4 - 4, b.y + b.h + 14, 36, 5);
    }
    // Well.
    c.fillStyle = '#15211c66'; c.beginPath(); c.ellipse(891, 755, 32, 23, 0, 0, TAU); c.fill();
    c.fillStyle = '#969582'; c.beginPath(); c.arc(882, 744, 24, 0, TAU); c.fill(); c.fillStyle = '#263b3a'; c.beginPath(); c.arc(882, 744, 16, 0, TAU); c.fill();
    c.fillStyle = '#4e3e2d'; c.fillRect(854, 734, 5, 22); c.fillRect(905, 734, 5, 22); c.fillStyle = '#9b8058'; c.fillRect(852, 732, 60, 7);
    // Supply cart and camp tents.
    for (const [x, y] of [[1160, 960], [480, 1220], [1660, 610]]) {
      c.fillStyle = '#19281e66'; c.beginPath(); c.ellipse(x + 15, y + 20, 55, 28, .3, 0, TAU); c.fill();
      c.fillStyle = '#a79d79'; c.beginPath(); c.moveTo(x, y - 30); c.lineTo(x - 40, y + 30); c.lineTo(x + 42, y + 24); c.closePath(); c.fill(); c.fillStyle = '#726e51'; c.beginPath(); c.moveTo(x, y - 30); c.lineTo(x + 42, y + 24); c.lineTo(x + 18, y + 33); c.closePath(); c.fill(); c.fillStyle = '#3a3b2c'; c.beginPath(); c.moveTo(x, y - 15); c.lineTo(x - 12, y + 30); c.lineTo(x + 10, y + 28); c.closePath(); c.fill();
    }
    for (let i = 0; i < 80; i++) {
      const x = 620 + r() * 620, y = 430 + r() * 560;
      if (BUILDINGS.some(b => x > b.x - 15 && x < b.x + b.w + 15 && y > b.y - 15 && y < b.y + b.h + 25)) continue;
      if (i % 3 === 0) { c.fillStyle = '#554e3b'; c.fillRect(x, y, 14, 13); c.strokeStyle = '#a09267'; c.lineWidth = 1; c.strokeRect(x, y, 14, 13); c.beginPath(); c.moveTo(x, y); c.lineTo(x + 14, y + 13); c.stroke(); }
      else { c.fillStyle = '#3d4538'; c.beginPath(); c.ellipse(x, y, 4 + r() * 5, 3 + r() * 3, .2, 0, TAU); c.fill(); }
    }
    const nearRoad = (x: number, y: number) => (Math.abs(x - (900 - (y - 700) * .56)) < 110 && y > 430) || (Math.abs(y - (700 + Math.max(0, x - 1160) * .68)) < 85 && x > 410) || (y < 570 && x > 1200 && x < 1840);
    for (let i = 0; i < 660; i++) {
      const x = r() * 2400, y = r() * 1800;
      if (x > 1960 || nearRoad(x, y) || (x > 540 && x < 1270 && y > 380 && y < 1050) || BUILDINGS.some(b => x > b.x - 70 && x < b.x + b.w + 70 && y > b.y - 70 && y < b.y + b.h + 80) || EXITS.some(e => Math.hypot(e.x - x, e.y - y) < 100)) continue;
      this.trees.push({ x, y, size: 24 + r() * 30, pine: r() > .66, tint: r() });
    }
    this.trees.sort((a, b) => a.y - b.y);
    for (const t of this.trees) this.tree(c, t.x, t.y, t.size, t.pine, t.tint);
  }
  private tree(c: CanvasRenderingContext2D, x: number, y: number, s: number, pine: boolean, tint: number) {
    c.fillStyle = '#14201d50'; c.beginPath(); c.ellipse(x + 18, y + 18, s * .9, s * .5, .6, 0, TAU); c.fill();
    c.fillStyle = '#584b35'; c.fillRect(x - 3, y - 10, 6, 30);
    if (pine) {
      const colors = ['#293f37', '#344d40', '#3f5948'];
      for (let i = 0; i < 3; i++) { c.fillStyle = colors[i]; c.beginPath(); c.moveTo(x, y - s * 1.5 + i * s * .18); c.lineTo(x - s * (.8 - i * .2), y + s * (.35 - i * .3)); c.lineTo(x + s * (.7 - i * .2), y + s * (.35 - i * .3)); c.closePath(); c.fill(); }
      c.strokeStyle = '#8b9a6828'; c.beginPath(); c.moveTo(x - 2, y - s * 1.4); c.lineTo(x - s * .58, y + s * .07); c.stroke();
    } else {
      const palette = tint > .84 ? ['#665a38', '#837046', '#aa8e51'] : tint > .5 ? ['#3a4c37', '#526344', '#6d7a4f'] : ['#2b453b', '#40584a', '#61715a'];
      c.fillStyle = palette[0]; c.beginPath();
      for (let i = 0; i < 13; i++) { const angle = i / 13 * TAU, rad = s * (.8 + Math.sin(i * 8 + tint * 10) * .17); const px = x + Math.cos(angle) * rad, py = y - 14 + Math.sin(angle) * rad * .8; i === 0 ? c.moveTo(px, py) : c.lineTo(px, py); } c.closePath(); c.fill();
      for (let j = 0; j < 6; j++) { const a = j * 2.4; c.fillStyle = palette[j % 2 + 1]; c.beginPath(); c.ellipse(x + Math.cos(a) * s * .36 - 4, y - 21 + Math.sin(a) * s * .3, s * .47, s * .37, a, 0, TAU); c.fill(); }
      c.fillStyle = '#b5b58118'; c.beginPath(); c.ellipse(x - 10, y - s * .45, s * .42, s * .23, -.6, 0, TAU); c.fill();
    }
  }
  draw(state: GameState, playerId: string, lobby: boolean, fullMap: boolean, time: number) {
    const c = this.ctx, w = this.width, h = this.height; if (!w || !h) return;
    const p = state.players.find(p => p.id === playerId);
    if (lobby) { this.camera.x = 1050; this.camera.y = 895; this.camera.zoom = Math.max(w / 1800, h / 1360); }
    else if (fullMap) { this.camera.x = 1200; this.camera.y = 900; this.camera.zoom = Math.min(w / 2460, h / 1860); }
    else if (p) { this.camera.x += (p.x - this.camera.x) * .13; this.camera.y += (p.y - this.camera.y) * .13; this.camera.zoom += (1.16 - this.camera.zoom) * .1; }
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.fillStyle = '#212a24'; c.fillRect(0, 0, w, h);
    c.save(); c.translate(w / 2, h / 2); c.scale(this.camera.zoom, this.camera.zoom); c.translate(-this.camera.x, -this.camera.y);
    c.drawImage(this.terrain, 0, 0);
    // Soft firelight.
    for (const [x, y] of [[811, 1046], [1270, 780], [1570, 660]]) {
      const glow = c.createRadialGradient(x, y, 1, x, y, 83 + Math.sin(time * 5) * 4); glow.addColorStop(0, '#ffb64a50'); glow.addColorStop(.3, '#edab3720'); glow.addColorStop(1, '#edab3700'); c.fillStyle = glow; c.fillRect(x - 100, y - 100, 200, 200);
      c.fillStyle = '#342d20'; c.beginPath(); c.ellipse(x, y, 13, 10, 0, 0, TAU); c.fill(); c.fillStyle = '#e5a457'; c.beginPath(); c.moveTo(x - 6, y + 3); c.quadraticCurveTo(x - 8, y - 7, x + Math.sin(time * 4) * 3, y - 17); c.quadraticCurveTo(x + 9, y - 5, x + 6, y + 3); c.fill();
    }
    for (const l of state.loot) {
      if (l.opened) continue;
      c.save(); c.translate(l.x, l.y);
      c.fillStyle = '#15201c80'; c.beginPath(); c.ellipse(4, 8, 20, 10, 0, 0, TAU); c.fill();
      if (l.kind === 'herb') { for (let i = 0; i < 5; i++) { c.fillStyle = i % 2 ? '#a7b583' : '#6a935f'; c.beginPath(); c.ellipse(Math.cos(i * 2.4) * 8, Math.sin(i * 2.4) * 8, 4, 10, i * 2.4, 0, TAU); c.fill(); } }
      else if (l.kind === 'body') { c.fillStyle = '#785e43'; c.beginPath(); c.ellipse(0, 0, 13, 10, .4, 0, TAU); c.fill(); c.strokeStyle = '#b4a479'; c.stroke(); }
      else { c.fillStyle = '#725039'; c.fillRect(-15, -10, 30, 22); c.fillStyle = '#a18050'; c.fillRect(-15, -11, 30, 7); c.fillStyle = '#bbaa73'; c.fillRect(-10, -11, 3, 23); c.fillRect(8, -11, 3, 23); c.fillStyle = '#c8b580'; c.fillRect(-3, -2, 6, 5); }
      if (!lobby) { c.strokeStyle = '#d5b87c80'; c.lineWidth = 1.3; c.beginPath(); c.arc(0, 0, 23 + Math.sin(time * 3) * 2, 0, TAU); c.stroke(); }
      c.restore();
    }
    for (const e of EXITS) {
      c.save(); c.translate(e.x, e.y); c.strokeStyle = '#a1b58b99'; c.fillStyle = '#a1b58b0b'; c.lineWidth = 1.5; c.setLineDash([8, 8]); c.beginPath(); c.arc(0, 0, 62, 0, TAU); c.stroke(); c.fill(); c.setLineDash([]);
      c.strokeStyle = '#bed4a3'; c.lineWidth = 2.5; c.strokeRect(-12, -14, 18, 25); c.beginPath(); c.moveTo(-3, 0); c.lineTo(20, 0); c.moveTo(13, -7); c.lineTo(20, 0); c.lineTo(13, 7); c.stroke();
      c.font = '12px "Noto Sans JP", sans-serif'; c.textAlign = 'center'; c.fillStyle = '#d9e2bd'; c.fillText(e.name, 0, 87); c.restore();
    }
    for (const e of state.enemies) if (e.hp > 0 && !lobby) this.actor(c, e, false, false, e.kind);
    for (const a of state.arrows) { c.strokeStyle = '#e9d6ac'; c.lineWidth = 2; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(a.x - a.vx * .026, a.y - a.vy * .026); c.stroke(); }
    for (const pl of state.players) if (pl.status !== 'extracted' && !lobby) this.actor(c, pl, true, pl.id === playerId);
    if (lobby) {
      this.mapLabel(c, 903, 655, '01', '灰の集落', true);
      this.mapLabel(c, 1485, 300, '02', '忘れられた修道院', false);
      this.mapLabel(c, 1580, 1180, '03', '野盗の野営地', false);
      c.save(); c.translate(460, 1310); c.rotate(Math.PI / 4); c.fillStyle = '#d5b185'; c.fillRect(-6, -6, 12, 12); c.restore(); c.font = '12px "Noto Sans JP", sans-serif'; c.fillStyle = '#d3cfb9'; c.fillText('出撃地点', 482, 1314);
    }
    c.restore();
    // Atmospheric haze, vignetting, drifting ash.
    const vignette = c.createRadialGradient(w * .52, h * .45, h * .12, w * .5, h * .5, Math.max(w, h) * .69); vignette.addColorStop(0, '#0b151400'); vignette.addColorStop(1, lobby ? '#0b1514b8' : '#0b151485'); c.fillStyle = vignette; c.fillRect(0, 0, w, h);
    const top = c.createLinearGradient(0, 0, 0, h); top.addColorStop(0, '#101b1a55'); top.addColorStop(.4, '#88988a08'); top.addColorStop(1, '#10171230'); c.fillStyle = top; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 25; i++) { const x = (i * 137.9 + time * (3 + i % 4)) % w, y = (i * 81.4 - time * 6 + h * 100) % h; c.fillStyle = `rgba(221,210,168,${.12 + Math.sin(time + i) * .09})`; c.fillRect(x, y, i % 3 === 0 ? 2 : 1, 2); }
    if (!lobby && p?.hurt) { c.fillStyle = `rgba(165,48,34,${p.hurt * .65})`; c.fillRect(0, 0, w, h); }
    if (!lobby && p && !fullMap) this.minimap(c, state, p, w - 160, h - 151);
  }
  private mapLabel(c: CanvasRenderingContext2D, x: number, y: number, n: string, text: string, main: boolean) {
    c.save(); c.translate(x, y); c.fillStyle = '#13201ee0'; c.strokeStyle = main ? '#ba9c69' : '#95a59166'; c.lineWidth = 1; c.beginPath(); c.roundRect(-17, -20, 34, 34, 2); c.fill(); c.stroke(); c.font = '13px Georgia'; c.fillStyle = main ? '#d7bb86' : '#c2c7ac'; c.textAlign = 'center'; c.fillText(n, 0, 2); c.fillStyle = '#111c18cf'; c.fillRect(-text.length * 7 - 12, 24, text.length * 14 + 24, 28); c.font = '13px "Noto Sans JP", sans-serif'; c.fillStyle = '#e0dfc6'; c.fillText(text, 0, 43); c.restore();
  }
  private actor(c: CanvasRenderingContext2D, a: Actor, player: boolean, self: boolean, kind = '') {
    c.save(); c.translate(a.x, a.y);
    if (a.hp <= 0) { c.fillStyle = '#772e2e99'; c.beginPath(); c.ellipse(0, 0, 18, 11, .4, 0, TAU); c.fill(); c.restore(); return; }
    c.fillStyle = '#08161175'; c.beginPath(); c.ellipse(3, 9, 17, 11, 0, 0, TAU); c.fill();
    if (self) { c.strokeStyle = '#d9d1a188'; c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, 23, 0, TAU); c.stroke(); }
    c.save(); c.rotate(a.angle + Math.PI / 2);
    if (kind === 'wolf') { c.fillStyle = a.hurt ? '#ceb495' : '#929489'; c.beginPath(); c.ellipse(0, 1, 10, 18, 0, 0, TAU); c.fill(); c.fillStyle = '#c2c0a9'; c.beginPath(); c.moveTo(-8, -8); c.lineTo(-10, -20); c.lineTo(-4, -16); c.lineTo(0, -26); c.lineTo(5, -16); c.lineTo(10, -20); c.lineTo(8, -8); c.fill(); }
    else {
      c.fillStyle = '#302f27'; c.fillRect(-9, 9, 7, 9); c.fillRect(3, 9, 7, 9);
      c.fillStyle = a.hurt ? '#ddb59a' : self ? '#b1a57a' : player ? '#9e7469' : kind === 'knight' ? '#85918c' : '#886249';
      c.beginPath(); c.moveTo(-13, -7); c.quadraticCurveTo(0, -14, 13, -7); c.lineTo(15, 15); c.quadraticCurveTo(0, 21, -14, 14); c.closePath(); c.fill();
      c.fillStyle = self ? '#546f61' : '#4a4c3d'; c.fillRect(-8, 0, 16, 11); c.fillStyle = '#c4b497'; c.beginPath(); c.arc(0, -8, 8, 0, TAU); c.fill(); c.fillStyle = '#68736a'; c.beginPath(); c.arc(0, -10, 8, Math.PI, TAU); c.fill(); c.fillRect(-8, -11, 16, 3);
      const bow = player && (a as Player).weapon === 'bow';
      c.save(); c.translate(16, -2); c.rotate(a.swing > 0 ? -1 + a.swing * 9 : .2);
      if (bow) { c.strokeStyle = '#c1a473'; c.lineWidth = 3; c.beginPath(); c.arc(0, -3, 20, -Math.PI / 2, Math.PI / 2); c.stroke(); c.strokeStyle = '#ccc9a8'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, -23); c.lineTo(0, 17); c.stroke(); }
      else { c.fillStyle = '#d5d7c6'; c.beginPath(); c.moveTo(-2, 1); c.lineTo(-3, -26); c.lineTo(0, -33); c.lineTo(3, -26); c.lineTo(2, 1); c.fill(); c.fillStyle = '#b3a274'; c.fillRect(-7, 0, 14, 3); c.fillStyle = '#6b4d35'; c.fillRect(-2, 3, 4, 9); }
      c.restore();
      c.fillStyle = '#695c41'; c.beginPath(); c.ellipse(-15, -2, 6, 12, .2, 0, TAU); c.fill(); c.strokeStyle = '#b1aa87'; c.lineWidth = 2; c.stroke();
    }
    if (a.swing > 0 && (!player || (a as Player).weapon !== 'bow')) { c.strokeStyle = player ? '#ede1b28f' : '#ce887787'; c.lineWidth = 4; c.beginPath(); c.arc(0, 0, player ? 57 : 38, -2.8, -.3); c.stroke(); }
    c.restore();
    if (!self) { c.fillStyle = '#161e19'; c.fillRect(-17, -34, 34, 4); c.fillStyle = player ? '#ca806b' : '#b69b6a'; c.fillRect(-17, -34, 34 * a.hp / a.maxHp, 4); }
    if (player && !self) { c.font = '10px "Noto Sans JP", sans-serif'; c.textAlign = 'center'; c.fillStyle = '#e6d7be'; c.fillText((a as Player).name, 0, -41); }
    c.restore();
  }
  private minimap(c: CanvasRenderingContext2D, state: GameState, p: Player, x: number, y: number) {
    c.save(); c.fillStyle = '#101a17e8'; c.fillRect(x - 7, y - 7, 150, 118); c.strokeStyle = '#999d7055'; c.lineWidth = 1; c.strokeRect(x - 7, y - 7, 150, 118); c.globalAlpha = .65; c.drawImage(this.terrain, x, y, 136, 102); c.globalAlpha = 1;
    for (const exit of EXITS) { c.fillStyle = '#c5d9a3'; c.fillRect(x + exit.x / 2400 * 136 - 2, y + exit.y / 1800 * 102 - 2, 4, 4); }
    c.fillStyle = '#ffdb9a'; c.beginPath(); c.arc(x + p.x / 2400 * 136, y + p.y / 1800 * 102, 3, 0, TAU); c.fill(); c.fillStyle = '#c5c9b3'; c.font = '9px "Noto Sans JP", sans-serif'; c.fillText('M  戦域マップ', x, y - 14); c.restore();
  }
}
