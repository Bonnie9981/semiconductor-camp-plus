/**
 * Certificate —— 結業證書
 * ---------------------------------------------------------------------------
 * 玩家走完五道製程後，拍一張照片、和他親手做出來的晶圓圖案一起排版成一張
 * 證書，再包成 PDF 下載。
 *
 * 為什麼不引入 PDF 函式庫？
 *   證書上有大量中文。任何在 PDF 裡「排文字」的方案都得嵌入中文字型，
 *   一個字型檔就是好幾 MB，還要處理 subset 與 CID 編碼。
 *   這裡改成**先把整張證書畫在 canvas 上**（文字用瀏覽器自己的字型渲染成點陣），
 *   再把單一張 JPEG 包進最小的 PDF 骨架。完全不需要字型嵌入，
 *   輸出也保證跟畫面上看到的一模一樣。
 */

export interface CertificateData {
  /** 玩家照片；null 代表沒有攝影機。 */
  photo: HTMLCanvasElement | null;
  /** 晶圓成品圖。 */
  wafer: HTMLCanvasElement;
  /** 沉積方式。 */
  method: string;
  /** 光阻類型。 */
  tone: string;
  /** 蝕刻方式。 */
  etch: string;
  /** 完成時間。 */
  date: Date;
  /** 走完整條製程花了多久（已格式化，例如 12:34）。 */
  elapsed: string;
  /** 評等字串，例如「A　·　失誤 1 次　·　圖案覆蓋 7%」。 */
  grade: string;
  /** 觀念回顧：把這次的選擇對應到背後的原理，最多 3 行（不評分，純複習）。 */
  review: string[];
  /** 流水序號。 */
  serial: string;
}

/** 證書畫布尺寸（A4 橫式 √2 比例，解析度夠高才印得清楚）。 */
export const CERT_W = 1684;
export const CERT_H = 1190;

/** 從 <video> 擷取一張照片。mirrored 時左右翻轉，跟玩家在畫面上看到的一致。 */
export function capturePhoto(video: HTMLVideoElement, mirrored: boolean): HTMLCanvasElement | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  // 裁成 4:3 的中央區域
  const targetRatio = 4 / 3;
  let sw = vw;
  let sh = vw / targetRatio;
  if (sh > vh) {
    sh = vh;
    sw = vh * targetRatio;
  }
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;

  const out = document.createElement('canvas');
  out.width = 800;
  out.height = 600;
  const ctx = out.getContext('2d');
  if (!ctx) return null;

  if (mirrored) {
    ctx.translate(out.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}

/** 把資料排版成一張證書。 */
export function composeCertificate(data: CertificateData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CERT_W;
  c.height = CERT_H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Certificate: 無法取得 2D context');

  const sans = "'IBM Plex Sans', 'Noto Sans TC', sans-serif";
  const mono = "'IBM Plex Mono', monospace";

  // ── 底 ──
  const bg = ctx.createLinearGradient(0, 0, CERT_W, CERT_H);
  bg.addColorStop(0, '#101820');
  bg.addColorStop(0.5, '#152029');
  bg.addColorStop(1, '#0d141a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CERT_W, CERT_H);

  drawCircuitPattern(ctx);

  // 外框
  ctx.strokeStyle = 'rgba(94, 233, 223, 0.65)';
  ctx.lineWidth = 6;
  ctx.strokeRect(38, 38, CERT_W - 76, CERT_H - 76);
  ctx.strokeStyle = 'rgba(94, 233, 223, 0.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(56, 56, CERT_W - 112, CERT_H - 112);

  // ── 標題 ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#5ee9df';
  ctx.font = `600 30px ${mono}`;
  ctx.fillText('CERTIFICATE OF COMPLETION', CERT_W / 2, 104);

  ctx.fillStyle = '#f2f8fa';
  ctx.font = `700 76px ${sans}`;
  ctx.fillText('半導體製程結業證書', CERT_W / 2, 150);

  ctx.fillStyle = 'rgba(190, 212, 222, 0.8)';
  ctx.font = `500 27px ${sans}`;
  ctx.fillText('半導體製程沉浸式模擬 · Semiconductor Process Simulator', CERT_W / 2, 248);

  // 分隔線
  ctx.strokeStyle = 'rgba(94, 233, 223, 0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CERT_W / 2 - 260, 300);
  ctx.lineTo(CERT_W / 2 + 260, 300);
  ctx.stroke();

  /*
    版面分成三個水平帶，彼此不重疊：
      A  y 320~470  「茲證明…」+ 五道製程徽章（滿版置中）
      B  y 500~880  照片（左） | 製程紀錄（中） | 晶圓（右）
      C  y 1000~    頁尾

    原本把徽章列放在 B 帶、和照片同高，徽章從中心往兩邊長，寬度一超過中欄
    就會壓到左邊的照片 —— 這就是截圖裡「RCA 清洗」被蓋住的原因。
    改成獨立一帶之後，徽章可以用滿整個寬度，永遠不會撞到左右兩欄。
  */

  // ── A：證詞與五道製程徽章（滿版） ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#e8f2f6';
  ctx.font = `500 32px ${sans}`;
  ctx.fillText('茲證明本人已完成下列五道半導體製程', CERT_W / 2, 330);

  const steps = ['RCA 清洗', '薄膜沉積', '微影製程', '顯影', '蝕刻'];
  const chipY = 388;
  const chipH = 58;
  const chipGap = 16;
  // 字級由「排得下」反推，關卡名稱之後變長也不會擠出邊框
  const chipAvail = CERT_W - 200;
  let chipFont = 26;
  let widths: number[] = [];
  let totalW = 0;
  for (;;) {
    ctx.font = `700 ${chipFont}px ${sans}`;
    widths = steps.map((s) => ctx.measureText(s).width + 48);
    totalW = widths.reduce((a, b) => a + b, 0) + chipGap * (steps.length - 1);
    if (totalW <= chipAvail || chipFont <= 16) break;
    chipFont -= 1;
  }
  let cx = CERT_W / 2 - totalW / 2;
  steps.forEach((s, i) => {
    ctx.fillStyle = 'rgba(94, 233, 223, 0.16)';
    roundRect(ctx, cx, chipY, widths[i], chipH, 29);
    ctx.fill();
    ctx.strokeStyle = 'rgba(94, 233, 223, 0.5)';
    ctx.lineWidth = 2;
    roundRect(ctx, cx, chipY, widths[i], chipH, 29);
    ctx.stroke();
    ctx.fillStyle = '#5ee9df';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, cx + widths[i] / 2, chipY + chipH / 2 + 1);
    ctx.textBaseline = 'top';
    cx += widths[i] + chipGap;
  });

  // ── B：照片 | 製程紀錄 | 晶圓 ──
  const rowY = 512;
  const photoW = 460;
  const photoH = 345;
  const photoX = 132;

  ctx.save();
  roundRect(ctx, photoX, rowY, photoW, photoH, 16);
  ctx.clip();
  if (data.photo) {
    ctx.drawImage(data.photo, photoX, rowY, photoW, photoH);
  } else {
    ctx.fillStyle = '#1b242c';
    ctx.fillRect(photoX, rowY, photoW, photoH);
    ctx.fillStyle = 'rgba(170, 196, 208, 0.6)';
    ctx.font = `600 30px ${sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('（未拍攝照片）', photoX + photoW / 2, rowY + photoH / 2);
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(94, 233, 223, 0.55)';
  ctx.lineWidth = 3;
  roundRect(ctx, photoX, rowY, photoW, photoH, 16);
  ctx.stroke();

  ctx.fillStyle = 'rgba(180, 204, 214, 0.75)';
  ctx.font = `600 24px ${sans}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('製程工程師', photoX + photoW / 2, rowY + photoH + 16);

  // 右：晶圓成品
  const waferSize = 345;
  const waferX = CERT_W - 132 - waferSize;
  ctx.drawImage(data.wafer, waferX, rowY, waferSize, waferSize);
  ctx.strokeStyle = 'rgba(94, 233, 223, 0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(waferX + waferSize / 2, rowY + waferSize / 2, waferSize / 2 - 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(180, 204, 214, 0.75)';
  ctx.font = `600 24px ${sans}`;
  ctx.fillText('晶圓成品', waferX + waferSize / 2, rowY + waferSize + 16);

  // 中：製程選擇紀錄。欄位限制在照片與晶圓之間，不會壓到兩側。
  const colL = photoX + photoW;
  const colR = waferX;
  const colMid = (colL + colR) / 2;
  const rows: [string, string][] = [
    ['評等', data.grade],
    ['總花費時間', data.elapsed],
    ['沉積方式', data.method],
    ['光阻類型', data.tone],
    ['蝕刻方式', data.etch],
  ];
  /*
    每一列排成「標籤　值」一整行，置中在中欄上。

    原本是標籤右對齊、值左對齊、以中線為界 —— 那是表格的排法。
    證書是正式文件，整份的文字都置中比較整齊，所以這裡改成把
    「標籤 + 值」當成一個整體置中。

    字級仍然由「排得下」反推：整行寬度不能超過中欄，
    否則「化學氣相沉積（PECVD）」會伸出去壓到右邊的晶圓。
  */
  const rowMax = colR - colL - 24;
  let ry = rowY + 52;
  rows.forEach(([k, v]) => {
    const gap = 18;
    let vFont = 25;
    let kW = 0;
    let vW = 0;
    for (;;) {
      ctx.font = `600 ${Math.round(vFont * 0.92)}px ${sans}`;
      kW = ctx.measureText(k).width;
      ctx.font = `700 ${vFont}px ${sans}`;
      vW = ctx.measureText(v).width;
      if (kW + gap + vW <= rowMax || vFont <= 15) break;
      vFont -= 1;
    }

    const startX = colMid - (kW + gap + vW) / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(168, 192, 204, 0.85)';
    ctx.font = `600 ${Math.round(vFont * 0.92)}px ${sans}`;
    ctx.fillText(k, startX, ry);

    ctx.fillStyle = '#f2f8fa';
    ctx.font = `700 ${vFont}px ${sans}`;
    ctx.fillText(v, startX + kW + gap, ry);
    ry += 52;
  });

  // ── B2：觀念回顧（把這次的選擇對應到背後的原理，不評分） ──
  const revY = 864;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(94, 233, 223, 0.6)';
  ctx.font = `600 19px ${mono}`;
  ctx.fillText('觀念回顧 · WHY IT WORKS', CERT_W / 2, revY);
  ctx.strokeStyle = 'rgba(94, 233, 223, 0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CERT_W / 2 - 300, revY + 32);
  ctx.lineTo(CERT_W / 2 + 300, revY + 32);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(214, 230, 236, 0.9)';
  ctx.font = `400 22px ${sans}`;
  data.review.slice(0, 3).forEach((line, i) => {
    ctx.fillText(`·  ${line}`, 206, revY + 56 + i * 30);
  });

  // ── 頁尾 ──
  const footY = CERT_H - 178;
  ctx.strokeStyle = 'rgba(94, 233, 223, 0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(130, footY);
  ctx.lineTo(CERT_W - 130, footY);
  ctx.stroke();

  const d = data.date;
  const dateStr = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;

  /*
    頁尾原本是左右兩端對齊（日期在左、機構名在右）。
    改成置中的一疊，整份證書的文字就沒有一處是靠邊的。
  */
  const footCX = CERT_W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  ctx.fillStyle = '#5ee9df';
  ctx.font = `700 32px ${sans}`;
  ctx.fillText('半導體製程沉浸式模擬', footCX, footY + 24);

  ctx.fillStyle = 'rgba(190, 212, 222, 0.85)';
  ctx.font = `500 25px ${sans}`;
  ctx.fillText(`完成日期　${dateStr}`, footCX, footY + 70);

  ctx.fillStyle = 'rgba(150, 178, 190, 0.72)';
  ctx.font = `500 21px ${mono}`;
  ctx.fillText(`SERIAL ${data.serial}  ·  SEMICONDUCTOR PROCESS SIMULATOR`, footCX, footY + 112);

  return c;
}

/** 背景的電路紋路，純裝飾。 */
function drawCircuitPattern(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(94, 233, 223, 0.07)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 26; i++) {
    const y = 60 + i * 44;
    const bend = 140 + ((i * 97) % 400);
    ctx.moveTo(0, y);
    ctx.lineTo(bend, y);
    ctx.lineTo(bend + 40, y + 40);
    ctx.lineTo(CERT_W, y + 40);
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(94, 233, 223, 0.09)';
  for (let i = 0; i < 40; i++) {
    const x = (i * 211) % CERT_W;
    const y = (i * 137) % CERT_H;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ─────────────────────────────── PDF 產生 ──────────────────────────────────

/**
 * 把一張 canvas 包成 PDF。
 *
 * 只用到 PDF 最小的骨架：Catalog → Pages → Page → 一個 DCTDecode（JPEG）影像。
 * 因為整張證書已經是點陣圖，PDF 裡不需要任何字型物件，中文自然沒有問題。
 * xref 表需要每個物件的位元組位移，所以整份文件是以 Uint8Array 拼出來的。
 */
export async function canvasToPdf(canvas: HTMLCanvasElement): Promise<Blob> {
  const jpeg = await canvasToJpegBytes(canvas, 0.92);

  // A4 橫式（點，1pt = 1/72 inch）
  const pageW = 842;
  const pageH = 595;
  // 等比縮放置中
  const scale = Math.min(pageW / canvas.width, pageH / canvas.height);
  const drawW = canvas.width * scale;
  const drawH = canvas.height * scale;
  const offX = (pageW - drawW) / 2;
  const offY = (pageH - drawH) / 2;

  const content = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${offX.toFixed(2)} ${offY.toFixed(2)} cm\n/Im0 Do\nQ\n`;

  const parts: (string | Uint8Array)[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (chunk: string | Uint8Array): void => {
    parts.push(chunk);
    length += typeof chunk === 'string' ? chunk.length : chunk.length;
  };
  const startObject = (): void => {
    offsets.push(length);
  };

  push('%PDF-1.4\n');
  // 二進位註解，讓工具知道這份檔案含二進位資料
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  startObject();
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObject();
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  startObject();
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );

  startObject();
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push('\nendstream\nendobj\n');

  startObject();
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  const xrefStart = length;
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  push(xref);

  // 組成單一 Uint8Array（字串以 latin1 逐字元寫入，才不會破壞二進位段）
  const out = new Uint8Array(length);
  let p = 0;
  for (const chunk of parts) {
    if (typeof chunk === 'string') {
      for (let i = 0; i < chunk.length; i++) out[p++] = chunk.charCodeAt(i) & 0xff;
    } else {
      out.set(chunk, p);
      p += chunk.length;
    }
  }

  return new Blob([out], { type: 'application/pdf' });
}

async function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  if (!blob) throw new Error('Certificate: JPEG 編碼失敗');
  return new Uint8Array(await blob.arrayBuffer());
}

/** 產生一組看起來像批號的流水序號。 */
export function makeSerial(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const rand = Math.floor(Math.random() * 46656)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0');
  return `SPS-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(
    date.getHours(),
  )}${p(date.getMinutes())}-${rand}`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
