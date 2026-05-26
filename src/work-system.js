// WorkSystem - timed work/study/play activities with rewards
class WorkSystem {
  constructor(pet) {
    this.pet = pet;
    this.currentActivity = null;
    this.startTime = null;
    this.duration = 0;
    this.elapsed = 0;
    this.isPaused = false;
    this.onComplete = null;
  }

  start(type) {
    const config = ACTIVITY_CONFIG[type];
    if (!config) return false;

    this.currentActivity = type;
    this.duration = config.duration;
    this.elapsed = 0;
    this.startTime = Date.now();
    this.isPaused = false;

    this.pet.startWork(type);
    this.pet.say(this._getStartMessage(type));
    return true;
  }

  stop() {
    const wasActive = !!this.currentActivity;
    this.currentActivity = null;
    this.elapsed = 0;
    this.isPaused = false;
    this.pet.stopWork();
    if (wasActive) this.pet.say('不干了喵~');
    if (this.onComplete) this.onComplete(null);
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.pet.say(this.isPaused ? '暂停一下喵~' : '继续喵~');
  }

  update() {
    if (!this.currentActivity || this.isPaused) return;
    this.elapsed++;

    const totalFrames = this.duration * 60; // approximate at 60fps
    if (this.elapsed >= totalFrames) {
      this._completeActivity();
    }
  }

  _completeActivity() {
    const config = ACTIVITY_CONFIG[this.currentActivity];
    if (config) {
      this.pet.stats.applyActivityReward(config);
      this.pet.stats.gainExp(config.rewards.exp);
    }

    this.pet.addEvent(`完成了${this._getLabel(this.currentActivity)}`);
    this.pet.say(this._getCompleteMessage(this.currentActivity));
    this.pet.stopWork();
    this.pet.saveStats();

    if (this.onComplete) this.onComplete(this.currentActivity);
    this.currentActivity = null;
    this.elapsed = 0;
  }

  getProgress() {
    if (!this.currentActivity) return null;
    const totalFrames = this.duration * 60;
    const pct = Math.min(100, Math.round((this.elapsed / totalFrames) * 100));
    const remaining = this.duration - Math.floor(this.elapsed / 60);
    return { pct, remaining, type: this.currentActivity, label: this._getLabel(this.currentActivity) };
  }

  getProgressString() {
    const p = this.getProgress();
    if (!p) return '';
    return `${p.label}中... ${formatTime(p.remaining)}`;
  }

  _getLabel(type) {
    const map = { work: '工作', study: '学习', play: '玩耍' };
    return map[type] || '活动';
  }

  _getStartMessage(type) {
    const map = {
      work: '开始工作喵~赚钱买小鱼干！',
      study: '努力学习喵~',
      play: '耶！来玩吧！(≧▽≦)',
    };
    return map[type] || '开始了喵~';
  }

  _getCompleteMessage(type) {
    const map = {
      work: '工作完成！赚到零花钱了喵~',
      study: '学习结束！变聪明了喵~',
      play: '玩得好开心！喵喵~(๑•̀ㅂ•́)و✧',
    };
    return map[type] || '完成了喵~';
  }
}
