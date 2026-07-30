/**
 * WetBenchLayout —— RCA 濕式清洗檯的版面計算
 * ---------------------------------------------------------------------------
 * 抽成純函式有兩個理由：
 *   1. 版面錯誤（元素互相壓到）沒辦法靠型別檢查抓出來，只能算給它看。
 *      抽出來之後 `npm run check` 就能對各種螢幕尺寸驗證真正的計算，
 *      而不是複製一份。
 *   2. 原本藥瓶層板與燒杯是**各自獨立**算出來的：燒杯吃掉可用高度的 29%，
 *      層板只留 `clamp(height × 0.045, 14, 40)` 的間隙給自己。視窗一矮，
 *      間隙縮到 27px，但藥瓶名稱是掛在瓶底**下方** 0.24×瓶寬 + 一行字，
 *      比間隙還高 —— 名稱就壓進燒杯裡了。
 *
 * 現在改成**由下往上依序分配**同一段垂直空間：
 *
 *      bandTop ─────────────────────  上方提示帶的下緣
 *         │        藥瓶（高度由剩餘空間決定）
 *      shelfY ────────────────────── 瓶底＝層板
 *         │        藥瓶名稱 + 間隙
 *      beakerTop ──────────────────
 *         │        燒杯
 *      groundY ────────────────────  器材站立的基準線
 *
 * 這樣不論視窗多矮，藥瓶名稱都不可能落到燒杯上。
 */

/** 場景可用的水平範圍（已避開左側的互動面板）。 */
export interface SceneBounds {
  left: number;
  right: number;
  w: number;
}

export interface WetBenchLayout {
  /** 調配杯靜置在檯面上時的位置。 */
  beaker: { cx: number; top: number; width: number; height: number };
  /** 藥瓶那一排。 */
  shelf: {
    /** 瓶底 y（＝層板高度）。 */
    y: number;
    /** 這一排的右界。可能比 scene.right 小，用來讓開右上角的卡片。 */
    right: number;
    /** 單一瓶身寬度。 */
    w: number;
    /** 瓶身高度。 */
    bottleH: number;
    /** 層板橫線的 y。 */
    plankY: number;
    /** 瓶名文字的下緣，用來驗證有沒有壓到燒杯。 */
    labelBottom: number;
  };
  /** 廢液桶。 */
  drain: { cx: number; baseY: number; width: number };
  /** 等待下水的晶圓。 */
  waferStand: { cx: number; cy: number; r: number };
}

/** 名稱與燒杯口之間至少要留的空隙。 */
const LABEL_GAP = 8;
/** 瓶名文字本身的高度（字級 + 行距）。 */
const LABEL_TEXT_H = 16;
/** 晶圓平放時的垂直壓扁比例，與 drawFlatWafer 一致。 */
const WAFER_SQUASH = 0.3;

export function wetBenchLayout(opts: {
  scene: SceneBounds;
  /** canvas 高度。 */
  height: number;
  /** 器材站立的基準線。 */
  groundY: number;
  /** 檯面上有幾瓶藥液。 */
  bottleCount: number;
  /**
   * 上方帶狀 HTML（子步驟列 / AR 提示）的下緣，由 UIManager.sceneOverlay() 量出來。
   * 不給就退回 height × 0.2 的估值。
   */
  overlayTop?: number;
  /**
   * 右上角手勢參考卡的左緣與下緣（沒有卡片時 cardLeft = Infinity）。
   * 層板那一排如果落在卡片的高度範圍內，就要提早結束，不然最右邊的瓶子會被蓋住。
   */
  cardLeft?: number;
  cardBottom?: number;
}): WetBenchLayout {
  const { scene, height, groundY, bottleCount } = opts;
  const cardLeft = opts.cardLeft ?? Number.POSITIVE_INFINITY;
  const cardBottom = opts.cardBottom ?? 0;

  // 可用的垂直帶：上緣是量出來的，不是猜的比例
  const bandTop = Math.max(opts.overlayTop ?? height * 0.2, 8) + 8;
  const bandH = Math.max(160, groundY - bandTop);

  // 燒杯最多吃掉這段帶狀空間的 46%，剩下的留給藥瓶與名稱
  const beakerH = clamp(Math.min(bandH * 0.46, scene.w * 0.46), 96, 196);
  const beakerTop = groundY - beakerH;
  const beakerW = beakerH * 0.76;
  const waferR = beakerW * 0.34;

  /*
    燒杯的水平位置不是固定比例 —— 左邊必須留得下「待清洗晶圓」的載盤，
    否則晶圓會被擠到燒杯裡面。所以取「固定比例」與「晶圓需要的寬度」的較大者。
  */
  const leftRoom = waferR * 2 + 34;
  const beaker = {
    cx: scene.left + Math.max(scene.w * 0.26, leftRoom + beakerW / 2),
    top: beakerTop,
    width: beakerW,
    height: beakerH,
  };

  /*
    瓶名掛在瓶底**下方** 0.24×瓶寬處，所以它佔掉的高度跟瓶寬有關。
    先用「橫向排得下」算出瓶寬上界，據此保留足夠空隙，再用剩下的高度收斂瓶寬——
    後者只會讓瓶寬變小、名稱變矮，所以空隙一定夠，不會反過來壓到燒杯。
  */
  /*
    層板那一排的右界：如果瓶子的高度範圍會撞到右上角的手勢參考卡，
    就在卡片左邊收尾。瓶子稍微擠一點，總比最右邊兩瓶被蓋掉好。
    （矮視窗上 CSS 會直接把卡片隱藏，那時 cardLeft = Infinity，這裡不生效。）
  */
  const shelfRight = bandTop < cardBottom ? Math.min(scene.right, cardLeft - 10) : scene.right;
  const shelfW = Math.max(160, shelfRight - scene.left);

  const wByWidth = clamp((shelfW / bottleCount) * 0.74, 30, 70);
  const labelExtent = wByWidth * 0.24 + LABEL_TEXT_H;
  const shelfY = beakerTop - LABEL_GAP - labelExtent;

  const maxBottleH = Math.max(40, shelfY - bandTop);
  const w = clamp(Math.min(wByWidth, maxBottleH / 1.7), 30, 70);

  const drainW = clamp(scene.w * 0.13, 46, 78);

  return {
    beaker,
    shelf: {
      y: shelfY,
      right: shelfRight,
      w,
      bottleH: w * 1.7,
      plankY: shelfY + w * 0.2,
      labelBottom: shelfY + w * 0.24 + 14,
    },
    drain: { cx: scene.right - drainW * 0.55, baseY: groundY, width: drainW },
    waferStand: {
      // 擺在燒杯左邊。beaker.cx 已經保證這裡放得下，所以只要靠著左界排即可。
      cx: scene.left + waferR + 10,
      cy: groundY - Math.max(8, waferR * 0.22) - waferR * WAFER_SQUASH,
      r: waferR,
    },
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
