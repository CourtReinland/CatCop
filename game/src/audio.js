// Audio: sampled SFX through WebAudio (low latency, unlike cloned <audio>
// elements) plus a fully synthesised eerie score whose tension follows the
// gameplay, and best-effort haptics.

import { ASSETS } from './config.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.buffers = new Map();
    this.lastPlayed = new Map();
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.tension = 0;
    this.targetTension = 0;
    this.muted = false;
    this.voices = [];
    this.pingTimer = 0;
    this.heartPhase = 0;
    this.hapticProxy = this.#createHapticProxy();
  }

  #createHapticProxy() {
    // iOS Safari has no Vibration API, but toggling a <input switch> plays the
    // system haptic. Harmless everywhere else.
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.setAttribute('switch', '');
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed', width: '1px', height: '1px',
      opacity: '0', pointerEvents: 'none', left: '-10px'
    });
    document.body.append(el);
    return el;
  }

  /** Must be called from inside a user gesture. */
  async unlock() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    await this.ctx.resume().catch(() => {});

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1.0;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.0;
    this.musicBus.connect(this.master);

    this.ready = true;
    this.#buildScore();
    this.#loadAll();
  }

  #loadAll() {
    const keys = ['shot', 'impact', 'warning', 'lockBeep', 'playerHurt', 'scareSting', 'grunt1', 'grunt2', 'grunt3'];
    keys.forEach((key) => {
      fetch(ASSETS[key])
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((data) => this.ctx.decodeAudioData(data))
        .then((buffer) => this.buffers.set(key, buffer))
        .catch(() => { /* synthesised fallbacks cover anything that fails */ });
    });
  }

  // --- Sampled SFX ----------------------------------------------------------
  play(key, volume = 0.6, minGap = 0.02, rate = 1) {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    if ((this.lastPlayed.get(key) || -1) + minGap > now) return;
    this.lastPlayed.set(key, now);
    const buffer = this.buffers.get(key);
    if (!buffer) return this.#synthFallback(key, volume);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.sfxBus);
    source.start();
  }

  playVariation(keys, volume = 0.6, minGap = 0.06) {
    const pool = keys.filter((k) => this.buffers.has(k));
    const key = pool.length ? pool[(Math.random() * pool.length) | 0] : keys[0];
    this.play(key, volume, minGap, 0.86 + Math.random() * 0.3);
  }

  #synthFallback(key, volume) {
    if (key === 'lockBeep') return this.beep(1180, 0.05, volume * 0.35);
    if (key === 'warning') return this.beep(420, 0.16, volume * 0.3, 'square');
    if (key === 'shot') return this.noiseBurst(0.07, volume * 0.5, 2400);
    if (key === 'impact') return this.noiseBurst(0.14, volume * 0.5, 900);
  }

  beep(freq, duration = 0.06, volume = 0.25, type = 'sine') {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  noiseBurst(duration = 0.1, volume = 0.3, cutoff = 1600) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(this.sfxBus);
    source.start(t);
  }

  /** Rising dread riser used when a stand is about to start. */
  riser(duration = 1.4, volume = 0.22) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, t);
    osc.frequency.exponentialRampToValueAtTime(320, t + duration);
    filter.type = 'bandpass';
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(180, t);
    filter.frequency.exponentialRampToValueAtTime(1800, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + duration * 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration + 0.25);
    osc.connect(filter).connect(gain).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + duration + 0.3);
  }

  /** Short dissonant stab layered under the sampled scare sting. */
  stab(volume = 0.3) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    [138.6, 146.8, 207.6].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = i === 2 ? 'sawtooth' : 'triangle';
      osc.frequency.value = freq * (1 + (Math.random() - 0.5) * 0.01);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume / 3, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(gain).connect(this.sfxBus);
      osc.start(t);
      osc.stop(t + 1.0);
    });
    this.noiseBurst(0.5, volume * 0.5, 600);
  }

  // --- Synthesised eerie score ---------------------------------------------
  #buildScore() {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Slow, detuned drone bed.
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 380;
    this.droneFilter.Q.value = 3;
    this.droneFilter.connect(this.musicBus);

    // D minor-ish cluster; the minor second (Eb) is what makes it uneasy.
    [36.7, 55.0, 58.3, 73.4].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i % 2 ? 'triangle' : 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = (Math.random() - 0.5) * 14;
      gain.gain.value = i === 2 ? 0.06 : 0.16;
      osc.connect(gain).connect(this.droneFilter);
      osc.start(t);
      this.voices.push(osc);
      // Slow amplitude drift so the pad breathes.
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.03 + Math.random() * 0.06;
      lfoGain.gain.value = gain.gain.value * 0.6;
      lfo.connect(lfoGain).connect(gain.gain);
      lfo.start(t);
      this.voices.push(lfo);
    });

    // Air / room noise.
    const noiseFrames = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, noiseFrames, ctx.sampleRate);
    const nd = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseFrames; i++) nd[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 700;
    this.noiseFilter.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.05;
    noise.connect(this.noiseFilter).connect(noiseGain).connect(this.musicBus);
    noise.start(t);
    this.voices.push(noise);

    this.musicBus.gain.setValueAtTime(0, t);
    this.musicBus.gain.linearRampToValueAtTime(0.55, t + 4);
  }

  /** Low thud that doubles as the score's pulse. */
  heartbeat(volume = 0.5) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(72, t);
    osc.frequency.exponentialRampToValueAtTime(34, t + 0.22);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 0.34);
  }

  /** 0 = calm room tone, 1 = everything is very close and very wrong. */
  setTension(value) {
    this.targetTension = Math.max(0, Math.min(1, value));
  }

  update(dt) {
    if (!this.ready) return;
    this.tension += (this.targetTension - this.tension) * Math.min(1, dt * 1.2);
    const t = this.tension;
    if (this.droneFilter) this.droneFilter.frequency.value = 300 + t * 900;
    if (this.noiseFilter) this.noiseFilter.frequency.value = 600 + t * 1500;

    // Heartbeat: 42bpm at rest up to ~120bpm when they are on top of you.
    const bpm = 42 + t * 78;
    this.heartPhase += dt * (bpm / 60);
    if (this.heartPhase >= 1) {
      this.heartPhase -= 1;
      this.heartbeat(0.12 + t * 0.4);
      if (t > 0.25) setTimeout(() => this.heartbeat(0.08 + t * 0.22), 190);
    }

    // Sparse metallic pings in the distance.
    this.pingTimer -= dt;
    if (this.pingTimer <= 0) {
      this.pingTimer = 3.5 + Math.random() * 7 - t * 2;
      if (!this.muted && this.ready) {
        const freq = 620 + Math.random() * 1500;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        filter.type = 'bandpass';
        filter.frequency.value = freq;
        filter.Q.value = 12;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.05 + t * 0.05, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
        osc.connect(filter).connect(gain).connect(this.musicBus);
        osc.start(now);
        osc.stop(now + 1.7);
      }
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.9;
  }

  // --- Haptics --------------------------------------------------------------
  pulse(pattern = 18) {
    if (navigator.vibrate) {
      try { if (navigator.vibrate(pattern)) return true; } catch { /* ignore */ }
    }
    try { this.hapticProxy.click(); return true; } catch { return false; }
  }

  hitPulse(strong = false) { return this.pulse(strong ? [26, 22, 48] : 14); }
  hurtPulse(strong = false) { return this.pulse(strong ? [70, 34, 90] : [36, 20, 50]); }
  scarePulse() { return this.pulse([12, 40, 26, 30, 60]); }
}
