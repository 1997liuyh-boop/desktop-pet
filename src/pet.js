// Pet state machine - manages all pet behaviors, states, and stats
class DesktopPet {
  constructor(savedData = null) {
    this.x = 100;
    this.y = 140;
    this.targetX = this.x;
    this.targetY = this.y;
    this.canvasW = 200;
    this.canvasH = 250;

    this.state = PetState.IDLE;
    this.direction = 1;
    this.animFrame = 0;
    this.animTimer = 0;
    this.animSpeed = 12;

    // Enhanced stats replaces inline hunger/happiness/energy
    this.stats = new EnhancedStats(savedData);

    // Timers
    this.idleTimer = 0;
    this.idleDuration = 0;
    this.walkTimer = 0;
    this.walkDuration = 0;
    this.sleepTimer = 0;

    // Interaction
    this.isDragging = false;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.isHovered = false;

    // Speech - external TypewriterSpeech instance set by app
    this.speech = null;

    // Effects
    this.hearts = [];
    this.sleepZs = [];
    this.expression = Expression.NORMAL;

    // Proactive speech
    this.proactiveTimer = 0;
    this.proactiveInterval = randomInt(PROACTIVE.IDLE_SPEAK_MIN, PROACTIVE.IDLE_SPEAK_MAX);

    // Activity tracking
    this.activity = null; // set externally by WorkSystem
    this.recentEvents = []; // Recent events for LLM context

    // Load stats
    if (!savedData) this._tryLoadStats();

    this.resetIdle();
  }

  // Backward-compatible getters/setters
  get hunger() { return this.stats.hunger; }
  set hunger(v) { this.stats.hunger = clamp(v, 0, 100); }
  get happiness() { return this.stats.happiness; }
  set happiness(v) { this.stats.happiness = clamp(v, 0, 100); }
  get energy() { return this.stats.energy; }
  set energy(v) { this.stats.energy = clamp(v, 0, 100); }

  get mood() { return this.stats.getMood(); }

  addEvent(desc) {
    this.recentEvents.push({ desc, time: Date.now() });
    if (this.recentEvents.length > 10) this.recentEvents.shift();
  }

  resetIdle() {
    this.idleDuration = 120 + Math.random() * 180;
    this.idleTimer = 0;
    this.state = PetState.IDLE;
    this.animFrame = 0;
  }

  startWalking() {
    this.state = PetState.WALK;
    this.animFrame = 0;
    this.targetX = 30 + Math.random() * 140;
    this.targetY = 110 + Math.random() * 100;
    this.walkDuration = 60 + Math.random() * 120;
    this.walkTimer = 0;
    if (Math.abs(this.targetX - this.x) > 5) {
      this.direction = this.targetX > this.x ? 1 : -1;
    }
  }

  update() {
    this.animTimer++;

    // Update stats with passive decay
    this.stats.update(1 / 60);

    // Auto-save periodically
    if (this.animTimer % 600 === 0) this.saveStats();

    // Update speech (typewriter animation)
    if (this.speech) this.speech.update();

    // Update hearts
    this.hearts = this.hearts.filter(h => {
      h.y -= 1.5;
      h.life -= 0.02;
      h.opacity = Math.max(0, h.life);
      return h.life > 0;
    });

    // Update sleep Zs
    this.sleepZs = this.sleepZs.filter(z => {
      z.y -= 0.8;
      z.x += Math.sin(z.life * 5) * 0.3;
      z.life -= 0.015;
      z.opacity = Math.max(0, z.life);
      return z.life > 0;
    });

    // State machine
    switch (this.state) {
      case PetState.IDLE:   this.updateIdle(); break;
      case PetState.WALK:   this.updateWalk(); break;
      case PetState.SIT:    this.updateSit();  break;
      case PetState.SLEEP:  this.updateSleep(); break;
      case PetState.HAPPY:  this.updateHappy(); break;
      case PetState.DRAG:   break;
      case PetState.EAT:    this.updateEat();  break;
      case PetState.WORK:   this.updateWork(); break;
    }

    // Proactive speech check
    this.proactiveTimer++;
    if (this.proactiveTimer >= this.proactiveInterval && this.state === PetState.IDLE) {
      this.proactiveTimer = 0;
      this.proactiveInterval = randomInt(PROACTIVE.IDLE_SPEAK_MIN, PROACTIVE.IDLE_SPEAK_MAX);
      this._checkProactiveSpeech();
    }

    // Update expression based on mood
    this._updateMoodExpression();
  }

  _updateMoodExpression() {
    if (this.state === PetState.SLEEP) return;
    const mood = this.mood;
    if (mood === ModeType.ILL) this.expression = Expression.SICK;
    else if (mood === ModeType.POOR) this.expression = Math.random() < 0.3 ? Expression.SAD : Expression.NORMAL;
    else this.expression = Expression.NORMAL;
  }

  _checkProactiveSpeech() {
    let msg = null;
    if (this.hunger < PROACTIVE.HUNGER_LOW) {
      msg = randomChoice(['主人，我肚子饿了喵~', '有没有小鱼干呀喵...', '肚子咕咕叫了喵...']);
    } else if (this.happiness < PROACTIVE.HAPPINESS_LOW) {
      msg = randomChoice(['好无聊喵...陪小橘玩一会儿吧~', '主人你是不是不要我了喵...', '喵...都没人理我...']);
    } else if (this.energy < PROACTIVE.ENERGY_LOW) {
      msg = randomChoice(['好困喵...想睡觉了...', '小橘没电了喵...需要充电...']);
    } else if (this.stats.health < PROACTIVE.HEALTH_LOW) {
      msg = randomChoice(['喵...身体不太舒服...', '主人，小橘好像生病了喵...']);
    }
    if (msg) {
      this.say(msg);
      this.addEvent('主动说话: ' + msg);
    }
  }

  updateIdle() {
    this.idleTimer++;
    if (this.idleTimer > this.idleDuration) {
      const rand = Math.random();
      const mood = this.mood;
      // Mood-influenced behavior
      const walkChance = mood === ModeType.HAPPY ? 0.6 : mood === ModeType.POOR ? 0.3 : mood === ModeType.ILL ? 0.1 : 0.5;
      const sitChance = walkChance + (mood === ModeType.ILL ? 0.1 : 0.2);

      if (this.energy < 20 && mood !== ModeType.HAPPY) this.startSleeping();
      else if (rand < walkChance) this.startWalking();
      else if (rand < sitChance) this.startSitting();
      else this.resetIdle();
    }
    this.expression = Expression.NORMAL;
  }

  updateWalk() {
    this.walkTimer++;
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = this.mood === ModeType.ILL ? 0.5 : this.mood === ModeType.POOR ? 0.8 : 1.2;

    if (dist < 3 || this.walkTimer > this.walkDuration) {
      this.resetIdle();
    } else {
      this.x += (dx / dist) * speed;
      this.y += (dy / dist) * speed;
      if (dx > 0) this.direction = 1;
      else if (dx < 0) this.direction = -1;
    }
  }

  updateSit() {
    this.idleTimer++;
    if (this.idleTimer > this.idleDuration) this.resetIdle();
  }

  updateSleep() {
    this.sleepTimer++;
    this.stats.sleepRecover();
    if (this.sleepTimer > 300 || this.energy > 80) this.wakeUp();
    if (Math.random() < 0.03 && this.sleepZs.length < 4) {
      this.sleepZs.push({
        x: this.x + 15 + Math.random() * 20,
        y: this.y - 55,
        size: 8 + Math.random() * 8,
        life: 1, opacity: 1,
      });
    }
  }

  updateHappy() {
    this.idleTimer++;
    if (this.idleTimer > this.idleDuration) this.resetIdle();
  }

  updateEat() {
    this.idleTimer++;
    if (this.idleTimer > 60) {
      this.stats.feed(20);
      this.resetIdle();
    }
  }

  updateWork() {
    // Work state - pet sits still, working animation handled by renderer
    this.idleTimer++;
  }

  startSitting() {
    this.state = PetState.SIT;
    this.animFrame = 0;
    this.idleDuration = 90 + Math.random() * 120;
    this.idleTimer = 0;
  }

  startSleeping() {
    this.state = PetState.SLEEP;
    this.animFrame = 0;
    this.sleepTimer = 0;
    this.sleepZs = [];
    this.expression = Expression.SLEEPY;
  }

  wakeUp() {
    this.state = PetState.IDLE;
    this.animFrame = 0;
    this.sleepZs = [];
    this.expression = Expression.SURPRISED;
    this.say('睡醒了~');
    this.addEvent('睡醒了');
    setTimeout(() => { this.expression = Expression.NORMAL; }, 1500);
  }

  startWork(activityType) {
    this.state = PetState.WORK;
    this.animFrame = 0;
    this.activity = activityType;
    this.addEvent(`开始${activityType === ActivityType.WORK ? '工作' : activityType === ActivityType.STUDY ? '学习' : '玩耍'}`);
  }

  stopWork() {
    this.activity = null;
    this.resetIdle();
  }

  // ---- Interactions ----
  onDragStart(mouseX, mouseY) {
    this.isDragging = true;
    this.state = PetState.DRAG;
    this.dragOffsetX = this.x - mouseX;
    this.dragOffsetY = this.y - mouseY;
  }

  onDrag(mouseX, mouseY) {
    if (this.isDragging) {
      this.x = clamp(mouseX + this.dragOffsetX, 30, 170);
      this.y = clamp(mouseY + this.dragOffsetY, 80, 200);
    }
  }

  onDragEnd() {
    this.isDragging = false;
    this.resetIdle();
  }

  onClick() {
    this.state = PetState.HAPPY;
    this.animFrame = 0;
    this.stats.pet();
    this.idleDuration = 60;
    this.idleTimer = 0;
    this.expression = Expression.HAPPY;

    for (let i = 0; i < 3; i++) {
      this.hearts.push({
        x: this.x - 10 + Math.random() * 30,
        y: this.y - 40 - Math.random() * 20,
        size: 6 + Math.random() * 8,
        life: 1, opacity: 1,
      });
    }

    this.addEvent('被摸头了');
    this.saveStats();

    if (Math.random() < 0.6) {
      const responses = ['喵~', '好舒服~', '再来一次!', '嘻嘻~', '咕噜咕噜~', '诶嘿~', '开心!'];
      this.say(randomChoice(responses));
    }
  }

  feed() {
    this.state = PetState.EAT;
    this.animFrame = 0;
    this.idleDuration = 60;
    this.idleTimer = 0;
    this.expression = Expression.HAPPY;
    this.stats.feed(20);
    this.addEvent('被喂食了');
    this.saveStats();
    this.say('好吃!');
  }

  play() {
    this.state = PetState.HAPPY;
    this.animFrame = 0;
    this.stats.play(15);
    this.idleDuration = 90;
    this.idleTimer = 0;
    this.expression = Expression.HAPPY;
    this.addEvent('玩耍了');
    this.saveStats();
    this.say('来玩吧!');
  }

  goToSleep() {
    this.startSleeping();
    this.addEvent('去睡觉了');
    this.saveStats();
    this.say('晚安...');
  }

  say(text) {
    if (this.speech) {
      this.speech.say(text);
    } else {
      // Fallback for when speech instance not set
      this._fallbackText = text;
      this._fallbackTimer = 120;
    }
  }

  getActiveSpeechText() {
    if (this.speech && this.speech.isVisible) return this.speech.visibleText;
    if (this._fallbackTimer > 0) return this._fallbackText;
    return '';
  }

  isSpeechVisible() {
    if (this.speech) return this.speech.isVisible;
    return this._fallbackTimer > 0;
  }

  getSpeechOpacity() {
    if (this.speech) return this.speech.opacity;
    return this._fallbackTimer ? Math.min(1, this._fallbackTimer / 20) : 0;
  }

  getContextForLLM() {
    return this.stats.getContextForLLM();
  }

  getRecentEventsText() {
    if (this.recentEvents.length === 0) return '（还没有特别的事发生）';
    return this.recentEvents.slice(-5).map(e => `- ${e.desc}`).join('\n');
  }

  // ---- Persistence ----
  saveStats() {
    try {
      const data = this.stats.getStatsObject();
      if (isElectron() && window.electronAPI.saveStats) {
        window.electronAPI.saveStats(data);
      } else {
        saveToStorage('desktop-pet-stats', data);
      }
    } catch (e) { /* ignore */ }
  }

  _tryLoadStats() {
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

  getAnimCycle() {
    return Math.floor(this.animTimer / this.animSpeed);
  }
}
