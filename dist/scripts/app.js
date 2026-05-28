// Desktop Pet — Tauri v2 前端入口
// 阶段2: VPet 真实 PNG 帧渲染管线

const { invoke } = window.__TAURI__.core;

// ── 帧缓存 ──
const frameCache = new Map(); // path → Image

async function loadImage(base64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/png;base64,${base64}`;
  });
}

async function preloadFrames(paths) {
  // 过滤已缓存的
  const toLoad = paths.filter(p => !frameCache.has(p));
  if (toLoad.length === 0) return;

  const batch = await invoke('read_png_frames_batch', { framePaths: toLoad });
  const entries = Object.entries(batch);

  await Promise.all(entries.map(async ([path, base64]) => {
    try {
      const img = await loadImage(base64);
      frameCache.set(path, img);
    } catch (e) {
      console.warn(`帧加载失败: ${path}`, e);
    }
  }));
}

// ── 动画状态机 ──
// 三段式: a_start → b_loop → c_end
// 无 a_start/c_end 时直接 b_loop 循环

class AnimationPlayer {
  constructor() {
    this.phases = { a_start: [], b_loop: [], c_end: [] };
    this.currentPhase = 'b_loop';  // 当前阶段
    this.currentIndex = 0;          // 当前帧索引
    this.accumulator = 0;           // 时间累加器 (ms)
    this.currentImage = null;       // 当前帧 Image 对象
    this.currentDuration = 0;       // 当前帧持续时间
    this.isPlaying = false;
    this.onComplete = null;         // 播放结束回调
  }

  // 设置动画数据
  setPhases(phases) {
    this.phases = {
      a_start: phases.a_start || [],
      b_loop: phases.b_loop || [],
      c_end: phases.c_end || [],
    };
  }

  // 开始播放
  play(onComplete) {
    this.onComplete = onComplete;
    // 有 a_start 则从 a_start 开始，否则直接 b_loop
    if (this.phases.a_start.length > 0) {
      this.currentPhase = 'a_start';
    } else {
      this.currentPhase = 'b_loop';
    }
    this.currentIndex = 0;
    this.accumulator = 0;
    this.isPlaying = true;
    this._updateCurrentFrame();
  }

  // 停止
  stop() {
    this.isPlaying = false;
  }

  // 更新 (每帧调用, dt 为毫秒)
  update(dt) {
    if (!this.isPlaying) return;

    const frames = this.phases[this.currentPhase];
    if (!frames || frames.length === 0) {
      // 当前阶段无帧，尝试下一阶段
      this._advancePhase();
      return;
    }

    this.accumulator += dt;

    while (this.accumulator >= this.currentDuration && this.isPlaying) {
      this.accumulator -= this.currentDuration;
      this.currentIndex++;

      if (this.currentIndex >= frames.length) {
        // 当前阶段播完
        if (this.currentPhase === 'b_loop') {
          // b_loop 循环
          this.currentIndex = 0;
        } else {
          this._advancePhase();
          return;
        }
      }

      this._updateCurrentFrame();
    }
  }

  _advancePhase() {
    if (this.currentPhase === 'a_start') {
      this.currentPhase = 'b_loop';
      this.currentIndex = 0;
      this.accumulator = 0;
      this._updateCurrentFrame();
    } else if (this.currentPhase === 'b_loop') {
      // b_loop 正常情况下不会 advance, 但如果被外部打断要播 c_end
      if (this.phases.c_end.length > 0) {
        this.currentPhase = 'c_end';
        this.currentIndex = 0;
        this.accumulator = 0;
        this._updateCurrentFrame();
      } else {
        // 无 c_end, 回调完成
        this.isPlaying = false;
        if (this.onComplete) this.onComplete();
      }
    } else {
      // c_end 播完
      this.isPlaying = false;
      if (this.onComplete) this.onComplete();
    }
  }

  // 触发结束动画 (从 b_loop 切到 c_end)
  triggerEnd(onComplete) {
    if (this.phases.c_end.length > 0 && this.currentPhase === 'b_loop') {
      this.onComplete = onComplete;
      this.currentPhase = 'c_end';
      this.currentIndex = 0;
      this.accumulator = 0;
      this._updateCurrentFrame();
    } else {
      this.isPlaying = false;
      if (onComplete) onComplete();
    }
  }

  _updateCurrentFrame() {
    const frames = this.phases[this.currentPhase];
    if (!frames || frames.length === 0) return;

    const frame = frames[this.currentIndex];
    if (!frame) return;

    this.currentDuration = frame.duration;
    this.currentImage = frameCache.get(frame.file) || null;
  }

  get isLooping() {
    return this.currentPhase === 'b_loop';
  }
}

// ── 右键菜单 ──

class ContextMenu {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'context-menu';
    Object.assign(this.el.style, {
      position: 'fixed',
      zIndex: '9999',
      background: 'rgba(30,30,30,0.95)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '8px',
      padding: '4px 0',
      minWidth: '140px',
      display: 'none',
      fontFamily: 'sans-serif',
      fontSize: '13px',
      color: '#e0e0e0',
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      backdropFilter: 'blur(12px)',
    });
    document.body.appendChild(this.el);
    this._close = () => { this.hide(); };
  }

  show(x, y, items) {
    this.el.innerHTML = '';
    items.forEach((item) => {
      if (item === '-') {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin:4px 8px';
        this.el.appendChild(sep);
        return;
      }
      const div = document.createElement('div');
      div.textContent = item.label;
      Object.assign(div.style, {
        padding: '6px 16px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      });
      div.addEventListener('mouseenter', () => {
        div.style.background = 'rgba(255,255,255,0.1)';
      });
      div.addEventListener('mouseleave', () => {
        div.style.background = 'transparent';
      });
      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        item.action();
      });
      this.el.appendChild(div);
    });
    this.el.style.display = 'block';
    this.el.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
    this.el.style.top = `${Math.min(y, window.innerHeight - this.el.offsetHeight - 10)}px`;
    setTimeout(() => document.addEventListener('mousedown', this._close, { once: true }), 0);
  }

  hide() {
    this.el.style.display = 'none';
    document.removeEventListener('mousedown', this._close);
  }
}

// ── 主应用 ──

class DesktopPetApp {
  constructor() {
    this.canvas = document.getElementById('pet-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.statusRust = document.getElementById('status-rust');
    this.statusFps = document.getElementById('status-fps');
    this.statusAnim = document.getElementById('status-anim');

    this.player = new AnimationPlayer();
    this.lastTime = 0;
    this.frameCount = 0;
    this.lastFpsTime = 0;
    this.currentFps = 0;

    // 当前动画状态
    this.graphType = 'default';
    this.mode = 'normal';

    // 渲染参数 (用于坐标转换)
    this._renderScale = 1;
    this._renderDx = 0;
    this._renderDy = 0;

    // 交互状态
    this._dragging = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._pressStartTime = 0;
    this._hoveredPart = null;  // 'head' | 'body' | null

    this._contextMenu = new ContextMenu();

    // 行走状态
    this._facingRight = true;
    this._walkTimer = null;
    this._walkGraphType = 'default';
    this._manualAnimLock = false;  // 手动交互(喂食/摸头)时锁住, 防止被行走覆盖

    // UI 面板
    this.chatUI = new ChatUI(this);
    this.settingsUI = new SettingsUI(this);

    this._init();
  }

  async _init() {
    this.statusRust.textContent = 'Rust: loading...';

    try {
      // 1. 验证通信
      const greeting = await invoke('greet', { name: 'Tauri' });
      this.statusRust.textContent = `Rust: OK`;

      // 2. 加载默认动画帧信息
      await this._loadAnimation(this.graphType, this.mode);

      // 3. 绑定交互事件
      this._bindEvents();

      // 4. 游戏时钟 — 每秒推进一次
      this._sideHideCheckInterval = setInterval(() => this._checkSideHide(), 2000);

      let tickCount = 0;
      this._tickInterval = setInterval(() => {
        invoke('game_tick', { dtSeconds: 1.0 }).then((result) => {
          if (result.mood && result.mood !== this.mode && !this._manualAnimLock) {
            this.mode = result.mood;
            this.playAnimation(result.graphType || this.graphType, result.mood);
          }
          if (result.leveledUp) this.showBubble('升级啦!', 3000);
          if (result.workFinished) this.showBubble('工作完成!', 3000);
        }).catch(() => {});

        tickCount++;
        if (tickCount % 5 === 0) {
          invoke('get_pet_status', {}).then((s) => {
            if (s.stats) {
              const h = s.stats.hunger;
              if (h < 20) this.showBubble('好饿...', 2000);
              else if (h < 10) this.showBubble('要饿死了喵!', 3000);
            }
          }).catch(() => {});
        }
      }, 1000);

      // 4.5 自主行走 — 每 120ms tick 一次
      this._walkTimer = setInterval(() => this._walkTick(), 120);

      // 5. 启动渲染循环
      this.lastTime = performance.now();
      this.lastFpsTime = this.lastTime;
      requestAnimationFrame((t) => this._gameLoop(t));

    } catch (e) {
      this.statusRust.textContent = `Rust: ERROR ${e}`;
      console.error('初始化失败:', e);
    }
  }

  // ── 气泡提示 ──

  showBubble(text, duration = 2500) {
    const bubble = document.createElement('div');
    bubble.className = 'pet-bubble';
    bubble.textContent = text;
    Object.assign(bubble.style, {
      position: 'fixed',
      top: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.8)',
      color: '#fff',
      padding: '6px 14px',
      borderRadius: '12px',
      fontSize: '14px',
      fontFamily: 'sans-serif',
      whiteSpace: 'nowrap',
      zIndex: '150',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 0.3s, transform 0.3s',
    });
    document.body.appendChild(bubble);
    requestAnimationFrame(() => {
      bubble.style.opacity = '1';
      bubble.style.transform = 'translateX(-50%) translateY(-4px)';
    });
    setTimeout(() => {
      bubble.style.opacity = '0';
      bubble.style.transform = 'translateX(-50%) translateY(-12px)';
      setTimeout(() => bubble.remove(), 300);
    }, duration);
  }

  async _loadAnimation(graphType, mode) {
    this.statusAnim.textContent = `Anim: loading ${graphType}/${mode}...`;

    // 获取动画帧列表
    const phases = await invoke('get_animation_frames', { graphType, mode });

    // 收集所有帧路径
    const allPaths = [];
    for (const phase of ['a_start', 'b_loop', 'c_end']) {
      const frames = phases[phase] || [];
      for (const f of frames) {
        allPaths.push(f.file);
      }
    }

    this.statusAnim.textContent = `Anim: preloading ${allPaths.length} frames...`;

    // 批量预加载
    await preloadFrames(allPaths);

    // 设置播放器
    this.player.setPhases(phases);
    this.player.play(() => {
      // 播放完成回调 (非循环动画)
      console.log(`动画 ${graphType}/${mode} 播放完成`);
    });

    this.statusAnim.textContent = `Anim: ${graphType}/${mode} ✓ (${allPaths.length}f)`;
    this.graphType = graphType;
    this.mode = mode;
  }

  // 切换动画
  async playAnimation(graphType, mode, onComplete) {
    // 锁定手动动画，防止闲置行为覆盖
    this._manualAnimLock = true;
    const releaseLock = () => { this._manualAnimLock = false; };
    setTimeout(releaseLock, 4000);  // 4秒后自动释放

    await this._loadAnimation(graphType, mode);
    if (onComplete) {
      const origComplete = this.player.onComplete;
      this.player.onComplete = () => {
        if (origComplete) origComplete();
        releaseLock();
        onComplete();
      };
    } else {
      const origComplete = this.player.onComplete;
      this.player.onComplete = () => {
        if (origComplete) origComplete();
        releaseLock();
      };
    }
  }

  // ── 交互事件绑定 ──

  _bindEvents() {
    // 全局 window mousedown 兜底 (Tauri 透明窗口可能拦截 canvas mousedown)
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this._pressStartTime === 0) {
        this._pressStartTime = e.timeStamp;
        this._dragging = false;
        this._dragStartX = e.screenX;
        this._dragStartY = e.screenY;
      }
    });

    // 拖拽窗口：mousedown on canvas
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        // 左键：检测拖拽意图
        this._dragging = false;
        this._dragStartX = e.screenX;
        this._dragStartY = e.screenY;
        this._pressStartTime = e.timeStamp;

        // 命中检测
        const { x, y } = this._canvasToLogical(e.offsetX, e.offsetY);
        this._hoveredPart = this._hitTestLogical(x, y);

        // 阻止默认行为防止选中
        e.preventDefault();
      }
    });

    // 全局 mousemove (用于窗口拖拽)
    window.addEventListener('mousemove', (e) => {
      if (e.buttons !== 1) {
        // 左键未按下，更新 hover 状态
        const rect = this.canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        if (cx >= 0 && cy >= 0 && cx < rect.width && cy < rect.height) {
          const { x, y } = this._canvasToLogical(cx, cy);
          this._hoveredPart = this._hitTestLogical(x, y);
        } else {
          this._hoveredPart = null;
        }

        if (this._dragging) {
          this._dragging = false;
          document.body.classList.remove('dragging');
        }
        return;
      }

      if (!this._dragging) {
        // 判断是否开始拖拽 (移动超过 3px)
        const dx = Math.abs(e.screenX - this._dragStartX);
        const dy = Math.abs(e.screenY - this._dragStartY);
        if (dx > 3 || dy > 3) {
          this._dragging = true;
          document.body.classList.add('dragging');
        }
      }

      if (this._dragging) {
        const dScreenX = e.screenX - this._dragStartX;
        const dScreenY = e.screenY - this._dragStartY;
        this._dragStartX = e.screenX;
        this._dragStartY = e.screenY;
        invoke('move_window_by', { dx: dScreenX, dy: dScreenY }).catch(() => {});
      }
    });

    // mouseup on canvas
    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this._dragging) {
        this._dragging = false;
        document.body.classList.remove('dragging');
        // 拖拽结束, 通知 Rust
        invoke('process_interaction', { lx: 0, ly: 0, pressDurationMs: 0, hasMoved: true }).catch(() => {});
        return;
      }

      if (e.button === 0) {
        // 保护: 若 _pressStartTime 为 0 或差值异常 (>5000ms), 视为短按
        let pressDurationMs = e.timeStamp - this._pressStartTime;
        if (this._pressStartTime === 0 || pressDurationMs > 5000 || pressDurationMs < 0) {
          pressDurationMs = 50; // 模拟短按
        }
        this._pressStartTime = 0;
        const { x, y } = this._canvasToLogical(e.offsetX, e.offsetY);
        this._onClickPart(x, y, pressDurationMs);
      }
    });

    // 右键菜单
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._showContextMenu(e.clientX, e.clientY);
    });
  }

  // Canvas 像素 → 逻辑坐标 (500x500 空间)
  _canvasToLogical(cx, cy) {
    return {
      x: (cx - this._renderDx) / this._renderScale,
      y: (cy - this._renderDy) / this._renderScale,
    };
  }

  // 椭圆命中检测 (逻辑坐标空间)
  _hitTestLogical(lx, ly) {
    // 头部椭圆: 中心(250, 180), rx=100, ry=90
    const headHit = this._inEllipse(lx, ly, 250, 180, 100, 90);
    // 身体椭圆: 中心(250, 320), rx=85, ry=110
    const bodyHit = this._inEllipse(lx, ly, 250, 320, 85, 110);

    if (headHit) return 'head';
    if (bodyHit) return 'body';
    return null;
  }

  _inEllipse(x, y, cx, cy, rx, ry) {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  }

  async _onClickPart(lx, ly, pressDurationMs) {
    if (this._dragging) return;
    try {
      const result = await invoke('process_interaction', {
        lx, ly, pressDurationMs, hasMoved: false,
      });
      if (result.graphType) {
        this.playAnimation(result.graphType, result.mood || 'normal');
      }
      if (result.message) {
        console.log('[Pet]:', result.message);
      }
    } catch (e) {
      console.warn('交互处理失败:', e);
      // 降级: 本地命中检测
      const part = this._hitTestLogical(lx, ly);
      if (part === 'head') this.playAnimation('default', 'happy');
      else if (part === 'body') this.playAnimation('default', 'normal');
    }
  }

  async _handleFeed() {
    try {
      const result = await invoke('pet_action_feed', {});
      if (result.graphType) this.playAnimation(result.graphType, result.mood || 'normal');
      if (result.message) console.log('[Pet]:', result.message);
    } catch(e) { this.playAnimation('eat', 'normal'); }
  }

  async _handleDrink() {
    try {
      const result = await invoke('pet_action_drink', {});
      if (result.graphType) this.playAnimation(result.graphType, result.mood || 'normal');
      if (result.message) console.log('[Pet]:', result.message);
    } catch(e) { this.playAnimation('drink', 'normal'); }
  }

  async _handlePlay() {
    try {
      const result = await invoke('pet_action_play', {});
      if (result.graphType) this.playAnimation(result.graphType, result.mood || 'normal');
      if (result.message) console.log('[Pet]:', result.message);
    } catch(e) { this.playAnimation('default', 'happy'); }
  }

  async _handlePinch() {
    try {
      const result = await invoke('pet_action_pinch', {});
      if (result.graphType) this.playAnimation(result.graphType, result.mood || 'normal');
      if (result.message) console.log('[Pet]:', result.message);
    } catch(e) { this.showBubble('捏不到喵~', 2000); }
  }

  async _handleWork(type) {
    try {
      const result = await invoke('pet_action_work', { workType: type });
      if (result.workStarted) {
        this.showBubble(`开始工作! (${result.duration}s)`, 3000);
        if (result.graphType) this.playAnimation(result.graphType, 'normal');
      }
    } catch(e) { console.warn('工作启动失败:', e); }
  }

  _showContextMenu(x, y) {
    this._contextMenu.show(x, y, [
      { label: '喂食', action: () => this._handleFeed() },
      { label: '喝水', action: () => this._handleDrink() },
      { label: '玩耍', action: () => this._handlePlay() },
      { label: '捏一下', action: () => this._handlePinch() },
      '-',
      { label: '工作 (打工)', action: () => this._handleWork('work') },
      { label: '工作 (学习)', action: () => this._handleWork('study') },
      { label: '工作 (打扫)', action: () => this._handleWork('clean') },
      { label: '聊天', action: () => this.chatUI.toggle() },
      { label: '状态', action: () => invoke('get_pet_status', {}).then(r => console.log('状态:', r)) },
      '-',
      { label: '设置', action: () => this.settingsUI.show() },
      { label: '退出', action: () => invoke('quit_app', {}) },
    ]);
  }

  // ── 游戏循环 ──

  _gameLoop(timestamp) {
    const dt = Math.min(timestamp - this.lastTime, 50); // 最多 50ms
    this.lastTime = timestamp;

    // FPS
    this.frameCount++;
    if (timestamp - this.lastFpsTime >= 1000) {
      this.currentFps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = timestamp;
      this.statusFps.textContent = `FPS: ${this.currentFps}`;
    }

    // 更新动画
    this.player.update(dt);

    // 渲染
    this._render();

    requestAnimationFrame((t) => this._gameLoop(t));
  }

  _render() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // 清空 (透明背景)
    ctx.clearRect(0, 0, W, H);

    const img = this.player.currentImage;
    if (!img) return;

    // 将帧绘制到 Canvas 中心
    // VPet 帧通常 500x500 或更大，缩放到 Canvas 大小
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;

    // 保存渲染参数供坐标转换使用
    this._renderScale = scale;
    this._renderDx = dx;
    this._renderDy = dy;

    ctx.drawImage(img, dx, dy, dw, dh);

    // 开发模式：绘制命中区域辅助线
    if (this._hoveredPart) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,255,100,0.5)';
      ctx.lineWidth = 2;
      if (this._hoveredPart === 'head') {
        this._drawEllipse(ctx, 250, 180, 100, 90, dx, dy, scale);
      } else if (this._hoveredPart === 'body') {
        this._drawEllipse(ctx, 250, 320, 85, 110, dx, dy, scale);
      }
      ctx.restore();
    }
  }

  _drawEllipse(ctx, lx, ly, lrx, lry, dx, dy, scale) {
    ctx.beginPath();
    ctx.ellipse(
      dx + lx * scale,
      dy + ly * scale,
      lrx * scale,
      lry * scale,
      0, 0, Math.PI * 2
    );
    ctx.stroke();
  }

  // ── 自主行走 ──

  async _walkTick() {
    if (this._dragging) return;
    try {
      const [pos, screen] = await Promise.all([
        invoke('get_window_position', {}),
        invoke('get_screen_info', {}),
      ]);
      const result = await invoke('walk_tick', {
        dtSeconds: 0.12,
        windowX: pos.x,
        windowY: pos.y,
        windowW: pos.width,
        windowH: pos.height,
        screenW: Math.round(screen.workAreaWidth),
        screenH: Math.round(screen.workAreaHeight),
      });

      if (result.dx !== 0 || result.dy !== 0) {
        await invoke('move_window_by', { dx: result.dx, dy: result.dy });
      }

      // 更新朝向 → 画布翻转
      this._facingRight = result.facingRight;
      this.canvas.style.transform = this._facingRight ? '' : 'scaleX(-1)';

      // 闲置行为动画切换 (仅当未被手动交互覆盖时)
      if (result.graphType && result.graphType !== this._walkGraphType) {
        this._walkGraphType = result.graphType;
        if (!this._manualAnimLock) {
          this.playAnimation(result.graphType, this.mode);
        }
      }
    } catch (e) { /* 静默 */ }
  }

  // ── SideHide 边缘检测 ──

  async _checkSideHide() {
    if (this._dragging || this._manualAnimLock) return;
    try {
      const [pos, screen, mousePos] = await Promise.all([
        invoke('get_window_position', {}),
        invoke('get_screen_info', {}),
        window.__TAURI__.window.getCurrent().cursorPosition().catch(() => ({ x: 0, y: 0 })),
      ]);

      const result = await invoke('sidehide_check', {
        windowX: pos.x,
        windowY: pos.y,
        windowW: pos.width,
        windowH: pos.height,
        screenW: Math.round(screen.workAreaWidth),
        screenH: Math.round(screen.workAreaHeight),
        mouseScreenX: Math.round(mousePos.x),
      });

      if (result.action === 'hide') {
        await invoke('set_window_position', { x: result.targetX, y: pos.y });
        if (result.graphType) this.playAnimation(result.graphType, this.mode);
      } else if (result.action === 'rise') {
        if (result.targetX !== undefined) {
          await invoke('set_window_position', { x: result.targetX, y: pos.y });
        }
        if (result.graphType) this.playAnimation(result.graphType, this.mode);
      }
    } catch(e) { /* 静默 */ }
  }
}

// ── 聊天 UI ──

class ChatUI {
  constructor(app) {
    this.app = app;
    this.history = [];
    this._buildDom();
    this._bindEvents();
  }

  _buildDom() {
    this.el = document.createElement('div');
    this.el.id = 'chat-panel';
    Object.assign(this.el.style, {
      position: 'fixed', bottom: '24px', left: '0', right: '0', height: '220px',
      background: 'rgba(20,20,20,0.92)',
      borderTop: '1px solid rgba(255,255,255,0.1)',
      display: 'none', flexDirection: 'column',
      fontFamily: 'sans-serif', fontSize: '13px', color: '#e0e0e0',
      zIndex: '100', backdropFilter: 'blur(10px)',
    });

    this.msgArea = document.createElement('div');
    Object.assign(this.msgArea.style, {
      flex: '1', overflowY: 'auto', padding: '8px 12px',
      display: 'flex', flexDirection: 'column',
    });
    this.el.appendChild(this.msgArea);

    const inputRow = document.createElement('div');
    Object.assign(inputRow.style, {
      display: 'flex', padding: '6px 8px', gap: '6px',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    });

    this.input = document.createElement('input');
    Object.assign(this.input.style, {
      flex: '1', background: 'rgba(255,255,255,0.08)', border: 'none',
      borderRadius: '6px', padding: '6px 10px', color: '#e0e0e0',
      outline: 'none', fontSize: '13px',
    });
    this.input.placeholder = '和宠物说点什么...';

    const sendBtn = document.createElement('button');
    sendBtn.textContent = '发送';
    Object.assign(sendBtn.style, {
      background: 'rgba(100,150,255,0.3)', border: 'none',
      borderRadius: '6px', padding: '6px 14px', color: '#d0d8ff',
      cursor: 'pointer', fontSize: '13px',
    });
    this.sendBtn = sendBtn;

    inputRow.appendChild(this.input);
    inputRow.appendChild(sendBtn);
    this.el.appendChild(inputRow);
    document.body.appendChild(this.el);
  }

  _bindEvents() {
    this.sendBtn.addEventListener('click', () => this._send());
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._send(); });
  }

  toggle() {
    const visible = this.el.style.display === 'flex';
    this.el.style.display = visible ? 'none' : 'flex';
    if (!visible) this.input.focus();
  }

  async _send() {
    const msg = this.input.value.trim();
    if (!msg) return;
    this.input.value = '';

    this._addBubble('user', msg);
    const bubble = this._addBubble('assistant', '...');

    try {
      const config = await invoke('load_llm_config', {});
      if (!config.api_key) { bubble.el.textContent = '请先在设置中配置 API Key'; return; }

      const status = await invoke('get_pet_status', {});
      const prompt = await invoke('build_persona_prompt', {
        customPrompt: null, mood: status.mood || 'normal',
        hunger: status.stats.hunger, happiness: status.stats.happiness,
        isWorking: false,
      });

      let fullText = '';
      const unlistenChunk = window.__TAURI__.event.listen('llm-stream-chunk', (event) => {
        fullText += event.payload;
        bubble.el.textContent = fullText;
        this.msgArea.scrollTop = this.msgArea.scrollHeight;
      });
      const unlistenDone = window.__TAURI__.event.listen('llm-stream-done', (event) => {
        bubble.el.textContent = event.payload || fullText;
      });

      const newHistory = await invoke('chat_stream', {
        message: msg, config, systemPrompt: prompt, history: this.history,
      });
      this.history = newHistory;

      setTimeout(() => {
        unlistenChunk.then(fn => fn()); unlistenDone.then(fn => fn());
      }, 500);
    } catch (e) {
      bubble.el.textContent = `请求失败: ${e}`;
    }
  }

  _addBubble(role, text) {
    const div = document.createElement('div');
    const isUser = role === 'user';
    Object.assign(div.style, {
      margin: '4px 0', padding: '6px 10px', borderRadius: '8px',
      maxWidth: '85%', wordBreak: 'break-word',
      alignSelf: isUser ? 'flex-end' : 'flex-start',
      background: isUser ? 'rgba(100,150,255,0.2)' : 'rgba(255,255,255,0.06)',
      color: '#e0e0e0',
    });
    div.textContent = text;
    this.msgArea.appendChild(div);
    this.msgArea.scrollTop = this.msgArea.scrollHeight;
    return { el: div };
  }
}

// ── 设置面板 ──

class SettingsUI {
  constructor(app) {
    this.app = app;
    this._buildDom();
  }

  _buildDom() {
    this.el = document.createElement('div');
    this.el.id = 'settings-panel';
    Object.assign(this.el.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.85)',
      display: 'none', alignItems: 'center', justifyContent: 'center',
      zIndex: '200', fontFamily: 'sans-serif',
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: 'rgba(30,30,30,0.97)', borderRadius: '12px',
      padding: '20px 24px', width: '360px', maxHeight: '80vh',
      overflowY: 'auto', color: '#e0e0e0', fontSize: '13px',
      border: '1px solid rgba(255,255,255,0.1)',
    });

    const title = document.createElement('h3');
    title.textContent = '设置';
    title.style.cssText = 'margin:0 0 16px;font-size:16px;color:#fff';
    card.appendChild(title);

    this._addInput(card, 'API 地址', 'endpoint', 'https://api.openai.com/v1/chat/completions');
    this._addInput(card, 'API Key', 'apiKey', '', 'password');
    this._addInput(card, '模型', 'model', 'gpt-3.5-turbo');
    this._addInput(card, 'Temperature', 'temperature', '0.8');

    // 协议选择
    const protoLabel = document.createElement('div');
    protoLabel.textContent = '协议';
    protoLabel.style.cssText = 'margin-top:12px;color:#aaa;font-size:12px';
    card.appendChild(protoLabel);
    this.protocolSelect = document.createElement('select');
    Object.assign(this.protocolSelect.style, {
      width: '100%', padding: '6px 8px', marginTop: '4px',
      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '6px', color: '#e0e0e0', fontSize: '13px', boxSizing: 'border-box',
    });
    ['openai', 'anthropic'].forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v === 'openai' ? 'OpenAI 兼容' : 'Anthropic 兼容';
      this.protocolSelect.appendChild(opt);
    });
    card.appendChild(this.protocolSelect);

    const personaLabel = document.createElement('div');
    personaLabel.textContent = '人设';
    personaLabel.style.cssText = 'margin-top:12px;color:#aaa;font-size:12px';
    card.appendChild(personaLabel);

    this.personaSelect = document.createElement('select');
    Object.assign(this.personaSelect.style, {
      width: '100%', padding: '6px 8px', marginTop: '4px',
      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '6px', color: '#e0e0e0', fontSize: '13px', boxSizing: 'border-box',
    });
    card.appendChild(this.personaSelect);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '保存';
    Object.assign(saveBtn.style, {
      flex: '1', padding: '8px', background: 'rgba(100,150,255,0.3)',
      border: 'none', borderRadius: '6px', color: '#d0d8ff',
      cursor: 'pointer', fontSize: '13px',
    });
    saveBtn.addEventListener('click', () => this._save());

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    Object.assign(closeBtn.style, {
      flex: '1', padding: '8px', background: 'rgba(255,255,255,0.06)',
      border: 'none', borderRadius: '6px', color: '#aaa',
      cursor: 'pointer', fontSize: '13px',
    });
    closeBtn.addEventListener('click', () => this.hide());

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(closeBtn);
    card.appendChild(btnRow);
    this.el.appendChild(card);
    document.body.appendChild(this.el);
  }

  _addInput(parent, label, key, placeholder, type) {
    const lbl = document.createElement('div');
    lbl.textContent = label;
    lbl.style.cssText = 'margin-top:10px;color:#aaa;font-size:12px';
    parent.appendChild(lbl);
    const input = document.createElement('input');
    input.type = type || 'text';
    input.placeholder = placeholder;
    input.dataset.key = key;
    Object.assign(input.style, {
      width: '100%', padding: '6px 8px', marginTop: '4px',
      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '6px', color: '#e0e0e0', fontSize: '13px',
      outline: 'none', boxSizing: 'border-box',
    });
    parent.appendChild(input);
  }

  async show() {
    this.el.style.display = 'flex';
    try {
      const config = await invoke('load_llm_config', {});
      const qs = (k) => this.el.querySelector(`[data-key="${k}"]`);
      const val = (k, d) => { const e = qs(k); if (e) e.value = d; };
      val('endpoint', config.endpoint || '');
      val('apiKey', config.api_key || '');
      val('model', config.model || '');
      val('temperature', String(config.temperature || 0.8));
      if (this.protocolSelect) this.protocolSelect.value = config.protocol || 'openai';

      const presets = await invoke('get_persona_presets', {});
      this.personaSelect.innerHTML = '';
      presets.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = `${p.name} — ${p.description}`;
        this.personaSelect.appendChild(opt);
      });
    } catch(e) { console.warn('加载配置失败:', e); }
  }

  hide() { this.el.style.display = 'none'; }

  async _save() {
    const qs = (k) => this.el.querySelector(`[data-key="${k}"]`);
    try {
      const config = {
        endpoint: (qs('endpoint') || { value: '' }).value,
        api_key: (qs('apiKey') || { value: '' }).value,
        model: (qs('model') || { value: '' }).value,
        temperature: parseFloat((qs('temperature') || { value: '0.8' }).value || '0.8'),
        max_tokens: 1024,
        protocol: this.protocolSelect ? this.protocolSelect.value : 'openai',
      };
      await invoke('save_llm_config', { config });
    } catch(e) { console.warn('保存配置失败:', e); }
    this.hide();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new DesktopPetApp();
});