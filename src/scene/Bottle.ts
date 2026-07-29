import type { Point } from '../core/types';

/**
 * Bottle —— 檯面上的藥瓶
 * ---------------------------------------------------------------------------
 * 玩家用捏合把瓶子拿起來，移到調配杯上方時瓶身會自動傾倒並流出液柱。
 * 這個模組只負責畫，「有沒有在倒」是 Stage 依位置判斷後傳進來的。
 *
 * 尺寸由外部傳入（BottleVisual.w / .h），因為場景要依視窗大小縮放；
 * 字級也跟著瓶身等比放大，小螢幕上才不會變成看不清的小字。
 */

/** 預設瓶身尺寸；Stage 會依可用空間覆寫。 */
export const BOTTLE_W = 46;
export const BOTTLE_H = 78;

export interface BottleVisual {
  /** 瓶底中心。 */
  pos: Point;
  w: number;
  h: number;
  color: string;
  formula: string;
  name: string;
  /** 傾倒角度（弧度）。0 = 直立，約 -2.0 = 倒過來。 */
  tilt: number;
  /** 被玩家拿在手上。 */
  held: boolean;
  /** 手靠近、可以抓起來。 */
  hot: boolean;
  /** 已經倒進杯子過，畫得亮一點。 */
  used: boolean;
}

/** 瓶口在世界座標的位置（液柱從這裡開始流）。 */
export function bottleMouth(pos: Point, tilt: number, h: number): Point {
  // 瓶口在瓶底往上 h 處，隨傾角繞瓶底旋轉
  return {
    x: pos.x + Math.sin(tilt) * h,
    y: pos.y - Math.cos(tilt) * h,
  };
}

export function drawBottle(ctx: CanvasRenderingContext2D, v: BottleVisual, time: number): void {
  const { w, h } = v;
  const neckH = h * 0.19;
  const bodyTop = -h + neckH;
  const bodyH = h - neckH;
  const r = Math.max(3, w * 0.11);

  ctx.save();
  ctx.translate(v.pos.x, v.pos.y);
  ctx.rotate(v.tilt);

  // 地面陰影（不隨瓶身旋轉，永遠貼在檯面上）
  if (!v.held) {
    ctx.save();
    ctx.rotate(-v.tilt);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 3, w * 0.58, w * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 可抓取提示：底下一圈呼吸光暈
  if (v.hot && !v.held) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    ctx.save();
    ctx.rotate(-v.tilt);
    ctx.strokeStyle = '#5ee9df';
    ctx.globalAlpha = 0.35 + pulse * 0.5;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 2, w * 0.66 + pulse * 4, w * 0.2 + pulse * 3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 瓶身底色（玻璃）
  ctx.fillStyle = 'rgba(210, 232, 240, 0.2)';
  roundRect(ctx, -w / 2, bodyTop, w, bodyH, r);
  ctx.fill();

  // 內容液：留一點頂部空隙，看得出是「裝著液體的瓶子」
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, -w / 2, bodyTop, w, bodyH, r);
  ctx.clip();
  ctx.fillStyle = v.color;
  ctx.globalAlpha = 0.92;
  ctx.fillRect(-w / 2, bodyTop + bodyH * 0.16, w, bodyH);
  ctx.restore();

  ctx.strokeStyle = v.held ? '#5ee9df' : 'rgba(232, 246, 251, 0.85)';
  ctx.lineWidth = v.held ? 2.5 : 1.6;
  roundRect(ctx, -w / 2, bodyTop, w, bodyH, r);
  ctx.stroke();

  // 左側高光
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = Math.max(2, w * 0.06);
  ctx.beginPath();
  ctx.moveTo(-w / 2 + w * 0.17, bodyTop + bodyH * 0.2);
  ctx.lineTo(-w / 2 + w * 0.17, bodyTop + bodyH * 0.78);
  ctx.stroke();

  // 瓶頸 + 瓶蓋
  ctx.fillStyle = '#c2d0d7';
  ctx.fillRect(-w * 0.17, -h + neckH * 0.45, w * 0.34, neckH * 0.6);
  ctx.fillStyle = '#94a2aa';
  roundRect(ctx, -w * 0.26, -h, w * 0.52, neckH * 0.5, 2.5);
  ctx.fill();

  // 化學式標籤：白底黑字的貼紙，在深色場景上對比最高
  const labelW = w * 0.92;
  const labelH = Math.max(15, h * 0.21);
  const labelY = bodyTop + bodyH * 0.42;
  ctx.fillStyle = 'rgba(250, 253, 254, 0.95)';
  roundRect(ctx, -labelW / 2, labelY - labelH / 2, labelW, labelH, 3);
  ctx.fill();

  ctx.fillStyle = '#16232a';
  ctx.font = `700 ${Math.round(labelH * 0.62)}px 'IBM Plex Mono', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(v.formula, 0, labelY + 0.5);

  ctx.restore();

  // 中文名稱貼在檯面上（不隨瓶身旋轉，永遠讀得到）
  if (!v.held) {
    ctx.save();
    const fs = Math.max(12, Math.round(w * 0.31));
    ctx.font = `700 ${fs}px 'IBM Plex Sans', 'Noto Sans TC', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // 深色描邊，確保壓在鏡頭畫面上也讀得到
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(8, 14, 18, 0.85)';
    ctx.strokeText(v.name, v.pos.x, v.pos.y + w * 0.24);
    ctx.fillStyle = v.used ? '#5ee9df' : '#e8f2f6';
    ctx.fillText(v.name, v.pos.x, v.pos.y + w * 0.24);
    ctx.restore();
  }
}

/**
 * 從瓶口流下的液柱。用兩條略微錯開的曲線疊出「有厚度的水流」，
 * 落點再打一圈漣漪，看起來才像真的倒進去了。
 */
export function drawPourStream(
  ctx: CanvasRenderingContext2D,
  mouth: Point,
  landY: number,
  color: string,
  time: number,
  width = 1,
): void {
  if (landY <= mouth.y) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';

  for (let pass = 0; pass < 2; pass++) {
    ctx.globalAlpha = pass === 0 ? 0.92 : 0.45;
    ctx.lineWidth = (pass === 0 ? 5 : 9) * width;
    ctx.beginPath();
    ctx.moveTo(mouth.x, mouth.y);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const y = mouth.y + (landY - mouth.y) * t;
      // 越往下擺動越小，模擬水流被重力拉直
      const sway = Math.sin(time * 14 + t * 6 + pass) * 2.8 * (1 - t);
      ctx.lineTo(mouth.x + sway, y);
    }
    ctx.stroke();
  }

  // 落點漣漪
  const pulse = (time * 3) % 1;
  ctx.globalAlpha = 0.5 * (1 - pulse);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(mouth.x, landY, (6 + pulse * 16) * width, (2 + pulse * 4) * width, 0, 0, Math.PI * 2);
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
