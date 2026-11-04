// Procedural WebAudio: soft UI sounds, surface-aware footsteps, weapons, radio, alerts,
// and a generative stealth score (menu + adaptive in-game). Safe when audio is unavailable.
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
// D minor stealth progression (MIDI roots + chord tones)
const PROG = [
  { root: 38, tones: [62, 65, 69, 72] },   // Dm(add9-ish)
  { root: 34, tones: [62, 65, 70, 74] },   // Bb
  { root: 31, tones: [62, 67, 70, 74] },   // Gm
  { root: 33, tones: [61, 64, 69, 73] },   // A (tension)
];
export class Audio {
  constructor() {
    this.ctx = null; this.ok = false; this.intensity = 0; this.musicVol = 0.5; this.sfxVol = 0.8;
    this.mode = 'menu'; this.step16 = 0; this.nextT = 0; this.chord = 0; this.chatterT = 4; this.padVoices = [];
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { }); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = 0.85;
      this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4;
      this.comp.connect(this.master); this.master.connect(c.destination);
      this.sfx = c.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.comp);
      this.music = c.createGain(); this.music.gain.value = this.musicVol * 0.55; this.music.connect(this.comp);
      // reverb (generated impulse)
      this.verb = c.createConvolver(); this.verb.buffer = this.impulse(2.8, 2.2);
      this.verbOut = c.createGain(); this.verbOut.gain.value = 0.9; this.verb.connect(this.verbOut); this.verbOut.connect(this.comp);
      this.musicVerb = c.createGain(); this.musicVerb.gain.value = 0.55; this.musicVerb.connect(this.verb);
      this.sfxVerb = c.createGain(); this.sfxVerb.gain.value = 0.18; this.sfxVerb.connect(this.verb);
      this.music.connect(this.musicVerb);
      // tempo delay for plucks
      this.delay = c.createDelay(2); this.delay.delayTime.value = 0.54;
      const fb = c.createGain(); fb.gain.value = 0.38; const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2200;
      this.delay.connect(dlp); dlp.connect(fb); fb.connect(this.delay); dlp.connect(this.music);
      this.delayIn = c.createGain(); this.delayIn.gain.value = 0.5; this.delayIn.connect(this.delay);
      // noise
      const len = c.sampleRate * 2;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // music layers
      this.padBus = c.createGain(); this.padBus.gain.value = 0.0; this.padBus.connect(this.music);
      this.padLP = c.createBiquadFilter(); this.padLP.type = 'lowpass'; this.padLP.frequency.value = 900; this.padLP.Q.value = 0.4; this.padLP.connect(this.padBus);
      this.lfo = c.createOscillator(); this.lfo.frequency.value = 0.05; const lg = c.createGain(); lg.gain.value = 350; this.lfo.connect(lg); lg.connect(this.padLP.frequency); this.lfo.start();
      this.wind = this.loopNoise(260, 0.6, 0.012);
      this.ok = true;
      if (c.state === 'suspended') c.resume().catch(() => { });
    } catch (e) { this.ok = false; }
  }
  impulse(sec, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
  loopNoise(freq, q, gain) {
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = gain; s.connect(f); f.connect(g); g.connect(this.music); s.start();
    return { s, f, g };
  }
  setVolumes(music, sfx) { this.musicVol = music; this.sfxVol = sfx; if (this.ok) { this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05); this.music.gain.setTargetAtTime(music * 0.55, this.ctx.currentTime, 0.05); } }
  setMode(m) { this.mode = m; }
  suspend() { if (this.ok) this.ctx.suspend().catch(() => { }); }
  resume() { if (this.ok) this.ctx.resume().catch(() => { }); }

  // --- building blocks ---
  nz(t, dur, { freq = 1000, q = 1, type = 'bandpass', gain = 0.5, attack = 0.002, dest = null, verb = 0 } = {}) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfx);
    if (verb) { const v = c.createGain(); v.gain.value = verb; g.connect(v); v.connect(this.sfxVerb); }
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return f;
  }
  tone(t, f0, f1, dur, { type = 'sine', gain = 0.3, dest = null, attack = 0.005, verb = 0, lp = 0 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let src = o;
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); src = f; }
    src.connect(g); g.connect(dest || this.sfx);
    if (verb) { const v = c.createGain(); v.gain.value = verb; g.connect(v); v.connect(this.sfxVerb); }
    o.start(t); o.stop(t + dur + 0.05);
  }
  // soft mallet-like note (used by UI and music plucks)
  mallet(t, f, gain, dest, dur = 0.9) {
    this.tone(t, f, f, dur, { type: 'sine', gain, dest, attack: 0.004 });
    this.tone(t, f * 2.01, f * 2.01, dur * 0.35, { type: 'sine', gain: gain * 0.25, dest, attack: 0.002 });
  }

  play(name, o = {}) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime + 0.004;
    const vol = o.vol ?? 1;
    const r = () => Math.random();
    try {
      switch (name) {
        // --- UI ---
        case 'ui': this.tone(t, 880, 820, 0.07, { gain: 0.05, lp: 2500 }); this.nz(t, 0.025, { freq: 3200, q: 2, gain: 0.015 }); break;
        case 'uiConfirm': this.mallet(t, NOTE(74), 0.06); this.mallet(t + 0.07, NOTE(81), 0.05); break;
        case 'uiBack': this.mallet(t, NOTE(69), 0.05); this.mallet(t + 0.06, NOTE(62), 0.04); break;
        case 'click': this.nz(t, 0.03, { freq: 2600, q: 3, gain: 0.05 }); break;
        // --- movement ---
        case 'step': {
          const mat = o.mat || 'wood';
          const g = o.crouch ? 0.25 : o.run ? 1 : 0.55;
          const f0 = 260 + r() * 140;
          // heel + toe
          for (const [dt, k] of [[0, 1], [0.035 + r() * 0.015, 0.55]]) {
            if (mat === 'tile') { this.nz(t + dt, 0.05, { freq: 1900 + r() * 600, q: 1.4, gain: 0.05 * g * k }); this.nz(t + dt, 0.06, { freq: 500, q: 0.8, type: 'lowpass', gain: 0.06 * g * k }); }
            else if (mat === 'concrete') { this.nz(t + dt, 0.07, { freq: 900 + r() * 300, q: 0.8, gain: 0.05 * g * k }); }
            else if (mat === 'soft') { this.nz(t + dt, 0.08, { freq: 420, q: 0.6, type: 'lowpass', gain: 0.06 * g * k }); }
            else { this.nz(t + dt, 0.08, { freq: f0, q: 1.1, gain: 0.08 * g * k }); this.tone(t + dt, 95, 70, 0.06, { gain: 0.05 * g * k }); }
          }
          if (o.surface === 1) for (let i = 0; i < 5; i++) this.nz(t + r() * 0.08, 0.04, { freq: 4500 + r() * 3500, q: 6, gain: 0.05 * (o.crouch ? 0.6 : 1) });
          else if (o.surface === 2) { this.tone(t + 0.02, 520, 760 + r() * 120, 0.22, { type: 'triangle', gain: 0.03 * (o.crouch ? 0.6 : 1), lp: 1800 }); }
          break;
        }
        case 'door': this.nz(t, o.quiet ? 0.35 : 0.5, { freq: o.quiet ? 500 : 700, q: 5, gain: o.quiet ? 0.015 : 0.035, attack: 0.08 }); this.nz(t + (o.quiet ? 0.3 : 0.4), 0.08, { freq: 220, type: 'lowpass', gain: o.quiet ? 0.04 : 0.12 }); break;
        case 'hide': this.nz(t, 0.25, { freq: 900, q: 0.8, gain: 0.03, attack: 0.05 }); break;
        // --- weapons ---
        case 'gun': if (o.suppressed) { this.nz(t, 0.08, { freq: 1500, q: 0.9, gain: 0.3 * vol }); this.tone(t, 220, 90, 0.07, { type: 'triangle', gain: 0.1 * vol }); this.nz(t + 0.03, 0.05, { freq: 4000, q: 3, gain: 0.04 }); }
          else { this.nz(t, 0.32, { freq: 1100, q: 0.5, type: 'lowpass', gain: 0.85 * vol, verb: 0.6 }); this.tone(t, 150, 42, 0.22, { gain: 0.55 * vol }); }
          break;
        case 'enemygun': this.nz(t, 0.28, { freq: 800, q: 0.5, type: 'lowpass', gain: 0.5 * vol, verb: 0.5 }); this.tone(t, 125, 45, 0.15, { gain: 0.3 * vol }); break;
        case 'dry': this.nz(t, 0.025, { freq: 3500, q: 4, gain: 0.06 }); break;
        case 'reload': this.nz(t, 0.04, { freq: 2600, q: 4, gain: 0.12 }); this.nz(t + 0.2, 0.05, { freq: 1800, q: 4, gain: 0.12 }); break;
        case 'reloaded': this.nz(t, 0.05, { freq: 1400, q: 3, gain: 0.16 }); this.nz(t + 0.05, 0.03, { freq: 3000, q: 4, gain: 0.08 }); break;
        // --- stealth / alerts ---
        case 'radio': this.nz(t, 0.3, { freq: 1700, q: 7, gain: 0.18 }); this.tone(t + 0.02, 1320, 1320, 0.05, { type: 'square', gain: 0.03, lp: 3000 }); break;
        case 'tick': this.mallet(t, o.last ? NOTE(88) : NOTE(81), 0.07, null, 0.25); break;
        case 'reportdone': this.nz(t, 0.5, { freq: 1500, q: 5, gain: 0.2 }); this.tone(t, NOTE(69), NOTE(69), 0.6, { type: 'sawtooth', gain: 0.04, lp: 1500 }); this.tone(t + 0.2, NOTE(65), NOTE(65), 0.7, { type: 'sawtooth', gain: 0.04, lp: 1500 }); break;
        case 'interrupt': this.nz(t, 0.12, { freq: 2400, q: 5, gain: 0.15 }); this.mallet(t + 0.05, NOTE(74), 0.05); this.mallet(t + 0.12, NOTE(69), 0.04); break;
        case 'alert': this.tone(t, NOTE(62), NOTE(62), 0.6, { type: 'sawtooth', gain: 0.05, lp: 1200, verb: 0.6 }); this.tone(t, NOTE(63), NOTE(63), 0.6, { type: 'sawtooth', gain: 0.04, lp: 1200 }); this.tone(t, 70, 45, 0.5, { gain: 0.25 }); break;
        case 'suspicious': this.mallet(t, NOTE(76), 0.035, null, 0.5); this.mallet(t + 0.1, NOTE(77), 0.03, null, 0.5); break;
        case 'takedown': this.nz(t, 0.18, { freq: 260, type: 'lowpass', gain: 0.35 }); this.tone(t, 85, 50, 0.18, { gain: 0.25 }); break;
        case 'slash': this.nz(t, 0.1, { freq: 4800, q: 1.2, gain: 0.08, type: 'highpass', attack: 0.02 }); break;
        case 'hit': this.nz(t, 0.06, { freq: o.armor ? 2600 : 380, q: 1, gain: 0.2 }); break;
        case 'hurt': this.tone(t, 170, 95, 0.16, { type: 'triangle', gain: 0.12 }); this.nz(t, 0.1, { freq: 280, type: 'lowpass', gain: 0.25 }); break;
        case 'pickup': this.mallet(t, NOTE(76), 0.06); this.mallet(t + 0.08, NOTE(83), 0.05); break;
        case 'levelup': [69, 74, 77, 81].forEach((n, i) => this.mallet(t + i * 0.11, NOTE(n), 0.06, null, 1.2)); break;
        case 'freed': this.mallet(t, NOTE(74), 0.06, null, 1.2); this.mallet(t + 0.12, NOTE(78), 0.05, null, 1.2); break;
        case 'saved': [74, 78, 81, 86].forEach((n, i) => this.mallet(t + i * 0.1, NOTE(n), 0.05, null, 1.4)); break;
        case 'bang': this.nz(t, 1.3, { freq: 700, type: 'lowpass', gain: 0.9, verb: 1 }); this.tone(t, 3600, 3500, 2.2, { gain: 0.035, attack: 0.25 }); break;
        case 'smoke': this.nz(t, 1.6, { freq: 2800, q: 0.5, gain: 0.1, type: 'highpass', attack: 0.15 }); break;
        case 'glass': for (let i = 0; i < 7; i++) this.nz(t + r() * 0.1, 0.06, { freq: 4000 + r() * 4000, q: 8, gain: 0.07 }); break;
        case 'throw': this.nz(t, 0.18, { freq: 900, q: 0.7, gain: 0.05, attack: 0.05 }); break;
        case 'ability': this.tone(t, 260, 780, 0.35, { gain: 0.06, verb: 0.5 }); break;
        case 'chatter': { const n = 3 + Math.floor(r() * 4); for (let i = 0; i < n; i++) this.nz(t + i * 0.11 + r() * 0.03, 0.08, { freq: 1100 + r() * 900, q: 8, gain: 0.035 * vol }); this.nz(t + n * 0.11 + 0.05, 0.12, { freq: 2500, q: 2, gain: 0.02 * vol }); break; }
      }
    } catch { }
  }

  // --- music ---
  padChord(t, ch, dur) {
    const c = this.ctx;
    for (const v of this.padVoices) { try { v.g.gain.setTargetAtTime(0.0001, t, 0.8); v.o.stop(t + 4); } catch { } }
    this.padVoices = [];
    const notes = [ch.root + 12, ...ch.tones.slice(0, 3)];
    for (const n of notes) for (const det of [-6, 6]) {
      const o = c.createOscillator(); o.type = n < 50 ? 'triangle' : 'sawtooth'; o.frequency.value = NOTE(n); o.detune.value = det;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(n < 50 ? 0.05 : 0.018, t + 2.2);
      o.connect(g); g.connect(this.padLP); o.start(t);
      this.padVoices.push({ o, g });
    }
  }
  update(dt, level, nearGuards) {
    if (!this.ok) return;
    const c = this.ctx, now = c.currentTime;
    const target = this.mode === 'menu' ? 0.4 : level;
    this.intensity += (target - this.intensity) * Math.min(1, dt * 1.2);
    const I = this.intensity;
    this.padBus.gain.setTargetAtTime(this.mode === 'menu' ? 0.9 : 0.75 + I * 0.08, now, 0.6);
    this.padLP.frequency.setTargetAtTime(700 + I * 450, now, 0.8);
    this.wind.g.gain.setTargetAtTime(this.mode === 'menu' ? 0.02 : 0.012, now, 1);
    const bpm = this.mode === 'menu' ? 72 : 78 + I * 16;
    const s16 = 60 / bpm / 4;
    if (this.nextT < now) this.nextT = now + 0.05;
    while (this.nextT < now + 0.2) {
      const t = this.nextT, s = this.step16 % 128;
      if (s % 32 === 0) { this.chord = (this.step16 / 32 | 0) % PROG.length; this.padChord(t, PROG[this.chord], 32 * s16); }
      const ch = PROG[this.chord];
      // sparse delayed plucks (stealth motif)
      if (s % 4 === 0 && Math.random() < (this.mode === 'menu' ? 0.32 : 0.22 - I * 0.04)) {
        const n = ch.tones[Math.floor(Math.random() * ch.tones.length)] + (Math.random() < 0.3 ? 12 : 0);
        this.mallet(t, NOTE(n), 0.035, this.delayIn, 1.4);
        this.mallet(t, NOTE(n), 0.02, this.music, 1.4);
      }
      if (this.mode !== 'menu') {
        // heartbeat sub pulse when suspicious+
        if (I > 0.6 && (s % 16 === 0 || s % 16 === 3)) this.tone(t, NOTE(ch.root), NOTE(ch.root) * 0.97, 0.35, { gain: 0.11 * Math.min(1, I / 1.5), dest: this.music, lp: 200 });
        // ticking hats while searching
        if (I > 1.5 && s % 2 === 0) this.nz(t, 0.03, { freq: 8000, q: 1, type: 'highpass', gain: 0.012 + (s % 4 === 0 ? 0.01 : 0), dest: this.music });
        // combat drums & ostinato
        if (I > 2.4) {
          if (s % 8 === 0) { this.tone(t, 110, 48, 0.3, { gain: 0.22, dest: this.music }); this.nz(t, 0.12, { freq: 180, type: 'lowpass', gain: 0.15, dest: this.music }); }
          if (s % 8 === 4) this.nz(t, 0.15, { freq: 1800, q: 0.8, gain: 0.07, dest: this.music });
          if (s % 2 === 0) this.tone(t, NOTE(ch.root + 12), NOTE(ch.root + 12), s16 * 1.6, { type: 'sawtooth', gain: 0.035, dest: this.music, lp: 600 });
        }
      }
      this.nextT += s16; this.step16++;
    }
    this.chatterT -= dt;
    if (this.chatterT <= 0) { this.chatterT = 7 + Math.random() * 10 - I * 2; if (this.mode !== 'menu' && nearGuards > 0) this.play('chatter', { vol: Math.min(1, 0.3 + nearGuards * 0.2) }); }
  }
}
