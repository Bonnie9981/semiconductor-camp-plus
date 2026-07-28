/**
 * buttons.js
 * ------------------------------------------------------------
 * 把樣本檔案中「每個按鈕都手刻一長串 inline style」的作法，
 * 換成幾個可重複使用的 DOM 產生函式，套用 css/theme.css 裡的
 * class（.win-btn / .station-btn / .station-led ...）。
 *
 * 這裡不含任何遊戲邏輯，只負責「畫出來」，onClick 一律由呼叫端
 * （app.js）傳入 callback。
 */
(function (global) {
  'use strict';

  const UI = {
    /** 建立一個一般用途的 Win98 風格按鈕 */
    createButton({ label, onClick, disabled = false, className = '' }) {
      const btn = document.createElement('button');
      btn.className = `win-btn ${className}`.trim();
      btn.textContent = label;
      btn.disabled = disabled;
      if (onClick) btn.addEventListener('click', onClick);
      return btn;
    },

    /** 建立左側製程流程單一站點列（LED + 代碼 + 名稱 + 進度）*/
    createStationRow({ code, label, status, progressPct, locked, onSelect }) {
      const row = document.createElement('button');
      row.className = 'station-btn';
      row.dataset.locked = String(!!locked);
      row.disabled = !!locked;
      if (onSelect) row.addEventListener('click', onSelect);

      const led = document.createElement('span');
      led.className = 'station-led';
      led.classList.toggle('is-active', status === 'active');
      led.style.background =
        status === 'done' ? 'var(--c-led-done)' :
        status === 'active' ? 'var(--c-led-active)' :
        'var(--c-led-idle)';

      const codeEl = document.createElement('span');
      codeEl.className = 'station-code';
      codeEl.textContent = code;

      const nameEl = document.createElement('span');
      nameEl.className = 'station-name';
      nameEl.textContent = label;

      const progEl = document.createElement('span');
      progEl.className = 'station-progress';
      progEl.textContent = status === 'done' ? 'DONE' : (status === 'active' ? `${Math.round(progressPct)}%` : '');

      row.append(led, codeEl, nameEl, progEl);
      return row;
    },

    /** 更新既有進度條 DOM（fill + label）*/
    updateProgressBar(fillEl, labelEl, pct) {
      const clamped = Math.max(0, Math.min(100, Math.round(pct)));
      fillEl.style.width = `${clamped}%`;
      labelEl.textContent = `${clamped}%`;
    },
  };

  global.UI = UI;
})(window);
