/**
 * WaferState —— 晶圓的「層堆疊」模型
 * ---------------------------------------------------------------------------
 * 整條製程的每一步都在改變晶圓的剖面結構：
 *
 *   RCA 清洗   微粒／原生氧化層／離子殘留／水滴 → 全部清掉
 *   沉積       疊上氧化層（CVD）或金屬層（PVD）
 *   光阻塗布   疊上光阻層，曝光後標記哪些區域被光照到
 *   顯影       移除（正光阻）或保留（負光阻）被曝光的區域
 *   蝕刻       把沒有光阻保護的下層挖掉，最後剝除光阻
 *
 * 這個模型是「唯一真實來源」：截面圖 HUD 與俯視晶圓都從這裡取資料渲染，
 * 關卡只負責改狀態，不負責畫圖。
 */

export type LayerKind = 'silicon' | 'oxide' | 'metal' | 'resist';

export interface WaferLayer {
  kind: LayerKind;
  /** 顯示名稱，例如「二氧化矽 SiO₂」。 */
  label: string;
  /** 相對厚度（無單位，截面圖依比例分配高度）。 */
  thickness: number;
  color: string;
  /**
   * 這一層是否已經圖案化（被蝕刻或顯影出溝槽）。
   * 截面圖會依 pattern 陣列切出缺口。
   */
  patterned: boolean;
}

/** 表面污染物，只在 RCA 關卡有意義。 */
export interface Contamination {
  /** 微粒殘留量 0~1。 */
  particles: number;
  /** 原生氧化層殘留量 0~1。 */
  oxide: number;
  /** 金屬離子殘留量 0~1。 */
  ions: number;
  /** 表面水分 0~1。 */
  water: number;
}

/** 顯影後決定哪些區域留下光阻。1 = 有光阻，0 = 已移除。 */
export type ResistMask = number[];

/** 截面圖橫向取樣格數（同時也是 ResistMask 的長度）。 */
export const SECTION_CELLS = 24;

export class WaferState {
  /** 由下而上的層堆疊；index 0 永遠是矽基板。 */
  layers: WaferLayer[] = [];

  contamination: Contamination = { particles: 0, oxide: 0, ions: 0, water: 0 };

  /** 光阻遮罩（顯影後才有意義）。 */
  resistMask: ResistMask = new Array(SECTION_CELLS).fill(1);

  /** 曝光遮罩：1 = 這一格被光照到。 */
  exposedMask: ResistMask = new Array(SECTION_CELLS).fill(0);

  /** 玩家選的是正光阻還是負光阻。 */
  resistTone: 'positive' | 'negative' = 'positive';

  /**
   * 蝕刻的側向咬蝕程度 0~1。
   * 乾式蝕刻是鉛直的（0，側壁筆直）；濕式蝕刻是等向性的（1，溝槽會往光阻底下
   * 橫向擴大，也就是 undercut）。截面圖靠這個值把兩種蝕刻畫成不同的形狀。
   */
  undercut = 0;

  /** 哪些格子的材料已經被蝕刻掉；1 = 已蝕穿。 */
  etchedMask: ResistMask = new Array(SECTION_CELLS).fill(0);

  constructor() {
    this.reset();
  }

  /** 回到製程最開始：一片髒的裸矽晶圓。 */
  reset(): void {
    this.layers = [
      { kind: 'silicon', label: '矽基板 Si', thickness: 3.2, color: '#5c6b74', patterned: false },
    ];
    this.contamination = { particles: 1, oxide: 1, ions: 1, water: 0 };
    this.resistMask = new Array(SECTION_CELLS).fill(1);
    this.exposedMask = new Array(SECTION_CELLS).fill(0);
    this.etchedMask = new Array(SECTION_CELLS).fill(0);
    this.undercut = 0;
  }

  /** 疊上一層新的薄膜。 */
  addLayer(layer: WaferLayer): void {
    this.layers.push(layer);
  }

  /** 取得最上面一層（一定存在，至少有矽基板）。 */
  get topLayer(): WaferLayer {
    return this.layers[this.layers.length - 1];
  }

  hasLayer(kind: LayerKind): boolean {
    return this.layers.some((l) => l.kind === kind);
  }

  removeLayer(kind: LayerKind): void {
    this.layers = this.layers.filter((l) => l.kind !== kind);
  }

  /**
   * 顯影：依正／負光阻決定哪些格子的光阻被溶掉。
   *   正光阻 —— 被光照到的斷鏈變可溶 → 曝光區被移除
   *   負光阻 —— 被光照到的交聯硬化 → 曝光區保留，其餘被移除
   */
  develop(): void {
    for (let i = 0; i < SECTION_CELLS; i++) {
      const exposed = this.exposedMask[i] > 0.5;
      const keep = this.resistTone === 'positive' ? !exposed : exposed;
      this.resistMask[i] = keep ? 1 : 0;
    }
    const resist = this.layers.find((l) => l.kind === 'resist');
    if (resist) resist.patterned = true;
  }

  /** 蝕刻：沒有光阻保護的地方被挖掉。 */
  etch(undercut: number): void {
    this.undercut = undercut;
    for (let i = 0; i < SECTION_CELLS; i++) {
      this.etchedMask[i] = this.resistMask[i] > 0.5 ? 0 : 1;
    }
    // 濕式蝕刻是等向性的，會往光阻底下橫向咬進去
    if (undercut > 0.5) {
      const base = [...this.etchedMask];
      for (let i = 0; i < SECTION_CELLS; i++) {
        if (base[i] < 0.5) continue;
        if (i > 0) this.etchedMask[i - 1] = Math.max(this.etchedMask[i - 1], 0.6);
        if (i < SECTION_CELLS - 1) this.etchedMask[i + 1] = Math.max(this.etchedMask[i + 1], 0.6);
      }
    }
    const top = this.topLayer;
    if (top.kind !== 'silicon') top.patterned = true;
  }

  /** RCA 是否已經洗乾淨（四項污染都低於門檻）。 */
  get isClean(): boolean {
    const c = this.contamination;
    return c.particles < 0.05 && c.oxide < 0.05 && c.ions < 0.05 && c.water < 0.05;
  }

  /**
   * 俯視晶圓的表面色。截面圖與俯視圖共用，讓兩邊看起來是同一片晶圓。
   * 污染物會讓表面偏黃濁，洗乾淨後回到矽的銀灰色。
   */
  surfaceColor(): string {
    const top = this.topLayer;
    if (top.kind !== 'silicon') return top.color;
    const dirt = Math.max(this.contamination.particles, this.contamination.oxide);
    return dirt > 0.5 ? '#9a9376' : dirt > 0.15 ? '#a8ab9c' : '#c6d2d8';
  }
}
