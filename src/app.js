// DesktopPetApp v2 - 使用 VPet 真实 PNG 帧

class DesktopPetApp {
  constructor() {
    this.canvas = document.getElementById('pet-canvas');
    this.hungerFill = document.getElementById('hunger-fill');
    this.happyFill = document.getElementById('happy-fill');
    this.container = document.getElementById('pet-container');

    // === 加载 manifest ===
    this._manifest = null;
    this._loadManifest();

    // === 核心模块 ===
    this.controller = new Controller();
    this.stats = new EnhancedStats();
    this.inventory = null;
    this.pngLoader = null;
    this.graphCore = null;
    this.core = null;

    // 等待 manifest 加载后初始化
    this._initAfterManifest();
  }

  async _loadManifest() {
    try {
      if (isElectron() && window.electronAPI.readAssetFile) {
        const json = window.electronAPI.readAssetFile('assets/pet-manifest.json');
        if (json) {
          this._manifest = JSON.parse(json);
        }
      } else {
        const resp = await fetch('../assets/pet-manifest.json');
        this._manifest = await resp.json();
      }
    } catch (e) {
      console.error('加载 manifest 失败:', e);
    }
  }

  async _initAfterManifest() {
    // 等待 manifest
    while (!this._manifest) {
      await new Promise(r => setTimeout(r, 50));
    }

    // 本地资源根目录
    const assetBase = '../assets/vup/';

    this.pngLoader = new PngLoader(this._manifest, assetBase);
    this.graphCore = new GraphCore(this.pngLoader);
    this.core = new GameCore(this.controller, this.graphCore, this.stats);

    this.messageBar = new MessageBar();
    this.effects = new Effects();
    this.petLogic = new PetLogic(this.core, this.graphCore, this.messageBar, this.effects, this.stats);
    this.renderer = new PetRenderer(this.canvas, this.graphCore, this.effects, this.messageBar);

    // AI 模块
    this.llmClient = new LLMClient();
    this.persona = new PersonaSystem();
    this.memory = new PetMemory();
    this.chatUI = new ChatUI(this.container, this.core, this.llmClient, this.persona, this.messageBar, this.memory);
    this.aiSettings = new AISettings(this.llmClient, this.persona);

    this.workSystem = new WorkSystem(this.core, this.petLogic);
    this.inventory = new InventorySystem();
    this.codingMonitor = new CodingToolMonitor();
    this.actionHandlers = this._createActionHandlers();

    this.toolbar = new Toolbar(this.core, this.actionHandlers);
    this.actionPanel = new ActionPanel(this.core, {
      actions: this.actionHandlers,
      inventory: this.inventory,
      onUseItem: (itemId) => this._useInventoryItem(itemId),
    });

    this.sideHide = new SideHide(this.core, this.controller);

    // 游戏循环
    this.lastTime = performance.now();
    this.isRunning = true;

    // 鼠标状态
    this.isPotentialDrag = false;
    this.dragStartX = 0; this.dragStartY = 0;
    this.dragStartTime = 0;
    this.dragLastX = 0; this.dragLastY = 0; this.dragLastTime = 0;
    this.petStartX = 0; this.petStartY = 0;
    this.hasMoved = false;

    this._loadStats();
    this._loadBehaviorSettings();
    this._setupEventListeners();
    this._setupElectronIPC();

    // 预加载常用动画
    console.log('预加载动画帧...');
    await this.graphCore.preloadCommon();
    console.log('动画预加载完成');

    // 初始化 Coding Tool 监控
    this._setupCodingMonitor();

    // 播放入场动画
    this.core.currentGraphType = 'startup';
    this.graphCore.playChain('startup', 'normal', this.renderer.onFrame, () => {
      this.core.currentGraphType = 'default';
      this.core.resetIdle();
    });

    // 启动循环
    this.gameLoop();
  }

  _loadStats() {
    try {
      let data;
      if (isElectron() && window.electronAPI.loadStats) {
        data = window.electronAPI.loadStats();
      } else {
        data = loadFromStorage('desktop-pet-stats');
      }
      if (data) this.stats.loadFromObject(data);
    } catch (e) { /* ignore */ }
  }

  _createActionHandlers() {
    const handlers = {};
    Object.values(ACTION_CATALOG).forEach((action) => {
      handlers[action.id] = () => this._runAction(action.id);
    });

    const legacyMap = {
      feed: 'feed.food',
      play: 'interaction.play',
      pinch: 'interaction.pinch',
      dance: 'study.dance',
      mischief: 'interaction.mischief',
      work: 'work.live',
      live: 'work.live',
      study: 'study.calligraphy',
      bag: 'feed.bag',
      'clean-screen': 'work.cleanScreen',
      chat: 'system.chat',
      settings: 'system.settings',
      sleep: 'system.sleep',
    };

    Object.entries(legacyMap).forEach(([legacy, actionId]) => {
      handlers[legacy] = () => this._runAction(actionId);
    });

    return handlers;
  }

  _runAction(actionId) {
    if (actionId === 'strong-dance') {
      this.petLogic.startDance(true);
      return true;
    }

    const action = getActionMeta(actionId);
    if (!action) return false;

    if (action.kind === 'activity') {
      this.workSystem.start(action.id);
      this.actionPanel?.refresh();
      return true;
    }

    if (action.kind === 'inventory') {
      return this._useFirstInventoryType(action);
    }

    if (action.kind === 'instant') {
      if (action.id === 'work.cleanScreen') return this._runCleanScreen(action);
      this.petLogic.performAction(action);
      this.actionPanel?.refresh();
      return true;
    }

    if (action.kind === 'panel' && action.panel === 'bag') {
      this.actionPanel?.setActiveTab('bag');
      return true;
    }

    if (action.kind === 'direct') {
      return this._runLegacyAction(action.legacyAction);
    }

    if (action.kind === 'monitor') {
      this._toggleMonitorPanel();
      return true;
    }

    return false;
  }

  _runLegacyAction(action) {
    switch (action) {
      case 'play': this.petLogic.play(); break;
      case 'pinch': this.petLogic.onPinch(); break;
      case 'mischief': this.petLogic.startMischief(); break;
      case 'chat': this.chatUI.toggle(); break;
      case 'settings': this.aiSettings.show(); break;
      case 'sleep':
        this.workSystem.stop({ silent: true });
        this.petLogic.startSleeping();
        break;
      default: return false;
    }
    this.actionPanel?.refresh();
    return true;
  }

  _useFirstInventoryType(action) {
    this.workSystem.stop({ silent: true });
    const result = this.inventory.useFirst(action.itemType, this.stats);
    if (!result.ok) {
      this.messageBar.say('背包里没有这个了喵~');
      this.actionPanel?.setActiveTab('bag');
      return false;
    }
    this.petLogic.performFeedItem(action, result.item);
    this.actionPanel?.refresh();
    return true;
  }

  _useInventoryItem(itemId) {
    this.workSystem.stop({ silent: true });
    const result = this.inventory.useItem(itemId, this.stats);
    if (!result.ok) {
      this.messageBar.say('这个物品已经没有了喵~');
      this.actionPanel?.refresh();
      return false;
    }

    const action = Object.values(ACTION_CATALOG).find((item) => item.kind === 'inventory' && item.itemType === result.item.type);
    this.petLogic.performFeedItem(action, result.item);
    this.actionPanel?.refresh();
    return true;
  }

  _runCleanScreen(action) {
    this.workSystem.stop({ silent: true });
    this.petLogic.performAction(action);
    if (action.rewards) {
      this.stats.applyActivityReward({ rewards: action.rewards });
      this.petLogic._autoSave();
    }
    this._showCleanScreenEffect();
    this.actionPanel?.refresh();
    return true;
  }

  _showCleanScreenEffect() {
    const old = document.getElementById('clean-screen-effect');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'clean-screen-effect';
    overlay.innerHTML = '<span>擦擦屏幕中...</span>';
    this.container.appendChild(overlay);
    setTimeout(() => overlay.classList.add('done'), 300);
    setTimeout(() => overlay.remove(), 1400);
  }

  _loadBehaviorSettings() {
    const behavior = loadFromStorage('pet-behavior-settings', { sideHide: true, proactive: true });
    if (!behavior.sideHide) this.sideHide.disable();
  }

  _setupCodingMonitor() {
    const monitor = this.codingMonitor;

    // 任务完成回调：气泡 + TTS
    monitor.onTaskComplete((toolName, toolId, message) => {
      this.messageBar.say(message);
      this.petLogic.say(message);
      this.core.addEvent(`${toolName} 任务完成`);

      // 尝试 TTS 语音播报
      this._tryTTS(message);
    });

    // 工作状态变化回调：进入/退出工作状态
    monitor.onWorkStateChange((isWorking) => {
      if (isWorking) {
        // 有 coding 工具正在工作 → 宠物进入文案工作状态
        if (this.core.state === PetState.IDLE || this.core.state === PetState.WALK) {
          const workMeta = getActionMeta('work.copywriting') || {
            id: 'work.copywriting',
            animation: { graphTypes: ['workone', 'work', 'idle'] },
          };
          this.petLogic.startWork('monitor_coding', workMeta);
          this.messageBar.say('检测到主人在用 coding 工具，我也来帮忙喵~');
        }
      } else {
        // 所有 coding 工具都不在工作了 → 退出工作状态，进入闲游
        if (this.core.state === PetState.WORK && this.core.activity === 'monitor_coding') {
          this.petLogic.stopWork();
          this.core.startWalking();
          this.messageBar.say('工作完成啦，出去逛逛喵~');
        }
      }
    });

    // 启动监控
    monitor.start();
    console.log('[CodingToolMonitor] 已启动');
  }

  async _tryTTS(text) {
    try {
      if (window.PetRuntime && typeof window.PetRuntime.invoke === 'function') {
        await window.PetRuntime.invoke('tts_speak', { text, sing: false });
      }
    } catch (_) {
      // TTS 未配置或失败，静默忽略
    }
  }

  _setupEventListeners() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.toolbar && this.toolbar.isEventInside && this.toolbar.isEventInside(e)) return;
      if (e.button === 0) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        // 按比例换算到 500×500 空间
        const scaleX = 500 / rect.width;
        const scaleY = 500 / rect.height;
        const lx = mx * scaleX;
        const ly = my * scaleY;
        // 简单触摸区域：上半部分=头，下半部分=身体
        if (ly < 250 || Math.sqrt((lx - 250) ** 2 + (ly - 200) ** 2) < 120) {
          this.isPotentialDrag = true;
          this.dragStartX = e.clientX;
          this.dragStartY = e.clientY;
          this.dragStartTime = performance.now();
          this.dragLastX = e.clientX;
          this.dragLastY = e.clientY;
          this.dragLastTime = this.dragStartTime;
          this.petStartX = this.core.x;
          this.petStartY = this.core.y;
          this.hasMoved = false;
          this.canvas.classList.add('dragging');
          this.sideHide.resetIdle();
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isPotentialDrag) return;
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        this.hasMoved = true;
        if (!this.core.isDragging) {
          this.petLogic.onDragStart();
        }

        const stepX = e.clientX - this.dragLastX;
        const stepY = e.clientY - this.dragLastY;
        if (this.core.isDragging) {
          if (isElectron()) {
            this.controller.moveWindow(stepX, stepY);
          } else {
            this.core.x = clamp(this.petStartX + dx * 1.4, 80, 420);
            this.core.y = clamp(this.petStartY + dy * 1.4, 120, 440);
          }
        }
        this.dragLastX = e.clientX;
        this.dragLastY = e.clientY;
        this.dragLastTime = performance.now();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.isPotentialDrag) return;
      const releaseX = e?.clientX ?? this.dragLastX;
      const releaseY = e?.clientY ?? this.dragLastY;
      const distance = Math.hypot(releaseX - this.dragStartX, releaseY - this.dragStartY);
      const elapsedFrames = Math.max(1, (performance.now() - this.dragStartTime) / 16.67);
      const speed = distance / elapsedFrames;
      this.isPotentialDrag = false;
      this.canvas.classList.remove('dragging');
      if (this.core.isDragging) {
        this.petLogic.onDragEnd({ distance, speed });
      } else if (!this.hasMoved) {
        // 判断摸头还是摸身体
        const rect = this.canvas.getBoundingClientRect();
        const scaleY = 500 / rect.height;
        const clickY = (this.dragStartY - rect.top) * scaleY;
        this.petLogic.onClick(clickY < 220);
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.isPotentialDrag = false;
      this.hasMoved = false;
      this.canvas.classList.remove('dragging');
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.toolbar.toggle(mx, my);
    });

    this.canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.isPotentialDrag = false;
      this.hasMoved = false;
      this.canvas.classList.remove('dragging');
      this.petLogic.onPinch();
    });

    document.addEventListener('click', (e) => {
      if (this.toolbar.isVisible && !this.toolbar.el.contains(e.target) && e.target !== this.canvas) {
        this.toolbar.hide();
      }
    });

    this.canvas.addEventListener('mouseenter', () => { this.core.isHovered = true; });
    this.canvas.addEventListener('mouseleave', () => {
      this.core.isHovered = false;
      if (this.core.isDragging) this.petLogic.onDragEnd();
      this.isPotentialDrag = false;
      this.canvas.classList.remove('dragging');
    });
  }

  _setupElectronIPC() {
    if (!isElectron()) return;
    window.electronAPI.onAction((action) => {
      this._runAction(action);
    });
  }

  gameLoop() {
    if (!this.isRunning) return;
    if (!this.core) { requestAnimationFrame(() => this.gameLoop()); return; }

    const now = performance.now();
    const dt = Math.min(now - this.lastTime, 50);
    this.lastTime = now;

    this.petLogic.update();
    this.workSystem.update();
    this.actionPanel?.refreshProgress();
    this.sideHide.update(dt);

    // 播放当前动画
    this._playCurrentAnim(dt);

    if (this.toolbar.isVisible) this.toolbar.refreshStats();

    this.hungerFill.style.width = `${this.stats.hunger}%`;
    this.happyFill.style.width = `${this.stats.happiness}%`;

    this.renderer.draw(this.core);

    // 窗口边缘行走
    if (this.core.state === PetState.WALK && !this.core.isDragging) {
      this._handleWindowMovement();
    }

    if (this.chatUI && this.chatUI.isThinking) {
      this.renderer.drawThinkingDots(250, 150, now);
    }

    requestAnimationFrame(() => this.gameLoop());
  }

  _playCurrentAnim(dt) {
    const gtype = this.core.currentGraphType;
    const mood = this.core.mood;
    const desired = this.core.currentAnimatType || AnimatType.B_LOOP;

    let anim = this.graphCore.findCachedExact(gtype, mood, desired)
      || this.graphCore.findCachedExact(gtype, ModeType.NORMAL, desired);

    if (!anim && desired !== AnimatType.C_END) {
      anim = this.graphCore.findCachedExact(gtype, mood, AnimatType.B_LOOP)
        || this.graphCore.findCachedExact(gtype, mood, AnimatType.SINGLE)
        || this.graphCore.findCachedExact(gtype, ModeType.NORMAL, AnimatType.B_LOOP)
        || this.graphCore.findCachedExact(gtype, ModeType.NORMAL, AnimatType.SINGLE);
    }

    if (!anim) return;

    if (anim !== this.graphCore.currentAnim) {
      this.graphCore.stop();
      this.graphCore._currentGraphType = gtype;
      if (anim.isLoop) {
        anim.reset();
        anim._running = true;
        anim._onFrame = this.renderer.onFrame;
        anim._loopTarget = -1;
        this.graphCore._currentAnim = anim;
        if (this.renderer.onFrame) this.renderer.onFrame(anim.currentFrameImage, 0);
      } else {
        const completedGraph = gtype;
        const completedType = anim.animatType;
        anim.reset();
        anim.play(this.renderer.onFrame, () => {
          const handled = this.petLogic.onAnimationComplete(completedGraph, completedType);
          if (!handled && this.core.state !== PetState.CHAT && this.core.state !== PetState.DRAG) {
            this.core.resetIdle();
          }
        });
        this.graphCore._currentAnim = anim;
      }
    }

    if (this.graphCore.currentAnim && this.graphCore.currentAnim._running) {
      this.graphCore.currentAnim.update(dt);
    }
  }

  _handleWindowMovement() {
    if (!isElectron()) return;
    const margin = 30;
    const core = this.core;
    if (core.x < margin) { this.controller.moveWindow(-3, 0); core.x += 10; }
    else if (core.x > core.LOGIC_W - margin) { this.controller.moveWindow(3, 0); core.x -= 10; }
    if (core.y < margin + 100) { this.controller.moveWindow(0, -3); core.y += 10; }
    else if (core.y > core.LOGIC_H - margin) { this.controller.moveWindow(0, 3); core.y -= 10; }
  }

  _toggleMonitorPanel() {
    const existing = document.getElementById('monitor-panel');
    if (existing) {
      existing.remove();
      return;
    }

    const panel = document.createElement('div');
    panel.id = 'monitor-panel';
    panel.className = 'monitor-panel';

    const tools = this.codingMonitor.tools;
    const statusLabels = {
      not_installed: '未安装',
      not_running: '未启动',
      idle: '已启动',
      working: '任务进行中',
      task_completed: '任务已完成',
    };
    const statusIcons = {
      not_installed: '⬜',
      not_running: '⬛',
      idle: '🟢',
      working: '🔄',
      task_completed: '✅',
    };

    let html = '<div class="monitor-header"><span>📡</span> Coding 工具监控</div>';
    html += '<div class="monitor-list">';
    for (const tool of tools) {
      const statusKey = tool.status || 'not_installed';
      html += `
        <div class="monitor-item" data-tool="${tool.id}">
          <div class="monitor-tool-icon">${tool.icon}</div>
          <div class="monitor-tool-info">
            <div class="monitor-tool-name">${tool.name}</div>
            <div class="monitor-tool-status status-${statusKey}">${statusIcons[statusKey] || '⬜'} ${statusLabels[statusKey] || statusKey}</div>
          </div>
        </div>`;
    }
    html += '</div>';
    html += `<div class="monitor-footer">${this.codingMonitor.statusText}</div>`;
    panel.innerHTML = html;

    this.container.appendChild(panel);

    // 点击面板外关闭
    const closeHandler = (e) => {
      if (!panel.contains(e.target)) {
        panel.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

    // 定时刷新面板
    const refreshInterval = setInterval(async () => {
      if (!document.getElementById('monitor-panel')) {
        clearInterval(refreshInterval);
        return;
      }
      const freshTools = this.codingMonitor.tools;
      const items = panel.querySelectorAll('.monitor-item');
      items.forEach((item, i) => {
        if (!freshTools[i]) return;
        const statusEl = item.querySelector('.monitor-tool-status');
        const statusKey = freshTools[i].status || 'not_installed';
        statusEl.className = `monitor-tool-status status-${statusKey}`;
        statusEl.textContent = `${statusIcons[statusKey] || '⬜'} ${statusLabels[statusKey] || statusKey}`;
      });
      const footer = panel.querySelector('.monitor-footer');
      if (footer) footer.textContent = this.codingMonitor.statusText;
    }, 3000);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new DesktopPetApp();
});