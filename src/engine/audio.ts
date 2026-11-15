// Zero-dependency procedural Web Audio synthesizer for planetary sculpting, building, water, and footsteps

export class SoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;
  private lastBrushTime = 0;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public playCarve(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastBrushTime < 85) return;
    this.lastBrushTime = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const baseFreq = 95 + (Math.random() - 0.5) * 28;
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.09);

    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.095);
  }

  public playBuild(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastBrushTime < 85) return;
    this.lastBrushTime = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const baseFreq = 260 + Math.random() * 90;
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, t + 0.075);

    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.085);
  }

  public playWater(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastBrushTime < 75) return;
    this.lastBrushTime = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const base = 420 + Math.random() * 260;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.45, t + 0.065);

    gain.gain.setValueAtTime(0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.075);
  }

  public playJump(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(340, t + 0.14);
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  }
}
