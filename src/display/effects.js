// Effects - 特效管理器（简化版，配合 500×500 帧使用）
class Effects {
  constructor() {
    this.hearts = [];
    this.sleepZs = [];
    this.sweats = [];
  }

  spawnHearts(count = 3) {
    for (let i = 0; i < count; i++) {
      this.hearts.push({
        x: 70 + Math.random() * 60,
        y: 30 + Math.random() * 30,
        size: 10 + Math.random() * 10,
        life: 1, opacity: 1,
        vy: 1.5,
      });
    }
  }

  spawnSleepZs() {
    if (this.sleepZs.length < 4) {
      this.sleepZs.push({
        x: 110 + Math.random() * 30,
        y: 30,
        size: 12 + Math.random() * 10,
        life: 1, opacity: 1,
        vy: 0.8,
      });
    }
  }

  spawnSweat() {
    this.sweats.push({
      x: 120 + Math.random() * 10,
      y: 20,
      life: 1, opacity: 0.7,
      vy: 1.5,
    });
  }

  update() {
    this.hearts = this.hearts.filter(h => {
      h.y -= h.vy; h.life -= 0.02;
      h.opacity = Math.max(0, h.life);
      return h.life > 0;
    });
    this.sleepZs = this.sleepZs.filter(z => {
      z.y -= z.vy; z.x += Math.sin(z.life * 5) * 0.3;
      z.life -= 0.015; z.opacity = Math.max(0, z.life);
      return z.life > 0;
    });
    this.sweats = this.sweats.filter(s => {
      s.y += s.vy; s.life -= 0.025;
      s.opacity = Math.max(0, s.life * 0.7);
      return s.life > 0;
    });
  }

  draw(ctx, petState) {
    for (const h of this.hearts) {
      ctx.save(); ctx.globalAlpha = h.opacity;
      ctx.fillStyle = '#ff4081';
      ctx.font = `${h.size}px serif`;
      ctx.fillText('❤', h.x, h.y);
      ctx.restore();
    }
    for (const z of this.sleepZs) {
      ctx.save(); ctx.globalAlpha = z.opacity;
      ctx.fillStyle = '#90caf9';
      ctx.font = `bold ${z.size}px sans-serif`;
      ctx.fillText('Z', z.x, z.y);
      ctx.restore();
    }
    for (const s of this.sweats) {
      ctx.save(); ctx.globalAlpha = s.opacity;
      ctx.fillStyle = '#64b5f6';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.bezierCurveTo(s.x - 3, s.y + 6, s.x + 3, s.y + 6, s.x, s.y + 2);
      ctx.fill();
      ctx.restore();
    }
  }
}