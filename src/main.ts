import './style.css';

import { CameraManager } from './core/CameraManager';
import { GestureDetector, drawHandSkeleton } from './core/GestureDetector';
import { StageManager } from './core/StageManager';
import { WaferState } from './core/WaferState';
import { Stage1RCA } from './stages/Stage1RCA';
import { StagePlaceholder } from './stages/StagePlaceholder';
import type { BaseStage } from './stages/BaseStage';
import { CrossSection } from './ui/CrossSection';
import { UIManager } from './ui/UIManager';
import { VirtualDesk } from './ui/VirtualDesk';
import { Exporter } from './utils/Exporter';

/**
 * main.ts —— 程式入口
 * ---------------------------------------------------------------------------
 *   1. 建立各個模組並互相接線
 *   2. 註冊五個製程關卡（第 1 關 RCA 已實作，2~5 關為 Stub）
 *   3. 把 #stage-view（canvas 群）對齊到 UI 版面中間的鏤空格 #viewport-slot
 *   4. 跑唯一的 rAF 主迴圈：手勢 → 關卡 → 繪製 → UI
 *
 * 關卡順序（依製程實際流程）
 *   1 RCA 清洗 → 2 沉積 → 3 光阻塗布 → 4 顯影 → 5 蝕刻
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
/** 整條製程共用的同一片晶圓：每一關都在改它的層堆疊與污染狀態。 */
const wafer = new WaferState();

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
    wafer.reset();
    stages.reset();
  },
});

const desk = new VirtualDesk(deskCanvas, ui.getPreviewCanvas());
const crossSection = new CrossSection(ui.getSectionCanvas());

const camera = new CameraManager({
  video,
  stageView,
  onStatus: (status, message) => ui.setCameraStatus(status, message),
});

// ────────────────────────────── 關卡註冊 ──────────────────────────────────
// 註冊順序 = 關卡順序。要實作第 2 關就把下面的 StagePlaceholder 換成你的類別。

stages
  .register(new Stage1RCA())
  .register(
    new StagePlaceholder({
      id: 'deposition',
      title: '薄膜沉積',
      shortTitle: '薄膜沉積',
      description: '選擇物理氣相沉積（e-gun 鍍膜）或化學氣相沉積（PECVD），在晶圓上長出薄膜。',
      hint: '（尚未實作）PVD 用電子束加熱靶材使其氣化，直線下落凝結；CVD 通入氣體後以電漿促進反應長出氧化層。',
      props: ['電子槍', '靶材', 'PECVD 腔體'],
      substeps: [
        { id: 'method', title: '製程選擇', desc: '物理氣相沉積（PVD）或化學氣相沉積（CVD）' },
        { id: 'deposit', title: '沉積反應', desc: '粒子運動與鍍膜；CVD 另需電漿促進反應' },
        { id: 'metal', title: '金屬鍍膜', desc: '走 CVD 路線時，需在氧化層上再鍍一層金屬' },
      ],
    }),
  )
  .register(
    new StagePlaceholder({
      id: 'litho',
      title: '微影製程',
      shortTitle: '微影',
      description: '把光阻均勻塗上晶圓，畫出光罩圖案，選擇正／負光阻，最後對位曝光並烘烤。',
      hint: '（尚未實作）用手把光阻塗滿晶圓 → 繪製圖案 → 選正／負光阻 → 對準晶圓後曝光。',
      props: ['光阻機', '光罩（鉻）', '曝光機'],
      substeps: [
        { id: 'spread', title: '光阻劑塗抹', desc: '用手把光阻均勻塗抹到晶圓上' },
        { id: 'draw', title: '圖案設計', desc: '繪製你想刻出的晶片圖案' },
        { id: 'tone', title: '正負光阻選擇', desc: '選擇曝光後要移除還是保留照到光的區域' },
        { id: 'expose', title: '曝光與烘烤', desc: '把光罩對準晶圓後曝光，再進行烘烤' },
      ],
    }),
  )
  .register(
    new StagePlaceholder({
      id: 'develop',
      title: '顯影',
      shortTitle: '顯影',
      description: '泡入顯影液溶解光阻，使被曝光的光阻區域被選擇性移除。',
      hint: '（尚未實作）此關要選出正確的顯影試劑，再觀察顯影反應。',
      props: ['顯影液'],
      substeps: [
        { id: 'reagent', title: '顯影液選擇', desc: '選出能溶解曝光區光阻的試劑' },
        { id: 'react', title: '顯影反應', desc: '浸泡並觀察圖案在截面圖上顯現' },
      ],
    }),
  )
  .register(
    new StagePlaceholder({
      id: 'etching',
      title: '蝕刻',
      shortTitle: '蝕刻',
      description: '先以氧氣電漿清出裸露面，再用乾式或濕式蝕刻移除材料，最後剝除光阻並清洗。',
      hint: '（尚未實作）乾式＝高能粒子鉛直轟擊；濕式＝化學藥劑側向蝕刻。',
      props: ['電漿腔體', '蝕刻槽', '丙酮／NMP'],
      substeps: [
        { id: 'descum', title: '氧氣電漿清潔', desc: '掃過晶圓表面，確保目標材料完全裸露' },
        { id: 'etch', title: '蝕刻選擇', desc: '乾式（鉛直蝕刻）或濕式（側向蝕刻）' },
        { id: 'strip', title: '去光阻與清洗', desc: '用丙酮／NMP 剝除光阻，再以去離子水清洗' },
      ],
    }),
  );

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
        ? '圖形已送出。你可以先把成品存下來，再繼續下一個製程步驟。'
        : `${stage.title} 已完成，下一個製程步驟已解鎖。`,
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
      wafer,
      hand,
      ar: arCtx,
      width: viewW,
      height: viewH,
      dt,
      time: elapsed,
    });
  }

  // 4) 捏合當滑鼠：把捏合點換算成視窗座標，讓玩家不碰滑鼠也能操作左側面板。
  //    Modal 開啟時停用，否則結算畫面會被手勢誤觸。
  if (!ui.isModalOpen()) {
    ui.updatePinchPointer(
      viewLeft + hand.pinchPoint.x,
      viewTop + hand.pinchPoint.y,
      hand.present,
      hand.justPinched,
    );
  } else {
    ui.clearPinchHover();
  }

  // 5) UI：截面圖 + 右上角手勢參考 + 主要按鈕可用狀態
  if (stages.current.usesCrossSection) crossSection.render(wafer, elapsed);
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
