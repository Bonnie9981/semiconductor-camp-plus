import { HAND_CONNECTIONS, INDEX_TIP, THUMB_TIP } from '../core/GestureDetector';
import type { CameraStatus, FacingMode } from '../core/CameraManager';
import type { StageManager } from '../core/StageManager';
import type { HandFrame, InstructionStep } from '../core/types';

/**
 * UIManager —— 所有 HTML UI（#ui-layer, z-index:10）的唯一操作入口。
 * ---------------------------------------------------------------------------
 * 關卡與主迴圈只呼叫這裡的方法，不直接碰 DOM。
 * 所有 setter 都會先比對舊值，值沒變就不動 DOM，避免每秒 60 次的無謂 reflow。
 */

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
  onToggleMirror: () => void;
  onToggleCamera: () => void;
  onToggleSkeleton: (visible: boolean) => void;
  onExportPNG: () => void;
  onExportSTL: () => void;
  onRetry: () => void;
  onExit: () => void;
}

export interface SuccessModalData {
  title: string;
  description: string;
  image: HTMLCanvasElement | null;
  continueLabel: string;
  showExports: boolean;
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

  // Footer
  private readonly stageFlow = el<HTMLElement>('stage-flow');

  // Modals
  private readonly modalRoot = el<HTMLElement>('modal-root');
  private readonly modalSuccess = el<HTMLElement>('modal-success');
  private readonly modalFail = el<HTMLElement>('modal-fail');
  private readonly modalHelp = el<HTMLElement>('modal-help');
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

  // ─────────────────────────────── 事件綁定 ────────────────────────────────

  private bindEvents(): void {
    this.btnPrimary.addEventListener('click', () => this.cb.onPrimary());
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
    el<HTMLButtonElement>('btn-exit').addEventListener('click', () => this.cb.onExit());

    el<HTMLButtonElement>('btn-help').addEventListener('click', () => this.openModal(this.modalHelp));
    el<HTMLButtonElement>('btn-help-close').addEventListener('click', () => this.closeModal());
    el<HTMLButtonElement>('btn-settings').addEventListener('click', () => this.openModal(this.modalSettings));
    el<HTMLButtonElement>('btn-settings-close').addEventListener('click', () => this.closeModal());

    el<HTMLInputElement>('set-skeleton').addEventListener('change', (e) => {
      this.cb.onToggleSkeleton((e.target as HTMLInputElement).checked);
    });
    el<HTMLInputElement>('set-mirror').addEventListener('change', () => this.cb.onToggleMirror());
    el<HTMLInputElement>('set-pen-width').addEventListener('input', (e) => {
      this.cb.onPenWidth(Number((e.target as HTMLInputElement).value));
    });
    el<HTMLInputElement>('set-pinch').addEventListener('input', (e) => {
      // slider 30~90 → 門檻 0.030~0.090
      this.cb.onPinchSensitivity(Number((e.target as HTMLInputElement).value) / 1000);
    });

    document.querySelector<HTMLElement>('.modal-backdrop')?.addEventListener('click', () => {
      // 結算 / 失敗 Modal 必須做出選擇，只有說明與設定可以點背景關閉
      if (!this.modalHelp.classList.contains('hidden') || !this.modalSettings.classList.contains('hidden')) {
        this.closeModal();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeModal();
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
        if (status !== 'locked') li.addEventListener('click', () => this.cb.onSelectStage(i));
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
      if (status !== 'locked') node.addEventListener('click', () => this.cb.onSelectStage(i));
      flowNodes.push(node);
    });
    this.stageFlow.replaceChildren(...flowNodes);

    // 右側面板
    this.setText(this.panelCounter, `STEP ${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`);
    this.setText(this.panelTitle, stage.title);
    this.setText(this.panelDesc, stage.description);
    this.setText(this.liveLabel, `LIVE · ${stage.shortTitle}`);
    this.setText(this.hintText, stage.hint);
    this.setText(this.btnPrimary, stage.primaryLabel);
    this.setText(this.statusSub, `已完成 ${stages.doneCount} / ${total} 步驟`);

    this.renderInstructions(stage.instructions);
    this.setNextEnabled(stages.isCurrentDone() && stages.hasNext());

    // 只有需要畫筆的關卡才顯示下方工具列
    const tools = document.querySelector<HTMLElement>('.hud-card-tools');
    const preview = this.previewCanvas.closest<HTMLElement>('.hud-card');
    tools?.classList.toggle('hidden', !stage.usesPenTools);
    preview?.classList.toggle('hidden', !stage.usesPenTools);
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
      ctx.font = "10px 'IBM Plex Mono', monospace";
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

  private openModal(modal: HTMLElement): void {
    for (const m of [this.modalSuccess, this.modalFail, this.modalHelp, this.modalSettings]) {
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
  }
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`UIManager: 找不到 #${id}（index.html 是否被改動？）`);
  return node as T;
}
