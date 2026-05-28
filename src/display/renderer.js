// Renderer v2 - 使用真实 PNG 帧的多层渲染器
// 对标 VPet MainDisplay：500×500 逻辑空间 → Canvas 物理尺寸缩放

class PetRenderer {
  constructor(canvas, graphCore, effects, messageBar) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.graphCore = graphCore;
    this.effects = effects;
    this.messageBar = messageBar;

    this._currentFrame = null;   // ImageBitmap | HTMLCanvasElement
    this._lastFrameUpdate = 0;

    // VPet 逻辑坐标空间 500×500
    this.LOGIC_W = 500;
    this.LOGIC_H = 500;

    this._onFrame = (img, idx) => {
      this._currentFrame = img;
    };
  }

  get onFrame() { return this._onFrame; }

  draw(petState) {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    ctx.clearRect(0, 0, cw, ch);

    // 计算缩放比例（仿 VPet Viewbox）
    const scaleX = cw / this.LOGIC_W;
    const scaleY = ch / this.LOGIC_H;
    const scale = Math.min(scaleX, scaleY);

    ctx.save();
    ctx.scale(scale, scale);

    // === 第0层：情绪底色覆盖 ===
    this._drawMoodOverlay(ctx, petState);

    // === 第1层：宠物帧动画 ===
    if (this._currentFrame) {
      // VPet 帧通常为 500×500 或相近尺寸，直接绘制填满逻辑空间
      ctx.drawImage(this._currentFrame, 0, 0, this.LOGIC_W, this.LOGIC_H);
    }

    // === 第2层：特效层 ===
    this.effects.draw(ctx, 250, 280, petState.animTimer);

    // === 第3层：说话气泡 ===
    if (this.messageBar.isVisible) {
      this._drawSpeechBubble(ctx, 250, 180, petState);
    }

    // === 第4层：名牌 ===
    this._drawNameTag(ctx, 250, 120, petState);

    ctx.restore();
  }

  _drawMoodOverlay(ctx, petState) {
    const mood = petState.mood;
    if (mood === ModeType.ILL) {
      ctx.fillStyle = 'rgba(200, 220, 180, 0.25)';
      ctx.fillRect(0, 0, this.LOGIC_W, this.LOGIC_H);
    } else if (mood === ModeType.POOR_CONDITION) {
      ctx.fillStyle = 'rgba(180, 180, 180, 0.1)';
      ctx.fillRect(0, 0, this.LOGIC_W, this.LOGIC_H);
    }
  }

  _drawSpeechBubble(ctx, x, y, petState) {
    const text = this.messageBar.visibleText;
    if (!text || this.messageBar.opacity <= 0) return;

    ctx.save();
    ctx.globalAlpha = this.messageBar.opacity;
    ctx.font = '18px "Microsoft YaHei", sans-serif';

    const maxChars = SPEECH_CFG.MAX_LINE_CHARS;
    const lines = [];
    for (let i = 0; i < text.length; i += maxChars) {
      lines.push(text.substring(i, i + maxChars));
    }

    const bubbleW = Math.max(80, Math.min(300, text.length * 10 + 30));
    const lineH = 24;
    const bubbleH = lines.length * lineH + 20;
    const bx = x - bubbleW / 2;
    const by = y - bubbleH;

    // 气泡背景
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bubbleW, bubbleH, 14);
    ctx.fill();
    ctx.stroke();

    // 气泡尾巴
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.moveTo(x - 8, by + bubbleH);
    ctx.lineTo(x, by + bubbleH + 12);
    ctx.lineTo(x + 8, by + bubbleH);
    ctx.closePath();
    ctx.fill();

    // 文字
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, x, by + 10 + i * lineH);
    });

    // 流式光标
    if (this.messageBar.isStreaming && Math.floor(petState.animTimer / 15) % 2) {
      const lastLine = lines[lines.length - 1] || '';
      const lw = ctx.measureText(lastLine).width;
      ctx.fillStyle = '#333';
      ctx.fillRect(x + lw / 2 + 3, by + 10 + (lines.length - 1) * lineH, 2, lineH);
    }

    ctx.restore();
  }

  _drawNameTag(ctx, x, y, petState) {
    if (petState.state === PetState.DRAG) return;

    ctx.save();
    ctx.globalAlpha = 0.5;
    const moodEmojis = {
      [ModeType.HAPPY]: '😊', [ModeType.NORMAL]: '😐',
      [ModeType.POOR_CONDITION]: '😞', [ModeType.ILL]: '🤒',
    };
    const emoji = moodEmojis[petState.mood] || '';
    ctx.fillStyle = '#333';
    ctx.font = '14px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`小橘 Lv.${petState.stats?.level || 1} ${emoji}`, x, y);
    ctx.restore();
  }
}