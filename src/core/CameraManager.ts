import type {
  Hands as HandsSolution,
  HandsConfig,
  Results,
} from '@mediapipe/hands';
import type { Camera as CameraSolution, CameraOptions } from '@mediapipe/camera_utils';
import type { Landmark } from './types';

/**
 * CameraManager
 * ---------------------------------------------------------------------------
 * WebCam 取像 + MediaPipe Hands 推論的唯一入口。
 *
 * 設計重點
 *  - 推論結果只「存」下來（latest），不直接觸發渲染；渲染交給 main.ts 的 rAF 主迴圈，
 *    這樣 UI 幀率不會被推論速度綁死，關卡邏輯也只會在同一個時間軸上跑一次。
 *  - 鏡像只翻 <video>（加 .is-mirrored class），座標翻轉交給 GestureDetector。
 *  - 所有 wasm / tflite 模型都自 public/mediapipe/ 載入，完全離線可用。
 *
 * ⚠️ 為什麼不是 `import { Hands } from '@mediapipe/hands'`？
 *  這兩個套件是 Closure 編譯的 UMD script：它們把 `Hands` / `Camera` 掛到 globalThis，
 *  **沒有** module.exports，而且 package.json 寫了 "sideEffects": []。
 *  用 ESM 具名匯入時 TypeScript 會過（因為有 index.d.ts），但 runtime 會拿到 undefined，
 *  side-effect import 甚至會被 tree-shaking 移掉 —— 這是 MediaPipe + Vite 最惡名昭彰的坑。
 *  正解：型別照樣從 npm 套件 `import type`（型別安全），程式碼則以 <script> 載入
 *  由 scripts/copy-mediapipe.mjs 複製到 public/ 的同一份檔案。
 */

export type FacingMode = 'user' | 'environment';
export type CameraStatus = 'idle' | 'loading' | 'live' | 'error';

/** 資產根目錄。改成 CDN 也可以：`https://cdn.jsdelivr.net/npm/@mediapipe`。 */
const MP_BASE = '/mediapipe';

type HandsCtor = new (config?: HandsConfig) => HandsSolution;
type CameraCtor = new (video: HTMLVideoElement, options: CameraOptions) => CameraSolution;

declare global {
  interface Window {
    Hands?: HandsCtor;
    Camera?: CameraCtor;
  }
}

export interface HandsSnapshot {
  landmarks: Landmark[] | null;
  handedness: string;
}

export interface CameraManagerOptions {
  video: HTMLVideoElement;
  /** 影像層容器，鏡像時會被加上 .is-mirrored */
  stageView: HTMLElement;
  onStatus?: (status: CameraStatus, message?: string) => void;
}

export class CameraManager {
  private readonly video: HTMLVideoElement;
  private readonly stageView: HTMLElement;
  private readonly onStatus?: (status: CameraStatus, message?: string) => void;

  private hands: HandsSolution | null = null;
  private camera: CameraSolution | null = null;

  private facing: FacingMode = 'user';
  private mirror = true;
  private status: CameraStatus = 'idle';
  private starting = false;

  /** 最新一次推論結果，由主迴圈讀取。 */
  private latest: HandsSnapshot = { landmarks: null, handedness: '' };

  constructor(options: CameraManagerOptions) {
    this.video = options.video;
    this.stageView = options.stageView;
    this.onStatus = options.onStatus;
    this.applyMirrorClass();
  }

  getStatus(): CameraStatus {
    return this.status;
  }

  getFacing(): FacingMode {
    return this.facing;
  }

  isMirrored(): boolean {
    return this.mirror;
  }

  /** video 的原生解析度（供 GestureDetector 做 object-fit:cover 映射）。 */
  getVideoSize(): { width: number; height: number } {
    return { width: this.video.videoWidth, height: this.video.videoHeight };
  }

  /** 主迴圈每幀讀一次；沒有手時 landmarks 為 null。 */
  read(): HandsSnapshot {
    return this.latest;
  }

  setMirror(mirror: boolean): void {
    this.mirror = mirror;
    this.applyMirrorClass();
  }

  toggleMirror(): boolean {
    this.setMirror(!this.mirror);
    return this.mirror;
  }

  private applyMirrorClass(): void {
    this.stageView.classList.toggle('is-mirrored', this.mirror);
  }

  private setStatus(status: CameraStatus, message?: string): void {
    this.status = status;
    this.onStatus?.(status, message);
  }

  // ─────────────────────────── 啟動 / 切換 / 停止 ───────────────────────────

  async start(facing: FacingMode = this.facing): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    this.facing = facing;
    this.setStatus('loading', '正在載入手勢模型與啟動鏡頭…');

    try {
      if (!this.hands) this.hands = await this.createHands();
      await this.startCamera();
      this.setStatus('live');
    } catch (error) {
      this.latest = { landmarks: null, handedness: '' };
      this.setStatus('error', describeCameraError(error));
    } finally {
      this.starting = false;
    }
  }

  /** 前 / 後鏡頭切換。 */
  async setFacing(facing: FacingMode): Promise<void> {
    if (facing === this.facing && this.status === 'live') return;
    await this.stopCamera();
    await this.start(facing);
  }

  async toggleFacing(): Promise<FacingMode> {
    await this.setFacing(this.facing === 'user' ? 'environment' : 'user');
    return this.facing;
  }

  async stop(): Promise<void> {
    await this.stopCamera();
    await this.hands?.close();
    this.hands = null;
    this.setStatus('idle');
  }

  // ─────────────────────────────── 內部實作 ────────────────────────────────

  private async createHands(): Promise<HandsSolution> {
    const { Hands } = await loadMediaPipe();

    const hands = new Hands({
      locateFile: (file: string) => `${MP_BASE}/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      // 0 = lite（快）、1 = full（準）。手勢遊戲對指尖精度敏感，預設用 1；
      // 若在低階筆電掉幀，改成 0 可明顯提升 FPS。
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
      // 鏡像一律由我們自己處理（CSS 翻 video + GestureDetector 翻座標），
      // 這裡再開 selfieMode 會變成翻兩次而互相抵消。
      selfieMode: false,
    });

    hands.onResults((results: Results) => {
      const list = results.multiHandLandmarks;
      if (!list || list.length === 0) {
        this.latest = { landmarks: null, handedness: '' };
        return;
      }
      this.latest = {
        landmarks: list[0] as unknown as Landmark[],
        handedness: results.multiHandedness?.[0]?.label ?? '',
      };
    });

    await hands.initialize();
    return hands;
  }

  private async startCamera(): Promise<void> {
    const hands = this.hands;
    if (!hands) throw new Error('Hands 尚未初始化');
    const { Camera } = await loadMediaPipe();

    const camera = new Camera(this.video, {
      facingMode: this.facing,
      width: 1280,
      height: 720,
      onFrame: async () => {
        // video 還沒有實際影像時送進去，wasm 端會丟例外
        if (this.video.readyState < 2) return;
        await hands.send({ image: this.video });
      },
    });

    this.camera = camera;
    await camera.start();
  }

  private async stopCamera(): Promise<void> {
    const camera = this.camera;
    this.camera = null;
    this.latest = { landmarks: null, handedness: '' };

    try {
      await camera?.stop();
    } catch {
      /* 舊版沒有 stop()，靠下面的 track.stop() 收尾 */
    }

    const stream = this.video.srcObject as MediaStream | null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      this.video.srcObject = null;
    }
  }
}

/* ==========================================================================
   MediaPipe script 載入（只會執行一次）
   ========================================================================== */

let mediapipeReady: Promise<{ Hands: HandsCtor; Camera: CameraCtor }> | null = null;

function loadMediaPipe(): Promise<{ Hands: HandsCtor; Camera: CameraCtor }> {
  mediapipeReady ??= (async () => {
    if (!window.Hands) await loadScript(`${MP_BASE}/hands/hands.js`);
    if (!window.Camera) await loadScript(`${MP_BASE}/camera_utils/camera_utils.js`);

    const Hands = window.Hands;
    const Camera = window.Camera;
    if (!Hands || !Camera) {
      throw new Error(
        'MediaPipe 資產缺失。請執行 `npm install`（會自動跑 scripts/copy-mediapipe.mjs 把檔案複製到 public/mediapipe/）。',
      );
    }
    return { Hands, Camera };
  })();

  return mediapipeReady;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`無法載入 ${src}`));
    document.head.appendChild(script);
  });
}

function describeCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return '瀏覽器拒絕了鏡頭權限。請在網址列的權限選單允許攝影機後重新整理。';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return '找不到可用的攝影機（或此裝置沒有你選的鏡頭方向）。';
      case 'NotReadableError':
        return '攝影機正被其他程式佔用，請關閉視訊軟體後再試一次。';
      default:
        return `鏡頭啟動失敗：${error.name}`;
    }
  }
  if (error instanceof Error) return error.message;
  return '鏡頭或手勢模型初始化失敗。';
}
