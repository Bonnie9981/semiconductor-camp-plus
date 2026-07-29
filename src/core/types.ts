/**
 * 全專案共用的型別。放在 core/ 讓 stages / ui / utils 都能以 `import type` 引用，
 * 型別在編譯後會被抹除，因此不會產生 runtime 的循環相依。
 */

import type { UIManager } from '../ui/UIManager';
import type { VirtualDesk } from '../ui/VirtualDesk';
import type { StageManager } from './StageManager';
import type { WaferState } from './WaferState';

export interface Point {
  x: number;
  y: number;
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** GestureDetector 每一幀輸出的手部狀態（座標已完成鏡像 + object-fit:cover 映射）。 */
export interface HandFrame {
  /** 這一幀是否偵測到手 */
  present: boolean;
  /** 21 個關節點，單位為 AR canvas 的 CSS px */
  landmarks: Point[];
  /** 21 個關節點，單位為 0~1（已套用鏡像），給右上角手勢參考小視窗使用 */
  normalized: Point[];
  /** 是否處於 Pinch（拇指尖 4 與食指尖 8 靠攏） */
  pinching: boolean;
  /** 這一幀「剛剛捏下去」 */
  justPinched: boolean;
  /** 這一幀「剛剛放開」 */
  justReleased: boolean;
  /** Pinch 中心點（拇指尖與食指尖的中點，已做平滑處理），單位 px */
  pinchPoint: Point;
  /** 拇指尖 4 與食指尖 8 的 normalized 歐氏距離（越小越接近捏合） */
  pinchDistance: number;
  /** 'Left' | 'Right'（MediaPipe 的標記，鏡像後即為玩家自己的左右手） */
  handedness: string;
}

/** 關卡完成時回傳的資料，會存進 StageManager.results。 */
export interface StageResult {
  [key: string]: unknown;
}

/** 關卡在 onEnter / onFrame / onPrimaryAction 中可以取用的一切。 */
export interface StageContext {
  ui: UIManager;
  desk: VirtualDesk;
  stages: StageManager;
  /** 整條製程共用的晶圓狀態；每一關都在改同一片晶圓。 */
  wafer: WaferState;
}

/** 每一幀傳給 BaseStage.onFrame 的參數。 */
export interface StageFrame extends StageContext {
  hand: HandFrame;
  /** #ar-canvas 的 2D context（已依 DPR 設好 transform，直接用 CSS px 畫） */
  ar: CanvasRenderingContext2D;
  /** AR canvas 的 CSS 寬高 */
  width: number;
  height: number;
  /** 距離上一幀的秒數 */
  dt: number;
  /** 累積時間（秒） */
  time: number;
}

/** 右側面板「操作說明」的一列。 */
export interface InstructionStep {
  glyph: string;
  title: string;
  desc: string;
}

export type StageStatus = 'locked' | 'active' | 'done';

// ───────────────────────────────── 子步驟 ──────────────────────────────────

/**
 * 關卡內的子步驟。例如 RCA 這一關有「去微粒 / 去氧化層 / 去離子 / 乾燥」四步。
 * 子步驟只影響畫面與流程，不影響 StageManager 的 locked/active/done 狀態機——
 * 一整關的子步驟全部走完，這一關才算 done。
 */
export interface SubStep {
  id: string;
  /** 顯示在畫面上方子步驟列的短標題。 */
  title: string;
  /** 一句話說明，顯示在右側面板。 */
  desc: string;
}

// ─────────────────────────── 關卡互動面板（HTML） ───────────────────────────
// 關卡不直接碰 DOM，而是把「我現在要玩家做什麼」描述成一份 PanelSpec 交給
// UIManager 渲染。三種面板涵蓋了全部五關的互動：
//   choice —— 選溶液 / 選正負光阻 / 選顯影劑 / 選蝕刻方式
//   mix    —— 調配比例（5:1:1、6:1:1）
//   action —— 單一按鈕（開始烘乾 / 開始曝光 / 開始蝕刻）

export interface ChoiceOption {
  id: string;
  label: string;
  /** 副標，通常放化學式。 */
  sub?: string;
  /** 左側色塊顏色。 */
  color?: string;
  /** 選項圖示（emoji）。 */
  glyph?: string;
}

export interface MixRow {
  id: string;
  label: string;
  sub?: string;
  color: string;
  /** 目前份數。 */
  parts: number;
}

interface PanelBase {
  title: string;
  /** 標題下方的補充說明。 */
  note?: string;
  /** 面板底部的錯誤／提示訊息（例如「這個組合不正確」）。 */
  error?: string;
}

export interface ChoicePanel extends PanelBase {
  kind: 'choice';
  options: ChoiceOption[];
  /** 目前被選起來的 option id。 */
  selected: string[];
  /** 最多可選幾個；已達上限時未選中的選項會變灰。 */
  max: number;
  confirmLabel: string;
  confirmEnabled: boolean;
  onToggle(id: string): void;
  onConfirm(): void;
}

export interface MixPanel extends PanelBase {
  kind: 'mix';
  rows: MixRow[];
  confirmLabel: string;
  confirmEnabled: boolean;
  onAdjust(id: string, delta: number): void;
  onConfirm(): void;
}

export interface ActionPanel extends PanelBase {
  kind: 'action';
  label: string;
  enabled: boolean;
  onClick(): void;
}

/**
 * 調配杯面板：只讀地顯示「目前杯子裡有什麼」，配方是玩家實際把藥瓶倒進杯子
 * 累積出來的，不是在面板上按加減。所以這裡沒有 onAdjust，只有兩個出口——
 * 送去浸泡，或倒掉重來。
 */
export interface PourPanel extends PanelBase {
  kind: 'pour';
  /** 已倒入的成分，依倒入順序；空陣列＝空杯。 */
  rows: MixRow[];
  confirmLabel: string;
  confirmEnabled: boolean;
  onConfirm(): void;
  dumpLabel: string;
  dumpEnabled: boolean;
  onDump(): void;
}

export type PanelSpec = ChoicePanel | MixPanel | ActionPanel | PourPanel;
