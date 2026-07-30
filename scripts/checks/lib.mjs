/** 檢查腳本的共用小工具：結果收集與輸出格式。 */

export class Report {
  constructor(title) {
    this.title = title;
    this.rows = [];
    this.failed = 0;
  }

  /** 記一筆檢查結果。errs 為空陣列＝通過。 */
  add(label, errs, detail = '') {
    const ok = errs.length === 0;
    if (!ok) this.failed += 1;
    this.rows.push({ label, errs, detail, ok });
  }

  print() {
    console.log(`\n── ${this.title} ──`);
    for (const r of this.rows) {
      console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}${r.detail ? `  ${r.detail}` : ''}`);
      for (const e of r.errs) console.log(`      → ${e}`);
    }
    return this.failed;
  }
}

/** 專案原始碼的絕對路徑（檢查腳本 import 真正的模組時用）。 */
export const SRC = new URL('../../src/', import.meta.url).pathname;

/**
 * 要驗證的可視區域尺寸，以及 index.html / style.css 在該尺寸下的實際版面值。
 * 斷點必須跟 style.css 的 media query 保持一致。
 *
 * 特別包含 Windows 顯示縮放 125% 的組合（1920→1536、1440→1152）——
 * 那是「寬度大到不觸發寬度斷點、但高度很小」的情況，
 * 曾經因為沒被涵蓋而讓藥瓶名稱壓到燒杯。
 */
export const SCREENS = [
  { name: '1920x1080 外接螢幕', w: 1920, h: 1010 },
  { name: '1536x752  1920@125%', w: 1536, h: 752 },
  { name: '1512x982  MBP 14"', w: 1512, h: 870 },
  { name: '1440x900  Air 13"', w: 1440, h: 790 },
  { name: '1366x768  Win 筆電', w: 1366, h: 700 },
  { name: '1280x800  小筆電', w: 1280, h: 730 },
  { name: '1152x648  1440@125%', w: 1152, h: 610 },
  { name: '1100x600  支援下限', w: 1100, h: 600 },
];

/** 低於 MIN_VIEWPORT 的尺寸：不驗版面，改驗「有跳出放大視窗的提示」。 */
export const TOO_SMALL_SCREENS = [
  { name: '1024x768  投影機', w: 1024, h: 768 },
  { name: '1280x1024@125%', w: 1024, h: 819 },
  { name: '1440x440  高度不足', w: 1440, h: 440 },
];

/** 互動面板在 CSS 上的 top 與底部保留高度（跟 style.css 的斷點一致）。 */
export function panelMetrics(wh) {
  return {
    top: wh <= 540 ? 88 : wh <= 660 ? 104 : wh <= 740 ? 116 : wh <= 860 ? 132 : 146,
    // --hud-reserve 現在由 main.ts 量 .vp-bottom 寫回來，這裡取各級距的近似值
    hudReserve: wh <= 540 ? 118 : wh <= 660 ? 138 : wh <= 740 ? 158 : wh <= 860 ? 176 : 190,
  };
}

/** 依視窗尺寸推出鏡頭視窗（canvas）的尺寸與場景可用範圍。 */
export function viewport({ w: ww, h: wh }) {
  const headerH = wh <= 540 ? 42 : wh <= 660 ? 48 : wh <= 740 ? 54 : wh <= 860 ? 62 : 72;
  const flowH = wh <= 540 ? 0 : wh <= 660 ? 38 : wh <= 740 ? 42 : wh <= 860 ? 50 : 58;
  const pad = ww <= 1280 ? 10 : ww <= 1420 ? 14 : 18;
  const sidebar = ww <= 1180 ? 172 : ww <= 1280 ? 196 : ww <= 1420 ? 226 : 260;
  const rightPanel = ww <= 1180 ? 210 : ww <= 1280 ? 236 : ww <= 1420 ? 268 : 300;
  const panelSceneW = ww <= 1180 ? 234 : ww <= 1280 ? 262 : ww <= 1420 ? 292 : 324;

  const width = ww - sidebar - rightPanel - pad * 2;
  const height = wh - headerH - flowH - pad * 2;
  const deskTop = height * 0.74;
  const groundY = deskTop + height * 0.26 * 0.44;

  // 與各關卡的 sceneBounds() 相同的算法
  const left = Math.min(16 + panelSceneW + 26, width * 0.52);
  const right = width - 14;
  return {
    width,
    height,
    groundY,
    scene: { left, right, w: Math.max(180, right - left) },
  };
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
