/**
 * exportManager.js
 * ------------------------------------------------------------
 * 需求 6：成功畫面的兩個下載按鈕背後的邏輯，全部集中在這裡，
 * 方便 screens.js 不用管檔案格式細節，只要呼叫：
 *
 *   ExportManager.downloadPatternPNG()
 *   ExportManager.downloadWaferOBJ()
 *
 * downloadPatternPNG()：完整實作。直接輸出 GameState 裡存的 pattern
 *   （已經依 resistPolarity 決定是正片或負片，見 getFinalPatternDataURL）。
 *
 * downloadWaferOBJ()：介面 + 可運作的「最小可行版本」佔位實作
 *   （目前只是把 pattern 當高度圖，擠出一片薄圓晶圓 + 中央凸起/凹陷的
 *   極簡近似），讓下載按鈕現在就能跑通、拿到一個合法的 .obj 檔，
 *   之後你可以把 buildPlaceholderWaferMesh() 整個換成正式的演算法
 *   （例如真正依 pattern 的每個像素做高度擠出、加上晶圓斜角、
 *   使用真正的正/負光阻蝕刻深度模型等），呼叫端完全不用改。
 */
(function (global) {
  'use strict';

  function triggerDownload(blobOrUrl, filename) {
    const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (typeof blobOrUrl !== 'string') URL.revokeObjectURL(url);
  }

  /** 依玩家選擇的光阻極性，決定最終要輸出的是正片還是負片（需求 6-0）。*/
  function getFinalPatternDataURL() {
    const pattern = global.GameState.getPattern();
    if (!pattern) return null;
    const polarity = global.GameState.getResistPolarity(); // 'positive' | 'negative'
    // pattern.dataURL 一律存「玩家實際畫出來的線」（正片、未反轉）。
    // 若光阻極性為 negative，最終刻在晶圓上的應是線以外的區域 → 用 painter 的 invert 版本。
    // 這裡假設 Painter 實例仍可取得；正式作法建議在 GameState.setPattern 時
    // 就把兩個版本都存起來，避免 export 階段還要依賴 Painter 是否還存在。
    return polarity === 'negative' && pattern.negativeDataURL
      ? pattern.negativeDataURL
      : pattern.dataURL;
  }

  const ExportManager = {
    downloadPatternPNG(filename = 'wafer-pattern.png') {
      const dataURL = getFinalPatternDataURL();
      if (!dataURL) {
        console.warn('[exportManager] no pattern available to export.');
        return false;
      }
      triggerDownload(dataURL, filename);
      return true;
    },

    /** TODO（佔位實作）：把 pattern 轉成真正貼合製程意義的 3D 模型。
     *  目前版本：讀取 pattern 的像素亮度當作高度，
     *  用非常粗略的方式在一個圓形晶圓網格上做高度位移，
     *  輸出成標準 Wavefront .obj 文字格式（純文字、無外部相依）。
     *  之後可以整個替換這個函式內部實作，介面（downloadWaferOBJ）不變。 */
    async downloadWaferOBJ(filename = 'wafer-model.obj') {
      const dataURL = getFinalPatternDataURL();
      if (!dataURL) {
        console.warn('[exportManager] no pattern available to export.');
        return false;
      }
      const objText = await buildPlaceholderWaferMesh(dataURL);
      triggerDownload(new Blob([objText], { type: 'text/plain' }), filename);
      return true;
    },
  };

  async function loadImage(dataURL) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataURL;
    });
  }

  /** 佔位用的極簡網格產生器：GRID x GRID 的高度圖 → OBJ 頂點/面。
   *  刻意保持簡單、可讀，方便之後整段替換成正式的製程幾何模型。 */
  async function buildPlaceholderWaferMesh(patternDataURL) {
    const GRID = 48;
    const RADIUS = 1;
    const HEIGHT_SCALE = 0.06;

    const img = await loadImage(patternDataURL);
    const off = document.createElement('canvas');
    off.width = GRID; off.height = GRID;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0, GRID, GRID);
    const pixels = octx.getImageData(0, 0, GRID, GRID).data;

    const heightAt = (x, y) => {
      const i = (y * GRID + x) * 4;
      const brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / (3 * 255);
      return brightness * HEIGHT_SCALE;
    };

    const lines = ['# Placeholder wafer mesh — replace buildPlaceholderWaferMesh() with a real process model', 'o Wafer'];
    const verts = [];
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const u = gx / (GRID - 1), v = gy / (GRID - 1);
        const x = (u * 2 - 1) * RADIUS;
        const z = (v * 2 - 1) * RADIUS;
        const inDisc = (x * x + z * z) <= RADIUS * RADIUS;
        const y = inDisc ? heightAt(gx, gy) : 0;
        verts.push([x, y, z]);
      }
    }
    verts.forEach(([x, y, z]) => lines.push(`v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`));

    const idx = (gx, gy) => gy * GRID + gx + 1; // OBJ index base 1
    for (let gy = 0; gy < GRID - 1; gy++) {
      for (let gx = 0; gx < GRID - 1; gx++) {
        const a = idx(gx, gy), b = idx(gx + 1, gy), c = idx(gx + 1, gy + 1), d = idx(gx, gy + 1);
        lines.push(`f ${a} ${b} ${c}`, `f ${a} ${c} ${d}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  global.ExportManager = ExportManager;
})(window);
