// Desktop Pet — Tauri v2 前端入口
// 阶段2: VPet 真实 PNG 帧渲染管线

const { invoke } = window.PetRuntime;
const INTERACTION_STORAGE_KEY = 'desktop-pet:interaction-state:v1';
const INTERACTION_HISTORY_LIMIT = 30;
const MUSIC_CATCH_LEVEL = 0.3;
const MUSIC_SOFT_CATCH_LEVEL = 0.06;
const MUSIC_MAX_LEVEL = 0.7;
const MUSIC_CONFIRM_MS = 3000;
const MUSIC_RELEASE_MS = 3000;
const MUSIC_POLL_MS = 1000;
const MISCHIEF_MIN_MS = 25000;
const MISCHIEF_MAX_MS = 45000;
const CHATTER_AI_INTERVAL_MS = 20000;
const CHATTER_TOPICS = [
  '诗歌和晚风', '人生和远方', '今天的小确幸', '桌面上的宇宙',
  '给主人一句鼓励', '猫猫式哲学', '季节、天气和心情',
  '梦境和现实的边界', '喜欢的颜色和声音', '窗外的世界在想什么',
  '关于时间流逝的感受', '一个让我温暖的瞬间', '如果我能冒险去哪里',
  '食物和幸福的关系', '慢慢长大这件事', '夜晚特别安静的原因',
  '对明天的一个小期待', '世界上最有趣的事', '努力和好好休息',
  '心情今天像什么颜色', '最想去的一个地方', '最近感悟到的一件事',
  '下雨天适合做什么', '月亮和孤独', '小动物的世界观',
  '什么是真正的快乐', '星星和灯光哪个更好看', '如果能变成一朵云',
  '记忆里最香的味道', '一首适合现在的歌', '慢慢变好这件事',
];
const MOUSE_LONG_PRESS_MS = 300;
const MOUSE_DRAG_THRESHOLD_PX = 3;
const PROACTIVE_AI_MIN_MS = 20000;
const PROACTIVE_AI_CONTEXT_MIN_MS = 60000;
const PROACTIVE_SCENE_AI_MIN_MS = 45000;
const PROACTIVE_SCENE_CONTEXT_MIN_MS = 90000;
const PROACTIVE_IDLE_MS = 180000;
const PROACTIVE_SOFT_IDLE_MS = 90000;
const PROACTIVE_SPEECH_MAX_CHARS = 72;

// ── TTS 音频播放 ──
function playBase64Wav(base64) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const doPlay = (buffer) => {
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start(0);
      source.onended = () => audioCtx.close().catch(() => {});
    };
    const decode = () => {
      audioCtx.decodeAudioData(bytes.buffer.slice(0), doPlay,
        (e) => { console.warn('TTS 解码失败:', e); audioCtx.close().catch(() => {}); });
    };
    // WebView2/Chrome 可能在无用户手势时挂起 AudioContext，先 resume 再播
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(decode).catch(() => { decode(); });
    } else {
      decode();
    }
  } catch (e) {
    console.warn('TTS 播放失败:', e);
  }
}

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

    // 食物中间层关键帧推进 (随 b_loop 持续循环，保证每次张口都能看到食物)
    if (this.foodKeyframes.length > 0) {
      this.foodAccumulator += dt;
      let kf = this.foodKeyframes[this.foodIndex];
      while (kf && this.foodAccumulator >= kf.time) {
        this.foodAccumulator -= kf.time;
        this.foodIndex++;
        if (this.foodIndex >= this.foodKeyframes.length) {
          this.foodIndex = 0; // 循环回头，不再定格
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

  // 直接跳到 b_loop (用于拖拽等需要跳过 a_start 的场景)
  goToLoop() {
    if (this.phases.b_loop.length > 0) {
      this.currentPhase = 'b_loop';
      this.currentIndex = 0;
      this.accumulator = 0;
      this._updateCurrentFrame();
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
      { id: 'panel',   label: '面板',  hasSub: false },
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
        else if (col.id === 'panel') { this._showPanel(); }
      });

      if (col.id === 'panel') {
        tab.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this._showPanel(); });
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
    this.app._toolbarActive = false;
  }

  // ── 子菜单 ──

  _createCompactModal(titleText) {
    const mask = document.createElement('div');
    Object.assign(mask.style, {
      position: 'fixed', inset: '0', zIndex: '10000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.30)',
      padding: '8px',
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: 'min(232px, calc(100vw - 16px))',
      maxHeight: 'calc(100vh - 58px)',
      overflowY: 'auto',
      background: 'rgba(24,24,28,0.97)',
      border: '1px solid rgba(255,255,255,0.16)',
      borderRadius: '8px',
      padding: '10px',
      fontFamily: '"Microsoft YaHei", sans-serif',
      color: '#e8e8e8',
      boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
      backdropFilter: 'blur(12px)',
    });
    panel.addEventListener('mousedown', (e) => e.stopPropagation());

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: '8px', gap: '8px',
    });
    const title = document.createElement('div');
    title.textContent = titleText;
    Object.assign(title.style, { fontSize: '13px', fontWeight: 'bold' });
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    Object.assign(closeBtn.style, {
      cursor: 'pointer', fontSize: '16px', lineHeight: '1', color: '#bbb',
      background: 'transparent', border: '0', padding: '2px 4px',
    });
    closeBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); mask.remove(); });
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    mask.addEventListener('mousedown', () => mask.remove());
    document.body.appendChild(mask);
    mask.appendChild(panel);
    this.app._stopUiPointerEvents(mask);
    return { mask, panel };
  }

  _showFeedSub(anchor) {
    const items = [
      { label: '食物',   action: () => this._showFoodMenu('eat') },
      { label: '饮品',   action: () => this._showFoodMenu('drink') },
      { label: '全部投喂', action: () => this._showFoodMenu() },
      { label: '随机吃', action: () => { this.hide(); this.app._handleFeed(); } },
      { label: '随机喝', action: () => { this.hide(); this.app._handleDrink(); } },
    ];
    // 生病时才显示药品入口
    if (this.app.mode === 'ill') {
      items.unshift({ label: '🩺 药品', action: () => this._showFoodMenu('medicine') });
    }
    this._showSubmenu(anchor, items);
  }

  // 食物菜单 — 打开独立弹窗
  async _showFoodMenu(graphFilter = null) {
    this._hideSubmenu();
    try {
      await invoke('open_food_panel', { filter: graphFilter });
    } catch (_) {
      this.app.showBubble('菜单打开失败', 1500);
    }
  }

  // 工作面板 — 打开独立弹窗
  async _showWorkPanel(kind) {
    this._hideSubmenu();
    try {
      await invoke('open_work_panel', { kind: kind || 'work' });
    } catch (_) {
      this.app.showBubble('面板打开失败', 1500);
    }
  }

  _showInteractSub(anchor) {
    const items = [
      { label: '睡觉', action: () => this._handleSleep() },
      { label: '戳脸', action: () => { this.hide(); this.app._handlePinch(); } },
      { label: '玩耍面板', action: () => this._showWorkPanel('play') },
      { label: '工作面板', action: () => this._showWorkPanel('work') },
    ];
    if (this.app._wasWorking) {
      items.push({ label: '停止任务', action: () => { this.hide(); this.app._handleStopWork(); } });
    }
    items.push({ label: '聊天', action: () => { this.hide(); this.app._openChat(); } });
    this._showSubmenu(anchor, items);
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
      bottom: '46px',
      left: Math.min(anchor.getBoundingClientRect().left, Math.max(6, window.innerWidth - 126)) + 'px',
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
    this.app._stopUiPointerEvents(menu);
  }

  _hideSubmenu() {
    if (this._submenuEl) {
      this._submenuEl.remove();
      this._submenuEl = null;
    }
  }

  // ── 状态面板弹窗 — 独立 Tauri 窗口 ──

  async _showPanel() {
    try {
      await invoke('open_status_panel', {});
    } catch (_) {
      this.app.showBubble('面板打开失败', 1500);
    }
  }

  _statRow(label, val) {
    const pct = Math.max(0, Math.min(100, Math.round(val)));
    const color = pct > 60 ? '#4ade80' : pct > 30 ? '#facc15' : '#f87171';
    return `<div style="display:flex;align-items:center;gap:8px">
      <span style="width:28px;font-size:11px;color:#aaa;flex-shrink:0">${label}</span>
      <div style="flex:1;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px"></div>
      </div>
      <span style="width:28px;text-align:right;font-size:11px;color:${color}">${pct}%</span>
    </div>`;
  }

  _barHtml(pct, color = '#4ade80') {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    return `<div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden">
      <div style="width:${p}%;height:100%;background:${color};border-radius:2px"></div>
    </div>`;
  }

  _bar(val) {
    // 纯文本备用 (暂不使用)
    const n = Math.round(val / 10);
    return '█'.repeat(n) + '░'.repeat(10 - n) + ` ${val.toFixed(0)}%`;
  }

  // ── 睡觉 ──

  _handleSleep() {
    invoke('pet_action_sleep', {}).then((result) => {
      if (result.sleepToggled) {
        if (result.isSleeping) {
          this.app._manualSleepMode = true;
          this.app.playAnimation('sleep', this.app.mode);
          this.app._manualAnimLock = true;
          if (this.app._manualAnimTimer) { clearTimeout(this.app._manualAnimTimer); this.app._manualAnimTimer = null; }
          this.app.showBubble('晚安 Zzz...', 2000);
        } else {
          this.app._returnToIdle(this.app.mode);
          this.app.showBubble('起床啦!', 1500);
        }
      } else if (result.message) {
        this.app.showBubble(result.message, 1500);
      }
    }).catch(() => {
      this.app._manualSleepMode = true;
      this.app.playAnimation('sleep', this.app.mode);
      this.app._manualAnimLock = true;
      if (this.app._manualAnimTimer) { clearTimeout(this.app._manualAnimTimer); this.app._manualAnimTimer = null; }
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
    this._dragLastDx = 0;
    this._dragReleaseTimer = null;
    this._pressStartTime = 0;
    this._pressTimer = null;
    this._pressPart = null;
    this._pressStartLogical = { x: 0, y: 0 };
    this._raiseHoldActive = false;
    this._lastClickTime = 0;       // 点击防抖
    this._hoveredPart = null;  // 'head' | 'body' | null
    this._waveTimes = 0;
    this._waveSwitchCount = 0;
    this._waveLeft = null;
    this._waveTop = null;
    this._waveLastAt = 0;
    this._waveCooldownUntil = 0;
    this._interactionHistory = [];
    this._lastInteractionAt = 0;
    this._lastProactiveAt = 0;
    this._lastProactiveTypeAt = {};
    this._proactiveAiBusy = false;
    this._proactiveAiHistory = [];
    this._chatActiveUntil = 0;
    this._interactionMood = 'calm';
    this._interactionStreak = { type: null, count: 0, firstAt: 0, lastAt: 0 };
    this._lastInteractionSummary = null;
    this._restoreInteractionState();

    this._toolbar = new ToolBar(this);
    this._stopUiPointerEvents(this._toolbar.el);

    // 行走状态
    this._facingRight = true;
    this._walkTimer = null;
    this._walkGraphType = 'default';
    this._walkPauseUntil = 0;
    this._manualSleepMode = false; // 用户明确点睡觉时进入，自动闲逛不接管
    this._manualAnimLock = false;  // 手动交互(喂食/摸头)时锁住, 防止被行走覆盖
    this._manualAnimTimer = null;  // 手动动画锁定定时器句柄
    this._animatingLock = false;   // 防止并发 playAnimation
    this._clickthroughEnabled = false;  // 当前是否已启用点击穿透
    this._toolbarActive = false;   // 工具栏或子菜单打开时禁止侧边隐藏/行走
    this._auxWindowActive = false;  // 聊天/设置窗口打开时禁止侧边隐藏/行走
    this._auxWindowTimer = null;    // 辅助窗口可见状态轮询
    this._wasWorking = false;      // 工作/学习/玩耍持续态
    this._currentWorkContext = null;
    this._resumeWorkTimer = null;
    this._feedingGraph = null;
    this._manifestAnimations = new Set();
    this._musicTimer = null;
    this._chatterTimer = null;
    this._chatterBusy = false;
    this._illCoughTimer = null;
    this._chatterTopicIndex = Math.floor(Math.random() * CHATTER_TOPICS.length);
    this._chatterHistory = [];  // 话痨模式专用历史，用于防重复
    this._musicActive = false;
    this._musicAboveSince = 0;
    this._musicLastSeenAt = 0;
    this._musicAverage = 0;
    this._musicStrong = false;
    this._mischiefTimer = null;
    this._mischiefBusy = false;
    this._nextMischiefAt = 0;
    this._lastRenderImage = null;
    this._thinkingBubble = null; // LLM 等待中的思考气泡元素
    this._thinkingTimer = null;  // 思考点点计时器

    // 心情追踪 (用于心情变化通知)
    this._prevMood = 'normal';
    this._lastMoodChangeAt = performance.now(); // 启动时给 60s 缓冲，防止误报
    // 各属性低值警告冷却时间戳 { key: performance.now() }
    this._lastStatWarningAt = {};

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

      try {
        const manifest = await invoke('get_manifest', {});
        this._manifestAnimations = new Set(Object.keys((manifest && manifest.animations) || {}));
      } catch (e) {
        console.warn('动画清单索引失败:', e);
      }

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
      this._auxWindowTimer = setInterval(() => this._refreshAuxWindowActive(), 500);

      let tickCount = 0;
      this._tickInterval = setInterval(() => {
        invoke('game_tick', { dtSeconds: 1.0 }).then((result) => {
          if (result.working) {
            if (this._musicActive) this._stopMusicDance({ restore: false });
            this._mischiefBusy = false;
            this._wasWorking = true;
            this._rememberWorkContext(result);
            if (result.graphType && this.graphType !== result.graphType && !this._manualAnimLock && !this._toolbarActive) {
              this.playAnimation(result.graphType, result.mood || 'normal', null, { ambient: true });
            }
            if (Math.random() < 0.015) {
              const activeType = this._currentWorkContext?.speechType || 'work';
              this._speakProactive({ type: activeType, label: this._currentWorkContext?.name || result.graphType || '当前任务' }, {
                fallbackWhenBlocked: false,
                fallbackWhenUnavailable: false,
                minIntervalMs: 240000,
                typeMinIntervalMs: 240000,
              }).catch(() => {});
            }
          } else {
            if (this._wasWorking) {
              this._wasWorking = false;
              this._currentWorkContext = null;
              this._manualAnimLock = false;
              if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
              this.playAnimation('default', result.mood || 'normal');
            }
            if (result.mood && result.mood !== this.mode && !this._manualAnimLock && !this._musicActive && !this._mischiefBusy) {
              const prevMode = this.mode;
              this.mode = result.mood;
              if (this.graphType === 'default') {
                this.playAnimation('default', result.mood, null, { ambient: true });
              }
              // 进入/离开生病模式时启停咳嗽调度
              if (result.mood === 'ill' && prevMode !== 'ill') {
                this._startIllCough();
              } else if (result.mood !== 'ill' && prevMode === 'ill') {
                this._stopIllCough();
              }
            }
          }
          if (result.completedWork?.message) this.showBubble(result.completedWork.message, 4000);
          if (result.leveledUp) {
            const lv = result.stats?.level;
            this.showBubble(lv ? `升级啦！现在是 Lv.${lv}！` : '升级啦！', 3500);
          }
          // 心情变化通知 (60s 冷却, 不在工作/交互锁期间打断)
          if (result.mood && result.mood !== this._prevMood) {
            const now = performance.now();
            if (now - this._lastMoodChangeAt > 60000 && !this._manualAnimLock && !this._wasWorking) {
              const moodMsgs = {
                happy: '今天心情很好喵~',
                normal: '感觉好多了。',
                poorCondition: '唔...有点难受...',
                ill: '我好像生病了，呜呜...',
              };
              const msg = moodMsgs[result.mood];
              if (msg) { this.showBubble(msg, 3000); this._lastMoodChangeAt = now; }
            }
            this._prevMood = result.mood;
          }
        }).catch(() => {});

        tickCount++;
        if (tickCount % 5 === 0) {
          invoke('get_pet_status', {}).then((s) => {
            if (!s.stats) return;
            const now = performance.now();
            const st = s.stats;
            const warn = (key, msg, dur, cd = 25000) => {
              if (!this._lastStatWarningAt[key] || now - this._lastStatWarningAt[key] > cd) {
                this.showBubble(msg, dur);
                this._lastStatWarningAt[key] = now;
              }
            };
            // 优先级: 生病 > 健康 > 饱腹 > 口渴 > 体力
            if (s.mood === 'ill') {
              warn('ill', '身体很难受，需要好好休息...', 3000, 30000);
            } else if (st.health < 20) {
              warn('health', '健康值很低了...要照顾好自己', 2500, 25000);
            } else if (st.hunger < 10) {
              warn('hunger_crit', '要饿死了喵！', 3000, 20000);
            } else if (st.thirst < 10) {
              warn('thirst_crit', '好渴啊...快给我水喝！', 3000, 20000);
            } else if (st.hunger < 20) {
              warn('hunger', '好饿...', 2000, 20000);
            } else if (st.thirst < 20) {
              warn('thirst', '有点渴了...', 2000, 20000);
            } else if (st.energy < 15 && !this._wasWorking && !this._manualSleepMode) {
              warn('energy', '好累啊，想睡一觉...', 2000, 30000);
            }
          }).catch(() => {});
        }
        // 作业进度每 30 秒提示一次
        if (tickCount % 30 === 0 && this._wasWorking) {
          invoke('get_pet_status', {}).then((s) => {
            const work = s?.work;
            if (work?.isActive && work?.name) {
              const pct = Math.round((work.progress || 0) * 100);
              this.showBubble(`${work.name} 进行中... ${pct}%`, 2000);
            }
          }).catch(() => {});
        }
        if (tickCount % 10 === 0) {
          this._checkProactiveInteraction().catch(() => {});
        }
      }, 1000);

      // 监听聊天窗口的 AI 回复，在宠物气泡中同步显示
      window.PetRuntime.listen('chat-reply', (e) => {
        if (e.payload) {
          this._markChatActive(Math.max(12000, e.payload.length * 80));
          this._recordInteraction('chat', { label: 'reply', duration: 1200 });
          this.showBubble(e.payload, Math.max(3000, e.payload.length * 80));
          this._ttsSpeak(e.payload);
        }
      }).catch(() => {});

      // 监听食物面板选择, 在宠物上播放吃饭动画
      window.PetRuntime.listen('food-selected', (e) => {
        if (e.payload) {
          const p = e.payload;
          if (p.name) this._handleEatFood(p.name, p.graph);
        }
      }).catch(() => {});

      // 监听工作面板选择, 在宠物上播放工作动画
      window.PetRuntime.listen('work-selected', (e) => {
        if (e.payload) {
          const p = e.payload;
          if (p.action === 'stop') this._handleStopWork();
          else if (p.action === 'start') {
            if (p.type === 'Play') this._handlePlay(p.graph);
            else this._handleWork(p.graph);
          }
        }
      }).catch(() => {});

      // 设置初始等级为30
      invoke('cheat_set_level', { level: 30 }).then((r) => {
        console.log('[Pet]: 等级已设为', r.level);
      }).catch(() => {});

      // 4.5 自主行走 — 每 120ms tick 一次
      this._walkTimer = setInterval(() => this._walkTick(), 120);

      // 4.6 点击穿透轮询 — 每 150ms 检测鼠标是否在宠物精灵上
      this._clickthroughInterval = setInterval(() => this._checkClickthrough(), 150);

      // 4.7 环境互动: 音乐跳舞 + 空闲捣蛋 + 20 秒主动闲聊
      this._musicTimer = setInterval(() => this._musicTick().catch(() => {}), MUSIC_POLL_MS);
      this._scheduleMischief();
      this._startChatter();
      // 4.8 如果启动时已是生病状态，立即开启咳嗽调度
      if (this.mode === 'ill') this._startIllCough();

      // 5. 启动渲染循环
      this.lastTime = performance.now();
      this.lastFpsTime = this.lastTime;
      requestAnimationFrame((t) => this._gameLoop(t));

    } catch (e) {
      this.statusRust.textContent = `Rust: ERROR ${e}`;
      console.error('初始化失败:', e);
    }
  }

  _stopUiPointerEvents(el) {
    if (!el) return;
    ['mousedown', 'mouseup', 'mousemove', 'click', 'contextmenu'].forEach((type) => {
      el.addEventListener(type, (e) => {
        e.stopPropagation();
        this._clearPressTimer();
        this._pressStartTime = 0;
        this._pressPart = null;
        this._raiseHoldActive = false;
        this._dragging = false;
        document.body.classList.remove('dragging');
      });
    });
  }

  _isUiPointerTarget(target) {
    return !!(target && target.closest && target.closest('#pet-toolbar, .tb-submenu, .tb-panel, #chat-panel'));
  }

  _pointerLogicalFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.target === this.canvas && e.offsetX !== undefined ? e.offsetX : e.clientX - rect.left;
    const cy = e.target === this.canvas && e.offsetY !== undefined ? e.offsetY : e.clientY - rect.top;
    if (cx < 0 || cy < 0 || cx > rect.width || cy > rect.height) return null;
    return this._canvasToLogical(cx, cy);
  }

  _clearPressTimer() {
    if (this._pressTimer) {
      clearTimeout(this._pressTimer);
      this._pressTimer = null;
    }
  }

  _beginPress(e, logicalPoint = null) {
    this._clearPressTimer();
    this._pressStartTime = e.timeStamp || performance.now();
    this._dragging = false;
    this._raiseHoldActive = false;
    this._dragStartX = e.screenX;
    this._dragStartY = e.screenY;
    this._dragLastDx = 0;

    const point = logicalPoint || this._pointerLogicalFromEvent(e);
    this._pressStartLogical = point || { x: 0, y: 0 };
    this._pressPart = point ? this._hitTestLogical(point.x, point.y) : null;
    this._hoveredPart = this._pressPart;

    if (this._pressPart) {
      this._pressTimer = setTimeout(() => this._triggerLongPressHold(), MOUSE_LONG_PRESS_MS);
    }
  }

  _updateHoverFromEvent(e) {
    const point = this._pointerLogicalFromEvent(e);
    this._hoveredPart = point ? this._hitTestLogical(point.x, point.y) : null;
  }

  // ── VPet 鼠标挥动检测 ──
  // 对标 VPet Main.xaml.cs MainGrid_MouseMove 挥手识别逻辑
  // 逻辑坐标空间 500×500; X<200=左, X>300=右; Y<250=上半身(头), Y>=250=下半身(身体)
  _tickWaveDetection(e) {
    const now = performance.now();

    // 超过 2s 无移动则重置所有计数
    if (now - this._waveLastAt > 2000) {
      this._waveTimes = 0;
      this._waveSwitchCount = 0;
      this._waveLeft = null;
      this._waveTop  = null;
    }
    this._waveLastAt = now;

    // 冷却期内跳过 (触发后 3s 内不重复)
    if (now < this._waveCooldownUntil) return;

    const point = this._pointerLogicalFromEvent(e);
    if (!point) return;

    const isLeft = point.x < 200;
    const isTop  = point.y < 250;

    // 水平方向切换计入 switch 计数和累计次数
    if (this._waveLeft !== null && this._waveLeft !== isLeft) {
      this._waveSwitchCount++;
      this._waveTimes++;
    }
    // 垂直方向切换只计入累计次数 (辅助判断活跃度)
    if (this._waveTop !== null && this._waveTop !== isTop) {
      this._waveTimes++;
    }
    this._waveLeft = isLeft;
    this._waveTop  = isTop;

    // 触发条件：切换 >= 3 次 && 累计运动 >= 5 次
    // 且宠物当前处于可互动状态 (对标 VPet: IsIdel || already in Touch anim)
    if (this._waveSwitchCount < 3 || this._waveTimes < 5) return;
    const isIdle = !this._dragging && !this._manualSleepMode && !this._manualAnimLock
      && !this._musicActive && !this._mischiefBusy && !this._chatterBusy;
    const alreadyInTouch = this.graphType === 'touch_head' || this.graphType === 'touch_body';
    const isDefaultIdle  = this.graphType === 'default';
    if (!isIdle || (!alreadyInTouch && !isDefaultIdle && this._waveTimes < 10)) return;

    // 重置计数 + 设置冷却
    this._waveTimes = 0;
    this._waveSwitchCount = 0;
    this._waveLeft = null;
    this._waveTop  = null;
    this._waveCooldownUntil = now + 3000;

    // 上半部 → touch_head, 下半部 → touch_body (对标 VPet wavetop 逻辑)
    const graph = isTop ? 'touch_head' : 'touch_body';
    this._doWaveTouch(graph);
  }

  async _doWaveTouch(graph) {
    if (!this._hasAnimationGraph(graph)) return;
    // 播放触摸动画
    this.playAnimation(graph, this.mode || 'normal', () => {
      this._returnToBaseState(this.mode || 'normal');
    }, { autoEndLoops: 1 });
    // 更新属性 (对标 VPet Touch: Strength-2, Feeling+1)
    const lx = graph === 'touch_head' ? 250 : 250;
    const ly = graph === 'touch_head' ? 180 : 320;
    try { await invoke('process_interaction', { lx, ly, pressDurationMs: 50, hasMoved: false }); }
    catch (_) {}
    this._recordInteraction('touch', { part: graph === 'touch_head' ? 'head' : 'body', duration: 1600, label: 'wave' });
    const msgs = graph === 'touch_head'
      ? ['主人在挥手呢~', '喵？要摸我吗？', '嗯嗯，我在这里！', '好好好，我注意到了！']
      : ['主人在和我打招呼！', '嗯嗯~！', '挠一挠真舒服！', '主人在逗我！'];
    this.showBubble(msgs[Math.floor(Math.random() * msgs.length)], 1800);
  }

  _triggerLongPressHold() {
    this._pressTimer = null;
    if (this._dragging || this._raiseHoldActive || !this._pressStartTime || !this._pressPart) return;
    this._raiseHoldActive = true;
    if (this._musicActive) this._stopMusicDance({ restore: false });
    this._walkPauseUntil = performance.now() + 1800;
    this._manualSleepMode = false;
    this._manualAnimLock = true;
    this._animatingLock = false;
    invoke('process_interaction', {
      lx: this._pressStartLogical.x,
      ly: this._pressStartLogical.y,
      pressDurationMs: MOUSE_LONG_PRESS_MS,
      hasMoved: false,
    }).catch(() => {});
    if (this.graphType !== 'raise') {
      this.playAnimation('raise', this.mode || 'normal');
    }
  }

  _finishClickPress(e, logicalPoint = null) {
    if (!this._pressStartTime) return false;
    this._clearPressTimer();

    let pressDurationMs = (e.timeStamp || performance.now()) - this._pressStartTime;
    if (this._pressStartTime === 0 || pressDurationMs > 5000 || pressDurationMs < 0) {
      pressDurationMs = 50;
    }

    if (pressDurationMs >= MOUSE_LONG_PRESS_MS && this._pressPart) {
      this._triggerLongPressHold();
      return this._finishDrag(e);
    }

    this._pressStartTime = 0;
    const point = logicalPoint || this._pointerLogicalFromEvent(e) || this._pressStartLogical;
    const part = point ? this._hitTestLogical(point.x, point.y) : null;
    this._pressPart = null;
    if (!point || !part) return false;
    this._onClickPart(point.x, point.y, pressDurationMs);
    return true;
  }

  // ── 互动系统 ──

  _restoreInteractionState() {
    try {
      const raw = window.localStorage.getItem(INTERACTION_STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1) return;

      const now = performance.now();
      const savedAt = Number(saved.savedAt || Date.now());
      const savedLocalAt = Math.max(0, Number(saved.savedLocalAt || 0));
      const offlineElapsed = Math.max(0, Date.now() - savedAt);
      const normalizeLocalAt = (at) => {
        const ageBeforeSave = Math.max(0, savedLocalAt - Math.max(0, Number(at || 0)));
        return Math.max(0, now - ageBeforeSave - offlineElapsed);
      };

      this._interactionHistory = Array.isArray(saved.history)
        ? saved.history.slice(-INTERACTION_HISTORY_LIMIT).map((item) => ({
            type: item.type || 'unknown',
            part: item.part || null,
            label: item.label || null,
            mood: item.mood || 'normal',
            at: Number(item.at || savedAt),
            localAt: normalizeLocalAt(item.localAt),
            streakCount: Number(item.streakCount || 1),
          }))
        : [];

      const restoredLast = saved.lastInteractionSummary || this._interactionHistory[this._interactionHistory.length - 1] || null;
      this._lastInteractionSummary = restoredLast;
      this._interactionMood = saved.interactionMood || (restoredLast ? this._deriveInteractionMood(restoredLast) : 'calm');
      this._lastInteractionAt = restoredLast ? normalizeLocalAt(restoredLast.localAt) : 0;

      const streak = saved.interactionStreak || {};
      this._interactionStreak = streak.type
        ? {
            type: streak.type,
            count: Number(streak.count || 1),
            firstAt: normalizeLocalAt(streak.firstAt),
            lastAt: normalizeLocalAt(streak.lastAt),
          }
        : { type: null, count: 0, firstAt: 0, lastAt: 0 };
    } catch (e) {
      console.warn('互动状态恢复失败:', e);
    }
  }

  _saveInteractionState() {
    try {
      const state = {
        version: 1,
        savedAt: Date.now(),
        savedLocalAt: performance.now(),
        history: this._interactionHistory.slice(-INTERACTION_HISTORY_LIMIT),
        lastInteractionSummary: this._lastInteractionSummary,
        interactionMood: this._interactionMood,
        interactionStreak: this._interactionStreak,
      };
      window.localStorage.setItem(INTERACTION_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('互动状态保存失败:', e);
    }
  }

  _recordInteraction(type, detail = {}) {
    const now = performance.now();
    const prev = this._interactionStreak;
    const inSameStreak = prev.type === type && now - prev.lastAt < 6000;
    const streak = inSameStreak
      ? { type, count: prev.count + 1, firstAt: prev.firstAt, lastAt: now }
      : { type, count: 1, firstAt: now, lastAt: now };

    const entry = {
      type,
      part: detail.part || null,
      label: detail.label || null,
      mood: detail.mood || this.mode || 'normal',
      at: Date.now(),
      localAt: now,
      streakCount: streak.count,
    };

    this._interactionStreak = streak;
    this._interactionHistory.push(entry);
    if (this._interactionHistory.length > INTERACTION_HISTORY_LIMIT) this._interactionHistory.shift();
    this._lastInteractionAt = now;
    this._lastInteractionSummary = entry;
    this._interactionMood = this._deriveInteractionMood(entry);
    this._saveInteractionState();

    if (type !== 'music' && type !== 'mischief') {
      if (this._musicActive) this._stopMusicDance({ restore: false });
      this._mischiefBusy = false;
    }

    const feedback = this._interactionFeedback(entry);
    if (feedback && !detail.suppressFeedback) this.showBubble(feedback, detail.duration || 1800);
    return entry;
  }

  _deriveInteractionMood(entry) {
    if (entry.type === 'pinch') return entry.streakCount >= 3 ? 'annoyed' : 'playful';
    if (entry.type === 'feed' || entry.type === 'drink') return 'satisfied';
    if (entry.type === 'chat') return 'companied';
    if (entry.type === 'play') return 'excited';
    if (entry.type === 'drag') return 'startled';
    if (entry.type === 'work') return 'focused';
    if (entry.part === 'head') return 'happy';
    return 'calm';
  }

  _interactionFeedback(entry) {
    const count = entry.streakCount;
    if (entry.type === 'pinch') {
      if (count >= 5) return '别一直戳啦，会生气的!';
      if (count >= 3) return '再戳就要躲起来了喵~';
      return null;
    }
    if (entry.type === 'touch') {
      if (entry.part === 'head') return count >= 3 ? '摸摸头最舒服了~' : null;
      if (entry.part === 'body' && count >= 3) return '今天也要贴贴吗?';
    }
    if (entry.type === 'feed' && count >= 2) return '吃饱啦，谢谢你!';
    if (entry.type === 'drink' && count >= 2) return '水分补充完成~';
    if (entry.type === 'chat') return '我在听呢。';
    return null;
  }

  _recentInteractionCounts(windowMs = 60000) {
    const now = performance.now();
    return this._interactionHistory.reduce((acc, item) => {
      if (now - item.localAt <= windowMs) acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {});
  }

  async _checkProactiveInteraction() {
    const now = performance.now();
    if (now - this._lastProactiveAt < PROACTIVE_AI_MIN_MS) return;
    if (now < this._chatActiveUntil) return;
    if (this._dragging || this._manualSleepMode || this._manualAnimLock || this._toolbarActive || this._auxWindowActive || this._musicActive || this._mischiefBusy || this._wasWorking) return;
    if (this.chatUI && this.chatUI._isSending) return;

    const idleMs = this._lastInteractionAt ? now - this._lastInteractionAt : now;
    const counts = this._recentInteractionCounts(90000);
    let context = null;

    if (counts.pinch >= 5) {
      context = { type: 'annoyed', reason: '刚刚被主人连续戳了很多次，想表达一点点委屈' };
    } else if (counts.feed >= 3 || counts.drink >= 3) {
      context = { type: 'satisfied', reason: '刚刚吃喝很多，想把满足感说出来' };
    } else if (idleMs > PROACTIVE_IDLE_MS) {
      context = { type: 'idle', reason: '主人已经很久没有互动，想吸引主人注意' };
    } else if (idleMs > PROACTIVE_SOFT_IDLE_MS && this.mode !== 'happy') {
      context = { type: 'idle-soft', reason: '主人有一段时间没有互动，想轻轻撒娇' };
    }

    if (!context) return;
    await this._speakProactive(context, {
      fallback: this._fallbackProactiveSpeech(context),
      minIntervalMs: PROACTIVE_AI_MIN_MS,
      typeMinIntervalMs: PROACTIVE_AI_CONTEXT_MIN_MS,
    });
  }

  _startChatter() {
    if (this._chatterTimer) clearInterval(this._chatterTimer);
    this._chatterTimer = setInterval(() => {
      this._tickChatter().catch(() => {});
    }, CHATTER_AI_INTERVAL_MS);
    window.addEventListener('beforeunload', () => this._stopChatter(), { once: true });
  }

  _stopChatter() {
    if (!this._chatterTimer) return;
    clearInterval(this._chatterTimer);
    this._chatterTimer = null;
  }

  // ── 生病咳嗽调度 ──

  _startIllCough() {
    this._stopIllCough();
    const schedule = () => {
      // 每 25~55 秒触发一次咳嗽
      const delay = 25000 + Math.random() * 30000;
      this._illCoughTimer = setTimeout(() => {
        this._doIllCough();
        schedule();
      }, delay);
    };
    schedule();
  }

  _stopIllCough() {
    if (this._illCoughTimer) { clearTimeout(this._illCoughTimer); this._illCoughTimer = null; }
  }

  _doIllCough() {
    if (this.mode !== 'ill') { this._stopIllCough(); return; }
    if (this._dragging || this._manualSleepMode || this._manualAnimLock) return;
    if (this.graphType !== 'default') return;
    // 随机咳嗽台词
    const coughLines = [
      '咳咳咳...', '呜...身体好难受...', '咳...*打了个喷嚏*', '咳嗽了一下，主人要关心我喵...',
    ];
    const line = coughLines[Math.floor(Math.random() * coughLines.length)];
    this.playAnimation('cough', 'ill', null, { force: true });
    this.showBubble(line, 2000);
    setTimeout(() => {
      if (!this._dragging && !this._manualAnimLock) {
        this._returnToIdle(this.mode);
      }
    }, 2800);
  }

  _canChatter() {
    if (this._dragging || this._manualSleepMode) return false;
    if (this._auxWindowActive) return false;
    if (this.chatUI && this.chatUI._isSending && this.chatUI.isVisible) return false;
    return true;
  }

  async _tickChatter() {
    if (this._chatterBusy) return;
    if (!this._canChatter()) return;

    this._chatterBusy = true;
    const topic = CHATTER_TOPICS[this._chatterTopicIndex % CHATTER_TOPICS.length];
    this._chatterTopicIndex = (this._chatterTopicIndex + 1) % CHATTER_TOPICS.length;

    try {
      const recentChatter = this._chatterHistory.slice(-4);
      // 复用 _speakProactive 路径：和聊天窗口走同一个 LLM 调用链
      // force/forceType 跳过全局间隔限制，由 _chatterTimer 自行控制节奏
      const speech = await this._speakProactive(
        { type: 'chatter', topic, recentChatter },
        {
          fallback: this._fallbackProactiveSpeech({ type: 'chatter', topic }),
          force: true,
          forceType: true,
          allowChatActive: true,
        }
      );
      if (speech) {
        this._chatterHistory.push(speech);
        if (this._chatterHistory.length > 12) this._chatterHistory.shift();
        this._markChatActive(Math.max(4000, speech.length * 70));
        this._recordInteraction('chat', { label: `chatter:${topic}`, duration: 0, suppressFeedback: true });
      }
    } finally {
      this._chatterBusy = false;
    }
  }

  _canUseProactiveAi(options = {}) {
    const now = performance.now();
    if (this._proactiveAiBusy) return false;
    if (this._dragging || this._manualSleepMode) return false;
    if (this._toolbarActive && !options.allowToolbarActive) return false;
    if (this._auxWindowActive && !options.allowAuxWindowActive) return false;
    if (now < this._chatActiveUntil && !options.allowChatActive) return false;
    if (this.chatUI && this.chatUI._isSending && !options.allowChatSending) return false;

    const minIntervalMs = options.minIntervalMs ?? PROACTIVE_AI_MIN_MS;
    if (!options.force && now - this._lastProactiveAt < minIntervalMs) return false;

    const type = options.type || null;
    if (type) {
      const typeMinIntervalMs = options.typeMinIntervalMs ?? PROACTIVE_AI_CONTEXT_MIN_MS;
      const lastTypeAt = this._lastProactiveTypeAt?.[type] || 0;
      if (!options.forceType && now - lastTypeAt < typeMinIntervalMs) return false;
    }

    return true;
  }

  _markProactiveAi(type) {
    const now = performance.now();
    this._lastProactiveAt = now;
    if (!this._lastProactiveTypeAt) this._lastProactiveTypeAt = {};
    if (type) this._lastProactiveTypeAt[type] = now;
  }

  _fallbackProactiveSpeech(context = {}) {
    const type = context.type || 'idle';
    const label = context.label || context.workName || context.foodName || '';
    const action = context.action || '';
    const pools = {
      idle: ['主人是不是忘记我了？摸摸头也可以呀。', '我在这里等你好久啦。', '主人，理理我嘛。'],
      'idle-soft': ['摸摸头会让我开心一点。', '我有点想你啦。', '现在可以陪我一下吗？'],
      annoyed: ['刚刚被戳得有点晕，我想休息一下。', '再戳就要躲起来了喵。'],
      satisfied: ['已经很满足啦，陪我玩一会儿吧。', '吃饱喝足，想和主人贴贴。'],
      mischief: action === 'nudge'
        ? ['我就悄悄挪一下下。', '这不是捣乱，是桌面巡逻。']
        : action === 'peek'
          ? ['我来检查主人有没有偷懒。', '桌面巡逻中，发现主人一只。']
          : ['刚刚不是我动的。', '我要表演一个无害小动作。'],
      feed: [`${label || '这个'}看起来好香。`, `谢谢主人，我要开动啦。`],
      drink: [`${label || '这个'}好像很好喝。`, '补充水分完成。'],
      play: [`开始${label || '玩耍'}，主人也要开心。`, '玩耍时间到啦。'],
      work: [`开始${label || '工作'}啦，我会努力的。`, '认真模式启动。'],
      music: ['这首歌好像很适合跳舞。', '节奏来了，我要动起来。'],
      chatter: [
        `忽然想聊聊${context.topic || label || '今天'}，主人也在想事情吗？`,
        '我刚刚看着桌面，觉得世界小小的也很热闹。',
        '给主人念一句：风路过窗边，也把温柔带来了。',
      ],
    };
    const choices = pools[type] || pools.idle;
    return choices[Math.floor(Math.random() * choices.length)];
  }

  _interactionTypeLabel(type) {
    const labels = {
      touch: '触摸', pinch: '戳脸', drag: '拖拽', feed: '喂食', drink: '喝水',
      play: '玩耍', work: '工作', chat: '聊天', music: '听到音乐', mischief: '捣蛋',
    };
    return labels[type] || type || '未知';
  }

  _buildProactiveUserPrompt(context = {}, status = {}) {
    const stats = status.stats || {};
    const work = status.work || {};
    const recent = this._interactionHistory.slice(-5).map((item) => {
      const label = item.label ? `/${item.label}` : '';
      return `${this._interactionTypeLabel(item.type)}${label}`;
    }).join('；') || '暂无';
    const eventText = {
      idle: '主人很久没有理我了；我想问：主人不理我了，我该说什么让主人理我？',
      'idle-soft': '主人有一段时间没有互动；我想轻轻撒娇让主人注意到我。',
      annoyed: '主人刚刚连续戳我；我想可爱地表达一点委屈。',
      satisfied: '主人刚刚给我吃喝很多；我想表达满足并邀请主人互动。',
      mischief: `我准备做一个无害的小捣蛋：${context.action || '小动作'}；我该先说什么才可爱？`,
      feed: `主人给我吃：${context.label || context.foodName || '食物'}；我该说什么？`,
      drink: `主人给我喝：${context.label || context.foodName || '饮品'}；我该说什么？`,
      play: `我准备开始玩耍：${context.label || work.name || '玩耍'}；我该说什么？`,
      work: `我准备开始工作/学习：${context.label || context.workName || work.name || '工作'}；我该说什么？`,
      music: `我听到音乐，准备跳舞；我该说什么？`,
      chatter: (() => {
        const recent = context.recentChatter;
        const recentNote = recent && recent.length
          ? `\n我最近说过：${recent.map(s => `"${s}"`).join('、')}。请务必说一句完全不同的内容，不要重复类似的措辞或意思。`
          : '';
        return `我现在进入话痨模式，每隔一段时间主动和主人说一句话。当前话题：「${context.topic || '生活'}」。${recentNote}\n请发挥创意，说一句独特、自然、贴合话题的话，可以是诗意的描述、有趣的联想、对主人的鼓励或猫猫视角的感悟。`;
      })(),
    }[context.type || 'idle'] || (context.reason || '我想主动和主人说一句话。');

    return [
      `事件：${eventText}`,
      `当前心情：${status.mood || this.mode || 'normal'}`,
      `状态：饱腹${Math.round(stats.hunger ?? 80)}，口渴${Math.round(stats.thirst ?? 80)}，心情${Math.round(stats.happiness ?? 80)}，体力${Math.round(stats.energy ?? 80)}`,
      `最近互动：${recent}`,
      `输出要求：只输出桌宠第一人称的一句中文气泡台词，${PROACTIVE_SPEECH_MAX_CHARS}字以内；不要解释，不要加引号，不要说自己是AI。`,
    ].join('\n');
  }

  _normalizeProactiveSpeech(text) {
    if (!text) return '';
    let value = String(text)
      .replace(/\r?\n+/g, ' ')
      .replace(/^(回复|台词|气泡|桌宠|宠物)[:：]\s*/i, '')
      .replace(/^["“'‘\s]+|["”'’\s]+$/g, '')
      .trim();
    if (!value) return '';

    const sentence = value.match(/^(.{1,80}?[。！？!?])/);
    if (sentence && sentence[1]) value = sentence[1];
    if (value.length > PROACTIVE_SPEECH_MAX_CHARS) {
      value = `${value.slice(0, PROACTIVE_SPEECH_MAX_CHARS - 1)}…`;
    }
    return value;
  }

  async _resolveProactiveSpeech(context = {}, options = {}) {
    const type = context.type || 'idle';
    const fallback = options.fallback !== undefined ? options.fallback : this._fallbackProactiveSpeech(context);
    const canUseAi = this._canUseProactiveAi({
      type,
      force: !!options.force,
      forceType: !!options.forceType,
      minIntervalMs: options.minIntervalMs,
      typeMinIntervalMs: options.typeMinIntervalMs,
      allowToolbarActive: !!options.allowToolbarActive,
      allowAuxWindowActive: !!options.allowAuxWindowActive,
      allowChatActive: !!options.allowChatActive,
      allowChatSending: !!options.allowChatSending,
    });

    if (!canUseAi) {
      return options.fallbackWhenBlocked === false ? null : fallback;
    }

    this._proactiveAiBusy = true;
    try {
      const hasApiKey = await invoke('has_llm_api_key', {});
      if (!hasApiKey) {
        return options.fallbackWhenUnavailable === false ? null : fallback;
      }

      const [config, status, memorySummary] = await Promise.all([
        invoke('load_llm_config', {}),
        invoke('get_pet_status', {}).catch(() => ({})),
        invoke('memory_summary', {}).catch(() => null),
      ]);
      const stats = status.stats || {};
      const basePrompt = await invoke('build_persona_prompt', {
        customPrompt: null,
        mood: status.mood || this.mode || 'normal',
        hunger: stats.hunger ?? 80,
        happiness: stats.happiness ?? 80,
        isWorking: !!status.work?.isActive,
        memorySummary,
      }).catch(() => '你是一只活泼、亲近主人的桌面宠物。');
      const petName = config.pet_name || '喵喵';
      const prompt = `你的名字叫「${petName}」。\n${basePrompt}\n\n你现在只负责给桌宠生成主动气泡台词。台词要短、自然、可爱，贴合当前事件。`;
      const isChatterType = (context.type === 'chatter');
      const tunedConfig = {
        ...config,
        temperature: isChatterType
          ? Math.max(0.85, Math.min(1.2, Number(config.temperature || 0.9)))
          : Math.max(0.6, Math.min(1.0, Number(config.temperature || 0.8))),
        max_tokens: isChatterType
          ? Math.min(Number(config.max_tokens || 120), 120)
          : Math.min(Number(config.max_tokens || 80), 80),
      };
      // 话痨模式使用独立历史，避免和其他互动混淆造成重复
      const history = isChatterType
        ? this._chatterAiHistory ? this._chatterAiHistory.slice(-4) : []
        : this._proactiveAiHistory.slice(-6);
      const newHistory = await invoke('chat_stream', {
        message: this._buildProactiveUserPrompt(context, status),
        config: tunedConfig,
        systemPrompt: prompt,
        history,
      });

      if (Array.isArray(newHistory)) {
        if (isChatterType) {
          if (!this._chatterAiHistory) this._chatterAiHistory = [];
          this._chatterAiHistory = newHistory.slice(-6);
        } else {
          this._proactiveAiHistory = newHistory.slice(-8);
        }
      }
      const assistant = Array.isArray(newHistory)
        ? [...newHistory].reverse().find((item) => item && item.role === 'assistant')
        : null;
      const speech = this._normalizeProactiveSpeech(assistant?.content || '');
      return speech || fallback;
    } catch (e) {
      console.warn('主动 AI 发言失败:', e);
      return fallback;
    } finally {
      this._proactiveAiBusy = false;
    }
  }

  async _speakProactive(context = {}, options = {}) {
    const isChatter = (context.type === 'chatter');
    if (isChatter) this._startThinkingDots();
    const speech = await this._resolveProactiveSpeech(context, options);
    if (isChatter) this._stopThinkingDots(speech);
    if (!speech) return null;
    this._markProactiveAi(context.type || 'idle');
    if (!isChatter) {
      const duration = options.duration || Math.max(2800, speech.length * 90);
      this.showBubble(speech, duration);
    }
    return speech;
  }

  _speakSceneProactive(context = {}, options = {}) {
    return this._speakProactive(context, {
      fallback: this._fallbackProactiveSpeech(context),
      minIntervalMs: PROACTIVE_SCENE_AI_MIN_MS,
      typeMinIntervalMs: PROACTIVE_SCENE_CONTEXT_MIN_MS,
      allowToolbarActive: true,
      ...options,
    });
  }

  async _ttsSpeak(text) {
    if (!text || !text.trim()) return;
    try {
      const hasTtsKey = await invoke('has_tts_api_key', {});
      if (!hasTtsKey) return;
      const base64Wav = await invoke('tts_speak', { text });
      if (base64Wav) playBase64Wav(base64Wav);
    } catch (e) {
      console.warn('TTS 合成失败:', e);
    }
  }

  _markChatActive(duration = 12000) {
    this._chatActiveUntil = Math.max(this._chatActiveUntil, performance.now() + duration);
  }

  _freezeAuxWindowMotion(duration = 60000) {
    this._auxWindowActive = true;
    this._markChatActive(duration);
  }

  async _refreshAuxWindowActive() {
    try {
      this._auxWindowActive = await invoke('aux_window_visible', {});
    } catch (_) {
      this._auxWindowActive = false;
    }
  }

  _hasAnimationGraph(graphType) {
    if (this._manifestAnimations.size === 0 || this._manifestAnimations.has(graphType)) return true;
    return graphType.startsWith('move.') && this._manifestAnimations.has('move');
  }

  _canAmbientAct(options = {}) {
    const allowMusic = !!options.allowMusic;
    const allowMischief = !!options.allowMischief;
    if (this._dragging || this._manualSleepMode || this._manualAnimLock || this._toolbarActive || this._auxWindowActive) return false;
    if (performance.now() < this._chatActiveUntil) return false;
    if (this.chatUI && this.chatUI._isSending) return false;
    if (this._wasWorking) return false;
    if (this._musicActive && !allowMusic) return false;
    if (this._mischiefBusy && !allowMischief) return false;
    if (['eat', 'drink', 'raise', 'sleep'].includes(this.graphType)) return false;
    return true;
  }

  _pickAmbientGraph(candidates, fallback = 'default') {
    return candidates.find((graph) => this._hasAnimationGraph(graph)) || fallback;
  }

  _resolveWalkGraphType(result) {
    if (!result) return null;
    const graphType = result.graphType || 'default';
    if (graphType.startsWith('move.climb.') || graphType.startsWith('move.crawl.') || graphType.startsWith('move.fall.')) {
      return graphType;
    }
    if (graphType.startsWith('move.walk.')) return graphType;
    if (graphType !== 'move' && !result.walking) {
      return ['default', 'think'].includes(graphType) ? graphType : 'default';
    }

    const direction = result.facingRight === false ? 'left' : 'right';
    const speed = Number(result.speedPxPerSec || 80);
    const suffix = (this.mode === 'poorCondition' || this.mode === 'ill' || speed <= 65)
      ? '.slow'
      : (speed >= 110 ? '.faster' : '');
    return `move.walk.${direction}${suffix}`;
  }

  async _musicTick() {
    if (!this._hasAnimationGraph('music')) return;
    const now = performance.now();
    const canAct = this._canAmbientAct({ allowMusic: true });

    if (!canAct) {
      this._musicAboveSince = 0;
      if (this._musicActive) {
        this._stopMusicDance({ restore: !this._manualAnimLock && !this._wasWorking });
      }
      return;
    }

    let level = 0;
    try {
      level = Number(await invoke('get_system_audio_level', {})) || 0;
    } catch (_) {
      level = 0;
    }
    level = Math.max(0, Math.min(1, level));
    this._musicAverage = this._musicAverage ? (this._musicAverage * 0.65 + level * 0.35) : level;

    const musicDetected = level >= MUSIC_CATCH_LEVEL || this._musicAverage >= MUSIC_SOFT_CATCH_LEVEL;

    if (musicDetected) {
      if (!this._musicAboveSince) this._musicAboveSince = now;
      this._musicLastSeenAt = now;
      const strong = level >= MUSIC_MAX_LEVEL || this._musicAverage >= MUSIC_MAX_LEVEL;
      if (!this._musicActive && now - this._musicAboveSince >= MUSIC_CONFIRM_MS) {
        await this._startMusicDance(strong);
      } else if (this._musicActive && strong && !this._musicStrong) {
        this._musicStrong = true;
        this._speakSceneProactive({ type: 'music', label: '强节奏', strong: true }, {
          minIntervalMs: 30000,
          typeMinIntervalMs: 60000,
        }).catch(() => {});
      }
      return;
    }

    this._musicAboveSince = 0;
    if (this._musicActive && now - this._musicLastSeenAt >= MUSIC_RELEASE_MS) {
      this._stopMusicDance({ restore: true });
    }
  }

  async _startMusicDance(strong = false) {
    if (this._musicActive || !this._canAmbientAct({ allowMusic: true })) return;
    this._musicActive = true;
    this._musicStrong = !!strong;
    this._walkGraphType = 'music';
    const label = strong ? '强节奏' : '音乐';
    this._recordInteraction('music', { label, mood: 'happy', duration: 0, suppressFeedback: true });
    this._speakSceneProactive({ type: 'music', label, strong }).catch(() => {});
    await this.playAnimation('music', 'happy', null, { ambient: true });
    if (this.graphType !== 'music') {
      this._musicActive = false;
    }
  }

  _stopMusicDance(options = {}) {
    if (!this._musicActive) return;
    const shouldRestore = options.restore !== false;
    this._musicActive = false;
    this._musicStrong = false;
    this._musicAboveSince = 0;
    this._musicAverage = 0;
    if (shouldRestore && this.graphType === 'music') {
      this.playAnimation('default', this.mode || 'normal', null, { ambient: true });
    }
  }

  _scheduleMischief() {
    if (this._mischiefTimer) clearTimeout(this._mischiefTimer);
    const delay = MISCHIEF_MIN_MS + Math.random() * (MISCHIEF_MAX_MS - MISCHIEF_MIN_MS);
    this._nextMischiefAt = performance.now() + delay;
    this._mischiefTimer = setTimeout(() => {
      this._mischiefTick().catch(() => {}).finally(() => this._scheduleMischief());
    }, delay);
  }

  async _mischiefTick() {
    if (!this._canAmbientAct()) return;
    if (Math.random() > 0.45) return;

    this._mischiefBusy = true;
    const actions = ['nudge', 'animate', 'peek'];
    const action = actions[Math.floor(Math.random() * actions.length)];
    this._recordInteraction('mischief', { label: action, mood: 'playful', duration: 0 });

    try {
      await this._speakProactive({ type: 'mischief', action }, {
        fallback: this._fallbackProactiveSpeech({ type: 'mischief', action }),
        minIntervalMs: 60000,
        typeMinIntervalMs: 120000,
      });
      if (action === 'nudge') await this._runMischiefNudge({ say: false });
      else if (action === 'peek') await this._runMischiefPeek({ say: false });
      else await this._runMischiefAnimation({ say: false });
    } finally {
      setTimeout(() => { this._mischiefBusy = false; }, 1200);
    }
  }

  async _runMischiefNudge(options = {}) {
    const direction = Math.random() < 0.5 ? -1 : 1;
    let dx = direction * (16 + Math.floor(Math.random() * 12));
    let dy = Math.random() < 0.4 ? -8 : 0;
    try {
      const [pos, screen] = await Promise.all([
        invoke('get_window_position', {}),
        invoke('get_screen_info', {}),
      ]);
      const maxX = Math.max(0, Math.round(screen.workAreaWidth) - pos.width);
      if (pos.x + dx < 0 || pos.x + dx > maxX) dx = -dx;
    } catch (_) {}
    if (options.say !== false) this.showBubble('我悄悄挪一下。', 1600);
    await this.playAnimation(this._pickAmbientGraph(['switch', 'think', 'touch_body']), 'happy', null, { ambient: true });
    await invoke('move_window_by', { dx, dy }).catch(() => {});
    setTimeout(() => invoke('move_window_by', { dx: -dx, dy: -dy }).catch(() => {}), 650);
  }

  async _runMischiefPeek(options = {}) {
    if (options.say !== false) this.showBubble('桌面巡逻中。', 1600);
    await this.playAnimation(this._pickAmbientGraph(['think', 'switch', 'touch_head']), 'happy', null, { ambient: true });
  }

  async _runMischiefAnimation(options = {}) {
    const graph = this._pickAmbientGraph(['touch_body', 'touch_head', 'think', 'switch', 'playone']);
    if (options.say !== false) this.showBubble('刚刚不是我动的。', 1600);
    await this.playAnimation(graph, 'happy', null, { ambient: true });
  }

  _applyInteractionResult(result, fallbackMood = 'normal') {
    if (!result) return;
    if (result.graphType) this.playAnimation(result.graphType, result.mood || fallbackMood);
    if (result.showBubble) this.showBubble(result.showBubble, 2500);
    if (result.message) console.log('[Pet]:', result.message);
  }

  // ── 聊天窗口 ──

  async _openChat() {
    this._toolbar.hide();
    this._freezeAuxWindowMotion(60000);
    this._recordInteraction('chat', { label: 'open', duration: 1200 });
    // 防止工具栏关闭后侧边隐藏/行走立即恢复，给聊天窗口打开留出缓冲
    this._toolbarActive = true;

    try {
      await invoke('open_chat_window', {});
      this._freezeAuxWindowMotion(60000);
      // 重新置顶宠物窗口 (JS 侧)，确保聊天窗口不盖住宠物
      window.PetRuntime.currentWindow().setAlwaysOnTop(true).catch(() => {});
    } catch (e) {
      this.showBubble('无法打开聊天窗口', 2000);
    }

    // 1.5 秒后恢复工具栏短暂锁；聊天/设置窗口打开期间仍由 _auxWindowActive 冻结移动
    setTimeout(() => { this._toolbarActive = false; }, 1500);
  }

  // ── 气泡提示 ──

  showBubble(text, duration = 2500) {
    this._clearBubble();
    const bubble = document.createElement('div');
    bubble.className = 'pet-bubble';
    bubble.textContent = text;
    Object.assign(bubble.style, {
      position: 'fixed',
      right: '8px',
      top: '8px',
      transform: 'translateY(0)',
      background: 'rgba(0,0,0,0.78)',
      color: '#fff',
      padding: '6px 10px',
      borderRadius: '10px',
      fontSize: '12px',
      fontFamily: 'sans-serif',
      maxWidth: '150px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      lineHeight: '1.45',
      textAlign: 'left',
      zIndex: '150',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 0.3s, transform 0.3s',
    });
    this._currentBubble = bubble;
    document.body.appendChild(bubble);
    requestAnimationFrame(() => {
      bubble.style.opacity = '1';
      bubble.style.transform = 'translateY(-3px)';
    });
    if (duration > 0) {
      setTimeout(() => { this._dismissBubble(bubble); }, duration);
    }
  }

  _dismissBubble(bubble) {
    if (!bubble || !bubble.parentNode) return;
    if (this._currentBubble === bubble) this._currentBubble = null;
    bubble.style.opacity = '0';
    bubble.style.transform = 'translateY(-10px)';
    setTimeout(() => bubble.remove(), 300);
  }

  _clearBubble() {
    if (this._currentBubble) {
      this._dismissBubble(this._currentBubble);
      this._currentBubble = null;
    }
  }

  _startThinkingDots() {
    this._stopThinkingDots();
    let dotCount = 1;
    const show = () => {
      if (!this._thinkingTimer) return;
      this.showBubble('.'.repeat(dotCount), 0);
      dotCount = dotCount < 10 ? dotCount + 1 : 1;
    };
    show();
    this._thinkingTimer = setInterval(show, 700);
  }

  _stopThinkingDots(finalSpeech = null) {
    if (this._thinkingTimer) {
      clearInterval(this._thinkingTimer);
      this._thinkingTimer = null;
    }
    if (finalSpeech) {
      this.showBubble(finalSpeech, Math.max(2800, finalSpeech.length * 90));
      this._ttsSpeak(finalSpeech);
    }
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
  // options: { autoEndLoops?: number, ambient?: boolean } - ambient 不占用手动交互锁
  async playAnimation(graphType, mode, onComplete, options = {}) {
    if (graphType === this.graphType && mode === this.mode && !options.foodImage && !options.autoEndLoops) {
      if (onComplete) onComplete();
      return;
    }

    // 防止并发: 如果正在切换动画则跳过 (force 模式跳过此检查)
    if (this._animatingLock && !options.force) return;
    this._animatingLock = true;
    const isAmbient = !!options.ambient;

    if (!isAmbient) {

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
    }

    try {
      await this._loadAnimation(graphType, mode);
      // startPhase: 'b_loop' — 跳过 a_start 直接进入循环阶段 (对标 VPet 拖拽行为)
      if (options.startPhase === 'b_loop') {
        this.player.goToLoop();
      }
    } catch (e) {
      console.warn('加载动画失败:', e);
    }

    // 食物中间层: 吃饭/喝水动画期间保留物品图；普通动画才清除
    if (options.foodImage) {
      try {
        await preloadFrames([options.foodImage]);
        this.player.setFoodImage(frameCache.get(options.foodImage) || null);
        this._feedingGraph = graphType;
      } catch (e) {
        console.warn('食物图加载失败:', e);
        this.player.setFoodImage(null);
        this._feedingGraph = null;
      }
    } else if (!this._feedingGraph || graphType !== this._feedingGraph) {
      this.player.setFoodImage(null);
      this._feedingGraph = null;
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
      if (e.button !== 0 || this._pressStartTime !== 0) return;
      if (this._isUiPointerTarget(e.target)) return;
      this._beginPress(e);
    });

    // 拖拽窗口：mousedown on canvas
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const point = this._pointerLogicalFromEvent(e);
      this._beginPress(e, point);
      e.preventDefault();
    });

    // SideHide 悬停 — 鼠标进入时立即弹出，离开时立即缩回
    this.canvas.addEventListener('mouseenter', () => {
      if (this.graphType === 'sidehide_left_main') {
        this.playAnimation('sidehide_left_rise', this.mode, null, { force: true });
      } else if (this.graphType === 'sidehide_right_main') {
        this.playAnimation('sidehide_right_rise', this.mode, null, { force: true });
      }
    });
    this.canvas.addEventListener('mouseleave', () => {
      if (this.graphType === 'sidehide_left_rise') {
        this.playAnimation('sidehide_left_main', this.mode, null, { force: true });
      } else if (this.graphType === 'sidehide_right_rise') {
        this.playAnimation('sidehide_right_main', this.mode, null, { force: true });
      }
    });

    // 全局 mousemove (用于窗口拖拽 + VPet 挥手检测)
    window.addEventListener('mousemove', (e) => {
      if (e.buttons !== 1) {
        this._updateHoverFromEvent(e);
        if (this._dragging || this._raiseHoldActive) {
          this._finishDrag(e);
        } else {
          // 无按键移动时进行挥手检测 (对标 VPet MouseMove wave detection)
          this._tickWaveDetection(e);
        }
        return;
      }

      if (!this._pressStartTime) return;

      if (!this._dragging) {
        const dx = Math.abs(e.screenX - this._dragStartX);
        const dy = Math.abs(e.screenY - this._dragStartY);
        if (dx > MOUSE_DRAG_THRESHOLD_PX || dy > MOUSE_DRAG_THRESHOLD_PX) {
          this._dragging = true;
          document.body.classList.add('dragging');
          this._beginDragAnimation();
        }
      }

      if (this._dragging) {
        const dScreenX = e.screenX - this._dragStartX;
        const dScreenY = e.screenY - this._dragStartY;
        this._dragLastDx = dScreenX;
        this._dragStartX = e.screenX;
        this._dragStartY = e.screenY;
        this._walkPauseUntil = performance.now() + 1800;
        invoke('move_window_by', { dx: dScreenX, dy: dScreenY }).catch(() => {});
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      if (this._dragging || this._raiseHoldActive) {
        e.preventDefault();
        this._finishDrag(e);
        return;
      }
      if (e.target !== this.canvas) {
        this._finishClickPress(e);
      }
    });

    // mouseup on canvas
    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      if (this._finishDrag(e)) return;
      const point = this._pointerLogicalFromEvent(e);
      this._finishClickPress(e, point);
    });

    // 右键菜单 — 只暂停闲逛并切换底部工具栏，不重启当前工作/玩耍动画
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._clearPressTimer();
      this._pauseRoamingForMenu();
      this._toolbar.toggle();
    });
  }

  _beginDragAnimation() {
    if (this._dragReleaseTimer) { clearTimeout(this._dragReleaseTimer); this._dragReleaseTimer = null; }
    if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
    if (this._musicActive) this._stopMusicDance({ restore: false });
    this._walkPauseUntil = performance.now() + 1800;
    this._manualSleepMode = false;
    this._manualAnimLock = true;
    if (this.graphType !== 'raise') {
      // a_start = 被抓起动画, b_loop = 悬空循环, c_end = 落地动画 (对标 VPet Raised_Static 三段)
      this.playAnimation('raise', this.mode || 'normal', null, { force: true });
    }
  }

  _finishDrag(e) {
    const wasDragging = this._dragging;
    const wasHolding = this._raiseHoldActive;
    if (!wasDragging && !wasHolding) return false;

    this._clearPressTimer();
    this._dragging = false;
    this._raiseHoldActive = false;
    this._pressStartTime = 0;
    this._pressPart = null;
    document.body.classList.remove('dragging');
    this._recordInteraction('drag', { label: wasDragging ? 'move' : 'hold', duration: 1200 });
    invoke('process_interaction', { lx: this._pressStartLogical.x, ly: this._pressStartLogical.y, pressDurationMs: 0, hasMoved: true }).catch(() => {});

    if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
    if (this._dragReleaseTimer) { clearTimeout(this._dragReleaseTimer); this._dragReleaseTimer = null; }

    const mood = this.mode || 'normal';

    // VPet 落地逻辑: 根据拖拽速度计算摔跤概率
    const speed = Math.abs(this._dragLastDx || 0);
    const moodPenalty = mood === 'ill' ? 0.25 : mood === 'poorCondition' ? 0.16 : 0;
    const motionPenalty = Math.min(0.35, speed / 90);
    const fallChance = Math.min(0.72, Math.max(0.08, 0.12 + moodPenalty + motionPenalty));
    const isFall = Math.random() < fallChance;

    const msgs = isFall
      ? ['哎呀，摔了一下喵...', '落地失败喵...', '主人要轻一点喵~']
      : ['安全落地喵~', '站稳啦！', '轻轻落地喵~'];
    const releaseMsg = msgs[Math.floor(Math.random() * msgs.length)];

    this._manualAnimLock = true;
    this._walkPauseUntil = performance.now() + 3500;
    this.showBubble(releaseMsg, 2200);
    this._dragReleaseTimer = null;

    // 对标 VPet: 播放 raise c_end (落地收尾动画), 结束后回到 idle
    // raise 已拆分为 a_start/b_loop/c_end 三段, triggerEnd 触发 c_end 落地帧
    this.player.triggerEnd(() => {
      this._manualAnimLock = false;
      if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
      if (!this._wasWorking || !this._currentWorkContext?.graph) this._returnToIdle(mood);
      else this._scheduleWorkResumeAfterInterrupt(mood);
    });
    if (e) e.preventDefault();
    return true;
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

  _workCategoryFrom(graph = '', type = '') {
    const value = String(graph || '').toLowerCase();
    const kind = String(type || '').toLowerCase();
    if (kind === 'play' || ['playone', 'removeobject', 'ropeskipping'].includes(value)) return 'play';
    if (kind === 'study' || ['study', 'studytwo', 'calligraphy', 'studypaint'].includes(value)) return 'study';
    return 'work';
  }

  _rememberWorkContext(result = {}) {
    const work = result.work || {};
    const graph = result.graphType || result.graph || work.graph || this._currentWorkContext?.graph;
    if (!graph || graph === 'default') return null;
    const type = result.workType || result.type || work.type || this._currentWorkContext?.type || '';
    const category = this._workCategoryFrom(graph, type);
    const labels = { work: '工作', study: '学习', play: '玩耍' };
    const context = {
      graph,
      type,
      category,
      categoryLabel: labels[category] || '任务',
      speechType: category === 'play' ? 'play' : 'work',
      name: result.workName || result.name || work.name || this._currentWorkContext?.name || labels[category] || '任务',
      mood: result.mood || this.mode || 'normal',
    };
    this._currentWorkContext = context;
    this._wasWorking = true;
    return context;
  }

  _clearManualAnimationLock() {
    this._manualAnimLock = false;
    if (this._manualAnimTimer) {
      clearTimeout(this._manualAnimTimer);
      this._manualAnimTimer = null;
    }
  }

  _returnToIdle(mood = this.mode, options = {}) {
    this._wasWorking = false;
    this._currentWorkContext = null;
    this._manualSleepMode = false;
    this._clearManualAnimationLock();
    this._walkGraphType = 'default';
    this._walkPauseUntil = performance.now() + 1200;
    this._animatingLock = false;
    this.playAnimation('default', mood || 'normal', null, { ambient: !!options.ambient });
  }

  _returnToBaseState(mood = this.mode, options = {}) {
    this._manualSleepMode = false;
    this._clearManualAnimationLock();
    this._animatingLock = false;
    this._walkPauseUntil = performance.now() + 1200;

    const context = this._wasWorking ? this._currentWorkContext : null;
    if (context?.graph) {
      this._walkGraphType = context.graph;
      this.playAnimation(context.graph, mood || context.mood || 'normal', null, { ambient: !!options.ambient });
      return;
    }

    this._returnToIdle(mood, options);
  }

  _scheduleWorkResumeAfterInterrupt(mood = this.mode) {
    const context = this._currentWorkContext;
    if (!this._wasWorking || !context?.graph) {
      this._returnToIdle(mood);
      return;
    }
    if (this._resumeWorkTimer) {
      clearTimeout(this._resumeWorkTimer);
      this._resumeWorkTimer = null;
    }
    this._resumeWorkTimer = setTimeout(() => {
      this._resumeWorkTimer = null;
      if (!this._wasWorking || !this._currentWorkContext?.graph) return;
      this.showBubble(`我要继续${this._currentWorkContext.categoryLabel}了`, 1800);
      this._returnToBaseState(mood, { ambient: true });
    }, 900);
  }

  _pauseRoamingForMenu() {
    this._walkPauseUntil = performance.now() + 2500;
    this._manualSleepMode = false;
    this._animatingLock = false;
    if (this._wasWorking && this._currentWorkContext?.graph) {
      this._clearManualAnimationLock();
      return;
    }
    if (['eat', 'drink', 'raise', 'sleep'].includes(this.graphType)) return;
    this._walkGraphType = 'default';
    this._clearManualAnimationLock();
    invoke('reset_walk_state', {}).catch(() => {});
    this.playAnimation('default', this.mode || 'normal', null, { ambient: true });
  }

  _stopRoamingAndReturnToIdle() {
    this._pauseRoamingForMenu();
  }

  _wakeFromManualSleep() {
    if (!this._manualSleepMode) return false;
    this._stopRoamingAndReturnToIdle();
    this.showBubble('起床啦!', 1500);
    return true;
  }

  async _onClickPart(lx, ly, pressDurationMs) {
    if (this._dragging) return;

    const part = this._hitTestLogical(lx, ly);
    if (!part) return;
    if (this._manualSleepMode) {
      this._wakeFromManualSleep();
      return;
    }

    // 防抖: 300ms 内不允许重复点击 (防止多次点击导致 Rust 锁竞争)
    if (this._lastClickTime && performance.now() - this._lastClickTime < 300) return;
    this._lastClickTime = performance.now();

    const interaction = this._recordInteraction('touch', { part, duration: 1600 });
    try {
      const result = await invoke('process_interaction', {
        lx, ly, pressDurationMs, hasMoved: false,
      });
      const touchGraph = part === 'head' ? 'touch_head' : 'touch_body';
      if (this._hasAnimationGraph(touchGraph)) {
        this.playAnimation(touchGraph, result?.mood || interaction.mood || 'normal', () => {
          this._returnToBaseState(result?.mood || interaction.mood || 'normal');
        }, { autoEndLoops: 1 });
      } else {
        this._applyInteractionResult(result, interaction.mood || 'normal');
      }
    } catch (e) {
      console.warn('交互处理失败:', e);
      const fallbackGraph = part === 'head' ? 'touch_head' : 'touch_body';
      if (this._hasAnimationGraph(fallbackGraph)) this.playAnimation(fallbackGraph, this.mode || 'normal');
      else this._returnToBaseState(this.mode || 'normal');
    }
  }

  async _handleFeed() {
    try { await invoke('open_food_panel', { filter: 'food' }); } catch (_) { this.showBubble('菜单打不开...', 2000); }
  }

  async _handleDrink() {
    try { await invoke('open_food_panel', { filter: 'drink' }); } catch (_) { this.showBubble('菜单打不开...', 2000); }
  }

  // 从食物菜单选定具体食物 — 调后端 pet_action_eat, 播放对应三层动画
  async _handleEatFood(name, graphHint = '') {
    const normalizedName = String(name || '食物');
    const type = graphHint === 'drink' ? 'drink' : 'feed';
    this._recordInteraction(type, { label: normalizedName, duration: 1600, suppressFeedback: true });
    try {
      const result = await invoke('pet_action_eat', { foodName: name });
      // 金币不足时给出提示并中止
      if (result.canAfford === false) {
        this.showBubble(result.message || '金币不足！先去工作赚钱吧~', 2800);
        return;
      }
      this._wasWorking = false;
      this._manualSleepMode = false;
      const graph = result.graphType || graphHint || 'eat';
      const speechType = graph === 'drink' ? 'drink' : 'feed';
      const label = result.foodName || normalizedName;
      this._speakSceneProactive({ type: speechType, label, foodName: label }).catch(() => {});
      // 强制清除并发锁, 确保动画不被行走tick阻断
      this._animatingLock = false;
      await this.playAnimation(graph, result.mood || 'normal', null, { foodImage: result.foodImage });
      // 吃/喝完后先播一次开心表情，再回待机
      setTimeout(() => {
        if (this.graphType !== graph) return;
        const happyGraph = this._pickAmbientGraph(['touch_head', 'switch', 'think']);
        this._animatingLock = false;
        if (happyGraph && this._hasAnimationGraph(happyGraph)) {
          this.playAnimation(happyGraph, 'happy', () => {
            this._returnToIdle(result.mood || this.mode);
          }, { autoEndLoops: 1 });
        } else {
          this._returnToIdle(result.mood || this.mode);
        }
      }, 3800);
      if (result.message) console.log('[Pet]:', result.message);
    } catch(e) { this.showBubble(type === 'drink' ? '喝不了...' : '吃不了...', 2000); }
  }

  async _handlePlay(playType = null) {
    this._recordInteraction('play', { label: playType || 'menu-play', duration: 1600, suppressFeedback: true });
    try {
      const result = await invoke('pet_action_play', { playType });
      if (result.workStarted) {
        const context = this._rememberWorkContext(result);
        const name = result.workName || context?.name || '玩耍';
        this._speakSceneProactive({ type: 'play', label: name, workName: name }, {
          minIntervalMs: PROACTIVE_SCENE_AI_MIN_MS,
          typeMinIntervalMs: PROACTIVE_SCENE_CONTEXT_MIN_MS,
        }).catch(() => {});
        if (result.graphType) this.playAnimation(result.graphType, result.mood || 'normal');
      } else {
        if (result.graphType) this.playAnimation(result.graphType, result.mood || 'normal');
        if (result.message) this.showBubble(result.message, 2500);
      }
    } catch(e) { this.playAnimation('default', 'happy'); }
  }

  async _handlePinch() {
    this._recordInteraction('pinch', { part: 'head', duration: 1600 });
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
    this._recordInteraction('work', { label: type, duration: 1400, suppressFeedback: true });
    try {
      const result = await invoke('pet_action_work', { workType: type });
      if (result.workStarted) {
        const context = this._rememberWorkContext(result);
        const name = result.workName || context?.name || '工作';
        this._speakSceneProactive({ type: context?.speechType || 'work', label: name, workName: name }).catch(() => {});
        if (result.graphType) this.playAnimation(result.graphType, result.mood || 'normal');
      } else if (result.message) {
        this.showBubble(result.message, 2500);
      }
    } catch(e) { console.warn('工作启动失败:', e); }
  }

  async _handleStopWork() {
    try {
      const result = await invoke('pet_action_stop_work', {});
      this._wasWorking = false;
      this._manualAnimLock = false;
      if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
      this.playAnimation(result.graphType || 'default', result.mood || this.mode || 'normal');
      if (result.message) this.showBubble(result.message, 2000);
    } catch(e) { console.warn('停止工作失败:', e); }
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

    const img = this.player.currentImage || this._lastRenderImage;
    if (!img) return;
    if (this.player.currentImage) this._lastRenderImage = this.player.currentImage;

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
    if (this._dragging || this._manualSleepMode || this._manualAnimLock) return;
    if (performance.now() < this._walkPauseUntil) return;
    if (this._toolbarActive || this._auxWindowActive || this._musicActive || this._mischiefBusy) return;  // 工具栏/聊天/设置打开时暂停行走
    if (performance.now() < this._chatActiveUntil) return;
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

      if (result.edgeHit) {
        this._walkPauseUntil = performance.now() + 900;
      }

      const nextGraphType = this._resolveWalkGraphType(result);

      // 记录朝向；行走图片直接使用 VPet 的 left/right 资源，不再靠画布翻转伪造方向
      this._facingRight = result.facingRight !== false;
      this.canvas.style.transform = '';

      // 自主巡游/闲置切换属于环境动作，不占用手动动画锁
      // 走路动画只在实际移动时触发，避免 Idle→Walking 切换首帧出现"有动画无移动"的问题
      if (nextGraphType && nextGraphType !== this._walkGraphType) {
        const isWalkAnim = nextGraphType.startsWith('move.walk.');
        const hasMoved = result.dx !== 0 || result.dy !== 0;
        if (!isWalkAnim || hasMoved) {
          this._walkGraphType = nextGraphType;
          if (!this._manualAnimLock) {
            this.playAnimation(nextGraphType, this.mode, null, { ambient: true });
          }
        }
      }
    } catch (e) { /* 静默 */ }
  }

  // ── 点击穿透 ──
  // 轮询检测鼠标是否在宠物精灵非透明像素上，动态切换窗口点击穿透

  async _checkClickthrough() {
    const panelActive = !!(this.chatUI && this.chatUI.isVisible);
    if (this._dragging || this._toolbarActive || this._auxWindowActive || panelActive) {
      if (this._clickthroughEnabled) {
        this._clickthroughEnabled = false;
        invoke('set_clickthrough', { enabled: false }).catch(() => {});
      }
      return;
    }

    try {
      const [pos, cursorPos] = await Promise.all([
        invoke('get_window_position', {}),
        window.PetRuntime.cursorPosition(null),
      ]);
      if (!cursorPos || !pos) return;

      const inWindow =
        cursorPos.x >= pos.x && cursorPos.x <= pos.x + pos.width &&
        cursorPos.y >= pos.y && cursorPos.y <= pos.y + pos.height;

      if (!inWindow) {
        if (!this._clickthroughEnabled) {
          this._clickthroughEnabled = true;
          invoke('set_clickthrough', { enabled: true }).catch(() => {});
        }
        return;
      }

      const rect = this.canvas.getBoundingClientRect();
      const viewportWidth = Math.max(1, window.innerWidth || rect.width || this.canvas.width);
      const viewportHeight = Math.max(1, window.innerHeight || rect.height || this.canvas.height);
      const physicalToCssX = viewportWidth / Math.max(1, pos.width);
      const physicalToCssY = viewportHeight / Math.max(1, pos.height);
      const clientX = (cursorPos.x - pos.x) * physicalToCssX;
      const clientY = (cursorPos.y - pos.y) * physicalToCssY;
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const canvasX = localX * (this.canvas.width / Math.max(1, rect.width));
      const canvasY = localY * (this.canvas.height / Math.max(1, rect.height));

      if (canvasX < 0 || canvasY < 0 || canvasX >= this.canvas.width || canvasY >= this.canvas.height) {
        if (!this._clickthroughEnabled) {
          this._clickthroughEnabled = true;
          invoke('set_clickthrough', { enabled: true }).catch(() => {});
        }
        return;
      }

      let hasPixel = false;
      try {
        const pixelX = Math.max(0, Math.min(this.canvas.width - 1, Math.floor(canvasX)));
        const pixelY = Math.max(0, Math.min(this.canvas.height - 1, Math.floor(canvasY)));
        const pixelData = this.ctx.getImageData(pixelX, pixelY, 1, 1);
        hasPixel = pixelData && pixelData.data[3] > 24;
      } catch (_) {
        hasPixel = false;
      }

      if (hasPixel) {
        if (this._clickthroughEnabled) {
          this._clickthroughEnabled = false;
          invoke('set_clickthrough', { enabled: false }).catch(() => {});
        }
      } else if (!this._clickthroughEnabled) {
        this._clickthroughEnabled = true;
        invoke('set_clickthrough', { enabled: true }).catch(() => {});
      }
    } catch (_) { /* 静默 */ }
  }

  // ── SideHide 边缘检测 ──

  async _checkSideHide() {
    if (this._dragging || this._manualSleepMode || this._manualAnimLock || this._toolbarActive || this._auxWindowActive || this._musicActive || this._mischiefBusy) return;
    if (performance.now() < this._chatActiveUntil) return;
    if (this.chatUI && this.chatUI._isSending) return;
    // 聊天/设置窗口打开时暂停侧边隐藏, 防止宠物被滑出屏幕
    try {
      if (await invoke('aux_window_visible', {})) return;
    } catch (_) { /* 命令不可用时忽略 */ }
    try {
      const [pos, screen, mousePos] = await Promise.all([
        invoke('get_window_position', {}),
        invoke('get_screen_info', {}),
        window.PetRuntime.cursorPosition({ x: 0, y: 0 }),
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
    this.app._markChatActive(15000);
    this.app._recordInteraction('chat', { label: 'panel-open', duration: 1200 });
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
    this.app._markChatActive(20000);
    this.app._recordInteraction('chat', { label: 'send', duration: 1200 });

    this._addBubble('user', msg);
    const bubble = this._addBubble('assistant', '...');
    // 宠物气泡显示等待
    this.app.showBubble('让我想想该说什么呢...', 0);

    try {
      const config = await invoke('load_llm_config', {});
      const hasApiKey = await invoke('has_llm_api_key', {});
      if (!hasApiKey) { bubble.el.textContent = '请先在设置中配置 API Key'; this.app._clearBubble(); this._isSending = false; return; }

      const status = await invoke('get_pet_status', {});
      const prompt = await invoke('build_persona_prompt', {
        customPrompt: null, mood: status.mood || 'normal',
        hunger: status.stats.hunger, happiness: status.stats.happiness,
        isWorking: false,
      });

      let fullText = '';
      const unlistenChunk = await window.PetRuntime.listen('llm-stream-chunk', (event) => {
        fullText += event.payload;
        bubble.el.textContent = fullText;
        this.msgArea.scrollTop = this.msgArea.scrollHeight;
      });
      const unlistenDone = await window.PetRuntime.listen('llm-stream-done', (event) => {
        const final = event.payload || fullText;
        bubble.el.textContent = final;
        this._isSending = false;
        this.app._clearBubble();
        if (final) {
          this.app._markChatActive(Math.max(12000, final.length * 80));
          this.app._recordInteraction('chat', { label: 'reply', duration: 1200 });
          this.app.showBubble(final, Math.max(3000, final.length * 80));
          this.app._ttsSpeak(final);
        }
      });

      const newHistory = await invoke('chat_stream', {
        message: msg, config, systemPrompt: prompt, history: this.history,
      });
      this.history = newHistory;

      setTimeout(() => { unlistenChunk(); unlistenDone(); }, 500);
    } catch (e) {
      const errMsg = typeof e === 'string' ? e : (e?.message || e?.toString() || JSON.stringify(e) || '未知错误');
      bubble.el.textContent = `请求失败: ${errMsg}`;
      this.app._clearBubble();
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
    this.app._toolbar.hide();
    this.app._freezeAuxWindowMotion(60000);
    this.app._toolbarActive = true;
    try {
      await invoke('open_settings_window', {});
      this.app._freezeAuxWindowMotion(60000);
    } catch (e) {
      console.warn('打开设置窗口失败:', e);
      this.app.showBubble('无法打开设置窗口', 2000);
    }
    setTimeout(() => { this.app._toolbarActive = false; }, 1500);
  }

  hide() {}
}

window.addEventListener('DOMContentLoaded', () => {
  new DesktopPetApp();
});