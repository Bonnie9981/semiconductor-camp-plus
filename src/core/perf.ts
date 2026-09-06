/**
 * 效能模式
 * ---------------------------------------------------------------------------
 * 這個遊戲在低階筆電上最吃資源的是 MediaPipe Hands 的推論（full 模型）與
 * HiDPI 螢幕上 2× 的 canvas 解析度。這裡集中管理三種模式：
 *
 *   high —— full 手部模型、DPR 上限 2、每幀都推論
 *   lite —— lite 手部模型（快很多）、DPR 上限 1、隔幀推論、鏡頭改 640×480
 *   auto —— 先用 high，量到持續掉幀就自動切成 lite（並提示一次）
 *
 * 使用者的選擇存在 localStorage；`auto` 下的自動降級不寫入，重新整理會再判斷一次。
 */

export type PerfMode = 'auto' | 'high' | 'lite';

const STORAGE_KEY = 'semiconductor-camp:perf-mode';

/** 連續低於這個 FPS 一段時間，auto 模式就降級。 */
const SLOW_FPS = 40;
/** 需要持續慢多久（毫秒）才降級 —— 避免載入瞬間的尖峰誤判。 */
const SLOW_FOR_MS = 2500;

function readStored(): PerfMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'high' || v === 'lite' || v === 'auto') return v;
  } catch {
    /* 隱私視窗 / 存取被擋：當作 auto */
  }
  return 'auto';
}

export class PerfController {
  private mode: PerfMode = readStored();
  /** auto 模式下自動降級的旗標。 */
  private autoLite = false;
  /** onChange：有效品質（lite 與否）改變時呼叫，consumer 依此重設 DPR / 鏡頭。 */
  private readonly onChange: (lite: boolean) => void;

  /** EMA 平滑後的每幀毫秒數。 */
  private frameMs = 16.7;
  private slowSince: number | null = null;

  constructor(onChange: (lite: boolean) => void) {
    this.onChange = onChange;
  }

  getMode(): PerfMode {
    return this.mode;
  }

  /** 目前是否走精簡路線。 */
  get lite(): boolean {
    return this.mode === 'lite' || (this.mode === 'auto' && this.autoLite);
  }

  /** canvas 的 devicePixelRatio 上限。 */
  get dprCap(): number {
    return this.lite ? 1 : 2;
  }

  setMode(mode: PerfMode): void {
    if (mode === this.mode) return;
    const wasLite = this.lite;
    this.mode = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* 存不進去就算了，這一輪還是會生效 */
    }
    // 換成 auto 時把自動旗標歸零，重新觀察
    if (mode === 'auto') {
      this.autoLite = false;
      this.slowSince = null;
    }
    if (this.lite !== wasLite) this.onChange(this.lite);
  }

  /**
   * 每一幀呼叫一次，傳入這一幀花的毫秒數。
   * 只有 auto 模式且尚未降級時才會據此自動切成 lite。
   */
  sample(dtMs: number, now: number): void {
    // 分頁切走 / 中斷點會產生假的大 dt，忽略
    if (dtMs > 0 && dtMs < 500) {
      this.frameMs += (dtMs - this.frameMs) * 0.1;
    }
    if (this.mode !== 'auto' || this.autoLite) return;

    const slow = 1000 / this.frameMs < SLOW_FPS;
    if (!slow) {
      this.slowSince = null;
      return;
    }
    this.slowSince ??= now;
    if (now - this.slowSince >= SLOW_FOR_MS) {
      this.autoLite = true;
      this.onChange(true);
    }
  }

  /** 目前估計的 FPS（給設定畫面顯示用）。 */
  get fps(): number {
    return Math.round(1000 / this.frameMs);
  }

  /** auto 模式是否已經自動降級（用來提示使用者）。 */
  get autoDowngraded(): boolean {
    return this.mode === 'auto' && this.autoLite;
  }
}
