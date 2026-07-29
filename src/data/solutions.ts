import type { ChoiceOption, MixRow } from '../core/types';

/**
 * 製程藥液資料表
 * ---------------------------------------------------------------------------
 * RCA 三個濕式步驟、顯影、濕蝕刻都從這張表取選項，因此「正確答案」與「干擾項」
 * 用的是同一份定義，玩家不會因為文案不一致而察覺哪個是對的。
 *
 * color 是這瓶藥液在燒杯裡的顏色，混合時會依份數做加權平均。
 */

export interface Solution {
  id: string;
  name: string;
  formula: string;
  color: string;
  /** 這瓶藥液的作用，答錯時顯示。 */
  role: string;
}

export const SOLUTIONS: Record<string, Solution> = {
  di: {
    id: 'di',
    name: '去離子水',
    formula: 'H₂O (DI)',
    color: '#7fc8e8',
    role: '稀釋用的超純水，幾乎所有清洗液的基底。',
  },
  nh4oh: {
    id: 'nh4oh',
    name: '氨水',
    formula: 'NH₄OH',
    color: '#a99ae0',
    role: '鹼性，使微粒與晶圓表面同帶負電而互相排斥。',
  },
  h2o2: {
    id: 'h2o2',
    name: '過氧化氫',
    formula: 'H₂O₂',
    color: '#efe184',
    role: '強氧化劑，把有機物氧化分解。',
  },
  hcl: {
    id: 'hcl',
    name: '鹽酸',
    formula: 'HCl',
    color: '#f0a96b',
    role: '與金屬離子形成可溶的錯合物，把離子帶走。',
  },
  hf: {
    id: 'hf',
    name: '氫氟酸',
    formula: 'HF',
    color: '#6fd9ad',
    role: '唯一能溶解二氧化矽的酸，用來剝除氧化層。',
  },
  hno3: {
    id: 'hno3',
    name: '硝酸',
    formula: 'HNO₃',
    color: '#e08585',
    role: '強氧化性酸，濕蝕刻矽時與 HF 搭配使用。',
  },
  acetone: {
    id: 'acetone',
    name: '丙酮',
    formula: 'CH₃COCH₃',
    color: '#cfd6da',
    role: '有機溶劑，用來溶解並剝除光阻。',
  },
  nmp: {
    id: 'nmp',
    name: 'NMP',
    formula: 'C₅H₉NO',
    color: '#9fb4c0',
    role: '高沸點光阻剝離液，比丙酮更不易揮發。',
  },
  koh: {
    id: 'koh',
    name: '氫氧化鉀',
    formula: 'KOH',
    color: '#c79ae0',
    role: '鹼性顯影液，溶解曝光後的正光阻。',
  },
  tmah: {
    id: 'tmah',
    name: '四甲基氫氧化銨',
    formula: 'TMAH',
    color: '#8ad4c4',
    role: '半導體標準顯影液，無金屬離子污染。',
  },
};

export function solution(id: string): Solution {
  const s = SOLUTIONS[id];
  if (!s) throw new Error(`solutions.ts: 找不到藥液 '${id}'`);
  return s;
}

/** 把藥液轉成選擇題選項。 */
export function toChoice(id: string): ChoiceOption {
  const s = solution(id);
  return { id: s.id, label: s.name, sub: s.formula, color: s.color };
}

/** 把藥液轉成配比列。 */
export function toMixRow(id: string, parts = 0): MixRow {
  const s = solution(id);
  return { id: s.id, label: s.name, sub: s.formula, color: s.color, parts };
}

/**
 * 依份數加權混合顏色。份數越懸殊，混出來的顏色越接近主要成分——
 * 這正是燒杯動畫「濃度改變顏色」要的效果。
 */
export function blendColor(rows: readonly MixRow[]): string {
  const total = rows.reduce((sum, r) => sum + r.parts, 0);
  if (total === 0) return '#2b3940';

  let r = 0;
  let g = 0;
  let b = 0;
  for (const row of rows) {
    const [cr, cg, cb] = hexToRgb(row.color);
    const w = row.parts / total;
    r += cr * w;
    g += cg * w;
    b += cb * w;
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}
