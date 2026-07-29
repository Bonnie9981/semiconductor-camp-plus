import type {
  InstructionStep,
  StageContext,
  StageFrame,
  StageResult,
  SubStep,
} from '../core/types';
import { BaseStage } from './BaseStage';

/**
 * StagePlaceholder —— 第 2~6 關的空樣板（Stub）
 * ---------------------------------------------------------------------------
 * 刻意「不寫死任何製程邏輯」，只提供：
 *   - 正確的 metadata（標題／提示／說明），讓 UI 框架能完整跑一遍六關流程
 *   - 一個 demo 用的主要按鈕（模擬完成），方便驗證關卡切換與解鎖
 *   - 手勢管線仍然是活的：畫面上會顯示捏合點，證明 Attach 機制與關卡無關
 *
 * 要實作某一關時，就把 main.ts 裡對應的 `new StagePlaceholder({...})`
 * 換成你自己的 `new Stage2Coating()`（步驟見 README）。
 */

export interface PlaceholderConfig {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  hint: string;
  /** 未來這一關預計要用的道具，只作為畫面提示。 */
  props?: string[];
  instructions?: InstructionStep[];
  /**
   * 這一關規劃中的子步驟。即使還沒實作也先填上，玩家就能從畫面上方的
   * 子步驟列看出整關會做哪些事，實作時也不用再重新設計流程。
   */
  substeps?: SubStep[];
}

export class StagePlaceholder extends BaseStage {
  readonly id: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly description: string;
  readonly hint: string;
  readonly instructions: InstructionStep[];
  readonly substeps: readonly SubStep[];
  readonly primaryLabel = '模擬完成（Demo）';
  readonly usesPenTools = false;

  private readonly props: string[];

  constructor(config: PlaceholderConfig) {
    super();
    this.id = config.id;
    this.title = config.title;
    this.shortTitle = config.shortTitle;
    this.description = config.description;
    this.hint = config.hint;
    this.props = config.props ?? [];
    this.substeps = config.substeps ?? [];
    this.instructions = config.instructions ?? [
      {
        glyph: '🚧',
        title: '此關卡尚未實作',
        desc: '目前只提供 UI 框架與關卡切換，製程邏輯留給後續開發。',
      },
      {
        glyph: '📄',
        title: '如何接手',
        desc: '建立 Stage2Coating.ts 繼承 BaseStage，於 main.ts 註冊即可取代本樣板。',
      },
      {
        glyph: '🤏',
        title: '手勢管線已就緒',
        desc: 'Pinch 判斷與座標映射由 GestureDetector 統一提供，各關卡直接沿用。',
      },
    ];
  }

  override onEnter(ctx: StageContext): void {
    super.onEnter(ctx);
    // 尚未實作的關卡不使用晶圓，桌面留空
    ctx.desk.setWaferVisible(false);
    ctx.ui.setPanel(null);
  }

  override onExit(): void {
    this.ctx?.desk.setWaferVisible(true);
  }

  override onFrame(frame: StageFrame): void {
    const { hand, ar, ui } = frame;

    if (!hand.present) {
      ui.setArHint(`🚧 ${this.title} — 此關卡尚未實作`);
      ui.setHandState('✋', '（未偵測到手）', 'NO HAND', false);
      return;
    }

    // 手勢管線與關卡實作完全解耦：即使是空關卡，Pinch 依然可用。
    const p = hand.pinchPoint;
    ar.save();
    ar.strokeStyle = hand.pinching ? '#5ee9df' : 'rgba(255,255,255,0.5)';
    ar.lineWidth = 2;
    ar.setLineDash(hand.pinching ? [] : [4, 4]);
    ar.beginPath();
    ar.arc(p.x, p.y, hand.pinching ? 18 : 13, 0, Math.PI * 2);
    ar.stroke();
    ar.restore();

    const propHint = this.props.length > 0 ? `（預計道具：${this.props.join('、')}）` : '';
    ui.setArHint(
      hand.pinching
        ? `🤏 已偵測到捏合 — ${this.title} 尚未實作${propHint}`
        : `🚧 ${this.title} — 此關卡尚未實作${propHint}`,
      hand.pinching,
    );
    ui.setHandState(
      hand.pinching ? '🤏' : '✋',
      hand.pinching ? '捏合中（尚無可抓取的道具）' : '（空手）',
      `PINCH ${hand.pinchDistance.toFixed(3)} / STUB`,
      hand.pinching,
    );
  }

  /** Demo：空關卡永遠可以按「模擬完成」，方便驗證整條解鎖流程。 */
  override canComplete(): boolean {
    return true;
  }

  override buildResult(): StageResult {
    return { simulated: true, stage: this.id };
  }
}
