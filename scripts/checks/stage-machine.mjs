/**
 * 關卡狀態機檢查（真實的 Stage 類別）
 * ---------------------------------------------------------------------------
 * wafer-state.mjs 的 ③「devComplete 鏈」是照各關實作**重寫**的一份副本 ——
 * 改了某一關的 devComplete() 而忘了同步腳本，測試會過但行為已經變了。
 *
 * 這支檢查改成 import 真正的 Stage 類別，用一個窄的假 StageContext
 * （關卡在 onEnter/onExit/onSubEnter/devComplete/buildResult 只會呼叫
 *   ui.setPanel、desk.setWaferVisible/setDeskLabel/setPen*、desk.coverage()…
 *   都不需要真的 canvas），跑完整條 StageManager 生命週期：
 *
 *   start → forceCompleteCurrent → advance → …（五關）
 *
 * 涵蓋的是「玩家什麼都沒選」的預設路線（PVD / 正光阻 / 乾式蝕刻）——
 * 這條路線現在測的是**會出貨的那份 devComplete()**，不是副本。
 * 其他 7 種分支組合仍由 wafer-state.mjs 的重寫版矩陣涵蓋（method / tone /
 * etchMethod 是 private，沒有 gameplay 之外的注入點）。
 */
import { Report, SRC } from './lib.mjs';

const { StageManager } = await import(`${SRC}core/StageManager.ts`);
const { WaferState, SECTION_CELLS } = await import(`${SRC}core/WaferState.ts`);
const { Stage1RCA } = await import(`${SRC}stages/Stage1RCA.ts`);
const { Stage2Deposition } = await import(`${SRC}stages/Stage2Deposition.ts`);
const { Stage3Litho } = await import(`${SRC}stages/Stage3Litho.ts`);
const { Stage4Develop } = await import(`${SRC}stages/Stage4Develop.ts`);
const { Stage5Etch } = await import(`${SRC}stages/Stage5Etch.ts`);

const report = new Report('關卡狀態機（真實 Stage 類別）');

/**
 * 窄的假 StageContext。任何被呼叫到的方法都回傳無害的預設值；
 * 若哪天關卡在這些生命週期方法裡開始用到別的東西，這裡會炸掉提醒你。
 */
function makeStubContext(wafer) {
  const noop = () => undefined;
  const deskValues = {
    coverage: () => 0, // 0 → Stage3.devComplete() 走條紋 fallback，不碰 canvas
    getPatternDataURL: () => 'data:,',
    getPatternCanvas: () => {
      throw new Error('stage-machine: 預設路線不該讀 patternCanvas（coverage 應為 0）');
    },
  };
  const trap = (values) =>
    new Proxy(
      {},
      {
        get: (_t, prop) =>
          typeof prop === 'string' && prop in values ? values[prop] : noop,
      },
    );

  const stages = new StageManager();
  const ctx = { ui: trap({}), desk: trap(deskValues), stages, wafer };
  return { ctx, stages };
}

/**
 * permissive 的 2D context 替身：任何繪圖方法都是 no-op，
 * 會回傳值的（gradient / measureText / getImageData）給剛好夠用的結果，
 * 屬性（fillStyle…）可讀可寫。用來讓關卡的 onFrame() 真的跑一遍繪圖路徑。
 */
function makeCtx2D() {
  const state = {};
  const grad = { addColorStop() {} };
  const methods = {
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, rect() {}, roundRect() {},
    ellipse() {}, bezierCurveTo() {}, quadraticCurveTo() {},
    fill() {}, stroke() {}, clip() {},
    fillRect() {}, strokeRect() {}, clearRect() {},
    fillText() {}, strokeText() {},
    translate() {}, rotate() {}, scale() {}, transform() {}, setTransform() {}, resetTransform() {},
    drawImage() {}, putImageData() {}, setLineDash() {}, getLineDash: () => [],
    createLinearGradient: () => grad, createRadialGradient: () => grad, createConicGradient: () => grad,
    createPattern: () => null,
    measureText: () => ({ width: 0 }),
    getImageData: (_x, _y, w, h) => ({
      data: new Uint8ClampedArray(Math.max(0, w | 0) * Math.max(0, h | 0) * 4),
      width: w,
      height: h,
    }),
    isPointInPath: () => false,
    isPointInStroke: () => false,
  };
  return new Proxy(methods, {
    get: (t, p) =>
      p in t ? t[p] : p === 'canvas' ? { width: 1280, height: 720 } : p in state ? state[p] : () => undefined,
    set: (_t, p, v) => ((state[p] = v), true),
  });
}

/** 沒有手的那一幀。 */
const EMPTY_HAND = {
  present: false,
  landmarks: [],
  normalized: [],
  pinching: false,
  justPinched: false,
  justReleased: false,
  pinchPoint: { x: 0, y: 0 },
  pinchDistance: 1,
  handedness: '',
};

/** 給 onFrame() 用的假 StageContext：多補上繪圖需要的 context / size / geometry。 */
function makeFrameStubs(wafer) {
  const ctx2d = makeCtx2D();
  const geometry = {
    deskTop: 520, deskHeight: 190, deskBottom: 710,
    waferCX: 640, waferCY: 430, waferR: 120, groundY: 590,
    width: 1280, height: 720,
  };
  const deskValues = {
    coverage: () => 0,
    getPatternDataURL: () => 'data:,',
    getPatternCanvas: () => ({ width: 512, height: 512, getContext: () => makeCtx2D() }),
    context: ctx2d,
    size: { width: 1280, height: 720 },
    geometry,
    isOnWafer: () => false,
  };
  const uiValues = {
    panelInset: () => 0,
    sceneOverlay: () => ({ top: 40, bottom: 700, left: 0, right: 1280, panelRight: 0 }),
  };
  const trap = (values) =>
    new Proxy({}, { get: (_t, p) => (typeof p === 'string' && p in values ? values[p] : () => undefined) });

  const stages = new StageManager();
  const stageCtx = { ui: trap(uiValues), desk: trap(deskValues), stages, wafer };
  const frame = {
    ...stageCtx,
    hand: EMPTY_HAND,
    ar: ctx2d,
    width: 1280,
    height: 720,
    dt: 1 / 60,
    time: 0,
  };
  return { stageCtx, stages, frame };
}

// ── 跑完整條預設路線 ──
{
  const wafer = new WaferState();
  const { ctx, stages } = makeStubContext(wafer);

  stages
    .register(new Stage1RCA())
    .register(new Stage2Deposition())
    .register(new Stage3Litho())
    .register(new Stage4Develop())
    .register(new Stage5Etch());
  stages.attachContext(ctx);

  const errs = [];
  try {
    stages.start();
    for (let i = 0; i < 5; i++) {
      stages.forceCompleteCurrent(); // 真的呼叫 stage.devComplete() + buildResult()
      if (stages.hasNext()) stages.advance();
    }
  } catch (e) {
    errs.push(`生命週期丟出例外：${e.message}`);
  }

  if (stages.doneCount !== 5) errs.push(`只完成 ${stages.doneCount}/5 關`);
  if (!wafer.isClean) errs.push('RCA 後晶圓沒洗乾淨');
  if (!wafer.hasLayer('metal')) errs.push('沒有金屬層 → 證書與 STL 會拿到空白晶圓');
  if (wafer.hasLayer('resist')) errs.push('第五關沒剝掉光阻');
  if (wafer.resistTone !== 'positive') errs.push(`預設應為正光阻，得到 ${wafer.resistTone}`);
  const through = wafer.etchedMask.filter((v) => v > 0.9).length;
  if (through === 0 || through === SECTION_CELLS) errs.push('蝕刻結果沒有圖案（全通或全不通）');

  report.add(
    '五關預設路線（PVD / 正光阻 / 乾式）',
    errs,
    `層 ${wafer.layers.map((l) => l.kind).join('+')}、蝕穿 ${through}/${SECTION_CELLS}`,
  );

  // 每一關的 buildResult() 都要回傳非空物件（證書那頁會讀）
  for (const id of ['rca-clean', 'deposition', 'litho', 'develop', 'etching']) {
    const r = stages.resultOf(id);
    report.add(
      `buildResult('${id}') 有內容`,
      r && typeof r === 'object' && Object.keys(r).length > 0 ? [] : [`得到 ${JSON.stringify(r)}`],
      r ? Object.keys(r).join(', ') : '—',
    );
  }
}

// ── StageManager 的鎖定規則：沒 force 不能跳進 locked 關 ──
{
  const wafer = new WaferState();
  const { ctx, stages } = makeStubContext(wafer);
  stages.register(new Stage1RCA()).register(new Stage2Deposition());
  stages.attachContext(ctx);
  stages.start();

  const errs = [];
  if (stages.goTo(1) !== false) errs.push('未 force 竟然跳進了 locked 的第二關');
  if (stages.currentIndex !== 0) errs.push('跳關失敗後 currentIndex 不該變');
  if (stages.goTo(1, true) !== true) errs.push('force=true 應該要能跳進 locked 關');
  report.add('locked 關卡的跳關規則', errs);
}

// ── onFrame() 冒煙測試：每一關進場後空跑幾幀，不可以丟例外或自己過關 ──
{
  const makeStage = {
    'RCA 清洗': () => new Stage1RCA(),
    薄膜沉積: () => new Stage2Deposition(),
    微影製程: () => new Stage3Litho(),
    顯影: () => new Stage4Develop(),
    蝕刻: () => new Stage5Etch(),
  };

  for (const [name, ctor] of Object.entries(makeStage)) {
    const wafer = new WaferState();
    // 顯影 / 蝕刻的 onEnter 會自己補光阻層，其餘關卡先給一個乾淨起點
    const { stageCtx, frame } = makeFrameStubs(wafer);
    const stage = ctor();

    const errs = [];
    try {
      stage.onEnter(stageCtx);
      const sub0 = stage.subIndex;
      for (let i = 0; i < 8; i++) {
        stage.onFrame({ ...frame, time: i / 60 });
      }
      // 沒有手、沒有任何輸入，不該推進子步驟，也不該變成可完成
      if (stage.subCount > 0 && stage.subIndex !== sub0) {
        errs.push(`空跑 8 幀後子步驟從 ${sub0} 跳到 ${stage.subIndex}`);
      }
      if (stage.canComplete() && stage.subCount > 0) {
        errs.push('沒做任何事就回報 canComplete() = true');
      }
      stage.onExit();
    } catch (e) {
      errs.push(`onFrame 丟出例外：${e.message}`);
    }

    report.add(`${name}：onEnter + 8 幀 onFrame 空跑`, errs, `子步驟停在 ${stage.subIndex}/${stage.subCount}`);
  }
}

export default () => report.print();
