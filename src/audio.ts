import type { WeaponKind } from './items';

/**
 * ASHENFELL audio — a fully procedural Web Audio engine in the spirit of a dark fantasy ARPG.
 *
 * Everything is synthesized at runtime (noise beds, filters, FM-ish grains and envelopes), so the
 * build stays asset-free and works identically on GitHub Pages and the Cloudflare build. The mix is
 * split into two buses: SFX (attacks, hits, UI) and Ambient (wind, brazier fire, distant wildlife).
 *
 * Browser autoplay policy: the AudioContext is created lazily and resumed on the first user gesture
 * via `unlock()`. All synthesis is written defensively — an optional sound must never break the raid.
 */

export type Scene = 'lobby' | 'raid';
export type SwingWeight = 'light' | 'medium' | 'heavy';
export type ImpactKind = { material: 'flesh' | 'metal'; crit?: boolean; heavy?: boolean; self?: boolean };
export type EnemyVoice = 'bandit' | 'wolf' | 'knight';
export type UiSound = 'click' | 'hover' | 'open' | 'close' | 'success' | 'fail' | 'coin' | 'equip';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Deterministic-ish randomness for the ambience scheduler (not gameplay). */
let audioRandomState = 0x504f4541;
function audioRandom() {
  audioRandomState |= 0;
  audioRandomState = (audioRandomState + 0x6D2B79F5) | 0;
  let t = Math.imul(audioRandomState ^ (audioRandomState >>> 15), 1 | audioRandomState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

type NoiseKind = 'white' | 'pink' | 'brown';

function makeNoiseBuffer(ctx: AudioContext, kind: NoiseKind, seconds = 2): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < length; i++) data[i] = audioRandom() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet's economical pink filter.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = audioRandom() * 2 - 1;
      b0 = .99886 * b0 + white * .0555179;
      b1 = .99332 * b1 + white * .0750759;
      b2 = .969 * b2 + white * .153852;
      b3 = .8665 * b3 + white * .3104856;
      b4 = .55 * b4 + white * .5329522;
      b5 = -.7616 * b5 - white * .016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * .5362) * .11;
      b6 = white * .115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = audioRandom() * 2 - 1;
      last = (last + .02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

/** Exp ramps hate zero; every envelope clamps to this floor. */
const SILENCE = .0001;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;

  private noise: Record<NoiseKind, AudioBuffer | null> = { white: null, pink: null, brown: null };

  // ---- ambient graph ----
  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneOscs: OscillatorNode[] = [];
  private fireSource: AudioBufferSourceNode | null = null;
  private fireFilter: BiquadFilterNode | null = null;
  private fireGain: GainNode | null = null;
  private fireTarget = 0;
  private windWalk = 0;

  private scene: Scene = 'lobby';
  private sfxVolume = .25;
  private ambientVolume = .5;
  private unlocked = false;
  private muted = false;

  /** World listener (the local player) so combat and fire sound alive from where they happen. */
  private listenerX = 0;
  private listenerY = 0;
  /** Brazier anchors; crackle loudness follows the nearest one. */
  private fires: readonly [number, number][] = [];
  private nearestFire = Infinity;

  private wildlifeIn = 14;
  private crackleCarry = 0;
  private stepFlip = false;

  // ---------------------------------------------------------------- setup

  /** Cheap and idempotent. Returns null when Web Audio is missing or blocked. */
  private ensure(): AudioContext | null {
    if (!this.unlocked || this.muted) return null;
    if (this.ctx) {
      if (['suspended', 'interrupted'].includes(this.ctx.state) && this.unlocked) void this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 1;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 12;
      limiter.ratio.value = 8;
      limiter.attack.value = .003;
      limiter.release.value = .2;
      master.connect(limiter).connect(ctx.destination);
      const sfx = ctx.createGain();
      sfx.gain.value = this.sfxVolume;
      sfx.connect(master);
      const amb = ctx.createGain();
      amb.gain.value = this.ambientVolume;
      amb.connect(master);
      this.ctx = ctx;
      this.master = master;
      this.sfxBus = sfx;
      this.ambBus = amb;
      this.noise.white = makeNoiseBuffer(ctx, 'white');
      this.noise.pink = makeNoiseBuffer(ctx, 'pink');
      this.noise.brown = makeNoiseBuffer(ctx, 'brown', 3);
      this.buildAmbientBed();
      return ctx;
    } catch {
      return null;
    }
  }

  /** Call from any user gesture so autoplay policies allow sound. */
  unlock() {
    this.unlocked = true;
    const ctx = this.ensure();
    if (ctx && ['suspended', 'interrupted'].includes(ctx.state)) void ctx.resume().catch(() => {});
  }

  setSfxVolume(volume: number) {
    this.sfxVolume = clamp01(volume);
    if (this.sfxBus && this.ctx) {
      this.sfxBus.gain.cancelScheduledValues(this.ctx.currentTime);
      this.sfxBus.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, .08);
    }
  }

  setAmbientVolume(volume: number) {
    this.ambientVolume = clamp01(volume);
    if (this.ambBus && this.ctx) {
      this.ambBus.gain.cancelScheduledValues(this.ctx.currentTime);
      this.ambBus.gain.setTargetAtTime(this.ambientVolume, this.ctx.currentTime, .12);
    }
  }

  setScene(scene: Scene) {
    if (this.scene === scene) return;
    this.scene = scene;
    // The raid bed tightens: darker drone, sharper wind, hungrier wildlife.
    if (this.droneGain && this.ctx) this.droneGain.gain.setTargetAtTime(scene === 'raid' ? .12 : .05, this.ctx.currentTime, 1.4);
  }

  setListener(x: number, y: number) {
    this.listenerX = x;
    this.listenerY = y;
    this.nearestFire = Infinity;
    for (const [fx, fy] of this.fires) {
      const d = Math.hypot(fx - x, fy - y);
      if (d < this.nearestFire) this.nearestFire = d;
    }
    this.fireTarget = this.nearestFire === Infinity ? 0 : Math.pow(clamp01(1 - (this.nearestFire - 70) / 560), 1.7) * .9;
  }

  setFires(fires: readonly [number, number][]) {
    this.fires = fires;
  }

  /** Suspend while the tab is hidden so a backgrounded game never keeps the speakers busy. */
  setMuted(muted: boolean) {
    this.muted = muted;
    const ctx = this.ctx;
    if (!ctx) return;
    if (muted && ctx.state === 'running') void ctx.suspend().catch(() => {});
    else if (!muted && this.unlocked && ['suspended', 'interrupted'].includes(ctx.state)) void ctx.resume().catch(() => {});
  }

  // ---------------------------------------------------------------- ambient bed

  private buildAmbientBed() {
    const ctx = this.ctx;
    if (!ctx || !this.ambBus || !this.noise.brown) return;
    const t = ctx.currentTime;

    // Distant wind: brown noise through a wandering low-pass with slow gain swells.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise.brown;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 360;
    windFilter.Q.value = .6;
    const windGain = ctx.createGain();
    windGain.gain.value = .085;
    wind.connect(windFilter).connect(windGain).connect(this.ambBus);
    wind.start(t);
    this.windSource = wind;
    this.windFilter = windFilter;
    this.windGain = windGain;

    // Fire bed: another brown loop, gated by how close the listener is to a brazier.
    const fire = ctx.createBufferSource();
    fire.buffer = this.noise.brown;
    fire.loop = true;
    const fireFilter = ctx.createBiquadFilter();
    fireFilter.type = 'lowpass';
    fireFilter.frequency.value = 420;
    const fireGain = ctx.createGain();
    fireGain.gain.value = SILENCE;
    fire.connect(fireFilter).connect(fireGain).connect(this.ambBus);
    fire.start(t);
    this.fireSource = fire;
    this.fireFilter = fireFilter;
    this.fireGain = fireGain;

    // Underlying drone: two detuned oscillators in a fifth, the classic dark-ARPG bed.
    const droneGain = ctx.createGain();
    droneGain.gain.value = this.scene === 'raid' ? .12 : .05;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 170;
    droneGain.connect(droneFilter).connect(this.ambBus);
    for (const [freq, type, gain] of [[55, 'sawtooth', .5], [82.4, 'sine', .8]] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g).connect(droneGain);
      osc.start(t);
      this.droneOscs.push(osc);
    }
    this.droneGain = droneGain;
  }

  /** Per-frame ambience bookkeeping: fire proximity, wind wandering, crackles and wildlife. */
  update(dt: number) {
    const ctx = this.ensure();
    if (!ctx || !this.ambBus) return;
    const t = ctx.currentTime;

    // Fire roar follows the listener's distance to the nearest brazier.
    if (this.fireGain && this.fireFilter) {
      this.fireGain.gain.setTargetAtTime(Math.max(SILENCE, this.fireTarget), t, .45);
      this.fireFilter.frequency.setTargetAtTime(360 + this.fireTarget * 260, t, .5);
      // Heavier crackle pops when standing inside the firelight.
      this.crackleCarry += dt * (this.fireTarget * 18 + (this.scene === 'raid' ? .35 : .18));
      while (this.crackleCarry >= 1) {
        this.crackleCarry -= 1;
        if (this.fireTarget > .02 || audioRandom() < .18) this.crackle(this.fireTarget);
      }
    }

    // Wind breathes: a slow random walk on filter frequency and gain.
    this.windWalk += dt * .11;
    if (this.windFilter && this.windGain) {
      const gust = Math.sin(this.windWalk * 1.7) * .5 + Math.sin(this.windWalk * .53 + 2.1) * .5;
      this.windFilter.frequency.setTargetAtTime(300 + gust * 220, t, .8);
      this.windGain.gain.setTargetAtTime(.065 + clamp01(gust * .5 + .5) * .075, t, 1.1);
    }

    // Distant wildlife and weather events.
    this.wildlifeIn -= dt;
    if (this.wildlifeIn <= 0) {
      this.wildlifeIn = (this.scene === 'raid' ? 15 : 11) + audioRandom() * (this.scene === 'raid' ? 26 : 20);
      const roll = audioRandom();
      if (roll < .3) this.crow();
      else if (roll < .52) this.owl();
      else if (roll < .72) this.distantHowl();
      else if (roll < .86) this.distantClang();
      else this.gust();
    }
  }

  // ---------------------------------------------------------------- one-shot plumbing

  private noiseSource(kind: NoiseKind, playbackRate = 1) {
    const ctx = this.ctx;
    if (!ctx) return null;
    const source = ctx.createBufferSource();
    source.buffer = this.noise[kind];
    source.playbackRate.value = playbackRate;
    return source;
  }

  /** Distance + stereo placement so hits away from the player sit back in the mix. */
  private place(node: AudioNode, x?: number, y?: number, spread = 720): GainNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const out = ctx.createGain();
    let gain = 1;
    if (x !== undefined && y !== undefined) {
      const d = Math.hypot(x - this.listenerX, y - this.listenerY);
      gain = clamp01(1 - d / spread);
      gain *= .22 + .78 * gain;
    }
    out.gain.value = gain;
    if (ctx.createStereoPanner && x !== undefined) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-.72, Math.min(.72, (x - this.listenerX) / 900));
      node.connect(pan).connect(out).connect(this.sfxBus!);
    } else {
      node.connect(out).connect(this.sfxBus!);
    }
    return out;
  }

  private toneOneShot(opts: {
    freq: number; toFreq?: number; duration: number; type?: OscillatorType;
    gain?: number; attack?: number; x?: number; y?: number; filter?: { type: BiquadFilterType; freq: number; q?: number };
  }) {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, opts.freq), t);
    if (opts.toFreq && opts.toFreq !== opts.freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.toFreq), t + opts.duration);
    const env = ctx.createGain();
    const peak = opts.gain ?? .2;
    const attack = opts.attack ?? .006;
    env.gain.setValueAtTime(SILENCE, t);
    env.gain.linearRampToValueAtTime(peak, t + attack);
    const hold = Math.min(opts.duration * .3, .045);
    env.gain.setValueAtTime(peak, t + Math.max(attack, hold));
    env.gain.exponentialRampToValueAtTime(Math.max(SILENCE, peak * .06), t + opts.duration * .88);
    env.gain.linearRampToValueAtTime(0, t + opts.duration);
    const tail: AudioNode = env;
    if (opts.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = opts.filter.type;
      filter.frequency.value = opts.filter.freq;
      filter.Q.value = opts.filter.q ?? 1;
      osc.connect(filter).connect(env);
    } else {
      osc.connect(env);
    }
    const output = this.place(tail, opts.x, opts.y);
    osc.onended = () => { osc.disconnect(); env.disconnect(); output?.disconnect(); };
    osc.start(t);
    osc.stop(t + opts.duration + .02);
  }

  private noiseBurst(opts: {
    kind?: NoiseKind; duration: number; gain?: number; attack?: number;
    filterType?: BiquadFilterType; freq: number; freqEnd?: number; q?: number;
    x?: number; y?: number; rate?: number;
  }) {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    const source = this.noiseSource(opts.kind ?? 'white', opts.rate ?? 1);
    if (!source) return;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType ?? 'bandpass';
    filter.frequency.setValueAtTime(Math.max(30, opts.freq), t);
    if (opts.freqEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(30, opts.freqEnd), t + opts.duration);
    filter.Q.value = opts.q ?? 1;
    const env = ctx.createGain();
    const attack = opts.attack ?? .004;
    env.gain.setValueAtTime(SILENCE, t);
    const peak = opts.gain ?? .2;
    env.gain.linearRampToValueAtTime(peak, t + attack);
    env.gain.setValueAtTime(peak, t + Math.max(attack, Math.min(.05, opts.duration * .3)));
    env.gain.exponentialRampToValueAtTime(Math.max(SILENCE, peak * .06), t + opts.duration * .88);
    env.gain.linearRampToValueAtTime(0, t + opts.duration);
    source.connect(filter).connect(env);
    const output = this.place(env, opts.x, opts.y);
    source.onended = () => { source.disconnect(); filter.disconnect(); env.disconnect(); output?.disconnect(); };
    source.start(t, audioRandom() * 1.5);
    source.stop(t + opts.duration + .02);
  }

  // ---------------------------------------------------------------- ambience events

  private crackle(strength: number) {
    const ctx = this.ctx;
    if (!ctx || !this.ambBus) return;
    const t = ctx.currentTime;
    const bright = audioRandom();
    const source = this.noiseSource('white');
    if (!source) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1300 + bright * 2600;
    filter.Q.value = 2 + audioRandom() * 4;
    const env = ctx.createGain();
    const dur = .014 + audioRandom() * .05;
    env.gain.setValueAtTime(SILENCE, t);
    env.gain.linearRampToValueAtTime((.05 + strength * .16) * (.4 + bright * .8), t + .002);
    env.gain.exponentialRampToValueAtTime(SILENCE, t + dur);
    source.connect(filter).connect(env).connect(this.ambBus);
    source.onended = () => { source.disconnect(); filter.disconnect(); env.disconnect(); };
    source.start(t, audioRandom() * 1.5);
    source.stop(t + dur + .02);
  }

  private crow() {
    const ctx = this.ensure();
    if (!ctx || !this.ambBus) return;
    const t = ctx.currentTime;
    const calls = 2 + Math.floor(audioRandom() * 2);
    for (let i = 0; i < calls; i++) {
      const start = t + i * (.22 + audioRandom() * .12);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(620 + audioRandom() * 90, start);
      osc.frequency.exponentialRampToValueAtTime(380, start + .13);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1100;
      filter.Q.value = 3.2;
      const env = ctx.createGain();
      env.gain.setValueAtTime(SILENCE, start);
      env.gain.linearRampToValueAtTime(.035, start + .012);
      env.gain.exponentialRampToValueAtTime(SILENCE, start + .15);
      osc.connect(filter).connect(env).connect(this.ambBus);
      osc.onended = () => { osc.disconnect(); filter.disconnect(); env.disconnect(); };
      osc.start(start);
      osc.stop(start + .18);
    }
  }

  private owl() {
    const ctx = this.ensure();
    if (!ctx || !this.ambBus) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const start = t + i * .55;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 340 - i * 24;
      const env = ctx.createGain();
      env.gain.setValueAtTime(SILENCE, start);
      env.gain.linearRampToValueAtTime(.05, start + .06);
      env.gain.exponentialRampToValueAtTime(SILENCE, start + .32);
      osc.connect(env).connect(this.ambBus);
      osc.onended = () => { osc.disconnect(); env.disconnect(); };
      osc.start(start);
      osc.stop(start + .35);
    }
  }

  private distantHowl() {
    const ctx = this.ensure();
    if (!ctx || !this.ambBus) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.linearRampToValueAtTime(300, t + .7);
    osc.frequency.linearRampToValueAtTime(240, t + 1.8);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const env = ctx.createGain();
    env.gain.setValueAtTime(SILENCE, t);
    env.gain.linearRampToValueAtTime(.028, t + .45);
    env.gain.setValueAtTime(.028, t + 1.3);
    env.gain.exponentialRampToValueAtTime(SILENCE, t + 2);
    osc.connect(filter).connect(env).connect(this.ambBus);
    osc.onended = () => { osc.disconnect(); filter.disconnect(); env.disconnect(); };
    osc.start(t);
    osc.stop(t + 2.1);
  }

  private distantClang() {
    const ctx = this.ensure();
    if (!ctx || !this.ambBus) return;
    const t = ctx.currentTime;
    for (const [freq, dur, gain] of [[2100, .5, .02], [3170, .32, .012]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq * (.98 + audioRandom() * .04);
      const env = ctx.createGain();
      env.gain.setValueAtTime(SILENCE, t);
      env.gain.linearRampToValueAtTime(gain, t + .004);
      env.gain.exponentialRampToValueAtTime(SILENCE, t + dur);
      osc.connect(env).connect(this.ambBus);
      osc.onended = () => { osc.disconnect(); env.disconnect(); };
      osc.start(t);
      osc.stop(t + dur + .02);
    }
  }

  private gust() {
    this.noiseBurst({ kind: 'brown', duration: 2.6, gain: .075, attack: .9, filterType: 'lowpass', freq: 220, freqEnd: 760 });
  }

  // ---------------------------------------------------------------- combat sfx

  /** Local accepted attack: audible even on small speakers, with brief ambience ducking. */
  attack(kind: WeaponKind, x?: number, y?: number) {
    const ctx = this.ensure();
    if (!ctx || this.sfxVolume <= 0) return;
    if (x !== undefined && y !== undefined) this.setListener(x, y);
    if (this.ambBus) {
      const gain = this.ambBus.gain;
      gain.cancelScheduledValues(ctx.currentTime);
      gain.setTargetAtTime(this.ambientVolume * .4, ctx.currentTime, .015);
      gain.setTargetAtTime(this.ambientVolume, ctx.currentTime + .24, .16);
    }
    if (kind === 'bow') this.bowShot(x, y);
    else if (kind === 'crossbow') this.crossbowShot(x, y);
    else this.swing(['axe', 'mace', 'greatsword'].includes(kind) ? 'heavy' : kind === 'dagger' ? 'light' : 'medium', x, y);
  }

  /** Melee whoosh. Heavier weapons sweep lower and carry more sub. */
  swing(weight: SwingWeight = 'medium', x?: number, y?: number) {
    const heavy = weight === 'heavy';
    const light = weight === 'light';
    this.noiseBurst({
      kind: 'pink', duration: heavy ? .3 : light ? .16 : .22,
      gain: heavy ? .85 : .65, attack: .008,
      filterType: 'bandpass', freq: light ? 1500 : heavy ? 620 : 950,
      freqEnd: light ? 520 : heavy ? 170 : 300, q: 1.15, x, y,
    });
    this.toneOneShot({
      freq: heavy ? 150 : light ? 260 : 195, toFreq: heavy ? 52 : 110,
      duration: heavy ? .26 : .16, type: 'triangle', gain: heavy ? .38 : .26, x, y,
      filter: { type: 'lowpass', freq: 700 },
    });
    if (heavy) this.toneOneShot({ freq: 90, toFreq: 46, duration: .3, type: 'sine', gain: .16, x, y });
  }

  /** Bowstring pluck plus the arrow cutting the air. */
  bowShot(x?: number, y?: number) {
    this.toneOneShot({ freq: 340, toFreq: 175, duration: .14, type: 'triangle', gain: .4, x, y, filter: { type: 'lowpass', freq: 1400 } });
    this.noiseBurst({ duration: .05, gain: .12, filterType: 'highpass', freq: 1800, x, y });
    this.noiseBurst({ kind: 'pink', duration: .3, gain: .16, attack: .02, filterType: 'bandpass', freq: 1300, freqEnd: 420, q: 1.1, x, y });
  }

  /** Crossbow: heavier prod and a mechanical release. */
  crossbowShot(x?: number, y?: number) {
    this.toneOneShot({ freq: 190, toFreq: 90, duration: .16, type: 'square', gain: .28, x, y, filter: { type: 'lowpass', freq: 900 } });
    this.noiseBurst({ duration: .07, gain: .18, filterType: 'bandpass', freq: 2400, freqEnd: 900, x, y });
    this.noiseBurst({ kind: 'pink', duration: .26, gain: .15, filterType: 'bandpass', freq: 1100, freqEnd: 380, x, y });
  }

  /** Arrow landing in dirt or wood. */
  arrowHit(x?: number, y?: number) {
    this.noiseBurst({ duration: .09, gain: .16, filterType: 'lowpass', freq: 700, freqEnd: 260, x, y });
    this.toneOneShot({ freq: 150, toFreq: 70, duration: .1, type: 'sine', gain: .1, x, y });
  }

  /** Blade meeting flesh or armour. Criticals ring brighter and punch lower. */
  impact(kind: ImpactKind, x?: number, y?: number) {
    const { material, crit = false, heavy = false, self = false } = kind;
    const punch = (heavy ? .32 : .22) * (crit ? 1.35 : 1) * (self ? 1.15 : 1);
    this.toneOneShot({ freq: crit ? 150 : 118, toFreq: 52, duration: crit ? .17 : .12, type: 'sine', gain: punch, x, y });
    this.noiseBurst({ duration: .08, gain: punch * .85, filterType: 'lowpass', freq: 900, freqEnd: 320, x, y });
    if (material === 'metal') {
      this.noiseBurst({ duration: .13, gain: .17, filterType: 'bandpass', freq: 2400, freqEnd: 1400, q: 2.2, x, y });
      this.toneOneShot({ freq: 2750, toFreq: 2100, duration: .12, type: 'triangle', gain: .07, x, y });
      this.toneOneShot({ freq: 3600, toFreq: 2900, duration: .09, type: 'triangle', gain: .05, x, y });
    } else {
      this.noiseBurst({ kind: 'pink', duration: .11, gain: .16, filterType: 'bandpass', freq: 520, freqEnd: 240, q: .9, x, y });
    }
    if (crit) {
      // A hard metallic sparkle plus a sub drop: the crit "crunch" of an ARPG.
      this.noiseBurst({ duration: .16, gain: .13, filterType: 'highpass', freq: 3200, x, y });
      this.toneOneShot({ freq: 1180, toFreq: 720, duration: .22, type: 'triangle', gain: .09, x, y });
      this.toneOneShot({ freq: 82, toFreq: 38, duration: .3, type: 'sine', gain: .2, x, y });
    }
  }

  /** Enemy telegraph: growl, snarl or the whisper of a blade. */
  enemyAttack(voice: EnemyVoice, x?: number, y?: number) {
    if (voice === 'wolf') {
      this.toneOneShot({ freq: 175, toFreq: 78, duration: .22, type: 'sawtooth', gain: .11, x, y, filter: { type: 'bandpass', freq: 520, q: 2.4 } });
      this.noiseBurst({ kind: 'pink', duration: .18, gain: .12, filterType: 'bandpass', freq: 900, freqEnd: 420, q: 1.3, x, y });
    } else if (voice === 'knight') {
      this.swing('heavy', x, y);
      this.toneOneShot({ freq: 120, toFreq: 84, duration: .18, type: 'sawtooth', gain: .07, x, y, filter: { type: 'bandpass', freq: 640, q: 2 } });
    } else {
      this.swing('medium', x, y);
      this.toneOneShot({ freq: 155, toFreq: 96, duration: .15, type: 'sawtooth', gain: .07, x, y, filter: { type: 'bandpass', freq: 760, q: 2.2 } });
    }
  }

  /** The local player taking a hit: pain grunt, impact thud, armour rattle. */
  hurt(x?: number, y?: number) {
    this.toneOneShot({ freq: 165, toFreq: 88, duration: .19, type: 'sawtooth', gain: .13, x, y, filter: { type: 'bandpass', freq: 720, q: 1.8 } });
    this.toneOneShot({ freq: 105, toFreq: 48, duration: .16, type: 'sine', gain: .24, x, y });
    this.noiseBurst({ duration: .1, gain: .16, filterType: 'lowpass', freq: 1100, freqEnd: 380, x, y });
  }

  /** A parried hit glancing off the energy shield or armour. */
  block(x?: number, y?: number) {
    this.noiseBurst({ duration: .12, gain: .18, filterType: 'bandpass', freq: 2800, freqEnd: 1600, q: 2.6, x, y });
    this.toneOneShot({ freq: 1650, toFreq: 980, duration: .16, type: 'triangle', gain: .08, x, y });
  }

  /** Death cries by body type, each closing with a heavy fall. */
  death(voice: EnemyVoice | 'player', x?: number, y?: number) {
    if (voice === 'wolf') {
      this.toneOneShot({ freq: 330, toFreq: 84, duration: .38, type: 'sawtooth', gain: .14, x, y, filter: { type: 'bandpass', freq: 780, q: 1.7 } });
    } else if (voice === 'knight') {
      this.toneOneShot({ freq: 140, toFreq: 52, duration: .5, type: 'sawtooth', gain: .13, x, y, filter: { type: 'lowpass', freq: 720 } });
      this.noiseBurst({ duration: .34, gain: .17, filterType: 'bandpass', freq: 2200, freqEnd: 700, q: 1.6, x, y });
      for (let i = 0; i < 3; i++) this.noiseBurst({ duration: .05, gain: .08, filterType: 'bandpass', freq: 1900 + i * 420, x: x === undefined ? undefined : x + (i - 1) * 18, y });
    } else if (voice === 'player') {
      this.toneOneShot({ freq: 120, toFreq: 34, duration: .8, type: 'sine', gain: .3, x, y });
      this.toneOneShot({ freq: 210, toFreq: 58, duration: .9, type: 'sawtooth', gain: .12, x, y, filter: { type: 'lowpass', freq: 480 } });
      this.noiseBurst({ kind: 'brown', duration: .7, gain: .18, filterType: 'lowpass', freq: 500, freqEnd: 140, x, y });
    } else {
      this.toneOneShot({ freq: 150, toFreq: 58, duration: .42, type: 'sawtooth', gain: .13, x, y, filter: { type: 'bandpass', freq: 620, q: 1.6 } });
    }
    // Body hitting the ground.
    this.toneOneShot({ freq: 86, toFreq: 40, duration: .22, type: 'sine', gain: .22, x, y });
    this.noiseBurst({ duration: .12, gain: .12, filterType: 'lowpass', freq: 420, freqEnd: 180, x, y });
  }

  /** Enemy noticing the player. */
  alert(voice: EnemyVoice, x?: number, y?: number) {
    if (voice === 'wolf') {
      for (let i = 0; i < 2; i++) this.toneOneShot({ freq: 210 - i * 30, toFreq: 120, duration: .13, type: 'sawtooth', gain: .1, x, y, filter: { type: 'bandpass', freq: 840, q: 2.2 } });
    } else if (voice === 'knight') {
      this.toneOneShot({ freq: 105, toFreq: 74, duration: .34, type: 'sawtooth', gain: .1, x, y, filter: { type: 'lowpass', freq: 520 } });
      this.noiseBurst({ duration: .3, gain: .1, filterType: 'bandpass', freq: 2600, freqEnd: 1100, q: 2, x, y });
    } else {
      this.toneOneShot({ freq: 175, toFreq: 112, duration: .2, type: 'sawtooth', gain: .1, x, y, filter: { type: 'bandpass', freq: 820, q: 1.9 } });
    }
  }

  // ---------------------------------------------------------------- player feedback

  /** Potion: glass note plus warm rising body. */
  heal() {
    this.toneOneShot({ freq: 660, duration: .5, type: 'sine', gain: .1, filter: { type: 'lowpass', freq: 2400 } });
    this.toneOneShot({ freq: 992, toFreq: 1046, duration: .55, type: 'sine', gain: .07, attack: .05, filter: { type: 'lowpass', freq: 3200 } });
    this.toneOneShot({ freq: 180, toFreq: 260, duration: .55, type: 'triangle', gain: .1, attack: .12, filter: { type: 'lowpass', freq: 700 } });
    this.noiseBurst({ kind: 'pink', duration: .5, gain: .07, attack: .18, filterType: 'bandpass', freq: 700, freqEnd: 1600, q: .8 });
  }

  /** Item into the backpack: soft, never louder than the world. */
  pickup(x?: number, y?: number) {
    this.toneOneShot({ freq: 740, toFreq: 988, duration: .12, type: 'triangle', gain: .08, x, y, filter: { type: 'lowpass', freq: 3200 } });
    this.toneOneShot({ freq: 1108, duration: .16, type: 'sine', gain: .05, attack: .01, x, y });
    this.noiseBurst({ duration: .07, gain: .05, filterType: 'lowpass', freq: 900, x, y });
  }

  /** Rare find: a brighter version of pickup. */
  pickupRare(x?: number, y?: number) {
    this.pickup(x, y);
    this.toneOneShot({ freq: 1318, duration: .3, type: 'sine', gain: .07, attack: .02, x, y });
    this.toneOneShot({ freq: 1760, toFreq: 1976, duration: .38, type: 'sine', gain: .05, attack: .04, x, y });
  }

  /** Coins trading hands. */
  coin() {
    for (const freq of [1174, 1568, 1864]) this.toneOneShot({ freq: freq * (.98 + audioRandom() * .04), duration: .16, type: 'triangle', gain: .06 });
    this.noiseBurst({ duration: .1, gain: .05, filterType: 'highpass', freq: 2600 });
  }

  /** Quick evasive roll. */
  dodge(x?: number, y?: number) {
    this.noiseBurst({ kind: 'pink', duration: .26, gain: .17, attack: .03, filterType: 'bandpass', freq: 520, freqEnd: 1800, q: .8, x, y });
    this.noiseBurst({ kind: 'pink', duration: .18, gain: .1, attack: .02, filterType: 'bandpass', freq: 1600, freqEnd: 520, q: 1, x, y });
    this.toneOneShot({ freq: 130, toFreq: 64, duration: .18, type: 'sine', gain: .1, x, y });
  }

  /** Boot on ash and gravel. */
  footstep(sprint = false, x?: number, y?: number) {
    this.stepFlip = !this.stepFlip;
    const f = this.stepFlip ? 1.08 : .93;
    this.noiseBurst({
      kind: 'pink', duration: sprint ? .08 : .065,
      gain: sprint ? .1 : .07, filterType: 'lowpass',
      freq: (sprint ? 780 : 560) * f, freqEnd: 220, x, y,
    });
    this.toneOneShot({ freq: 78 * f, toFreq: 46, duration: .07, type: 'sine', gain: sprint ? .07 : .045, x, y });
  }

  /** Extraction countdown heartbeat. */
  tick() {
    this.toneOneShot({ freq: 880, toFreq: 640, duration: .06, type: 'triangle', gain: .07, filter: { type: 'bandpass', freq: 1200, q: 1.6 } });
    this.toneOneShot({ freq: 110, toFreq: 70, duration: .1, type: 'sine', gain: .12 });
  }

  /** Successful extraction: a rising minor-to-major chord, like a town portal landing. */
  extract() {
    const notes = [392, 494, 587, 784];
    notes.forEach((freq, i) => {
      this.toneOneShot({ freq, duration: 1.1 + i * .12, type: 'sine', gain: .09, attack: .05 + i * .05, filter: { type: 'lowpass', freq: 2600 } });
      this.toneOneShot({ freq: freq * 2, duration: .8, type: 'triangle', gain: .03, attack: .12 + i * .05 });
    });
    this.noiseBurst({ kind: 'pink', duration: 1.4, gain: .06, attack: .5, filterType: 'bandpass', freq: 600, freqEnd: 2400, q: .7 });
  }

  /** Crafting / equip confirmation. */
  equip() {
    this.toneOneShot({ freq: 220, toFreq: 140, duration: .12, type: 'triangle', gain: .12, filter: { type: 'lowpass', freq: 1200 } });
    this.noiseBurst({ duration: .12, gain: .1, filterType: 'bandpass', freq: 1800, freqEnd: 2600, q: 1.4 });
    this.toneOneShot({ freq: 523, duration: .22, type: 'sine', gain: .06, attack: .03 });
  }

  /** Interface sounds, deliberately dry and quiet. */
  ui(kind: UiSound = 'click') {
    switch (kind) {
      case 'hover':
        this.toneOneShot({ freq: 620, duration: .035, type: 'sine', gain: .028 });
        break;
      case 'open':
        this.noiseBurst({ duration: .16, gain: .07, filterType: 'bandpass', freq: 500, freqEnd: 1400, q: 1.1 });
        this.toneOneShot({ freq: 330, toFreq: 440, duration: .12, type: 'triangle', gain: .06 });
        break;
      case 'close':
        this.noiseBurst({ duration: .12, gain: .06, filterType: 'bandpass', freq: 900, freqEnd: 380, q: 1.1 });
        this.toneOneShot({ freq: 300, toFreq: 210, duration: .1, type: 'triangle', gain: .05 });
        break;
      case 'success':
        this.toneOneShot({ freq: 523, duration: .16, type: 'triangle', gain: .08 });
        this.toneOneShot({ freq: 784, duration: .28, type: 'triangle', gain: .08, attack: .02 });
        break;
      case 'fail':
        this.toneOneShot({ freq: 150, toFreq: 96, duration: .24, type: 'sawtooth', gain: .08, filter: { type: 'lowpass', freq: 640 } });
        break;
      case 'coin':
        this.coin();
        break;
      case 'equip':
        this.equip();
        break;
      default:
        this.toneOneShot({ freq: 320, toFreq: 250, duration: .05, type: 'square', gain: .05, filter: { type: 'lowpass', freq: 1200 } });
    }
  }

  /** Legacy-friendly generic beep used by older UI hooks. */
  tone(frequency = 440, duration = .08, type: OscillatorType = 'sine') {
    this.toneOneShot({ freq: frequency, toFreq: frequency * .65, duration, type, gain: .08, filter: { type: 'lowpass', freq: 2600 } });
  }

  /** Raid horn / deploy stinger. */
  warHorn() {
    for (const [freq, gain] of [[98, .16], [147, .1], [196, .06]] as const) {
      this.toneOneShot({ freq, toFreq: freq * 1.02, duration: 1.15, type: 'sawtooth', gain, attack: .16, filter: { type: 'lowpass', freq: 520 } });
    }
  }
}

/** Singleton shared by the HUD and the game loop. */
export const audio = new GameAudio();
