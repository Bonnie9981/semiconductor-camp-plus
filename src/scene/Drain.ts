import type { Point } from '../core/types';

/**
 * Drain —— 廢液桶
 * ---------------------------------------------------------------------------
 * 配錯了就得整杯倒掉重來。廢液桶是這個「重做」動作的實體出口：玩家捏起
 * 調配杯移到桶口上方放開，杯子會傾倒把液體排掉。
 */

export interface DrainGeometry {
  cx: number;
  /** 桶底 y（站在檯面基準線上）。 */
  baseY: number;
  width: number;
}

export interface DrainState {
  /** 手上的杯子正對著桶口。 */
  hot: boolean;
  /** 正在排放中 0~1，用來畫桶內翻騰的廢液。 */
  draining: number;
  /** 排掉的液體顏色。 */
  wasteColor: string;
}

/** 桶口中心，Stage 用它做命中測試。 */
export function drainMouth(geo: DrainGeometry): Point {
  return { x: geo.cx, y: geo.baseY - geo.width * 1.05 };
}

export function drawDrain(
  ctx: CanvasRenderingContext2D,
  geo: DrainGeometry,
  state: DrainState,
  time: number,
): void {
  const w = geo.width;
  const h = w * 1.05;
  const top = geo.baseY - h;
  const left = geo.cx - w / 2;

  ctx.save();

  // 陰影
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(geo.cx, geo.baseY, w * 0.55, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // 桶身（上寬下窄的金屬桶）
  const body = ctx.createLinearGradient(left, top, left + w, top);
  body.addColorStop(0, '#3a444a');
  body.addColorStop(0.4, '#525f66');
  body.addColorStop(1, '#2a3238');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left + w, top);
  ctx.lineTo(left + w * 0.88, geo.baseY);
  ctx.lineTo(left + w * 0.12, geo.baseY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#1a2125';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 桶內的廢液（排放時會晃）
  const wasteH = h * (0.18 + state.draining * 0.3);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left + 3, top + 6);
  ctx.lineTo(left + w - 3, top + 6);
  ctx.lineTo(left + w * 0.88, geo.baseY - 2);
  ctx.lineTo(left + w * 0.12, geo.baseY - 2);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = state.draining > 0 ? state.wasteColor : '#3d4a3a';
  ctx.globalAlpha = 0.75;
  const surfaceY = geo.baseY - wasteH;
  ctx.beginPath();
  ctx.moveTo(left, surfaceY + 4);
  for (let x = left; x <= left + w; x += 4) {
    ctx.lineTo(x, surfaceY + Math.sin((x - left) * 0.11 + time * 3.5) * 2);
  }
  ctx.lineTo(left + w, geo.baseY);
  ctx.lineTo(left, geo.baseY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 桶口橢圓
  ctx.strokeStyle = state.hot ? '#5ee9df' : 'rgba(190, 210, 220, 0.75)';
  ctx.lineWidth = state.hot ? 3 : 2;
  ctx.beginPath();
  ctx.ellipse(geo.cx, top, w / 2, w * 0.15, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 對準時的呼吸提示
  if (state.hot) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    ctx.globalAlpha = 0.3 + pulse * 0.45;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(geo.cx, top, w / 2 + 6 + pulse * 5, w * 0.15 + 3 + pulse * 3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 危險標示
  ctx.fillStyle = 'rgba(232, 180, 90, 0.9)';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('☣', geo.cx, top + h * 0.52);

  ctx.fillStyle = state.hot ? '#5ee9df' : 'rgba(200, 216, 222, 0.7)';
  ctx.font = "500 12px 'IBM Plex Mono', monospace";
  ctx.textBaseline = 'top';
  ctx.fillText('WASTE · 廢液桶', geo.cx, geo.baseY + 8);

  ctx.restore();
}
