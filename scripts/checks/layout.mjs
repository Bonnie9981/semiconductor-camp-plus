/**
 * 版面檢查
 * ---------------------------------------------------------------------------
 * 直接跑真正的 `chamberLayout()` 與 `alignerLayout()`，確認在常見筆電尺寸下
 * 機台上的元素不會互相重疊、也不會小到看不清或按不到。
 *
 * 這支曾經抓到兩個真實 bug：CVD 的兩顆氣閥旋鈕疊到大按鈕、
 * 腔門下方的狀態文字溢出機台外框。
 */
import { Report, SCREENS, SRC, TOO_SMALL_SCREENS, clamp, panelMetrics, viewport } from './lib.mjs';

const { chamberLayout } = await import(`${SRC}scene/Chamber.ts`);
const { alignerLayout, ALIGN_TOLERANCE } = await import(`${SRC}scene/Aligner.ts`);
const { wetBenchLayout } = await import(`${SRC}scene/WetBenchLayout.ts`);
const { checkViewport, MIN_VIEWPORT } = await import(`${SRC}core/Viewport.ts`);
const { machineBox } = await import(`${SRC}scene/MachineFit.ts`);
const { tankBenchGeometry } = await import(`${SRC}scene/TankBench.ts`);

const report = new Report('版面（真實 chamberLayout / alignerLayout）');

for (const screen of SCREENS) {
  const vp = viewport(screen);
  const { scene, groundY, height } = vp;

  /*
    上方帶狀 HTML 的下緣。遊戲裡是量 DOM（UIManager.sceneOverlay()），
    這裡沒有 DOM，用各高度級距的 CSS 值推算：AR 提示的 top + 它的高度。
    真正的重疊由 scripts/checks/browser.mjs 開 Chrome 驗。
  */
  const bandTop =
    (screen.h <= 540 ? 56 : screen.h <= 660 ? 68 : screen.h <= 740 ? 76 : screen.h <= 860 ? 86 : 94) +
    (screen.h <= 660 ? 26 : screen.h <= 740 ? 30 : 40) +
    8;

  // ── 互動面板（HTML）本身要有可用高度 ──
  {
    const m = panelMetrics(screen.h);
    const panelH = height - m.top - m.hudReserve;
    report.add(
      `${screen.name}  互動面板`,
      panelH >= 170 ? [] : [`可用高度只剩 ${panelH.toFixed(0)}px，面板內容會擠成一團`],
      `${panelH.toFixed(0)}px`,
    );
  }

  // ── RCA 濕式清洗檯：藥瓶層板不可以壓到燒杯 ──
  {
    const L = wetBenchLayout({ scene, height, groundY, bottleCount: 6 });
    const errs = [];
    if (L.shelf.labelBottom > L.beaker.top) {
      errs.push(`藥瓶名稱壓到燒杯 ${(L.shelf.labelBottom - L.beaker.top).toFixed(0)}px`);
    }
    if (L.shelf.plankY > L.beaker.top) {
      errs.push(`層板壓到燒杯 ${(L.shelf.plankY - L.beaker.top).toFixed(0)}px`);
    }
    const bottleTop = L.shelf.y - L.shelf.bottleH;
    if (bottleTop < height * 0.2 - 1) {
      errs.push(`藥瓶頂端壓到上方提示帶 ${(height * 0.2 - bottleTop).toFixed(0)}px`);
    }
    if (L.shelf.w < 30) errs.push(`藥瓶太窄 ${L.shelf.w.toFixed(0)}px，看不清標籤`);
    if (L.beaker.height < 90) errs.push(`燒杯太矮 ${L.beaker.height.toFixed(0)}px`);
    // 六個瓶子橫向排得下
    const need = L.shelf.w * 6;
    if (need > scene.w) errs.push(`六個藥瓶排不下（需要 ${need.toFixed(0)}、只有 ${scene.w.toFixed(0)}）`);
    // 晶圓架不可以被燒杯壓到
    if (L.waferStand.cx + L.waferStand.r > L.beaker.cx - L.beaker.width / 2 + 2) {
      errs.push('待清洗晶圓與燒杯重疊');
    }
    report.add(
      `${screen.name}  RCA 檯面`,
      errs,
      `杯 ${L.beaker.width.toFixed(0)}×${L.beaker.height.toFixed(0)} 瓶 ${L.shelf.w.toFixed(0)}`,
    );
  }

  // ── 藥液槽（顯影 / 濕蝕刻 / 去光阻）──
  {
    const T = tankBenchGeometry({ scene, height, groundY });
    const tankW = (scene.w - Math.max(10, scene.w * 0.025) * 3) / 4;
    const errs = [];
    if (tankW < 90) errs.push(`藥液槽太窄 ${tankW.toFixed(0)}px`);
    // 待命的晶圓在標籤下方，兩者不能重疊
    const waferTop = T.rest.y - T.waferR * 0.3;
    if (waferTop < T.labelBottom) {
      errs.push(`待命晶圓壓到槽名 ${(T.labelBottom - waferTop).toFixed(0)}px`);
    }
    const waferBottom = T.rest.y + T.waferR * 0.3 + 20;
    if (waferBottom > height) errs.push(`待命晶圓超出畫面下緣 ${(waferBottom - height).toFixed(0)}px`);
    if (T.geo.baseY - T.geo.height < bandTop - 1) errs.push('藥液槽頂端壓到上方提示帶');
    report.add(
      `${screen.name}  藥液槽`,
      errs,
      `槽 ${tankW.toFixed(0)}×${T.geo.height.toFixed(0)} 晶圓r ${T.waferR.toFixed(0)}`,
    );
  }

  // ── 沉積 / 蝕刻腔體（與 Stage2、Stage5 相同的算法） ──
  {
    const geo = machineBox({
      scene,
      widthRatio: 0.98,
      ratio: 0.72,
      groundY,
      bandTop,
      gap: 16,
      min: 200,
      max: 430,
      maxAspect: 2.4,
    });
    const L = chamberLayout(geo, 'cvd');

    const errs = [];
    if (L.interior.h < 90) errs.push(`腔室太矮 ${L.interior.h.toFixed(0)}px`);
    if (L.wafer.r < 40) errs.push(`晶圓太小 r=${L.wafer.r.toFixed(0)}`);
    if (L.button.r < 22) errs.push(`啟動按鈕太小 r=${L.button.r.toFixed(0)}（手勢按不到）`);
    if (L.lever.bottom - L.lever.top < 60) {
      errs.push(`功率拉桿太短 ${(L.lever.bottom - L.lever.top).toFixed(0)}px`);
    }
    const [v0, v1] = L.valves;
    // 兩顆氣閥可能直立也可能並排（矮機台會自動切換），所以驗「圓心距離」
    // 而不是只驗垂直間距 —— 這樣兩種排法用同一條規則。
    const gap = Math.hypot(v1.cx - v0.cx, v1.cy - v0.cy) - v0.r - v1.r;
    if (gap < 8) errs.push(`兩顆氣閥太近，邊緣只差 ${gap.toFixed(0)}px`);
    if (v0.r < 11) errs.push(`氣閥太小 r=${v0.r.toFixed(0)}，轉不動`);
    if (Math.max(v0.cy + v0.r, v1.cy + v1.r) > L.button.cy - L.button.r - 6) {
      errs.push('氣閥疊到大按鈕');
    }
    // 門把 + 下方狀態文字必須留在機台裡
    const doorTextBottom = L.doorHandle.cy + L.doorHandle.r + 6 + 14;
    if (doorTextBottom > geo.y + geo.h) {
      errs.push(`腔門狀態文字溢出機台 ${(doorTextBottom - geo.y - geo.h).toFixed(0)}px`);
    }
    if (geo.y < bandTop - 1) errs.push(`機台頂端壓到上方提示帶 ${(bandTop - geo.y).toFixed(0)}px`);

    report.add(
      `${screen.name}  腔體`,
      errs,
      `${geo.w.toFixed(0)}×${geo.h.toFixed(0)} 晶圓r ${L.wafer.r.toFixed(0)} 鈕r ${L.button.r.toFixed(0)}`,
    );
  }

  // ── 光罩對準曝光機（與 Stage3 相同的算法） ──
  {
    const geo = machineBox({
      scene,
      widthRatio: 0.98,
      ratio: 0.72,
      groundY,
      bandTop,
      gap: 16,
      min: 220,
      max: 440,
      maxAspect: 2.1,
    });
    const L = alignerLayout(geo);

    const errs = [];
    if (L.wafer.r < 55) errs.push(`晶圓太小 r=${L.wafer.r.toFixed(0)}`);
    if (L.button.r < 24) errs.push(`曝光按鈕太小 r=${L.button.r.toFixed(0)}`);
    const maskTop = L.maskHome.y - L.mask.h / 2;
    const maskBottom = L.maskHome.y + L.mask.h / 2;
    if (maskTop < L.lamp.y + L.lamp.h + 16) {
      errs.push(`光罩撞到 UV 燈管 ${(L.lamp.y + L.lamp.h + 16 - maskTop).toFixed(0)}px`);
    }
    if (maskBottom > L.wafer.cy - L.wafer.r * 0.3) errs.push('光罩壓到晶圓');
    if (maskTop - 21 < geo.y + 30) errs.push('光罩標籤壓到機台名牌');
    if (ALIGN_TOLERANCE < 6) errs.push(`對準容差 ${ALIGN_TOLERANCE} 太嚴苛，手勢對不準`);

    report.add(
      `${screen.name}  曝光機`,
      errs,
      `${geo.w.toFixed(0)}×${geo.h.toFixed(0)} 晶圓r ${L.wafer.r.toFixed(0)} 鈕r ${L.button.r.toFixed(0)}`,
    );
  }
}

// ── 螢幕尺寸偵測 ──
// 支援矩陣裡的尺寸都必須被判定為「可以玩」，
// 而低於下限的尺寸都必須跳出提示——不然玩家會看到壞掉的版面卻不知道原因。
for (const screen of SCREENS) {
  const s = checkViewport(screen.w, screen.h);
  report.add(
    `${screen.name}  尺寸偵測`,
    s.ok ? [] : [`支援矩陣裡的尺寸卻被判定為太小：${s.message}`],
    '可以玩',
  );
}
for (const screen of TOO_SMALL_SCREENS) {
  const s = checkViewport(screen.w, screen.h);
  report.add(
    `${screen.name}  尺寸偵測`,
    s.ok ? ['塞不下卻沒有跳出提示，會畫出壞掉的版面'] : [],
    `提示放大視窗（下限 ${MIN_VIEWPORT.w}×${MIN_VIEWPORT.h}）`,
  );
}

export default () => report.print();
