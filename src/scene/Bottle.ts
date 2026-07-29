import type { Point } from '../core/types';

/**
 * Bottle —— 檯面上的藥瓶
 * ---------------------------------------------------------------------------
 * 玩家用捏合把瓶子拿起來，移到調配杯上方時瓶身會自動傾倒並流出液柱。
 * 這個模組只負責畫，「有沒有在倒」是 Stage 依位置判斷後傳進來的。
 */

export const BOTTLE_W = 30;
export const BOTTLE_H = 54;

export interface BottleVisual {
  /** 瓶底中心。 */
  pos: Point;
  color: string;
  formula: string;
  name: string;
  /** 傾倒角度（弧度）。0 = 直立，約 -1.9 = 倒過來。 */
  tilt: number;
  /** 被玩家拿在手上。 */
  held: boolean;
  /** 手靠近、可以抓起來。 */
  hot: boolean;
  /** 已經倒進杯子過，畫得亮一點。 */
  used: boolean;
}

/** 瓶口在世界座標的位置（液柱從這裡開始流）。 */
export function bottleMouth(pos: Point, tilt: number): Point {
  // 瓶口在瓶底往上 BOTTLE_H 處，隨傾角繞瓶底旋轉
  return {
    x: pos.x + Math.sin(tilt) * BOTTLE_H,
    y: pos.y - Math.cos(tilt) * BOTTLE_H,
  };
}

export function drawBottle(ctx: CanvasRenderingContext2D, v: BottleVisual, time: number): void {
  const w = BOTTLE_W;
  const h = BOTTLE_H;

  ctx.save();
  ctx.translate(v.pos.x, v.pos.y);
  ctx.rotate(v.tilt);

  // 地面陰影（只有直立在檯面上時才畫）
  if (!v.held) {
    ctx.save();
    ctx.rotate(-v.tilt);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 2, w * 0.55, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 可抓取提示：底下一圈呼吸光暈
  if (v.hot && !v.held) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    ctx.save();
    ctx.rotate(-v.tilt);
    ctx.strokeStyle = '#5ee9df';
    ctx.globalAlpha = 0.3 + pulse * 0.5;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 1, w * 0.62 + pulse * 3, 6 + pulse * 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 瓶身（玻璃：底色 + 內容液 + 高光）
  const bodyTop = -h + 14;
  ctx.fillStyle = 'rgba(210, 232, 240, 0.22)';
  roundRect(ctx, -w / 2, bodyTop, w, h - 14, 4);
  ctx.fill();

  // 內容液：留一點頂部空隙，看得出是「裝著液體的瓶子」
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, -w / 2, bodyTop, w, h - 14, 4);
  ctx.clip();
  ctx.fillStyle = v.color;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(-w / 2, bodyTop + 7, w, h);
  ctx.restore();

  ctx.strokeStyle = v.held ? '#5ee9df' : 'rgba(226, 244, 250, 0.8)';
  ctx.lineWidth = v.held ? 2 : 1.3;
  roundRect(ctx, -w / 2, bodyTop, w, h - 14, 4);
  ctx.stroke();

  // 左側高光
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 5, bodyTop + 8);
  ctx.lineTo(-w / 2 + 5, -8);
  ctx.stroke();

  // 瓶頸 + 瓶蓋
  ctx.fillStyle = '#b8c6cd';
  ctx.fillRect(-5, -h + 5, 10, 10);
  ctx.fillStyle = '#8d9ba3';
  roundRect(ctx, -8, -h, 16, 6, 2);
  ctx.fill();

  // 標籤（隨瓶身旋轉，倒過來時文字也跟著倒，就像真的拿著瓶子）
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = "600 8.5px 'IBM Plex Mono', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(v.formula, 0, -h * 0.42);

  ctx.restore();

  // 瓶子名稱貼在檯面上（不隨瓶身旋轉，永遠讀得到）
  if (!v.held) {
    ctx.save();
    ctx.fillStyle = v.used ? 'rgba(94, 233, 223, 0.9)' : 'rgba(214, 230, 236, 0.7)';
    ctx.font = "500 10px 'IBM Plex Sans', 'Noto Sans TC', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(v.name, v.pos.x, v.pos.y + 8);
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
): void {
  if (landY <= mouth.y) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';

  for (let pass = 0; pass < 2; pass++) {
    ctx.globalAlpha = pass === 0 ? 0.9 : 0.45;
    ctx.lineWidth = pass === 0 ? 4 : 7;
    ctx.beginPath();
    ctx.moveTo(mouth.x, mouth.y);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const y = mouth.y + (landY - mouth.y) * t;
      // 越往下擺動越小，模擬水流被重力拉直
      const sway = Math.sin(time * 14 + t * 6 + pass) * 2.6 * (1 - t);
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
  ctx.ellipse(mouth.x, landY, 6 + pulse * 16, 2 + pulse * 4, 0, 0, Math.PI * 2);
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
