// WorkSystem - 定时工作/学习/玩耍活动
class WorkSystem {
  constructor(core, petLogic) {
    this.core = core;
    this.petLogic = petLogic;
    this.currentActivity = null;
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
    this.isPaused = false;

    this.petLogic.startWork(type);
    this.petLogic.say(this._getStartMessage(type));
    return true;
  }

  stop() {
    const wasActive = !!this.currentActivity;
    this.currentActivity = null;
    this.elapsed = 0;
    this.isPaused = false;
    this.petLogic.stopWork();
    if (wasActive) this.petLogic.say('不干了喵~');
    if (this.onComplete) this.onComplete(null);
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.petLogic.say(this.isPaused ? '暂停一下喵~' : '继续喵~');
  }

  update() {
    if (!this.currentActivity || this.isPaused) return;
    this.elapsed++;

    const totalFrames = this.duration * 60;
    // 更新进度
    const pct = Math.min(100, Math.round((this.elapsed / totalFrames) * 100));
    const remaining = this.duration - Math.floor(this.elapsed / 60);
    const config = ACTIVITY_CONFIG[this.currentActivity];
    this.petLogic.setWorkProgress({
      pct, remaining,
      type: this.currentActivity,
      label: config ? config.label : '活动',
    });

    if (this.elapsed >= totalFrames) {
      this._completeActivity();
    }
  }

  _completeActivity() {
    const config = ACTIVITY_CONFIG[this.currentActivity];
    if (config) {
      this.core.stats.applyActivityReward(config);
      this.core.stats.gainExp(config.rewards.exp);
    }

    this.core.addEvent(`完成了${this._getLabel(this.currentActivity)}`);
    this.petLogic.say(this._getCompleteMessage(this.currentActivity));
    this.petLogic.stopWork();

    if (this.onComplete) this.onComplete(this.currentActivity);
    this.currentActivity = null;
    this.elapsed = 0;
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