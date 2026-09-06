import { HAND_CONNECTIONS, INDEX_TIP, THUMB_TIP } from '../core/GestureDetector';
import type { CameraStatus, FacingMode } from '../core/CameraManager';
import type { PerfMode } from '../core/perf';
import type { StageManager } from '../core/StageManager';
import type { HandFrame, InstructionStep, PanelSpec, SubStep } from '../core/types';
import { formatElapsed } from '../utils/format';

/**
 * UIManager —— 所有 HTML UI（#ui-layer, z-index:10）的唯一操作入口。
 * ---------------------------------------------------------------------------
 * 關卡與主迴圈只呼叫這裡的方法，不直接碰 DOM。
 * 所有 setter 都會先比對舊值，值沒變就不動 DOM，避免每秒 60 次的無謂 reflow。
 */

/** renderSubsteps() 的預設「無略過」引數，避免每次呼叫都配置新的 Set。 */
const EMPTY_SKIPPED: ReadonlySet<number> = new Set<number>();

export const PEN_COLORS = [
  { label: '光阻綠', value: '#0f6b5c' },
  { label: '鈷藍', value: '#2563eb' },
  { label: '銅橘', value: '#c2410c' },
  { label: '石墨', value: '#1f2937' },
  { label: '洋紅', value: '#a21caf' },
] as const;

export interface UICallbacks {
  onSelectStage: (index: number) => void;
  onPrimary: () => void;
  onNext: () => void;
  onContinue: () => void;
  onClearPattern: () => void;
  onPenColor: (color: string) => void;
  onPenWidth: (width: number) => void;
  onPinchSensitivity: (threshold: number) => void;
  /** 效能模式（auto / high / lite）。 */
  onPerfMode: (mode: PerfMode) => void;
  onToggleMirror: () => void;
  onToggleCamera: () => void;
  onToggleSkeleton: (visible: boolean) => void;
  onExportPNG: () => void;
  onExportSTL: () => void;
  onExportPDF: () => void;
  onRetakePhoto: () => void;
  /** 證書畫面的「再玩一次」：整場重置回第一關。 */
  onPlayAgain: () => void;
  /** 開發者模式開關（開啟後可任意跳關）。 */
  onDevMode: (enabled: boolean) => void;
  /** 開發者模式：把目前這一關直接標記為已完成。 */
  onForceComplete: () => void;
  onRetry: () => void;
  onExit: () => void;
  /** 視窗內的主要行動按鈕（完成本關 / 下一步）。 */
  onStageAction: () => void;
}

export interface SuccessModalData {
  title: string;
  description: string;
  image: HTMLCanvasElement | null;
  continueLabel: string;
  showExports: boolean;
}

/** 疊在 canvas 上的 HTML 覆蓋物位置（canvas 座標）。見 UIManager.sceneOverlay()。 */
export interface SceneOverlay {
  /** 左側互動面板的右緣；沒有面板時 0。 */
  left: number;
  /** 上方帶狀元素（子步驟列 / AR 提示）的下緣。 */
  top: number;
  /** 右上角卡片的左緣；沒有卡片時 Infinity。 */
  cardLeft: number;
  /** 右上角卡片的下緣；沒有卡片時 0。 */
  cardBottom: number;
  /** 左下角卡片群的上緣。 */
  bottomTop: number;
}

export class UIManager {
  private readonly cb: UICallbacks;
  private readonly cache = new Map<string, string>();

  // Header
  private readonly stageCounter = el<HTMLElement>('stage-counter');
  private readonly progressPercent = el<HTMLElement>('progress-percent');
  private readonly progressFill = el<HTMLElement>('progress-fill');

  // Sidebar
  private readonly stepList = el<HTMLElement>('step-list');
  private readonly timerCard = document.querySelector<HTMLElement>('.timer-card')!;
  private readonly timerValue = el<HTMLElement>('timer-value');
  private readonly hintText = el<HTMLElement>('hint-text');

  // Viewport HUD
  private readonly liveLabel = el<HTMLElement>('live-label');
  private readonly btnCamera = el<HTMLButtonElement>('btn-camera');
  private readonly btnMirror = el<HTMLButtonElement>('btn-mirror');
  private readonly arHint = el<HTMLElement>('ar-hint');
  private readonly grCanvas = el<HTMLCanvasElement>('gesture-ref-canvas');
  private readonly grCtx: CanvasRenderingContext2D;
  private readonly grStatus = el<HTMLElement>('gr-status');
  private readonly penColorsHost = el<HTMLElement>('pen-colors');
  private readonly btnClear = el<HTMLButtonElement>('btn-clear');
  private readonly previewCanvas = el<HTMLCanvasElement>('pattern-preview');

  // Right panel
  private readonly panelCounter = el<HTMLElement>('panel-step-counter');
  private readonly panelTitle = el<HTMLElement>('panel-step-title');
  private readonly panelDesc = el<HTMLElement>('panel-step-desc');
  private readonly instructionList = el<HTMLElement>('instruction-list');
  private readonly handCard = document.querySelector<HTMLElement>('.hand-card')!;
  private readonly handIcon = el<HTMLElement>('hand-icon');
  private readonly handLabel = el<HTMLElement>('hand-label');
  private readonly handSub = el<HTMLElement>('hand-sub');
  private readonly btnPrimary = el<HTMLButtonElement>('btn-primary');
  private readonly btnNext = el<HTMLButtonElement>('btn-next');
  private readonly statusDot = el<HTMLElement>('status-dot');
  private readonly statusText = el<HTMLElement>('status-text');
  private readonly statusSub = el<HTMLElement>('status-sub');

  // 關卡內互動
  private readonly substepStrip = el<HTMLElement>('substep-strip');
  private readonly stagePanel = el<HTMLElement>('stage-panel');
  private readonly viewportSlot = el<HTMLElement>('viewport-slot');
  /** 上方帶狀元素的位置需不需要重算。見 flushBands()。 */
  private bandsDirty = true;
  private readonly stageAction = el<HTMLButtonElement>('btn-stage-action');
  private readonly devComplete = el<HTMLButtonElement>('btn-dev-complete');
  private readonly sectionCard = el<HTMLElement>('hud-cross-section');
  private readonly sectionCanvas = el<HTMLCanvasElement>('cross-section-canvas');

  // Footer
  private readonly stageFlow = el<HTMLElement>('stage-flow');

  // Modals
  private readonly modalRoot = el<HTMLElement>('modal-root');
  private readonly modalSuccess = el<HTMLElement>('modal-success');
  private readonly modalFail = el<HTMLElement>('modal-fail');
  private readonly modalHelp = el<HTMLElement>('modal-help');
  private readonly modalCert = el<HTMLElement>('modal-cert');
  private readonly confirmRoot = el<HTMLElement>('confirm-root');
  private readonly confirmTitle = el<HTMLElement>('confirm-title');
  private readonly confirmText = el<HTMLElement>('confirm-text');
  private readonly certCanvas = el<HTMLCanvasElement>('cert-canvas');
  private readonly modalSettings = el<HTMLElement>('modal-settings');
  private readonly successTitle = el<HTMLElement>('success-title');
  private readonly successDesc = el<HTMLElement>('success-desc');
  private readonly resultCanvas = el<HTMLCanvasElement>('result-canvas');
  private readonly failReason = el<HTMLElement>('fail-reason');
  private readonly btnExportPNG = el<HTMLButtonElement>('btn-export-png');
  private readonly btnExportSTL = el<HTMLButtonElement>('btn-export-stl');
  private readonly btnContinue = el<HTMLButtonElement>('btn-modal-continue');

  // Camera fallback
  private readonly cameraFallback = el<HTMLElement>('camera-fallback');
  private readonly cameraFallbackText = el<HTMLElement>('camera-fallback-text');
  private readonly video = el<HTMLVideoElement>('video-element');

  constructor(callbacks: UICallbacks) {
    this.cb = callbacks;
    this.grCtx = this.grCanvas.getContext('2d')!;
    this.buildPenColors();
    this.bindEvents();
  }

  /** 左下角「已繪製圖形」預覽框，交給 VirtualDesk 直接畫。 */
  getPreviewCanvas(): HTMLCanvasElement {
    return this.previewCanvas;
  }

  /**
   * 視窗內的主要行動按鈕。傳 null 收起來。
   *
   * 右側面板在鏡頭視野之外，手構不到，所以「完成本關 / 下一步」必須在視窗內
   * 也有一顆，整場遊戲才能純用手玩完。
   */
  setStageAction(label: string | null): void {
    if (this.cache.get('stageAction') === (label ?? '')) return;
    this.cache.set('stageAction', label ?? '');
    if (label === null) {
      this.stageAction.classList.add('hidden');
      return;
    }
    this.stageAction.textContent = label;
    this.stageAction.classList.remove('hidden');
  }

  /**
   * 左側面板的計時器。
   * 主迴圈每幀呼叫，但 setText() 會比對舊值，所以實際上每秒才動一次 DOM。
   * finished 為 true 時定格並染成主色 —— 那就是玩家的成績。
   */
  setElapsed(ms: number, finished: boolean): void {
    this.setText(this.timerValue, formatElapsed(ms));
    if (this.cache.get('timerFinished') !== String(finished)) {
      this.cache.set('timerFinished', String(finished));
      this.timerCard.classList.toggle('is-finished', finished);
    }
  }

  /** 截面圖 HUD 的 canvas，交給 CrossSection 直接畫。 */
  getSectionCanvas(): HTMLCanvasElement {
    return this.sectionCanvas;
  }

  /**
   * 左側互動面板目前佔用的寬度（含左邊距），單位 CSS px；面板收起時為 0。
   *
   * 關卡用它來決定場景（燒杯／藥瓶／機台）要從哪裡開始擺，這樣視窗一縮小、
   * 面板一變窄，canvas 上的佈局就會跟著讓位，不需要在兩邊各維護一組斷點。
   */
  panelInset(): number {
    if (this.stagePanel.classList.contains('hidden')) return 0;
    return this.stagePanel.offsetLeft + this.stagePanel.offsetWidth;
  }

  /**
   * 依序把上方三條帶狀元素疊起來：鏡頭設定列 → 子步驟列 → AR 提示 → 互動面板。
   *
   * 這幾個的 top 原本是每個高度級距寫死的數字（56/50/44、94/86/76、146/132/116）。
   * 問題是它們的**高度會變** —— 字級隨級距改、子步驟數量各關不同、
   * 提示文字長了會換行。寫死的結果就是矮視窗上子步驟列壓在鏡頭設定列上面。
   *
   * 改成量前一條的下緣，寫進 CSS 變數給下一條用。
   * 每一步都在寫入之後才讀下一個，所以讀到的都是重排後的新值。
   *
   * 只有內容或視窗變動時才跑（bandsDirty），不是每幀 —— 這裡會觸發 reflow。
   */
  flushBands(force = false): void {
    if (!this.bandsDirty && !force) return;
    this.bandsDirty = false;

    const slotTop = this.viewportSlot.getBoundingClientRect().top;
    const css = document.documentElement.style;
    const bottomOf = (node: HTMLElement | null, fallback: number): number => {
      if (!node || node.classList.contains('hidden')) return fallback;
      const r = node.getBoundingClientRect();
      return r.height > 0 ? r.bottom - slotTop : fallback;
    };

    const chips = bottomOf(this.viewportSlot.querySelector<HTMLElement>('.vp-top-left'), 0);
    css.setProperty('--substep-top', `${Math.round(chips + 8)}px`);

    const strip = bottomOf(this.substepStrip, chips);
    css.setProperty('--ar-hint-top', `${Math.round(strip + 8)}px`);

    const hint = bottomOf(this.arHint, strip);
    css.setProperty('--panel-top', `${Math.round(hint + 10)}px`);
  }

  /**
   * 疊在 canvas 上的 HTML 覆蓋物，換算成 **canvas 座標**。
   *
   * 為什麼要量：畫面上有兩套座標系統 —— CSS 的 HUD 卡片與 canvas 上畫出來的
   * 道具。CSS 那一層會隨視窗大小、字體、關卡不同而變，關卡不可能猜得到。
   * 猜的結果就是矮視窗上「手勢參考卡把最右邊兩個藥瓶蓋掉」、
   * 「AR 提示壓在瓶口上」—— 而且型別檢查與純數值檢查都抓不到。
   *
   * 所以沿用 panelInset() 已經證明可行的做法：**問 DOM，不要算**。
   */
  sceneOverlay(): SceneOverlay {
    const slot = this.viewportSlot.getBoundingClientRect();
    /** 元素相對 canvas 左上角的框；元素不存在或隱藏時回 null。 */
    const box = (node: HTMLElement | null): DOMRect | null => {
      if (!node || node.classList.contains('hidden')) return null;
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    };

    // 上方帶狀元素：子步驟列與 AR 提示。取兩者較低的下緣。
    let top = 0;
    for (const node of [this.substepStrip, this.arHint]) {
      const r = box(node);
      if (r) top = Math.max(top, r.bottom - slot.top);
    }

    // 右上角的手勢參考卡（矮視窗上會被 CSS 隱藏，那時就沒有這個限制）
    const card = box(document.querySelector<HTMLElement>('.gesture-ref'));
    // 左下角的截面圖等卡片
    const bottom = box(document.querySelector<HTMLElement>('.vp-bottom'));

    return {
      left: this.panelInset(),
      top,
      cardLeft: card ? card.left - slot.left : Number.POSITIVE_INFINITY,
      cardBottom: card ? card.bottom - slot.top : 0,
      bottomTop: bottom ? bottom.top - slot.top : slot.height,
    };
  }

  // ─────────────────────────────── 事件綁定 ────────────────────────────────

  private bindEvents(): void {
    this.btnPrimary.addEventListener('click', () => this.cb.onPrimary());
    this.stageAction.addEventListener('click', () => this.cb.onStageAction());
    this.btnNext.addEventListener('click', () => this.cb.onNext());
    this.btnClear.addEventListener('click', () => this.cb.onClearPattern());
    this.btnMirror.addEventListener('click', () => this.cb.onToggleMirror());
    this.btnCamera.addEventListener('click', () => this.cb.onToggleCamera());
    this.btnExportPNG.addEventListener('click', () => this.cb.onExportPNG());
    this.btnExportSTL.addEventListener('click', () => this.cb.onExportSTL());
    this.btnContinue.addEventListener('click', () => {
      this.closeModal();
      this.cb.onContinue();
    });
    el<HTMLButtonElement>('btn-retry').addEventListener('click', () => {
      this.closeModal();
      this.cb.onRetry();
    });
    el<HTMLButtonElement>('btn-exit').addEventListener('click', () => {
      this.confirm({
        title: '要結束目前進度嗎？',
        text: '所有關卡會回到第一關，晶圓成品也會被清除。',
        onOk: () => this.cb.onExit(),
      });
    });

    el<HTMLButtonElement>('btn-cert-pdf').addEventListener('click', () => this.cb.onExportPDF());
    el<HTMLButtonElement>('btn-cert-png').addEventListener('click', () => this.cb.onExportPNG());
    el<HTMLButtonElement>('btn-cert-stl').addEventListener('click', () => this.cb.onExportSTL());
    el<HTMLButtonElement>('btn-cert-retake').addEventListener('click', () =>
      this.cb.onRetakePhoto(),
    );
    // 「再玩一次」要先確認，避免玩家還在看證書就被誤觸而重置整場
    el<HTMLButtonElement>('btn-cert-close').addEventListener('click', () => {
      this.confirm({
        title: '要再玩一次嗎？',
        text: '目前的晶圓成品與證書會被清除，關卡回到第一關。記得先把想留的檔案下載下來。',
        onOk: () => {
          this.closeModal();
          this.cb.onPlayAgain();
        },
      });
    });

    el<HTMLButtonElement>('btn-confirm-cancel').addEventListener('click', () =>
      this.closeConfirm(),
    );
    el<HTMLButtonElement>('btn-confirm-ok').addEventListener('click', () => {
      const ok = this.confirmOk;
      this.closeConfirm();
      ok?.();
    });

    el<HTMLButtonElement>('btn-help').addEventListener('click', () =>
      this.openModal(this.modalHelp),
    );
    el<HTMLButtonElement>('btn-help-close').addEventListener('click', () => this.closeModal());
    el<HTMLButtonElement>('btn-settings').addEventListener('click', () =>
      this.openModal(this.modalSettings),
    );
    el<HTMLButtonElement>('btn-settings-close').addEventListener('click', () => this.closeModal());

    el<HTMLInputElement>('set-skeleton').addEventListener('change', (e) => {
      this.cb.onToggleSkeleton((e.target as HTMLInputElement).checked);
    });
    el<HTMLInputElement>('set-mirror').addEventListener('change', () => this.cb.onToggleMirror());
    el<HTMLInputElement>('set-devmode').addEventListener('change', (e) => {
      this.devMode = (e.target as HTMLInputElement).checked;
      this.devComplete.classList.toggle('hidden', !this.devMode);
      this.cb.onDevMode(this.devMode);
    });
    this.devComplete.addEventListener('click', () => {
      this.cb.onForceComplete();
      // 關掉設定視窗，才看得到剛剛被標記完成的效果
      this.closeModal();
    });
    el<HTMLInputElement>('set-pen-width').addEventListener('input', (e) => {
      this.cb.onPenWidth(Number((e.target as HTMLInputElement).value));
    });
    el<HTMLInputElement>('set-pinch').addEventListener('input', (e) => {
      // slider 30~90 → 門檻 0.030~0.090
      this.cb.onPinchSensitivity(Number((e.target as HTMLInputElement).value) / 1000);
    });
    el<HTMLSelectElement>('set-perf').addEventListener('change', (e) => {
      this.cb.onPerfMode((e.target as HTMLSelectElement).value as PerfMode);
    });

    document.querySelector<HTMLElement>('.modal-backdrop')?.addEventListener('click', () => {
      // 結算 / 失敗 Modal 必須做出選擇，只有說明與設定可以點背景關閉
      if (
        !this.modalHelp.classList.contains('hidden') ||
        !this.modalSettings.classList.contains('hidden')
      ) {
        this.closeModal();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // 確認框在最上層，Esc 先關它
      if (this.isConfirmOpen()) this.closeConfirm();
      else this.closeModal();
    });
  }

  private buildPenColors(): void {
    this.penColorsHost.replaceChildren(
      ...PEN_COLORS.map((color, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swatch' + (i === 0 ? ' is-active' : '');
        btn.style.background = color.value;
        btn.title = color.label;
        btn.dataset.color = color.value;
        btn.addEventListener('click', () => {
          this.penColorsHost
            .querySelectorAll('.swatch')
            .forEach((s) => s.classList.toggle('is-active', s === btn));
          this.cb.onPenColor(color.value);
        });
        return btn;
      }),
    );
  }

  // ──────────────────────────── 關卡 / 進度渲染 ─────────────────────────────

  /** 關卡狀態有變動時整批重畫（步驟列、流程列、Header 進度、右側面板）。 */
  syncStages(stages: StageManager): void {
    const total = stages.total;
    const index = stages.currentIndex;
    const stage = stages.current;

    // Header
    this.setText(this.stageCounter, `關卡 ${index + 1} / ${total}`);
    this.setText(this.progressPercent, `${stages.progressPercent}%`);
    this.progressFill.style.width = `${stages.progressPercent}%`;

    // 左側步驟列
    this.stepList.replaceChildren(
      ...stages.all.map((s, i) => {
        const status = stages.statusOf(i);
        const li = document.createElement('li');
        li.className = `step-row ${status === 'active' ? 'is-active' : ''} ${
          status === 'done' ? 'is-done' : ''
        } ${status === 'locked' ? 'is-locked' : ''}`;

        const badge = document.createElement('div');
        badge.className = 'step-badge';
        badge.textContent = status === 'done' ? '✓' : status === 'locked' ? '🔒' : String(i + 1);

        const body = document.createElement('div');
        body.className = 'step-body';
        const name = document.createElement('div');
        name.className = 'step-name';
        name.textContent = `${i + 1}. ${s.title}`;
        const st = document.createElement('div');
        st.className = 'step-status';
        st.textContent = status === 'done' ? '已完成' : status === 'active' ? '進行中' : '未解鎖';
        body.append(name, st);

        li.append(badge, body);
        // 開發者模式下連未解鎖的關卡也能點，方便測試時跳關
        if (status !== 'locked' || this.devMode) {
          li.addEventListener('click', () => this.cb.onSelectStage(i));
          if (status === 'locked') li.classList.add('is-dev-unlocked');
        }
        return li;
      }),
    );

    // 底部流程列
    const flowNodes: HTMLElement[] = [];
    stages.all.forEach((s, i) => {
      if (i > 0) {
        const link = document.createElement('div');
        link.className = 'flow-link';
        flowNodes.push(link);
      }
      const status = stages.statusOf(i);
      const node = document.createElement('button');
      node.type = 'button';
      node.className = `flow-node ${status === 'active' ? 'is-active' : ''} ${
        status === 'done' ? 'is-done' : ''
      } ${status === 'locked' ? 'is-locked' : ''}`;
      node.innerHTML = `<span class="flow-index">0${i + 1}</span><span>${s.shortTitle}</span>`;
      if (status !== 'locked' || this.devMode) {
        node.addEventListener('click', () => this.cb.onSelectStage(i));
        if (status === 'locked') node.classList.add('is-dev-unlocked');
      }
      flowNodes.push(node);
    });
    this.stageFlow.replaceChildren(...flowNodes);

    // 右側面板
    this.setText(
      this.panelCounter,
      `STEP ${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`,
    );
    this.setText(this.panelTitle, stage.title);
    this.setText(this.panelDesc, stage.description);
    this.setText(this.liveLabel, `LIVE · ${stage.shortTitle}`);
    this.setText(this.hintText, stage.hint);
    this.setText(this.btnPrimary, stage.primaryLabel);
    this.setText(this.statusSub, `已完成 ${stages.doneCount} / ${total} 步驟`);

    this.renderInstructions(stage.instructions);
    this.renderSubsteps(stage.substeps, stage.subIndex, stage.skippedSubs);
    this.setNextEnabled(stages.isCurrentDone() && stages.hasNext());

    // 只有需要畫筆的關卡才顯示下方工具列
    const tools = document.querySelector<HTMLElement>('.hud-card-tools');
    const preview = this.previewCanvas.closest<HTMLElement>('.hud-card');
    tools?.classList.toggle('hidden', !stage.usesPenTools);
    preview?.classList.toggle('hidden', !stage.usesPenTools);
    this.sectionCard.classList.toggle('hidden', !stage.usesCrossSection);
  }

  /**
   * 關卡內子步驟進度列。已完成的打勾、目前這步高亮、還沒到的變灰、
   * 被略過（不適用）的畫成灰色斜線。
   * subIndex 等於 substeps.length 代表全部做完。
   */
  renderSubsteps(
    substeps: readonly SubStep[],
    subIndex: number,
    skipped: ReadonlySet<number> = EMPTY_SKIPPED,
  ): void {
    if (substeps.length === 0) {
      this.substepStrip.classList.add('hidden');
      this.substepStrip.replaceChildren();
      this.cache.delete('substeps');
      return;
    }

    const skipKey = [...skipped].sort((a, b) => a - b).join(',');
    const key = `${substeps.map((s) => s.id).join('|')}#${subIndex}#${skipKey}`;
    if (this.cache.get('substeps') === key) return;
    this.cache.set('substeps', key);

    const nodes: HTMLElement[] = [];
    substeps.forEach((step, i) => {
      if (i > 0) {
        const sep = document.createElement('li');
        sep.className = 'substep-sep';
        nodes.push(sep);
      }
      const li = document.createElement('li');
      const isSkipped = skipped.has(i);
      const done = !isSkipped && i < subIndex;
      const active = i === subIndex;
      li.className = `substep ${active ? 'is-active' : ''} ${done ? 'is-done' : ''} ${
        isSkipped ? 'is-skipped' : ''
      }`;
      li.title = isSkipped ? `${step.desc}（此路線不需要）` : step.desc;

      const num = document.createElement('span');
      num.className = 'substep-num';
      num.textContent = isSkipped ? '–' : done ? '✓' : String(i + 1);

      const label = document.createElement('span');
      label.className = 'substep-label';
      label.textContent = step.title;

      li.append(num, label);
      nodes.push(li);
    });

    this.substepStrip.replaceChildren(...nodes);
    this.substepStrip.classList.remove('hidden');
  }

  private renderInstructions(steps: InstructionStep[]): void {
    const key = steps.map((s) => s.title).join('|');
    if (this.cache.get('instructions') === key) return;
    this.cache.set('instructions', key);

    this.instructionList.replaceChildren(
      ...steps.map((step) => {
        const li = document.createElement('li');
        li.className = 'ins-row';
        const glyph = document.createElement('div');
        glyph.className = 'ins-glyph';
        glyph.textContent = step.glyph;
        const body = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'ins-title';
        title.textContent = step.title;
        const desc = document.createElement('div');
        desc.className = 'ins-desc';
        desc.textContent = step.desc;
        body.append(title, desc);
        li.append(glyph, body);
        return li;
      }),
    );
  }

  // ─────────────────────────── 每幀更新的小狀態 ────────────────────────────

  setHint(text: string): void {
    this.setText(this.hintText, text);
  }

  /** 畫面中央的 AR 提示。attached=true 時切成主色高亮。 */
  setArHint(text: string, attached = false): void {
    this.setText(this.arHint, text);
    if (this.cache.get('arHintAttached') !== String(attached)) {
      this.cache.set('arHintAttached', String(attached));
      this.arHint.classList.toggle('is-attached', attached);
    }
  }

  setHandState(icon: string, label: string, sub: string, attached = false): void {
    this.setText(this.handIcon, icon);
    this.setText(this.handLabel, label);
    this.setText(this.handSub, sub);
    if (this.cache.get('handAttached') !== String(attached)) {
      this.cache.set('handAttached', String(attached));
      this.handCard.classList.toggle('is-attached', attached);
    }
  }

  setPrimaryEnabled(enabled: boolean): void {
    if (this.cache.get('primaryEnabled') === String(enabled)) return;
    this.cache.set('primaryEnabled', String(enabled));
    this.btnPrimary.disabled = !enabled;
  }

  setNextEnabled(enabled: boolean): void {
    if (this.cache.get('nextEnabled') === String(enabled)) return;
    this.cache.set('nextEnabled', String(enabled));
    this.btnNext.disabled = !enabled;
    this.btnNext.textContent = enabled ? '下一步 →' : '下一步 🔒';
  }

  setMirrorLabel(mirrored: boolean): void {
    this.setText(this.btnMirror, `鏡像：${mirrored ? '開啟' : '關閉'}`);
    this.btnMirror.classList.toggle('chip-on', mirrored);
    const checkbox = el<HTMLInputElement>('set-mirror');
    if (checkbox.checked !== mirrored) checkbox.checked = mirrored;
  }

  setCameraLabel(facing: FacingMode): void {
    this.setText(this.btnCamera, `攝影機：${facing === 'user' ? '前鏡頭' : '後鏡頭'}`);
  }

  /** 把「設定」裡的效能模式下拉同步到目前的值（啟動時 / 從 localStorage 讀回後）。 */
  setPerfMode(mode: PerfMode): void {
    const select = el<HTMLSelectElement>('set-perf');
    if (select.value !== mode) select.value = mode;
  }

  setCameraStatus(status: CameraStatus, message?: string): void {
    const failed = status === 'error';
    this.cameraFallback.classList.toggle('hidden', !failed);
    this.video.style.opacity = failed ? '0' : '1';
    if (message) this.setText(this.cameraFallbackText, message);

    this.statusDot.classList.toggle('is-live', status === 'live');
    this.statusDot.classList.toggle('is-error', failed);
    this.setText(
      this.statusText,
      status === 'live'
        ? '手勢系統運作中'
        : status === 'loading'
          ? '正在啟動鏡頭…'
          : failed
            ? '鏡頭無法使用'
            : '系統待命中',
    );
  }

  // ───────────────────────────── 關卡互動面板 ──────────────────────────────

  /**
   * 依關卡給的 PanelSpec 渲染左側互動面板；傳 null 收起面板。
   *
   * 關卡可以每一幀都呼叫這個方法（例如 confirmEnabled 會隨狀態變動），
   * 但只有「簽章」真的改變時才會重建 DOM——否則每秒 60 次的 replaceChildren
   * 會讓按鈕永遠無法被點到（每次重建都會打斷 click 事件）。
   * 回呼則每次都更新到最新的 closure，所以不會抓到過期的狀態。
   */
  setPanel(spec: PanelSpec | null): void {
    if (!spec) {
      if (this.cache.get('panel') === '') return;
      this.cache.set('panel', '');
      this.stagePanel.classList.add('hidden');
      this.stagePanel.replaceChildren();
      this.panelSpec = null;
      return;
    }

    this.panelSpec = spec;
    const key = panelKey(spec);
    if (this.cache.get('panel') === key) return;
    this.cache.set('panel', key);
    // 舊按鈕即將被丟棄，先把捏合高亮的參考斷開
    this.clearPinchHover();

    const nodes: HTMLElement[] = [];

    const title = document.createElement('div');
    title.className = 'sp-title';
    title.textContent = spec.title;
    nodes.push(title);

    if (spec.note) {
      const note = document.createElement('div');
      note.className = 'sp-note';
      note.textContent = spec.note;
      nodes.push(note);
    }

    const body = document.createElement('div');
    body.className = 'sp-body';

    if (spec.kind === 'choice') {
      const atMax = spec.selected.length >= spec.max;
      for (const opt of spec.options) {
        const on = spec.selected.includes(opt.id);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `sp-option ${on ? 'is-on' : ''}`;
        btn.disabled = !on && atMax;
        btn.dataset.pinch = '1';

        const dot = document.createElement('span');
        dot.className = 'sp-dot';
        dot.style.background = opt.color ?? 'var(--surface-4)';

        const labels = document.createElement('span');
        labels.className = 'sp-labels';
        const main = document.createElement('span');
        main.textContent = opt.glyph ? `${opt.glyph} ${opt.label}` : opt.label;
        labels.append(main);
        if (opt.sub) {
          const sub = document.createElement('span');
          sub.className = 'sp-sub';
          sub.textContent = opt.sub;
          labels.append(sub);
        }

        btn.append(dot, labels);
        if (on) {
          const check = document.createElement('span');
          check.className = 'sp-check';
          check.textContent = '✓';
          btn.append(check);
        }

        // 回呼從 this.panelSpec 讀，永遠是最新的那份 spec
        btn.addEventListener('click', () => {
          const cur = this.panelSpec;
          if (cur?.kind === 'choice') cur.onToggle(opt.id);
        });
        body.append(btn);
      }
    } else if (spec.kind === 'pour') {
      if (spec.rows.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sp-empty';
        empty.textContent = '調配杯是空的 — 捏起藥瓶倒進去';
        body.append(empty);
      } else {
        for (const row of spec.rows) {
          const line = document.createElement('div');
          line.className = 'sp-mix-row';

          const dot = document.createElement('span');
          dot.className = 'sp-dot';
          dot.style.background = row.color;

          const labels = document.createElement('span');
          labels.className = 'sp-labels';
          const main = document.createElement('span');
          main.textContent = row.label;
          labels.append(main);
          if (row.sub) {
            const sub = document.createElement('span');
            sub.className = 'sp-sub';
            sub.textContent = row.sub;
            labels.append(sub);
          }

          const parts = document.createElement('span');
          parts.className = 'sp-count sp-count-right';
          parts.textContent = `${row.parts} 份`;

          line.append(dot, labels, parts);
          body.append(line);
        }

        const ratio = document.createElement('div');
        ratio.className = 'sp-ratio';
        const total = spec.rows.reduce((s, r) => s + r.parts, 0);
        ratio.innerHTML = `杯中比例 <b>${spec.rows
          .map((r) => r.parts)
          .join(' : ')}</b>　總量 ${total} 份`;
        body.append(ratio);
      }
    }

    if (spec.kind !== 'action') nodes.push(body);

    if (spec.error) {
      const err = document.createElement('div');
      err.className = 'sp-error';
      err.textContent = spec.error;
      nodes.push(err);
    }

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-primary sp-confirm';
    confirm.dataset.pinch = '1';
    if (spec.kind === 'action') {
      confirm.textContent = spec.label;
      confirm.disabled = !spec.enabled;
      confirm.addEventListener('click', () => {
        const cur = this.panelSpec;
        if (cur?.kind === 'action' && cur.enabled) cur.onClick();
      });
    } else {
      confirm.textContent = spec.confirmLabel;
      confirm.disabled = !spec.confirmEnabled;
      confirm.addEventListener('click', () => {
        const cur = this.panelSpec;
        if (cur && cur.kind !== 'action' && cur.confirmEnabled) cur.onConfirm();
      });
    }
    nodes.push(confirm);

    // 調配杯多一顆「倒掉」；答錯時它會是唯一能按的按鈕
    if (spec.kind === 'pour') {
      const dump = document.createElement('button');
      dump.type = 'button';
      dump.className = 'btn btn-danger sp-confirm';
      dump.dataset.pinch = '1';
      dump.textContent = spec.dumpLabel;
      dump.disabled = !spec.dumpEnabled;
      dump.addEventListener('click', () => {
        const cur = this.panelSpec;
        if (cur?.kind === 'pour' && cur.dumpEnabled) cur.onDump();
      });
      nodes.push(dump);
    }

    this.stagePanel.replaceChildren(...nodes);
    this.stagePanel.classList.remove('hidden');
  }

  private panelSpec: PanelSpec | null = null;

  // ────────────────────────── 捏合當滑鼠用（AR 點擊） ───────────────────────

  /** 上一幀捏合游標懸停到的元素，用來在移開時清掉高亮。 */
  private pinchHover: HTMLElement | null = null;

  /**
   * 把捏合點當成滑鼠游標：懸停在 [data-pinch] 按鈕上會亮起來，捏合的瞬間
   * 觸發 click。這樣整個遊戲不用碰滑鼠也能玩完，跟 AR 的定位一致。
   *
   * @param pageX/pageY 視窗座標（main.ts 已把 canvas 座標加上 #stage-view 的位移）
   * @param justPinched 這一幀「剛剛捏下去」
   */
  updatePinchPointer(pageX: number, pageY: number, present: boolean, justPinched: boolean): void {
    let target: HTMLElement | null = null;
    if (present) {
      const hit = document.elementFromPoint(pageX, pageY);
      target = (hit as HTMLElement | null)?.closest<HTMLElement>('[data-pinch]') ?? null;
      if (target?.matches(':disabled')) target = null;
    }

    if (target !== this.pinchHover) {
      this.pinchHover?.classList.remove('is-pinch-hover');
      target?.classList.add('is-pinch-hover');
      this.pinchHover = target;
    }

    if (justPinched && target) target.click();
  }

  /** 面板被重建時舊的 hover 元素已不在 DOM，清掉參考避免記憶體滯留。 */
  clearPinchHover(): void {
    this.pinchHover?.classList.remove('is-pinch-hover');
    this.pinchHover = null;
  }

  // ────────────────────── 右上角「手勢參考」小視窗 ─────────────────────────

  renderGestureRef(hand: HandFrame): void {
    const ctx = this.grCtx;
    const w = this.grCanvas.width;
    const h = this.grCanvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#12181c';
    ctx.fillRect(0, 0, w, h);

    // 底格線
    ctx.strokeStyle = 'rgba(120, 200, 200, 0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      ctx.moveTo((w * i) / 4, 0);
      ctx.lineTo((w * i) / 4, h);
      ctx.moveTo(0, (h * i) / 4);
      ctx.lineTo(w, (h * i) / 4);
    }
    ctx.stroke();

    if (!hand.present) {
      ctx.fillStyle = 'rgba(150, 170, 180, 0.5)';
      ctx.font = "12px 'IBM Plex Mono', monospace";
      ctx.textAlign = 'center';
      ctx.fillText('🤚 尋找手部…', w / 2, h / 2 + 3);
      this.setText(this.grStatus, 'NO HAND');
      this.grStatus.classList.remove('is-on');
      return;
    }

    // normalized 座標 → 小視窗，內縮 8% 讓手不會貼邊
    const pad = 0.08;
    const px = (n: number) => (pad + n * (1 - pad * 2)) * w;
    const py = (n: number) => (pad + n * (1 - pad * 2)) * h;
    const lm = hand.normalized;

    ctx.strokeStyle = hand.pinching ? '#5ee9df' : 'rgba(150, 235, 232, 0.7)';
    ctx.lineWidth = hand.pinching ? 2 : 1.4;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(px(lm[a].x), py(lm[a].y));
      ctx.lineTo(px(lm[b].x), py(lm[b].y));
    }
    ctx.stroke();

    ctx.fillStyle = hand.pinching ? '#5ee9df' : 'rgba(180, 240, 238, 0.9)';
    for (const i of [THUMB_TIP, INDEX_TIP]) {
      ctx.beginPath();
      ctx.arc(px(lm[i].x), py(lm[i].y), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const pct = Math.round(Math.min(1, hand.pinchDistance / 0.25) * 100);
    this.setText(this.grStatus, hand.pinching ? 'PINCH ✓ 已捏合' : `OPEN · ${pct}%`);
    this.grStatus.classList.toggle('is-on', hand.pinching);
  }

  // ─────────────────────────────── Modal ──────────────────────────────────

  showSuccess(data: SuccessModalData): void {
    this.setText(this.successTitle, data.title);
    this.setText(this.successDesc, data.description);
    this.setText(this.btnContinue, data.continueLabel);

    const ctx = this.resultCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.resultCanvas.width, this.resultCanvas.height);
    if (data.image) {
      ctx.drawImage(data.image, 0, 0, this.resultCanvas.width, this.resultCanvas.height);
    }
    this.resultCanvas.closest<HTMLElement>('.wafer-frame')?.classList.toggle('hidden', !data.image);
    this.btnExportPNG.classList.toggle('hidden', !data.showExports);
    this.btnExportSTL.classList.toggle('hidden', !data.showExports);

    this.openModal(this.modalSuccess);
  }

  showFail(reason: string): void {
    this.setText(this.failReason, reason);
    this.openModal(this.modalFail);
  }

  // ─────────────────────────────── 確認框 ─────────────────────────────────

  private confirmOk: (() => void) | null = null;

  /**
   * 置中的確認框，z-index 70 —— 高於所有遊戲 UI 與 Modal。
   * 破壞性操作（重置整場）走這裡，不用 window.confirm，因為原生對話框
   * 沒辦法用捏合手勢按。
   */
  confirm(opts: { title: string; text: string; onOk: () => void }): void {
    this.setText(this.confirmTitle, opts.title);
    this.setText(this.confirmText, opts.text);
    this.confirmOk = opts.onOk;
    this.confirmRoot.classList.remove('hidden');
  }

  closeConfirm(): void {
    this.confirmRoot.classList.add('hidden');
    this.confirmOk = null;
  }

  isConfirmOpen(): boolean {
    return !this.confirmRoot.classList.contains('hidden');
  }

  // ───────────────────────────── 開發者模式 ───────────────────────────────

  private devMode = false;

  /** 開啟時，左側步驟列與底部流程列的所有關卡都可以點（含未解鎖的）。 */
  isDevMode(): boolean {
    return this.devMode;
  }

  /** 顯示結業證書。傳入已排版好的 canvas，這裡只負責縮放顯示。 */
  showCertificate(image: HTMLCanvasElement): void {
    const ctx = this.certCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, this.certCanvas.width, this.certCanvas.height);
      ctx.drawImage(image, 0, 0, this.certCanvas.width, this.certCanvas.height);
    }
    this.openModal(this.modalCert);
    // 要先顯示才量得到高度
    this.syncCertificateSize();
  }

  /**
   * 讓證書預覽**整張**落在畫面內。
   *
   * 原本 canvas 是 width:100%，在 940px 寬的視窗裡撐成約 825×583px。
   * 16:10 的 Mac 非全螢幕時可視高度只剩約 500px，證書就被 modal 的捲軸
   * 截掉，玩家只看到上面 40%（而「再玩一次」也看不到）。
   *
   * 這裡量「除了證書以外的東西」佔掉多少高度，剩下的給證書用。
   * 純 CSS 做不到的原因寫在 style.css 的 .cert-frame 註解裡。
   */
  syncCertificateSize(): void {
    const frame = this.modalCert.querySelector<HTMLElement>('.cert-frame');
    if (!frame || this.modalCert.classList.contains('hidden')) return;

    /*
      兩趟量測，不去加總 padding / gap / 子元素高度 ——
      那樣會漏掉子元素自己的 margin（實測差 21px），而且每加一個元素就要改。

        第一趟：把證書那一格壓成 0，量 modal 剩下多高 → 這就是「其他東西」的成本
        第二趟：可用高度 = 94vh − 成本，寫回去

      這樣不管 modal 裡以後多了什麼，算出來的都是對的。
    */
    frame.style.height = '0px';
    const chrome = this.modalCert.getBoundingClientRect().height;

    // 上限直接讀 CSS 的 max-height（各高度級距不同），
    // 不要在 JS 裡再寫一個比例 —— 兩邊各寫一份就一定會不同步
    const maxH = parseFloat(getComputedStyle(this.modalCert).maxHeight);
    const limit = Number.isFinite(maxH) ? maxH : window.innerHeight * 0.94;

    frame.style.height = `${Math.max(120, Math.round(limit - chrome))}px`;
  }

  isCertificateOpen(): boolean {
    return (
      !this.modalRoot.classList.contains('hidden') && !this.modalCert.classList.contains('hidden')
    );
  }

  private openModal(modal: HTMLElement): void {
    for (const m of [
      this.modalSuccess,
      this.modalFail,
      this.modalHelp,
      this.modalSettings,
      this.modalCert,
    ]) {
      m.classList.toggle('hidden', m !== modal);
    }
    this.modalRoot.classList.remove('hidden');
  }

  closeModal(): void {
    this.modalRoot.classList.add('hidden');
  }

  isModalOpen(): boolean {
    return !this.modalRoot.classList.contains('hidden');
  }

  // ─────────────────────────────── 小工具 ─────────────────────────────────

  private setText(node: HTMLElement, value: string): void {
    if (node.textContent === value) return;
    node.textContent = value;
    // 文字長度改變會影響上方帶狀元素的高度，下一幀要重排一次
    this.bandsDirty = true;
  }
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`UIManager: 找不到 #${id}（index.html 是否被改動？）`);
  return node as T;
}

/**
 * 面板的重建簽章。只要玩家看得見的東西沒變就不重建 DOM
 * （見 UIManager.setPanel 的說明）。
 */
function panelKey(spec: PanelSpec): string {
  const head = `${spec.kind}|${spec.title}|${spec.note ?? ''}|${spec.error ?? ''}`;
  if (spec.kind === 'choice') {
    return `${head}|${spec.options.map((o) => o.id).join(',')}|${[...spec.selected]
      .sort()
      .join(',')}|${spec.max}|${spec.confirmLabel}|${spec.confirmEnabled}`;
  }
  if (spec.kind === 'pour') {
    return `${head}|${spec.rows.map((r) => `${r.id}:${r.parts}`).join(',')}|${
      spec.confirmLabel
    }|${spec.confirmEnabled}|${spec.dumpLabel}|${spec.dumpEnabled}`;
  }
  return `${head}|${spec.label}|${spec.enabled}`;
}
