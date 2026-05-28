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

    // VPet 资源根目录
    const assetBase = 'D:/demo3/VPet/VPet-Simulator.Windows/mod/0000_core/pet/vup/';

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
    this.chatUI = new ChatUI(this.container, this.core, this.llmClient, this.persona, this.messageBar);
    this.aiSettings = new AISettings(this.llmClient, this.persona);

    this.toolbar = new Toolbar(this.core, {
      feed: () => this.petLogic.feed(),
      play: () => this.petLogic.play(),
      work: () => this.workSystem.start(ActivityType.WORK),
      chat: () => this.chatUI.toggle(),
      settings: () => this.aiSettings.show(),
    });

    this.sideHide = new SideHide(this.core, this.controller);
    this.workSystem = new WorkSystem(this.core, this.petLogic);

    // 游戏循环
    this.lastTime = performance.now();
    this.isRunning = true;

    // 鼠标状态
    this.isPotentialDrag = false;
    this.dragStartX = 0; this.dragStartY = 0;
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

  _loadBehaviorSettings() {
    const behavior = loadFromStorage('pet-behavior-settings', { sideHide: true, proactive: true });
    if (!behavior.sideHide) this.sideHide.disable();
  }

  _setupEventListeners() {
    this.canvas.addEventListener('mousedown', (e) => {
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
      }
    });

    window.addEventListener('mouseup', () => {
      if (!this.isPotentialDrag) return;
      this.isPotentialDrag = false;
      this.canvas.classList.remove('dragging');
      if (this.core.isDragging) {
        this.petLogic.onDragEnd();
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
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.toolbar.toggle(mx, my);
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
      switch (action) {
        case 'feed': this.petLogic.feed(); break;
        case 'play': this.petLogic.play(); break;
        case 'sleep': this.petLogic.startSleeping(); break;
        case 'chat': this.chatUI.toggle(); break;
      }
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

    // 确保动画已缓存
    let anim = this.graphCore.findCached(gtype, mood, 'b_loop')
      || this.graphCore.findCached(gtype, mood, 'single')
      || this.graphCore.findCached(gtype, 'normal', 'b_loop')
      || this.graphCore.findCached(gtype, 'normal', 'single');

    if (!anim) return;

    if (anim !== this.graphCore.currentAnim) {
      this.graphCore.stop();
      if (anim.isLoop) {
        anim.reset();
        anim._running = true;
        anim._onFrame = this.renderer.onFrame;
        anim._loopTarget = -1;
        this.graphCore._currentAnim = anim;
        if (this.renderer.onFrame) this.renderer.onFrame(anim.currentFrameImage, 0);
      } else {
        anim.reset();
        anim.play(this.renderer.onFrame, () => {
          if (this.core.state !== PetState.CHAT && this.core.state !== PetState.DRAG) {
            this.core.currentGraphType = 'default';
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
}

window.addEventListener('DOMContentLoaded', () => {
  new DesktopPetApp();
});