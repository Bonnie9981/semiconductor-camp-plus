import type { HandFrame } from './types';

/**
 * 滑鼠 / 觸控當「手」
 * ---------------------------------------------------------------------------
 * 遊戲的命中判定全部吃 `HandFrame`（捏合點 + 是否捏合）。這個類別把
 * 「在鏡頭視窗上按住拖曳」翻譯成一份等效的 HandFrame，讓沒有攝影機的人
 * （桌機滑鼠、手機觸控）也能直接抓畫面上的藥瓶、光罩、旋鈕 —— 而不是
 * 只能點左側面板的備援按鈕。
 *
 * 規則：
 *   · 按在真正的 HTML 控制項（按鈕、面板、HUD 卡片…）上 → 不接管，讓它正常點擊
 *   · 按在鏡頭視窗的空白處 → 接管，pressed 期間輸出 pinching 的手
 *   · 有真實鏡頭在追蹤時，只有在使用者實際按住時才蓋過鏡頭的手
 */
const IGNORE_SELECTOR =
  'button, a, input, select, textarea, label, .stage-panel, #sidebar, #right-panel, #app-header, .modal, .hud-card, .gesture-ref, .chip, .substep-strip';

export class PointerHand {
  private pressed = false;
  private prevPressed = false;
  private client = { x: 0, y: 0 };

  constructor(root: HTMLElement) {
    const onDown = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (this.isInteractive(e.target, root)) return;
      this.pressed = true;
      this.client = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent): void => {
      if (this.pressed) this.client = { x: e.clientX, y: e.clientY };
    };
    const onUp = (): void => {
      this.pressed = false;
    };

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
  }

  private isInteractive(target: EventTarget | null, root: HTMLElement): boolean {
    let node = target as HTMLElement | null;
    while (node && node !== root.parentElement) {
      if (node.matches?.(IGNORE_SELECTOR)) return true;
      node = node.parentElement;
    }
    return false;
  }

  /** 這一幀是否該用指標的手蓋過鏡頭（按住中，或剛放開的那一幀）。 */
  get engaged(): boolean {
    return this.pressed || this.prevPressed;
  }

  /**
   * 產生這一幀的 HandFrame。offX / offY 是鏡頭視窗左上角在視窗中的座標
   * （main.ts 的 viewLeft / viewTop），用來把 clientX/Y 換成 canvas CSS px。
   * 每幀只呼叫一次，內部會推進邊緣偵測的狀態。
   */
  read(offX: number, offY: number): HandFrame {
    const justPinched = this.pressed && !this.prevPressed;
    const justReleased = !this.pressed && this.prevPressed;
    this.prevPressed = this.pressed;

    return {
      present: true,
      landmarks: [],
      normalized: [],
      pinching: this.pressed,
      justPinched,
      justReleased,
      pinchPoint: { x: this.client.x - offX, y: this.client.y - offY },
      pinchDistance: this.pressed ? 0 : 1,
      handedness: '',
    };
  }
}
