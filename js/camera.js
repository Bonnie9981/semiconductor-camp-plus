/**
 * camera.js
 * ------------------------------------------------------------
 * 職責範圍（依需求 1，故意忽略所有「影像辨識」邏輯）：
 *   - 開啟攝影機（getUserMedia），把畫面畫到 <canvas id="camera-canvas">
 *   - 定義並計算「桌面區」（TABLE_ZONE_RATIO，畫面下 1/4），
 *     提供座標矩形給 gripper.js 判斷物件是否被放到桌上
 *   - 提供一個「手部座標」的統一介面 getHandPosition()，
 *     目前用滑鼠座標當作 fallback 實作；
 *     之後 gesture.js 做好真的手勢辨識後，只要呼叫
 *     Camera.setHandProvider(fn) 換掉座標來源，
 *     其餘所有模組（gripper / painter / UI）完全不用改。
 *
 * 不包含：任何手勢判斷、任何機器學習模型、任何「這是不是在捏合」的邏輯
 * —— 那些全部屬於 gesture.js 之後要做的事。
 */
(function (global) {
  'use strict';

  const TABLE_ZONE_RATIO = 0.25; // 必須與 css/layout.css 的 #table-zone-overlay { height: 25% } 一致

  function createCamera({ videoEl, canvasEl }) {
    const ctx = canvasEl.getContext('2d');
    let handProvider = null;     // 由 gesture.js 注入的 () => {x,y,pinching} | null
    let mouseState = { x: canvasEl.width / 2, y: canvasEl.height * 0.5, pinching: false };
    let rafId = null;
    let cameraReady = false;

    function toCanvasCoords(clientX, clientY) {
      const rect = canvasEl.getBoundingClientRect();
      const scaleX = canvasEl.width / rect.width;
      const scaleY = canvasEl.height / rect.height;
      return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }

    // --- 滑鼠 fallback（沒有 gesture provider、或攝影機/模型不可用時使用） ---
    canvasEl.addEventListener('mousemove', (e) => {
      const p = toCanvasCoords(e.clientX, e.clientY);
      mouseState.x = p.x; mouseState.y = p.y;
      if (!handProvider) global.EventBus.emit('hand:move', { x: p.x, y: p.y, source: 'mouse' });
    });
    canvasEl.addEventListener('mousedown', (e) => {
      mouseState.pinching = true;
      if (!handProvider) global.EventBus.emit('hand:pinchstart', { x: mouseState.x, y: mouseState.y });
    });
    window.addEventListener('mouseup', () => {
      if (!mouseState.pinching) return;
      mouseState.pinching = false;
      if (!handProvider) global.EventBus.emit('hand:pinchend', { x: mouseState.x, y: mouseState.y });
    });

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        videoEl.srcObject = stream;
        await videoEl.play();
        cameraReady = true;
        setStatus('TRACKING: MOUSE FALLBACK (no gesture model loaded)');
      } catch (err) {
        cameraReady = false;
        setStatus('NO CAMERA ACCESS — MOUSE FALLBACK ACTIVE');
        console.warn('[camera.js] getUserMedia failed, falling back to a static backdrop:', err);
      }
      loop();
    }

    function setStatus(text) {
      const el = document.getElementById('status-line');
      if (el) el.textContent = text;
    }

    function loop() {
      rafId = requestAnimationFrame(loop);
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      if (cameraReady && videoEl.readyState >= 2) {
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
      } else {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
      }
      // 桌面區的畫面提示交由 CSS 疊層 (#table-zone-overlay) 處理，
      // 這裡不重複畫，避免 canvas 內容和 DOM 疊層邏輯打架。

      if (handProvider) {
        const p = handProvider();
        if (p) global.EventBus.emit('hand:move', { x: p.x, y: p.y, source: 'gesture' });
      }
    }

    function stop() {
      if (rafId) cancelAnimationFrame(rafId);
      const stream = videoEl.srcObject;
      if (stream) stream.getTracks().forEach((t) => t.stop());
    }

    return {
      TABLE_ZONE_RATIO,
      start,
      stop,

      /** gesture.js 完成後用這個換掉手部座標來源；傳 null 恢復滑鼠 fallback。 */
      setHandProvider(fn) { handProvider = fn; },

      /** 目前的手部座標（canvas 座標系），給 gripper.js / painter.js 用。 */
      getHandPosition() {
        if (handProvider) return handProvider();
        return { x: mouseState.x, y: mouseState.y, pinching: mouseState.pinching };
      },

      /** 桌面矩形（canvas 座標系），gripper.js 用來判斷「有沒有放到桌上」。 */
      getTableZoneRect() {
        const h = canvasEl.height * TABLE_ZONE_RATIO;
        return { x: 0, y: canvasEl.height - h, width: canvasEl.width, height: h };
      },

      getCanvasSize() { return { width: canvasEl.width, height: canvasEl.height }; },
      isPointInTableZone(x, y) {
        const r = this.getTableZoneRect();
        return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
      },
    };
  }

  global.createCamera = createCamera; // app.js 會呼叫這個 factory 並存成 global.Camera
})(window);
