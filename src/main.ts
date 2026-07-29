import './style.css';

import { CameraManager } from './core/CameraManager';
import { GestureDetector, drawHandSkeleton } from './core/GestureDetector';
import { StageManager } from './core/StageManager';
import { Stage1DrawPattern } from './stages/Stage1DrawPattern';
import { StagePlaceholder } from './stages/StagePlaceholder';
import type { BaseStage } from './stages/BaseStage';
import { UIManager } from './ui/UIManager';
import { VirtualDesk } from './ui/VirtualDesk';
import { Exporter } from './utils/Exporter';

/**
 * main.ts —— 程式入口
 * ---------------------------------------------------------------------------
 *   1. 建立各個模組並互相接線
 *   2. 註冊六個關卡（第 1 關已實作，2~6 關為 Stub）
 *   3. 把 #stage-view（canvas 群）對齊到 UI 版面中間的鏤空格 #viewport-slot
 *   4. 跑唯一的 rAF 主迴圈：手勢 → 關卡 → 繪製 → UI
 */

// ─────────────────────────────── DOM 取得 ─────────────────────────────────

const stageView = requireEl<HTMLDivElement>('stage-view');
const viewportSlot = requireEl<HTMLDivElement>('viewport-slot');
const video = requireEl<HTMLVideoElement>('video-element');
const arCanvas = requireEl<HTMLCanvasElement>('ar-canvas');
const deskCanvas = requireEl<HTMLCanvasElement>('desk-canvas');
const arCtx = arCanvas.getContext('2d')!;

// ────────────────────────────── 模組建立 ──────────────────────────────────

const stages = new StageManager();
const gesture = new GestureDetector({ pinchOn: 0.05 });

const ui = new UIManager({
  onSelectStage: (index) => stages.goTo(index),
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
  onExportSTL: () =>
    Exporter.downloadSTL(desk.getPatternCanvas(), 'wafer-pattern.stl', {
      resolution: 120,
      waferRadiusMm: 100,
      baseThicknessMm: 1.5,
      patternHeightMm: 1.2,
    }),
  onRetry: () => stages.restartCurrent(),
  onExit: () => {
    if (!window.confirm('要結束目前進度並回到第一關嗎？')) return;
    desk.clear();
    stages.reset();
  },
});

const desk = new VirtualDesk(deskCanvas, ui.getPreviewCanvas());

const camera = new CameraManager({
  video,
  stageView,
  onStatus: (status, message) => ui.setCameraStatus(status, message),
});

// ────────────────────────────── 關卡註冊 ──────────────────────────────────
// 註冊順序 = 關卡順序。要實作第 2 關就把下面的 StagePlaceholder 換成你的類別。

stages
  .register(new Stage1DrawPattern())
  .register(
    new StagePlaceholder({
      id: 'coating',
      title: '塗佈光阻',
      shortTitle: '光阻塗佈',
      description: '抓取燒杯把光阻倒到晶圓上，再用旋轉塗佈（spin coating）鋪平。',
      hint: '（尚未實作）此關預計以 Pinch 抓取燒杯，傾斜手腕即可倒出光阻。',
      props: ['燒杯', '旋轉塗佈機'],
    }),
  )
  .register(
    new StagePlaceholder({
      id: 'exposure',
      title: '曝光顯影',
      shortTitle: '曝光顯影',
      description: '把第一關畫好的光罩對準晶圓，曝光後再顯影出圖形。',
      hint: '（尚未實作）此關預計以雙手對位光罩，並在此導入正／負光阻切換。',
      props: ['光罩', '曝光機'],
    }),
  )
  .register(
    new StagePlaceholder({
      id: 'etching',
      title: '蝕刻',
      shortTitle: '蝕刻',
      description: '以蝕刻液或電漿把沒有被光阻保護的區域移除。',
      hint: '（尚未實作）此關預計以 Pinch 抓取晶圓夾，把晶圓浸入蝕刻槽。',
      props: ['晶圓夾', '蝕刻槽'],
    }),
  )
  .register(
    new StagePlaceholder({
      id: 'deposition',
      title: '薄膜沉積',
      shortTitle: '薄膜沉積',
      description: '在圖形化後的晶圓上長出金屬或介電質薄膜。',
      hint: '（尚未實作）此關預計以手勢控制沉積腔體的參數與時間。',
      props: ['濺鍍靶材', '腔體'],
    }),
  )
  .register(
    new StagePlaceholder({
      id: 'inspection',
      title: '檢測封裝',
      shortTitle: '檢測封裝',
      description: '量測線寬與缺陷，通過後切割並封裝成晶片。',
      hint: '（尚未實作）此關預計以 Pinch 縮放顯微鏡視野找出缺陷。',
      props: ['顯微鏡', '封裝載板'],
    }),
  );

stages.attachContext({ ui, desk, stages });

// ───────────────────────────── 關卡事件 → UI ──────────────────────────────

stages.subscribe((event) => {
  switch (event.type) {
    case 'change':
    case 'reset':
      ui.syncStages(stages);
      break;
    case 'complete':
      ui.syncStages(stages);
      openClearModal(event.stage);
      break;
    case 'fail':
      ui.showFail(event.reason);
      break;
    case 'allComplete':
      // Modal 已在 'complete' 事件中處理，這裡只留給音效 / 成就等副作用
      break;
  }
});

function handlePrimary(): void {
  const stage = stages.current;
  if (stages.isCurrentDone() || !stage.canComplete()) return;
  stages.completeCurrent(stage.buildResult());
}

function openClearModal(stage: BaseStage): void {
  const isFinal = stages.doneCount === stages.total;
  const hasPattern = desk.strokeCount > 0;

  ui.showSuccess({
    title: isFinal ? '製程全部完成！' : `${stage.title} 完成！`,
    description: isFinal
      ? '恭喜完成整條製程。下方是你的最終晶圓圖案，可下載 PNG 或擠出成 3D 模型。'
      : hasPattern
        ? '光罩圖形已送出。你可以先把成品存下來，再繼續下一個製程步驟。'
        : '此步驟為示範用的空關卡，已標記完成並解鎖下一步。',
    image: hasPattern ? desk.composeWaferImage(440) : null,
    continueLabel: isFinal ? '關閉' : '繼續下一步 →',
    showExports: hasPattern,
  });
}

// ──────────────────────── 版面同步：canvas ↔ UI 鏤空格 ─────────────────────
// #stage-view 是 position:fixed 的影像層，必須精準疊在 UI 版面中間那格上，
// 才會看起來像是「嵌在 Dashboard 裡的鏡頭視窗」。

let viewW = 1;
let viewH = 1;

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

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  arCanvas.width = Math.round(viewW * dpr);
  arCanvas.height = Math.round(viewH * dpr);
  arCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  desk.resize(viewW, viewH, dpr);
  gesture.setCanvasSize(viewW, viewH);
}

new ResizeObserver(syncStageView).observe(viewportSlot);
window.addEventListener('resize', syncStageView);
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

  // 1) AR 層：先清空，畫共用的手部骨架
  arCtx.clearRect(0, 0, viewW, viewH);
  if (showSkeleton) drawHandSkeleton(arCtx, hand);

  // 2) 桌面層：桌子 + Chuck + 晶圓 + 已畫的圖形
  desk.renderBase();

  // 3) 關卡邏輯（Modal 開啟時暫停互動，避免在看結算時繼續畫線）
  if (!ui.isModalOpen()) {
    stages.current.onFrame({
      ui,
      desk,
      stages,
      hand,
      ar: arCtx,
      width: viewW,
      height: viewH,
      dt,
      time: elapsed,
    });
  }

  // 4) UI：右上角手勢參考 + 主要按鈕可用狀態
  ui.renderGestureRef(hand);
  ui.setPrimaryEnabled(!stages.isCurrentDone() && stages.current.canComplete());

  requestAnimationFrame(loop);
}

// ─────────────────────────────── 啟動 ────────────────────────────────────

// 開發模式下把模組掛到 window，方便沒有攝影機時在 DevTools 手動驗證流程：
//   __camp.desk.beginStroke(500, 560); __camp.desk.strokeTo(560, 600); __camp.desk.endStroke();
//   __camp.stages.completeCurrent({});   // 直接過關
//   __camp.gesture.setPinchThreshold(0.08);
if (import.meta.env.DEV) {
  Object.assign(window, { __camp: { stages, desk, ui, camera, gesture, Exporter } });
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
