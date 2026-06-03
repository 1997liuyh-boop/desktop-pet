// PetLogic v2 - 对标 VPet MainLogic 的交互逻辑
// 触摸区域：头（上1/3）、身体（下2/3）、拖拽提起

class PetLogic {
  constructor(core, graphCore, messageBar, effects, stats) {
    this.core = core;
    this.graphCore = graphCore;
    this.messageBar = messageBar;
    this.effects = effects;
    this.stats = stats;

    this.music = {
      history: [],
      active: false,
      strong: false,
      confirmSamples: 0,
      releaseSamples: 0,
      manualTicks: 0,
      lastPeak: 0,
    };

    this.mischiefTimer = this._nextMischiefDelay();
    this.mischiefNudge = 0;
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
    this._updateMusicIntent();

    switch (core.state) {
      case PetState.IDLE:     this._updateIdle(); break;
      case PetState.WALK:     this._updateWalk(); break;
      case PetState.SIT:      this._updateSit(); break;
      case PetState.SLEEP:    this._updateSleep(); break;
      case PetState.HAPPY:    this._updateHappy(); break;
      case PetState.DRAG:     break;
      case PetState.DROP:     this._updateTimedAction(); break;
      case PetState.EAT:      this._updateEat(); break;
      case PetState.WORK:     this._updateWork(); break;
      case PetState.CHAT:     break;
      case PetState.MUSIC:    this._updateMusic(); break;
      case PetState.MISCHIEF: this._updateMischief(); break;
    }

    core.proactiveTimer++;
    if (core.proactiveTimer >= core.proactiveInterval && core.state === PetState.IDLE && !core.currentAction) {
      core.proactiveTimer = 0;
      core.proactiveInterval = randomInt(PROACTIVE.IDLE_SPEAK_MIN, PROACTIVE.IDLE_SPEAK_MAX);
      this._checkProactiveSpeech();
    }
  }

  onAnimationComplete(graphType, animatType) {
    const action = this.core.currentAction;
    if (!action || action.graphType !== graphType) return false;

    if (animatType === AnimatType.A_START) {
      this.core.currentAnimatType = this._nextLoopPhase(action);
      this.core.animTimer = 0;
      return true;
    }

    if (animatType === AnimatType.SINGLE && action.kind === 'music') {
      if (this.music.active || this.music.manualTicks > 0) {
        this.core.currentAnimatType = this.music.strong ? AnimatType.SINGLE : AnimatType.B_LOOP;
      } else {
        this._requestEndAction(action);
      }
      this.core.animTimer = 0;
      return true;
    }

    if (animatType === AnimatType.SINGLE && action.kind !== 'music') {
      if (action.kind === 'activity-break') {
        this.startWork(action.returnActivityType, action.returnMeta);
      } else {
        this.core.resetIdle();
      }
      return true;
    }

    if (animatType === AnimatType.C_END) {
      if (action.kind === 'activity-break') {
        this.startWork(action.returnActivityType, action.returnMeta);
      } else {
        this.core.resetIdle();
      }
      return true;
    }

    return false;
  }

  handleAudioPeak(payload) {
    const rawPeak = typeof payload === 'number' ? payload : payload?.peak;
    const peak = Number(rawPeak);
    if (!Number.isFinite(peak)) return;

    if (peak < 0) {
      this.music.releaseSamples++;
      if (this.music.releaseSamples >= INTERACTION_CFG.MUSIC_RELEASE_SAMPLES) {
        this._stopMusicSignal();
      }
      return;
    }

    const normalized = clamp(peak, 0, 1);
    this.music.lastPeak = normalized;
    this.music.history.push(normalized);
    if (this.music.history.length > INTERACTION_CFG.MUSIC_HISTORY) this.music.history.shift();

    const avg = this._average(this.music.history);
    const isAudible = normalized > INTERACTION_CFG.MUSIC_CATCH || avg > INTERACTION_CFG.MUSIC_CATCH;

    if (isAudible) {
      this.music.confirmSamples++;
      this.music.releaseSamples = 0;
    } else {
      this.music.confirmSamples = 0;
      this.music.releaseSamples++;
    }

    if (!this.music.active && this.music.confirmSamples >= INTERACTION_CFG.MUSIC_CONFIRM_SAMPLES) {
      this.music.active = true;
      this.music.strong = avg > INTERACTION_CFG.MUSIC_MAX || normalized > INTERACTION_CFG.MUSIC_MAX;
      this._startMusicAction(false);
      return;
    }

    if (this.music.active) {
      const wasStrong = this.music.strong;
      this.music.strong = avg > INTERACTION_CFG.MUSIC_MAX || normalized > INTERACTION_CFG.MUSIC_MAX;
      if (wasStrong !== this.music.strong && this.core.currentAction?.kind === 'music') {
        this._syncMusicPhase();
      }
      if (this.music.releaseSamples >= INTERACTION_CFG.MUSIC_RELEASE_SAMPLES) {
        this._stopMusicSignal();
      }
    }
  }

  _autoSave() {
    if (!this.stats) return;
    const payload = this.stats.getStatsObject();
    if (isElectron() && window.electronAPI.saveStats) {
      window.electronAPI.saveStats(payload);
    } else {
      saveToStorage('desktop-pet-stats', payload);
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
    this.mischiefTimer--;

    if (this.music.active && this._canStartIdleAction()) {
      this._startMusicAction(false);
      return;
    }

    if (this.mischiefTimer <= 0 && this._canStartIdleAction()) {
      this._startMischief();
      this.mischiefTimer = this._nextMischiefDelay();
      return;
    }

    if (this.core.idleTimer > this.core.idleDuration) {
      const rand = Math.random();
      const mood = this.core.mood;
      if (this.stats && this.stats.energy < 20 && mood !== ModeType.HAPPY) {
        this.startSleeping();
      } else if (rand < 0.45) {
        this.core.startWalking();
      } else if (rand < 0.65) {
        this._startMischief();
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
  _updateHappy() { this._updateTimedAction(); }
  _updateEat() {
    if (this.core.currentAction) {
      this._updateTimedAction();
      return;
    }
    this.core.idleTimer++;
    if (this.core.idleTimer > 60) this.core.resetIdle();
  }
  _updateWork() {
    this.core.idleTimer++;
    if (this.core.currentAction?.kind === 'activity-break') this._updateTimedAction();
  }

  _updateSleep() {
    if (this.stats) this.stats.sleepRecover();
    if (this.stats && this.stats.energy > 80) this.wakeUp();
    if (Math.random() < 0.03) {
      this.effects.spawnSleepZs(250, 250);
    }
  }

  _updateMusic() {
    if (this.music.manualTicks > 0) this.music.manualTicks--;
    if (!this.music.active && this.music.manualTicks <= 0) {
      this._requestEndAction();
      return;
    }
    this._syncMusicPhase();
    if (Math.random() < 0.025) this.effects.spawnHearts(250, 220, 1);
  }

  _updateMischief() {
    this._updateTimedAction();
    const action = this.core.currentAction;
    if (!action || action.kind !== 'mischief' || this.core.currentAnimatType !== AnimatType.B_LOOP) return;

    this.mischiefNudge++;
    if (this.mischiefNudge % 18 === 0) this._nudgeWindow();
  }

  _updateTimedAction() {
    const action = this.core.currentAction;
    if (!action || this.core.currentAnimatType !== AnimatType.B_LOOP) return;

    action.loopTicks--;
    if (action.loopTicks <= 0) this._requestEndAction(action);
  }

  startSleeping() {
    this._stopMusicSignal();
    this.core.state = PetState.SLEEP;
    this.core.currentGraphType = 'sleep';
    this.core.currentAnimatType = AnimatType.B_LOOP;
    this.core.currentAction = null;
    this.core.animTimer = 0;
  }

  wakeUp() {
    this.core.state = PetState.IDLE;
    this.core.currentGraphType = 'default';
    this.core.currentAnimatType = AnimatType.B_LOOP;
    this.core.currentAction = null;
    this.core.animTimer = 0;
    this.messageBar.say('睡醒了~');
    this.core.addEvent('睡醒了');
  }

  // === 互动 ===
  onClick(isHead) {
    if (isHead) {
      this._startMomentaryAction('touch_head', PetState.HAPPY, 'touch_head', INTERACTION_CFG.TOUCH_LOOP_TICKS);
      if (this.stats) this.stats.pet();
      this.effects.spawnHearts(250, 220, 3);
      this.core.addEvent('被摸头了');
      if (Math.random() < 0.6) this.messageBar.say(randomChoice(['喵~', '好舒服~', '再来一次!', '嘻嘻~', '咕噜咕噜~']));
    } else {
      this._startMomentaryAction('touch_body', PetState.HAPPY, 'touch_body', INTERACTION_CFG.TOUCH_LOOP_TICKS);
      this.core.addEvent('被摸身体了');
      this.messageBar.say(randomChoice(['喵呜~', '不要摸那里啦!', '好痒喵~']));
    }
    this.mischiefTimer = this._nextMischiefDelay();
  }

  onPinch() {
    this._startMomentaryAction('pinch', PetState.HAPPY, 'pinch', INTERACTION_CFG.PINCH_LOOP_TICKS);
    if (this.stats) this.stats.play(6);
    this.effects.spawnHearts(250, 220, 1);
    this.core.addEvent('被捏脸了');
    this.messageBar.say(randomChoice(['脸要被捏圆了喵~', '轻一点啦!', '喵呜，抓到你了~']));
    this._autoSave();
  }

  onDragStart() {
    this._stopMusicSignal();
    const graphType = this._pickGraphType(['raise', 'pinch', 'touch_body', 'idle']);
    this.core.state = PetState.DRAG;
    this.core.currentGraphType = graphType;
    this.core.currentAnimatType = this._hasAnim(graphType, AnimatType.B_LOOP) ? AnimatType.B_LOOP : this._pickStartPhase(graphType);
    this.core.currentAction = null;
    this.core.isDragging = true;
    this.core.animTimer = 0;
    this.core.addEvent('被抓起来了');
  }

  onDragEnd(info = {}) {
    this.core.isDragging = false;
    const distance = Number(info.distance) || 0;
    const speed = Number(info.speed) || 0;
    const moodPenalty = this.core.mood === ModeType.ILL ? 0.25 : this.core.mood === ModeType.POOR_CONDITION ? 0.16 : 0;
    const motionPenalty = Math.min(0.35, distance / 1200 + speed / 90);
    const fallChance = clamp(0.12 + moodPenalty + motionPenalty, 0.08, 0.72);

    if (Math.random() < fallChance) {
      this._startDropReaction('fall');
    } else {
      this._startDropReaction('land');
    }
  }

  _startDropReaction(type) {
    const isFall = type === 'fall';
    const graphType = this._pickGraphType(isFall ? ['pinch', 'touch_body', 'idle'] : ['touch_body', 'idle', 'default']);
    const loopTicks = isFall ? 70 : 44;

    this.core.state = PetState.DROP;
    this.core.currentGraphType = graphType;
    this.core.currentAnimatType = this._pickStartPhase(graphType);
    this.core.currentAction = { graphType, kind: isFall ? 'drop-fall' : 'drop-land', loopTicks };
    this.core.idleTimer = 0;
    this.core.animTimer = 0;

    if (isFall) {
      if (this.stats) {
        this.stats.health = clamp(this.stats.health - 2, 0, 100);
        this.stats.feeling = clamp(this.stats.feeling - 3, 0, 100);
      }
      this.messageBar.say(randomChoice(['哎呀，摔了一下喵...', '落地失败喵...', '主人要轻一点喵~']));
      this.core.addEvent('放下时摔倒了');
      this._nudgeWindow(8);
    } else {
      this.messageBar.say(randomChoice(['安全落地喵~', '站稳啦！', '轻轻落地喵~']));
      this.core.addEvent('安全落地了');
    }
    this._autoSave();
  }

  feed() {
    this._stopMusicSignal();
    this.core.state = PetState.EAT;
    this.core.currentGraphType = 'eat';
    this.core.currentAnimatType = AnimatType.B_LOOP;
    this.core.currentAction = null;
    this.core.idleDuration = 60;
    this.core.idleTimer = 0;
    if (this.stats) this.stats.feed(20);
    this.core.addEvent('被喂食了');
    this.messageBar.say('好吃喵~!');
    this._autoSave();
  }

  play() {
    if (this._startMischief()) {
      if (this.stats) this.stats.play(15);
      this.core.addEvent('玩耍了');
      this._autoSave();
      return;
    }
    this._startMomentaryAction('idle', PetState.HAPPY, 'play', INTERACTION_CFG.MISCHIEF_LOOP_TICKS);
    if (this.stats) this.stats.play(15);
    this.core.addEvent('玩耍了');
    this.messageBar.say('来玩吧!');
    this._autoSave();
  }

  startDance(strong = false) {
    this.music.active = true;
    this.music.strong = !!strong;
    this.music.manualTicks = strong ? 420 : 300;
    this.music.confirmSamples = INTERACTION_CFG.MUSIC_CONFIRM_SAMPLES;
    this.music.releaseSamples = 0;
    this._startMusicAction(true);
  }

  startMischief() {
    this._startMischief(true);
  }

  performAction(action) {
    if (!action) return false;
    const graphType = this._pickGraphType(action.animation?.graphTypes || ['idle', 'default']);
    const loopTicks = action.id === 'work.cleanScreen' ? 90 : 80;
    this._startMomentaryAction(graphType, PetState.HAPPY, action.id || 'action', loopTicks);
    if (action.messages?.start) this.messageBar.say(action.messages.start);
    if (action.messages?.complete) {
      setTimeout(() => this.messageBar.say(action.messages.complete), Math.min(1400, loopTicks * 16));
    }
    this.core.addEvent(action.label || '触发动作');
    this._autoSave();
    return true;
  }

  performFeedItem(action, item) {
    const fallback = item?.type === 'drink'
      ? ['drink', 'eat', 'idle']
      : item?.type === 'gift'
        ? ['gift', 'touch_head', 'say', 'idle']
        : ['eat', 'idle'];
    const graphType = this._pickGraphType(action?.animation?.graphTypes || fallback);
    const state = item?.type === 'gift' ? PetState.HAPPY : PetState.EAT;
    const loopTicks = item?.type === 'gift' ? 95 : 72;

    this._startMomentaryAction(graphType, state, `feed-${item?.type || 'item'}`, loopTicks);
    if (item?.type === 'gift') this.effects.spawnHearts(250, 220, 3);
    if (item?.message) this.messageBar.say(item.message);
    this.core.addEvent(`使用了${item?.name || action?.label || '物品'}`);
    this._autoSave();
    return true;
  }

  startWork(activityType, meta = null) {
    this._stopMusicSignal();
    const graphType = this._pickGraphType(meta?.animation?.graphTypes || ['work', 'idle', 'default']);
    this.core.state = PetState.WORK;
    this.core.currentGraphType = graphType;
    this.core.currentAnimatType = this._pickStartPhase(graphType);
    this.core.currentAction = { graphType, kind: 'activity', activityType, meta, loopTicks: Number.POSITIVE_INFINITY };
    this.core.activity = activityType;
    this.core.idleTimer = 0;
    this.core.animTimer = 0;
  }

  startActivityBreak(meta) {
    const graphType = this._pickGraphType(meta?.animation?.breakGraphTypes || ['playone', 'move', 'idle']);
    this.core.state = PetState.WORK;
    this.core.currentGraphType = graphType;
    this.core.currentAnimatType = this._pickStartPhase(graphType);
    this.core.currentAction = {
      graphType,
      kind: 'activity-break',
      loopTicks: randomInt(55, 95),
      returnActivityType: meta?.id || this.core.activity,
      returnMeta: meta,
    };
    this.core.idleTimer = 0;
    this.core.animTimer = 0;
    this.messageBar.say(randomChoice(['先玩一下再继续喵~', '脑袋要休息一下喵~', '伸个懒腰再学喵~']));
    this.core.addEvent('学习中途玩了一会儿');
    return true;
  }

  stopWork() {
    this.core.activity = null;
    this.core.workProgress = null;
    this.core.resetIdle();
  }

  say(text) {
    this.messageBar.say(text);
    this._startMomentaryAction('say', PetState.HAPPY, 'say', Math.max(45, text.length * 6));
  }

  setWorkProgress(progress) {
    this.core.workProgress = progress;
  }

  _startMomentaryAction(graphType, state, kind, loopTicks) {
    const action = this.core.currentAction;
    if (action?.graphType === graphType && this.core.currentAnimatType !== AnimatType.A_START) {
      action.loopTicks = Math.max(action.loopTicks, loopTicks);
      return true;
    }

    this._stopMusicSignal();
    this.core.state = state;
    this.core.currentGraphType = graphType;
    this.core.currentAnimatType = this._hasAnim(graphType, AnimatType.A_START) ? AnimatType.A_START : AnimatType.B_LOOP;
    this.core.currentAction = { graphType, kind, loopTicks };
    this.core.idleTimer = 0;
    this.core.animTimer = 0;
    return true;
  }

  _startMusicAction(manual) {
    if (!manual && !this._canStartIdleAction() && this.core.state !== PetState.MUSIC) return false;
    if (!this._hasAnim('music', AnimatType.B_LOOP) && !this._hasAnim('music', AnimatType.SINGLE)) return false;

    const current = this.core.currentAction;
    if (current?.kind === 'music') {
      this._syncMusicPhase();
      return true;
    }

    this.core.state = PetState.MUSIC;
    this.core.currentGraphType = 'music';
    this.core.currentAnimatType = this._hasAnim('music', AnimatType.A_START) ? AnimatType.A_START : this._nextLoopPhase({ kind: 'music' });
    this.core.currentAction = { graphType: 'music', kind: 'music', loopTicks: Number.POSITIVE_INFINITY };
    this.core.idleTimer = 0;
    this.core.animTimer = 0;
    this.core.addEvent(manual ? '开始跳舞' : '听到音乐开始跳舞');
    if (!manual && Math.random() < 0.35) this.messageBar.say('音乐响起来了~');
    return true;
  }

  _startMischief(force = false) {
    if (!force && !this._canStartIdleAction()) return false;
    if (force && this.core.state !== PetState.IDLE && !this.core.currentAction) this.core.resetIdle();
    if (this.core.currentAction && this.core.currentAction.kind !== 'mischief') return false;

    const candidates = [
      { graphType: 'idle', message: '嘿嘿~' },
      { graphType: 'pinch', message: '我来捣个小蛋~' },
      { graphType: 'touch_body', message: '不要只顾着忙嘛~' },
    ].filter(item => this._hasAnim(item.graphType, AnimatType.B_LOOP) || this._hasAnim(item.graphType, AnimatType.SINGLE));

    if (!candidates.length) return false;
    const pick = randomChoice(candidates);
    this.core.state = PetState.MISCHIEF;
    this.core.currentGraphType = pick.graphType;
    this.core.currentAnimatType = this._hasAnim(pick.graphType, AnimatType.A_START) ? AnimatType.A_START : AnimatType.B_LOOP;
    this.core.currentAction = { graphType: pick.graphType, kind: 'mischief', loopTicks: INTERACTION_CFG.MISCHIEF_LOOP_TICKS };
    this.core.idleTimer = 0;
    this.core.animTimer = 0;
    this.mischiefNudge = 0;
    this.messageBar.say(pick.message);
    this.core.addEvent('开始捣蛋');
    this._nudgeWindow();
    return true;
  }

  _updateMusicIntent() {
    if (this.music.manualTicks > 0 && this.core.state === PetState.IDLE) {
      this._startMusicAction(true);
    }
    if (this.music.active && this.core.state === PetState.IDLE && !this.core.currentAction) {
      this._startMusicAction(false);
    }
  }

  _syncMusicPhase() {
    const action = this.core.currentAction;
    if (!action || action.kind !== 'music' || this.core.currentAnimatType === AnimatType.A_START || this.core.currentAnimatType === AnimatType.C_END) return;

    const next = this._nextLoopPhase(action);
    if (this.core.currentAnimatType !== next) {
      this.core.currentAnimatType = next;
      this.core.animTimer = 0;
    }
  }

  _nextLoopPhase(action) {
    if (action?.kind === 'music' && this.music.strong && this._hasAnim('music', AnimatType.SINGLE)) {
      return AnimatType.SINGLE;
    }
    return AnimatType.B_LOOP;
  }

  _requestEndAction(action = this.core.currentAction) {
    if (!action) return;
    if (this.core.currentAnimatType === AnimatType.C_END) return;

    if (this._hasAnim(action.graphType, AnimatType.C_END)) {
      this.core.currentGraphType = action.graphType;
      this.core.currentAnimatType = AnimatType.C_END;
      this.core.animTimer = 0;
    } else if (action.kind === 'activity-break') {
      this.startWork(action.returnActivityType, action.returnMeta);
    } else {
      this.core.resetIdle();
    }
  }

  _stopMusicSignal() {
    this.music.active = false;
    this.music.strong = false;
    this.music.confirmSamples = 0;
    this.music.releaseSamples = 0;
    this.music.history.length = 0;
    if (this.core.currentAction?.kind === 'music') this._requestEndAction();
  }

  _canStartIdleAction() {
    return this.core.state === PetState.IDLE && !this.core.currentAction && !this.core.isDragging;
  }

  _pickGraphType(graphTypes) {
    const candidates = Array.isArray(graphTypes) && graphTypes.length ? graphTypes : ['idle', 'default'];
    for (const graphType of candidates) {
      if (
        this._hasAnim(graphType, AnimatType.A_START) ||
        this._hasAnim(graphType, AnimatType.B_LOOP) ||
        this._hasAnim(graphType, AnimatType.SINGLE) ||
        this._hasAnim(graphType, AnimatType.C_END)
      ) {
        return graphType;
      }
    }
    return candidates[0] || 'default';
  }

  _pickStartPhase(graphType) {
    if (this._hasAnim(graphType, AnimatType.A_START)) return AnimatType.A_START;
    if (this._hasAnim(graphType, AnimatType.B_LOOP)) return AnimatType.B_LOOP;
    if (this._hasAnim(graphType, AnimatType.SINGLE)) return AnimatType.SINGLE;
    return AnimatType.B_LOOP;
  }

  _hasAnim(graphType, animatType) {
    const mood = this.core.mood;
    return !!(
      this.graphCore.findCachedExact(graphType, mood, animatType) ||
      this.graphCore.findCachedExact(graphType, ModeType.NORMAL, animatType)
    );
  }

  _average(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  _nextMischiefDelay() {
    return randomInt(INTERACTION_CFG.MISCHIEF_MIN, INTERACTION_CFG.MISCHIEF_MAX);
  }

  _nudgeWindow(strength = INTERACTION_CFG.MISCHIEF_NUDGE_MAX) {
    if (!isElectron()) return;
    const range = Math.max(1, Number(strength) || INTERACTION_CFG.MISCHIEF_NUDGE_MAX);
    const dx = randomInt(-range, range);
    const dy = randomInt(-Math.floor(range / 2), Math.floor(range / 2));
    this.core.controller.moveWindow(dx, dy);
  }
}
