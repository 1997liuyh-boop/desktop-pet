// PetLogic v2 - 对标 VPet MainLogic 的交互逻辑
// 触摸区域：头（上1/3）、身体（下2/3）、拖拽提起

class PetLogic {
  constructor(core, graphCore, messageBar, effects, stats) {
    this.core = core;
    this.graphCore = graphCore;
    this.messageBar = messageBar;
    this.effects = effects;
    this.stats = stats;
  }

  update() {
    const core = this.core;
    core.animTimer++;

    if (this.stats) {
      this.stats.update(1 / 60);
      if (core.animTimer % 600 === 0) this._autoSave();
    }

    this.effects.update();
    this.messageBar.update();

    switch (core.state) {
      case PetState.IDLE:   this._updateIdle(); break;
      case PetState.WALK:   this._updateWalk(); break;
      case PetState.SIT:    this._updateSit(); break;
      case PetState.SLEEP:  this._updateSleep(); break;
      case PetState.HAPPY:  this._updateHappy(); break;
      case PetState.DRAG:   break;
      case PetState.EAT:    this._updateEat(); break;
      case PetState.WORK:   this._updateWork(); break;
      case PetState.CHAT:   break;
    }

    core.proactiveTimer++;
    if (core.proactiveTimer >= core.proactiveInterval && core.state === PetState.IDLE) {
      core.proactiveTimer = 0;
      core.proactiveInterval = randomInt(PROACTIVE.IDLE_SPEAK_MIN, PROACTIVE.IDLE_SPEAK_MAX);
      this._checkProactiveSpeech();
    }
  }

  _autoSave() {
    if (this.stats && isElectron() && window.electronAPI.saveStats) {
      window.electronAPI.saveStats(this.stats.getStatsObject());
    }
  }

  _checkProactiveSpeech() {
    const s = this.stats;
    if (!s) return;
    let msg = null;
    if (s.hunger < PROACTIVE.HUNGER_LOW) {
      msg = randomChoice(['主人，我肚子饿了喵~', '有没有小鱼干呀喵...', '肚子咕咕叫了喵...']);
    } else if (s.happiness < PROACTIVE.HAPPINESS_LOW) {
      msg = randomChoice(['好无聊喵...陪小橘玩一会儿吧~', '主人你是不是不要我了喵...', '喵...都没人理我...']);
    } else if (s.energy < PROACTIVE.ENERGY_LOW) {
      msg = randomChoice(['好困喵...想睡觉了...', '小橘没电了喵...需要充电...']);
    }
    if (msg) {
      this.say(msg);
      this.core.addEvent('主动说话: ' + msg);
    }
  }

  _updateIdle() {
    this.core.idleTimer++;
    if (this.core.idleTimer > this.core.idleDuration) {
      const rand = Math.random();
      const mood = this.core.mood;
      if (this.stats && this.stats.energy < 20 && mood !== ModeType.HAPPY) {
        this.startSleeping();
      } else if (rand < 0.5) {
        this.core.startWalking();
      } else {
        this.core.resetIdle();
      }
    }
  }

  _updateWalk() {
    const core = this.core;
    core.walkTimer++;
    const dx = core.targetX - core.x;
    const dy = core.targetY - core.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 5 || core.walkTimer > core.walkDuration) {
      core.resetIdle();
    } else {
      core.x += (dx / dist) * 1.5;
      core.y += (dy / dist) * 1.5;
      if (dx > 0) core.direction = 1;
      else if (dx < 0) core.direction = -1;
    }
  }

  _updateSit() { this.core.idleTimer++; if (this.core.idleTimer > this.core.idleDuration) this.core.resetIdle(); }
  _updateHappy() { this.core.idleTimer++; if (this.core.idleTimer > this.core.idleDuration) this.core.resetIdle(); }
  _updateEat() { this.core.idleTimer++; if (this.core.idleTimer > 60) { if (this.stats) this.stats.feed(20); this.core.resetIdle(); } }
  _updateWork() { this.core.idleTimer++; }

  _updateSleep() {
    const core = this.core;
    if (this.stats) this.stats.sleepRecover();
    if (this.stats && this.stats.energy > 80) this.wakeUp();
    if (Math.random() < 0.03) {
      this.effects.spawnSleepZs(250, 250);
    }
  }

  startSleeping() {
    this.core.state = PetState.SLEEP;
    this.core.currentGraphType = 'sleep';
    this.core.animTimer = 0;
  }

  wakeUp() {
    this.core.state = PetState.IDLE;
    this.core.currentGraphType = 'default';
    this.core.animTimer = 0;
    this.say('睡醒了~');
    this.core.addEvent('睡醒了');
  }

  // === 互动 ===
  onClick(isHead) {
    const core = this.core;
    if (isHead) {
      core.currentGraphType = 'touch_head';
      core.state = PetState.HAPPY;
      if (this.stats) this.stats.pet();
      core.idleDuration = 40;
      core.idleTimer = 0;
      this.effects.spawnHearts(250, 220, 3);
      core.addEvent('被摸头了');
      if (Math.random() < 0.6) this.say(randomChoice(['喵~', '好舒服~', '再来一次!', '嘻嘻~', '咕噜咕噜~']));
    } else {
      core.currentGraphType = 'touch_body';
      core.state = PetState.HAPPY;
      core.idleDuration = 35;
      core.idleTimer = 0;
      core.addEvent('被摸身体了');
      this.say(randomChoice(['喵呜~', '不要摸那里啦!', '好痒喵~']));
    }
  }

  onDragStart() {
    this.core.state = PetState.DRAG;
    this.core.currentGraphType = 'raise';
    this.core.isDragging = true;
  }

  onDragEnd() {
    this.core.isDragging = false;
    this.core.resetIdle();
  }

  feed() {
    this.core.state = PetState.EAT;
    this.core.currentGraphType = 'eat';
    this.core.idleDuration = 60;
    this.core.idleTimer = 0;
    if (this.stats) this.stats.feed(20);
    this.core.addEvent('被喂食了');
    this.say('好吃喵~!');
    this._autoSave();
  }

  play() {
    this.core.state = PetState.HAPPY;
    this.core.currentGraphType = 'idle';
    if (this.stats) this.stats.play(15);
    this.core.addEvent('玩耍了');
    this.say('来玩吧!');
    this._autoSave();
  }

  startWork(activityType) {
    this.core.state = PetState.WORK;
    this.core.currentGraphType = 'work';
    this.core.activity = activityType;
  }

  stopWork() {
    this.core.activity = null;
    this.core.workProgress = null;
    this.core.resetIdle();
  }

  say(text) {
    this.messageBar.say(text);
    this.core.currentGraphType = 'say';
  }

  setWorkProgress(progress) {
    this.core.workProgress = progress;
  }
}