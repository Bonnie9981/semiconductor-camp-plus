import type {
  InstructionStep,
  StageContext,
  StageFrame,
  StageResult,
  SubStep,
} from '../core/types';

/**
 * BaseStage —— 所有關卡的抽象基底。
 * ---------------------------------------------------------------------------
 * 一個關卡只需要回答四件事：
 *   1. 我是誰？（metadata：標題、提示、操作說明、主要按鈕文字）
 *   2. 每一幀要畫什麼、要判斷什麼？（onFrame）
 *   3. 什麼時候算過關？（canComplete）
 *   4. 按下主要按鈕時要交出什麼結果？（buildResult）
 *
 * 子步驟（SubStep）
 * ---------------------------------------------------------------------------
 * 製程關卡通常不是一個動作就結束，例如 RCA 要依序做「去微粒 → 去氧化層 →
 * 去離子 → 乾燥」。這種關卡只要宣告 `substeps`，就能用 `goToSub()` /
 * `nextSub()` 推進，UI 會自動顯示子步驟進度列。子步驟全部走完之前
 * `canComplete()` 預設為 false，所以玩家不可能跳過中間的步驟。
 *
 * StageManager 只依賴這個介面，因此新增關卡完全不需要改動 StageManager 或 main.ts
 * 以外的任何檔案（見 README「擴充開發指南」）。
 */
export abstract class BaseStage {
  /** 存進 results 的 key，例如 'rca-clean'。 */
  abstract readonly id: string;
  /** 關卡標題，顯示在左側步驟列與右側面板。 */
  abstract readonly title: string;
  /** 短標題，顯示在 LIVE 標籤與底部流程列。 */
  abstract readonly shortTitle: string;
  /** 一句話說明，顯示在右側面板標題下方。 */
  abstract readonly description: string;
  /** 左下角「遊玩提示」文字。 */
  abstract readonly hint: string;
  /** 右側「操作說明」的步驟圖解。 */
  abstract readonly instructions: InstructionStep[];
  /** 右側主要行動按鈕的文字，例如「完成清洗」。 */
  abstract readonly primaryLabel: string;

  /** 關卡內的子步驟；空陣列代表這一關是單一步驟。 */
  readonly substeps: readonly SubStep[] = [];

  /** 這一關是否需要下方虛擬桌面預設的晶圓（自行畫場景的關卡設 false）。 */
  readonly usesDesk: boolean = true;
  /** 這一關是否需要下方 HUD（已繪製圖形 / 畫筆顏色）。 */
  readonly usesPenTools: boolean = false;
  /** 這一關是否要顯示晶圓截面圖 HUD。 */
  readonly usesCrossSection: boolean = false;

  protected ctx!: StageContext;

  /** 目前子步驟索引。 */
  private sub = 0;

  // ─────────────────────────────── 子步驟 ─────────────────────────────────

  get subIndex(): number {
    return this.sub;
  }

  get subCount(): number {
    return this.substeps.length;
  }

  get currentSub(): SubStep | null {
    return this.substeps[this.sub] ?? null;
  }

  /** 是否已經走完最後一個子步驟（無子步驟的關卡恆為 true）。 */
  get subsFinished(): boolean {
    return this.subCount === 0 || this.sub >= this.subCount;
  }

  /**
   * 跳到指定子步驟。索引等於 subCount 代表「全部做完」，這是合法值，
   * canComplete() 會據此解鎖主要按鈕。
   */
  protected goToSub(index: number): void {
    const next = Math.max(0, Math.min(index, this.subCount));
    if (next === this.sub) return;
    this.sub = next;
    this.onSubEnter(next);
    this.ctx?.stages.notifySubChange();
  }

  /** 前進到下一個子步驟。 */
  protected nextSub(): void {
    this.goToSub(this.sub + 1);
  }

  /** 子步驟切換時呼叫（含 onEnter 時的第 0 步）。在這裡重設該步的狀態與面板。 */
  protected onSubEnter(_index: number): void {}

  /** 把子步驟指標歸零，不觸發 onSubEnter（restart / onEnter 內部使用）。 */
  protected resetSub(): void {
    this.sub = 0;
  }

  // ─────────────────────────────── 生命週期 ───────────────────────────────

  /** 進入關卡時呼叫一次。覆寫時記得 `super.onEnter(ctx)`。 */
  onEnter(ctx: StageContext): void {
    this.ctx = ctx;
  }

  /** 離開關卡時呼叫一次（切換關卡或重置）。 */
  onExit(): void {}

  /** 每一幀呼叫（rAF）。在這裡處理手勢、畫 AR 內容、更新 UI 提示。 */
  onFrame(_frame: StageFrame): void {}

  /** 主要按鈕是否可按。預設為「所有子步驟都走完」。 */
  canComplete(): boolean {
    return this.subsFinished;
  }

  /** 按下主要按鈕、且 canComplete() 為 true 時呼叫，回傳要保存的結果。 */
  buildResult(): StageResult {
    return {};
  }

  /** 重玩本關（結算失敗後按「重新開始本關」）。覆寫時記得 `super.restart()`。 */
  restart(): void {
    this.resetSub();
  }

  /**
   * 開發者模式的「強制完成本關」。
   *
   * 只是跳過 canComplete() 的話，這一關對晶圓該做的事並沒有發生——
   * 例如強制完成沉積卻沒長出金屬層，後面的蝕刻就沒東西可蝕，
   * 最後的證書與 STL 也會拿到一片空白的晶圓。
   * 所以每一關要在這裡把「這關的產物」直接補上，測試整條流程才有意義。
   *
   * 預設不做任何事（沒有下游相依的關卡不必覆寫）。
   */
  devComplete(): void {}
}
