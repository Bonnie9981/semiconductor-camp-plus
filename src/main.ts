import './style.css';

import { CameraManager } from './core/CameraManager';
import { GestureDetector, drawHandSkeleton } from './core/GestureDetector';
import { StageManager } from './core/StageManager';
import { WaferState } from './core/WaferState';
import { Stage1RCA } from './stages/Stage1RCA';
import { Stage2Deposition } from './stages/Stage2Deposition';
import { Stage3Litho } from './stages/Stage3Litho';
import { Stage4Develop } from './stages/Stage4Develop';
import { Stage5Etch } from './stages/Stage5Etch';
import type { BaseStage } from './stages/BaseStage';
import { CrossSection } from './ui/CrossSection';
import { watchViewport } from './core/Viewport';
import { UIManager } from './ui/UIManager';
import { VirtualDesk } from './ui/VirtualDesk';
import { Exporter } from './utils/Exporter';
import { formatElapsed } from './utils/format';
import {
  canvasToPdf,
  capturePhoto,
  composeCertificate,
  makeSerial,
  type CertificateData,
} from './utils/Certificate';

/**
 * main.ts —— 程式入口
 * ---------------------------------------------------------------------------
 *   1. 建立各個模組並互相接線
 *   2. 註冊五個製程關卡（全部已實作）
 *   3. 把 #stage-view（canvas 群）對齊到 UI 版面中間的鏤空格 #viewport-slot
 *   4. 跑唯一的 rAF 主迴圈：手勢 → 關卡 → 繪製 → UI
 *
 * 關卡順序（依製程實際流程）
 *   1 RCA 清洗 → 2 薄膜沉積 → 3 微影製程 → 4 顯影 → 5 蝕刻
 */

// ─────────────────────────────── DOM 取得 ─────────────────────────────────

const stageView = requireEl<HTMLDivElement>('stage-view');
const viewportSlot = requireEl<HTMLDivElement>('viewport-slot');
const video = requireEl<HTMLVideoElement>('video-element');
const arCanvas = requireEl<HTMLCanvasElement>('ar-canvas');
const deskCanvas = requireEl<HTMLCanvasElement>('desk-canvas');
const handCanvas = requireEl<HTMLCanvasElement>('hand-canvas');
const arCtx = arCanvas.getContext('2d')!;
const handCtx = handCanvas.getContext('2d')!;

// ────────────────────────────── 模組建立 ──────────────────────────────────

const stages = new StageManager();
// pinchOn 的預設值要跟 index.html 的 #set-pinch slider 初始值一致（55 → 0.055）
const gesture = new GestureDetector({ pinchOn: 0.055 });
/** 整條製程共用的同一片晶圓：每一關都在改它的層堆疊與污染狀態。 */
const wafer = new WaferState();

const ui = new UIManager({
  onSelectStage: (index) => stages.goTo(index, ui.isDevMode()),
  onPrimary: () => handlePrimary(),
  onNext: () => stages.advance(),
  onContinue: () => stages.advance(),
  onClearPattern: () => {
    desk.clear();
    ui.setHint('已清除全部圖形，重新捏合畫筆再畫一次吧。');
  },
  onPenColor: (color) => desk.setPenColor(color),
  onPenWidth: (width) => desk.setPenWidth(width),
  onPinchSensitivity: (threshold) => gesture.setPinchThreshold(threshold),
  onToggleMirror: () => {
    const mirrored = camera.toggleMirror();
    gesture.setMirror(mirrored);
    ui.setMirrorLabel(mirrored);
  },
  onToggleCamera: () => {
    void camera.toggleFacing().then((facing) => ui.setCameraLabel(facing));
  },
  onToggleSkeleton: (visible) => {
    showSkeleton = visible;
  },
  onExportPNG: () => Exporter.downloadPNG(desk.composeWaferImage(1024), 'wafer-pattern.png'),
  onExportSTL: () => {
    // 正光阻：光阻留在畫到的地方 → 那些地方被保護 → 圖案凸起
    // 負光阻：光阻留在沒畫到的地方 → 畫到的地方被蝕掉 → 圖案凹陷
    const negative = wafer.resistTone === 'negative';
    Exporter.downloadSTL(
      desk.getPatternCanvas(),
      `wafer-${negative ? 'negative-recessed' : 'positive-raised'}.stl`,
      {
        waferRadiusMm: 100,
        baseThicknessMm: 1.5,
        patternHeightMm: 1.2,
        invert: negative,
      },
    );
  },
  onExportPDF: () => void downloadCertificatePdf(),
  onRetakePhoto: () => openCertificate(true),
  onPlayAgain: () => resetEverything(),
  onForceComplete: () => {
    // 已經完成就直接前進，方便連按快速走完整條流程
    if (stages.isCurrentDone()) stages.advance();
    else stages.forceCompleteCurrent();
  },
  onDevMode: (enabled) => {
    // 開關狀態存在 UIManager（isDevMode()），這裡只負責重繪關卡列與提示
    ui.syncStages(stages);
    ui.setHint(
      enabled ? '🛠️ 開發者模式已開啟 —— 左側任一關卡都可以直接點選跳關。' : stages.current.hint,
    );
  },
  onStageAction: () => {
    if (stages.isCurrentDone()) stages.advance();
    else handlePrimary();
  },
  onRetry: () => stages.restartCurrent(),
  // 確認已由 UIManager 的自訂確認框處理（原生 confirm 沒辦法用捏合手勢按）
  onExit: () => resetEverything(),
});

const desk = new VirtualDesk(deskCanvas, ui.getPreviewCanvas());
const crossSection = new CrossSection(ui.getSectionCanvas());

const camera = new CameraManager({
  video,
  stageView,
  onStatus: (status, message) => ui.setCameraStatus(status, message),
});

// ────────────────────────────── 關卡註冊 ──────────────────────────────────
// 註冊順序 = 關卡順序。新增關卡只需在這裡多 register 一個 BaseStage 子類別。

stages
  .register(new Stage1RCA())
  .register(new Stage2Deposition())
  .register(new Stage3Litho())
  .register(new Stage4Develop())
  .register(new Stage5Etch());

stages.attachContext({ ui, desk, stages, wafer });

// ───────────────────────────── 關卡事件 → UI ──────────────────────────────

stages.subscribe((event) => {
  switch (event.type) {
    case 'change':
    case 'reset':
    case 'substep':
      ui.syncStages(stages);
      break;
    case 'complete':
      ui.syncStages(stages);
      // 全部完成時走證書流程（在 'allComplete' 處理），不開一般的結算視窗
      if (stages.doneCount < stages.total) openClearModal(event.stage);
      break;
    case 'fail':
      ui.showFail(event.reason);
      break;
    case 'allComplete':
      // 先把時間定格，證書上印的才是實際的製程時間（不含後面的延遲與看證書的時間）
      finishedMs = performance.now() - startedAt;
      /*
        刻意延遲。玩家是用捏合按下「完成蝕刻」的，手往往還停在原處；
        證書一瞬間跳出來，同一次捏合的殘留判定就可能直接打到「再玩一次」。
        先顯示一段收尾提示，1.6 秒後才開證書。
      */
      ui.setArHint('🎉 五道製程全部完成 — 正在產生結業證書…', true);
      ui.setStageAction(null);
      window.setTimeout(() => openCertificate(true), 1600);
      break;
  }
});

/** 整場重來：清掉圖案、晶圓狀態與證書，關卡回到第一關。 */
function resetEverything(): void {
  desk.clear();
  wafer.reset();
  resetTimer();
  lastPhoto = null;
  serial = null;
  certificate = null;
  stages.reset();
}

function handlePrimary(): void {
  const stage = stages.current;
  if (stages.isCurrentDone() || !stage.canComplete()) return;
  stages.completeCurrent(stage.buildResult());
}

/**
 * 單一關卡完成時的結算視窗。
 * 刻意**不提供任何下載** —— 3D 模型與圖片要等五道製程全部走完、
 * 在結業證書那一頁一起給，中途下載到的是半成品。
 */
function openClearModal(stage: BaseStage): void {
  const hasPattern = desk.strokeCount > 0;
  ui.showSuccess({
    title: `${stage.title} 完成！`,
    description: `${stage.title} 已完成，下一個製程步驟已解鎖。`,
    image: hasPattern ? desk.composeWaferImage(440) : null,
    continueLabel: '繼續下一步 →',
    showExports: false,
  });
}

// ──────────────────────────────── 計時器 ──────────────────────────────────
// 從進入遊戲開始算，五道製程全部完成時定格。顯示在左側面板，
// 並印在結業證書上當成玩家的成績。

let startedAt = performance.now();
/** 全部完成時的定格值；null = 還在跑。 */
let finishedMs: number | null = null;

function elapsedMs(): number {
  return finishedMs ?? performance.now() - startedAt;
}

function resetTimer(): void {
  startedAt = performance.now();
  finishedMs = null;
}

// ─────────────────────────────── 結業證書 ─────────────────────────────────

let certificate: HTMLCanvasElement | null = null;

/** 依目前的製程紀錄排版證書；recapture 為 true 時重新拍一張照片。 */
function openCertificate(recapture: boolean): void {
  const date = new Date();
  const deposition = stages.resultOf('deposition') as { method?: string } | undefined;
  const litho = stages.resultOf('litho') as { tone?: string } | undefined;
  const etch = stages.resultOf('etching') as { etchMethod?: string } | undefined;

  const data: CertificateData = {
    photo: recapture ? capturePhoto(video, camera.isMirrored()) : lastPhoto,
    wafer: desk.composeWaferImage(720),
    method: deposition?.method === 'cvd' ? '化學氣相沉積 CVD' : '物理氣相沉積 PVD',
    tone: litho?.tone === 'negative' ? '負型光阻' : '正型光阻',
    etch: etch?.etchMethod === 'wet' ? '濕式蝕刻 · 側向' : '乾式蝕刻 · 鉛直',
    date,
    elapsed: formatElapsed(elapsedMs()),
    serial: serial ?? (serial = makeSerial(date)),
  };
  lastPhoto = data.photo;

  certificate = composeCertificate(data);
  ui.showCertificate(certificate);
}

let lastPhoto: HTMLCanvasElement | null = null;
let serial: string | null = null;

async function downloadCertificatePdf(): Promise<void> {
  if (!certificate) return;
  const blob = await canvasToPdf(certificate);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `semiconductor-certificate-${serial ?? 'result'}.pdf`;
  a.click();
  // 交給瀏覽器抓取後再釋放，立刻 revoke 在 Safari 會下載到空檔
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ──────────────────────── 版面同步：canvas ↔ UI 鏤空格 ─────────────────────
// #stage-view 是 position:fixed 的影像層，必須精準疊在 UI 版面中間那格上，
// 才會看起來像是「嵌在 Dashboard 裡的鏡頭視窗」。

let viewW = 1;
let viewH = 1;
/** #stage-view 在視窗中的左上角座標；把 canvas 座標換算成 clientX/Y 時要用。 */
let viewLeft = 0;
let viewTop = 0;

function syncStageView(): void {
  const rect = viewportSlot.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;

  stageView.style.inset = 'auto';
  stageView.style.left = `${rect.left}px`;
  stageView.style.top = `${rect.top}px`;
  stageView.style.width = `${rect.width}px`;
  stageView.style.height = `${rect.height}px`;

  viewW = rect.width;
  viewH = rect.height;
  viewLeft = rect.left;
  viewTop = rect.top;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  arCanvas.width = Math.round(viewW * dpr);
  arCanvas.height = Math.round(viewH * dpr);
  arCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 手部圖層疊在所有 UI 之上，但用的是同一組座標，所以跟 #stage-view 對齊即可
  handCanvas.style.left = `${rect.left}px`;
  handCanvas.style.top = `${rect.top}px`;
  handCanvas.style.width = `${rect.width}px`;
  handCanvas.style.height = `${rect.height}px`;
  handCanvas.width = Math.round(viewW * dpr);
  handCanvas.height = Math.round(viewH * dpr);
  handCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  desk.resize(viewW, viewH, dpr);
  gesture.setCanvasSize(viewW, viewH);
}

new ResizeObserver(syncStageView).observe(viewportSlot);
window.addEventListener('resize', syncStageView);
// 證書預覽與上方帶狀元素的位置都是量出來的，視窗一變就要重算
window.addEventListener('resize', () => {
  ui.syncCertificateSize();
  ui.flushBands(true);
});

/*
  --hud-reserve 決定互動面板的下緣停在哪裡。它原本是每個高度級距寫死的數字，
  但左下角卡片群（截面圖 / 已繪製圖形）的實際高度會隨字級、關卡、
  哪些卡片顯示而變 —— 寫死就一定有幾 px 的誤差，面板下緣就疊到卡片上。
  改成量 .vp-bottom 的真實高度寫回 CSS 變數，誤差歸零。
*/
function syncHudReserve(): void {
  const bottom = document.querySelector<HTMLElement>('.vp-bottom');
  if (!bottom) return;
  const h = bottom.getBoundingClientRect().height;
  // 卡片可能全部隱藏（height 0），這時仍留一點呼吸空間
  document.documentElement.style.setProperty(
    '--hud-reserve',
    `${Math.max(24, Math.round(h) + 16)}px`,
  );
}
new ResizeObserver(syncHudReserve).observe(
  requireEl<HTMLElement>('viewport-slot').querySelector('.vp-bottom') ??
    requireEl<HTMLElement>('viewport-slot'),
);
syncHudReserve();

/*
  版面探測鉤子。scripts/checks/browser.mjs 開真 Chrome 量 HUD 卡片的位置，
  但 canvas 上的道具是畫出來的、DOM 上看不到 —— 所以由關卡把座標講出來。
  只是讀取當前幀已經算好的值，沒有任何副作用。
*/
interface LayoutProbeWindow extends Window {
  __layoutProbe?: () => unknown;
}
(window as LayoutProbeWindow).__layoutProbe = () => stages.current.propBoxes;

// 載入時先偵測螢幕大小：太小就直接告訴玩家怎麼處理，而不是畫出壞掉的版面
watchViewport(
  requireEl<HTMLElement>('viewport-warning'),
  requireEl<HTMLElement>('viewport-warning-detail'),
);
window.addEventListener('orientationchange', syncStageView);

// ─────────────────────────────── 主迴圈 ───────────────────────────────────

let showSkeleton = true;
let lastTime = performance.now();
let elapsed = 0;

function loop(now: number): void {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  elapsed += dt;

  // 影像實際解析度會在 metadata 載入後才有值，用來做 object-fit:cover 映射
  const size = camera.getVideoSize();
  if (size.width > 0 && size.height > 0) gesture.setVideoSize(size.width, size.height);

  const snapshot = camera.read();
  const hand = gesture.update(snapshot.landmarks, snapshot.handedness);

  // 1) AR 層（道具）與手部層（骨架）各自清空。
  //    骨架畫在獨立的 #hand-canvas 上，才會蓋在左側互動面板等 HTML 之上。
  arCtx.clearRect(0, 0, viewW, viewH);
  handCtx.clearRect(0, 0, viewW, viewH);
  if (showSkeleton) drawHandSkeleton(handCtx, hand);

  // 2) 桌面層：桌子 + Chuck + 晶圓 + 已畫的圖形
  desk.renderBase();

  /*
    3) 上方帶狀元素（鏡頭設定列 / 子步驟列 / AR 提示 / 面板起點）依序重排。
       必須在關卡 onFrame 之前 —— 關卡要用 sceneOverlay() 量它們的位置來決定
       道具畫在哪，量到舊值就會有一幀的錯位。
       內容沒變時 flushBands() 立即返回，不會每幀 reflow。
  */
  ui.flushBands();

  // 4) 關卡邏輯（Modal 開啟時暫停互動，避免在看結算時繼續畫線）
  if (!ui.isModalOpen()) {
    stages.current.onFrame({
      ui,
      desk,
      stages,
      wafer,
      hand,
      ar: arCtx,
      width: viewW,
      height: viewH,
      dt,
      time: elapsed,
    });
  }

  // 4) 捏合當滑鼠：把捏合點換算成視窗座標。
  //    Modal 開啟時也要保持啟用 —— 結算與證書畫面上的按鈕同樣得能用手按，
  //    否則玩到一半就必須換回滑鼠。關卡互動本來就已經在 Modal 期間暫停了。
  ui.updatePinchPointer(
    viewLeft + hand.pinchPoint.x,
    viewTop + hand.pinchPoint.y,
    hand.present,
    hand.justPinched,
  );

  // 5) UI：截面圖 + 右上角手勢參考 + 主要按鈕可用狀態
  if (stages.current.usesCrossSection) crossSection.render(wafer, elapsed);
  ui.renderGestureRef(hand);
  ui.setElapsed(elapsedMs(), finishedMs !== null);

  const done = stages.isCurrentDone();
  const canComplete = stages.current.canComplete();
  ui.setPrimaryEnabled(!done && canComplete);
  ui.setStageAction(
    ui.isModalOpen()
      ? null
      : done
        ? stages.hasNext()
          ? '下一步'
          : null
        : canComplete
          ? stages.current.primaryLabel
          : null,
  );

  requestAnimationFrame(loop);
}

// ─────────────────────────────── 啟動 ────────────────────────────────────

// 開發模式下把模組掛到 window，方便沒有攝影機時在 DevTools 手動驗證流程：
//   __camp.desk.beginStroke(500, 560); __camp.desk.strokeTo(560, 600); __camp.desk.endStroke();
//   __camp.stages.completeCurrent({});   // 直接過關
//   __camp.gesture.setPinchThreshold(0.08);
if (import.meta.env.DEV) {
  Object.assign(window, { __camp: { stages, desk, ui, camera, gesture, wafer, Exporter } });
}

syncStageView();
stages.start();
ui.syncStages(stages);
ui.setMirrorLabel(camera.isMirrored());
ui.setCameraLabel(camera.getFacing());
gesture.setMirror(camera.isMirrored());
requestAnimationFrame(loop);

void camera.start('user');

function requireEl<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`main.ts: 找不到 #${id}`);
  return node as T;
}
