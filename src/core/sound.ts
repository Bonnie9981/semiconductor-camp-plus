/**
 * 提示音
 * ---------------------------------------------------------------------------
 * 全部用 Web Audio 即時合成，沒有任何音檔資產 —— 離線可用、體積為零。
 * AudioContext 必須在使用者互動後才能出聲（瀏覽器的 autoplay 政策），
 * 所以第一次 play() 會嘗試 resume()，在那之前的呼叫安靜略過。
 *
 * 音色都刻意做得很短、很輕：pickup / drop 每次捏放都會響，太吵會煩。
 */

export type SoundName = 'pickup' | 'drop' | 'success' | 'complete' | 'error';

const STORAGE_KEY = 'semiconductor-camp:muted';

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export class Sound {
  private ctx: AudioContext | null = null;
  private muted = readMuted();

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    } catch {
      /* 存不進去也沒關係，這一輪還是生效 */
    }
  }

  /** 綁在第一個使用者互動上，把 AudioContext 從 suspended 叫醒。 */
  unlock(): void {
    this.ensureCtx()
      ?.resume()
      .catch(() => {});
  }

  play(name: SoundName): void {
    if (this.muted) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    // autoplay 政策：使用者互動前是 suspended，試著叫醒它，這一聲就先略過
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {});
      return;
    }
    const t = ctx.currentTime;

    switch (name) {
      case 'pickup':
        this.blip(ctx, t, 660, 0.05, 0.12);
        break;
      case 'drop':
        this.blip(ctx, t, 420, 0.06, 0.1);
        break;
      case 'success':
        this.arp(ctx, t, [523.25, 659.25, 783.99], 0.09, 0.14);
        break;
      case 'complete':
        this.arp(ctx, t, [523.25, 659.25, 783.99, 1046.5], 0.12, 0.16);
        break;
      case 'error':
        this.buzz(ctx, t);
        break;
    }
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    return this.ctx;
  }

  /** 單顆短音（帶指數衰減）。 */
  private blip(ctx: AudioContext, t: number, freq: number, dur: number, gain: number): void {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** 一串上行音（過關 / 全部完成）。 */
  private arp(ctx: AudioContext, t: number, freqs: number[], step: number, gain: number): void {
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const start = t + i * step;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + step * 1.8);
      osc.connect(g).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + step * 2);
    });
  }

  /** 低沉的錯誤音。 */
  private buzz(ctx: AudioContext, t: number): void {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.24);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }
}
