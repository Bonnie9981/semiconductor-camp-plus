/**
 * screens.js
 * ------------------------------------------------------------
 * 需求 6：遊戲結束時的成功 / 失敗畫面。
 * 這個模組只負責「顯示什麼」，不負責判斷「什麼時候算成功/失敗」
 * —— 那由 GameState 透過 EventBus 的 'game:completed' / 'game:failed'
 * 事件通知過來，app.js 監聽後呼叫 Screens.showSuccess() / showFailure()。
 *
 * 成功畫面提供兩個下載按鈕，分別呼叫 ExportManager 對應的方法：
 *   - Download PNG Image  → ExportManager.downloadPatternPNG()
 *   - Download 3D Object   → ExportManager.downloadWaferOBJ()
 */
(function (global) {
  'use strict';

  function createScreens({ rootEl }) {
    function clear() {
      rootEl.innerHTML = '';
      rootEl.classList.add('hidden');
      rootEl.className = 'end-screen hidden';
    }

    function showSuccess() {
      rootEl.className = 'end-screen success';
      rootEl.innerHTML = `
        <h1>🎉 恭喜！晶圓製程全部完成</h1>
        <p>你已成功完成所有製程站點，晶圓已依照你設計的光罩圖案完成製作。
           可以下載你的成果：一張刻有你手繪圖案的 3D 晶圓模型，以及該圖案的 PNG 圖檔。</p>
        <div class="end-screen-actions">
          <button class="win-btn" id="btn-download-png">⬇ Download PNG Image</button>
          <button class="win-btn" id="btn-download-obj">⬇ Download 3D Object (.obj)</button>
          <button class="win-btn" id="btn-play-again">Play Again</button>
        </div>
      `;
      rootEl.querySelector('#btn-download-png').addEventListener('click', () => {
        global.ExportManager.downloadPatternPNG();
      });
      rootEl.querySelector('#btn-download-obj').addEventListener('click', () => {
        global.ExportManager.downloadWaferOBJ();
      });
      rootEl.querySelector('#btn-play-again').addEventListener('click', () => {
        global.EventBus.emit('game:restartRequested');
      });
    }

    function showFailure(reason) {
      rootEl.className = 'end-screen failure';
      rootEl.innerHTML = `
        <h1>⚠ 製程失敗</h1>
        <p>${reason ? escapeHtml(reason) : '晶圓在製程中損毀，未能完成生產。'}</p>
        <div class="end-screen-actions">
          <button class="win-btn" id="btn-retry">Retry This Wafer</button>
        </div>
      `;
      rootEl.querySelector('#btn-retry').addEventListener('click', () => {
        global.EventBus.emit('game:retryRequested');
      });
    }

    function escapeHtml(s) {
      const div = document.createElement('div');
      div.textContent = s;
      return div.innerHTML;
    }

    return { showSuccess, showFailure, clear };
  }

  global.createScreens = createScreens;
})(window);
