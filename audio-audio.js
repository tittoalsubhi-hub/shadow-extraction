// Procedural WebAudio: weapons, footsteps, radio chatter, alerts and adaptive music.
// Every call is safe when audio is unavailable or blocked.
export class Audio {
  constructor() {
    this.ctx = null; this.ok = false; this.intensity = 0; this.musicVol = 0.5; this.sfxVol = 0.8;
    this.nextBeat = 0; this.beat = 0; this.chatterT = 3;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { }); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(c.destination);
      this.comp = c.createDynamicsCompressor(); this.comp.connect(this.master);
      this.sfx = c.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.comp);
      this.music = c.createGain(); this.music.gain.value = this.musicVol * 0.5; this.music.connect(this.comp);
      // noise buffer
      const len = c.sampleRate * 1.5;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // ambient drone
      this.drone = [];
      for (const [f, t] of [[55, 'sawtooth'], [82.4, 'sine'], [110.3, 'triangle']]) {
        const o = c.createOscillator(); o.type = t; o.frequency.value = f;
        const g = c.createGain(); g.gain.value = 0;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
        o.connect(lp); lp.connect(g); g.connect(this.music); o.start();
        this.drone.push({ o, g, lp });
      }
      this.lfo = c.createOscillator(); this.lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 120; this.lfo.connect(lg); lg.connect(this.drone[0].lp.frequency); this.lfo.start();
      this.ok = true;
      if (c.state === 'suspended') c.resume().catch(() => { });
    } catch (e) { this.ok = false; }
  }
  setVolumes(music, sfx) { this.musicVol = music; this.sfxVol = sfx; if (this.ok) { this.sfx.gain.value = sfx; this.music.gain.value = music * 0.5; } }
  suspend() { if (this.ok) this.ctx.suspend().catch(() => { }); }
  resume() { if (this.ok) this.ctx.resume().catch(() => { }); }

  nz(t, dur, { freq = 1000, q = 1, type = 'bandpass', gain = 0.5, attack = 0.002, decay = null, dest = null, rate = 1 } = {}) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rate;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + (decay ?? dur));
    s.connect(f); f.connect(g); g.connect(dest || this.sfx);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    return f;
  }
  tone(t, f0, f1, dur, { type = 'sine', gain = 0.3, dest = null, attack = 0.005 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  play(name, o = {}) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime + 0.005;
    const vol = o.vol ?? 1;
    try {
      switch (name) {
        case 'gun': if (o.suppressed) { this.nz(t, 0.09, { freq: 1800, q: 0.8, gain: 0.35 * vol }); this.tone(t, 300, 120, 0.06, { type: 'triangle', gain: 0.12 * vol }); }
          else { this.nz(t, 0.35, { freq: 900, q: 0.4, type: 'lowpass', gain: 0.9 * vol, decay: 0.3 }); this.tone(t, 140, 40, 0.2, { type: 'sine', gain: 0.6 * vol }); this.nz(t + 0.02, 0.6, { freq: 400, q: 0.5, type: 'lowpass', gain: 0.15 * vol }); }
          break;
        case 'enemygun': this.nz(t, 0.3, { freq: 700, q: 0.4, type: 'lowpass', gain: 0.55 * vol, decay: 0.25 }); this.tone(t, 120, 45, 0.15, { gain: 0.35 * vol }); break;
        case 'dry': this.tone(t, 1800, 1500, 0.03, { type: 'square', gain: 0.08 }); break;
        case 'reload': this.nz(t, 0.05, { freq: 3000, q: 3, gain: 0.2 }); this.nz(t + 0.18, 0.05, { freq: 2400, q: 3, gain: 0.2 }); break;
        case 'reloaded': this.nz(t, 0.06, { freq: 2000, q: 2, gain: 0.25 }); break;
        case 'step': {
          if (o.surface === 1) { for (let i = 0; i < 4; i++) this.tone(t + i * 0.015, 4000 + Math.random() * 3000, 3000, 0.05, { type: 'triangle', gain: 0.06 }); }
          else if (o.surface === 2) this.tone(t, 380, 520, 0.18, { type: 'sawtooth', gain: 0.05 });
          this.nz(t, 0.07, { freq: o.crouch ? 500 : 800, q: 0.8, gain: o.crouch ? 0.05 : o.run ? 0.2 : 0.1, type: 'lowpass' });
          break;
        }
        case 'door': this.tone(t, o.quiet ? 180 : 220, o.quiet ? 160 : 140, o.quiet ? 0.25 : 0.4, { type: 'sawtooth', gain: o.quiet ? 0.02 : 0.05 }); this.nz(t, 0.08, { freq: 300, gain: 0.12, type: 'lowpass' }); break;
        case 'radio': { this.nz(t, 0.35, { freq: 1800, q: 6, gain: 0.25 }); this.tone(t, 1200, 1200, 0.06, { type: 'square', gain: 0.07 }); break; }
        case 'tick': this.tone(t, o.last ? 1320 : 880, o.last ? 1320 : 880, 0.07, { type: 'square', gain: 0.1 }); break;
        case 'reportdone': this.nz(t, 0.6, { freq: 1500, q: 4, gain: 0.3 }); this.tone(t, 660, 440, 0.5, { type: 'square', gain: 0.12 }); this.tone(t + 0.18, 440, 330, 0.5, { type: 'square', gain: 0.12 }); break;
        case 'interrupt': this.nz(t, 0.15, { freq: 2500, q: 5, gain: 0.25 }); this.tone(t, 900, 200, 0.2, { type: 'sawtooth', gain: 0.06 }); break;
        case 'alert': this.tone(t, 520, 520, 0.25, { type: 'square', gain: 0.1 }); this.tone(t, 554, 554, 0.25, { type: 'square', gain: 0.08 }); this.tone(t + 0.12, 740, 740, 0.3, { type: 'sawtooth', gain: 0.07 }); break;
        case 'suspicious': this.tone(t, 330, 440, 0.18, { type: 'triangle', gain: 0.07 }); break;
        case 'takedown': this.nz(t, 0.2, { freq: 200, type: 'lowpass', gain: 0.4 }); this.tone(t, 90, 50, 0.2, { gain: 0.3 }); break;
        case 'slash': this.nz(t, 0.12, { freq: 5000, q: 1, gain: 0.15, type: 'highpass' }); break;
        case 'hit': this.nz(t, 0.08, { freq: o.armor ? 2500 : 400, q: 1, gain: 0.25 }); break;
        case 'hurt': this.tone(t, 160, 90, 0.18, { type: 'sawtooth', gain: 0.15 }); this.nz(t, 0.1, { freq: 300, type: 'lowpass', gain: 0.3 }); break;
        case 'pickup': this.tone(t, 660, 660, 0.08, { type: 'triangle', gain: 0.12 }); this.tone(t + 0.08, 990, 990, 0.12, { type: 'triangle', gain: 0.12 }); break;
        case 'levelup': [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.09, f, f, 0.25, { type: 'triangle', gain: 0.12 })); break;
        case 'freed': this.tone(t, 440, 660, 0.3, { type: 'sine', gain: 0.12 }); break;
        case 'saved': [587, 740, 880].forEach((f, i) => this.tone(t + i * 0.1, f, f, 0.3, { type: 'sine', gain: 0.12 })); break;
        case 'bang': this.nz(t, 1.4, { freq: 600, type: 'lowpass', gain: 1.0, decay: 1.2 }); this.tone(t, 3800, 3600, 2.5, { type: 'sine', gain: 0.05, attack: 0.3 }); break;
        case 'smoke': this.nz(t, 1.5, { freq: 3000, q: 0.5, gain: 0.15, type: 'highpass', attack: 0.1 }); break;
        case 'glass': for (let i = 0; i < 6; i++) this.tone(t + i * 0.02, 3000 + Math.random() * 4000, 2500, 0.12, { type: 'triangle', gain: 0.08 }); break;
        case 'click': this.tone(t, 1200, 1100, 0.03, { type: 'square', gain: 0.06 }); break;
        case 'ui': this.tone(t, 700, 900, 0.05, { type: 'triangle', gain: 0.06 }); break;
        case 'throw': this.nz(t, 0.15, { freq: 1200, q: 0.6, gain: 0.08 }); break;
        case 'ability': this.tone(t, 300, 900, 0.3, { type: 'sine', gain: 0.1 }); break;
        case 'chatter': { for (let i = 0; i < 3 + Math.random() * 3; i++) this.nz(t + i * 0.12, 0.1, { freq: 1200 + Math.random() * 800, q: 7, gain: 0.05 * vol }); this.tone(t, 1000, 1000, 0.04, { type: 'square', gain: 0.03 * vol }); break; }
      }
    } catch { }
  }
  // music intensity: 0 calm, 1 suspicious, 2 searching, 3 combat
  update(dt, level, nearGuards) {
    if (!this.ok) return;
    const c = this.ctx;
    const target = level;
    this.intensity += (target - this.intensity) * Math.min(1, dt * 1.5);
    const I = this.intensity;
    const t = c.currentTime;
    this.drone[0].g.gain.setTargetAtTime(0.05 + I * 0.03, t, 0.4);
    this.drone[1].g.gain.setTargetAtTime(0.06, t, 0.4);
    this.drone[2].g.gain.setTargetAtTime(I > 1.5 ? 0.05 : 0.015, t, 0.4);
    this.drone[2].o.frequency.setTargetAtTime(I > 2.5 ? 116.5 : 110.3, t, 0.5);
    // rhythmic layer
    const bpm = 60 + I * 28;
    if (this.nextBeat < t) this.nextBeat = t + 0.05;
    while (this.nextBeat < t + 0.15) {
      const bt = this.nextBeat;
      const b = this.beat++;
      if (I > 0.6 && b % 2 === 0) this.tone(bt, 55, 40, 0.25, { type: 'sine', gain: 0.12 * Math.min(1, I / 2), dest: this.music });
      if (I > 1.5 && b % 2 === 1) this.nz(bt, 0.06, { freq: 7000, q: 1, gain: 0.04, type: 'highpass', dest: this.music });
      if (I > 2.4) { if (b % 4 === 0) this.nz(bt, 0.2, { freq: 150, type: 'lowpass', gain: 0.35, dest: this.music }); if (b % 8 === 3 || b % 8 === 6) this.tone(bt, 82, 82, 0.2, { type: 'sawtooth', gain: 0.06, dest: this.music }); }
      this.nextBeat += 60 / bpm / 2;
    }
    // radio chatter from nearby guards
    this.chatterT -= dt;
    if (this.chatterT <= 0) { this.chatterT = 6 + Math.random() * 10 - I * 2; if (nearGuards > 0) this.play('chatter', { vol: Math.min(1, 0.3 + nearGuards * 0.2) }); }
  }
}
