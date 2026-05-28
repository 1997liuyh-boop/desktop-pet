// GameCore v2 - 核心数据容器，使用 500×500 VPet 逻辑坐标
class GameCore {
  constructor(controller, graphCore, stats) {
    this.controller = controller;
    this.graphCore = graphCore;
    this.stats = stats;

    // VPet 500×500 逻辑坐标（宠物中心点）
    this.x = 250;
    this.y = 300;
    this.LOGIC_W = 500;
    this.LOGIC_H = 500;

    this.state = PetState.IDLE;
    this.direction = 1;
    this.animTimer = 0;

    // 行走
    this.targetX = this.x;
    this.targetY = this.y;
    this.walkTimer = 0;
    this.walkDuration = 0;

    // 计时
    this.idleTimer = 0;
    this.idleDuration = 180;

    // 交互
    this.isDragging = false;
    this.isHovered = false;

    // 活动
    this.activity = null;
    this.workProgress = null;

    // 事件
    this.recentEvents = [];
    this.proactiveTimer = 0;
    this.proactiveInterval = randomInt(PROACTIVE.IDLE_SPEAK_MIN, PROACTIVE.IDLE_SPEAK_MAX);

    this.currentGraphType = 'default';
  }

  get mood() { return this.stats ? this.stats.getMood() : ModeType.NORMAL; }
  get expression() {
    const m = this.mood;
    if (m === ModeType.ILL) return Expression.SICK;
    if (m === ModeType.POOR_CONDITION) return Math.random() < 0.3 ? Expression.SAD : Expression.NORMAL;
    return Expression.NORMAL;
  }

  addEvent(desc) {
    this.recentEvents.push({ desc, time: Date.now() });
    if (this.recentEvents.length > 10) this.recentEvents.shift();
  }

  getRecentEventsText() {
    if (this.recentEvents.length === 0) return '（还没有特别的事发生）';
    return this.recentEvents.slice(-5).map(e => `- ${e.desc}`).join('\n');
  }

  getContextForLLM() {
    return this.stats ? this.stats.getContextForLLM() : '';
  }

  resetIdle() {
    this.state = PetState.IDLE;
    this.currentGraphType = 'default';
    this.idleDuration = 120 + Math.random() * 180;
    this.idleTimer = 0;
    this.animTimer = 0;
  }

  startWalking() {
    this.state = PetState.WALK;
    this.currentGraphType = 'move';
    this.targetX = 100 + Math.random() * 300;
    this.targetY = 200 + Math.random() * 200;
    this.walkDuration = 60 + Math.random() * 120;
    this.walkTimer = 0;
    this.animTimer = 0;
    if (Math.abs(this.targetX - this.x) > 10) {
      this.direction = this.targetX > this.x ? 1 : -1;
    }
  }
}