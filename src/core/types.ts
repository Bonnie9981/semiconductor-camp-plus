/**
 * 全專案共用的型別。放在 core/ 讓 stages / ui / utils 都能以 `import type` 引用，
 * 型別在編譯後會被抹除，因此不會產生 runtime 的循環相依。
 */

import type { UIManager } from '../ui/UIManager';
import type { VirtualDesk } from '../ui/VirtualDesk';
import type { StageManager } from './StageManager';

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
