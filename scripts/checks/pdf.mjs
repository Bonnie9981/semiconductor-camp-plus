/**
 * 證書 PDF 結構檢查
 * ---------------------------------------------------------------------------
 * 直接跑真正的 `canvasToPdf()`，解析輸出的位元組，驗證：
 *
 *   - xref 表的每個位移都精確指到 `N 0 obj` 的開頭
 *   - startxref 指到 `xref` 表
 *   - 嵌入的 JPEG 位元組與來源完全相同（沒被字串編碼破壞）
 *   - 影像字典宣告的 /Length 與實際 stream 長度一致
 *
 * 最容易出錯的是位移：整份文件是以 Uint8Array 拼出來的，字串必須以 latin1
 * 逐字元寫入；一旦誤用 UTF-8，中間的二進位 JPEG 段就會被撐開而讓位移全錯。
 */
import { Report, SRC } from './lib.mjs';
import { MINIMAL_JPEG, fakeCanvasOfSize, installDomShim } from './dom-shim.mjs';

installDomShim();
const { canvasToPdf, CERT_W, CERT_H } = await import(`${SRC}utils/Certificate.ts`);

const report = new Report('證書 PDF（真實 canvasToPdf）');

const blob = await canvasToPdf(fakeCanvasOfSize(CERT_W, CERT_H));
const buf = Buffer.from(await blob.arrayBuffer());
const txt = buf.toString('latin1');

report.add('MIME 型別', blob.type === 'application/pdf' ? [] : [`得到 ${blob.type}`]);
report.add('檔頭 %PDF-', txt.startsWith('%PDF-') ? [] : ['檔頭不對']);
report.add('結尾 %%EOF', txt.trimEnd().endsWith('%%EOF') ? [] : ['結尾不對']);

// xref 位移
const xrefStart = Number(txt.match(/startxref\n(\d+)/)?.[1] ?? -1);
report.add(
  'startxref 指向 xref 表',
  txt.slice(xrefStart, xrefStart + 4) === 'xref' ? [] : [`位移 ${xrefStart} 指到「${txt.slice(xrefStart, xrefStart + 12)}」`],
);

const table = txt.slice(xrefStart);
const offsets = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
report.add('xref 表有 5 個物件', offsets.length === 5 ? [] : [`找到 ${offsets.length} 個`]);
offsets.forEach((off, i) => {
  const expect = `${i + 1} 0 obj`;
  const actual = txt.slice(off, off + expect.length);
  report.add(`物件 ${i + 1} 的位移`, actual === expect ? [] : [`位移 ${off} 讀到「${actual}」`]);
});

// JPEG 完整性
const soi = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
const embedded = buf.subarray(soi, soi + MINIMAL_JPEG.length);
report.add(
  'JPEG 位元組未被破壞',
  soi > 0 && Buffer.compare(embedded, Buffer.from(MINIMAL_JPEG)) === 0
    ? []
    : ['嵌入的 JPEG 與來源不同 —— 字串可能被當成 UTF-8 編碼了'],
);

const declared = Number(txt.match(/\/Filter \/DCTDecode \/Length (\d+)/)?.[1] ?? -1);
report.add(
  '影像 /Length 正確',
  declared === MINIMAL_JPEG.length ? [] : [`宣告 ${declared}，實際 ${MINIMAL_JPEG.length}`],
);

export default () => report.print();
