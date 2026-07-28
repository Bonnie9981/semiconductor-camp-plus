/**
 * waferBreak.js
 * ------------------------------------------------------------
 * 這不是最終的關卡邏輯，而是一份「範例關卡」，示範新關卡要怎麼
 * 掛進整個架構——請把這個檔案當作寫其他關卡（clean / litho / etch ...）
 * 時的樣板來複製,而不是要保留的正式內容。
 *
 * 示範重點：
 *   1. 用 LevelManager.register(id, {...}) 註冊
 *   2. mount() 時用 ctx.gripper 註冊一個可 attach 的物件（晶圓）
 *   3. 監聽 'object:placed' 事件判斷玩家把晶圓放到哪裡
 *   4. 呼叫 ctx.completeLevel(payload) 過關，或 ctx.failLevel(reason) 失敗
 *      → 失敗示範了需求 6 的「失敗畫面」是怎麼被觸發的
 *   5. unmount() 時清乾淨（移除監聽、移除 attachable），
 *      避免切換關卡後殘留物件或事件監聽
 *
 * 實際的「晶圓會不會裂開」判斷邏輯（例如施力大小、切割速度等）
 * 完全沒有實作，只用一個示範用的按鈕模擬「切割結果」，
 * 這部分你會自行依真正的機構/辨識邏輯取代。
 */
(function (global) {
  'use strict';

  const LEVEL_ID = 'dicing';
  let cleanup = [];

  global.LevelManager.register(LEVEL_ID, {
    code: 'DICE',
    label: 'Wafer Dicing',
    instructions:
      '完成微影與蝕刻後，晶圓需要被切割成獨立的晶粒。' +
      '把晶圓從料架拿起（捏合靠近後放開手即可 attach），放到桌面上的切割檯，' +
      '切割成功即完成本站；若切割失敗，晶圓會破損並進入失敗畫面。',

    mount(container, ctx) {
      const { gripper, eventBus } = ctx;

      gripper.registerAttachable('wafer-dice', {
        label: 'Wafer',
        icon: '💿',
        homeX: 120, homeY: 140,
      });

      // 範例判定：只要玩家把晶圓放到桌面區，就視為「已進入切割檯」。
      // 這裡故意用一個簡單按鈕讓你現在就能測試 complete / fail 兩條路徑，
      // 之後你可以把這個按鈕換成真正的「切割動作辨識」。
      const demoPanel = document.createElement('div');
      demoPanel.style.cssText =
        'position:absolute;right:16px;top:16px;display:flex;flex-direction:column;gap:8px;';
      demoPanel.innerHTML = `
        <button class="win-btn" id="dice-success-demo">（示範）切割成功</button>
        <button class="win-btn" id="dice-fail-demo">（示範）切割失敗</button>
      `;
      container.appendChild(demoPanel);

      const onPlaced = ({ id, tableX, tableY }) => {
        if (id !== 'wafer-dice') return;
        console.info('[waferBreak] wafer placed on table at', tableX, tableY);
        // TODO: 依實際切割檯座標範圍判斯是否放對位置
      };
      eventBus.on('object:placed', onPlaced);

      const successBtn = demoPanel.querySelector('#dice-success-demo');
      const failBtn = demoPanel.querySelector('#dice-fail-demo');
      const onSuccess = () => ctx.completeLevel({ diced: true });
      const onFail = () => ctx.failLevel('切割力道過大，晶圓破裂。');
      successBtn.addEventListener('click', onSuccess);
      failBtn.addEventListener('click', onFail);

      cleanup = [
        () => eventBus.off('object:placed', onPlaced),
        () => gripper.unregisterAttachable('wafer-dice'),
        () => demoPanel.remove(),
      ];
    },

    unmount(container, ctx) {
      cleanup.forEach((fn) => fn());
      cleanup = [];
    },
  });
})(window);
