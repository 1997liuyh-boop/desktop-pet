// WorkSystem - 定时工作/学习/直播活动
class WorkSystem {
  constructor(core, petLogic) {
    this.core = core;
    this.petLogic = petLogic;
    this.currentActivity = null;
    this.currentMeta = null;
    this.duration = 0;
    this.elapsed = 0;
    this.isPaused = false;
    this.onComplete = null;
    this.breakTimer = 0;
  }

  start(type) {
    const meta = this._resolveActivity(type);
    if (!meta) return false;

    if (this.currentActivity) this.stop({ silent: true });

    this.currentActivity = meta.id;
    this.currentMeta = meta;
    this.duration = meta.activity.duration;
    this.elapsed = 0;
    this.isPaused = false;
    this.breakTimer = this._nextBreakDelay(meta);

    this.petLogic.startWork(meta.id, meta);
    this.petLogic.messageBar.say(meta.messages?.start || this._getStartMessage(meta.id));
    return true;
  }

  stop(options = {}) {
    const wasActive = !!this.currentActivity;
    this.currentActivity = null;
    this.currentMeta = null;
    this.elapsed = 0;
    this.isPaused = false;
    this.breakTimer = 0;
    this.petLogic.stopWork();
    if (wasActive && !options.silent) this.petLogic.messageBar.say('不干了喵~');
    if (this.onComplete) this.onComplete(null);
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.petLogic.messageBar.say(this.isPaused ? '暂停一下喵~' : '继续喵~');
  }

  update() {
    if (!this.currentActivity || this.isPaused) return;
    this.elapsed++;

    if (!this.core.activity && !this.core.currentAction) {
      this.petLogic.startWork(this.currentActivity, this.currentMeta);
    }

    this._maybeStudyBreak();

    const totalFrames = this.duration * 60;
    const pct = Math.min(100, Math.round((this.elapsed / totalFrames) * 100));
    const remaining = Math.max(0, this.duration - Math.floor(this.elapsed / 60));
    this.petLogic.setWorkProgress({
      pct,
      remaining,
      type: this.currentActivity,
      label: this.currentMeta.activity.label,
      progressLabel: this.currentMeta.activity.progressLabel,
      icon: this.currentMeta.icon,
    });

    if (this.elapsed >= totalFrames) {
      this._completeActivity();
    }
  }

  _completeActivity() {
    const meta = this.currentMeta;
    if (meta?.rewards) {
      this.core.stats.applyActivityReward({ rewards: meta.rewards });
    }

    this.core.addEvent(`完成了${meta?.activity?.label || this._getLabel(this.currentActivity)}`);
    this.petLogic.stopWork();
    this.petLogic.say(meta?.messages?.complete || this._getCompleteMessage(this.currentActivity));

    const completed = this.currentActivity;
    this.currentActivity = null;
    this.currentMeta = null;
    this.elapsed = 0;
    this.breakTimer = 0;
    if (this.onComplete) this.onComplete(completed);
  }

  _maybeStudyBreak() {
    const meta = this.currentMeta;
    if (!meta || meta.group !== 'study') return;
    if (this.core.state !== PetState.WORK || this.core.currentAction?.kind === 'activity-break') return;

    this.breakTimer--;
    if (this.breakTimer > 0) return;

    this.breakTimer = this._nextBreakDelay(meta);
    if (Math.random() < 0.75) {
      this.petLogic.startActivityBreak(meta);
    }
  }

  _nextBreakDelay(meta) {
    if (!meta || meta.group !== 'study') return 0;
    return randomInt(360, 720);
  }

  _resolveActivity(type) {
    if (typeof getActionMeta === 'function') {
      const direct = getActionMeta(type);
      if (direct?.kind === 'activity') return direct;
    }

    const legacyMap = {
      work: 'work.live',
      study: 'study.calligraphy',
      play: 'study.dance',
    };
    const legacy = legacyMap[type];
    if (legacy && typeof getActionMeta === 'function') {
      return getActionMeta(legacy);
    }

    const config = ACTIVITY_CONFIG[type];
    if (!config) return null;
    return {
      id: type,
      group: type,
      icon: '⏳',
      activity: { duration: config.duration, label: config.label, progressLabel: '进行中' },
      animation: { graphTypes: [type, 'work', 'idle'] },
      rewards: config.rewards,
      messages: { start: this._getStartMessage(type), complete: this._getCompleteMessage(type) },
    };
  }

  _getLabel(type) {
    const map = { work: '工作', study: '学习', play: '玩耍', 'work.live': '直播' };
    return map[type] || '活动';
  }

  _getStartMessage(type) {
    const map = {
      work: '开始工作喵~赚钱买小鱼干！',
      study: '努力学习喵~',
      play: '耶！来玩吧！(≧▽≦)',
      'work.live': '直播开始喵~',
    };
    return map[type] || '开始了喵~';
  }

  _getCompleteMessage(type) {
    const map = {
      work: '工作完成！赚到零花钱了喵~',
      study: '学习结束！变聪明了喵~',
      play: '玩得好开心！喵喵~(๑•̀ㅂ•́)و✧',
      'work.live': '直播完成！收到好多喜欢喵~',
    };
    return map[type] || '完成了喵~';
  }
}