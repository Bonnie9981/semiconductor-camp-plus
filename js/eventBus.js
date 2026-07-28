/**
 * core/eventBus.js
 * ------------------------------------------------------------
 * 極簡的全域事件匯流排。所有跨模組溝通都應該透過這裡，
 * 而不是模組互相 import/呼叫對方的方法 —— 這是讓
 * gesture.js / camera.js / gripper.js / painter.js / 各關卡模組
 * 可以獨立開發、獨立替換的關鍵：
 *
 *   例：camera.js 目前用滑鼠模擬手部座標，之後換成真的手勢辨識，
 *   只要 gesture.js 改成 emit 一樣的事件名稱（'hand:move' 等），
 *   其他模組完全不用改一行。
 *
 * 使用方式：
 *   EventBus.on('object:placed', (payload) => {...});
 *   EventBus.emit('object:placed', { id, x, y });
 *   EventBus.off('object:placed', handler);
 *
 * 事件命名慣例（後續模組請延續）：
 *   'hand:move'        { x, y, source: 'mouse'|'gesture' }
 *   'hand:pinchstart'   { x, y }
 *   'hand:pinchend'     { x, y }
 *   'object:attached'   { id }
 *   'object:placed'     { id, tableX, tableY }
 *   'pattern:updated'   { dataURL, isNegative }
 *   'level:completed'   { id, payload }
 *   'level:failed'      { id, reason }
 *   'game:completed'    {}
 *   'game:failed'       { reason }
 */
(function (global) {
  'use strict';

  function createEventBus() {
    const listeners = new Map(); // eventName -> Set<fn>

    return {
      on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
        return () => this.off(event, fn); // 回傳 unsubscribe function 方便使用
      },
      off(event, fn) {
        listeners.get(event)?.delete(fn);
      },
      emit(event, payload) {
        listeners.get(event)?.forEach((fn) => {
          try { fn(payload); }
          catch (err) { console.error(`[EventBus] listener for "${event}" threw:`, err); }
        });
      },
      clear(event) {
        if (event) listeners.delete(event);
        else listeners.clear();
      },
    };
  }

  global.EventBus = createEventBus();
})(window);
