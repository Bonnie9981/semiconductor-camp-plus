import type {
  InstructionStep,
  PanelSpec,
  StageContext,
  StageFrame,
  StageResult,
  SubStep,
} from '../core/types';
import { solution } from '../data/solutions';
import { DipStageBase, type DipRound } from './DipStageBase';

/**
 * 第四關：顯影
 * ---------------------------------------------------------------------------
 * 兩個子步驟，但實際上是同一個連續動作：**把晶圓拖進正確的顯影液，然後攪拌**。
 *
 * 正解固定是 TMAH（四甲基氫氧化銨）—— 不含金屬離子，是半導體製程的標準顯影液，
 * 正光阻與現代化學增幅型負光阻都用它。其餘三槽是干擾項，選錯會擋下並說明原因：
 *   丙酮   會把整層光阻都溶掉，圖案全毀
 *   二甲苯 早期負光阻的有機溶劑，量產線已不使用
 *   純水   根本溶不掉光阻
 *
 * 顯影完成時呼叫 WaferState.develop()，依 exposedMask 與 resistTone
 * 算出 resistMask —— 圖案就在右下角的截面圖上顯現出來。
 */

const DEVELOPER_COLOR = '#8ad4c4';
/** 光阻層的顏色，與第三關一致。 */
const DEVELOPER_RESIST_COLOR = '#2f7d5b';

export class Stage4Develop extends DipStageBase {
  readonly id = 'develop';
  readonly title = '顯影';
  readonly shortTitle = '顯影';
  readonly description =
    '把晶圓泡進顯影液，溶掉該溶的光阻，讓曝光時轉印的圖案真正顯現出來。';
  readonly hint = '捏起晶圓拖進正確的顯影液槽；泡下去之後左右晃動手就是攪拌，反應更快。';
  readonly primaryLabel = '完成顯影';
  readonly usesCrossSection = true;

  readonly substeps: readonly SubStep[] = [
    { id: 'reagent', title: '顯影液選擇', desc: '半導體標準顯影液：不含金屬離子的 TMAH' },
    { id: 'react', title: '顯影反應', desc: '浸泡並攪拌，圖案在截面圖上顯現' },
  ];

  readonly instructions: InstructionStep[] = [
    { glyph: '🧪', title: '選出標準顯影液', desc: 'TMAH 不含金屬離子，是半導體製程的標準顯影液。' },
    { glyph: '🤏', title: '拖進正確的槽', desc: '捏起晶圓移到槽上方放開，選錯會被擋下並說明原因。' },
    { glyph: '🌊', title: '左右晃動攪拌', desc: '攪拌能帶走溶解物、讓新鮮藥液接觸表面，反應快一倍。' },
    { glyph: '🔍', title: '看右下角截面圖', desc: '光阻被溶掉的地方會出現缺口 —— 那就是你畫的圖案。' },
  ];

  private picked: string | null = null;

  // ─────────────────────────────── 生命週期 ────────────────────────────────

  override onEnter(ctx: StageContext): void {
    super.onEnter(ctx);
    ctx.desk.setWaferVisible(false);
    ctx.desk.setDeskLabel('DEVELOP BENCH · 顯影檯');
    // 開發者模式直接跳關進來時晶圓上還沒有光阻，補一層才顯影得出東西
    if (!ctx.wafer.hasLayer('resist')) {
      ctx.wafer.addLayer({
        kind: 'resist',
        label: '光阻層',
        thickness: 0.45,
        color: DEVELOPER_RESIST_COLOR,
        patterned: false,
      });
    }
    this.resetSub();
    this.onSubEnter(0);
  }

  override onExit(): void {
    this.ctx?.ui.setPanel(null);
    this.ctx?.desk.setWaferVisible(true);
    this.ctx?.desk.setDeskLabel(null);
  }

  override restart(): void {
    super.restart();
    this.picked = null;
    // 把光阻遮罩還原成「整片都在」
    const w = this.ctx?.wafer;
    if (w) {
      w.resistMask = w.resistMask.map(() => 1);
      const resist = w.layers.find((l) => l.kind === 'resist');
      if (resist) resist.patterned = false;
    }
    this.resetDip();
    this.onSubEnter(0);
  }

  /**
   * 兩個子步驟其實是同一個連續動作：晶圓一泡下去就從「選試劑」進到「顯影反應」。
   * 所以只有回到第 0 步才重設，否則推進子步驟會把正在進行的浸泡清掉。
   */
  protected override onSubEnter(index: number): void {
    if (index === 0) this.resetDip();
  }

  /**
   * 正確答案固定是 TMAH。
   *
   * 半導體製程的標準顯影液就是 TMAH（四甲基氫氧化銨）——不含金屬離子，
   * 正光阻與現代化學增幅型負光阻都用它。二甲苯那類有機溶劑是早期負光阻的做法，
   * 現在的量產線不會用，所以在這裡只當干擾項。
   */
  private get answer(): string {
    return 'tmah';
  }

  private buildRound(): DipRound {
    return {
      tanks: [
        { id: 'tmah' },
        { id: 'xylene' },
        { id: 'acetone' },
        { id: 'di' },
      ],
      answer: this.answer,
      seconds: 5,
      actionLabel: '顯影',
      wrongHint: (id) => {
        if (id === 'acetone') return '丙酮會把整層光阻都溶掉，圖案會全部消失。顯影液必須只溶掉「該溶的那一半」。';
        if (id === 'di') return '純水溶不掉光阻，泡再久也不會有反應。';
        if (id === 'xylene') return '二甲苯是早期負光阻用的有機溶劑，量產線已不使用。半導體的標準顯影液是不含金屬離子的 TMAH。';
        return '這不是顯影液。';
      },
    };
  }

  // ───────────────────────────────── 主迴圈 ────────────────────────────────

  override onFrame(frame: StageFrame): void {
    const { desk, ui } = frame;
    const { deskTop, deskHeight } = desk.geometry;
    const groundY = deskTop + deskHeight * 0.44;
    const wafer = this.ctx.wafer;

    if (!this.currentSub) {
      ui.setArHint('✅ 顯影完成 — 按右側「完成顯影」進入下一關', true);
      ui.setHandState('✨', '圖案已顯現', 'DEVELOP COMPLETE', true);
      this.ctx.ui.setPanel(null);
      return;
    }

    const round = this.buildRound();
    const done = this.runDip(frame, groundY, round, {
      waferColor: wafer.surfaceColor(),
      filmColor: DEVELOPER_COLOR,
    });

    // 泡下去就代表試劑選對了，把「選擇」那一步標記完成
    if (this.dipIndex >= 0 && this.currentSub.id === 'reagent') {
      this.picked = round.answer;
      this.nextSub();
    }

    if (done) {
      wafer.develop();
      this.nextSub();
      return;
    }

    this.dipHints(frame, round);
    this.ctx.ui.setPanel(this.buildPanel(round));
  }

  private buildPanel(round: DipRound): PanelSpec | null {
    const positive = this.ctx.wafer.resistTone === 'positive';
    const toneLabel = positive ? '正型光阻' : '負型光阻';

    if (this.dipIndex >= 0) {
      return {
        kind: 'action',
        title: '顯影反應',
        note: `${solution(round.answer).name}正在溶解該溶的光阻。左右晃動手就是攪拌 —— 帶走溶解物、讓新鮮藥液接觸表面，反應會快一倍。`,
        label: `顯影中… ${Math.round(this.reactT * 100)}%`,
        enabled: false,
        onClick: () => {},
      };
    }

    return {
      kind: 'action',
      title: '顯影液選擇',
      note: `你在微影那關選的是 ${toneLabel}，${
        positive
          ? '曝光區斷鏈後會變得可溶，顯影時被洗掉。'
          : '曝光區交聯硬化後留下，其餘被洗掉。'
      }\n兩者都用同一種顯影液：TMAH（四甲基氫氧化銨）——不含金屬離子，是半導體製程的標準顯影液。\n捏起晶圓，拖進正確的那一槽。`,
      error: this.error ?? undefined,
      label: '沒有鏡頭？直接放入正確的槽',
      enabled: true,
      onClick: () => {
        // 備援：直接開始顯影
        this.dipIndex = round.tanks.findIndex((t) => t.id === round.answer);
        this.dipDepth = 0;
        this.reactT = 0;
        this.error = null;
      },
    };
  }

  // ─────────────────────────────── 過關判定 ────────────────────────────────

  override canComplete(): boolean {
    return this.subsFinished;
  }

  override buildResult(): StageResult {
    return { developer: this.picked, tone: this.ctx.wafer.resistTone };
  }
}
