type Note = { freq: number; dur: number; vel: number };

function midiToFreq(m: number) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// escala pentatónica menor (relativa a tónica)
const PENT_MINOR = [0, 3, 5, 7, 10];

function pickFromScale(rootMidi: number, step: number) {
  const oct = Math.floor(step / PENT_MINOR.length);
  const deg = PENT_MINOR[((step % PENT_MINOR.length) + PENT_MINOR.length) % PENT_MINOR.length];
  return rootMidi + deg + oct * 12;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  private reverb!: Convolver;

  private startedAt = 0;

  async init() {
    if (this.ctx) return;

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AudioCtx();

    // cadena master
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;

    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.2;

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeImpulseResponse(this.ctx, 1.6, 2.0);

    const revSend = this.ctx.createGain();
    revSend.gain.value = 0.18;

    // routing: (instruments) -> master -> comp -> destination
    // + send -> reverb -> comp
    this.master.connect(this.comp);
    this.comp.connect(this.ctx.destination);

    revSend.connect(this.reverb);
    this.reverb.connect(this.comp);

    // guardamos el send en el master para usarlo desde instrumentos
    // (lo attachamos como propiedad no tipada)
    (this.master as any)._revSend = revSend;

    this.startedAt = this.ctx.currentTime;

    // iOS: asegurar running
    if (this.ctx.state !== "running") {
      await this.ctx.resume();
    }
  }

  // --- API de pruebas (después lo reemplazamos por zonas) ---
  playPad() {
    this.ensure();
    const now = this.ctx!.currentTime;
    const root = 48; // C2-ish
    const step = Math.floor(Math.random() * 10);
    const m = pickFromScale(root, step);
    this.pad({ freq: midiToFreq(m), dur: 1.2, vel: 0.7 }, now);
  }

  playEPiano() {
    this.ensure();
    const now = this.ctx!.currentTime;
    const root = 60; // C4
    const step = Math.floor(Math.random() * 12);
    const m = pickFromScale(root, step);
    this.epiano({ freq: midiToFreq(m), dur: 0.35, vel: 0.9 }, now);
  }

  playClick() {
    this.ensure();
    const now = this.ctx!.currentTime;
    this.click(0.15, now);
  }

  // --- instrumentos ---
  private pad(n: Note, t0: number) {
    const ctx = this.ctx!;
    const out = this.ctx!.createGain();
    out.gain.value = 0;

    // osciladores
    const o1 = ctx.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.value = n.freq;

    const o2 = ctx.createOscillator();
    o2.type = "triangle";
    o2.frequency.value = n.freq * 0.5;

    // filtro
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 900;
    f.Q.value = 0.6;

    // envelope
    const a = 0.02, d = 0.35, s = 0.55, r = 0.55;
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0002, n.vel), t0 + a);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0002, n.vel * s), t0 + a + d);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur + r);

    // routing
    o1.connect(f);
    o2.connect(f);
    f.connect(out);

    out.connect(this.master);
    (this.master as any)._revSend && out.connect((this.master as any)._revSend);

    o1.start(t0);
    o2.start(t0);
    o1.stop(t0 + n.dur + r + 0.1);
    o2.stop(t0 + n.dur + r + 0.1);
  }

  private epiano(n: Note, t0: number) {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;

    // “e-piano” simple: sine + un poco de FM
    const carrier = ctx.createOscillator();
    carrier.type = "sine";
    carrier.frequency.value = n.freq;

    const mod = ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.value = n.freq * 2;

    const modGain = ctx.createGain();
    modGain.gain.value = n.freq * 0.015;

    mod.connect(modGain);
    modGain.connect((carrier as any).frequency);

    // filtro suave
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 2200;
    f.Q.value = 0.7;

    // envelope rápido
    const a = 0.005, d = 0.09, s = 0.18, r = 0.12;
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0002, n.vel), t0 + a);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0002, n.vel * s), t0 + a + d);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur + r);

    carrier.connect(f);
    f.connect(out);

    out.connect(this.master);
    (this.master as any)._revSend && out.connect((this.master as any)._revSend);

    mod.start(t0);
    carrier.start(t0);
    carrier.stop(t0 + n.dur + r + 0.05);
    mod.stop(t0 + n.dur + r + 0.05);
  }

  private click(level: number, t0: number) {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;

    // ruido corto
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 1200;

    const a = 0.001, r = 0.05;
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t0 + a);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + r);

    src.connect(f);
    f.connect(out);
    out.connect(this.master);

    src.start(t0);
    src.stop(t0 + 0.07);
  }

  // impulse response simple para reverb
  private makeImpulseResponse(ctx: AudioContext, seconds: number, decay: number) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const impulse = ctx.createBuffer(2, length, rate);

    for (let ch = 0; ch < 2; ch++) {
      const channel = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return impulse;
  }

  private ensure() {
    if (!this.ctx) throw new Error("AudioEngine no inicializado. Llamá init() con gesto de usuario.");
  }
}
