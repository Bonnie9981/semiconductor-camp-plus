/**
 * core/levelManager.js
 * ------------------------------------------------------------
 * 這是「加入新關卡」時唯一需要用到的 API。
 * 每個關卡模組（例如 waferBreak.js）在自己的檔案裡呼叫一次：
 *
 *   LevelManager.register('dicing', {
 *     code: 'DICE',
 *     label: 'Wafer Dicing',
 *     instructions: '...給玩家看的說明文字...',
 *     mount(container, ctx) {
 *       // container: 一個已經清空、可以放這一關 UI 的 DOM 節點
 *       //            （目前掛載在 #camera-frame 內，未來若某關需要
 *       //            額外的畫面元素，就在這裡動態建立、append 進 container）
 *       // ctx: {
 *       //   eventBus, gameState, gripper, camera, painter,
 *       //   completeLevel(payload),   // 呼叫這個代表本關過關
 *       //   failLevel(reason),        // 呼叫這個代表本關失敗
 *       // }
 *     },
 *     unmount(container, ctx) {
 *       // 離開這一關時的清理（移除事件監聽、停止動畫等）
 *     },
 *   });
 *
 * 然後在 app.js 的 LEVEL_ORDER 陣列裡加入這個 id 即可，
 * 不需要改動 index.html、gameState.js 或其他任何關卡的程式碼。
 */
(function (global) {
  'use strict';

  function createLevelManager() {
    const registry = new Map(); // id -> definition
    let activeId = null;
    let activeContainer = null;
    let sharedCtx = null; // 由 app.js 在 setSharedContext() 注入一次

    return {
      /** 註冊一個關卡定義。id 必須唯一。 */
      register(id, definition) {
        if (registry.has(id)) {
          console.warn(`[LevelManager] level "${id}" already registered — overwriting.`);
        }
        registry.set(id, { id, ...definition });
      },

      has(id) { return registry.has(id); },
      get(id) { return registry.get(id); },
      list() { return [...registry.values()]; },

      /** app.js 呼叫一次，注入所有關卡共用的服務（eventBus、gameState、gripper...） */
      setSharedContext(ctx) { sharedCtx = ctx; },

      /** 切換目前顯示的關卡：卸載舊的、掛載新的。
       *  container 由 app.js 提供（目前是 #camera-frame 底下的一個掛載點）。 */
      mountLevel(id, container) {
        const def = registry.get(id);
        if (!def) {
          console.error(`[LevelManager] unknown level id "${id}"`);
          return;
        }
        this.unmountCurrent();

        const index = def.__index ?? 0;
        const ctx = {
          ...sharedCtx,
          completeLevel: (payload) => global.GameState.completeLevel(index, payload),
          failLevel: (reason) => global.GameState.failLevel(index, reason),
        };

        activeId = id;
        activeContainer = container;
        try {
          def.mount(container, ctx);
        } catch (err) {
          console.error(`[LevelManager] mount() failed for level "${id}":`, err);
        }
      },

      unmountCurrent() {
        if (!activeId) return;
        const def = registry.get(activeId);
        try {
          def?.unmount?.(activeContainer, sharedCtx);
        } catch (err) {
          console.error(`[LevelManager] unmount() failed for level "${activeId}":`, err);
        }
        activeId = null;
        activeContainer = null;
      },

      getActiveId() { return activeId; },
    };
  }

  global.LevelManager = createLevelManager();
})(window);
