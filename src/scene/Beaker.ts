import type { Point } from '../core/types';

/**
 * Beaker —— 燒杯 / 藥液槽
 * ---------------------------------------------------------------------------
 * 純繪圖模組：吃一份狀態、畫一格畫面，不持有遊戲邏輯。
 *
 *   fillLevel  0~1  液面高度 —— 由玩家調配的「總份數」決定
 *   liquid     色碼   液體顏色 —— 由各藥液依份數加權混合而來
 *   waferY     0~1  晶圓的垂直位置（0 = 燒杯口上方，1 = 完全浸入）
 *
 * 所以「溶液深度以及顏色隨著調配濃度不同而改變」這件事，是 Stage 把 MixRow
 * 換算成 fillLevel / liquid 之後餵進來的，Beaker 自己不知道化學。
 */

export interface BeakerGeometry {
  /** 杯口中心 x。 */
  cx: number;
  /** 杯口 y（頂緣）。 */
  top: number;
  width: number;
  height: number;
}

export interface BeakerState {
  fillLevel: number;
  liquid: string;
  /** 晶圓浸入進度 0~1；小於 0 代表這一刻不畫晶圓。 */
  waferDip: number;
  /** 晶圓半徑（px）。 */
  waferR: number;
  /** 晶圓表面色（跟 WaferState 同步）。 */
  waferColor: string;
  /** 冒泡強度 0~1，反應進行中會冒泡。 */
  bubbling: number;
  /** 杯身上的標籤文字。 */
  label: string;
  /** 傾倒角度（弧度），繞杯底旋轉。倒廢液時用。 */
  tilt?: number;
  /** 被玩家捏在手上（杯緣會亮起來）。 */
  held?: boolean;
  /** 手靠近、可以抓起來。 */
  hot?: boolean;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  speed: number;
}

export class Beaker {
  private bubbles: Bubble[] = [];

  /** 回傳杯內液面的螢幕 y，Stage 需要它來判斷晶圓是否碰到液面。 */
  liquidSurfaceY(geo: BeakerGeometry, fillLevel: number): number {
    const inner = geo.height - 10;
    return geo.top + geo.height - 6 - inner * clamp(fillLevel, 0, 1);
  }

  /**
   * 傾倒時液體流出的杯嘴位置（右上角杯緣繞杯底中心旋轉後的落點）。
   * 倒廢液的水流從這裡開始畫。
   */
  lipPoint(geo: BeakerGeometry, tilt: number): Point {
    const bx = geo.cx;
    const by = geo.top + geo.height;
    const dx = geo.width / 2;
    const dy = geo.top - by;
    return {
      x: bx + dx * Math.cos(tilt) - dy * Math.sin(tilt),
      y: by + dx * Math.sin(tilt) + dy * Math.cos(tilt),
    };
  }

  /**
   * 晶圓在指定浸入進度時的中心點。
   * 晶圓是平放的，所以垂直方向只佔 r × WAFER_SQUASH，浸入深度依這個半高計算。
   */
  waferPoint(geo: BeakerGeometry, state: BeakerState): Point {
    const surface = this.liquidSurfaceY(geo, state.fillLevel);
    const ry = state.waferR * WAFER_SQUASH;
    const above = geo.top - ry - 30;
    const submerged = Math.min(surface + ry + 16, geo.top + geo.height - ry - 14);
    return { x: geo.cx, y: lerp(above, submerged, clamp(state.waferDip, 0, 1)) };
  }

  render(
    ctx: CanvasRenderingContext2D,
    geo: BeakerGeometry,
    state: BeakerState,
    dt: number,
    time: number,
  ): void {
    const { cx, top, width: w, height: h } = geo;
    const left = cx - w / 2;
    const right = cx + w / 2;
    const bottom = top + h;
    const surfaceY = this.liquidSurfaceY(geo, state.fillLevel);
    const tilt = state.tilt ?? 0;

    ctx.save();

    // ── 杯身陰影（不隨傾倒旋轉，永遠貼在檯面上） ──
    if (!state.held) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(cx, bottom + 3, w * 0.55, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 可抓取提示
    if (state.hot && !state.held) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 5);
      ctx.save();
      ctx.strokeStyle = '#5ee9df';
      ctx.globalAlpha = 0.3 + pulse * 0.5;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, bottom + 2, w * 0.62 + pulse * 4, 9 + pulse * 3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 傾倒：整個杯子繞杯底中心旋轉
    if (tilt !== 0) {
      ctx.translate(cx, bottom);
      ctx.rotate(tilt);
      ctx.translate(-cx, -bottom);
    }

    // ── 液體（裁切在杯身內） ──
    if (state.fillLevel > 0.001) {
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, left + 3, top + 4, w - 6, h - 8, 6);
      ctx.clip();

      ctx.fillStyle = state.liquid;
      ctx.globalAlpha = 0.82;
      ctx.fillRect(left, surfaceY, w, bottom - surfaceY);

      // 液面波紋：兩道相位不同的正弦疊加，看起來才不像在跑馬燈
      ctx.globalAlpha = 1;
      ctx.fillStyle = shade(state.liquid, 1.3);
      ctx.beginPath();
      ctx.moveTo(left, surfaceY + 3);
      for (let x = left; x <= right; x += 4) {
        const wave =
          Math.sin((x - left) * 0.09 + time * 2.2) * 1.6 +
          Math.sin((x - left) * 0.05 - time * 1.4) * 1.1;
        ctx.lineTo(x, surfaceY + wave);
      }
      ctx.lineTo(right, surfaceY + 4);
      ctx.lineTo(left, surfaceY + 4);
      ctx.closePath();
      ctx.fill();

      // ── 晶圓（在液體之後、杯壁之前畫，才會看起來「在杯子裡」） ──
      if (state.waferDip >= 0) {
        const p = this.waferPoint(geo, state);
        this.drawWafer(ctx, p, state, time);
      }

      this.updateBubbles(ctx, geo, state, surfaceY, dt);
      ctx.restore();
    } else if (state.waferDip >= 0) {
      const p = this.waferPoint(geo, state);
      this.drawWafer(ctx, p, state, time);
    }

    // ── 杯壁（玻璃質感：外框 + 左側高光） ──
    ctx.strokeStyle = state.held ? '#5ee9df' : 'rgba(196, 226, 236, 0.75)';
    ctx.lineWidth = state.held ? 3 : 2;
    roundRect(ctx, left, top, w, h, 8);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(left + 7, top + 14);
    ctx.lineTo(left + 7, bottom - 14);
    ctx.stroke();

    // 杯口外翻的嘴
    ctx.strokeStyle = 'rgba(196, 226, 236, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left - 6, top - 4);
    ctx.moveTo(right, top);
    ctx.lineTo(right + 6, top - 4);
    ctx.stroke();

    // 刻度線
    ctx.strokeStyle = 'rgba(196, 226, 236, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i <= 4; i++) {
      const y = top + (h * i) / 5;
      ctx.moveTo(right - 12, y);
      ctx.lineTo(right - 2, y);
    }
    ctx.stroke();

    // 標籤
    ctx.fillStyle = 'rgba(226, 240, 244, 0.8)';
    ctx.font = "500 13px 'IBM Plex Mono', monospace";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(state.label, cx, bottom + 12);

    ctx.restore();
  }

  private drawWafer(
    ctx: CanvasRenderingContext2D,
    p: Point,
    state: BeakerState,
    time: number,
  ): void {
    const r = state.waferR;
    ctx.save();
    drawFlatWafer(ctx, p, r, state.waferColor, state.waferDip < 0.98);

    // 浸在液體裡時打一層流動的反光
    if (state.waferDip > 0.4) {
      ctx.globalAlpha = 0.22 + 0.14 * Math.sin(time * 3);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(
        p.x - r * 0.25,
        p.y - r * WAFER_SQUASH * 0.35,
        r * 0.4,
        r * 0.12,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    ctx.restore();
  }

  private updateBubbles(
    ctx: CanvasRenderingContext2D,
    geo: BeakerGeometry,
    state: BeakerState,
    surfaceY: number,
    dt: number,
  ): void {
    const bottom = geo.top + geo.height - 8;

    // 依 bubbling 強度補充氣泡，最多 40 顆
    const want = Math.round(state.bubbling * 40);
    while (this.bubbles.length < want) {
      this.bubbles.push({
        x: geo.cx + (Math.random() - 0.5) * (geo.width - 20),
        y: bottom - Math.random() * 20,
        r: 1.2 + Math.random() * 2.6,
        speed: 18 + Math.random() * 46,
      });
    }
    if (this.bubbles.length > want) this.bubbles.length = want;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    for (const b of this.bubbles) {
      b.y -= b.speed * dt;
      // 浮出液面就從杯底重生
      if (b.y < surfaceY + b.r) {
        b.y = bottom;
        b.x = geo.cx + (Math.random() - 0.5) * (geo.width - 20);
      }
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  reset(): void {
    this.bubbles = [];
  }
}

/**
 * 晶圓的透視壓扁比例。
 * 真實製程中晶圓一律「平放」在載盤／鑷子上，不會立起來，所以畫成一個
 * 被壓扁的橢圓（俯視略帶角度），而不是側立的薄片。
 */
export const WAFER_SQUASH = 0.3;

/**
 * 畫一片平放的晶圓：橢圓盤面 + 下緣的厚度側邊 + 定位平邊。
 * 燒杯浸泡、檯面晶圓架、乾燥機夾取都共用這一支，三處造型才會一致。
 */
export function drawFlatWafer(
  ctx: CanvasRenderingContext2D,
  p: Point,
  r: number,
  color: string,
  withTweezers = false,
): void {
  const ry = r * WAFER_SQUASH;
  const thickness = Math.max(3, r * 0.09);

  ctx.save();

  // 鑷子：從上方左右各夾住晶圓邊緣
  if (withTweezers) {
    ctx.strokeStyle = '#a8b8c0';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x - r * 0.9, p.y - ry - r * 0.75);
    ctx.lineTo(p.x - r * 0.86, p.y - ry * 0.1);
    ctx.moveTo(p.x + r * 0.9, p.y - ry - r * 0.75);
    ctx.lineTo(p.x + r * 0.86, p.y - ry * 0.1);
    ctx.stroke();
  }

  // 晶圓的側面厚度
  ctx.fillStyle = shade(color, 0.62);
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + thickness, r, ry, 0, 0, Math.PI);
  ctx.lineTo(p.x - r, p.y);
  ctx.closePath();
  ctx.fill();

  // 盤面：左上受光的徑向漸層，看起來像鏡面矽晶
  const grad = ctx.createRadialGradient(p.x - r * 0.35, p.y - ry * 0.5, r * 0.05, p.x, p.y, r);
  grad.addColorStop(0, shade(color, 1.25));
  grad.addColorStop(0.55, color);
  grad.addColorStop(1, shade(color, 0.8));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // 定位平邊（primary flat）：靠近觀察者那一側切一小段弦
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(20, 28, 34, 0.55)';
  ctx.fillRect(p.x - r * 0.42, p.y + ry * 0.78, r * 0.84, ry);
  ctx.restore();

  ctx.strokeStyle = 'rgba(240, 248, 250, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
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

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function shade(color: string, factor: number): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  let r: number;
  let g: number;
  let b: number;
  if (hex) {
    const n = parseInt(hex[1], 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const rgb = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!rgb) return color;
    r = Number(rgb[1]);
    g = Number(rgb[2]);
    b = Number(rgb[3]);
  }
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}
