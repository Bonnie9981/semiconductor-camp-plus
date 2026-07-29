import { INDEX_TIP } from '../core/GestureDetector';
import type { InstructionStep, Point, StageContext, StageFrame, StageResult } from '../core/types';
import { BaseStage } from './BaseStage';

/**
 * 第一關：繪製光罩圖形（Mask Pattern）
 * ---------------------------------------------------------------------------
 * 這一關是後續所有關卡的「範本」。它示範了一套完整的 WebAR 互動循環：
 *
 *   MediaPipe landmarks
 *        └─▶ GestureDetector（鏡像映射 + Pinch 判斷 + 平滑）
 *              └─▶ Stage1.onFrame()
 *                    ├─ Attach：捏合時把「畫筆」吸附到 pinchPoint
 *                    ├─ 命中測試：pinchPoint 是否落在 VirtualDesk 的晶圓上
 *                    ├─ 作用：命中就在 Pattern 圖層上畫線
 *                    └─ 回饋：AR canvas 畫筆 + desk canvas 游標 + UI 文案
 *
 * 第 2~6 關要做的事一模一樣，只是把「畫筆」換成夾子／燒杯，把「畫線」換成
 * 倒液體／夾取／曝光。詳見 README 的擴充開發指南。
 *
 * 註：依規格，第一關**不做**正／負光阻切換，該機制留給後續關卡。
 */

/** 過關門檻：圖形至少要覆蓋晶圓面積的 0.8%。 */
const MIN_COVERAGE = 0.008;

export class Stage1DrawPattern extends BaseStage {
  readonly id = 'mask-pattern';
  readonly title = '繪製光罩圖形';
  readonly shortTitle = '光罩繪製';
  readonly description = '用捏合手勢把畫筆吸附到手上，在下方的晶圓上畫出你要曝光的光罩圖形。';
  readonly hint = '把手掌完整張開讓鏡頭看到，接著用拇指＋食指捏合，畫筆就會吸附到你的手上。';
  readonly primaryLabel = '完成繪製';
  readonly usesPenTools = true;

  readonly instructions: InstructionStep[] = [
    { glyph: '🖐️', title: '伸出手掌', desc: '讓整隻手進入鏡頭，畫面上會浮現青綠色骨架代表已鎖定。' },
    { glyph: '🤏', title: '捏合拇指與食指', desc: '距離小於門檻即判定 Pinch，畫筆會自動吸附（Attach）到捏合點。' },
    { glyph: '✍️', title: '移到晶圓上畫線', desc: '維持捏合並把筆尖移進下方桌面的晶圓範圍，就會留下線條。' },
    { glyph: '✅', title: '按下「完成繪製」', desc: '圖形覆蓋率足夠後按鈕會亮起，按下即可送出光罩並解鎖下一步。' },
  ];

  /** 畫筆目前是否吸附在手上。 */
  private attached = false;
  /** 是否正在下筆（筆尖在晶圓上且維持捏合）。 */
  private drawing = false;
  /** 吸附動畫的進度 0~1，讓畫筆「彈」出來而不是瞬間出現。 */
  private attachAnim = 0;

  override onEnter(ctx: StageContext): void {
    super.onEnter(ctx);
    ctx.desk.setWaferVisible(true);
    ctx.desk.renderPreview();
    this.attached = false;
    this.drawing = false;
  }

  override onExit(): void {
    this.stopDrawing();
  }

  override restart(): void {
    this.ctx?.desk.clear();
    this.attached = false;
    this.drawing = false;
    this.attachAnim = 0;
  }

  override onFrame(frame: StageFrame): void {
    const { hand, ar, desk, ui, dt, time } = frame;

    // ── 沒有偵測到手：收筆並提示玩家把手放進畫面 ──
    if (!hand.present) {
      this.stopDrawing();
      this.attached = false;
      this.attachAnim = Math.max(0, this.attachAnim - dt * 4);
      ui.setArHint('🖐️ 張開手掌，讓系統看見你的手');
      ui.setHandState('✋', '（未偵測到手）', 'NO HAND', false);
      desk.highlightWafer(time);
      return;
    }

    // ── Attach / Detach：Pinch 按住＝拿著畫筆，放開＝放下畫筆 ──
    this.attached = hand.pinching;
    this.attachAnim = clamp(this.attachAnim + (this.attached ? dt * 6 : -dt * 6), 0, 1);

    const pinch = hand.pinchPoint;
    // 沒捏合時畫筆虛浮在食指尖旁邊，提示「這裡可以拿起來」
    const anchor: Point = this.attached ? pinch : hand.landmarks[INDEX_TIP];
    const onWafer = desk.isOnWafer(pinch.x, pinch.y);

    // ── 作用：捏合 + 筆尖在晶圓上 → 畫線 ──
    if (this.attached && onWafer) {
      if (!this.drawing) {
        desk.beginStroke(pinch.x, pinch.y);
        this.drawing = true;
      } else {
        desk.strokeTo(pinch.x, pinch.y);
      }
    } else {
      this.stopDrawing();
    }

    // ── 回饋：AR 層畫筆、桌面層游標、右側面板與中央提示 ──
    if (!this.attached || !onWafer) desk.highlightWafer(time);
    this.drawPen(ar, anchor, desk.getPenColor(), this.attachAnim, time);
    desk.drawCursor(pinch.x, pinch.y, this.attached);

    if (this.drawing) {
      ui.setArHint('✍️ 正在繪製光罩圖形…', true);
    } else if (this.attached) {
      ui.setArHint('🖊️ 畫筆已附著在你的手上 — 移到下方晶圓開始繪製', true);
    } else {
      ui.setArHint('🤏 捏合拇指與食指，把畫筆吸附到手上');
    }

    ui.setHandState(
      this.attached ? '🖊️' : '✋',
      this.attached ? '畫筆（已吸附）' : '（空手）',
      `PINCH ${hand.pinchDistance.toFixed(3)} / ${this.drawing ? 'DRAWING' : onWafer ? 'ON WAFER' : 'IDLE'}`,
      this.attached,
    );
  }

  override canComplete(): boolean {
    const desk = this.ctx?.desk;
    if (!desk) return false;
    return desk.strokeCount > 0 && desk.coverage() >= MIN_COVERAGE;
  }

  override buildResult(): StageResult {
    const desk = this.ctx.desk;
    return {
      patternDataURL: desk.getPatternDataURL(),
      coverage: desk.coverage(),
      strokes: desk.strokeCount,
      penColor: desk.getPenColor(),
    };
  }

  private stopDrawing(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.ctx?.desk.endStroke();
  }

  /**
   * 畫出「吸附在手上」的畫筆。
   * 筆尖固定在 anchor（＝捏合中心），筆身往右上方傾斜，因此視覺上就像被捏住。
   * attachAnim 用來做彈出／縮回的過場，0 = 完全放開、1 = 完全吸附。
   */
  private drawPen(
    ctx: CanvasRenderingContext2D,
    anchor: Point,
    color: string,
    attachAnim: number,
    time: number,
  ): void {
    const scale = 0.85 + attachAnim * 0.15;
    const alpha = 0.45 + attachAnim * 0.55;
    const bodyLen = 70;
    const bodyW = 13;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(anchor.x, anchor.y);
    ctx.rotate(0.42); // 約 24°，筆身往右上方
    ctx.scale(scale, scale);

    // 筆尖
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-bodyW / 2, -14);
    ctx.lineTo(bodyW / 2, -14);
    ctx.closePath();
    ctx.fill();

    // 金屬箍
    ctx.fillStyle = '#c9d3d8';
    ctx.fillRect(-bodyW / 2, -20, bodyW, 6);

    // 筆身
    const grad = ctx.createLinearGradient(-bodyW / 2, 0, bodyW / 2, 0);
    grad.addColorStop(0, '#20313a');
    grad.addColorStop(0.45, '#3e5763');
    grad.addColorStop(1, '#16232a');
    ctx.fillStyle = grad;
    roundRect(ctx, -bodyW / 2, -bodyLen, bodyW, bodyLen - 20, 3);
    ctx.fill();

    // 筆尾色環（＝目前畫筆顏色）
    ctx.fillStyle = color;
    roundRect(ctx, -bodyW / 2, -bodyLen, bodyW, 10, 3);
    ctx.fill();

    ctx.restore();

    // 吸附時在錨點打一圈脈衝光暈
    if (attachAnim > 0.02) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      ctx.save();
      ctx.globalAlpha = attachAnim * (0.35 + pulse * 0.35);
      ctx.strokeStyle = '#5ee9df';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, 16 + pulse * 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
