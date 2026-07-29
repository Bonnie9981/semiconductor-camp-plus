import type { InstructionStep, StageContext, StageFrame, StageResult } from '../core/types';

/**
 * BaseStage —— 所有關卡的抽象基底。
 * ---------------------------------------------------------------------------
 * 一個關卡只需要回答四件事：
 *   1. 我是誰？（metadata：標題、提示、操作說明、主要按鈕文字）
 *   2. 每一幀要畫什麼、要判斷什麼？（onFrame）
 *   3. 什麼時候算過關？（canComplete）
 *   4. 按下主要按鈕時要交出什麼結果？（buildResult）
 *
 * StageManager 只依賴這個介面，因此新增關卡完全不需要改動 StageManager 或 main.ts
 * 以外的任何檔案（見 README「擴充開發指南」）。
 */
export abstract class BaseStage {
  /** 存進 results 的 key，例如 'mask-pattern'。 */
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
  /** 右側主要行動按鈕的文字，例如「完成繪製」。 */
  abstract readonly primaryLabel: string;

  /** 這一關是否需要下方虛擬桌面（晶圓 / Chuck）。 */
  readonly usesDesk: boolean = true;
  /** 這一關是否需要下方 HUD（已繪製圖形 / 畫筆顏色）。 */
  readonly usesPenTools: boolean = false;

  protected ctx!: StageContext;

  /** 進入關卡時呼叫一次。覆寫時記得 `super.onEnter(ctx)`。 */
  onEnter(ctx: StageContext): void {
    this.ctx = ctx;
  }

  /** 離開關卡時呼叫一次（切換關卡或重置）。 */
  onExit(): void {}

  /** 每一幀呼叫（rAF）。在這裡處理手勢、畫 AR 內容、更新 UI 提示。 */
  onFrame(_frame: StageFrame): void {}

  /** 主要按鈕是否可按（例如「圖形畫得夠多了」）。 */
  canComplete(): boolean {
    return true;
  }

  /** 按下主要按鈕、且 canComplete() 為 true 時呼叫，回傳要保存的結果。 */
  buildResult(): StageResult {
    return {};
  }

  /** 重玩本關（結算失敗後按「重新開始本關」）。 */
  restart(): void {}
}
