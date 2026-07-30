/**
 * Exporter —— 結算畫面的檔案輸出
 * ---------------------------------------------------------------------------
 *  1. PNG：把晶圓合成圖直接存檔。
 *  2. STL：把 2D Pattern 當成高度圖（heightfield）擠出成圓形晶圓 3D 模型。
 *
 * STL 演算法（極座標高度場擠出）
 * ---------------------------------------------------------------------------
 * 網格建在**極座標**上：半徑方向切 NR 環、圓周方向切 NS 段，
 * 每個頂點依所在位置取樣 Pattern 的 alpha 決定高度：
 *
 *      h(vertex) = base                （沒畫到）
 *                = base + pattern      （有畫到）
 *
 * 輸出三組面：
 *   - 頂面：中心三角扇 + 各環之間的四邊形（在 z = h，相鄰面共用頂點）
 *   - 底面：同樣拓樸、反向繞序（在 z = 0）
 *   - 外緣：最外環的一圈側牆，把頂面與底面接起來
 *
 * 為什麼用極座標而不是 X/Y 方格？
 *   方格版本要在「相鄰格高度不同」處補垂直牆，一旦兩個對角格同高、另外兩個對角格
 *   不同高，四道牆會共用同一條垂直邊 → 該邊被 4 個三角形使用，模型就不是 2-manifold
 *   （實測 resolution=120 會產生 488 條這種壞邊，某些切片軟體會判定為破面）。
 *   極座標版本所有面都共用頂點、完全沒有內部垂直牆，邊界又剛好是一圈封閉的圓，
 *   因此**在任何解析度下都保證封閉且 2-manifold**，順帶還得到真正的圓形晶圓邊緣。
 *
 * 代價：圖案邊緣會變成一格寬的斜坡而非垂直峭壁。這正是「簡易擠出」的預期外觀，
 * 調高 resolution 就會越來越接近垂直。
 */

export interface STLOptions {
  /** 網格解析度：環數 = resolution / 2，圓周段數 = resolution × 2。越高越細緻、檔案越大。 */
  resolution?: number;
  /** 晶圓半徑（mm）。預設 100 = 200mm 晶圓。 */
  waferRadiusMm?: number;
  /** 晶圓基材厚度（mm）。 */
  baseThicknessMm?: number;
  /** 圖案凸起高度（mm）。 */
  patternHeightMm?: number;
  /** alpha 大於此值視為「有畫到」。 */
  alphaThreshold?: number;
  /**
   * 反轉圖案高度。
   *   false（正光阻）—— 光阻留在畫到的地方 → 那些地方被保護 → **圖案凸起**
   *   true （負光阻）—— 光阻留在沒畫到的地方 → 畫到的地方被蝕掉 → **圖案凹陷**
   */
  invert?: boolean;
  /** Pattern 取樣解析度（與網格密度無關，只影響圖案邊緣的精細度）。 */
  sampleSize?: number;
}

const STL_DEFAULTS: Required<STLOptions> = {
  resolution: 160,
  waferRadiusMm: 100,
  baseThicknessMm: 1.5,
  patternHeightMm: 1.2,
  alphaThreshold: 24,
  invert: false,
  sampleSize: 512,
};

export class Exporter {
  /** 下載 canvas 內容為 PNG。 */
  static downloadPNG(canvas: HTMLCanvasElement, filename = 'wafer-pattern.png'): void {
    canvas.toBlob((blob) => {
      if (!blob) return;
      Exporter.saveBlob(blob, filename);
    }, 'image/png');
  }

  /** 由 Pattern 圖層產生 STL 並下載。 */
  static downloadSTL(
    pattern: HTMLCanvasElement,
    filename = 'wafer-pattern.stl',
    options: STLOptions = {},
  ): void {
    const blob = Exporter.buildSTL(pattern, options);
    Exporter.saveBlob(blob, filename);
  }

  /** 產生 binary STL 的 Blob（想接 three.js 預覽時可以直接拿這個 Blob）。 */
  static buildSTL(pattern: HTMLCanvasElement, options: STLOptions = {}): Blob {
    const opt = { ...STL_DEFAULTS, ...options };
    const resolution = Math.max(16, Math.floor(opt.resolution));
    const rings = Math.max(8, Math.round(resolution / 2)); // 半徑方向環數
    const sectors = Math.max(24, Math.round(resolution * 2)); // 圓周方向段數
    const R = opt.waferRadiusMm;

    // ── 1. 取樣 Pattern（取樣解析度與網格密度脫鉤，邊緣才不會鋸齒） ──
    const size = opt.sampleSize;
    const sample = document.createElement('canvas');
    sample.width = size;
    sample.height = size;
    const sctx = sample.getContext('2d');
    if (!sctx) throw new Error('Exporter: 無法建立取樣用的 2D context');
    sctx.drawImage(pattern, 0, 0, size, size);
    const alpha = sctx.getImageData(0, 0, size, size).data;

    /** 由世界座標 (mm) 取得該點的高度。 */
    const heightAt = (x: number, y: number): number => {
      // 世界 y 軸向上、影像 y 軸向下，所以要翻轉
      const u = (x + R) / (2 * R);
      const v = (R - y) / (2 * R);
      const i = clampInt(Math.floor(u * size), 0, size - 1);
      const j = clampInt(Math.floor(v * size), 0, size - 1);
      const painted = alpha[(j * size + i) * 4 + 3] > opt.alphaThreshold;
      const raised = opt.invert ? !painted : painted;
      return opt.baseThicknessMm + (raised ? opt.patternHeightMm : 0);
    };

    // ── 2. 建立極座標頂點：中心 1 點 + rings × sectors 點 ──
    // ring k（1..rings）的半徑 = R * k / rings；ring 0 就是中心點。
    const vx = new Float64Array(rings * sectors);
    const vy = new Float64Array(rings * sectors);
    const vz = new Float64Array(rings * sectors);
    const idx = (k: number, s: number): number => (k - 1) * sectors + (s % sectors);

    for (let k = 1; k <= rings; k++) {
      const r = (R * k) / rings;
      for (let s = 0; s < sectors; s++) {
        const theta = (Math.PI * 2 * s) / sectors;
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);
        const p = idx(k, s);
        vx[p] = x;
        vy[p] = y;
        vz[p] = heightAt(x, y);
      }
    }
    const centerZ = heightAt(0, 0);

    // ── 3. 產生三角形（每 9 個數字一個三角形） ──
    const tris: number[] = [];
    const push = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
    ): void => {
      tris.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    };

    for (let s = 0; s < sectors; s++) {
      const a = idx(1, s);
      const b = idx(1, s + 1);
      // 中心三角扇：頂面（+Z，逆時針）與底面（-Z，反向）
      push(0, 0, centerZ, vx[a], vy[a], vz[a], vx[b], vy[b], vz[b]);
      push(0, 0, 0, vx[b], vy[b], 0, vx[a], vy[a], 0);
    }

    for (let k = 2; k <= rings; k++) {
      for (let s = 0; s < sectors; s++) {
        const i0 = idx(k - 1, s);
        const i1 = idx(k - 1, s + 1);
        const o0 = idx(k, s);
        const o1 = idx(k, s + 1);

        // 頂面四邊形（法線 +Z）
        push(vx[i0], vy[i0], vz[i0], vx[o0], vy[o0], vz[o0], vx[o1], vy[o1], vz[o1]);
        push(vx[i0], vy[i0], vz[i0], vx[o1], vy[o1], vz[o1], vx[i1], vy[i1], vz[i1]);

        // 底面四邊形（法線 -Z，繞序相反）
        push(vx[i0], vy[i0], 0, vx[o1], vy[o1], 0, vx[o0], vy[o0], 0);
        push(vx[i0], vy[i0], 0, vx[i1], vy[i1], 0, vx[o1], vy[o1], 0);
      }
    }

    /*
      外緣一圈側牆，把頂面與底面封起來。

      繞序必須讓法線朝**外**（+r̂）。之前寫成 (a@0, a@z, b@z)，
      叉積算出來是 ẑ × θ̂ = −r̂ —— 整圈側牆的法線朝內，與頂／底面方向相反。
      網格雖然仍然封閉（每條邊都用兩次），但定向不一致，
      散度定理算出來的帶號體積會是負的，切片軟體因此不把它當成實心體。
      改成 (a@0, b@0, b@z) 之後 θ̂ × ẑ = +r̂，方向就對了。
    */
    for (let s = 0; s < sectors; s++) {
      const a = idx(rings, s);
      const b = idx(rings, s + 1);
      push(vx[a], vy[a], 0, vx[b], vy[b], 0, vx[b], vy[b], vz[b]);
      push(vx[a], vy[a], 0, vx[b], vy[b], vz[b], vx[a], vy[a], vz[a]);
    }

    return Exporter.encodeBinarySTL(tris);
  }

  /** 把三角形陣列（每 9 個數字一面）編成 binary STL。 */
  private static encodeBinarySTL(tris: number[]): Blob {
    const count = tris.length / 9;
    const buffer = new ArrayBuffer(84 + count * 50);
    const view = new DataView(buffer);

    const header = 'semiconductor process simulator - wafer (polar heightfield)';
    for (let i = 0; i < Math.min(header.length, 79); i++) {
      view.setUint8(i, header.charCodeAt(i));
    }
    view.setUint32(80, count, true);

    let offset = 84;
    for (let t = 0; t < count; t++) {
      const o = t * 9;
      const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
      const bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5];
      const cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];

      // 法線 = (B-A) × (C-A)，正規化
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      view.setFloat32(offset, nx, true);
      view.setFloat32(offset + 4, ny, true);
      view.setFloat32(offset + 8, nz, true);
      view.setFloat32(offset + 12, ax, true);
      view.setFloat32(offset + 16, ay, true);
      view.setFloat32(offset + 20, az, true);
      view.setFloat32(offset + 24, bx, true);
      view.setFloat32(offset + 28, by, true);
      view.setFloat32(offset + 32, bz, true);
      view.setFloat32(offset + 36, cx, true);
      view.setFloat32(offset + 40, cy, true);
      view.setFloat32(offset + 44, cz, true);
      view.setUint16(offset + 48, 0, true);
      offset += 50;
    }

    return new Blob([buffer], { type: 'model/stl' });
  }

  private static saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 立刻 revoke 在部分瀏覽器會中斷下載，延遲釋放比較保險
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
