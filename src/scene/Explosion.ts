import { prefersReducedMotion } from '../core/motion';
import type { Point } from '../core/types';

/**
 * Explosion —— 突沸／爆炸的簡易動畫
 * ---------------------------------------------------------------------------
 * 用在「配液順序錯誤」的懲罰：杯子裡還沒有去離子水就倒進反應性藥液，
 * 界面局部瞬間到達沸點，把高溫腐蝕液整團噴出來。
 *
 * 四層疊起來就有足夠的衝擊感，不需要通用粒子系統：
 *   ① 白光閃焰      最前面 0.14 秒
 *   ② 擴散衝擊波環  兩圈，速度與顏色不同
 *   ③ 噴濺的液滴    往上方散射並受重力下墜
 *   ④ 上升的煙霧    邊升邊擴散變淡
 */

/** 動畫總長（秒）。 */
export const EXPLOSION_DURATION = 1.8;

interface Debris {
  angle: number;
  speed: number;
  size: number;
  /** 相對爆點的位移。 */
  x: number;
  y: number;
  /** 重力累積的下墜速度。 */
  vy: number;
}

interface Smoke {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export class Explosion {
  /** 已經播了幾秒；負數＝沒在播。 */
  private t = -1;
  private origin: Point = { x: 0, y: 0 };
  private debris: Debris[] = [];
  private smoke: Smoke[] = [];
  /** 噴出來的液體顏色，用配錯的那杯藥液的顏色。 */
  private liquid = '#d8c489';

  get active(): boolean {
    return this.t >= 0 && this.t < EXPLOSION_DURATION;
  }

  /** 進度 0~1。Stage 拿它決定什麼時候清空杯子、回到可操作狀態。 */
  get progress(): number {
    return this.t < 0 ? 0 : Math.min(1, this.t / EXPLOSION_DURATION);
  }

  trigger(origin: Point, liquid: string, scale = 1): void {
    this.t = 0;
    this.origin = { ...origin };
    this.liquid = liquid;

    this.debris = Array.from({ length: 34 }, (_, i) => ({
      // 主要往上噴（−π ~ 0 那半圈），再散開一點
      angle: -Math.PI * 0.9 + (i / 34) * Math.PI * 0.8 + (Math.random() - 0.5) * 0.5,
      speed: (150 + Math.random() * 320) * scale,
      size: (2 + Math.random() * 4) * scale,
      x: 0,
      y: 0,
      vy: 0,
    }));

    this.smoke = Array.from({ length: 12 }, () => ({
      x: (Math.random() - 0.5) * 30 * scale,
      y: 0,
      vx: (Math.random() - 0.5) * 40 * scale,
      vy: -(40 + Math.random() * 70) * scale,
      r: (10 + Math.random() * 16) * scale,
    }));
  }

  reset(): void {
    this.t = -1;
    this.debris = [];
    this.smoke = [];
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;

    for (const d of this.debris) {
      d.x += Math.cos(d.angle) * d.speed * dt;
      d.y += Math.sin(d.angle) * d.speed * dt + d.vy * dt;
      d.vy += 900 * dt; // 重力
      d.speed *= 1 - dt * 1.6; // 空氣阻力
    }
    for (const s of this.smoke) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy *= 1 - dt * 0.8;
      s.r += 34 * dt;
    }
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.active) return;
    const p = this.progress;
    const o = this.origin;

    // 減少動態效果：不要整片白光閃焰、不要擴散衝擊波，只留靜態的警示。
    if (prefersReducedMotion()) {
      this.renderStatic(ctx, p);
      return;
    }
    /** 後半段整體淡出。 */
    const fade = 1 - Math.max(0, (p - 0.5) / 0.5);

    ctx.save();

    // ── ① 白光閃焰 ──
    if (p < 0.14) {
      ctx.globalAlpha = (1 - p / 0.14) * 0.85;
      ctx.fillStyle = '#fff6e0';
      ctx.fillRect(0, 0, width, height);
    }

    // ── ② 衝擊波環 ──
    const rings: [number, number, string][] = [
      [0, 620, 'rgba(255, 226, 160, '],
      [0.08, 420, 'rgba(255, 150, 90, '],
    ];
    for (const [delay, speed, color] of rings) {
      const rt = (this.t - delay) / (EXPLOSION_DURATION * 0.5);
      if (rt <= 0 || rt >= 1) continue;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `${color}${(1 - rt) * 0.9})`;
      ctx.lineWidth = 8 * (1 - rt) + 1;
      ctx.beginPath();
      ctx.arc(o.x, o.y, rt * speed * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── ③ 噴濺的液滴 ──
    ctx.globalAlpha = fade;
    ctx.fillStyle = this.liquid;
    for (const d of this.debris) {
      ctx.beginPath();
      ctx.arc(o.x + d.x, o.y + d.y, d.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── ④ 上升的煙霧 ──
    ctx.fillStyle = '#6b6f72';
    for (const s of this.smoke) {
      ctx.globalAlpha = fade * 0.3;
      ctx.beginPath();
      ctx.arc(o.x + s.x, o.y + s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── 中央火光核心 ──
    if (p < 0.4) {
      const k = 1 - p / 0.4;
      const r = 70 * k + 20;
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, r);
      g.addColorStop(0, `rgba(255, 250, 230, ${k})`);
      g.addColorStop(0.4, `rgba(255, 180, 90, ${k * 0.8})`);
      g.addColorStop(1, 'rgba(255, 120, 60, 0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── 警告字樣 ──
    if (p > 0.12) {
      ctx.globalAlpha = Math.min(1, (p - 0.12) / 0.15) * (1 - Math.max(0, (p - 0.7) / 0.3));
      ctx.font = "700 34px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(10, 6, 4, 0.9)';
      ctx.strokeText('⚠ 突沸！', o.x, o.y - 90);
      ctx.fillStyle = '#ffcf6a';
      ctx.fillText('⚠ 突沸！', o.x, o.y - 90);
    }

    ctx.restore();
  }

  /**
   * 減少動態效果時的替代畫面：一圈固定大小的暖色暈染 + 靜態警示字。
   * 沒有全螢幕閃光、沒有會擴大或移動的東西，末段才平緩淡出。
   */
  private renderStatic(ctx: CanvasRenderingContext2D, p: number): void {
    const o = this.origin;
    const fade = 1 - Math.max(0, (p - 0.75) / 0.25);
    if (fade <= 0) return;

    ctx.save();

    const r = 96;
    const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, r);
    g.addColorStop(0, `rgba(255, 190, 110, ${0.5 * fade})`);
    g.addColorStop(1, 'rgba(255, 140, 70, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = fade;
    ctx.font = "700 34px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(10, 6, 4, 0.9)';
    ctx.strokeText('⚠ 突沸！配方報廢', o.x, o.y - 90);
    ctx.fillStyle = '#ffcf6a';
    ctx.fillText('⚠ 突沸！配方報廢', o.x, o.y - 90);

    ctx.restore();
  }
}
