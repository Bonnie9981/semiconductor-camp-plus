/**
 * gesture.js
 * ------------------------------------------------------------
 * ⚠️ 刻意留白（依需求 1：目前階段忽略所有影像辨識邏輯）。
 *
 * 這裡只定義「手勢辨識模組未來要符合的介面形狀」，
 * 讓 camera.js / gripper.js 現在就能對著這個介面寫程式，
 * 之後你自己實作真正的辨識邏輯（例如 MediaPipe Hands）時，
 * 不需要改動任何其他檔案，只要把 TODO 的部分換成真正的模型推論，
 * 並在 init 完成後呼叫：
 *
 *   Camera.setHandProvider(() => GestureEngine.getHandPosition());
 *
 * getHandPosition() 回傳格式必須是：
 *   { x: number, y: number, pinching: boolean } | null
 *   （x, y 為 camera-canvas 的座標系；null 代表目前沒有偵測到手）
 *
 * 另外可視需要 emit 額外語意事件，例如：
 *   EventBus.emit('gesture:rotate',  { deltaAngle })
 *   EventBus.emit('gesture:tap',     {})
 *   EventBus.emit('gesture:hold',    { ms })
 * 各關卡模組再依自己的規則去監聽、判斷過關條件。
 */
(function (global) {
  'use strict';

  const GestureEngine = {
    ready: false,

    /** TODO: 載入手勢辨識模型（例如 MediaPipe Hands / TensorFlow.js）。
     *  現在故意不做任何事，維持 ready = false，
     *  讓 camera.js 停留在滑鼠 fallback 模式。 */
    async init(videoEl) {
      console.info('[gesture.js] stub only — no recognition model loaded yet.');
      this.ready = false;
    },

    /** TODO: 回傳目前偵測到的手部座標與是否正在捏合（pinch）。 */
    getHandPosition() {
      return null;
    },

    /** TODO: 依難度設定（easy/normal/hard）調整偵測靈敏度等參數。 */
    setDifficulty(level) {
      // no-op for now
    },
  };

  global.GestureEngine = GestureEngine;
})(window);
