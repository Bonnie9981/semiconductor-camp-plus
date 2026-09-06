import type { Point, StageFrame } from '../core/types';
import {
  dipPoint,
  drawTankBench,
  tankBenchGeometry,
  tankRects,
  type TankBenchState,
  type TankRect,
  type TankSpec,
} from '../scene/TankBench';
import { WAFER_SQUASH } from '../scene/Beaker';
import { BaseStage } from './BaseStage';

/**
 * DipStageBase —— 「把晶圓拖進正確的藥液槽」這個互動的共用基底
 * ---------------------------------------------------------------------------
 * 第四關的顯影、第五關的濕蝕刻與去光阻，玩法完全一樣：
 *
 *   捏起晶圓 ─▶ 拖到某一槽上方 ─▶ 放開
 *        ├─ 選對 → 沉入液面、開始反應
 *        │          玩家左右晃動手可以「攪拌」，反應更快
 *        └─ 選錯 → 該槽閃紅、晶圓彈回原位，並說明為什麼不對
 *
 * 子類別只要提供槽的清單、正確答案與答錯的說明，再實作反應完成時要做什麼。
 */

export interface DipRound {
  /** 檯面上有哪些槽。 */
  tanks: TankSpec[];
  /**
   * 可接受的槽 id。允許多個，因為有些製程步驟本來就有不只一條合法路線
   * （例如濕蝕刻的氫氟酸系與鋁蝕刻液、去光阻的丙酮路線與 NMP 路線）。
   * 玩家實際選了哪一個記在 `pickedId`，子類別可以據此走不同的後續流程。
   */
  answers: readonly string[];
  /** 答錯時的說明（依選到的 id 給不同解釋）。 */
  wrongHint(pickedId: string): string;
  /** 反應需要多少秒（不攪拌的情況）。 */
  seconds: number;
  /** 這一槽在做什麼，顯示在提示上。 */
  actionLabel: string;
}

export abstract class DipStageBase extends BaseStage {
  // ── 互動狀態 ──
  protected held: Point | null = null;
  protected grabbing = false;
  protected dipIndex = -1;
  protected dipDepth = 0;
  protected reactT = 0;
  protected agitation = 0;
  protected wrongIndex = -1;
  protected wrongTimer = 0;
  protected error: string | null = null;
  /** 這一輪玩家選中的槽 id（一定是 round.answers 之一）；null = 還沒選。 */
  protected pickedId: string | null = null;

  /** 上一幀手的 x，用來偵測「左右晃動＝攪拌」。 */
  private lastHandX: number | null = null;

  /** 重設一輪浸泡。 */
  protected resetDip(): void {
    this.held = null;
    this.grabbing = false;
    this.dipIndex = -1;
    this.dipDepth = 0;
    this.reactT = 0;
    this.agitation = 0;
    this.wrongIndex = -1;
    this.wrongTimer = 0;
    this.error = null;
    this.pickedId = null;
    this.lastHandX = null;
  }

  /** 場景可用範圍，與其他關卡同一套規則。 */
  protected sceneBounds(frame: StageFrame): { left: number; right: number; w: number } {
    const { width } = frame.desk.size;
    const inset = frame.ui.panelInset();
    const right = width - 14;
    const left = Math.min(inset > 0 ? inset + 26 : width * 0.06, width * 0.52);
    return { left, right, w: Math.max(180, right - left) };
  }

  /**
   * 跑一輪「拖進正確的槽」。回傳 true 代表這一輪的反應剛剛完成，
   * 子類別可以在那一刻改 WaferState 並前進到下一個子步驟。
   */
  protected runDip(
    frame: StageFrame,
    groundY: number,
    round: DipRound,
    opts: { waferColor: string; filmColor: string | null },
  ): boolean {
    const { desk, dt, time, hand } = frame;
    const ctx = desk.context;
    const { height } = desk.size;
    const scene = this.sceneBounds(frame);

    // 幾何全部交給 tankBenchGeometry()，scripts/checks 驗的就是同一份計算
    const { geo, waferR, rest } = tankBenchGeometry({ scene, height, groundY });
    const rects = tankRects(geo, round.tanks);

    if (this.wrongTimer > 0) this.wrongTimer -= dt;
    else this.wrongIndex = -1;

    let finished = false;

    if (this.dipIndex < 0) {
      finished = this.updateCarry(hand, rects, rest, waferR, round);
    } else {
      finished = this.updateReaction(hand, dt, round);
    }

    const state: TankBenchState = {
      heldWafer: this.dipIndex < 0 ? (this.held ?? rest) : null,
      waferR,
      waferColor: opts.waferColor,
      filmColor: opts.filmColor,
      hotIndex: this.hotIndex(rects),
      dipIndex: this.dipIndex,
      dipDepth: this.dipDepth,
      progress: this.reactT,
      agitation: this.agitation,
      wrongIndex: this.wrongIndex,
    };

    drawTankBench(ctx, rects, round.tanks, state, time);

    // 反應進度環畫在正在用的那一槽上
    if (this.dipIndex >= 0) {
      const r = rects[this.dipIndex];
      this.drawProgressRing(ctx, r, dipPoint(r, state), waferR, round.actionLabel);
    } else if (!this.held) {
      // 待命的晶圓打一圈呼吸光暈
      const pulse = 0.5 + 0.5 * Math.sin(time * 3);
      ctx.save();
      ctx.globalAlpha = 0.2 + pulse * 0.35;
      ctx.strokeStyle = '#2ecfc7';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(rest.x, rest.y, waferR + 9, waferR * WAFER_SQUASH + 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    return finished;
  }

  /** 手上拿著晶圓：抓取、移動、放開時判斷落在哪一槽。 */
  private updateCarry(
    hand: StageFrame['hand'],
    rects: readonly TankRect[],
    rest: Point,
    waferR: number,
    round: DipRound,
  ): boolean {
    if (hand.present && hand.pinching && !this.grabbing) {
      const anchor = this.held ?? rest;
      if (dist(hand.pinchPoint, anchor) < waferR + 40) {
        this.grabbing = true;
        this.held = { ...hand.pinchPoint };
      }
    }

    if (this.grabbing) {
      if (hand.present && hand.pinching) {
        this.held = { ...hand.pinchPoint };
      } else {
        this.grabbing = false;
        const idx = this.hotIndex(rects);
        const p = this.held;
        this.held = null;
        if (idx >= 0 && p) {
          if (round.answers.includes(rects[idx].id)) {
            this.pickedId = rects[idx].id;
            this.dipIndex = idx;
            this.dipDepth = 0;
            this.reactT = 0;
            this.error = null;
          } else {
            this.wrongIndex = idx;
            this.wrongTimer = 1.4;
            this.error = round.wrongHint(rects[idx].id);
          }
        }
      }
    }
    if (!hand.present) this.grabbing = false;
    return false;
  }

  /**
   * 已經在槽裡：下沉 → 反應（可攪拌加速）→ 提起。
   *
   * ⚠️ 提起要**擺在最前面判斷**。原本先寫「dipDepth < 1 就下沉」，
   * 結果反應完成、晶圓開始上升的那一刻 dipDepth 又小於 1，
   * 於是下一幀立刻被推回槽底 —— 進度停在 100% 卻永遠出不來。
   */
  private updateReaction(hand: StageFrame['hand'], dt: number, round: DipRound): boolean {
    if (this.reactT >= 1) {
      this.dipDepth = Math.max(0, this.dipDepth - dt * 2.2);
      return this.dipDepth <= 0;
    }

    // 下沉
    if (this.dipDepth < 1) {
      this.dipDepth = Math.min(1, this.dipDepth + dt * 1.6);
      return false;
    }

    // 攪拌：偵測手的水平晃動
    if (hand.present) {
      const x = hand.pinchPoint.x;
      if (this.lastHandX !== null) {
        const speed = Math.abs(x - this.lastHandX) / Math.max(dt, 0.001);
        this.agitation = clamp(this.agitation * 0.9 + Math.min(1, speed / 900) * 0.35, 0, 1);
      }
      this.lastHandX = x;
    } else {
      this.agitation *= 0.94;
    }

    // 攪拌最多讓反應快一倍
    this.reactT = Math.min(1, this.reactT + (dt / round.seconds) * (1 + this.agitation));
    return false;
  }

  /** 手上的晶圓正對著第幾槽。 */
  private hotIndex(rects: readonly TankRect[]): number {
    const p = this.held;
    if (!p || this.dipIndex >= 0) return -1;
    return rects.findIndex((r) => p.x >= r.x - 10 && p.x <= r.x + r.w + 10 && p.y < r.y + r.h);
  }

  private drawProgressRing(
    ctx: CanvasRenderingContext2D,
    r: TankRect,
    p: Point,
    waferR: number,
    label: string,
  ): void {
    const rr = waferR + 20;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = this.agitation > 0.25 ? '#5ee9df' : '#5ee996';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(p.x, p.y, rr, -Math.PI / 2, -Math.PI / 2 + this.reactT * Math.PI * 2);
    ctx.stroke();

    ctx.font = "700 15px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(8,14,18,0.9)';
    const text = `${label} ${Math.round(this.reactT * 100)}%`;
    ctx.strokeText(text, r.cx, r.y - 12);
    ctx.fillStyle = '#e8f2f6';
    ctx.fillText(text, r.cx, r.y - 12);
    ctx.restore();
  }

  /** 依目前狀態產生 AR 提示，子類別直接轉呼叫。 */
  protected dipHints(frame: StageFrame, round: DipRound): void {
    const { ui, hand } = frame;
    if (this.dipIndex >= 0) {
      const pct = Math.round(this.reactT * 100);
      ui.setArHint(
        this.agitation > 0.25
          ? `🌊 攪拌中 — ${round.actionLabel} ${pct}%（攪拌可以加快反應）`
          : `🧪 ${round.actionLabel}中 ${pct}% — 左右晃動手可以攪拌加速`,
        true,
      );
      ui.setHandState(
        '🧪',
        `${round.actionLabel}中`,
        `${pct}% / 攪拌 ${Math.round(this.agitation * 100)}%`,
        true,
      );
      return;
    }
    if (this.grabbing) {
      ui.setArHint('🤏 夾著晶圓 — 移到正確的藥液槽上方再放開', true);
      ui.setHandState('🤏', '夾著晶圓', 'CARRYING', true);
      return;
    }
    ui.setArHint(
      this.error ? '❌ 選錯了 — 再捏起晶圓試一次' : '🤏 捏合夾起晶圓，拖進正確的藥液槽',
      false,
    );
    ui.setHandState('✋', '（空手）', `PINCH ${hand.pinchDistance.toFixed(3)}`, false);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
