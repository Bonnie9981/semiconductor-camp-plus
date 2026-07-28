/**
 * core/gameState.js
 * ------------------------------------------------------------
 * 單一事實來源（single source of truth）。
 * 負責：
 *   1. 關卡順序與每一關的狀態（locked / active / done）
 *   2. 需求 4「製程不能跳步驟」的強制規則
 *   3. 保存跨關卡需要共用的資料（例如第一關手繪的 pattern，
 *      要留到結局畫面做 3D / PNG 匯出）
 *
 * 這個檔案完全不碰 DOM、不畫任何東西，只管狀態，
 * 所有畫面更新都由 app.js 監聽 EventBus 的 'state:changed' 事件後重繪。
 */
(function (global) {
  'use strict';

  const STATUS = Object.freeze({
    LOCKED: 'locked',
    ACTIVE: 'active',
    DONE: 'done',
  });

  function createGameState() {
    let order = [];              // string[] — 關卡 id 依序排列
    let statuses = [];           // STATUS[] — 對應 order 的狀態
    let progress = [];           // number[] — 對應 order 的 0~100 進度（可選使用）
    let currentIndex = 0;        // 目前選取（顯示）中的關卡 index
    let highestUnlocked = 0;     // 目前允許前進到的最遠 index（核心防跳關變數）

    let sharedData = {
      pattern: null,       // { dataURL, isNegative } — 第一關手繪結果
      resistPolarity: 'positive', // 'positive' | 'negative' — 玩家選擇的光阻極性
    };

    let failed = false;
    let failReason = null;

    function notify() {
      global.EventBus.emit('state:changed', getSnapshot());
    }

    function getSnapshot() {
      return {
        order: [...order],
        statuses: [...statuses],
        progress: [...progress],
        currentIndex,
        highestUnlocked,
        isComplete: statuses.length > 0 && statuses.every((s) => s === STATUS.DONE),
        failed,
        failReason,
      };
    }

    return {
      STATUS,

      /** 由 app.js 在啟動時呼叫一次，帶入依序排好的關卡 id 陣列 */
      init(levelIds) {
        order = [...levelIds];
        statuses = order.map((_, i) => (i === 0 ? STATUS.ACTIVE : STATUS.LOCKED));
        progress = order.map(() => 0);
        currentIndex = 0;
        highestUnlocked = 0;
        failed = false;
        failReason = null;
        sharedData = { pattern: null, resistPolarity: 'positive' };
        notify();
      },

      getSnapshot,

      getCurrentLevelId() { return order[currentIndex]; },

      /** 需求 4 的關鍵防呆：只有「目前 active 的關卡」或「已完成的關卡」可以被選取，
       *  無法選取尚未解鎖（locked）的關卡，也就無法跳過任何一步。 */
      canSelect(index) {
        return index >= 0 && index <= highestUnlocked;
      },

      selectLevel(index) {
        if (!this.canSelect(index)) return false;
        currentIndex = index;
        notify();
        return true;
      },

      setProgress(index, pct) {
        if (index < 0 || index >= progress.length) return;
        progress[index] = Math.max(0, Math.min(100, pct));
        notify();
      },

      /** 關卡模組呼叫此方法宣告「這一關完成了」，才會解鎖下一關。
       *  這是唯一能推進 highestUnlocked 的入口，其餘 UI 一律唯讀。 */
      completeLevel(index, payload) {
        if (index !== currentIndex) {
          console.warn('[GameState] completeLevel index mismatch, ignored.');
          return;
        }
        statuses[index] = STATUS.DONE;
        progress[index] = 100;
        const next = index + 1;
        if (next < order.length) {
          highestUnlocked = Math.max(highestUnlocked, next);
          if (statuses[next] === STATUS.LOCKED) statuses[next] = STATUS.ACTIVE;
          currentIndex = next;
        }
        global.EventBus.emit('level:completed', { id: order[index], index, payload });
        notify();
        if (statuses.every((s) => s === STATUS.DONE)) {
          global.EventBus.emit('game:completed', { pattern: sharedData.pattern });
        }
      },

      /** 關卡模組宣告失敗（例如晶圓在 waferBreak 關卡中破裂）。
       *  失敗不會解鎖下一關；是否允許重試由該關卡模組自行呼叫 resetCurrentLevel()。 */
      failLevel(index, reason) {
        failed = true;
        failReason = reason || null;
        global.EventBus.emit('level:failed', { id: order[index], index, reason });
        global.EventBus.emit('game:failed', { reason });
        notify();
      },

      resetCurrentLevel() {
        progress[currentIndex] = 0;
        failed = false;
        failReason = null;
        notify();
      },

      setPattern(dataURL, isNegative) {
        sharedData.pattern = { dataURL, isNegative: !!isNegative };
        global.EventBus.emit('pattern:updated', sharedData.pattern);
      },
      getPattern() { return sharedData.pattern; },

      setResistPolarity(p) { sharedData.resistPolarity = p === 'negative' ? 'negative' : 'positive'; },
      getResistPolarity() { return sharedData.resistPolarity; },
    };
  }

  global.GameState = createGameState();
})(window);
