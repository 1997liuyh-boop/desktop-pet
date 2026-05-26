// Main application - ties together pet, renderer, UI components, and IPC
class DesktopPetApp {
  constructor() {
    this.canvas = document.getElementById('pet-canvas');
    this.hungerFill = document.getElementById('hunger-fill');
    this.happyFill = document.getElementById('happy-fill');
    this.container = document.getElementById('app-root');

    // Initialize core modules
    this.pet = new DesktopPet();
    this.renderer = new PetRenderer(this.canvas, this.pet);

    // Speech
    this.speech = new TypewriterSpeech();
    this.pet.speech = this.speech;

    // LLM
    this.llmClient = new LLMClient();
    this.persona = new PersonaConfig();

    // UI components
    this.chatUI = new ChatUI(this.container, this.pet, this.llmClient, this.persona, this.speech);
    this.toolbar = new Toolbar(this.pet, {
      feed: () => this.pet.feed(),
      play: () => this.pet.play(),
      chat: () => this.chatUI.toggle(),
      settings: () => this.settingsPanel.show(),
    });
    this.settingsPanel = new SettingsPanel(this.llmClient, this.persona);
    this.sideHide = new SideHide(this.pet);
    this.workSystem = new WorkSystem(this.pet);

    // Game loop state
    this.lastTime = performance.now();
    this.isRunning = true;

    // Mouse state
    this.isPotentialDrag = false;
    this.dragStartX = 0; this.dragStartY = 0;
    this.petStartX = 0; this.petStartY = 0;
    this.hasMoved = false;

    this.setupEventListeners();
    this.setupElectronIPC();
    this.setupKeyboardShortcuts();
    this.loadSettings();
    this.gameLoop();
  }

  loadSettings() {
    // Load behavior settings
    const behavior = loadFromStorage('pet-behavior-settings', {
      sideHide: true,
      proactive: true,
    });
    if (!behavior.sideHide) this.sideHide.disable();
  }

  setupEventListeners() {
    // Mouse down on canvas
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const dx = mx - this.pet.x;
        const dy = my - this.pet.y;
        if (Math.sqrt(dx * dx + dy * dy) < 55) {
          this.isPotentialDrag = true;
          this.dragStartX = e.clientX;
          this.dragStartY = e.clientY;
          this.petStartX = this.pet.x;
          this.petStartY = this.pet.y;
          this.hasMoved = false;
          this.canvas.classList.add('dragging');
          this.sideHide.resetIdle();
        }
      }
    });

    // Mouse move
    window.addEventListener('mousemove', (e) => {
      if (!this.isPotentialDrag) return;
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        this.hasMoved = true;
        this.pet.x = clamp(this.petStartX + dx, 30, 170);
        this.pet.y = clamp(this.petStartY + dy, 80, 200);
        if (!this.pet.isDragging) {
          this.pet.isDragging = true;
          this.pet.state = PetState.DRAG;
        }
      }
    });

    // Mouse up
    window.addEventListener('mouseup', () => {
      if (!this.isPotentialDrag) return;
      this.isPotentialDrag = false;
      this.canvas.classList.remove('dragging');
      if (this.pet.isDragging) {
        this.pet.onDragEnd();
      } else if (!this.hasMoved) {
        this.pet.onClick();
      }
    });

    // Right click - show custom toolbar
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.toolbar.toggle(mx, my);
    });

    // Click outside toolbar to hide
    document.addEventListener('click', (e) => {
      if (this.toolbar.isVisible && !this.toolbar.el.contains(e.target) && e.target !== this.canvas) {
        this.toolbar.hide();
      }
    });

    // Mouse enter/leave
    this.canvas.addEventListener('mouseenter', () => { this.pet.isHovered = true; });
    this.canvas.addEventListener('mouseleave', () => {
      this.pet.isHovered = false;
      if (this.pet.isDragging) this.pet.onDragEnd();
      this.isPotentialDrag = false;
      this.canvas.classList.remove('dragging');
    });

    // Touch events
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        const mx = t.clientX - rect.left;
        const my = t.clientY - rect.top;
        if (Math.sqrt((mx - this.pet.x) ** 2 + (my - this.pet.y) ** 2) < 55) {
          this.isPotentialDrag = true;
          this.dragStartX = t.clientX;
          this.dragStartY = t.clientY;
          this.petStartX = this.pet.x;
          this.petStartY = this.pet.y;
          this.hasMoved = false;
        }
      }
      if (e.touches.length === 2 && this.chatUI) this.chatUI.toggle();
    });

    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.isPotentialDrag || e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - this.dragStartX;
      const dy = t.clientY - this.dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        this.hasMoved = true;
        this.pet.x = clamp(this.petStartX + dx, 30, 170);
        this.pet.y = clamp(this.petStartY + dy, 80, 200);
        if (!this.pet.isDragging) {
          this.pet.isDragging = true;
          this.pet.state = PetState.DRAG;
        }
      }
    });

    this.canvas.addEventListener('touchend', () => {
      if (!this.isPotentialDrag) return;
      this.isPotentialDrag = false;
      if (this.pet.isDragging) this.pet.onDragEnd();
      else if (!this.hasMoved) this.pet.onClick();
    });
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+C = toggle chat
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        this.chatUI.toggle();
      }
    });
  }

  setupElectronIPC() {
    if (!isElectron()) return;

    const unsubscribe = window.electronAPI.onAction((action) => {
      switch (action) {
        case 'feed': this.pet.feed(); break;
        case 'play': this.pet.play(); break;
        case 'sleep': this.pet.goToSleep(); break;
        case 'chat': this.chatUI.toggle(); break;
      }
    });
    this.cleanupIPC = unsubscribe;
  }

  gameLoop() {
    if (!this.isRunning) return;

    const now = performance.now();
    const dt = Math.min(now - this.lastTime, 50);
    this.lastTime = now;

    // Update pet (stats decay, state machine, speech typewriter)
    this.pet.update();

    // Update work system
    this.workSystem.update();

    // Update side-hide
    this.sideHide.update(dt);

    // Update toolbar stats if visible
    if (this.toolbar.isVisible) this.toolbar.refreshStats();

    // Update status bar
    this.hungerFill.style.width = `${this.pet.stats.hunger}%`;
    this.happyFill.style.width = `${this.pet.stats.happiness}%`;

    // Render
    this.renderer.draw();

    // Window edge movement (walking triggers window move)
    if (this.pet.state === PetState.WALK && !this.pet.isDragging) {
      this.handleWindowMovement();
    }

    // Draw thinking animation if LLM is thinking
    if (this.chatUI.isThinking) {
      this.renderer.drawThinkingDots(this.pet.x, this.pet.y - 45, now);
    }

    requestAnimationFrame(() => this.gameLoop());
  }

  handleWindowMovement() {
    if (!isElectron()) return;
    const pet = this.pet;
    const margin = 25;

    if (pet.x < margin) {
      window.electronAPI.moveWindow(-3, 0);
      pet.x += 3;
    } else if (pet.x > pet.canvasW - margin) {
      window.electronAPI.moveWindow(3, 0);
      pet.x -= 3;
    }
    if (pet.y < margin + 50 && pet.y < margin + 50) {
      window.electronAPI.moveWindow(0, -3);
      pet.y += 3;
    } else if (pet.y > pet.canvasH - margin) {
      window.electronAPI.moveWindow(0, 3);
      pet.y -= 3;
    }
  }
}

// Start when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  new DesktopPetApp();
});
