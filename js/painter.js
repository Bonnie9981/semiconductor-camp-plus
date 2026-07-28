/**
 * painter.js
 * ------------------------------------------------------------
 * 需求 6-1：第一關由玩家「用手」在鏡頭畫面上畫出一個 pattern。
 * 這個 pattern 之後會：
 *   - 存進 GameState（setPattern），讓結局畫面 / exportManager 使用
 *   - 依照玩家選擇的正/負光阻（resist polarity）決定最終刻在晶圓上的
 *     是「畫的線本身」還是「線以外的區域」（需求 6-0）
 *
 * 目前只做「畫圖」這個互動介面本身：
 *   - 用滑鼠（之後可換成 gripper/gesture 提供的手部座標）在
 *     #painter-canvas 上畫線
 *   - 提供 getPatternDataURL(invert) 取得 PNG dataURL
 *   - 不做任何「畫得像不像 / 這關怎麼算過關」的判斷，
 *     那屬於「litho-paint」關卡模組（在 app.js 中對應的關卡定義）的責任，
 *     它會呼叫 Painter.isEmpty() / getPatternDataURL() 後自行決定何時
 *     呼叫 ctx.completeLevel()。
 */
(function (global) {
  'use strict';

  function createPainter({ canvasEl }) {
    const ctx2d = canvasEl.getContext('2d');
    let drawing = false;
    let hasStroke = false;
    let strokeColor = '#00e0ff';
    let strokeWidth = 6;
    let enabled = false;

    function clear() {
      ctx2d.clearRect(0, 0, canvasEl.width, canvasEl.height);
      hasStroke = false;
    }

    function toCanvasCoords(clientX, clientY) {
      const rect = canvasEl.getBoundingClientRect();
      const scaleX = canvasEl.width / rect.width;
      const scaleY = canvasEl.height / rect.height;
      return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }

    function pointerDown(e) {
      if (!enabled) return;
      drawing = true;
      const p = toCanvasCoords(e.clientX, e.clientY);
      ctx2d.beginPath();
      ctx2d.moveTo(p.x, p.y);
    }
    function pointerMove(e) {
      if (!enabled || !drawing) return;
      const p = toCanvasCoords(e.clientX, e.clientY);
      ctx2d.lineTo(p.x, p.y);
      ctx2d.strokeStyle = strokeColor;
      ctx2d.lineWidth = strokeWidth;
      ctx2d.lineCap = 'round';
      ctx2d.lineJoin = 'round';
      ctx2d.stroke();
      hasStroke = true;
    }
    function pointerUp() {
      if (!drawing) return;
      drawing = false;
      if (hasStroke) global.EventBus.emit('painter:strokeend', {});
    }

    canvasEl.addEventListener('mousedown', pointerDown);
    canvasEl.addEventListener('mousemove', pointerMove);
    window.addEventListener('mouseup', pointerUp);

    return {
      /** 開放/關閉繪圖互動；只有在對應關卡 mount 時才會被開啟，
       *  離開該關卡（unmount）要記得呼叫 setEnabled(false)。 */
      setEnabled(v) {
        enabled = !!v;
        canvasEl.style.pointerEvents = enabled ? 'auto' : 'none';
      },

      clear,
      isEmpty() { return !hasStroke; },

      setStrokeStyle({ color, width }) {
        if (color) strokeColor = color;
        if (width) strokeWidth = width;
      },

      /** invert = true 時回傳負片（畫的線變透明、其餘變實心），
       *  對應需求 6-0「正片或負片，依照玩家所選擇的正/負光阻而定」，
       *  真正決定 invert 與否的邏輯在 exportManager.js 依 GameState 的
       *  resistPolarity 決定，這裡只單純負責影像處理。 */
      getPatternDataURL(invert = false) {
        if (!invert) return canvasEl.toDataURL('image/png');

        const off = document.createElement('canvas');
        off.width = canvasEl.width; off.height = canvasEl.height;
        const octx = off.getContext('2d');
        octx.fillStyle = '#ffffff';
        octx.fillRect(0, 0, off.width, off.height);
        octx.globalCompositeOperation = 'destination-out';
        octx.drawImage(canvasEl, 0, 0);
        return off.toDataURL('image/png');
      },

      destroy() {
        canvasEl.removeEventListener('mousedown', pointerDown);
        canvasEl.removeEventListener('mousemove', pointerMove);
        window.removeEventListener('mouseup', pointerUp);
      },
    };
  }

  global.createPainter = createPainter;
})(window);
