import type { Point } from '../core/types';

/**
 * SpinDryer —— 旋轉乾燥機（甩乾機）
 * ---------------------------------------------------------------------------
 * 造型刻意做成「像烘衣機」：一個帶圓形玻璃門的箱體，門內是會轉的滾筒，
 * 右下角一顆實體按鈕。
 *
 *   1. loading —— 門打開，滾筒中央有一個虛線的「放這裡」目標框
 *   2. ready   —— 晶圓已卡進滾筒，門關上，按鈕亮起
 *   3. spin    —— 滾筒旋轉，水滴被離心力甩向筒壁後蒸發，同時吹熱風
 *   4. done    —— 停止，晶圓乾燥
 */

export type DryerPhase = 'loading' | 'ready' | 'spin' | 'done';

export interface DryerGeometry {
  cx: number;
  cy: number;
  /** 箱體寬度；高度依 0.92 比例推導。 */
  width: number;
}

export interface DryerState {
  phase: DryerPhase;
  /** 滾筒累積轉角（弧度），由 Stage 依 dt 累加。 */
  spin: number;
  /** 目前轉速 0~1，用來決定殘影與水滴甩出的強度。 */
  speed: number;
  /** 表面殘留水分 0~1。 */
  water: number;
  /** 晶圓半徑。 */
  waferR: number;
  waferColor: string;
  /** loading 階段時玩家手上晶圓的位置；null = 還沒抓起來。 */
  heldWafer: Point | null;
  /** 目標框是否被命中（手上的晶圓靠得夠近）。 */
  targetHot: boolean;
}

interface Droplet {
  angle: number;
  radius: number;
  speed: number;
  life: number;
}

export class SpinDryer {
  private droplets: Droplet[] = [];

  /** 箱體幾何：回傳滾筒中心與半徑，Stage 用來做命中測試。 */
  drumCircle(geo: DryerGeometry): { cx: number; cy: number; r: number } {
    const h = geo.width * 0.92;
    return { cx: geo.cx, cy: geo.cy, r: Math.min(geo.width, h) * 0.33 };
  }

  /** 「開始烘乾」實體按鈕的位置與半徑。 */
  buttonCircle(geo: DryerGeometry): { cx: number; cy: number; r: number } {
    const h = geo.width * 0.92;
    return { cx: geo.cx + geo.width * 0.34, cy: geo.cy + h * 0.3, r: 15 };
  }

  render(
    ctx: CanvasRenderingContext2D,
    geo: DryerGeometry,
    state: DryerState,
    dt: number,
    time: number,
  ): void {
    const w = geo.width;
    const h = w * 0.92;
    const left = geo.cx - w / 2;
    const top = geo.cy - h / 2;
    const drum = this.drumCircle(geo);

    ctx.save();

    // ── 機體陰影 ──
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(geo.cx, top + h + 5, w * 0.5, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── 機殼 ──
    const body = ctx.createLinearGradient(left, top, left, top + h);
    body.addColorStop(0, '#4b565c');
    body.addColorStop(0.5, '#39434a');
    body.addColorStop(1, '#242c31');
    ctx.fillStyle = body;
    roundRect(ctx, left, top, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = '#1b2226';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 頂部控制面板
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, left + 10, top + 8, w - 20, 16, 5);
    ctx.fill();
    ctx.fillStyle = state.phase === 'spin' ? '#5ee9df' : 'rgba(180,200,210,0.55)';
    ctx.font = "500 12px 'IBM Plex Mono', monospace";
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      state.phase === 'spin'
        ? `SPIN ${Math.round(state.speed * 3000)} RPM · 熱風 80°C`
        : state.phase === 'done'
          ? 'DRY · 完成'
          : 'SPIN DRYER · 待機',
      left + 18,
      top + 16,
    );

    // ── 滾筒內部 ──
    ctx.save();
    ctx.beginPath();
    ctx.arc(drum.cx, drum.cy, drum.r, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#10171b';
    ctx.fillRect(drum.cx - drum.r, drum.cy - drum.r, drum.r * 2, drum.r * 2);

    // 筒壁的孔洞（跟著轉，是旋轉感的主要來源）
    ctx.save();
    ctx.translate(drum.cx, drum.cy);
    ctx.rotate(state.spin);
    ctx.fillStyle = 'rgba(150, 190, 205, 0.22)';
    for (let ring = 1; ring <= 2; ring++) {
      const rr = drum.r * (0.5 + ring * 0.22);
      const count = 10 + ring * 4;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 三片撥水肋條
    ctx.fillStyle = 'rgba(120, 150, 165, 0.3)';
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate((i / 3) * Math.PI * 2);
      ctx.fillRect(-3, -drum.r, 6, drum.r * 0.42);
      ctx.restore();
    }
    ctx.restore();

    // 滾筒裡的晶圓（ready 之後才在裡面）
    if (state.phase !== 'loading' || state.heldWafer === null) {
      if (state.phase !== 'loading') {
        this.drawSpinningWafer(ctx, drum, state);
      }
    }

    if (state.phase === 'spin') {
      this.updateDroplets(ctx, drum, state, dt);
      this.drawHotAir(ctx, drum, time);
    }

    ctx.restore();

    // ── 玻璃門 ──
    const doorOpen = state.phase === 'loading';
    ctx.strokeStyle = doorOpen ? 'rgba(94, 233, 223, 0.85)' : 'rgba(190, 215, 225, 0.8)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(drum.cx, drum.cy, drum.r + 4, 0, Math.PI * 2);
    ctx.stroke();

    if (!doorOpen) {
      // 關上的門：玻璃反光
      ctx.save();
      ctx.globalAlpha = 0.16;
      const glass = ctx.createLinearGradient(
        drum.cx - drum.r,
        drum.cy - drum.r,
        drum.cx + drum.r,
        drum.cy + drum.r,
      );
      glass.addColorStop(0, '#ffffff');
      glass.addColorStop(0.45, 'rgba(255,255,255,0)');
      ctx.fillStyle = glass;
      ctx.beginPath();
      ctx.arc(drum.cx, drum.cy, drum.r + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      // 開著的門：虛線目標框 + 呼吸光暈
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -time * 20;
      ctx.strokeStyle = state.targetHot ? '#5ee9df' : `rgba(94, 233, 223, ${0.35 + pulse * 0.4})`;
      ctx.lineWidth = state.targetHot ? 3 : 2;
      ctx.beginPath();
      ctx.arc(drum.cx, drum.cy, drum.r * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = state.targetHot ? '#5ee9df' : 'rgba(190, 220, 225, 0.7)';
      ctx.font = "500 12px 'IBM Plex Mono', monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.targetHot ? '放開放入' : '把晶圓夾到這裡', drum.cx, drum.cy);
    }

    // ── 實體按鈕 ──
    const btn = this.buttonCircle(geo);
    const live = state.phase === 'ready';
    ctx.save();
    ctx.fillStyle = live ? '#1d7a70' : '#2a3238';
    ctx.beginPath();
    ctx.arc(btn.cx, btn.cy, btn.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = live ? '#5ee9df' : '#4a555c';
    ctx.lineWidth = live ? 2.5 : 1.5;
    ctx.stroke();
    if (live) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 5);
      ctx.globalAlpha = 0.25 + pulse * 0.4;
      ctx.beginPath();
      ctx.arc(btn.cx, btn.cy, btn.r + 5 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = live ? '#d8fffb' : 'rgba(160,180,190,0.6)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(state.phase === 'spin' ? '■' : '▶', btn.cx, btn.cy + 0.5);
    ctx.restore();

    ctx.fillStyle = live ? '#5ee9df' : 'rgba(160,180,190,0.55)';
    ctx.font = "500 12px 'IBM Plex Mono', monospace";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('START', btn.cx, btn.cy + btn.r + 5);

    // ── 玩家手上正拿著的晶圓（畫在最上層） ──
    if (state.phase === 'loading' && state.heldWafer) {
      this.drawHeldWafer(ctx, state.heldWafer, state, time);
    }

    ctx.restore();
  }

  /** 滾筒內的晶圓：轉速越高殘影越多，看起來就會「糊成一圈」。 */
  private drawSpinningWafer(
    ctx: CanvasRenderingContext2D,
    drum: { cx: number; cy: number; r: number },
    state: DryerState,
  ): void {
    const r = Math.min(state.waferR, drum.r * 0.66);
    const ghosts = state.speed > 0.15 ? 5 : 1;

    for (let i = 0; i < ghosts; i++) {
      const t = i / ghosts;
      ctx.save();
      ctx.globalAlpha = i === 0 ? 1 : 0.16 * (1 - t);
      ctx.translate(drum.cx, drum.cy);
      ctx.rotate(state.spin - t * 0.5 * state.speed);

      const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
      grad.addColorStop(0, '#f0f5f7');
      grad.addColorStop(0.6, state.waferColor);
      grad.addColorStop(1, '#8d9ea6');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      // 定位平邊，轉起來才看得出來它真的在轉
      ctx.fillStyle = '#28313a';
      ctx.fillRect(-r, r * 0.86, r * 2, r * 0.2);

      ctx.strokeStyle = 'rgba(240,248,250,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 表面殘留的水珠（隨轉速被甩到邊緣）
    if (state.water > 0.02) {
      ctx.save();
      ctx.translate(drum.cx, drum.cy);
      ctx.rotate(state.spin);
      ctx.globalAlpha = state.water * 0.9;
      ctx.fillStyle = '#8ad4f2';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const rr = r * (0.25 + state.speed * 0.55);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** 玩家捏著、還沒放進去的晶圓。 */
  private drawHeldWafer(
    ctx: CanvasRenderingContext2D,
    p: Point,
    state: DryerState,
    time: number,
  ): void {
    const r = state.waferR;
    ctx.save();

    // 鑷子
    ctx.strokeStyle = '#b8c6cd';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x - 9, p.y - r - 22);
    ctx.lineTo(p.x - 4, p.y - r + 3);
    ctx.moveTo(p.x + 9, p.y - r - 22);
    ctx.lineTo(p.x + 4, p.y - r + 3);
    ctx.stroke();

    const grad = ctx.createRadialGradient(
      p.x - r * 0.3,
      p.y - r * 0.35,
      r * 0.1,
      p.x,
      p.y,
      r,
    );
    grad.addColorStop(0, '#f0f5f7');
    grad.addColorStop(0.6, state.waferColor);
    grad.addColorStop(1, '#8d9ea6');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#dfe9ed';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 濕淋淋的水滴往下滴
    if (state.water > 0.05) {
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = '#8ad4f2';
      for (let i = 0; i < 3; i++) {
        const drip = ((time * 60 + i * 40) % 60) / 60;
        ctx.beginPath();
        ctx.arc(p.x - r * 0.4 + i * r * 0.4, p.y + r + drip * 18, 2.2 * (1 - drip), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /** 被離心力甩向筒壁的水滴。 */
  private updateDroplets(
    ctx: CanvasRenderingContext2D,
    drum: { cx: number; cy: number; r: number },
    state: DryerState,
    dt: number,
  ): void {
    const want = Math.round(state.speed * state.water * 30);
    while (this.droplets.length < want) {
      this.droplets.push({
        angle: Math.random() * Math.PI * 2,
        radius: drum.r * 0.2,
        speed: 60 + Math.random() * 140,
        life: 1,
      });
    }

    ctx.save();
    ctx.fillStyle = '#9fdcf5';
    for (const d of this.droplets) {
      d.radius += d.speed * dt;
      d.angle += state.speed * 6 * dt;
      d.life -= dt * 1.4;
      if (d.radius > drum.r || d.life <= 0) {
        d.radius = drum.r * 0.15;
        d.angle = Math.random() * Math.PI * 2;
        d.life = 1;
      }
      ctx.globalAlpha = Math.max(0, d.life) * 0.8;
      const x = drum.cx + Math.cos(d.angle) * d.radius;
      const y = drum.cy + Math.sin(d.angle) * d.radius;
      // 拉成短線段才有「甩出去」的速度感
      ctx.beginPath();
      ctx.ellipse(x, y, 3.2, 1.2, d.angle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (this.droplets.length > want) this.droplets.length = Math.max(0, want);
  }

  /** 熱風：從左右兩側吹進來的暖色弧線。 */
  private drawHotAir(
    ctx: CanvasRenderingContext2D,
    drum: { cx: number; cy: number; r: number },
    time: number,
  ): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 176, 102, 0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const t = ((time * 0.9 + i * 0.25) % 1);
      const rr = drum.r * (1 - t * 0.85);
      ctx.globalAlpha = 0.4 * (1 - t);
      ctx.beginPath();
      ctx.arc(drum.cx, drum.cy, rr, 0.3, 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(drum.cx, drum.cy, rr, Math.PI + 0.3, Math.PI + 1.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  reset(): void {
    this.droplets = [];
  }
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
