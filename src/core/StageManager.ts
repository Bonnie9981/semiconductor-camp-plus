import type { BaseStage } from '../stages/BaseStage';
import type { StageContext, StageResult, StageStatus } from './types';

/**
 * StageManager —— 關卡切換狀態機。
 * ---------------------------------------------------------------------------
 *   locked ──(前一關 done)──▶ active ──(completeCurrent)──▶ done
 *      ▲                                                      │
 *      └──────────────────── reset() ◀────────────────────────┘
 *
 * 只維護「順序 / 狀態 / 結果」三件事，完全不碰 DOM；UI 透過 subscribe() 收到通知後
 * 自行重繪。要新增關卡就 register() 一個 BaseStage 子類別，順序即為註冊順序。
 */

export type StageEvent =
  | { type: 'change'; index: number; stage: BaseStage }
  | { type: 'substep'; index: number; stage: BaseStage }
  | { type: 'complete'; index: number; stage: BaseStage; result: StageResult }
  | { type: 'allComplete' }
  | { type: 'fail'; reason: string }
  | { type: 'reset' };

type Listener = (event: StageEvent) => void;

export class StageManager {
  private readonly stages: BaseStage[] = [];
  private status: StageStatus[] = [];
  private results: Record<string, StageResult> = {};
  private index = 0;
  private started = false;
  private listeners: Listener[] = [];
  private context: StageContext | null = null;

  /** main.ts 在建立 UIManager / VirtualDesk 之後注入。 */
  attachContext(context: StageContext): void {
    this.context = context;
  }

  register(stage: BaseStage): this {
    this.stages.push(stage);
    this.status.push(this.stages.length === 1 ? 'active' : 'locked');
    return this;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: StageEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private requireContext(): StageContext {
    if (!this.context) throw new Error('StageManager: 尚未呼叫 attachContext()');
    return this.context;
  }

  // ───────────────────────────────── 查詢 ──────────────────────────────────

  get all(): readonly BaseStage[] {
    return this.stages;
  }

  get total(): number {
    return this.stages.length;
  }

  get currentIndex(): number {
    return this.index;
  }

  get current(): BaseStage {
    return this.stages[this.index];
  }

  statusOf(index: number): StageStatus {
    return this.status[index] ?? 'locked';
  }

  get doneCount(): number {
    return this.status.filter((s) => s === 'done').length;
  }

  /** 進度百分比（0~100），Header 進度條用。 */
  get progressPercent(): number {
    if (this.total === 0) return 0;
    return Math.round((this.doneCount / this.total) * 100);
  }

  get resultMap(): Readonly<Record<string, StageResult>> {
    return this.results;
  }

  resultOf(stageId: string): StageResult | undefined {
    return this.results[stageId];
  }

  /** 目前這關是否已完成（決定「下一步」按鈕是否解鎖）。 */
  isCurrentDone(): boolean {
    return this.status[this.index] === 'done';
  }

  hasNext(): boolean {
    return this.index + 1 < this.total;
  }

  // ───────────────────────────────── 動作 ──────────────────────────────────

  start(): void {
    if (this.started || this.total === 0) return;
    this.started = true;
    this.current.onEnter(this.requireContext());
    this.emit({ type: 'change', index: this.index, stage: this.current });
  }

  /**
   * 跳到指定關卡。
   * locked 的關卡預設不允許跳入；`force` 為 true 時無視鎖定並順手解鎖，
   * 供開發者模式測試用。
   */
  goTo(index: number, force = false): boolean {
    if (index < 0 || index >= this.total) return false;
    if (index === this.index) return true;
    if (this.status[index] === 'locked') {
      if (!force) return false;
      this.status[index] = 'active';
    }

    this.current.onExit();
    this.index = index;
    this.current.onEnter(this.requireContext());
    this.emit({ type: 'change', index: this.index, stage: this.current });
    return true;
  }

  /** 完成目前關卡：標記 done、解鎖下一關（但不自動跳過去）。 */
  completeCurrent(result: StageResult = {}): void {
    if (this.status[this.index] === 'done') return;

    const stage = this.current;
    this.results[stage.id] = result;
    this.status[this.index] = 'done';

    const next = this.index + 1;
    if (next < this.total && this.status[next] === 'locked') {
      this.status[next] = 'active';
    }

    this.emit({ type: 'complete', index: this.index, stage, result });
    if (this.doneCount === this.total) this.emit({ type: 'allComplete' });
  }

  /**
   * 開發者模式的強制完成：不檢查 canComplete()，直接把目前這關標記為 done。
   * 先讓關卡透過 devComplete() 把它對晶圓該做的事補上，
   * 後面的關卡與最終的證書才不會拿到一片空白的晶圓。
   */
  forceCompleteCurrent(): void {
    if (this.status[this.index] === 'done') return;
    const stage = this.current;
    stage.devComplete();
    this.completeCurrent(stage.buildResult());
  }

  /** 前進到下一關（需目前關卡已 done）。 */
  advance(): boolean {
    if (!this.isCurrentDone() || !this.hasNext()) return false;
    return this.goTo(this.index + 1);
  }

  fail(reason: string): void {
    this.emit({ type: 'fail', reason });
  }

  /**
   * 由 BaseStage.goToSub() 呼叫，通知 UI「關卡內的子步驟換了」。
   * 刻意不放進 goTo()／completeCurrent() 的流程，因為子步驟不改變關卡狀態機。
   */
  notifySubChange(): void {
    this.emit({ type: 'substep', index: this.index, stage: this.current });
  }

  /** 重玩目前這一關（不動已完成的其他關卡）。 */
  restartCurrent(): void {
    this.current.restart();
    this.emit({ type: 'change', index: this.index, stage: this.current });
  }

  /** 整場重置回第一關。 */
  reset(): void {
    if (this.started) this.current.onExit();
    this.results = {};
    this.status = this.stages.map((_, i) => (i === 0 ? 'active' : 'locked'));
    this.index = 0;
    for (const stage of this.stages) stage.restart();
    this.current.onEnter(this.requireContext());
    this.emit({ type: 'reset' });
    this.emit({ type: 'change', index: this.index, stage: this.current });
  }
}
