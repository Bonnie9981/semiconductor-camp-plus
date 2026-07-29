import { SECTION_CELLS, type WaferState } from '../core/WaferState';

/**
 * CrossSection —— 晶圓截面圖 HUD（#cross-section-canvas）
 * ---------------------------------------------------------------------------
 * 俯視的圓形晶圓看不出「層」，但整條製程的重點就是層的增減：
 *
 *   ┌────────────────────┐
 *   │▓▓▓▓  光阻           │  ← 顯影後會出現缺口
 *   │████  金屬層         │  ← 蝕刻後會出現溝槽
 *   │░░░░  氧化層         │
 *   │▒▒▒▒  矽基板         │
 *   └────────────────────┘
 *
 * 所以左邊放俯視（手勢互動用），右下角放這張截面（教學用），兩張圖同步反映
 * 同一個 WaferState。RCA 關卡另外把微粒／離子／水滴畫在表面上，讓「洗掉了」
 * 這件事看得見。
 */

const PAD = { left: 8, right: 8, top: 6, bottom: 18 };

export class CrossSection {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cssW: number;
  private readonly cssH: number;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('CrossSection: 無法取得 2D context');
    this.ctx = ctx;

    // HUD canvas 尺寸固定，直接依 DPR 放大一次即可
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.width;
    const cssH = canvas.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = cssW;
    this.cssH = cssH;
  }

  /** 每一幀由主迴圈呼叫。time 用來讓污染物微微浮動。 */
  render(wafer: WaferState, time: number): void {
    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0d1216';
    ctx.fillRect(0, 0, w, h);

    const x0 = PAD.left;
    const x1 = w - PAD.right;
    const innerW = x1 - x0;
    const yBottom = h - PAD.bottom;
    const yTop = PAD.top;
    const innerH = yBottom - yTop;

    // 依相對厚度分配高度；矽基板至少佔 40%，才不會被薄膜擠成一條線
    const total = wafer.layers.reduce((s, l) => s + l.thickness, 0);
    const cellW = innerW / SECTION_CELLS;

    let y = yBottom;
    for (const layer of wafer.layers) {
      const lh = (layer.thickness / total) * innerH;
      const top = y - lh;

      if (!layer.patterned) {
        this.fillLayer(ctx, x0, top, innerW, lh, layer.color);
      } else if (layer.kind === 'resist') {
        // 光阻：顯影後依 resistMask 留下圖案
        for (let i = 0; i < SECTION_CELLS; i++) {
          if (wafer.resistMask[i] < 0.5) continue;
          this.fillLayer(ctx, x0 + i * cellW, top, cellW + 0.5, lh, layer.color);
        }
      } else {
        // 下層材料：依 etchedMask 挖掉。0.6 代表濕式蝕刻的側向咬蝕
        // （undercut）——只吃掉一部分，畫成變窄的柱子。
        for (let i = 0; i < SECTION_CELLS; i++) {
          const e = wafer.etchedMask[i];
          if (e > 0.9) continue;
          const shrink = e > 0.4 ? cellW * 0.45 : 0;
          this.fillLayer(
            ctx,
            x0 + i * cellW + shrink / 2,
            top,
            cellW - shrink + 0.5,
            lh,
            layer.color,
          );
        }
      }

      // 層與層之間的分隔線
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, top);
      ctx.lineTo(x1, top);
      ctx.stroke();

      // 層名（放得下才畫）
      if (lh >= 11) {
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.font = "500 12px 'IBM Plex Mono', monospace";
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(layer.label, x0 + 5, top + lh / 2);
      }

      y = top;
    }

    this.drawContamination(ctx, wafer, x0, innerW, y, time);

    // 外框 + 底部刻度標籤
    ctx.strokeStyle = 'rgba(120, 200, 200, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 0.5, yTop - 0.5, innerW + 1, innerH + 1);

    ctx.fillStyle = 'rgba(150, 170, 180, 0.6)';
    ctx.font = "12px 'IBM Plex Mono', monospace";
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('◀ 剖面放大 ▶', x0, yBottom + 5);

    const c = wafer.contamination;
    const dirt = Math.max(c.particles, c.oxide, c.ions, c.water);
    ctx.textAlign = 'right';
    ctx.fillStyle = dirt < 0.05 ? '#5ee9df' : '#e8c07a';
    ctx.fillText(dirt < 0.05 ? 'CLEAN' : `污染 ${Math.round(dirt * 100)}%`, x1, yBottom + 5);
  }

  private fillLayer(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ): void {
    // 上緣打一道高光，讓每一層看起來有厚度而不是色塊
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, shade(color, 1.25));
    grad.addColorStop(0.35, color);
    grad.addColorStop(1, shade(color, 0.78));
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }

  /** 把微粒 / 離子 / 水滴畫在最上層表面（RCA 專用的視覺回饋）。 */
  private drawContamination(
    ctx: CanvasRenderingContext2D,
    wafer: WaferState,
    x0: number,
    innerW: number,
    surfaceY: number,
    time: number,
  ): void {
    const c = wafer.contamination;

    // 原生氧化層：貼在表面的一層薄薄的半透明膜
    if (c.oxide > 0.02) {
      ctx.save();
      ctx.globalAlpha = c.oxide * 0.75;
      ctx.fillStyle = '#b9c7a8';
      ctx.fillRect(x0, surfaceY - 3, innerW, 3);
      ctx.restore();
    }

    // 微粒：表面上大小不一的顆粒
    if (c.particles > 0.02) {
      ctx.save();
      ctx.globalAlpha = c.particles;
      ctx.fillStyle = '#8a7c5e';
      for (let i = 0; i < 14; i++) {
        const t = (i * 37 + 11) % 100 / 100;
        const r = 1.4 + ((i * 13) % 5) * 0.5;
        const bob = Math.sin(time * 2 + i) * 0.6;
        ctx.beginPath();
        ctx.arc(x0 + t * innerW, surfaceY - r + bob, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 金屬離子：小小的「＋」號
    if (c.ions > 0.02) {
      ctx.save();
      ctx.globalAlpha = c.ions;
      ctx.strokeStyle = '#f2a0c8';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const x = x0 + ((i * 41 + 23) % 100) / 100 * innerW;
        const y = surfaceY - 6 - Math.sin(time * 1.6 + i * 0.9) * 2;
        ctx.moveTo(x - 2.2, y);
        ctx.lineTo(x + 2.2, y);
        ctx.moveTo(x, y - 2.2);
        ctx.lineTo(x, y + 2.2);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 水滴：半圓形的水珠
    if (c.water > 0.02) {
      ctx.save();
      ctx.globalAlpha = c.water * 0.85;
      ctx.fillStyle = '#7fc8e8';
      for (let i = 0; i < 7; i++) {
        const x = x0 + ((i * 29 + 9) % 100) / 100 * innerW;
        const r = 3 + ((i * 7) % 3);
        ctx.beginPath();
        ctx.arc(x, surfaceY, r, Math.PI, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

/** 把顏色亮度乘上 factor，用來做同色系的漸層。 */
function shade(color: string, factor: number): string {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  let r: number;
  let g: number;
  let b: number;
  if (m) {
    const n = parseInt(m[1], 16);
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
