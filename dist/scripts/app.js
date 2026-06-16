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
const CHATTER_AI_INTERVAL_MS = 30000;
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
// VPet SayRnd 对标：按心情分类的静态随机台词池
const SAY_RND_INTERVAL_MS = 75000;
const SAY_RND_POOL = {
  happy: [
    '今天真是个好日子喵~', '心情超好！想到处跑！', '嘿嘿，主人在吗~',
    '阳光好暖！', '想唱歌！', '好饱好幸福喵~', '今天的一切都刚刚好！',
    '呼噜呼噜……', '嗯～好满足哦。', '有你陪着我真好！',
  ],
  normal: [
    '……嗯。', '在想一件事。', '主人，你还在吗？',
    '风好像变了。', '该吃点什么呢……', '有点无聊喵。',
    '伸个大懒腰～', '静静地待着也不错。', '嗯嗯……',
  ],
  poorCondition: [
    '唔……有点累了。', '身体有点沉……', '想睡觉。',
    '能帮我拿点吃的吗……', '不太舒服喵……', '喝点水好了……',
    '今天真难熬。', '主人……', '有点不得劲……',
  ],
  ill: [
    '呜……头好晕。', '好冷……', '需要休息一下。',
    '主人……帮我一下……', '喵……身体不太好……', '发烧了吗……',
  ],
};
const MOUSE_LONG_PRESS_MS = 300;
const MOUSE_DRAG_THRESHOLD_PX = 3;
const PROACTIVE_AI_MIN_MS = 20000;
const PROACTIVE_AI_CONTEXT_MIN_MS = 60000;
const PROACTIVE_SCENE_AI_MIN_MS = 45000;
const PROACTIVE_SCENE_CONTEXT_MIN_MS = 90000;
const PROACTIVE_IDLE_MS = 180000;
const PROACTIVE_SOFT_IDLE_MS = 90000;
const PROACTIVE_SPEECH_MAX_CHARS = 72;
const SING_SPEECH_MAX_CHARS = 96;
const SING_PERFORMANCE_LOCK_MS = 11000;
const TTS_DEDUPE_WINDOW_MS = 3000;
const PET_BODY_VIEWPORT_SIZE = 250;
const FOOD_ANIMATION_LOGICAL_SIZE = 500;
const PET_BUBBLE_AREA_HEIGHT = 128;
const PET_BUBBLE_MAX_HEIGHT = PET_BUBBLE_AREA_HEIGHT - 10;
const EDGE_CLIMB_STEP_PX = 12;
const EDGE_FALL_STEP_PX = 48;
const EDGE_FALL_TICK_MS = 24;
const EDGE_FALL_BOTTOM_SAFE_GAP_PX = 56;
// 爬墙单次最长时长 (超时强制结束, 防止卡在边缘); 对标 VPet 爬墙是短暂行为
const EDGE_CLIMB_MAX_MS = 45000;
// 对标 VPet: 撞到屏幕边缘后多数情况转身继续走, 仅小概率触发爬墙
const EDGE_CLIMB_CHANCE = 0.2;
// 一次撞墙(无论是否爬墙)后的爬墙冷却, 避免在边缘反复试探
const EDGE_CLIMB_COOLDOWN_MS = 12000;
// 拖拽松手时距地面超过该高度 → 触发重力下坠安全落地
// 距地面高于屏幕工作区高度的此比例才触发重力下坠 — 太小会导致轻微拖动也演一整套坠落动画
const GRAVITY_DROP_MIN_RATIO = 0.3;
// 工作区高度不可用时的兜底触发距离
const GRAVITY_DROP_MIN_HEIGHT_PX = 150;
const GRAVITY_DROP_TICK_MS = 24;
const GRAVITY_DROP_ACCEL_PX = 7;
const GRAVITY_DROP_MAX_SPEED_PX = 68;
const GRAPH_TYPE_ALIASES = {
  idle: [
    'idle_yawning',
    'idle_meow',
    'idle_aside',
    'idle_squat',
    'idle_boring',
    'idle_bubbles',
    'idle_tennis',
    'idle_amusement_b',
    'idle_happy_like520',
    'idle_meowlook',
  ],
  switch: ['switch_down', 'switch_up', 'switch_hunger', 'switch_thirsty'],
  state: ['stateone', 'statetwo'],
};

// ── TTS 音频播放 ──
// onStarted 在音频真正开始播放(source.start)那一刻回调 — 用于让文字气泡与语音严格同步
function playBase64Wav(base64, onEnded = null, onStarted = null) {
  let audioCtx = null;
  let source = null;
  let stopped = false;
  let closed = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    if (typeof onEnded === 'function') onEnded();
    if (audioCtx) audioCtx.close().catch(() => {});
  };

  const handle = {
    get closed() {
      return closed;
    },
    stop() {
      stopped = true;
      try { if (source) source.stop(0); } catch (_) {}
      try { if (source) source.disconnect(); } catch (_) {}
      finish();
    },
  };

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const doPlay = (buffer) => {
      if (stopped) { finish(); return; }
      source = audioCtx.createBufferSource();
      source.buffer = buffer;
      const vol = typeof window.__petVolume === 'number' ? Math.max(0, Math.min(1, window.__petVolume)) : 1;
      if (vol >= 0.999) {
        source.connect(audioCtx.destination);
      } else {
        const gain = audioCtx.createGain();
        gain.gain.value = vol;
        source.connect(gain);
        gain.connect(audioCtx.destination);
      }
      source.onended = finish;
      source.start(0);
      if (typeof onStarted === 'function') {
        try { onStarted(); } catch (_) {}
      }
    };
    const decode = () => {
      audioCtx.decodeAudioData(bytes.buffer.slice(0), doPlay,
        (e) => { console.warn('TTS 解码失败:', e); finish(); });
    };
    // WebView2/Chrome 可能在无用户手势时挂起 AudioContext，先 resume 再播
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(decode).catch(() => { decode(); });
    } else {
      decode();
    }
  } catch (e) {
    console.warn('TTS 播放失败:', e);
    finish();
  }

  return handle;
}

// ── 帧缓存 ──
const frameCache = new Map(); // path → Image
// phases 元数据缓存：避免对同一动画重复发起 IPC 调用
const phasesCache = new Map(); // "graphType|mode" → phases

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
    this.foodDone = false;
    this.frontDone = false;
    this.mainLoopDone = false;
    this.syncOverlayToMainLoop = false;
    this.overlayLoopDuration = 0;
    this.overlayLoopAccumulator = 0;
    this.pendingOverlayEnd = false;
    this.onLoopCycle = null;
  }

  _frameDuration(frame, fallback = 125) {
    const duration = Number(frame?.duration ?? frame?.time ?? fallback);
    return Number.isFinite(duration) && duration > 0 ? duration : fallback;
  }

  _foodFrameDuration(frame, fallback = 125) {
    const duration = Number(frame?.time ?? frame?.duration ?? fallback);
    return Number.isFinite(duration) && duration > 0 ? duration : fallback;
  }

  _sumDurations(frames, durationKey = 'duration') {
    return (frames || []).reduce((sum, frame) => {
      const duration = durationKey === 'time'
        ? this._foodFrameDuration(frame)
        : this._frameDuration(frame);
      return sum + duration;
    }, 0);
  }

  _resetSyncedLoopLayers() {
    const frames = this.phases.b_loop || [];
    this.currentIndex = 0;
    this.accumulator = 0;
    this.mainLoopDone = false;
    if (frames.length > 0) this._updateCurrentFrame();

    this.frontIndex = 0;
    this.frontAccumulator = 0;
    this.frontDone = false;
    if (this.frontFrames.length > 0) this._updateFrontFrame();
    else this.frontImage = null;

    this.foodIndex = 0;
    this.foodAccumulator = 0;
    this.foodDone = false;
  }

  _emitLoopCycle(meta = {}) {
    if (typeof this.onLoopCycle !== 'function') return;
    try {
      this.onLoopCycle(meta);
    } catch (e) {
      console.warn('循环回调失败:', e);
    }
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
    this.overlayLoopDuration = Math.max(
      this._sumDurations(this.phases.b_loop),
      this._sumDurations(this.frontFrames),
      this._sumDurations(this.foodKeyframes, 'time'),
    );
    this.foodIndex = 0;
    this.foodAccumulator = 0;
    this.foodDone = false;
    this.frontDone = false;
    this.mainLoopDone = false;
    this.syncOverlayToMainLoop = false;
    this.overlayLoopAccumulator = 0;
    this.pendingOverlayEnd = false;
  }

  // 设置食物图 (吃饭/喝水时由后端返回的 foodImage 提供)
  setFoodImage(img) {
    this.foodImage = img || null;
    this.syncOverlayToMainLoop = !!img;
    this.frontIndex = 0;
    this.frontAccumulator = 0;
    this.frontDone = false;
    this.foodIndex = 0;
    this.foodAccumulator = 0;
    this.foodDone = false;
    this.mainLoopDone = false;
    this.overlayLoopAccumulator = 0;
    this.pendingOverlayEnd = false;
    if (this.syncOverlayToMainLoop) {
      if (this.currentPhase === 'b_loop') {
        this.currentIndex = 0;
        this.accumulator = 0;
        this._updateCurrentFrame();
      }
      if (this.frontFrames.length > 0) this._updateFrontFrame();
    }
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
    this.frontDone = false;
    this.foodIndex = 0;
    this.foodAccumulator = 0;
    this.foodDone = false;
    this.mainLoopDone = false;
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

    const syncSingleRun = this.syncOverlayToMainLoop && this.currentPhase === 'b_loop';
    if (!syncSingleRun && this.currentPhase === 'b_loop') {
      this.mainLoopDone = false;
    }
    if (syncSingleRun && this.overlayLoopDuration > 0) {
      this.overlayLoopAccumulator += dt;
    }

    if (!this.mainLoopDone) {
      this.accumulator += dt;

      while (this.accumulator >= this._frameDuration({ duration: this.currentDuration }) && this.isPlaying) {
        this.accumulator -= this._frameDuration({ duration: this.currentDuration });
        this.currentIndex++;

        if (this.currentIndex >= frames.length) {
          if (this.currentPhase === 'b_loop') {
            if (syncSingleRun) {
              this.currentIndex = Math.max(0, frames.length - 1);
              this.accumulator = 0;
              this.mainLoopDone = true;
              this._updateCurrentFrame();
              break;
            }
            this.currentIndex = 0;
            this._updateCurrentFrame();
            this._emitLoopCycle({ composite: false });
            if (!this.isPlaying || this.currentPhase !== 'b_loop') return;
            continue;
          } else {
            this._advancePhase();
            return;
          }
        }

        this._updateCurrentFrame();
      }
    }

    // 前景叠加层推进；夹心动作跟随复合周期统一复位，普通动作继续循环
    if (this.frontFrames.length > 0 && this.frontDuration > 0 && !this.frontDone) {
      this.frontAccumulator += dt;
      while (this.frontAccumulator >= this.frontDuration) {
        this.frontAccumulator -= this.frontDuration;
        this.frontIndex++;
        if (this.frontIndex >= this.frontFrames.length) {
          if (syncSingleRun) {
            this.frontIndex = Math.max(0, this.frontFrames.length - 1);
            this.frontAccumulator = 0;
            this.frontDone = true;
            this._updateFrontFrame();
            break;
          }
          this.frontIndex = 0;
        }
        this._updateFrontFrame();
      }
    }

    // 食物中间层关键帧推进；夹心动作跟随复合周期统一复位，避免身体/手/杯子逐圈错位
    if (this.foodKeyframes.length > 0 && !this.foodDone) {
      this.foodAccumulator += dt;
      let kf = this.foodKeyframes[this.foodIndex];
      while (kf && this.foodAccumulator >= this._foodFrameDuration(kf)) {
        this.foodAccumulator -= this._foodFrameDuration(kf);
        this.foodIndex++;
        if (this.foodIndex >= this.foodKeyframes.length) {
          if (syncSingleRun) {
            this.foodIndex = Math.max(0, this.foodKeyframes.length - 1);
            this.foodAccumulator = 0;
            this.foodDone = true;
            break;
          }
          this.foodIndex = 0;
        }
        kf = this.foodKeyframes[this.foodIndex];
      }
    }

    if (syncSingleRun && this.overlayLoopDuration > 0) {
      while (this.overlayLoopAccumulator >= this.overlayLoopDuration && this.isPlaying && this.currentPhase === 'b_loop') {
        this.overlayLoopAccumulator -= this.overlayLoopDuration;
        this._emitLoopCycle({ composite: true });
        if (!this.isPlaying) return;
        if (this.pendingOverlayEnd) {
          this.pendingOverlayEnd = false;
          this._advancePhase();
          return;
        }
        if (this.currentPhase !== 'b_loop') return;
        this._resetSyncedLoopLayers();
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

  // 直接跳到 c_end，用于只播放落地/收尾段
  goToEnd() {
    if (this.phases.c_end.length > 0) {
      this.currentPhase = 'c_end';
      this.currentIndex = 0;
      this.accumulator = 0;
      this.isPlaying = true;
      this._updateCurrentFrame();
    }
  }

  // 触发结束动画 (从 b_loop 切到 c_end)
  triggerEnd(onComplete) {
    if (this.phases.c_end.length > 0 && this.currentPhase === 'b_loop') {
      this.onComplete = onComplete;
      if (this.syncOverlayToMainLoop && this.overlayLoopDuration > 0) {
        this.pendingOverlayEnd = true;
        return;
      }
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

    this.currentDuration = this._frameDuration(frame);
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
      { id: 'monitor', label: '监控',  hasSub: true },
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
        else if (col.id === 'monitor') { this._showMonitorSub(tab); }
        else if (col.id === 'diy') { this.hide(); this.app.showBubble('暂无自定功能', 1500); }
        else if (col.id === 'panel') { this._showPanel(); }
      });

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

  _createCompactModal(titleText, options = {}) {
    const mask = document.createElement('div');
    mask.className = 'tb-panel';
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      mask.remove();
      if (typeof options.onClose === 'function') options.onClose();
    };
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
    closeBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); close(); });
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    mask.addEventListener('mousedown', close);
    document.body.appendChild(mask);
    mask.appendChild(panel);
    this.app._stopUiPointerEvents(mask);
    return { mask, panel, close };
  }

  _showFeedSub(anchor) {
    const items = [
      { label: '食物',   action: () => this._showFoodMenu('eat') },
      { label: '饮品',   action: () => this._showFoodMenu('drink') },
      { label: '全部投喂', action: () => this._showFoodMenu() },
      { label: '随机吃', action: () => { this.hide(); this.app._handleFeed(); } },
      { label: '随机喝', action: () => { this.hide(); this.app._handleDrink(); } },
      { label: '🛒 商店', action: () => { this.hide(); invoke('open_shop_panel', {}).catch(() => this.app.showBubble('商店打不开...', 1500)); } },
    ];
    // 生病时才显示药品入口
    if (this.app.mode === 'ill') {
      items.unshift({ label: '🩺 药品', action: () => this._showFoodMenu('medicine') });
    }
    this._showSubmenu(anchor, items);
  }

  // 食物菜单 — 打开独立弹窗
  async _showFoodMenu(graphFilter = null) {
    this.hide();
    try {
      await invoke('open_food_panel', { filter: graphFilter });
    } catch (_) {
      this.app.showBubble('菜单打开失败', 1500);
    }
  }

  // 工作面板 — 打开独立弹窗
  async _showWorkPanel(kind) {
    this.hide();
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
      { label: '🎁 送礼物', action: () => { this.hide(); this.app._handleGift(); } },
      { label: '唱歌', action: () => this._showSingPrompt() },
      { label: '🎮 追逐游戏', action: () => { this.hide(); this.app._startChaseGame(); } },
      { label: '玩耍面板', action: () => this._showWorkPanel('play') },
      { label: '工作面板', action: () => this._showWorkPanel('work') },
    ];
    if (this.app._wasWorking) {
      items.push({ label: '停止任务', action: () => { this.hide(); this.app._handleStopWork(); } });
    }
    items.push({ label: '📅 日程表', action: () => { this.hide(); invoke('open_schedule_panel', {}).catch(() => this.app.showBubble('日程表打不开...', 1500)); } });
    items.push({ label: '聊天', action: () => { this.hide(); this.app._openChat(); } });
    this._showSubmenu(anchor, items);
  }

  _showSingPrompt() {
    this.app._toolbarActive = true;
    this.app._markChatActive(20000);
    let keyHandler = null;
    const modal = this._createCompactModal('想听什么歌？', {
      onClose: () => {
        this.app._toolbarActive = false;
        if (keyHandler) document.removeEventListener('keydown', keyHandler);
      },
    });

    const hint = document.createElement('div');
    hint.textContent = '输入歌名后我再唱给你听。';
    Object.assign(hint.style, {
      fontSize: '12px', color: '#b8b8b8', marginBottom: '8px', lineHeight: '1.45',
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 40;
    input.placeholder = '输入歌名';
    Object.assign(input.style, {
      width: '100%', boxSizing: 'border-box', marginBottom: '6px',
      background: 'rgba(255,255,255,0.10)', color: '#f5f5f5',
      border: '1px solid rgba(255,255,255,0.18)', borderRadius: '6px',
      padding: '7px 8px', outline: 'none', fontSize: '12px',
      fontFamily: '"Microsoft YaHei", sans-serif',
    });

    const error = document.createElement('div');
    Object.assign(error.style, {
      minHeight: '16px', fontSize: '11px', color: '#fca5a5', marginBottom: '8px',
    });

    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = '取消';
    Object.assign(cancelBtn.style, {
      cursor: 'pointer', border: '1px solid rgba(255,255,255,0.16)',
      background: 'rgba(255,255,255,0.08)', color: '#ddd', borderRadius: '6px',
      padding: '6px 10px', fontSize: '12px', fontFamily: '"Microsoft YaHei", sans-serif',
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.textContent = '开唱';
    Object.assign(submitBtn.style, {
      cursor: 'pointer', border: '0', background: '#ff9800', color: '#fff',
      borderRadius: '6px', padding: '6px 10px', fontSize: '12px',
      fontFamily: '"Microsoft YaHei", sans-serif',
    });

    const submit = () => {
      const songTitle = input.value.trim().replace(/\s+/g, ' ');
      if (!songTitle) {
        error.textContent = '先告诉我要唱什么歌。';
        input.focus();
        return;
      }
      modal.close();
      this.app._handleSingRequest(songTitle);
    };

    cancelBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); modal.close(); });
    submitBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); submit(); });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); modal.close(); }
    });
    keyHandler = (e) => {
      if (e.key === 'Escape') modal.close();
    };
    document.addEventListener('keydown', keyHandler);

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    modal.panel.appendChild(hint);
    modal.panel.appendChild(input);
    modal.panel.appendChild(error);
    modal.panel.appendChild(actions);
    requestAnimationFrame(() => input.focus());
  }

  _showMonitorSub(anchor) {
    this._showSubmenu(anchor, [
      { label: '📡 工具状态', action: () => { this.hide(); invoke('open_monitor_panel', {}).catch(() => {}); } },
      { label: '🔄 刷新检测', action: () => { this.hide(); this.app._pollCodingMonitor(); } },
    ]);
  }

  _showSystemSub(anchor) {
    this._showSubmenu(anchor, [
      { label: '⚙ 设置', action: () => { this.hide(); this.app.settingsUI.show(); } },
      { label: '🚪 退出', action: () => { this.hide(); if (confirm('确定要退出桌宠吗？')) this.app._doShutdown(); } },
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
        this.hide();
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
    this.hide();
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
    this._dragLastDy = 0;
    this._dragTotalDx = 0;
    this._dragTotalDy = 0;
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
    this._singReturnTimer = null;
    this._singSeq = 0;
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
    this._clickthroughCheckBusy = false;
    this._clickthroughLastCheckAt = 0;
    this._walkTickBusy = false;
    this._lastWalkTickAt = 0;
    this._walkPendingGraphType = null;
    this._walkPendingStartedAt = 0;
    this._walkRunGraphType = null;
    this._walkEndPending = false;
    // 行走位移定时器 (对标 VPet MoveTimer: 独立于动画帧的窗口移动定时器)
    this._moveTimer = null;           // setInterval 句柄
    this._moveTimerDx = 0;           // 每次移动的 dx (像素)
    this._moveTimerDy = 0;           // 每次移动的 dy (像素)
    this._moveTimerInterval = 120;   // 移动间隔 ms (与 _walkTick 间隔一致, 保证速度计算正确)
    this._edgeClimbCooldownUntil = 0;
    this._like520Unlocked = false;
    this._petStatus = null;
    this._autoCareBusy = false;
    this._autoSleepActive = false;
    this._lastAutoCareAt = {};
    this._foodMenuCache = null;
    this._chaseGameActive = false;
    this._edgeMoveUntil = 0;
    this._edgeMoveDy = 0;
    this._edgeMoveGraphType = null;
    this._edgeClimbActive = false;
    this._edgeClimbOriginSide = null;
    this._edgeClimbSide = null;
    this._edgeClimbStage = 'none';
    this._edgeClimbTopDirection = 1;
    this._edgeClimbBottomDirection = -1;
    this._edgeClimbStartedAt = 0;
    this._edgeClimbMaxUntil = 0;
    this._edgeClimbTopY = 0;
    this._edgeTopDropActive = false;
    this._animationLoadSeq = 0;
    this._opaqueBoundsCache = null;
    this._opaqueBoundsCacheKey = '';
    this._toolbarActive = false;   // 工具栏或子菜单打开时禁止侧边隐藏/行走
    this._auxWindowActive = false;  // 聊天/设置窗口打开时禁止侧边隐藏/行走
    this._auxWindowTimer = null;    // 辅助窗口可见状态轮询
    this._wasWorking = false;      // 工作/学习/玩耍持续态
    this._currentWorkContext = null;
    this._resumeWorkTimer = null;
    this._feedingGraph = null;
    this._manifest = null;
    this._manifestAnimations = new Set();
    this._musicTimer = null;
    this._chatterTimer = null;
    this._chatterBusy = false;
    this._sayRndTimer = null;
    this._illCoughTimer = null;
    this._chatterTopicIndex = Math.floor(Math.random() * CHATTER_TOPICS.length);
    this._chatterHistory = [];  // 自动AI互动模式专用历史，用于防重复
    this._musicActive = false;
    this._musicGraphType = null;
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
    this._ttsCurrentAudio = null;
    this._ttsActiveText = '';
    this._ttsBusyUntil = 0;
    this._ttsSeq = 0;
    this._lastSpokenText = '';
    this._lastSpokenAt = 0;

    // 心情追踪 (用于心情变化通知)
    this._prevMood = 'normal';
    this._lastMoodChangeAt = performance.now(); // 启动时给 60s 缓冲，防止误报
    // 各属性低值警告冷却时间戳 { key: performance.now() }
    this._lastStatWarningAt = {};

    // UI 面板
    this.chatUI = new ChatUI(this);
    this.settingsUI = new SettingsUI(this);

    // Coding Tool 监控 — 已关闭
    this._codingMonitorTools = [];
    this._codingMonitorAnyWorking = false;
    this._codingMonitorPrevWorking = false;
    this._codingMonitorTimer = null;
    // this._startCodingMonitor();

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
        this._manifest = manifest || null;
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

      // 2.5 后台预热常用动画（不阻塞启动流程）
      setTimeout(() => this._warmupCommon().catch(() => {}), 1500);

      // 3. 绑定交互事件
      this._bindEvents();

      // 4. 游戏时钟 — 每秒推进一次
      this._sideHideCheckInterval = setInterval(() => this._checkSideHide(), 2000);
      this._auxWindowTimer = setInterval(() => this._refreshAuxWindowActive(), 1500);

      let tickCount = 0;
      this._tickInterval = setInterval(() => {
        invoke('game_tick', { dtSeconds: 1.0 }).then((result) => {
          if (result.working) {
            if (this._musicActive) this._stopMusicDance({ restore: false });
            this._mischiefBusy = false;
            this._wasWorking = true;
            this._rememberWorkContext(result);
            this._updateWorkTimerUI(result.work);
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
            this._removeWorkTimerUI();
            // monitor_coding 是前端监控触发的工作态, 生命周期由监控快照管理,
            // 不能被 game_tick 的 Rust 工作会话结束信号清除
            if (this._wasWorking && this._currentWorkContext !== 'monitor_coding') {
              this._wasWorking = false;
              this._currentWorkContext = null;
              this._manualAnimLock = false;
              if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
              // Rust 工作结束时若 coding 监控仍在工作, 无缝切回监控工作态
              if (this._codingMonitorAnyWorking && !this._manualSleepMode) {
                this._wasWorking = true;
                this._currentWorkContext = 'monitor_coding';
                this.playAnimation('workone', result.mood || this.mode, null, { ambient: true });
              } else {
                this.playAnimation('default', result.mood || 'normal');
              }
            }
            if (result.mood && result.mood !== this.mode && !this._manualAnimLock && !this._musicActive && !this._mischiefBusy) {
              const prevMode = this.mode;
              this._applyMoodChange(prevMode, result.mood, result.stats);
            }
          }
          if (result.completedWork?.message) this.showBubble(result.completedWork.message, 4000);
          if (result.leveledUp) {
            const lv = result.stats?.level;
            const lvMsg = lv ? `升级啦！现在是 Lv.${lv}！` : '升级啦！';
            if (this._hasAnimationGraph('levelup')) {
              this.playAnimation('levelup', this.mode, () => {
                this.showBubble(lvMsg, 3500);
                this._returnToBaseState(this.mode);
              }, { autoEndLoops: 1 });
            } else {
              this.showBubble(lvMsg, 3500);
            }
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
            this._petStatus = s;
            this._like520Unlocked = !!st.like520Unlocked;
            this._maybeAutoCare(s).catch(() => {});
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
          if (!this._isSpeechBusy()) this._ttsSpeak(e.payload).catch(() => {});
        }
      }).catch(() => {});

      // 监听食物面板选择, 在宠物上播放吃饭动画
      window.PetRuntime.listen('food-selected', (e) => {
        if (e.payload) {
          const p = e.payload;
          if (p.name) this._handleEatFood(p.name, p.graph);
        }
      }).catch(() => {});

      // 监听背包"使用物品", 在宠物上播放对应动画
      window.PetRuntime.listen('inventory-use', (e) => {
        if (e.payload && e.payload.name) this._handleUseInventory(e.payload.name);
      }).catch(() => {});

      // 监听设置变更, 实时应用 (不透明度/音量/移动/缩放/置顶)
      window.PetRuntime.listen('settings-changed', () => {
        this._loadAndApplySettings().catch(() => {});
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

      // 应用持久化设置 (不透明度/音量/移动/缩放/置顶)
      this._loadAndApplySettings().catch(() => {});

      // 4.5 自主行走 — 每 120ms tick 一次
      this._walkTimer = setInterval(() => this._walkTick(), 120);

      // 4.6 点击穿透轮询 — 保留全局兜底，但避免抢占动画渲染
      this._clickthroughInterval = setInterval(() => this._checkClickthrough(), 140);

      // 4.7 环境互动: 音乐跳舞 + 空闲捣蛋 + 20 秒主动闲聊
      this._musicTimer = setInterval(() => this._musicTick().catch(() => {}), MUSIC_POLL_MS);
      this._scheduleMischief();
      this._startChatter();
      this._startSayRnd();
      // 4.8 如果启动时已是生病状态，立即开启咳嗽调度
      if (this.mode === 'ill') this._startIllCough();

      // 5. 启动渲染循环
      this.lastTime = performance.now();
      this.lastFpsTime = this.lastTime;
      requestAnimationFrame((t) => this._gameLoop(t));

      // 6. 开机动画：有 startup 则单次播放后切回默认待机（对标 VPet Load_4_Start）
      if (this._manifestAnimations.has('startup')) {
        const startupMode = this.mode;
        this.playAnimation('startup', startupMode, () => {
          this._returnToBaseState(startupMode);
          // 开机动画结束后检测生日（延迟确保 startup 完全结束）
          setTimeout(() => this._checkBirthday(), 500);
        }, { autoEndLoops: 1 });
      } else {
        setTimeout(() => this._checkBirthday(), 1000);
      }

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

  _setClickthrough(enabled) {
    if (this._clickthroughEnabled === enabled) return;
    this._clickthroughEnabled = enabled;
    invoke('set_clickthrough', { enabled }).catch(() => {});
  }

  _cursorClientPoint(pos, cursorPos) {
    if (!pos || !cursorPos) return null;

    const cursorX = Number(cursorPos.x);
    const cursorY = Number(cursorPos.y);
    const winX = Number(pos.x);
    const winY = Number(pos.y);
    const winW = Number(pos.width);
    const winH = Number(pos.height);
    if (![cursorX, cursorY, winX, winY, winW, winH].every(Number.isFinite)) return null;

    const screenCandidate = {
      x: cursorX - winX,
      y: cursorY - winY,
      inWindow: cursorX >= winX && cursorX <= winX + winW
        && cursorY >= winY && cursorY <= winY + winH,
    };
    const relCandidate = {
      x: cursorX,
      y: cursorY,
      inWindow: cursorX >= 0 && cursorX <= winW
        && cursorY >= 0 && cursorY <= winH,
    };
    const local = cursorPos.screen === true
      ? (screenCandidate.inWindow ? screenCandidate : null)
      : (screenCandidate.inWindow ? screenCandidate : (relCandidate.inWindow ? relCandidate : null));
    if (!local) return null;

    const viewportWidth = Math.max(1, window.innerWidth || this.canvas.width);
    const viewportHeight = Math.max(1, window.innerHeight || this.canvas.height);
    return {
      x: local.x * (viewportWidth / Math.max(1, winW)),
      y: local.y * (viewportHeight / Math.max(1, winH)),
    };
  }

  _canvasPointFromClient(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localX < 0 || localY < 0 || localX >= rect.width || localY >= rect.height) return null;
    return {
      x: localX * (this.canvas.width / Math.max(1, rect.width)),
      y: localY * (this.canvas.height / Math.max(1, rect.height)),
    };
  }

  _hasOpaqueCanvasPixel(canvasX, canvasY) {
    if (!Number.isFinite(canvasX) || !Number.isFinite(canvasY)) return false;
    if (canvasX < 0 || canvasY < 0 || canvasX >= this.canvas.width || canvasY >= this.canvas.height) return false;

    const offsets = [
      [0, 0],
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-2, 0], [2, 0], [0, -2], [0, 2],
      [-2, -2], [2, -2], [-2, 2], [2, 2],
      [-3, 0], [3, 0], [0, -3], [0, 3],
    ];

    try {
      const baseX = Math.floor(canvasX);
      const baseY = Math.floor(canvasY);
      for (const [ox, oy] of offsets) {
        const pixelX = baseX + ox;
        const pixelY = baseY + oy;
        if (pixelX < 0 || pixelY < 0 || pixelX >= this.canvas.width || pixelY >= this.canvas.height) continue;
        const pixelData = this.ctx.getImageData(pixelX, pixelY, 1, 1);
        if (pixelData && pixelData.data[3] > 16) return true;
      }
    } catch (_) {}

    return false;
  }

  _isBubbleClientHit(clientX, clientY) {
    const bubble = this._currentBubble;
    if (!bubble || !bubble.parentNode) return false;
    const rect = bubble.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  _updateBubblePlacement() {
    const bubble = this._currentBubble;
    if (!bubble || !bubble.parentNode) return;
    const viewportHeight = Math.max(1, window.innerHeight || this.canvas.height);
    const bubbleHeight = Math.ceil(bubble.getBoundingClientRect().height || 0);
    const opaqueTop = this._measureOpaqueCanvasTop();
    if (opaqueTop === null) return;

    const bottomY = Math.max(
      bubbleHeight + 4,
      Math.min(viewportHeight - 2, opaqueTop - 3)
    );
    bubble.style.bottom = `${Math.max(0, viewportHeight - bottomY)}px`;
  }

  _pointerLogicalFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cssX = e.target === this.canvas && e.offsetX !== undefined ? e.offsetX : e.clientX - rect.left;
    const cssY = e.target === this.canvas && e.offsetY !== undefined ? e.offsetY : e.clientY - rect.top;
    if (cssX < 0 || cssY < 0 || cssX > rect.width || cssY > rect.height) return null;
    const cx = cssX * (this.canvas.width / Math.max(1, rect.width));
    const cy = cssY * (this.canvas.height / Math.max(1, rect.height));
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
    this._dragLastDy = 0;
    this._dragTotalDx = 0;
    this._dragTotalDy = 0;

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

  _bumpStat(kind, amount = 1) {
    try { invoke('stat_increment', { kind, amount }).catch(() => {}); } catch (_) {}
  }

  _bumpInteractionStat(type, part) {
    let kind = null;
    if (type === 'touch') kind = part === 'head' ? 'touch_head' : 'touch_body';
    else if (type === 'pinch') kind = 'pinch';
    else if (type === 'drag') kind = 'drag';
    else if (type === 'feed') kind = 'feed';
    else if (type === 'drink') kind = 'drink';
    else if (type === 'music') kind = 'dance';
    if (kind) this._bumpStat(kind);
  }

  _recordInteraction(type, detail = {}) {
    this._bumpInteractionStat(type, detail.part);
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
    if (feedback && !detail.suppressFeedback) {
      this._speakProactive({ type: 'interaction', reason: feedback, label: detail.label || entry.label || entry.type }, {
        fallbackWhenBlocked: false,
        fallbackWhenUnavailable: false,
        minIntervalMs: 6000,
        typeMinIntervalMs: 10000,
      }).catch(() => {});
    }
    return entry;
  }

  _deriveInteractionMood(entry) {
    if (entry.type === 'pinch') return entry.streakCount >= 3 ? 'annoyed' : 'playful';
    if (entry.type === 'feed' || entry.type === 'drink') return 'satisfied';
    if (entry.type === 'chat') return 'companied';
    if (entry.type === 'sing') return 'excited';
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
      fallbackWhenBlocked: false,
      fallbackWhenUnavailable: false,
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

  // ── SayRnd 静态台词调度（对标 VPet SayRnd）──

  _startSayRnd() {
    if (this._sayRndTimer) clearInterval(this._sayRndTimer);
    // 随机错开首次触发，避免与 chatter 同时触发
    const jitter = 15000 + Math.random() * 30000;
    this._sayRndTimer = setTimeout(() => {
      this._tickSayRnd();
      this._sayRndTimer = setInterval(() => this._tickSayRnd(), SAY_RND_INTERVAL_MS);
    }, jitter);
    window.addEventListener('beforeunload', () => {
      clearTimeout(this._sayRndTimer);
      clearInterval(this._sayRndTimer);
    }, { once: true });
  }

  _tickSayRnd() {
    if (!this._canAmbientAct()) return;
    if (this._chatterBusy) return;
    if (Math.random() > 0.6) return; // 40% 跳过，避免太频繁
    const pool = SAY_RND_POOL[this.mode] || SAY_RND_POOL.normal;
    const text = pool[Math.floor(Math.random() * pool.length)];
    const sayMode = this.mode;
    if (this._hasAnimationGraph('say')) {
      this.playAnimation('say', sayMode, () => {
        this._returnToBaseState(sayMode);
      }, { autoEndLoops: 1 });
    }
    this.showBubble(text, 2800);
    // 话痨模式不播报语音
    // if (!this._isSpeechBusy()) this._ttsSpeak(text).catch(() => {});
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
          fallbackWhenBlocked: false,
          fallbackWhenUnavailable: false,
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

  _isSpeechBusy() {
    return !!this._ttsCurrentAudio || !!this._ttsActiveText || performance.now() < this._ttsBusyUntil;
  }

  _canUseProactiveAi(options = {}) {
    const now = performance.now();
    if (this._proactiveAiBusy) return false;
    if (this._isSpeechBusy()) return false;
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

  _interactionTypeLabel(type) {
    const labels = {
      touch: '触摸', pinch: '戳脸', drag: '拖拽', feed: '喂食', drink: '喝水',
      play: '玩耍', work: '工作', chat: '聊天', sing: '唱歌', music: '听到音乐', mischief: '捣蛋',
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
      sing: `主人想听我唱「${context.songTitle || context.label || '一首歌'}」。请先回想这首歌的主题、意境、画面和情绪（比如中国风、思念、雨景、热血等），再写一段2到4句的中文原创唱词，让主人一听就觉得"有这首歌的味道"；禁止引用、续写或复现真实歌词，也不要只用"啦啦啦"等拟声词敷衍，要唱出有画面感的具体句子。`,
      music: `我听到音乐，准备跳舞；我该说什么？`,
      chatter: (() => {
        const recent = context.recentChatter;
        const recentNote = recent && recent.length
          ? `\n我最近说过：${recent.map(s => `"${s}"`).join('、')}。请务必说一句完全不同的内容，不要重复类似的措辞或意思。`
          : '';
        return `我现在进入自动AI互动模式，每30秒主动和主人说一句话。当前话题：「${context.topic || '生活'}」。${recentNote}\n请发挥创意，说一句独特、自然、贴合话题的话，可以是诗意的描述、有趣的联想、对主人的鼓励或猫猫视角的感悟。`;
      })(),
    }[context.type || 'idle'] || (context.reason || '我想主动和主人说一句话。');

    return [
      `事件：${eventText}`,
      `当前心情：${status.mood || this.mode || 'normal'}`,
      `状态：饱腹${Math.round(stats.hunger ?? 80)}，口渴${Math.round(stats.thirst ?? 80)}，心情${Math.round(stats.happiness ?? 80)}，体力${Math.round(stats.energy ?? 80)}`,
      `最近互动：${recent}`,
      context.type === 'sing'
        ? `输出要求：只输出桌宠第一人称中文原创唱词，${SING_SPEECH_MAX_CHARS}字以内；不要解释，不要加引号，不要说自己是AI，不要复现真实歌曲歌词。`
        : `输出要求：只输出桌宠第一人称的一句中文气泡台词，${PROACTIVE_SPEECH_MAX_CHARS}字以内；不要解释，不要加引号，不要说自己是AI。`,
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

  _normalizeSingSpeech(text) {
    if (!text) return '';
    let value = String(text)
      .replace(/\r?\n+/g, ' ')
      .replace(/^(回复|台词|气泡|桌宠|宠物|唱词|歌词)[:：]\s*/i, '')
      .replace(/^["“'‘\s]+|["”'’\s]+$/g, '')
      // LLM 常见方括号格式残留: xxxx[歌名]xxx → 清除方括号及其中内容
      .replace(/[\[【][^\]】]*[\]】]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!value) return '';
    if (value.length > SING_SPEECH_MAX_CHARS) {
      value = `${value.slice(0, SING_SPEECH_MAX_CHARS - 1)}…`;
    }
    return value;
  }

  async _resolveProactiveSpeech(context = {}, options = {}) {
    const type = context.type || 'idle';
    const fallback = options.fallback !== undefined ? options.fallback : null;
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

      // 确认会真正调用 AI 之后再通知调用方 (用于让"思考点"只在真正请求 AI 时出现)
      if (typeof options.onAiStart === 'function') {
        try { options.onAiStart(); } catch (_) {}
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
      const taskPrompt = context.type === 'sing'
        ? '你现在只负责给桌宠生成一小段原创唱词。先想清楚主人点的这首歌讲什么、是什么风格氛围，再用原创句子唱出同样的意境和画面感，让人能联想到这首歌；禁止复现真实歌词，禁止用"啦啦啦"等无意义拟声敷衍。'
        : '你现在只负责给桌宠生成主动气泡台词。台词要短、自然、可爱，贴合当前事件。';
      const prompt = `你的名字叫「${petName}」。\n${basePrompt}\n\n${taskPrompt}`;
      const isChatterType = (context.type === 'chatter');
      const isSingType = (context.type === 'sing');
      const tunedConfig = {
        ...config,
        temperature: isChatterType
          ? Math.max(0.85, Math.min(1.2, Number(config.temperature || 0.9)))
          : (isSingType
            ? Math.max(0.8, Math.min(1.15, Number(config.temperature || 0.9)))
            : Math.max(0.6, Math.min(1.0, Number(config.temperature || 0.8)))),
        max_tokens: isChatterType
          ? Math.min(Number(config.max_tokens || 120), 120)
          : (isSingType
            ? Math.min(Number(config.max_tokens || 160), 160)
            : Math.min(Number(config.max_tokens || 80), 80)),
      };
      // 自动AI互动模式使用独立历史，避免和其他互动混淆造成重复
      const history = isChatterType
        ? this._chatterAiHistory ? this._chatterAiHistory.slice(-4) : []
        : (isSingType ? [] : this._proactiveAiHistory.slice(-6));
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
        } else if (!isSingType) {
          this._proactiveAiHistory = newHistory.slice(-8);
        }
      }
      const assistant = Array.isArray(newHistory)
        ? [...newHistory].reverse().find((item) => item && item.role === 'assistant')
        : null;
      const rawSpeech = assistant?.content || '';
      const speech = isSingType
        ? this._normalizeSingSpeech(rawSpeech)
        : this._normalizeProactiveSpeech(rawSpeech);
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
    if (this._isSpeechBusy()) return null;
    // 思考点只在真正调用 AI 时才显示 — 避免无 API Key / 被阻塞时出现 "...." 后空白
    let dotsStarted = false;
    const startDots = () => {
      if (dotsStarted) return;
      dotsStarted = true;
      this._startThinkingDots();
    };
    let speech = null;
    try {
      speech = await this._resolveProactiveSpeech(context, {
        ...options,
        onAiStart: isChatter ? startDots : options.onAiStart,
      });
    } finally {
      if (isChatter && dotsStarted) {
        // 已经亮出思考点说明确实在请求 AI; 若 AI 没有产出则本地兜底, 绝不留下空气泡
        speech = speech || this._fallbackChatterSpeech(context);
        this._stopThinkingDots(speech);
      }
    }
    if (!speech) return null;
    this._markProactiveAi(context.type || 'idle');
    if (!isChatter) {
      const duration = options.duration || Math.max(2800, speech.length * 90);
      this.showBubble(speech, duration);
      this._ttsSpeak(speech).catch(() => {});
    }
    return speech;
  }

  _speakSceneProactive(context = {}, options = {}) {
    return this._speakProactive(context, {
      fallbackWhenBlocked: false,
      fallbackWhenUnavailable: false,
      minIntervalMs: PROACTIVE_SCENE_AI_MIN_MS,
      typeMinIntervalMs: PROACTIVE_SCENE_CONTEXT_MIN_MS,
      allowToolbarActive: true,
      ...options,
    });
  }

  _normalizeTtsText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  _stopCurrentTts() {
    if (this._ttsCurrentAudio) {
      try { this._ttsCurrentAudio.stop(); } catch (_) {}
      this._ttsCurrentAudio = null;
    }
    this._ttsActiveText = '';
    this._ttsBusyUntil = 0;
  }

  async _ttsSpeak(text, options = {}) {
    const normalized = this._normalizeTtsText(text);
    if (!normalized || !/[0-9A-Za-z\u4e00-\u9fff]/.test(normalized)) return false;

    const now = performance.now();
    const dedupeMs = Number(options.dedupeMs ?? TTS_DEDUPE_WINDOW_MS);
    if (this._isSpeechBusy()) {
      if (options.force) {
        this._stopCurrentTts();
      } else {
        return false;
      }
    }
    if (!options.force && normalized === this._ttsActiveText) {
      return false;
    }
    if (!options.force && normalized === this._lastSpokenText && now - this._lastSpokenAt < dedupeMs) {
      return false;
    }

    const seq = ++this._ttsSeq;
    if (options.force) this._stopCurrentTts();
    this._ttsActiveText = normalized;
    this._ttsBusyUntil = Math.max(this._ttsBusyUntil, now + Math.max(3000, normalized.length * 140));
    this._lastSpokenText = normalized;
    this._lastSpokenAt = now;

    try {
      const hasTtsKey = await invoke('has_tts_api_key', {});
      if (!hasTtsKey || seq !== this._ttsSeq) {
        if (seq === this._ttsSeq && this._ttsActiveText === normalized) {
          this._ttsActiveText = '';
          this._ttsBusyUntil = 0;
        }
        return false;
      }
      const invokeArgs = { text: normalized };
      if (options.sing) invokeArgs.sing = true;
      const base64Wav = await invoke('tts_speak', invokeArgs);
      if (!base64Wav || seq !== this._ttsSeq) {
        if (seq === this._ttsSeq && this._ttsActiveText === normalized) {
          this._ttsActiveText = '';
          this._ttsBusyUntil = 0;
        }
        return false;
      }
      let audio = null;
      const handleEnded = () => {
        if (this._ttsCurrentAudio === audio) this._ttsCurrentAudio = null;
        if (seq === this._ttsSeq && this._ttsActiveText === normalized) {
          this._ttsActiveText = '';
          this._ttsBusyUntil = 0;
        }
      };
      // 等音频真正开声那一刻再返回, 让 onStart(文字气泡) 与语音严格同步,
      // 避免文字早到、声音因解码/恢复 AudioContext 延迟而迟到造成长间隔
      const started = await new Promise((resolve) => {
        let settled = false;
        const settle = (val) => { if (settled) return; settled = true; resolve(val); };
        // 安全兜底: 8s 内未开声(如无用户手势导致 AudioContext 挂起)则放弃等待
        const timer = setTimeout(() => settle(false), 8000);
        audio = playBase64Wav(
          base64Wav,
          () => { handleEnded(); clearTimeout(timer); settle(false); },
          () => { clearTimeout(timer); settle(true); }
        );
        if (audio.closed) { clearTimeout(timer); settle(false); }
      });

      if (!started) {
        handleEnded();
        return false;
      }
      // 开声成功 — 此刻通知调用方显示文字, 与语音同步
      if (typeof options.onStart === 'function') {
        try { options.onStart(); } catch (_) {}
      }
      this._ttsCurrentAudio = audio;
      return true;
    } catch (e) {
      if (seq === this._ttsSeq && this._ttsActiveText === normalized) {
        this._ttsActiveText = '';
        this._ttsBusyUntil = 0;
      }
      console.warn('TTS 合成失败:', e);
      return false;
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

  _graphTypeCandidates(graphType) {
    const raw = String(graphType || 'default');
    const aliases = GRAPH_TYPE_ALIASES[raw] || [];
    return aliases.length ? [...aliases, raw] : [raw];
  }

  _isGraphAvailable(graphType) {
    // like520 特殊待机仅在好感度 >= 520 解锁后才可用 (对标 VPet)
    if (graphType === 'idle_happy_like520' && !this._like520Unlocked) return false;
    if (this._manifestAnimations.size === 0) return true;
    if (this._manifestAnimations.has(graphType)) return true;
    return graphType.startsWith('move.') && this._manifestAnimations.has('move');
  }

  _resolveGraphType(graphType) {
    const raw = String(graphType || 'default');
    if (this._manifestAnimations.size === 0) return raw;
    return this._graphTypeCandidates(raw).find((candidate) => this._isGraphAvailable(candidate)) || raw;
  }

  _hasAnimationGraph(graphType) {
    return this._graphTypeCandidates(graphType).some((candidate) => this._isGraphAvailable(candidate));
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
    const found = candidates.find((graph) => this._hasAnimationGraph(graph));
    return this._resolveGraphType(found || fallback);
  }

  _resolveWalkGraphType(result) {
    if (!result) return null;
    const graphType = result.graphType || 'default';
    if (graphType.startsWith('move.climb.') || graphType.startsWith('move.crawl.') || graphType.startsWith('move.fall.')) {
      return this._edgeGraphCandidates(graphType, result)[0];
    }
    if (graphType.startsWith('move.walk.')) return this._walkGraphCandidates(graphType, result)[0];
    if (graphType !== 'move' && !result.walking) {
      const idleGraph = ['default', 'idle', 'think', 'switch', 'state', 'stateone', 'statetwo'].includes(graphType)
        ? graphType
        : 'default';
      return this._resolveGraphType(idleGraph);
    }

    const direction = result.facingRight === false ? 'left' : 'right';
    const mood = this.mode || 'normal';
    const suffix = (mood === 'poorCondition' || mood === 'ill')
      ? '.slow'
      : (mood === 'happy' ? '.faster' : '');
    return this._walkGraphCandidates(`move.walk.${direction}${suffix}`, result)[0];
  }

  _walkGraphCandidates(graphType, result = {}) {
    const raw = String(graphType || '');
    const match = raw.match(/^move\.walk\.(left|right)(?:\.(slow|faster))?$/);
    const direction = match?.[1] || (result.facingRight === false ? 'left' : 'right');
    const suffix = match?.[2] ? `.${match[2]}` : '';
    const candidates = [
      `move.walk.${direction}${suffix}`,
      `move.walk.${direction}`,
      `move.walk.${direction}.slow`,
      `move.walk.${direction}.faster`,
    ];
    return [...new Set(candidates)].map((graph) => this._resolveGraphType(graph));
  }

  _edgeGraphCandidates(graphType, result = {}) {
    const raw = String(graphType || '');
    const match = raw.match(/^move\.(climb(?:\.top)?|crawl|fall)\.(left|right)$/);
    const kind = match?.[1] || '';
    const side = match?.[2] || result.edgeSide || (result.facingRight === false ? 'left' : 'right');
    const candidates = [
      match ? raw : `move.climb.${side}`,
      ...(kind === 'fall' ? [`move.fall.${side}`] : []),
      `move.climb.${side}`,
      `move.climb.top.${side}`,
      `move.crawl.${side}`,
      'idle',
    ];
    return [...new Set(candidates)].map((graph) => this._resolveGraphType(graph));
  }

  _screenBounds(screen, pos) {
    const fallbackW = Number(screen?.screenWidth ?? screen?.workAreaWidth ?? screen?.width) || 0;
    const fallbackH = Number(screen?.screenHeight ?? screen?.workAreaHeight ?? screen?.height) || 0;
    const workWidth = Math.max(0, Math.round(Number(screen?.workAreaWidth) || fallbackW));
    const workHeight = Math.max(0, Math.round(Number(screen?.workAreaHeight) || fallbackH));
    const workLeft = Math.round(Number(screen?.workAreaX ?? screen?.screenX ?? 0) || 0);
    const workTop = Math.round(Number(screen?.workAreaY ?? screen?.screenY ?? 0) || 0);
    const workRight = workLeft + workWidth;
    const workBottom = workTop + workHeight;
    const screenBottom = Math.round(Number(screen?.screenY ?? 0) || 0) + Math.max(0, Math.round(Number(screen?.screenHeight) || fallbackH));
    const hasWorkArea = Number.isFinite(Number(screen?.workAreaWidth))
      && Number.isFinite(Number(screen?.workAreaHeight))
      && (workBottom < screenBottom || workTop !== Math.round(Number(screen?.screenY ?? 0) || 0));
    const windowW = Math.max(0, Math.round(Number(pos?.width) || 0));
    const windowH = Math.max(0, Math.round(Number(pos?.height) || 0));
    if (workHeight > 0) this._lastWorkHeight = workHeight;
    return {
      workLeft,
      workTop,
      workRight,
      workBottom,
      workWidth,
      workHeight,
      hasWorkArea,
      minX: workLeft,
      minY: workTop,
      maxX: Math.max(workLeft, workRight - windowW),
      maxY: Math.max(workTop, workBottom - windowH),
      windowW,
      windowH,
    };
  }

  _opaqueCanvasCacheKey() {
    const player = this.player || {};
    return [
      this.canvas.width,
      this.canvas.height,
      this.graphType,
      player.currentPhase,
      player.currentIndex,
      player.frontIndex,
      player.foodIndex,
    ].join('|');
  }

  _measureOpaqueCanvasBounds() {
    const key = this._opaqueCanvasCacheKey();
    if (this._opaqueBoundsCache && this._opaqueBoundsCacheKey === key) {
      return this._opaqueBoundsCache;
    }

    try {
      const W = this.canvas.width;
      const H = this.canvas.height;
      if (!W || !H) return null;
      const data = this.ctx.getImageData(0, 0, W, H).data;
      let left = W;
      let top = H;
      let right = -1;
      let bottom = -1;

      for (let y = 0; y < H; y++) {
        const row = y * W * 4;
        for (let x = 0; x < W; x++) {
          if (data[row + x * 4 + 3] <= 24) continue;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }

      if (right < left || bottom < top) return null;
      const bounds = {
        left,
        top,
        right: right + 1,
        bottom: bottom + 1,
        width: right - left + 1,
        height: bottom - top + 1,
      };
      this._opaqueBoundsCache = bounds;
      this._opaqueBoundsCacheKey = key;
      return bounds;
    } catch (_) {
      return null;
    }
  }

  _visiblePetBoundsPx(pos = null) {
    const canvasW = Math.max(1, this.canvas.width || window.innerWidth || 0);
    const canvasH = Math.max(1, this.canvas.height || window.innerHeight || 0);
    const physicalW = Math.max(1, Number(pos?.width) || canvasW);
    const physicalH = Math.max(1, Number(pos?.height) || canvasH);
    const measured = this._measureOpaqueCanvasBounds();
    if (!measured) {
      return { left: 0, top: 0, right: physicalW, bottom: physicalH, width: physicalW, height: physicalH };
    }

    const scaleX = physicalW / canvasW;
    const scaleY = physicalH / canvasH;
    const left = Math.max(0, Math.min(physicalW, Math.floor(measured.left * scaleX)));
    const top = Math.max(0, Math.min(physicalH, Math.floor(measured.top * scaleY)));
    const right = Math.max(left + 1, Math.min(physicalW, Math.ceil(measured.right * scaleX)));
    const bottom = Math.max(top + 1, Math.min(physicalH, Math.ceil(measured.bottom * scaleY)));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  _measureOpaqueCanvasTop() {
    const bounds = this._measureOpaqueCanvasBounds();
    return bounds ? bounds.top : null;
  }

  _edgeWindowXForSide(side, bounds, visibleBounds) {
    return side === 'right'
      ? bounds.workRight - visibleBounds.right
      : bounds.workLeft - visibleBounds.left;
  }

  _edgeWindowYForSide(side, bounds, visibleBounds) {
    return side === 'bottom'
      ? bounds.workBottom - visibleBounds.bottom
      : bounds.workTop - visibleBounds.top;
  }

  _edgeFallBottomY(bounds, visibleBounds) {
    const fallbackGap = bounds.hasWorkArea
      ? 0
      : Math.min(EDGE_FALL_BOTTOM_SAFE_GAP_PX, Math.max(0, bounds.workHeight - visibleBounds.height));
    return bounds.workBottom - visibleBounds.bottom - fallbackGap;
  }

  _edgeTopDropTargetY(bounds, visibleBounds) {
    const visibleTargetY = this._edgeFallBottomY(bounds, visibleBounds);
    const fallbackGap = bounds.hasWorkArea
      ? 0
      : Math.min(EDGE_FALL_BOTTOM_SAFE_GAP_PX, Math.max(0, bounds.workHeight - bounds.windowH));
    const maxWindowY = Math.max(bounds.minY, bounds.workBottom - bounds.windowH - fallbackGap);
    return Math.min(visibleTargetY, maxWindowY);
  }

  _refreshEdgeClimbTopY(pos, bounds, visibleBounds) {
    const nextTopY = this._edgeWindowYForSide('top', bounds, visibleBounds || this._visiblePetBoundsPx(pos));
    if (!Number.isFinite(nextTopY)) return;
    this._edgeClimbTopY = Math.round(nextTopY);
  }

  _clampWindowTarget(x, y, bounds) {
    return {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, Math.round(x))),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, Math.round(y))),
    };
  }

  _clampVisiblePetTarget(x, y, bounds, visibleBounds) {
    const minX = bounds.workLeft - visibleBounds.left;
    const maxX = bounds.workRight - visibleBounds.right;
    const minY = bounds.workTop - visibleBounds.top;
    const maxY = bounds.workBottom - visibleBounds.bottom;
    const clampAxis = (value, min, max) => {
      const rounded = Math.round(value);
      if (max < min) return Math.round((min + max) / 2);
      return Math.max(min, Math.min(max, rounded));
    };
    return {
      x: clampAxis(x, minX, maxX),
      y: clampAxis(y, minY, maxY),
    };
  }

  _clampEdgeClimbTarget(x, y, bounds, visibleBounds) {
    return this._clampVisiblePetTarget(x, y, bounds, visibleBounds);
  }

  _clearEdgeClimbState(options = {}) {
    this._edgeMoveUntil = 0;
    this._edgeMoveDy = 0;
    this._edgeMoveGraphType = null;
    this._edgeClimbActive = false;
    this._edgeClimbOriginSide = null;
    this._edgeClimbSide = null;
    this._edgeClimbStage = 'none';
    this._edgeClimbTopDirection = 1;
    this._edgeClimbBottomDirection = -1;
    this._edgeClimbStartedAt = 0;
    this._edgeClimbMaxUntil = 0;
    this._edgeClimbTopY = 0;
    if (!options.keepTopDrop) this._edgeTopDropActive = false;
    this._stopMoveTimer();
    this._walkRunGraphType = null;
    this._walkEndPending = false;
    this._walkPendingGraphType = null;
    if (options.pauseMs) this._walkPauseUntil = performance.now() + options.pauseMs;
    if (options.playDefault) {
      this._walkGraphType = 'default';
      this.playAnimation('default', this.mode || 'normal', null, { ambient: true }).catch(() => {});
    }
  }

  async _interruptEdgeClimb(options = {}) {
    const shouldDropFromTop = options.dropFromTop !== false
      && this._edgeClimbActive
      && this._edgeClimbStage === 'top'
      && !this._edgeTopDropActive;

    if (!shouldDropFromTop) {
      this._clearEdgeClimbState(options);
      return false;
    }

    const side = this._edgeClimbSide === 'right' ? 'right' : 'left';
    const direction = this._edgeClimbTopDirection >= 0 ? 1 : -1;
    const fallGraph = this._edgeGraphForStage('fall', side, direction);
    this._edgeTopDropActive = true;

    try {
      const [pos, screen] = options.pos && options.screen
        ? [options.pos, options.screen]
        : await Promise.all([
            invoke('get_window_position', {}),
            invoke('get_screen_info', {}),
          ]);

      this._clearEdgeClimbState({
        pauseMs: Math.max(Number(options.pauseMs) || 0, 2600),
        keepTopDrop: true,
      });
      this._walkPauseUntil = performance.now() + 3200;

      const candidates = [fallGraph, 'default'].map((graph) => this._resolveGraphType(graph));
      const loadedGraph = await this._playAmbientGraphWithFallback(candidates, this.mode, {
        force: true,
        startPhase: 'b_loop',
        endPoseVariant: true,
      });
      if (loadedGraph) {
        this._walkGraphType = loadedGraph;
        this._edgeMoveGraphType = loadedGraph;
      }

      const landedPos = await this._moveEdgeTopDropToBottom(pos, screen);
      await this._playEdgeTopDropLanding(loadedGraph || fallGraph, landedPos, screen);
      return true;
    } catch (_) {
      this._clearEdgeClimbState({ pauseMs: 900, playDefault: true });
      return false;
    } finally {
      this._edgeTopDropActive = false;
      this._edgeMoveGraphType = null;
      this._walkRunGraphType = null;
      this._walkEndPending = false;
      this._walkPendingGraphType = null;
      this._walkPauseUntil = performance.now() + 900;
    }
  }

  async _moveEdgeTopDropToBottom(pos, screen) {
    let current = { ...pos };
    for (let i = 0; i < 96; i++) {
      const bounds = this._screenBounds(screen, current);
      const visibleBounds = this._visiblePetBoundsPx(current);
      const y = Math.round(Number(current?.y) || 0);
      const x = Math.round(Number(current?.x) || 0);
      const bottomY = this._edgeTopDropTargetY(bounds, visibleBounds);
      if (y >= bottomY) return current;

      const target = this._clampWindowTarget(x, Math.min(bottomY, y + EDGE_FALL_STEP_PX), bounds);
      await this._moveWindowTowardEdgeTarget(current, target).catch(() => {});
      current = { ...current, x: target.x, y: target.y };
      if (target.y >= bottomY) return current;
      await new Promise((resolve) => setTimeout(resolve, EDGE_FALL_TICK_MS));
    }
    return current;
  }

  async _settleEdgeTopDropAboveBottom(pos, screen) {
    if (!pos || !screen) return;
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const bounds = this._screenBounds(screen, pos);
    const visibleBounds = this._visiblePetBoundsPx(pos);
    const targetY = this._edgeTopDropTargetY(bounds, visibleBounds);
    const target = this._clampWindowTarget(pos.x, targetY, bounds);
    await this._moveWindowTowardEdgeTarget(pos, target).catch(() => {});
  }

  async _playEdgeTopDropLanding(fallGraph, pos = null, screen = null) {
    const mode = this.mode || 'normal';
    const finish = () => {
      this._walkGraphType = 'default';
      this.playAnimation('default', mode, null, { ambient: true, force: true }).catch(() => {});
    };

    const resolvedFallGraph = this._resolveGraphType(fallGraph);
    const hasFallEnd = this.graphType === resolvedFallGraph && this.player?.phases?.c_end?.length > 0;
    if (hasFallEnd) {
      await this._settleEdgeTopDropAboveBottom(pos, screen);
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2400);
        this.player.triggerEnd(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      finish();
      return;
    }

    await new Promise(async (resolve) => {
      const timer = setTimeout(() => resolve(false), 2600);
      const loaded = await this.playAnimation('raise', mode, () => {
        clearTimeout(timer);
        resolve(true);
      }, {
        force: true,
        startPhase: 'c_end',
        endPoseVariant: true,
        lockDurationMs: 2400,
      });
      if (!loaded) {
        clearTimeout(timer);
        resolve(false);
        return;
      }
      await this._settleEdgeTopDropAboveBottom(pos, screen);
    });

    finish();
  }

  _edgeGraphForStage(stage, side, direction) {
    const safeSide = side === 'right' ? 'right' : 'left';
    if (stage === 'top') {
      return direction >= 0 ? 'move.climb.top.right' : 'move.climb.top.left';
    }
    if (stage === 'fall') {
      return direction >= 0 ? 'move.fall.right' : 'move.fall.left';
    }
    if (stage === 'bottom') {
      return direction >= 0 ? 'move.crawl.right' : 'move.crawl.left';
    }
    return `move.climb.${safeSide}`;
  }

  async _playEdgeClimbGraph(graphType, side) {
    if (!graphType || this._edgeMoveGraphType === graphType) return graphType;
    const candidates = this._edgeGraphCandidates(graphType, { edgeSide: side });
    const preferredGraph = candidates[0];
    this._edgeMoveGraphType = preferredGraph;
    this._walkPendingGraphType = preferredGraph;
    this._walkPendingStartedAt = performance.now();
    const loadedGraph = await this._playAmbientGraphWithFallback(candidates, this.mode, { force: true });
    if (loadedGraph) {
      this._walkGraphType = loadedGraph;
      this._edgeMoveGraphType = loadedGraph;
    }
    if (this._walkPendingGraphType === preferredGraph) this._walkPendingGraphType = null;
    return loadedGraph;
  }

  async _moveWindowTowardEdgeTarget(pos, target) {
    const dx = target.x - Math.round(Number(pos?.x) || 0);
    const dy = target.y - Math.round(Number(pos?.y) || 0);
    if (dx !== 0 || dy !== 0) {
      await invoke('move_window_by', { dx, dy });
    }
  }

  async _startEdgeClimb(result, pos, screen) {
    const bounds = this._screenBounds(screen, pos);
    const visibleBounds = this._visiblePetBoundsPx(pos);
    const hitSide = result.edgeSide === 'right' ? 'right' : 'left';
    const edgeX = this._edgeWindowXForSide(hitSide, bounds, visibleBounds);
    const target = this._clampVisiblePetTarget(edgeX, pos.y, bounds, visibleBounds);

    await this._moveWindowTowardEdgeTarget(pos, target).catch(() => {});

    this._edgeClimbActive = true;
    this._edgeClimbOriginSide = hitSide;
    this._edgeClimbSide = hitSide;
    this._edgeClimbStage = 'side-up';
    this._edgeClimbTopDirection = hitSide === 'left' ? 1 : -1;
    this._edgeClimbBottomDirection = hitSide === 'left' ? -1 : 1;
    this._edgeClimbStartedAt = performance.now();
    this._edgeClimbMaxUntil = this._edgeClimbStartedAt + EDGE_CLIMB_MAX_MS;
    this._edgeClimbTopY = this._edgeWindowYForSide('top', bounds, visibleBounds);
    this._edgeMoveUntil = 0;
    this._edgeMoveDy = 0;
    this._walkPauseUntil = this._edgeClimbMaxUntil;
    this._walkRunGraphType = null;
    this._walkEndPending = false;

    await this._playEdgeClimbGraph(this._edgeGraphForStage('side-up', hitSide, 0), hitSide);
  }

  async _advanceEdgeClimb(pos, screen) {
    if (!this._edgeClimbActive) return false;
    const now = performance.now();
    if (now > this._edgeClimbMaxUntil) {
      await this._interruptEdgeClimb({ pauseMs: 900, playDefault: true, pos, screen });
      return false;
    }

    const bounds = this._screenBounds(screen, pos);
    const visibleBounds = this._visiblePetBoundsPx(pos);
    const step = EDGE_CLIMB_STEP_PX;
    this._refreshEdgeClimbTopY(pos, bounds, visibleBounds);
    const edgeTopY = Number(this._edgeClimbTopY);
    const topY = Number.isFinite(edgeTopY)
      ? Math.round(edgeTopY)
      : this._edgeWindowYForSide('top', bounds, visibleBounds);
    const bottomY = this._edgeWindowYForSide('bottom', bounds, visibleBounds);
    const leftX = this._edgeWindowXForSide('left', bounds, visibleBounds);
    const rightX = this._edgeWindowXForSide('right', bounds, visibleBounds);
    const x = Math.round(Number(pos?.x) || 0);
    const y = Math.round(Number(pos?.y) || 0);
    let stage = this._edgeClimbStage;
    let side = this._edgeClimbSide === 'right' ? 'right' : 'left';
    let target = { x, y };
    let graphType = null;

    if (stage === 'side-up') {
      const edgeX = side === 'right' ? rightX : leftX;
      target = this._clampEdgeClimbTarget(edgeX, y - step, bounds, visibleBounds);
      graphType = this._edgeGraphForStage(stage, side, -1);
      if (target.y <= topY) {
        stage = 'top';
        this._edgeClimbStage = stage;
        graphType = this._edgeGraphForStage(stage, side, this._edgeClimbTopDirection);
      }
    } else if (stage === 'top') {
      const dir = this._edgeClimbTopDirection >= 0 ? 1 : -1;
      target = this._clampEdgeClimbTarget(x + dir * step, topY, bounds, visibleBounds);
      graphType = this._edgeGraphForStage(stage, side, dir);
      if ((dir > 0 && target.x >= rightX) || (dir < 0 && target.x <= leftX)) {
        side = dir > 0 ? 'right' : 'left';
        this._edgeClimbSide = side;
        stage = 'side-down';
        this._edgeClimbStage = stage;
        graphType = this._edgeGraphForStage(stage, side, 1);
      }
    } else if (stage === 'fall') {
      const dir = this._edgeClimbTopDirection >= 0 ? 1 : -1;
      target = this._clampEdgeClimbTarget(x, Math.min(bottomY, y + EDGE_FALL_STEP_PX), bounds, visibleBounds);
      graphType = this._edgeGraphForStage(stage, side, dir);
      if (target.y >= bottomY) {
        await this._moveWindowTowardEdgeTarget(pos, target).catch(() => {});
        this._clearEdgeClimbState({ pauseMs: 900, playDefault: true });
        return false;
      }
    } else if (stage === 'side-down') {
      const edgeX = side === 'right' ? rightX : leftX;
      target = this._clampEdgeClimbTarget(edgeX, y + step, bounds, visibleBounds);
      graphType = this._edgeGraphForStage(stage, side, 1);
      if (target.y >= bottomY) {
        stage = 'bottom';
        this._edgeClimbStage = stage;
        graphType = this._edgeGraphForStage(stage, side, this._edgeClimbBottomDirection);
      }
    } else if (stage === 'bottom') {
      const dir = this._edgeClimbBottomDirection >= 0 ? 1 : -1;
      target = this._clampEdgeClimbTarget(x + dir * step, bottomY, bounds, visibleBounds);
      graphType = this._edgeGraphForStage(stage, side, dir);
      const done = (dir > 0 && target.x >= rightX) || (dir < 0 && target.x <= leftX);
      if (done) {
        await this._moveWindowTowardEdgeTarget(pos, target).catch(() => {});
        this._clearEdgeClimbState({ pauseMs: 900, playDefault: true });
        return false;
      }
    } else {
      this._clearEdgeClimbState({ pauseMs: 900, playDefault: true });
      return false;
    }

    await this._playEdgeClimbGraph(graphType, side);
    await this._moveWindowTowardEdgeTarget(pos, target).catch(() => {});
    return true;
  }

  async _playAmbientGraphWithFallback(candidates, mode = this.mode, options = {}) {
    for (const graph of candidates) {
      if (!graph) continue;
      const loaded = await this.playAnimation(graph, mode, null, { ambient: true, ...options });
      if (loaded) return graph;
    }
    return null;
  }

  _isWalkPlayerHealthy(graphType) {
    if (!graphType || this.graphType !== graphType) return false;
    // 放宽判断：只要 graphType 匹配且处于合理播放阶段即认为健康
    // 不依赖 isPlaying（帧切换间隙会短暂为 false，导致误判"不健康"而跳过移动）
    const phase = this.player.currentPhase || '';
    return phase === 'a_start' || phase === 'b_loop' || phase === 'b_loop_front';
  }

  // ── 行走位移定时器 (对标 VPet MoveTimer) ──
  // VPet 中 MoveTimer 是独立定时器，按固定间隔调 MoveWindows(dx, dy)
  // 与动画播放完全解耦：位移由 _walkTick 设置 _moveTimerDx/Dy，MoveTimer 只负责定时执行
  _startMoveTimer() {
    this._stopMoveTimer();
    this._moveTimer = setInterval(() => {
      if (this._dragging || this._manualSleepMode || this._toolbarActive || this._auxWindowActive) {
        this._stopMoveTimer();
        return;
      }
      if (this._moveTimerDx === 0 && this._moveTimerDy === 0) return;
      invoke('move_window_by', { dx: this._moveTimerDx, dy: this._moveTimerDy }).catch(() => {
        this._stopMoveTimer();
      });
    }, this._moveTimerInterval);
  }

  _stopMoveTimer() {
    if (this._moveTimer) {
      clearInterval(this._moveTimer);
      this._moveTimer = null;
    }
  }

  _hasPlayableFrames(graphType, mode = this.mode || 'normal') {
    const resolved = this._resolveGraphType(graphType);
    const fromManifest = this._manifest?.animations?.[resolved];
    const manifestPhases = fromManifest?.[mode] || fromManifest?.normal || null;
    if (manifestPhases) {
      return ['a_start', 'b_loop', 'c_end', 'b_loop_front']
        .some((phase) => Array.isArray(manifestPhases[phase]) && manifestPhases[phase].length > 1);
    }

    const phases = phasesCache.get(`${resolved}|${mode}`) || phasesCache.get(`${resolved}|normal`) || null;
    if (!phases) return false;
    return ['a_start', 'b_loop', 'c_end', 'b_loop_front']
      .some((phase) => Array.isArray(phases[phase]) && phases[phase].length > 1);
  }

  _pickMusicGraph(mode = 'happy') {
    const candidates = ['say', 'idle_happy_like520', 'playone', 'stateone', 'statetwo', 'idle', 'switch', 'think'];
    const found = candidates.find((graph) => this._hasAnimationGraph(graph) && this._hasPlayableFrames(graph, mode));
    return found ? this._resolveGraphType(found) : null;
  }

  async _musicTick() {
    const musicGraph = this._pickMusicGraph('happy');
    if (!musicGraph) return;
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
    const musicGraph = this._pickMusicGraph('happy');
    if (!musicGraph) {
      this._musicActive = false;
      this._musicStrong = false;
      return;
    }
    this._musicGraphType = musicGraph;
    this._walkGraphType = musicGraph;
    const label = strong ? '强节奏' : '音乐';
    this._recordInteraction('music', { label, mood: 'happy', duration: 0, suppressFeedback: true });
    this._speakSceneProactive({ type: 'music', label, strong }).catch(() => {});
    await this.playAnimation(musicGraph, 'happy', null, { ambient: true, startPhase: 'b_loop', requirePlayableFrames: true });
    if (this.graphType !== musicGraph) {
      this._musicActive = false;
      this._musicGraphType = null;
    }
  }

  _stopMusicDance(options = {}) {
    if (!this._musicActive) return;
    const shouldRestore = options.restore !== false;
    const musicGraph = this._musicGraphType;
    this._musicActive = false;
    this._musicGraphType = null;
    this._musicStrong = false;
    this._musicAboveSince = 0;
    this._musicAverage = 0;
    if (shouldRestore && this.graphType === musicGraph) {
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
    // state 特殊姿势约10%概率触发（对标 VPet StateONE/TWO 特殊待机）
    const actions = ['nudge', 'animate', 'peek', ...(Math.random() < 0.22 ? ['stateIdle'] : [])];
    const action = actions[Math.floor(Math.random() * actions.length)];
    this._recordInteraction('mischief', { label: action, mood: 'playful', duration: 0 });

    try {
      await this._speakProactive({ type: 'mischief', action }, {
        fallbackWhenBlocked: false,
        fallbackWhenUnavailable: false,
        minIntervalMs: 60000,
        typeMinIntervalMs: 120000,
      });
      if (action === 'nudge') await this._runMischiefNudge({ say: false });
      else if (action === 'peek') await this._runMischiefPeek({ say: false });
      else if (action === 'stateIdle') await this._runMischiefStateIdle();
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

  // 随机切换到特殊待机姿势（对标 VPet StateONE/StateTWO）
  async _runMischiefStateIdle() {
    const graph = this._pickAmbientGraph(['stateone', 'statetwo', 'state', 'idle']);
    if (graph === 'default') return;
    await this.playAnimation(graph, this.mode, () => {
      this._returnToBaseState(this.mode);
    }, { autoEndLoops: 2, ambient: true });
  }

  // 生日检测：对标 VPet HostBDay，生日当天播 bday 动画并庆祝
  async _checkBirthday() {
    try {
      const s = await invoke('get_pet_status', {});
      if (!s.isBirthday) return;
      const bdayMode = this.mode;
      const bdayMsg = `今天是我的生日！🎂 谢谢主人陪着我！`;
      if (this._hasAnimationGraph('bday')) {
        // 对标 VPet HostBDay: Say(text, "bday", force:true) → A_Start → B_Loop 持续循环
        // 先显示气泡+TTS，动画持续播放直到被交互打断
        this.showBubble(bdayMsg, 8000);
        if (!this._isSpeechBusy()) this._ttsSpeak(bdayMsg).catch(() => {});
        this.playAnimation('bday', bdayMode, null, { force: true });
      } else {
        this.showBubble(bdayMsg, 5000);
      }
    } catch (e) {
      console.warn('生日检测失败:', e);
    }
  }

  // 退出序列：先播 shutdown 动画，再真正关闭（对标 VPet Shutdown GraphType）
  _doShutdown() {
    if (this._hasAnimationGraph('shutdown')) {
      this.playAnimation('shutdown', this.mode, () => {
        invoke('quit_app', {});
      }, { autoEndLoops: 1, force: true });
    } else {
      invoke('quit_app', {});
    }
  }

  // 心情切换：先播 switch 过渡动画，再切模式（对标 VPet PlaySwitchAnimat）
  _applyMoodChange(prevMode, newMode, stats) {
    const modeRank = { happy: 0, normal: 1, poorCondition: 2, ill: 3 };
    const prev = modeRank[prevMode] ?? 1;
    const next = modeRank[newMode] ?? 1;

    // 根据属性低值判断触发原因（对标 VPet Switch_Hunger/Thirsty）
    const hunger = stats?.hunger ?? 100;
    const thirst = stats?.thirst ?? 100;
    let switchGraph;
    if (next > prev) {
      switchGraph = hunger < 20 ? 'switch_hunger' : thirst < 20 ? 'switch_thirsty' : 'switch_down';
    } else {
      switchGraph = 'switch_up';
    }

    const doSwitch = () => {
      this.mode = newMode;
      if (newMode === 'ill' && prevMode !== 'ill') this._startIllCough();
      else if (newMode !== 'ill' && prevMode === 'ill') this._stopIllCough();
      this.playAnimation('default', newMode, null, { ambient: true });
    };

    if (this._hasAnimationGraph(switchGraph)) {
      this.playAnimation(switchGraph, prevMode, doSwitch, { autoEndLoops: 1, ambient: true });
    } else if (this._hasAnimationGraph('switch_down') && next > prev) {
      this.playAnimation('switch_down', prevMode, doSwitch, { autoEndLoops: 1, ambient: true });
    } else {
      doSwitch();
    }
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

  // ── Coding Tool 监控 ──

  _startCodingMonitor() {
    // 通道1：监听 Tauri event（实时推送，Rust 后台线程每3秒 emit）
    if (window.PetRuntime && window.PetRuntime.listen) {
      // 只走 snapshot 单一通道 — snapshot 内已带 any_just_completed,
      // 再监听 task-complete 事件会把同一次完成播报两遍
      window.PetRuntime.listen('coding-monitor-snapshot', (event) => {
        const snapshot = event.payload;
        if (snapshot) this._processCodingSnapshot(snapshot);
      });
    }
    // 通道2：轮询 fallback
    this._pollCodingMonitorOnce();
    // 后台事件通道已每轮推送快照，这里只做低频兜底轮询
    this._codingMonitorTimer = setInterval(() => this._pollCodingMonitorOnce(), 20000);
  }

  async _pollCodingMonitorOnce() {
    try {
      const snapshot = await invoke('coding_tools_poll', {});
      if (snapshot) this._processCodingSnapshot(snapshot);
    } catch (_) {}
  }

  _processCodingSnapshot(snapshot) {
    this._codingMonitorTools = snapshot.tools || [];
    this._codingMonitorAnyWorking = !!snapshot.any_working;

    // 任务完成通知
    const justCompleted = snapshot.any_just_completed || [];
    if (justCompleted.length > 0) this._handleCodingTaskComplete(justCompleted);

    // 工作状态联动 — 后端已做完成判定滞回, 这里的 true/false 翻转即真实任务边界
    if (this._codingMonitorAnyWorking !== this._codingMonitorPrevWorking) {
      const bubbleNow = performance.now();
      if (this._codingMonitorAnyWorking) {
        if (!this._wasWorking && !this._manualSleepMode) {
          this._wasWorking = true;
          this._currentWorkContext = 'monitor_coding';
          // 停掉自主行走, 防止走路动画覆盖工作动画
          invoke('reset_walk_state', {}).catch(() => {});
          this.playAnimation('workone', this.mode);
          // 开工气泡 3 分钟冷却 — 短暂断续不重复刷屏, 动画状态照常切换
          if (!this._codingStartBubbleAt || bubbleNow - this._codingStartBubbleAt > 180000) {
            this._codingStartBubbleAt = bubbleNow;
            this.showBubble('检测到主人在用 coding 工具，我也来帮忙喵~', 3000);
          }
        }
      } else {
        if (this._wasWorking && this._currentWorkContext === 'monitor_coding') {
          this._wasWorking = false;
          this._currentWorkContext = null;
          this._returnToIdle(this.mode);
          if (!this._codingExitBubbleAt || bubbleNow - this._codingExitBubbleAt > 120000) {
            this._codingExitBubbleAt = bubbleNow;
            this.showBubble('工作完成啦，出去逛逛喵~', 2500);
          }
        }
      }
      this._codingMonitorPrevWorking = this._codingMonitorAnyWorking;
    }
  }

  _handleCodingTaskComplete(completedTools) {
    const now = performance.now();
    this._codingCompleteAnnouncedAt = this._codingCompleteAnnouncedAt || {};
    for (const toolName of completedTools) {
      // 同一工具 60 秒内只播报一次完成, 防御边沿信号重复
      const lastAt = this._codingCompleteAnnouncedAt[toolName];
      if (lastAt && now - lastAt < 60000) continue;
      this._codingCompleteAnnouncedAt[toolName] = now;
      const messages = [
        `主人, ${toolName} 中的任务已经执行完成啦！`,
        `${toolName} 跑完了喵~去看看吧！`,
      ];
      const msg = messages[Math.floor(Math.random() * messages.length)];
      this.showBubble(msg, 4000);
      this._tryTTSSpeak(msg);

      // 工作中 (直播/学习/监控工作态) 只播报不切动画 —
      // 否则 say 会打断工作动画, 1 秒后又被 game_tick 恢复, 看起来像中断重启
      if (!this._wasWorking && this._manifestAnimations.has('say')) {
        this.playAnimation('say', this.mode);
        setTimeout(() => {
          if (this.graphType === 'say') this._returnToIdle(this.mode);
        }, 3000);
      }
    }
  }

  async _pollCodingMonitor() {
    await this._pollCodingMonitorOnce();
    this.showBubble('已刷新监控状态', 1500);
  }

  async _tryTTSSpeak(text) {
    try {
      await invoke('tts_speak', { text, sing: false });
    } catch (_) {}
  }

  showBubble(text, duration = 2500) {
    const t = String(text || '').trim();
    if (t.length >= 2 && !/^[.。·…\s]+$/.test(t) && duration > 0) {
      const now = performance.now();
      if (!this._lastTalkStatAt || now - this._lastTalkStatAt > 1500) {
        this._lastTalkStatAt = now;
        this._bumpStat('talk');
      }
    }
    this._clearBubble();
    const bubble = document.createElement('div');
    bubble.className = 'pet-bubble';
    bubble.textContent = text;
    Object.assign(bubble.style, {
      position: 'fixed',
      left: '50%',
      bottom: `${PET_BODY_VIEWPORT_SIZE + 4}px`,
      transform: 'translate(-50%, 0)',
      background: 'rgba(0,0,0,0.78)',
      color: '#fff',
      padding: '7px 10px',
      borderRadius: '12px',
      fontSize: '12px',
      fontFamily: 'sans-serif',
      maxWidth: `${PET_BODY_VIEWPORT_SIZE - 12}px`,
      maxHeight: `${PET_BUBBLE_MAX_HEIGHT}px`,
      overflow: 'visible',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflowWrap: 'anywhere',
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
      bubble.style.transform = 'translate(-50%, -3px)';
    });
    if (duration > 0) {
      setTimeout(() => { this._dismissBubble(bubble); }, duration);
    }
  }

  _dismissBubble(bubble) {
    if (!bubble || !bubble.parentNode) return;
    if (this._currentBubble === bubble) this._currentBubble = null;
    bubble.style.opacity = '0';
    bubble.style.transform = 'translate(-50%, -10px)';
    setTimeout(() => bubble.remove(), 300);
  }

  _clearBubble() {
    if (this._currentBubble) {
      this._dismissBubble(this._currentBubble);
      this._currentBubble = null;
    }
  }

  // ── 工作/玩耍进行计时 (对标 VPet 工作进度条) ──

  _formatWorkClock(secs) {
    const total = Math.max(0, Math.floor(Number(secs) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // 工作期间常驻显示: 工种名 + 已用/总时长 + 进度条 + 累计收益
  _updateWorkTimerUI(work) {
    if (!work || !work.isActive) {
      this._removeWorkTimerUI();
      return;
    }
    let el = this._workTimerEl;
    if (!el) {
      el = document.createElement('div');
      el.className = 'pet-work-timer';
      Object.assign(el.style, {
        position: 'fixed',
        left: '50%',
        bottom: `${PET_BODY_VIEWPORT_SIZE - 12}px`,
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.72)',
        color: '#fff',
        padding: '3px 9px 4px',
        borderRadius: '9px',
        fontSize: '10px',
        fontFamily: 'sans-serif',
        lineHeight: '1.35',
        whiteSpace: 'nowrap',
        textAlign: 'center',
        zIndex: '140',
        pointerEvents: 'none',
      });
      const text = document.createElement('div');
      const bar = document.createElement('div');
      Object.assign(bar.style, {
        marginTop: '2px',
        height: '3px',
        borderRadius: '2px',
        background: 'rgba(255,255,255,0.25)',
        overflow: 'hidden',
      });
      const fill = document.createElement('div');
      Object.assign(fill.style, {
        height: '100%',
        width: '0%',
        background: '#7ec97f',
        borderRadius: '2px',
        transition: 'width 0.4s linear',
      });
      bar.appendChild(fill);
      el.appendChild(text);
      el.appendChild(bar);
      document.body.appendChild(el);
      this._workTimerEl = el;
      this._workTimerTextEl = text;
      this._workTimerFillEl = fill;
    }
    const name = work.name || '工作';
    const elapsedText = this._formatWorkClock(work.elapsedSecs);
    const totalSecs = Number(work.durationSecs) || 0;
    const totalText = totalSecs > 0 ? ` / ${this._formatWorkClock(totalSecs)}` : '';
    const pct = Math.round(Math.max(0, Math.min(1, Number(work.progress) || 0)) * 100);
    // Work 收益进金钱, Study/Play 收益进经验 (同 Rust WorkType 结算规则)
    const unit = work.type === 'Work' ? '金币' : '经验';
    const earned = Math.max(0, Number(work.getCount) || 0);
    this._workTimerTextEl.textContent = `⏱ ${name} ${elapsedText}${totalText} · +${earned.toFixed(1)}${unit}`;
    this._workTimerFillEl.style.width = `${pct}%`;
  }

  _removeWorkTimerUI() {
    if (this._workTimerEl) {
      this._workTimerEl.remove();
      this._workTimerEl = null;
      this._workTimerTextEl = null;
      this._workTimerFillEl = null;
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
    const hadThinking = !!this._thinkingTimer;
    if (this._thinkingTimer) {
      clearInterval(this._thinkingTimer);
      this._thinkingTimer = null;
    }
    if (finalSpeech) {
      this.showBubble(finalSpeech, Math.max(2800, finalSpeech.length * 90));
      // 话痨模式不播报语音
      // this._ttsSpeak(finalSpeech).catch(() => {});
    } else if (hadThinking) {
      this._clearBubble();
    }
  }

  // c_end 内可能拼接了多个落地姿势 (VPet 同目录下 FLA/FLB 等不同前缀 = 不同姿势)
  // 按 "所在目录 + 文件名前缀" 分组, 随机挑一种播放 — 对标 VPet 落地姿势随机
  _pickEndPoseVariant(phases) {
    const frames = phases?.c_end || [];
    if (frames.length < 2) return phases;
    const groups = new Map();
    for (const frame of frames) {
      const file = String(frame?.file || '');
      const dir = file.slice(0, file.lastIndexOf('/') + 1);
      const base = String(frame?.name || file.slice(dir.length));
      const prefix = base.split('_')[0] || base;
      const key = `${dir}|${prefix}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(frame);
    }
    if (groups.size <= 1) return phases;
    const variants = [...groups.values()];
    const picked = variants[Math.floor(Math.random() * variants.length)];
    return { ...phases, c_end: picked };
  }

  async _loadAnimation(graphType, mode, options = {}) {
    const resolvedGraphType = this._resolveGraphType(graphType);
    const phasesKey = `${resolvedGraphType}|${mode}`;
    const loadSeq = ++this._animationLoadSeq;

    let phases = phasesCache.get(phasesKey);
    if (!phases) {
      this.statusAnim.textContent = `Anim: loading ${resolvedGraphType}/${mode}...`;
      phases = await invoke('get_animation_frames', { graphType: resolvedGraphType, mode });
      phasesCache.set(phasesKey, phases);
    }
    // 缓存里存完整 phases, 变体裁剪只作用于本次播放的副本
    if (options.endPoseVariant) phases = this._pickEndPoseVariant(phases);

    // 收集所有帧路径 (含前景叠加层)
    const allPaths = [];
    for (const phase of ['a_start', 'b_loop', 'c_end', 'b_loop_front']) {
      const frames = phases[phase] || [];
      for (const f of frames) {
        allPaths.push(f.file);
      }
    }

    if (allPaths.length === 0) {
      throw new Error(`动画 ${resolvedGraphType}/${mode} 没有可播放帧`);
    }
    if (options.requirePlayableFrames && !['a_start', 'b_loop', 'c_end', 'b_loop_front'].some((phase) => (phases[phase] || []).length > 1)) {
      throw new Error(`动画 ${resolvedGraphType}/${mode} 不是可循环播放动作`);
    }

    // 有未缓存的帧才执行批量预加载
    if (allPaths.some(p => !frameCache.has(p))) {
      this.statusAnim.textContent = `Anim: preloading ${allPaths.length} frames...`;
      await preloadFrames(allPaths);
    }

    if (loadSeq !== this._animationLoadSeq && !options.force) return false;

    // 设置播放器
    this.player.setPhases(phases);
    this.player.play(() => {
      console.log(`动画 ${resolvedGraphType}/${mode} 播放完成`);
    });

    this.statusAnim.textContent = `Anim: ${resolvedGraphType}/${mode} ✓ (${allPaths.length}f)`;
    this.graphType = resolvedGraphType;
    this.mode = mode;
    return true;
  }

  // 后台预热常用动画，避免首次触发时的 IPC 延迟
  async _warmupCommon() {
    const warmupList = [
      ['touch_head', 'normal'], ['touch_head', 'happy'],
      ['touch_body', 'normal'],
      ['pinch', 'normal'],
      ['raise', 'normal'], ['raise', 'happy'], ['raise', 'poorCondition'], ['raise', 'ill'],
      ['eat', 'normal'], ['drink', 'normal'],
      ['sleep', 'normal'],
      ['say', 'normal'],
      ['think', 'normal'],
      ['idle', 'normal'],
      ['switch', 'normal'],
      ['work', 'normal'],
    ];
    for (const [gt, mode] of warmupList) {
      // 等待当前动画切换完成，避免抢占 IPC
      while (this._animatingLock) {
        await new Promise(r => setTimeout(r, 100));
      }
      try {
        const resolvedGt = this._resolveGraphType(gt);
        const phasesKey = `${resolvedGt}|${mode}`;
        if (!phasesCache.has(phasesKey) && this._isGraphAvailable(resolvedGt)) {
          const phases = await invoke('get_animation_frames', { graphType: resolvedGt, mode });
          phasesCache.set(phasesKey, phases);
          const allPaths = [];
          for (const phase of ['a_start', 'b_loop', 'c_end', 'b_loop_front']) {
            for (const f of (phases[phase] || [])) allPaths.push(f.file);
          }
          await preloadFrames(allPaths);
        }
      } catch (e) {
        console.warn(`[warmup] 预加载 ${gt}/${mode} 失败:`, e);
      }
      // 小延迟，避免阻塞渲染帧
      await new Promise(r => setTimeout(r, 120));
    }
    console.log('[warmup] 常用动画预加载完成');
  }

  // 切换动画
  // options: { autoEndLoops?: number, ambient?: boolean } - ambient 不占用手动交互锁
  async playAnimation(graphType, mode, onComplete, options = {}) {
    const resolvedGraphType = this._resolveGraphType(graphType);
    if (!options.force && !options.startPhase && resolvedGraphType === this.graphType && mode === this.mode && this.player.isPlaying && !options.foodImage && !options.autoEndLoops) {
      if (onComplete) onComplete();
      return true;
    }

    // 防止并发: 如果正在切换动画则跳过 (force 模式跳过此检查)
    if (this._animatingLock && !options.force) return false;
    this._animatingLock = true;
    this.player.onLoopCycle = null;
    const isAmbient = !!options.ambient;

    if (!isAmbient) {

    // 清除上一个手动动画锁定时器
    if (this._manualAnimTimer) {
      clearTimeout(this._manualAnimTimer);
      this._manualAnimTimer = null;
    }

    // 锁定手动动画，防止闲置行为覆盖
    this._manualAnimLock = true;
    const requestedLockDuration = Number(options.lockDurationMs);
    const lockDuration = Number.isFinite(requestedLockDuration) && requestedLockDuration > 0
      ? requestedLockDuration
      : ((options.autoEndLoops || 0) > 0 ? (options.autoEndLoops * 1000 + 2000) : 4000);
    this._manualAnimTimer = setTimeout(() => {
      this._manualAnimLock = false;
      this._manualAnimTimer = null;
    }, lockDuration);
    }

    let animationLoaded = false;
    try {
      animationLoaded = await this._loadAnimation(graphType, mode, {
        force: !!options.force,
        requirePlayableFrames: !!options.requirePlayableFrames,
        endPoseVariant: !!options.endPoseVariant,
      });
      // startPhase: 'b_loop' — 跳过 a_start 直接进入循环阶段 (对标 VPet 拖拽行为)
      if (animationLoaded && options.startPhase === 'b_loop') {
        this.player.goToLoop();
      } else if (animationLoaded && options.startPhase === 'c_end') {
        this.player.goToEnd();
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

    // 自动触发 c_end / 停在循环边界 (用于 pinch、touch、单次吃喝动作)
    if (options.autoEndLoops && options.autoEndLoops > 0) {
      const loops = Math.max(1, Number(options.autoEndLoops) || 1);
      let loopCount = 0;
      this.player.onLoopCycle = () => {
        if (!this.player.isPlaying || this.player.currentPhase !== 'b_loop') return;
        loopCount++;
        if (loopCount < loops) return;
        this.player.onLoopCycle = null;
        this.player.triggerEnd(() => {
          this._manualAnimLock = false;
          if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
          if (onComplete) onComplete();
        });
      };
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
    return animationLoaded;
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
        this._dragLastDy = dScreenY;
        this._dragTotalDx += dScreenX;
        this._dragTotalDy += dScreenY;
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

  _selectLandingAction({ wasDragging, wasHolding, mood }) {
    const totalDx = Number(this._dragTotalDx || 0);
    const totalDy = Number(this._dragTotalDy || 0);
    const lastDx = Number(this._dragLastDx || 0);
    const lastDy = Number(this._dragLastDy || 0);
    const distance = Math.hypot(totalDx, totalDy);
    const releaseSpeed = Math.hypot(lastDx, lastDy);
    const direction = (Math.abs(totalDx) >= 8 ? totalDx : lastDx) < 0 ? 'left' : 'right';
    const fallGraph = `move.fall.${direction}`;
    const canUseFall = this._hasAnimationGraph(fallGraph);

    const lightRelease = !wasDragging || (distance < 28 && releaseSpeed < 10);
    if (lightRelease) {
      return {
        kind: 'light',
        graph: 'raise',
        startPhase: 'c_end',
        message: '轻轻落地喵~',
        pauseMs: 2400,
        direction,
      };
    }

    // 仅当本次拖动距离超过屏幕工作区高度的 30% 才允许播放坠落动画 — 轻微拖动只做安全落地
    const dropThreshold = Math.round((this._lastWorkHeight || 0) * GRAVITY_DROP_MIN_RATIO) || GRAVITY_DROP_MIN_HEIGHT_PX;
    const draggedFarEnough = distance >= dropThreshold;
    const heavyRelease = canUseFall && draggedFarEnough && (distance > 180 || releaseSpeed > 42 || totalDy > 95 || mood === 'ill');
    if (heavyRelease) {
      const slideDx = (direction === 'left' ? -1 : 1) * Math.max(26, Math.min(72, 22 + releaseSpeed * 1.1));
      const slideDy = Math.max(8, Math.min(24, Math.abs(totalDy) * 0.18 + releaseSpeed * 0.2));
      return {
        kind: 'fall',
        graph: fallGraph,
        startPhase: 'a_start',
        message: '哎呀，摔了一下喵...',
        pauseMs: 4200,
        slideDx: Math.round(slideDx),
        slideDy: Math.round(slideDy),
        direction,
      };
    }

    return {
      kind: 'safe',
      graph: 'raise',
      startPhase: 'c_end',
      message: '安全落地喵~',
      pauseMs: 2600,
      direction,
    };
  }

  _finishLandingAction(mood) {
    this._clearManualAnimationLock();
    this._animatingLock = false;
    if (!this._wasWorking || !this._currentWorkContext?.graph) this._returnToIdle(mood);
    else this._scheduleWorkResumeAfterInterrupt(mood);
  }

  _animateFallLandingSlide(landing) {
    const dx = Number(landing?.slideDx || 0);
    const dy = Number(landing?.slideDy || 0);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) return;

    const steps = 9;
    const totalMs = 760;
    let lastX = 0;
    let lastY = 0;
    for (let i = 1; i <= steps; i++) {
      setTimeout(() => {
        const t = i / steps;
        const ease = 1 - Math.pow(1 - t, 2.2);
        const targetX = Math.round(dx * ease);
        const targetY = Math.round(dy * Math.sin(t * Math.PI * 0.5));
        const moveX = targetX - lastX;
        const moveY = targetY - lastY;
        lastX = targetX;
        lastY = targetY;
        if (moveX || moveY) invoke('move_window_by', { dx: moveX, dy: moveY }).catch(() => {});
      }, Math.round((totalMs / steps) * i));
    }

    setTimeout(() => {
      const reboundX = Math.round(-dx * 0.22);
      const reboundY = Math.round(-dy * 0.18);
      if (reboundX || reboundY) invoke('move_window_by', { dx: reboundX, dy: reboundY }).catch(() => {});
    }, totalMs + 160);
  }

  // 悬空松手 → 重力加速下坠到工作区底部
  // 返回值: { landed: true, loadedGraph } = 已坠地 (落地姿势由调用方接管),
  //         'aborted' = 下坠中被重新抓起, false = 不需要下坠
  async _gravityDropToGround(direction, mood) {
    const [pos, screen] = await Promise.all([
      invoke('get_window_position', {}),
      invoke('get_screen_info', {}),
    ]);
    const bounds = this._screenBounds(screen, pos);
    const visibleBounds = this._visiblePetBoundsPx(pos);
    const groundY = this._edgeFallBottomY(bounds, visibleBounds);
    let y = Math.round(Number(pos.y) || 0);
    const height = groundY - y;
    // 触发坠落的判据改为"本次拖动距离" — 只有把宠物拖动超过屏幕工作区高度的 30% 才坠落,
    // 这样把停在高处的宠物轻轻挪一下不会再演整套坠落动画
    const dragDistance = Math.hypot(Number(this._dragTotalDx || 0), Number(this._dragTotalDy || 0));
    const minDrop = Math.round(bounds.workHeight * GRAVITY_DROP_MIN_RATIO) || GRAVITY_DROP_MIN_HEIGHT_PX;
    if (dragDistance < minDrop) return false;
    // 拖动够远但已经贴近地面则无需坠落
    if (!Number.isFinite(height) || height < EDGE_FALL_BOTTOM_SAFE_GAP_PX) return false;

    this.showBubble('哇哇哇——要掉下去了喵！', 1600);
    const side = direction === 'left' ? 'left' : 'right';
    const fallCandidates = [`move.fall.${side}`, 'raise'].map((graph) => this._resolveGraphType(graph));
    const loadedGraph = await this._playAmbientGraphWithFallback(fallCandidates, mood, {
      force: true,
      startPhase: 'b_loop',
      endPoseVariant: true,
    });

    let velocity = 10;
    while (y < groundY) {
      if (this._dragging) return 'aborted';
      velocity = Math.min(velocity + GRAVITY_DROP_ACCEL_PX, GRAVITY_DROP_MAX_SPEED_PX);
      const step = Math.min(velocity, groundY - y);
      await invoke('move_window_by', { dx: 0, dy: step }).catch(() => {});
      y += step;
      if (y >= groundY) break;
      await new Promise((resolve) => setTimeout(resolve, GRAVITY_DROP_TICK_MS));
    }
    if (this._dragging) return 'aborted';
    return { landed: true, loadedGraph };
  }

  // 落地瞬间的姿势动画 — 对标 VPet: 摔落接 fall 的 c_end 起身,
  // 普通落地随机挑一种 Raised_Static C 段完美落地姿势
  async _playTouchdownPose(landing, loadedGraph, mood) {
    const resolvedLoaded = loadedGraph ? this._resolveGraphType(loadedGraph) : null;
    const fallEndReady = landing.kind === 'fall'
      && resolvedLoaded && this.graphType === resolvedLoaded
      && this.player?.currentPhase === 'b_loop'
      && this.player?.phases?.c_end?.length > 0;

    this.showBubble(fallEndReady ? landing.message : '安全落地喵~', 2200);
    this._walkPauseUntil = performance.now() + 2800;
    await new Promise((resolve) => {
      if (fallEndReady) {
        const timer = setTimeout(resolve, 2400);
        this.player.triggerEnd(() => {
          clearTimeout(timer);
          resolve();
        });
        return;
      }
      this.playAnimation('raise', mood, () => resolve(), {
        force: true,
        startPhase: 'c_end',
        endPoseVariant: true,
        lockDurationMs: 2600,
      }).then((ok) => {
        if (!ok) resolve();
      }).catch(() => resolve());
    });

    // 落地后按当前帧重新校准高度: 下坠时 groundY 是用提起/坠落帧的轮廓算的,
    // 这些帧脚部偏高, 直接落到该位置会让站立帧的脚陷进任务栏
    try {
      const [pos2, screen2] = await Promise.all([
        invoke('get_window_position', {}),
        invoke('get_screen_info', {}),
      ]);
      const bounds2 = this._screenBounds(screen2, pos2);
      const vb2 = this._visiblePetBoundsPx(pos2);
      const sink = (Math.round(Number(pos2.y) || 0) + vb2.bottom) - bounds2.workBottom;
      if (sink > 0) await invoke('move_window_by', { dx: 0, dy: -sink }).catch(() => {});
    } catch (_) {}
  }

  async _playLandingAction(landing, mood) {
    const finish = () => this._finishLandingAction(mood);

    // 先检测悬空: 距地面太高时重力下坠, 坠地后再接落地姿势
    const dropResult = await this._gravityDropToGround(landing.direction, mood).catch(() => false);
    if (dropResult === 'aborted') return; // 新一轮拖拽已接管状态
    if (dropResult && dropResult.landed) {
      await this._playTouchdownPose(landing, dropResult.loadedGraph, mood).catch(() => {});
      finish();
      return;
    }

    this.showBubble(landing.message, 2200);
    if (landing.kind === 'light' || landing.kind === 'safe') {
      const loaded = await this.playAnimation(landing.graph, mood, finish, {
        force: true,
        startPhase: 'c_end',
        endPoseVariant: true,
        lockDurationMs: landing.pauseMs,
      });
      if (!loaded) finish();
      return;
    }

    this._animateFallLandingSlide(landing);
    const loaded = await this.playAnimation(landing.graph, mood, finish, {
      force: true,
      autoEndLoops: 1,
      endPoseVariant: true,
      lockDurationMs: landing.pauseMs,
    });
    if (!loaded) {
      const fallbackLoaded = await this.playAnimation('raise', mood, finish, {
        force: true,
        startPhase: 'c_end',
        endPoseVariant: true,
        lockDurationMs: 2400,
      });
      if (!fallbackLoaded) finish();
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
    const landing = this._selectLandingAction({ wasDragging, wasHolding, mood });

    this._manualAnimLock = true;
    this._walkPauseUntil = performance.now() + landing.pauseMs;
    // 气泡由 _playLandingAction 决定 — 悬空下坠与原地落地的台词不同
    this._dragReleaseTimer = null;

    this._playLandingAction(landing, mood).catch((err) => {
      console.warn('落地动作播放失败:', err);
      this._finishLandingAction(mood);
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
    if (this._autoSleepActive) {
      this._autoSleepActive = false;
      invoke('pet_action_sleep', {}).catch(() => {});
    }
    this._stopRoamingAndReturnToIdle();
    this.showBubble('起床啦!', 1500);
    return true;
  }

  // ── 低状态自动照料 (对标 VPet: 饥饿讨食 / 体力枯竭自动睡觉 / 自动投喂) ──
  async _maybeAutoCare(status) {
    if (this._autoCareBusy) return;
    const st = status && status.stats;
    if (!st) return;
    const now = performance.now();

    // 自动睡眠中: 体力恢复 / 被打断 / 被手动唤醒 → 结束自动睡眠
    if (this._autoSleepActive) {
      const interrupted = this._dragging || this._toolbarActive || this._auxWindowActive || !this._manualSleepMode;
      if (st.energy > 55 || interrupted) {
        this._autoCareBusy = true;
        try {
          await invoke('pet_action_sleep', {}).catch(() => {});
          this._autoSleepActive = false;
          this._manualSleepMode = false;
          this._manualAnimLock = false;
          this._returnToIdle(this.mode);
          if (st.energy > 55 && !interrupted) this.showBubble('睡饱啦，精神多了~', 2000);
        } finally { this._autoCareBusy = false; }
      }
      return;
    }

    if (!this._canAmbientAct()) return;
    if (this._wasWorking || this._manualSleepMode || this._edgeClimbActive) return;

    const cooled = (key, ms) => !this._lastAutoCareAt[key] || now - this._lastAutoCareAt[key] > ms;

    // 1) 体力枯竭 → 自动睡觉
    if (st.energy < 8 && cooled('autosleep', 90000)) {
      this._lastAutoCareAt.autosleep = now;
      this._autoCareBusy = true;
      try {
        const r = await invoke('pet_action_sleep', {}).catch(() => null);
        const sleeping = r ? (r.sleepToggled !== false && r.isSleeping !== false) : false;
        if (sleeping) {
          this._autoSleepActive = true;
          this._manualSleepMode = true;
          this._manualAnimLock = true;
          if (this._manualAnimTimer) { clearTimeout(this._manualAnimTimer); this._manualAnimTimer = null; }
          await this.playAnimation('sleep', this.mode || 'normal');
          this.showBubble('太困了，先睡一会儿... Zzz', 2600);
        }
      } finally { this._autoCareBusy = false; }
      return;
    }

    // 2) 自动投喂 (设置开启 + 买得起合适的食物/饮品)
    const autoBuy = !!(this._petSettings && this._petSettings.enable_auto_buy);
    if (autoBuy && (st.hunger < 25 || st.thirst < 25) && cooled('autobuy', 40000)) {
      this._lastAutoCareAt.autobuy = now;
      this._autoCareBusy = true;
      try {
        const wantDrink = st.thirst <= st.hunger;
        const food = await this._pickAutoBuyFood(wantDrink, st.money);
        if (food) {
          const r = await invoke('pet_action_eat', { foodName: food.name }).catch(() => null);
          if (r && r.canAfford !== false) {
            const graph = r.graphType || food.graph || (wantDrink ? 'drink' : 'eat');
            this.showBubble(`肚子饿了，自己买了${food.name}~`, 2600);
            await this.playAnimation(graph, r.mood || this.mode || 'normal',
              () => this._returnToIdle(this.mode), { foodImage: r.foodImage, autoEndLoops: 1 });
          }
        }
      } finally { this._autoCareBusy = false; }
      return;
    }

    // 3) 饥饿讨食小动作 (未开启自动投喂时)
    if (!autoBuy && st.hunger < 15 && cooled('beg', 30000)) {
      this._lastAutoCareAt.beg = now;
      const begGraph = this._pickAmbientGraph(['idle_boring', 'think', 'switch']);
      if (begGraph && this._hasAnimationGraph(begGraph)) {
        this.showBubble('主人…我好饿，喂喂我嘛~', 2600);
        await this.playAnimation(begGraph, this.mode || 'normal',
          () => this._returnToIdle(this.mode), { ambient: true, autoEndLoops: 1 });
      }
    }
  }

  // ── 桌面交互小游戏: 追逐鼠标 (对标 VPet 桌面物理交互) ──
  async _startChaseGame() {
    if (this._chaseGameActive) return;
    if (this._dragging || this._wasWorking || this._musicActive || this._mischiefBusy) {
      this.showBubble('现在没空玩追逐呢~', 1800);
      return;
    }
    if (this._edgeClimbActive) {
      await this._interruptEdgeClimb({ pauseMs: 300, playDefault: true }).catch(() => {});
    }
    this._chaseGameActive = true;
    this._manualSleepMode = false;
    this._manualAnimLock = false;
    this._clearManualAnimationLock?.();
    invoke('reset_walk_state', {}).catch(() => {});
    this.showBubble('来追我呀~ 把鼠标移到旁边！', 2200);

    const CHASE_MS = 18000;
    const TICK_MS = 110;
    const MAX_STEP = 16;       // 每帧最大位移
    const CATCH_DIST = 70;     // 追到判定距离
    const startedAt = performance.now();
    let caught = false;
    let lastGraph = null;

    try {
      while (performance.now() - startedAt < CHASE_MS) {
        if (this._dragging || this._toolbarActive || this._auxWindowActive
            || this._musicActive || this._mischiefBusy || this._wasWorking) break;

        let cursor, pos;
        try {
          [cursor, pos] = await Promise.all([
            invoke('get_cursor_position', {}),
            invoke('get_window_position', {}),
          ]);
        } catch (_) { break; }
        if (!cursor || !pos) break;

        const vb = this._visiblePetBoundsPx(pos);
        const petCenterX = Math.round(Number(pos.x) || 0) + vb.left + vb.width / 2;
        const dx = Math.round(Number(cursor.x) || 0) - petCenterX;

        if (Math.abs(dx) <= CATCH_DIST) { caught = true; break; }

        const facingRight = dx > 0;
        this._facingRight = facingRight;
        const step = Math.max(-MAX_STEP, Math.min(MAX_STEP, dx));
        await invoke('move_window_by', { dx: step, dy: 0 }).catch(() => {});

        // 行走动画 (按方向)
        const dir = facingRight ? 'right' : 'left';
        const candidates = this._walkGraphCandidates(`move.walk.${dir}`, { facingRight });
        if (lastGraph !== candidates[0] || this.graphType !== this._walkRunGraphType) {
          lastGraph = candidates[0];
          this._playAmbientGraphWithFallback(candidates, this.mode).then((g) => {
            if (g && this._chaseGameActive) { this._walkGraphType = g; this._walkRunGraphType = g; }
          }).catch(() => {});
        }

        await new Promise((r) => setTimeout(r, TICK_MS));
      }
    } finally {
      this._chaseGameActive = false;
      this._walkRunGraphType = null;
      this._walkPendingGraphType = null;
      this._walkPauseUntil = performance.now() + 1500;
      invoke('reset_walk_state', {}).catch(() => {});

      if (caught) {
        const celebrate = this._pickAmbientGraph(['touch_head', 'switch', 'think']) || 'default';
        this.showBubble('抓到你啦！嘿嘿~', 2400);
        this.playAnimation(celebrate, 'happy', () => this._returnToIdle(this.mode), { autoEndLoops: 1 });
      } else {
        this.showBubble('追不上啦，呼呼…休息一下~', 2200);
        this._returnToIdle(this.mode);
      }
    }
  }

  // 自动投喂选品: 在买得起、无副作用的食物中选最便宜且能缓解对应需求的一项
  async _pickAutoBuyFood(preferDrink, money) {
    try {
      if (!this._foodMenuCache) {
        const menu = await invoke('get_food_menu', {});
        this._foodMenuCache = (menu && menu.items) || [];
      }
      const affordable = this._foodMenuCache.filter((f) =>
        Number(f.price) <= Number(money) && Number(f.price) >= 0
        && Number(f.health) >= 0 && Number(f.likability) >= 0);
      const pool = affordable.filter((f) => {
        const relief = preferDrink ? Number(f.strengthDrink) : Number(f.strengthFood);
        return relief > 0;
      });
      const chosen = pool.length ? pool : affordable;
      if (!chosen.length) return null;
      chosen.sort((a, b) => Number(a.price) - Number(b.price));
      return chosen[0];
    } catch (_) { return null; }
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
      // 在当前动作完整循环结束后再进入开心/待机，避免喝水第二圈中途硬切
      this._animatingLock = false;
      await this.playAnimation(graph, result.mood || 'normal', () => {
        const happyGraph = this._pickAmbientGraph(['touch_head', 'switch', 'think']);
        this._animatingLock = false;
        if (happyGraph && this._hasAnimationGraph(happyGraph)) {
          this.playAnimation(happyGraph, 'happy', () => {
            this._returnToIdle(result.mood || this.mode);
          }, { autoEndLoops: 1 });
        } else {
          this._returnToIdle(result.mood || this.mode);
        }
      }, { foodImage: result.foodImage, autoEndLoops: 1 });
      if (result.message) console.log('[Pet]:', result.message);
    } catch(e) { this.showBubble(type === 'drink' ? '喝不了...' : '吃不了...', 2000); }
  }

  // 使用背包物品 — 调后端 use_inventory_item (统计在后端计数), 播放对应动画
  async _handleUseInventory(name) {
    try {
      const result = await invoke('use_inventory_item', { name });
      if (!result || result.ok === false) {
        this.showBubble(result?.message || '用不了这个物品...', 2000);
        return;
      }
      // 道具/工具: 触发行为而非播放进食动画
      if (result.isTool) {
        if (result.showBubble) this.showBubble(result.showBubble, 2400);
        if (result.action === 'walk') {
          this._wasWorking = false;
          this._manualSleepMode = false;
          this._manualAnimLock = false;
          this._clearManualAnimationLock?.();
          this._walkPauseUntil = 0;
          invoke('reset_walk_state', {}).catch(() => {});
          invoke('force_walk', {}).catch(() => {});
        }
        return;
      }
      this._wasWorking = false;
      this._manualSleepMode = false;
      this._manualAnimLock = false;
      const graph = result.graphType || 'eat';
      if (result.showBubble) this.showBubble(result.showBubble, 2800);
      this._animatingLock = false;
      await this.playAnimation(graph, result.mood || 'normal', () => {
        this._animatingLock = false;
        this._returnToIdle(result.mood || this.mode);
      }, { foodImage: result.foodImage, autoEndLoops: 1 });
    } catch (e) {
      this.showBubble('用不了这个物品...', 2000);
    }
  }

  // 读取并应用持久化设置
  async _loadAndApplySettings() {
    try {
      const s = await invoke('get_settings', {});
      if (!s) return;
      this._petSettings = s;
      // 音量
      window.__petVolume = typeof s.volume === 'number' ? Math.max(0, Math.min(1, s.volume)) : 1;
      // 移动开关
      this._movementEnabled = s.enable_movement !== false;
      // 不透明度
      const container = document.getElementById('pet-container');
      if (container) container.style.opacity = String(Math.max(0.3, Math.min(1, s.opacity ?? 1)));
      // 缩放 (调整窗口尺寸, 画布按窗口自适应)
      const scale = Math.max(0.6, Math.min(1.8, s.scale ?? 1));
      if (Math.abs((this._appliedScale ?? 1) - scale) > 0.001) {
        this._appliedScale = scale;
        invoke('set_pet_window_scale', { scale }).catch(() => {});
      }
    } catch (_) {}
  }

  _fallbackSingSpeech(songTitle) {
    const title = songTitle || '这首歌';
    return `啦啦啦~我把《${title}》唱成小小旋律，轻轻送到主人耳边。`;
  }

  // AI 自言自语兜底 — 仅在已请求 AI 但没拿到内容时使用, 避免气泡空白
  _fallbackChatterSpeech() {
    const lines = [
      '嗯…我刚刚走神了，想到一些温柔的小事。',
      '今天也要元气满满喵~',
      '发会儿呆也挺好的，世界安安静静的。',
      '主人在忙吗？陪我说说话好不好呀~',
      '窗外的风好像在跟我打招呼呢。',
      '我在想，待会儿要不要去散个步喵~',
      '突然有点想喝热乎乎的东西了…',
      '安静的时候，连呼吸都变得很可爱呢。',
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  async _handleSingRequest(songTitle) {
    const title = String(songTitle || '').trim().replace(/\s+/g, ' ');
    if (!title) {
      this.showBubble('那下次再唱给你听~', 2000);
      return;
    }

    const seq = ++this._singSeq;
    const baseMood = this.mode || 'normal';
    const fallback = this._fallbackSingSpeech(title);
    const graph = this._pickMusicGraph('happy') || this._pickAmbientGraph(['say', 'idle_happy_like520', 'playone', 'stateone', 'think'], 'default');
    const playMode = this._hasPlayableFrames(graph, 'happy') ? 'happy' : baseMood;

    this._stopCurrentTts();
    this._recordInteraction('sing', { label: title, mood: 'happy', duration: SING_PERFORMANCE_LOCK_MS, suppressFeedback: true });
    this._manualSleepMode = false;
    this._walkPauseUntil = performance.now() + SING_PERFORMANCE_LOCK_MS;
    this._walkGraphType = graph;
    this._manualAnimLock = true;
    if (this._manualAnimTimer) clearTimeout(this._manualAnimTimer);
    if (this._singReturnTimer) {
      clearTimeout(this._singReturnTimer);
      this._singReturnTimer = null;
    }
    this._manualAnimTimer = setTimeout(() => {
      if (seq !== this._singSeq) return;
      this._manualAnimLock = false;
      this._manualAnimTimer = null;
    }, SING_PERFORMANCE_LOCK_MS);

    this.showBubble(`清清嗓子，给你唱《${title}》~`, 2200);
    this.playAnimation(graph, playMode, null, {
      force: true,
      startPhase: 'b_loop',
      lockDurationMs: SING_PERFORMANCE_LOCK_MS,
      requirePlayableFrames: true,
    }).catch(() => {});

    this._startThinkingDots();
    let speech = fallback;
    try {
      speech = await this._resolveProactiveSpeech({ type: 'sing', songTitle: title, label: title }, {
        fallback,
        force: true,
        forceType: true,
        minIntervalMs: 0,
        typeMinIntervalMs: 0,
        allowToolbarActive: true,
        allowAuxWindowActive: true,
        allowChatActive: true,
      }) || fallback;
    } catch (e) {
      console.warn('唱歌生成失败:', e);
      speech = fallback;
    } finally {
      this._stopThinkingDots();
    }

    if (seq !== this._singSeq) return;
    this._markProactiveAi('sing');
    const bubbleDuration = Math.max(4200, Math.min(SING_PERFORMANCE_LOCK_MS, speech.length * 120));
    // 歌词气泡与语音同步 — TTS 合成耗时数秒, 等真正开声那一刻再显示歌词,
    // 合成期间继续显示思考点, 避免文字早到、声音迟到
    let lyricsShown = false;
    const showLyrics = () => {
      if (lyricsShown) return;
      lyricsShown = true;
      this._stopThinkingDots();
      if (seq === this._singSeq) this.showBubble(speech, bubbleDuration);
    };
    this._startThinkingDots();
    await this._ttsSpeak(speech, { force: true, dedupeMs: 0, sing: true, onStart: showLyrics }).catch(() => false);
    // TTS 不可用或合成失败时兜底直接显示歌词
    showLyrics();

    if (seq !== this._singSeq) return;
    const returnDelay = Math.max(3200, Math.min(SING_PERFORMANCE_LOCK_MS, speech.length * 150 + 1200));
    this._singReturnTimer = setTimeout(() => {
      if (seq !== this._singSeq) return;
      this._singReturnTimer = null;
      this._returnToBaseState(baseMood, { ambient: true });
    }, returnDelay);
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

  async _handleGift() {
    // 打开食物面板（礼物分类），选择后由 food-selected 事件驱动 _handleEatFood
    try { await invoke('open_food_panel', { filter: 'gift' }); }
    catch (_) { this.showBubble('礼物面板打不开...', 2000); }
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

    // 将宠物本体固定绘制在窗口下方，顶部透明区留给聊天气泡
    const bodyViewportH = Math.min(PET_BODY_VIEWPORT_SIZE, H);
    const bodyViewportW = Math.min(PET_BODY_VIEWPORT_SIZE, W);
    const bodyLeft = (W - bodyViewportW) / 2;
    const bodyTop = H - bodyViewportH;
    const scale = Math.min(bodyViewportW / img.naturalWidth, bodyViewportH / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = bodyLeft + (bodyViewportW - dw) / 2;
    const dy = bodyTop + (bodyViewportH - dh) / 2;

    // 保存渲染参数供坐标转换使用
    this._renderScale = scale;
    this._renderDx = dx;
    this._renderDy = dy;

    ctx.drawImage(img, dx, dy, dw, dh);

    // VPet 食物中间层 (FoodAnimation): 绘制在后层身体之上、前层爪子之下
    // 关键帧坐标基于 VPet 500x500 食物网格, 按宠物本体区域等比映射
    const foodKf = this.player.currentFoodKeyframe;
    const foodImg = this.player.foodImage;
    if (foodKf && foodKf.visible && foodImg) {
      const foodScale = Math.min(
        bodyViewportW / FOOD_ANIMATION_LOGICAL_SIZE,
        bodyViewportH / FOOD_ANIMATION_LOGICAL_SIZE,
      );
      const foodAreaW = FOOD_ANIMATION_LOGICAL_SIZE * foodScale;
      const foodAreaH = FOOD_ANIMATION_LOGICAL_SIZE * foodScale;
      const foodDx = bodyLeft + (bodyViewportW - foodAreaW) / 2;
      const foodDy = bodyTop + (bodyViewportH - foodAreaH) / 2;
      const fw = foodKf.width * foodScale;
      const fh = foodKf.width * foodScale;
      const cx = foodDx + foodKf.x * foodScale + fw / 2;
      const cy = foodDy + foodKf.y * foodScale + fh / 2;
      ctx.save();
      ctx.globalAlpha = Number.isFinite(foodKf.opacity) ? foodKf.opacity : 1;
      ctx.translate(cx, cy);
      ctx.rotate((foodKf.rotate * Math.PI) / 180);
      ctx.drawImage(foodImg, -fw / 2, -fh / 2, fw, fh);
      ctx.restore();
    }

    // VPet 前景叠加层 (front_lay): 绘制在主帧上方
    const frontImg = this.player.frontImage;
    if (frontImg) {
      const fs = Math.min(bodyViewportW / frontImg.naturalWidth, bodyViewportH / frontImg.naturalHeight);
      const fdw = frontImg.naturalWidth * fs;
      const fdh = frontImg.naturalHeight * fs;
      const fdx = bodyLeft + (bodyViewportW - fdw) / 2;
      const fdy = bodyTop + (bodyViewportH - fdh) / 2;
      ctx.drawImage(frontImg, fdx, fdy, fdw, fdh);
    }

    this._updateBubblePlacement();
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
    if (this._walkTickBusy || this._edgeTopDropActive || this._chaseGameActive) return;
    // 设置中关闭了自主移动
    if (this._movementEnabled === false) {
      if (this._edgeClimbActive) await this._interruptEdgeClimb({ pauseMs: 900, playDefault: true });
      return;
    }
    if (this._dragging || this._manualSleepMode) {
      this._stopMoveTimer();
      if (this._edgeClimbActive) await this._interruptEdgeClimb({ pauseMs: 900, dropFromTop: false });
      return;
    }
    if (this._toolbarActive || this._auxWindowActive || this._musicActive || this._mischiefBusy) {
      this._stopMoveTimer();
      if (this._edgeClimbActive) await this._interruptEdgeClimb({ pauseMs: 900, playDefault: true });
      return;
    }
    // 手动动画锁/聊天期间不阻断位移，仅在拿到 walk_tick 结果后跳过动画更新
    // 工作中不移动 — 否则走路动画会覆盖工作动画
    if (this._wasWorking) {
      this._stopMoveTimer();
      if (this._edgeClimbActive) {
        await this._interruptEdgeClimb({ pauseMs: 900, playDefault: true });
      }
      return;
    }

    const now = performance.now();
    if (this._edgeClimbActive) {
      this._walkTickBusy = true;
      try {
        const [pos, screen] = await Promise.all([
          invoke('get_window_position', {}),
          invoke('get_screen_info', {}),
        ]);
        if (this._dragging || this._manualSleepMode || this._manualAnimLock) {
          await this._interruptEdgeClimb({ pauseMs: 900, dropFromTop: false, pos, screen });
          return;
        }
        if (this._toolbarActive || this._auxWindowActive || this._musicActive || this._mischiefBusy) {
          await this._interruptEdgeClimb({ pauseMs: 900, playDefault: true, pos, screen });
          return;
        }
        if (performance.now() < this._chatActiveUntil) {
          await this._interruptEdgeClimb({ pauseMs: 900, playDefault: true, pos, screen });
          return;
        }
        if (this.chatUI && this.chatUI._isSending) {
          await this._interruptEdgeClimb({ pauseMs: 900, playDefault: true, pos, screen });
          return;
        }
        await this._advanceEdgeClimb(pos, screen);
      } catch (_) {
        await this._interruptEdgeClimb({ pauseMs: 900, playDefault: true });
      } finally {
        this._walkTickBusy = false;
      }
      return;
    }
    if (now < this._edgeMoveUntil) {
      this._walkTickBusy = true;
      try {
        if (this._edgeMoveGraphType && this.graphType !== this._edgeMoveGraphType) {
          await this._playAmbientGraphWithFallback([this._edgeMoveGraphType, 'default'], this.mode, { force: true });
        }
        const dy = Number.isFinite(this._edgeMoveDy) ? Math.round(this._edgeMoveDy) : 0;
        if (dy !== 0) await invoke('move_window_by', { dx: 0, dy }).catch(() => {});
      } finally {
        this._walkTickBusy = false;
      }
      return;
    }
    if (this._edgeMoveUntil > 0) {
      this._edgeMoveUntil = 0;
      this._edgeMoveDy = 0;
      this._edgeMoveGraphType = null;
      this._walkRunGraphType = null;
      this._walkEndPending = false;
      this._walkGraphType = 'default';
      this._walkPauseUntil = now + 900;
      this.playAnimation('default', this.mode || 'normal', null, { ambient: true }).catch(() => {});
      return;
    }
    if (now < this._walkPauseUntil) return;

    const dtSeconds = this._lastWalkTickAt
      ? Math.max(0.08, Math.min(0.25, (now - this._lastWalkTickAt) / 1000))
      : 0.12;
    this._lastWalkTickAt = now;
    this._walkTickBusy = true;

    try {
      const [pos, screen] = await Promise.all([
        invoke('get_window_position', {}),
        invoke('get_screen_info', {}),
      ]);

      if (this._dragging || this._manualSleepMode) return;
      if (performance.now() < this._walkPauseUntil) return;
      if (this._toolbarActive || this._auxWindowActive || this._musicActive || this._mischiefBusy) return;

      const bounds = this._screenBounds(screen, pos);
      const visibleBounds = this._visiblePetBoundsPx(pos);

      // 自愈: 任何原因 (坠落帧轮廓偏差/拖拽) 导致脚部陷进任务栏时, 上移回工作区底边
      const sinkBelowWork = (Math.round(Number(pos.y) || 0) + visibleBounds.bottom) - bounds.workBottom;
      if (sinkBelowWork > 0) {
        await invoke('move_window_by', { dx: 0, dy: -sinkBelowWork }).catch(() => {});
        pos.y = Math.round(Number(pos.y) || 0) - sinkBelowWork;
      }

      const result = await invoke('walk_tick', {
        dtSeconds,
        windowX: Math.round(Number(pos.x) || 0) + visibleBounds.left - bounds.workLeft,
        windowY: Math.round(Number(pos.y) || 0) + visibleBounds.top - bounds.workTop,
        windowW: Math.max(1, Math.round(visibleBounds.width)),
        windowH: Math.max(1, Math.round(visibleBounds.height)),
        screenW: Math.max(1, Math.round(bounds.workWidth)),
        screenH: Math.max(1, Math.round(bounds.workHeight)),
      });

      // 对标 VPet: Rust 仅计算方向/速度/动画类型, 由前端在走路 B_Loop 阶段连续移动窗口
      // 手动动画锁 / 聊天气泡显示中：跳过动画切换，但不阻断位移
      if (this._dragging || this._manualSleepMode) return;
      if (this._manualAnimLock || performance.now() < this._chatActiveUntil
          || (this.chatUI && this.chatUI._isSending)) return;
      if (this._toolbarActive || this._auxWindowActive || this._musicActive || this._mischiefBusy) return;

      if (result.edgeHit) {
        this._stopMoveTimer();
        const climbReady = !this._edgeClimbCooldownUntil || now > this._edgeClimbCooldownUntil;
        if (climbReady && Math.random() < EDGE_CLIMB_CHANCE) {
          const nextPos = {
            ...pos,
            x: Math.round(Number(pos.x) || 0) + Math.round(Number(result.dx) || 0),
            y: Math.round(Number(pos.y) || 0) + Math.round(Number(result.dy) || 0),
          };
          await this._startEdgeClimb(result, nextPos, screen);
          return;
        }
        // 不爬墙: 进入冷却, 用翻转后的朝向继续行走 (Rust 已翻转方向)
        this._edgeClimbCooldownUntil = now + EDGE_CLIMB_COOLDOWN_MS;
        const turnDir = result.facingRight === false ? 'left' : 'right';
        result.graphType = `move.walk.${turnDir}`;
      }

      const nextGraphType = this._resolveWalkGraphType(result);
      const isWalking = !!result.walking && (result.dx !== 0 || result.dy !== 0);
      const isWalkAnim = !!(nextGraphType && nextGraphType.startsWith('move.walk.'));
      const walkCandidates = isWalkAnim ? this._walkGraphCandidates(nextGraphType, result) : [];

      // 记录朝向；行走图片直接使用 VPet 的 left/right 资源，不再靠画布翻转伪造方向
      this._facingRight = result.facingRight !== false;
      this.canvas.style.transform = '';

      // ── MoveTimer: 对标 VPet 位移与动画解耦 ──
      // VPet 核心机制: MoveTimer 在 A_Start 完成后才启动
      // 当前实现: 先确保走路动画已加载播放, 然后才启动 MoveTimer
      // 如果走路动画还没播上, 只缓存速度向量但不启动 MoveTimer → 避免"平移没动作"
      if (isWalking) {
        this._moveTimerDx = Math.round(Number(result.dx) || 0);
        this._moveTimerDy = Math.round(Number(result.dy) || 0);
        // 走路动画已在播放 → 启动/继续 MoveTimer
        if (this._walkRunGraphType && this._isWalkPlayerHealthy(this._walkRunGraphType) && !this._moveTimer) {
          this._startMoveTimer();
        }
      } else {
        // 不在行走 → 停止 MoveTimer
        this._stopMoveTimer();
      }

      if (isWalking && walkCandidates.length) {
        this._walkEndPending = false;

        // ── 对标 VPet 行走动画机制 ──
        // MoveTimer (窗口位移) 已在上方统一管理, 此处仅负责动画播放
        // A_Start → B_Loop 自然过渡, 无需手动干预

        const speedPxPerSec = Number(result.speedPxPerSec) || 80;
        const direction = result.facingRight !== false ? 1 : -1;

        // 走路动画匹配判断
        const walkAnimMatched = !!this._walkRunGraphType
          && walkCandidates.includes(this._walkRunGraphType)
          && this.graphType === this._walkRunGraphType;

        // 动画已健康播放 → 本帧不重复加载
        if (walkAnimMatched && this._isWalkPlayerHealthy(this._walkRunGraphType)) return;
        // 走路动画加载中 (最长等待 2s) → 不重复触发, 否则会卡在 A_Start 反复重播
        const pendingFresh = walkCandidates.includes(this._walkPendingGraphType)
          && performance.now() - this._walkPendingStartedAt < 2000;
        if (pendingFresh) return;

        // 尚未播放走路动画 → 加载并播放 (A_Start → B_Loop)
        const preferredWalkGraph = walkCandidates[0];
        this._walkPendingGraphType = preferredWalkGraph;
        this._walkPendingStartedAt = performance.now();
        this._playAmbientGraphWithFallback(walkCandidates, this.mode)
          .then((loadedWalkGraph) => {
            if (this._walkPendingGraphType !== preferredWalkGraph) return;
            if (!loadedWalkGraph) { invoke('reset_walk_state', {}).catch(() => {}); return; }
            if (this._dragging || this._manualSleepMode || this._manualAnimLock) return;
            if (this._toolbarActive || this._auxWindowActive || this._musicActive || this._mischiefBusy) return;
            this._walkGraphType = loadedWalkGraph;
            this._walkRunGraphType = loadedWalkGraph;
            // 走路动画加载成功 → 启动 MoveTimer (对标 VPet: A_Start 完成回调中启动 MoveTimer)
            if (!this._moveTimer && (this._moveTimerDx !== 0 || this._moveTimerDy !== 0)) {
              this._startMoveTimer();
            }
          })
          .catch(() => { invoke('reset_walk_state', {}).catch(() => {}); })
          .finally(() => {
            if (this._walkPendingGraphType === preferredWalkGraph) this._walkPendingGraphType = null;
          });
        return;
      }

      if (this._walkRunGraphType && !isWalking) {
        // 停止行走位移定时器 (对标 VPet: StopMoving → MoveTimer.Enabled = false)
        this._stopMoveTimer();
        const endingGraph = this._walkRunGraphType;
        this._walkRunGraphType = null;
        this._walkPendingGraphType = null;
        if (!this._walkEndPending && this.graphType === endingGraph && this.player.currentPhase === 'b_loop') {
          this._walkEndPending = true;
          this._walkPauseUntil = performance.now() + 650;
          this.player.triggerEnd(() => {
            this._walkEndPending = false;
            this._walkGraphType = 'default';
            const idleGraph = nextGraphType || 'default';
            this.playAnimation(idleGraph, this.mode, null, { ambient: true });
          });
          return;
        }
      }

      // 自主巡游/闲置切换属于环境动作，不占用手动动画锁
      if (nextGraphType && nextGraphType !== this._walkGraphType && nextGraphType !== this._walkPendingGraphType) {
        this._walkPendingGraphType = nextGraphType;
        this._walkPendingStartedAt = performance.now();
        this.playAnimation(nextGraphType, this.mode, null, { ambient: true })
          .then((loaded) => {
            if (!loaded || this._walkPendingGraphType !== nextGraphType) return;
            if (this._dragging || this._manualSleepMode || this._manualAnimLock) return;
            if (this._toolbarActive || this._auxWindowActive || this._musicActive || this._mischiefBusy) return;
            this._walkGraphType = nextGraphType;
          })
          .catch(() => {})
          .finally(() => {
            if (this._walkPendingGraphType === nextGraphType) this._walkPendingGraphType = null;
          });
      }
    } catch (e) { /* 静默 */ }
    finally {
      this._walkTickBusy = false;
    }
  }

  // ── 点击穿透 ──
  // 轮询检测鼠标是否在宠物精灵非透明像素上，动态切换窗口点击穿透

  async _checkClickthrough() {
    if (this._clickthroughCheckBusy) return;

    const panelActive = !!(this.chatUI && this.chatUI.isVisible);
    if (this._dragging || this._toolbarActive || this._auxWindowActive || panelActive) {
      this._setClickthrough(false);
      return;
    }

    this._clickthroughCheckBusy = true;
    this._clickthroughLastCheckAt = performance.now();

    try {
      const [pos, screenCursorPos] = await Promise.all([
        invoke('get_window_position', {}),
        invoke('get_cursor_position', {}).catch(() => null),
      ]);

      const stillPanelActive = !!(this.chatUI && this.chatUI.isVisible);
      if (this._dragging || this._toolbarActive || this._auxWindowActive || stillPanelActive) {
        this._setClickthrough(false);
        return;
      }

      // 仅在 Rust 光标查询失败时才走运行时回退，避免每轮多发一次 IPC
      let client = this._cursorClientPoint(pos, screenCursorPos);
      if (!client && !screenCursorPos) {
        const windowCursorPos = await window.PetRuntime.cursorPosition(null).catch(() => null);
        client = this._cursorClientPoint(pos, windowCursorPos);
      }
      if (!client) {
        this._setClickthrough(true);
        return;
      }

      const canvasPoint = this._canvasPointFromClient(client.x, client.y);
      const hasPetPixel = !!(canvasPoint && this._hasOpaqueCanvasPixel(canvasPoint.x, canvasPoint.y));
      const hasBubble = this._isBubbleClientHit(client.x, client.y);
      this._setClickthrough(!(hasPetPixel || hasBubble));
    } catch (_) { /* 静默 */ }
    finally {
      this._clickthroughCheckBusy = false;
    }
  }

  // ── SideHide 边缘检测 ──

  async _checkSideHide() {
    if (this._edgeClimbActive || this._dragging || this._manualSleepMode || this._manualAnimLock || this._toolbarActive || this._auxWindowActive || this._musicActive || this._mischiefBusy) return;
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
          if (!this.app._isSpeechBusy()) this.app._ttsSpeak(final).catch(() => {});
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
