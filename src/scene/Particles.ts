/**
 * DepositionField —— 沉積腔體裡的粒子場
 * ---------------------------------------------------------------------------
 * 兩種沉積方式的差別，在畫面上就是「粒子怎麼走」：
 *
 *   ballistic（PVD / e-gun）
 *     靶材被電子束打中後氣化，在真空中沒有東西撞它，
 *     所以是一條一條**筆直落下**的軌跡，落點集中、方向性強。
 *
 *   diffusive（CVD / PECVD）
 *     通入的氣體分子彼此不斷碰撞，路徑是**亂走**的；
 *     被電漿激發後才在晶圓表面反應成膜，所以會邊飄邊閃。
 *
 * 粒子用物件池管理（達到上限就回收重生），不會每幀配置新陣列。
 */

export type ParticleMode = 'ballistic' | 'diffusive';

export interface FieldConfig {
  mode: ParticleMode;
  /** 生成強度 0~1（＝功率 / 氣體流量）。 */
  rate: number;
  /** 粒子生成的 y。 */
  sourceY: number;
  /** 落點 y（晶圓表面）。 */
  landY: number;
  /** 生成的水平範圍。 */
  left: number;
  right: number;
  /** 只有落在這個水平範圍內才算沉積到晶圓上（用來畫附著閃光）。 */
  targetLeft: number;
  targetRight: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  /** 擴散運動的相位，讓每顆粒子的擺動不同步。 */
  phase: number;
  /** 附著在晶圓上之後的殘光倒數（秒）；> 0 代表正在閃。 */
  flash: number;
}

/** 粒子數上限。滿版腔體大約用到 90~110 顆就很密了。 */
const MAX_PARTICLES = 140;

export class DepositionField {
  private particles: Particle[] = [];
  private spawnAccum = 0;

  reset(): void {
    this.particles = [];
    this.spawnAccum = 0;
  }

  update(dt: number, cfg: FieldConfig): void {
    // ── 生成 ──
    const perSecond = cfg.mode === 'ballistic' ? 70 : 46;
    this.spawnAccum += dt * perSecond * cfg.rate;
    while (this.spawnAccum >= 1 && this.particles.length < MAX_PARTICLES) {
      this.spawnAccum -= 1;
      this.particles.push(this.spawn(cfg));
    }
    if (this.spawnAccum > 4) this.spawnAccum = 4;

    // ── 更新 ──
    for (const p of this.particles) {
      if (p.flash > 0) {
        p.flash -= dt;
        continue;
      }

      if (cfg.mode === 'ballistic') {
        // 真空中直線下落，只有微不足道的水平漂移
        p.y += p.vy * dt;
        p.x += p.vx * dt;
      } else {
        // 氣體分子：邊落邊左右亂走
        p.phase += dt * 3.4;
        p.y += p.vy * dt;
        p.x += (p.vx + Math.sin(p.phase) * 34) * dt;
      }

      if (p.y >= cfg.landY) {
        const onWafer = p.x >= cfg.targetLeft && p.x <= cfg.targetRight;
        if (onWafer) {
          // 附著：停在表面閃一下，視覺上就是「凝結成膜」
          p.y = cfg.landY;
          p.flash = cfg.mode === 'ballistic' ? 0.22 : 0.34;
        } else {
          Object.assign(p, this.spawn(cfg));
        }
      }
    }

    // 閃完的粒子回收重生
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.flash < 0) Object.assign(p, this.spawn(cfg));
    }

    // 強度降到很低時逐步縮減粒子數，畫面才會跟著「停下來」
    const want = Math.round(MAX_PARTICLES * Math.min(1, cfg.rate * 1.2));
    if (this.particles.length > want + 12) this.particles.length = want + 12;
  }

  private spawn(cfg: FieldConfig): Particle {
    const ballistic = cfg.mode === 'ballistic';
    return {
      x: cfg.left + Math.random() * (cfg.right - cfg.left),
      y: cfg.sourceY - Math.random() * 14,
      vx: ballistic ? (Math.random() - 0.5) * 8 : (Math.random() - 0.5) * 26,
      vy: ballistic ? 190 + Math.random() * 130 : 52 + Math.random() * 46,
      size: ballistic ? 1.5 + Math.random() * 1.4 : 2.1 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
      flash: 0,
    };
  }

  render(ctx: CanvasRenderingContext2D, cfg: FieldConfig, color: string): void {
    ctx.save();

    for (const p of this.particles) {
      if (p.flash > 0) {
        // 附著閃光：一個往外擴散並淡出的小圈
        const t = 1 - p.flash / (cfg.mode === 'ballistic' ? 0.22 : 0.34);
        ctx.globalAlpha = (1 - t) * 0.85;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 + t * 7, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }

      if (cfg.mode === 'ballistic') {
        // 拉成短線段＝速度感，也直接表達「直線下落」
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = color;
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.045);
        ctx.stroke();
      } else {
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // 氣體分子畫成雙原子的樣子，跟金屬粒子區分開
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(p.x + p.size * 1.3, p.y - p.size * 0.5, p.size * 0.72, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  get count(): number {
    return this.particles.length;
  }
}
