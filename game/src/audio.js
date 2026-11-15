// All sounds are synthesized with WebAudio: no audio files, no network. Every
// effect is a short oscillator or filtered-noise burst; the context is created lazily
// on the first user gesture (or the first call in headless mode) and never throws.
export function createAudio() {
  let ctx = null;
  let noiseBuf = null;
  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const len = Math.floor(ctx.sampleRate * 0.25);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
    return ctx;
  }
  function burst(freq, dur, gain, type = 'square') {
    const c = ensure();
    if (!c) return;
    try {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.3), c.currentTime + dur);
      g.gain.setValueAtTime(gain, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      osc.connect(g).connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + dur);
    } catch { /* audio is cosmetic */ }
  }
  function noise(dur, gain, cutoff) {
    const c = ensure();
    if (!c || !noiseBuf) return;
    try {
      const src = c.createBufferSource();
      src.buffer = noiseBuf;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      src.connect(filter).connect(g).connect(c.destination);
      src.start();
      src.stop(c.currentTime + dur);
    } catch { /* audio is cosmetic */ }
  }
  return {
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'sniper') { noise(0.22, 0.5, 900); burst(90, 0.18, 0.35); }
      else if (kind === 'shotgun') { noise(0.2, 0.45, 1200); burst(110, 0.14, 0.3); }
      else if (kind === 'smg') { noise(0.08, 0.3, 2400); burst(180, 0.06, 0.2); }
      else { noise(0.12, 0.4, 1800); burst(140, 0.09, 0.25); }
    },
    dry() { burst(1200, 0.04, 0.12, 'sine'); },
    reload() { burst(700, 0.05, 0.15, 'sine'); setTimeout(() => burst(500, 0.05, 0.15, 'sine'), 180); },
    hit() { burst(1900, 0.05, 0.18, 'sine'); },
    kill() { burst(1400, 0.07, 0.2, 'sine'); setTimeout(() => burst(2100, 0.08, 0.2, 'sine'), 70); },
    hurt() { burst(220, 0.15, 0.3, 'sawtooth'); },
    plant() { burst(880, 0.12, 0.2, 'sine'); },
    beep() { burst(1200, 0.09, 0.18, 'sine'); },
    boom() { noise(0.7, 0.6, 500); burst(55, 0.6, 0.5, 'sine'); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => burst(f, 0.16, 0.2, 'sine'), i * 110)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => burst(f, 0.18, 0.2, 'sine'), i * 120)); },
  };
}
