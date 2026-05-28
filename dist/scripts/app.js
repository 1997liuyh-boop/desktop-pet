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

// ── VPet 风格底部工具栏 ──

class ToolBar {
  constructor(app) {
    this.app = app;
    this.visible = false;
    this._submenuEl = null;
    this._panelEl = null;
    this._build();
  }

  _build() {
    // 主工具栏容器
    this.el = document.createElement('div');
    this.el.id = 'pet-toolbar';
    Object.assign(this.el.style, {
      position: 'fixed',
      bottom: '0',
      left: '0',
      right: '0',
      height: '42px',
      zIndex: '9998',
      display: 'none',
      background: 'rgba(20,20,20,0.92)',
      borderTop: '1px solid rgba(255,255,255,0.1)',
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontSize: '13px',
      color: '#d0d0d0',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      backdropFilter: 'blur(8px)',
    });

    const cols = [
      { id: 'feed',    label: '投喂',  hasSub: true },
      { id: 'panel',   label: '面板',  hasSub: false, hover: true },
      { id: 'interact',label: '互动',  hasSub: true },
      { id: 'diy',     label: '自定',  hasSub: false },
      { id: 'system',  label: '系统',  hasSub: true },
    ];

    cols.forEach(col => {
      const tab = document.createElement('div');
      tab.className = 'tb-tab';
      tab.textContent = col.label;
      Object.assign(tab.style, {
        flex: '1',
        textAlign: 'center',
        lineHeight: '42px',
        cursor: 'pointer',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        transition: 'background 0.15s',
      });

      tab.addEventListener('mouseenter', () => { tab.style.background = 'rgba(255,255,255,0.08)'; });
      tab.addEventListener('mouseleave', () => { tab.style.background = ''; });

      tab.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (col.id === 'feed') { this._showFeedSub(tab); }
        else if (col.id === 'interact') { this._showInteractSub(tab); }
        else if (col.id === 'system') { this._showSystemSub(tab); }
        else if (col.id === 'diy') { this.app.showBubble('暂无自定功能', 1500); }
        else if (col.id === 'panel') { /* hover 触发 */ }
      });

      if (col.hover) {
        tab.addEventListener('mouseenter', () => { this._showPanel(tab); });
        tab.addEventListener('mouseleave', () => { this._hidePanel(); });
      }

      this.el.appendChild(tab);
    });

    document.body.appendChild(this.el);

    // 全局点击关闭子菜单
    document.addEventListener('mousedown', (e) => {
      if (this._submenuEl && !this._submenuEl.contains(e.target) && !this.el.contains(e.target)) {
        this._hideSubmenu();
      }
    });
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'flex' : 'none';
    if (!this.visible) this._hideSubmenu();
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
    this._hideSubmenu();
    this._hidePanel();
  }

  // ── 子菜单 ──

  _showFeedSub(anchor) {
    this._showSubmenu(anchor, [
      { label: '🍚 吃饭', action: () => this.app._handleFeed() },
      { label: '🥤 喝水', action: () => this.app._handleDrink() },
    ]);
  }

  _showInteractSub(anchor) {
    this._showSubmenu(anchor, [
      { label: '😴 睡觉', action: () => this._handleSleep() },
      { label: '📖 学习', action: () => this.app._handleWork('study') },
      { label: '💼 打工', action: () => this.app._handleWork('work') },
      { label: '🧹 打扫', action: () => this.app._handleWork('clean') },
      { label: '🎨 绘画', action: () => this.app._handleWork('painting') },
      { label: '🎮 玩耍', action: () => this.app._handlePlay() },
      { label: '💬 聊天', action: () => this.app.chatUI.toggle() },
    ]);
  }

  _showSystemSub(anchor) {
    this._showSubmenu(anchor, [
      { label: '⚙ 设置', action: () => this.app.settingsUI.show() },
      { label: '🚪 退出', action: () => { if (confirm('确定要退出桌宠吗？')) invoke('quit_app', {}); } },
    ]);
  }

  _showSubmenu(anchor, items) {
    this._hideSubmenu();
    const menu = document.createElement('div');
    menu.className = 'tb-submenu';
    Object.assign(menu.style, {
      position: 'fixed',
      bottom: '48px',
      left: anchor.getBoundingClientRect().left + 'px',
      zIndex: '9999',
      background: 'rgba(20,20,20,0.95)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '6px',
      padding: '4px 0',
      minWidth: '120px',
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontSize: '12px',
      color: '#d0d0d0',
      boxShadow: '0 2px 16px rgba(0,0,0,0.5)',
      backdropFilter: 'blur(10px)',
    });

    items.forEach(item => {
      const row = document.createElement('div');
      row.textContent = item.label;
      Object.assign(row.style, {
        padding: '6px 14px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      });
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.1)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._hideSubmenu();
        item.action();
      });
      menu.appendChild(row);
    });

    document.body.appendChild(menu);
    this._submenuEl = menu;
  }

  _hideSubmenu() {
    if (this._submenuEl) {
      this._submenuEl.remove();
      this._submenuEl = null;
    }
  }

  // ── 状态面板 (hover) ──

  async _showPanel(anchor) {
    this._hidePanel();
    try {
      const status = await invoke('get_pet_status', {});
      const s = status.stats;
      const panel = document.createElement('div');
      panel.className = 'tb-panel';
      Object.assign(panel.style, {
        position: 'fixed',
        bottom: '48px',
        left: anchor.getBoundingClientRect().left + 'px',
        zIndex: '9999',
        background: 'rgba(20,20,20,0.95)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '8px',
        padding: '10px 14px',
        minWidth: '160px',
        fontFamily: '"Microsoft YaHei", sans-serif',
        fontSize: '12px',
        color: '#d0d0d0',
        boxShadow: '0 2px 16px rgba(0,0,0,0.5)',
      });

      const rows = [
        `等级: Lv.${s.level}  | 金币: 💰${s.money.toFixed(1)}`,
        `经验: ${s.exp}/${s.level * 100}`,
        `体力: ${this._bar(s.energy)}`,
        `心情: ${this._bar(s.happiness)}`,
        `饱腹: ${this._bar(s.hunger)}`,
        `口渴: ${this._bar(s.thirst)}`,
        `健康: ${this._bar(s.health)}`,
      ];
      panel.innerHTML = rows.map(r => `<div style="margin:3px 0">${r}</div>`).join('');

      document.body.appendChild(panel);
      this._panelEl = panel;
    } catch (_) {}
  }

  _bar(val) {
    const n = Math.round(val / 10);
    return '█'.repeat(n) + '░'.repeat(10 - n) + ` ${val.toFixed(0)}%`;
  }

  _hidePanel() {
    if (this._panelEl) {
      this._panelEl.remove();
      this._panelEl = null;
    }
  }

  // ── 睡觉 ──

  _handleSleep() {
    invoke('pet_action_sleep', {}).then((result) => {
      if (result.sleepToggled) {
        if (result.isSleeping) {
          this.app.playAnimation('sleep', this.app.mode);
          this.app.showBubble('晚安 Zzz...', 2000);
        } else {
          this.app.playAnimation('default', this.app.mode);
          this.app.showBubble('起床啦!', 1500);
        }
      } else if (result.message) {
        this.app.showBubble(result.message, 1500);
      }
    }).catch(() => {
      this.app.playAnimation('sleep', this.app.mode);
      this.app.showBubble('晚安 Zzz...', 2000);
    });
    this.hide();
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
    this._lastClickTime = 0;       // 点击防抖
    this._hoveredPart = null;  // 'head' | 'body' | null

    this._toolbar = new ToolBar(this);

    // 行走状态
    this._facingRight = true;
    this._walkTimer = null;
    this._walkGraphType = 'default';
    this._manualAnimLock = false;  // 手动交互(喂食/摸头)时锁住, 防止被行走覆盖
    this._manualAnimTimer = null;  // 手动动画锁定定时器句柄
    this._animatingLock = false;   // 防止并发 playAnimation
    this._clickthroughEnabled = false;  // 当前是否已启用点击穿透

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
          // 工作期间强制保持 work 动画
          if (result.graphType === 'work' && this.graphType !== 'work' && !this._manualAnimLock) {
            this.playAnimation('work', 'normal');
          }
          // 工作完成 → 恢复 default
          if (result.workFinished && this.graphType === 'work') {
            this._manualAnimLock = false;
            if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
            this.playAnimation('default', result.mood || 'normal');
            this.showBubble('工作完成!', 3000);
          }
          // 非工作状态下处理 mood 变化
          if (result.graphType !== 'work' && result.mood && result.mood !== this.mode && !this._manualAnimLock) {
            this.mode = result.mood;
            this.playAnimation(result.graphType || this.graphType, result.mood);
          }
          if (result.leveledUp) this.showBubble('升级啦!', 3000);
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

      // 4.6 点击穿透轮询 — 每 150ms 检测鼠标是否在宠物精灵上
      this._clickthroughInterval = setInterval(() => this._checkClickthrough(), 150);

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
  // options: { autoEndLoops?: number } - 自动在 N 次 b_loop 后触发 c_end
  async playAnimation(graphType, mode, onComplete, options = {}) {
    // 防止并发: 如果正在切换动画则跳过
    if (this._animatingLock) return;
    this._animatingLock = true;

    // 清除上一个手动动画锁定时器
    if (this._manualAnimTimer) {
      clearTimeout(this._manualAnimTimer);
      this._manualAnimTimer = null;
    }

    // 锁定手动动画，防止闲置行为覆盖
    this._manualAnimLock = true;
    const lockDuration = (options.autoEndLoops || 0) > 0 ? (options.autoEndLoops * 1000 + 2000) : 4000;
    this._manualAnimTimer = setTimeout(() => {
      this._manualAnimLock = false;
      this._manualAnimTimer = null;
    }, lockDuration);

    try {
      await this._loadAnimation(graphType, mode);
    } catch (e) {
      console.warn('加载动画失败:', e);
    }

    // 自动触发 c_end (用于 pinch 等有结束动画的动作)
    if (options.autoEndLoops && options.autoEndLoops > 0) {
      const loops = options.autoEndLoops;
      let loopCount = 0;
      const origUpdate = this.player.update.bind(this.player);
      // 在 b_loop 阶段计数，达到次数后触发 c_end
      const checkInterval = setInterval(() => {
        if (this.player.currentPhase === 'b_loop' && this.player.isPlaying) {
          // 通过监听 phase 切换来计数
          loopCount++;
          if (loopCount >= loops) {
            clearInterval(checkInterval);
            this.player.triggerEnd(() => {
              this._manualAnimLock = false;
              if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
              if (onComplete) onComplete();
            });
          }
        }
      }, 800); // pinch b_loop 约 750ms, 检查间隔略大于一个循环
    }

    if (onComplete && !options.autoEndLoops) {
      const origComplete = this.player.onComplete;
      this.player.onComplete = () => {
        if (origComplete) origComplete();
        this._manualAnimLock = false;
        if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
        onComplete();
      };
    }

    this._animatingLock = false;
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

    // 右键菜单 — 切换底部工具栏
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._toolbar.toggle();
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

    // 防抖: 300ms 内不允许重复点击 (防止多次点击导致 Rust 锁竞争)
    if (this._lastClickTime && performance.now() - this._lastClickTime < 300) return;
    this._lastClickTime = performance.now();

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
      if (result.showBubble) this.showBubble(result.showBubble, 2000);
      if (result.message) console.log('[Pet]:', result.message);
    } catch(e) { this.showBubble('吃不了...', 2000); }
  }

  async _handleDrink() {
    try {
      const result = await invoke('pet_action_drink', {});
      if (result.graphType) this.playAnimation(result.graphType, result.mood || 'normal');
      if (result.showBubble) this.showBubble(result.showBubble, 2000);
      if (result.message) console.log('[Pet]:', result.message);
    } catch(e) { this.showBubble('喝不了...', 2000); }
  }

  async _handlePlay() {
    try {
      const result = await invoke('pet_action_play', {});
      if (result.graphType) this.playAnimation(result.graphType, result.mood || 'normal');
      if (result.workStarted) this.showBubble(`来玩吧! (${Math.round(result.duration)}s)`, 3000);
      if (result.message) console.log('[Pet]:', result.message);
    } catch(e) { this.playAnimation('default', 'happy'); }
  }

  async _handlePinch() {
    try {
      const result = await invoke('pet_action_pinch', {});
      if (result.graphType) {
        // pinch 有 a_start → b_loop → c_end, 播 3 次 b_loop 后自动关闭
        this.playAnimation(result.graphType, result.mood || 'normal', () => {
          this.playAnimation('default', this.mode);
        }, { autoEndLoops: 3 });
      }
      if (result.message) this.showBubble(result.message, 2000);
    } catch(e) { this.showBubble('捏不到喵~', 2000); }
  }

  async _handleWork(type) {
    try {
      const result = await invoke('pet_action_work', { workType: type });
      if (result.workStarted) {
        this.showBubble(`开始工作! (${Math.round(result.duration)}s)`, 3000);
        if (result.graphType) this.playAnimation(result.graphType, 'normal');
      }
    } catch(e) { console.warn('工作启动失败:', e); }
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
    // 聊天进行中不移动
    if (this.chatUI && this.chatUI._isSending) return;
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

  // ── 点击穿透 ──
  // 轮询检测鼠标是否在宠物精灵非透明像素上，动态切换窗口点击穿透

  async _checkClickthrough() {
    if (this._dragging) return; // 拖拽中不切换

    try {
      const [pos, cursorPos] = await Promise.all([
        invoke('get_window_position', {}),
        window.__TAURI__.window.getCurrent().cursorPosition().catch(() => null),
      ]);
      if (!cursorPos || !pos) return;

      // 光标是否在窗口范围内
      const inWindow =
        cursorPos.x >= pos.x && cursorPos.x <= pos.x + pos.width &&
        cursorPos.y >= pos.y && cursorPos.y <= pos.y + pos.height;

      if (!inWindow) {
        // 光标不在窗口上 → 开启穿透
        if (!this._clickthroughEnabled) {
          this._clickthroughEnabled = true;
          invoke('set_clickthrough', { enabled: true }).catch(() => {});
        }
        return;
      }

      // 光标在窗口上 → 检查 canvas 像素
      const cx = cursorPos.x - pos.x;
      const cy = cursorPos.y - pos.y;

      // 检查精灵大致区域 (命中检测椭圆包围盒: x 130~370, y 80~440)
      const inSpriteBounds = cx >= 120 && cx <= 380 && cy >= 70 && cy <= 450;

      if (!inSpriteBounds) {
        // 光标在透明边缘 → 开启穿透
        if (!this._clickthroughEnabled) {
          this._clickthroughEnabled = true;
          invoke('set_clickthrough', { enabled: true }).catch(() => {});
        }
        return;
      }

      // 像素级检测
      let hasPixel = false;
      try {
        const pixelData = this.ctx.getImageData(Math.round(cx), Math.round(cy), 1, 1);
        hasPixel = pixelData && pixelData.data[3] > 10; // alpha > 10
      } catch (_) {
        hasPixel = true; // 读取出错则保守处理
      }

      if (hasPixel) {
        // 光标在精灵像素上 → 关闭穿透 (可交互)
        if (this._clickthroughEnabled) {
          this._clickthroughEnabled = false;
          invoke('set_clickthrough', { enabled: false }).catch(() => {});
        }
      } else {
        // 透明像素 → 开启穿透
        if (!this._clickthroughEnabled) {
          this._clickthroughEnabled = true;
          invoke('set_clickthrough', { enabled: true }).catch(() => {});
        }
      }
    } catch (_) { /* 静默 */ }
  }

  // ── SideHide 边缘检测 ──

  async _checkSideHide() {
    if (this._dragging || this._manualAnimLock) return;
    if (this.chatUI && this.chatUI._isSending) return;
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
    this._isSending = false;   // 是否正在等待AI回复
    this._buildDom();
    this._bindEvents();
  }

  get isVisible() {
    return this.el.style.display === 'flex';
  }

  _buildDom() {
    this.el = document.createElement('div');
    this.el.id = 'chat-panel';
    Object.assign(this.el.style, {
      position: 'fixed', top: '0', left: '50%', transform: 'translateX(-50%)',
      width: '280px', maxHeight: '160px',
      background: 'rgba(20,20,20,0.85)',
      borderBottomLeftRadius: '10px',
      borderBottomRightRadius: '10px',
      display: 'none', flexDirection: 'column',
      fontFamily: 'sans-serif', fontSize: '12px', color: '#e0e0e0',
      zIndex: '100', backdropFilter: 'blur(10px)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
    });

    // 标题栏 (含关闭按钮)
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '4px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)',
      fontSize: '12px', color: '#999',
    });
    const title = document.createElement('span');
    title.textContent = '聊天';
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    closeBtn.title = '关闭 (Esc)';
    Object.assign(closeBtn.style, {
      cursor: 'pointer', fontSize: '16px', lineHeight: '1',
      color: '#888', padding: '0 4px',
    });
    closeBtn.addEventListener('click', () => this.hide());
    closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = '#fff');
    closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = '#888');
    header.appendChild(title);
    header.appendChild(closeBtn);
    this.el.appendChild(header);

    this.msgArea = document.createElement('div');
    Object.assign(this.msgArea.style, {
      flex: '1', overflowY: 'auto', padding: '4px 10px',
      display: 'flex', flexDirection: 'column', maxHeight: '100px',
    });
    this.el.appendChild(this.msgArea);

    const inputRow = document.createElement('div');
    Object.assign(inputRow.style, {
      display: 'flex', padding: '4px 8px', gap: '4px',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    });

    this.input = document.createElement('input');
    Object.assign(this.input.style, {
      flex: '1', background: 'rgba(255,255,255,0.08)', border: 'none',
      borderRadius: '6px', padding: '4px 8px', color: '#e0e0e0',
      outline: 'none', fontSize: '12px',
    });
    this.input.placeholder = '说点什么...';

    const sendBtn = document.createElement('button');
    sendBtn.textContent = '发送';
    Object.assign(sendBtn.style, {
      background: 'rgba(100,150,255,0.3)', border: 'none',
      borderRadius: '6px', padding: '4px 10px', color: '#d0d8ff',
      cursor: 'pointer', fontSize: '12px',
    });
    this.sendBtn = sendBtn;

    inputRow.appendChild(this.input);
    inputRow.appendChild(sendBtn);
    this.el.appendChild(inputRow);
    document.body.appendChild(this.el);
  }

  _bindEvents() {
    this.sendBtn.addEventListener('click', () => this._send());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._send();
      if (e.key === 'Escape') this.hide();
    });
    // 全局 Esc
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) this.hide();
    });
  }

  show() {
    this.el.style.display = 'flex';
    this.input.focus();
  }

  hide() {
    this.el.style.display = 'none';
    this._isSending = false;
  }

  toggle() {
    if (this.isVisible) { this.hide(); } else { this.show(); }
  }

  async _send() {
    const msg = this.input.value.trim();
    if (!msg || this._isSending) return;
    this.input.value = '';
    this._isSending = true;

    this._addBubble('user', msg);
    const bubble = this._addBubble('assistant', '...');

    try {
      const config = await invoke('load_llm_config', {});
      if (!config.api_key) { bubble.el.textContent = '请先在设置中配置 API Key'; this._isSending = false; return; }

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
        this._isSending = false;
      });

      const newHistory = await invoke('chat_stream', {
        message: msg, config, systemPrompt: prompt, history: this.history,
      });
      this.history = newHistory;

      setTimeout(() => {
        unlistenChunk.then(fn => fn()); unlistenDone.then(fn => fn());
      }, 500);
    } catch (e) {
      const errMsg = typeof e === 'string' ? e : (e?.message || e?.toString() || JSON.stringify(e) || '未知错误');
      bubble.el.textContent = `请求失败: ${errMsg}`;
      console.error('Chat error:', e);
      this._isSending = false;
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
// 设置窗口已改为独立 Tauri 窗口 (centered, decorated, draggable)

class SettingsUI {
  constructor(app) {
    this.app = app;
  }

  async show() {
    try {
      await invoke('open_settings_window', {});
    } catch (e) {
      console.warn('打开设置窗口失败:', e);
      this.app.showBubble('无法打开设置窗口', 2000);
    }
  }

  hide() {}
}

window.addEventListener('DOMContentLoaded', () => {
  new DesktopPetApp();
});