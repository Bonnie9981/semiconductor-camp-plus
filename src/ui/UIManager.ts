import { HAND_CONNECTIONS, INDEX_TIP, THUMB_TIP } from '../core/GestureDetector';
import type { CameraStatus, FacingMode } from '../core/CameraManager';
import type { StageManager } from '../core/StageManager';
import type { HandFrame, InstructionStep, PanelSpec, SubStep } from '../core/types';

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
  onExportPDF: () => void;
  onRetakePhoto: () => void;
  /** 證書畫面的「再玩一次」：整場重置回第一關。 */
  onPlayAgain: () => void;
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

  // 關卡內互動
  private readonly substepStrip = el<HTMLElement>('substep-strip');
  private readonly stagePanel = el<HTMLElement>('stage-panel');
  private readonly stageAction = el<HTMLButtonElement>('btn-stage-action');
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
    el<HTMLButtonElement>('btn-exit').addEventListener('click', () => this.cb.onExit());

    el<HTMLButtonElement>('btn-cert-pdf').addEventListener('click', () => this.cb.onExportPDF());
    el<HTMLButtonElement>('btn-cert-png').addEventListener('click', () => this.cb.onExportPNG());
    el<HTMLButtonElement>('btn-cert-stl').addEventListener('click', () => this.cb.onExportSTL());
    el<HTMLButtonElement>('btn-cert-retake').addEventListener('click', () => this.cb.onRetakePhoto());
    el<HTMLButtonElement>('btn-cert-close').addEventListener('click', () => {
      this.closeModal();
      this.cb.onPlayAgain();
    });

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
    this.renderSubsteps(stage.substeps, stage.subIndex);
    this.setNextEnabled(stages.isCurrentDone() && stages.hasNext());

    // 只有需要畫筆的關卡才顯示下方工具列
    const tools = document.querySelector<HTMLElement>('.hud-card-tools');
    const preview = this.previewCanvas.closest<HTMLElement>('.hud-card');
    tools?.classList.toggle('hidden', !stage.usesPenTools);
    preview?.classList.toggle('hidden', !stage.usesPenTools);
    this.sectionCard.classList.toggle('hidden', !stage.usesCrossSection);
  }

  /**
   * 關卡內子步驟進度列。已完成的打勾、目前這步高亮、還沒到的變灰。
   * subIndex 等於 substeps.length 代表全部做完（整列都會是打勾狀態）。
   */
  renderSubsteps(substeps: readonly SubStep[], subIndex: number): void {
    if (substeps.length === 0) {
      this.substepStrip.classList.add('hidden');
      this.substepStrip.replaceChildren();
      this.cache.delete('substeps');
      return;
    }

    const key = `${substeps.map((s) => s.id).join('|')}#${subIndex}`;
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
      const done = i < subIndex;
      const active = i === subIndex;
      li.className = `substep ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}`;
      li.title = step.desc;

      const num = document.createElement('span');
      num.className = 'substep-num';
      num.textContent = done ? '✓' : String(i + 1);

      const label = document.createElement('span');
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
    } else if (spec.kind === 'mix') {
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
        parts.className = 'sp-parts';
        const minus = stepButton('−', () => {
          const cur = this.panelSpec;
          if (cur?.kind === 'mix') cur.onAdjust(row.id, -1);
        });
        const count = document.createElement('span');
        count.className = 'sp-count';
        count.textContent = String(row.parts);
        const plus = stepButton('＋', () => {
          const cur = this.panelSpec;
          if (cur?.kind === 'mix') cur.onAdjust(row.id, +1);
        });
        parts.append(minus, count, plus);

        line.append(dot, labels, parts);
        body.append(line);
      }

      const ratio = document.createElement('div');
      ratio.className = 'sp-ratio';
      const total = spec.rows.reduce((s, r) => s + r.parts, 0);
      ratio.innerHTML =
        total === 0
          ? '目前比例 <b>—</b>'
          : `目前比例 <b>${spec.rows.map((r) => r.parts).join(' : ')}</b>　總量 ${total} 份`;
      body.append(ratio);
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

  /** 顯示結業證書。傳入已排版好的 canvas，這裡只負責縮放顯示。 */
  showCertificate(image: HTMLCanvasElement): void {
    const ctx = this.certCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, this.certCanvas.width, this.certCanvas.height);
      ctx.drawImage(image, 0, 0, this.certCanvas.width, this.certCanvas.height);
    }
    this.openModal(this.modalCert);
  }

  isCertificateOpen(): boolean {
    return !this.modalRoot.classList.contains('hidden') && !this.modalCert.classList.contains('hidden');
  }

  private openModal(modal: HTMLElement): void {
    for (const m of [this.modalSuccess, this.modalFail, this.modalHelp, this.modalSettings, this.modalCert]) {
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

function stepButton(glyph: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sp-step';
  btn.textContent = glyph;
  btn.dataset.pinch = '1';
  btn.addEventListener('click', onClick);
  return btn;
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
  if (spec.kind === 'mix') {
    return `${head}|${spec.rows.map((r) => `${r.id}:${r.parts}`).join(',')}|${
      spec.confirmLabel
    }|${spec.confirmEnabled}`;
  }
  if (spec.kind === 'pour') {
    return `${head}|${spec.rows.map((r) => `${r.id}:${r.parts}`).join(',')}|${
      spec.confirmLabel
    }|${spec.confirmEnabled}|${spec.dumpLabel}|${spec.dumpEnabled}`;
  }
  return `${head}|${spec.label}|${spec.enabled}`;
}
