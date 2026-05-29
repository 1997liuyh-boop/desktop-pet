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
    // 前景叠加层 (VPet front_lay): 与主动画并行独立循环
    this.frontFrames = [];
    this.frontIndex = 0;
    this.frontAccumulator = 0;
    this.frontDuration = 0;
    this.frontImage = null;
    // 食物中间层 (VPet FoodAnimation): 食物图按关键帧运动 (位置/缩放/旋转/透明度)
    this.foodKeyframes = [];     // [{time,visible,x,y,width,rotate,opacity}]
    this.foodIndex = 0;
    this.foodAccumulator = 0;
    this.foodImage = null;       // 食物图 Image 对象
    this.foodDone = false;       // 关键帧播放一次后定格
  }

  // 设置动画数据
  setPhases(phases) {
    this.phases = {
      a_start: phases.a_start || [],
      b_loop: phases.b_loop || [],
      c_end: phases.c_end || [],
    };
    this.frontFrames = phases.b_loop_front || [];
    this.frontIndex = 0;
    this.frontAccumulator = 0;
    this.frontImage = null;
    if (this.frontFrames.length > 0) this._updateFrontFrame();
    // 食物中间层关键帧 (由 manifest food_anim 提供)
    this.foodKeyframes = phases.food_anim || [];
    this.foodIndex = 0;
    this.foodAccumulator = 0;
    this.foodDone = false;
  }

  // 设置食物图 (吃饭/喝水时由后端返回的 foodImage 提供)
  setFoodImage(img) {
    this.foodImage = img || null;
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
    this.frontIndex = 0;
    this.frontAccumulator = 0;
    this.foodIndex = 0;
    this.foodAccumulator = 0;
    this.foodDone = false;
    this.isPlaying = true;
    this._updateCurrentFrame();
    if (this.frontFrames.length > 0) this._updateFrontFrame();
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
      this._advancePhase();
      return;
    }

    this.accumulator += dt;

    while (this.accumulator >= this.currentDuration && this.isPlaying) {
      this.accumulator -= this.currentDuration;
      this.currentIndex++;

      if (this.currentIndex >= frames.length) {
        if (this.currentPhase === 'b_loop') {
          this.currentIndex = 0;
        } else {
          this._advancePhase();
          return;
        }
      }

      this._updateCurrentFrame();
    }

    // 前景叠加层独立推进
    if (this.frontFrames.length > 0 && this.frontDuration > 0) {
      this.frontAccumulator += dt;
      while (this.frontAccumulator >= this.frontDuration) {
        this.frontAccumulator -= this.frontDuration;
        this.frontIndex = (this.frontIndex + 1) % this.frontFrames.length;
        this._updateFrontFrame();
      }
    }

    // 食物中间层关键帧推进 (单次播放, 播完定格在最后一帧)
    if (this.foodKeyframes.length > 0 && !this.foodDone) {
      this.foodAccumulator += dt;
      let kf = this.foodKeyframes[this.foodIndex];
      while (kf && this.foodAccumulator >= kf.time) {
        this.foodAccumulator -= kf.time;
        this.foodIndex++;
        if (this.foodIndex >= this.foodKeyframes.length) {
          this.foodIndex = this.foodKeyframes.length - 1;
          this.foodDone = true;
          break;
        }
        kf = this.foodKeyframes[this.foodIndex];
      }
    }
  }

  // 当前食物关键帧 (供渲染)
  get currentFoodKeyframe() {
    if (!this.foodKeyframes.length || !this.foodImage) return null;
    return this.foodKeyframes[Math.min(this.foodIndex, this.foodKeyframes.length - 1)];
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

  _updateFrontFrame() {
    if (!this.frontFrames.length) { this.frontImage = null; return; }
    const frame = this.frontFrames[this.frontIndex % this.frontFrames.length];
    if (!frame) return;
    this.frontDuration = frame.duration;
    this.frontImage = frameCache.get(frame.file) || null;
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
    if (!this.visible) { this._hideSubmenu(); this.app._toolbarActive = false; }
    else { this.app._toolbarActive = true; }
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
    this._hideSubmenu();
    this._hidePanel();
    this.app._toolbarActive = false;
  }

  // ── 子菜单 ──

  _showFeedSub(anchor) {
    this._showSubmenu(anchor, [
      { label: '🍱 食物菜单', action: () => this._showFoodMenu(anchor) },
      { label: '🍚 随机吃', action: () => this.app._handleFeed() },
      { label: '🥤 随机喝', action: () => this.app._handleDrink() },
    ]);
  }

  // 食物菜单弹窗 — 按 食物 / 饮料 分组列出全部可吃条目及其效果
  async _showFoodMenu(anchor) {
    this._hideSubmenu();
    let data;
    try {
      data = await invoke('get_food_menu', {});
    } catch (_) {
      this.app.showBubble('菜单加载失败', 1500);
      return;
    }
    const items = (data && data.items) ? data.items : [];
    const foods = items.filter(it => it.graph === 'eat');
    const drinks = items.filter(it => it.graph === 'drink');

    // 遮罩层 — 点击空白处关闭
    const mask = document.createElement('div');
    Object.assign(mask.style, {
      position: 'fixed', inset: '0', zIndex: '10000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.35)',
    });

    // 弹窗主体
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: '420px', maxHeight: '70vh', overflowY: 'auto',
      background: 'rgba(24,24,28,0.97)',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '10px', padding: '14px 16px',
      fontFamily: '"Microsoft YaHei", sans-serif', color: '#e0e0e0',
      boxShadow: '0 6px 32px rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)',
    });
    panel.addEventListener('mousedown', (e) => e.stopPropagation());

    // 标题栏 + 关闭按钮
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: '10px',
    });
    const title = document.createElement('div');
    title.textContent = '🍱 食物菜单';
    Object.assign(title.style, { fontSize: '16px', fontWeight: 'bold' });
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, { cursor: 'pointer', fontSize: '14px', padding: '2px 6px', color: '#aaa' });
    closeBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); mask.remove(); });
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // 渲染一个分组
    const renderGroup = (groupTitle, list) => {
      if (!list.length) return;
      const gt = document.createElement('div');
      gt.textContent = groupTitle;
      Object.assign(gt.style, {
        fontSize: '13px', color: '#ffb86c', margin: '8px 0 4px', fontWeight: 'bold',
      });
      panel.appendChild(gt);

      list.forEach(it => {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex', flexDirection: 'column',
          padding: '7px 10px', margin: '3px 0',
          borderRadius: '6px', cursor: 'pointer',
          background: 'rgba(255,255,255,0.04)',
        });
        row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.12)'; });
        row.addEventListener('mouseleave', () => { row.style.background = 'rgba(255,255,255,0.04)'; });

        const nameLine = document.createElement('div');
        Object.assign(nameLine.style, { display: 'flex', justifyContent: 'space-between', fontSize: '13px' });
        const nm = document.createElement('span');
        nm.textContent = it.name;
        nm.style.fontWeight = 'bold';
        const pr = document.createElement('span');
        pr.textContent = '¥' + it.price;
        pr.style.color = '#8be9fd';
        nameLine.appendChild(nm);
        nameLine.appendChild(pr);

        // 效果明细 — 仅显示非零项
        const eff = document.createElement('div');
        Object.assign(eff.style, { fontSize: '11px', color: '#9aa0a6', marginTop: '3px' });
        const parts = [];
        const push = (label, val) => { if (val) parts.push(`${label}${val > 0 ? '+' : ''}${val}`); };
        push('饱腹', it.strengthFood);
        push('口渴', it.strengthDrink);
        push('体力', it.strength);
        push('心情', it.feeling);
        push('健康', it.health);
        push('经验', it.exp);
        eff.textContent = parts.join('  ');

        row.appendChild(nameLine);
        row.appendChild(eff);
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          mask.remove();
          this.app._handleEatFood(it.name);
        });
        panel.appendChild(row);
      });
    };

    renderGroup('🍚 食物', foods);
    renderGroup('🥤 饮料', drinks);

    mask.addEventListener('mousedown', () => mask.remove());
    document.body.appendChild(mask);
    mask.appendChild(panel);
  }

  _showInteractSub(anchor) {
    this._showSubmenu(anchor, [
      { label: '😴 睡觉', action: () => this._handleSleep() },
      { label: '📖 学习', action: () => this.app._handleWork('study') },
      { label: '💼 打工', action: () => this.app._handleWork('work') },
      { label: '🧹 打扫', action: () => this.app._handleWork('clean') },
      { label: '🎨 绘画', action: () => this.app._handleWork('painting') },
      { label: '🎮 玩耍', action: () => this.app._handlePlay() },
      { label: '💬 聊天', action: () => this.app._openChat() },
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
    this._toolbarActive = false;   // 工具栏或子菜单打开时禁止侧边隐藏/行走

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

      // 2. 加载默认动画帧信息 (最多重试3次，防止偶发网络/IPC延迟)
      let loadOk = false;
      for (let attempt = 0; attempt < 3 && !loadOk; attempt++) {
        try {
          await this._loadAnimation(this.graphType, this.mode);
          loadOk = true;
        } catch (e) {
          console.warn(`动画加载第${attempt+1}次失败:`, e);
          if (attempt < 2) await new Promise(r => setTimeout(r, 300));
        }
      }
      if (!loadOk) throw new Error('默认动画加载失败，请检查资源路径');

      // 3. 绑定交互事件
      this._bindEvents();

      // 4. 游戏时钟 — 每秒推进一次
      this._sideHideCheckInterval = setInterval(() => this._checkSideHide(), 2000);

      let tickCount = 0;
      this._tickInterval = setInterval(() => {
        invoke('game_tick', { dtSeconds: 1.0 }).then((result) => {
          if (result.working) {
            // 工作期间维持该工种专属动画 (study / workone / playone ...)
            this._wasWorking = true;
            if (result.graphType && this.graphType !== result.graphType && !this._manualAnimLock) {
              this.playAnimation(result.graphType, result.mood || 'normal');
            }
          } else {
            // 工作完成 → 恢复 default
            if (result.workFinished || this._wasWorking) {
              this._wasWorking = false;
              this._manualAnimLock = false;
              if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
              this.playAnimation('default', result.mood || 'normal');
              if (result.workFinished) this.showBubble('工作完成!', 3000);
            }
            // 非工作状态下处理 mood 变化
            if (result.mood && result.mood !== this.mode && !this._manualAnimLock) {
              this.mode = result.mood;
              this.playAnimation(result.graphType || this.graphType, result.mood);
            }
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

      // 监听聊天窗口的 AI 回复，在宠物气泡中同步显示
      window.__TAURI__.event.listen('chat-reply', (e) => {
        if (e.payload) this.showBubble(e.payload, Math.max(3000, e.payload.length * 80));
      }).catch(() => {});

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

  // ── 聊天窗口 ──

  async _openChat() {
    this._toolbar.hide();
    // 防止工具栏关闭后侧边隐藏/行走立即恢复，给聊天窗口打开留出缓冲
    this._toolbarActive = true;

    try {
      await invoke('open_chat_window', {});
      // 重新置顶宠物窗口 (JS 侧)，确保聊天窗口不盖住宠物
      window.__TAURI__.window.getCurrent().setAlwaysOnTop(true).catch(() => {});
    } catch (e) {
      this.showBubble('无法打开聊天窗口', 2000);
    }

    // 1.5 秒后恢复行走/侧边隐藏
    setTimeout(() => { this._toolbarActive = false; }, 1500);
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
      maxWidth: '260px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      lineHeight: '1.5',
      textAlign: 'center',
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

    // 收集所有帧路径 (含前景叠加层)
    const allPaths = [];
    for (const phase of ['a_start', 'b_loop', 'c_end', 'b_loop_front']) {
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

    // 食物中间层: 加载并设置食物图 (吃饭/喝水时传入), 否则清除
    if (options.foodImage) {
      try {
        await preloadFrames([options.foodImage]);
        this.player.setFoodImage(frameCache.get(options.foodImage) || null);
      } catch (e) {
        console.warn('食物图加载失败:', e);
        this.player.setFoodImage(null);
      }
    } else {
      this.player.setFoodImage(null);
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
      if (result.showBubble) this.showBubble(result.showBubble, 2500);
      // 强制清除并发锁，确保吃饭动画不被行走tick阻断
      this._animatingLock = false;
      await this.playAnimation(result.graphType || 'eat', result.mood || 'normal', null, { foodImage: result.foodImage });
      // 吃完后4秒自动回到默认动画
      setTimeout(() => {
        if (this.graphType === 'eat') {
          this._manualAnimLock = false;
          if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
          this.playAnimation('default', this.mode);
        }
      }, 4000);
      if (result.message) console.log('[Pet]:', result.message);
    } catch(e) { this.showBubble('吃不了...', 2000); }
  }

  async _handleDrink() {
    try {
      const result = await invoke('pet_action_drink', {});
      if (result.showBubble) this.showBubble(result.showBubble, 2500);
      // 强制清除并发锁
      this._animatingLock = false;
      await this.playAnimation(result.graphType || 'drink', result.mood || 'normal', null, { foodImage: result.foodImage });
      // 喝完后4秒自动回到默认动画
      setTimeout(() => {
        if (this.graphType === 'drink') {
          this._manualAnimLock = false;
          if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
          this.playAnimation('default', this.mode);
        }
      }, 4000);
      if (result.message) console.log('[Pet]:', result.message);
    } catch(e) { this.showBubble('喝不了...', 2000); }
  }

  // 从食物菜单选定具体食物 — 调后端 pet_action_eat, 播放对应三层动画
  async _handleEatFood(name) {
    try {
      const result = await invoke('pet_action_eat', { foodName: name });
      if (result.showBubble) this.showBubble(result.showBubble, 2500);
      // 强制清除并发锁, 确保动画不被行走tick阻断
      this._animatingLock = false;
      const graph = result.graphType || 'eat';
      await this.playAnimation(graph, result.mood || 'normal', null, { foodImage: result.foodImage });
      // 吃/喝完4秒后自动回到默认动画
      setTimeout(() => {
        if (this.graphType === graph) {
          this._manualAnimLock = false;
          if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
          this.playAnimation('default', this.mode);
        }
      }, 4000);
      if (result.message) console.log('[Pet]:', result.message);
    } catch(e) { this.showBubble('吃不了...', 2000); }
  }

  async _handlePlay() {
    try {
      const result = await invoke('pet_action_play', {});
      if (result.graphType) this.playAnimation(result.graphType, result.mood || 'normal');
      // 显示玩耍明细 (名称 + 时长), 与学习/打工保持一致
      if (result.workStarted) {
        const name = result.workName ? result.workName : '玩耍';
        this.showBubble(`开始${name}! (${Math.round(result.duration)}s)`, 3000);
      } else if (result.message) {
        this.showBubble(result.message, 2500);
      }
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
        const name = result.workName ? result.workName : '工作';
        this.showBubble(`开始${name}! (${Math.round(result.duration)}s)`, 3000);
        if (result.graphType) this.playAnimation(result.graphType, 'normal');
      } else if (result.message) {
        this.showBubble(result.message, 2500);
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

    // VPet 食物中间层 (FoodAnimation): 绘制在后层身体之上、前层爪子之下
    // 关键帧坐标基于 VPet 500x500 食物网格, 按画布尺寸等比映射
    const foodKf = this.player.currentFoodKeyframe;
    const foodImg = this.player.foodImage;
    if (foodKf && foodKf.visible && foodImg) {
      const s = W / 500;
      const fw = foodKf.width * s;
      const fh = foodKf.width * s;
      const cx = foodKf.x * s + fw / 2;  // 关键帧 x/y 为左上角偏移
      const cy = foodKf.y * s + fh / 2;
      ctx.save();
      ctx.globalAlpha = foodKf.opacity;
      ctx.translate(cx, cy);
      ctx.rotate((foodKf.rotate * Math.PI) / 180);  // 绕食物中心旋转
      ctx.drawImage(foodImg, -fw / 2, -fh / 2, fw, fh);
      ctx.restore();
    }

    // VPet 前景叠加层 (front_lay): 绘制在主帧上方
    const frontImg = this.player.frontImage;
    if (frontImg) {
      const fs = Math.min(W / frontImg.naturalWidth, H / frontImg.naturalHeight);
      const fdw = frontImg.naturalWidth * fs;
      const fdh = frontImg.naturalHeight * fs;
      const fdx = (W - fdw) / 2;
      const fdy = (H - fdh) / 2;
      ctx.drawImage(frontImg, fdx, fdy, fdw, fdh);
    }

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
    if (this._toolbarActive) return;  // 工具栏打开时暂停行走
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
    if (this._dragging || this._manualAnimLock || this._toolbarActive) return;
    if (this.chatUI && this.chatUI._isSending) return;
    // 聊天/设置窗口打开时暂停侧边隐藏, 防止宠物被滑出屏幕
    try {
      if (await invoke('aux_window_visible', {})) return;
    } catch (_) { /* 命令不可用时忽略 */ }
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
      position: 'fixed', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '320px', height: '420px',
      background: 'rgba(255,255,255,0.97)',
      borderRadius: '14px',
      display: 'none', flexDirection: 'column',
      fontFamily: '"Microsoft YaHei", sans-serif',
      fontSize: '13px', color: '#333',
      zIndex: '200', backdropFilter: 'blur(12px)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      overflow: 'hidden',
    });

    // 标题栏
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 14px',
      background: 'linear-gradient(135deg, #ff9800, #ffb74d)',
      color: '#fff', fontSize: '13px', fontWeight: 'bold',
      flexShrink: '0',
    });
    const title = document.createElement('span');
    title.textContent = '💬 聊天';
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    closeBtn.title = '关闭 (Esc)';
    Object.assign(closeBtn.style, {
      cursor: 'pointer', fontSize: '20px', lineHeight: '1',
      color: 'rgba(255,255,255,0.8)', padding: '0 2px',
    });
    closeBtn.addEventListener('click', () => this.hide());
    closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = '#fff');
    closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = 'rgba(255,255,255,0.8)');
    header.appendChild(title);
    header.appendChild(closeBtn);
    this.el.appendChild(header);

    this.msgArea = document.createElement('div');
    Object.assign(this.msgArea.style, {
      flex: '1', overflowY: 'auto', padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: '6px',
    });
    this.el.appendChild(this.msgArea);

    const inputRow = document.createElement('div');
    Object.assign(inputRow.style, {
      display: 'flex', padding: '8px 10px', gap: '6px',
      borderTop: '1px solid rgba(0,0,0,0.06)',
      flexShrink: '0',
    });

    this.input = document.createElement('input');
    Object.assign(this.input.style, {
      flex: '1', background: '#f5f5f5', border: '1px solid rgba(0,0,0,0.1)',
      borderRadius: '18px', padding: '7px 12px', color: '#333',
      outline: 'none', fontSize: '12px',
      fontFamily: '"Microsoft YaHei", sans-serif',
    });
    this.input.placeholder = '说点什么...';

    const sendBtn = document.createElement('button');
    sendBtn.textContent = '发送';
    Object.assign(sendBtn.style, {
      background: 'linear-gradient(135deg, #ff9800, #ffb74d)',
      border: 'none', borderRadius: '18px', padding: '7px 14px',
      color: '#fff', cursor: 'pointer', fontSize: '12px',
      fontFamily: '"Microsoft YaHei", sans-serif',
      flexShrink: '0',
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
      // 必须先 await 注册监听器, 否则流式事件会早于监听器注册而丢失
      const unlistenChunk = await window.__TAURI__.event.listen('llm-stream-chunk', (event) => {
        fullText += event.payload;
        bubble.el.textContent = fullText;
        this.msgArea.scrollTop = this.msgArea.scrollHeight;
      });
      const unlistenDone = await window.__TAURI__.event.listen('llm-stream-done', (event) => {
        const final = event.payload || fullText;
        bubble.el.textContent = final;
        this._isSending = false;
        // AI回复同步显示在宠物气泡上
        if (final) this.app.showBubble(final, Math.max(3000, final.length * 80));
      });

      const newHistory = await invoke('chat_stream', {
        message: msg, config, systemPrompt: prompt, history: this.history,
      });
      this.history = newHistory;

      setTimeout(() => {
        unlistenChunk(); unlistenDone();
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
      padding: '8px 12px', borderRadius: isUser ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
      maxWidth: '85%', wordBreak: 'break-word', lineHeight: '1.5',
      alignSelf: isUser ? 'flex-end' : 'flex-start',
      background: isUser ? '#e3f2fd' : '#fff3e0',
      color: isUser ? '#1565c0' : '#e65100',
      fontSize: '12px',
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