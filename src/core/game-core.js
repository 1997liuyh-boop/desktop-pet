// GameCore v2 - 核心数据容器，使用 500×500 VPet 逻辑坐标
// v2.1: 行走重构为窗口跟随模式 — 宠物始终在Canvas中心，窗口直接移动

class GameCore {
  constructor(controller, graphCore, stats) {
    this.controller = controller;
    this.graphCore = graphCore;
    this.stats = stats;

    // VPet 500×500 逻辑坐标（宠物中心点）— 用于Canvas内渲染
    this.x = 250;
    this.y = 300;
    this.LOGIC_W = 500;
    this.LOGIC_H = 500;

    this.state = PetState.IDLE;
    this.direction = 1;
    this.animTimer = 0;
    this.currentAnimatType = 'b_loop';
    this.currentAction = null;

    // 行走（窗口跟随模式）
    this.walkTimer = 0;
    this.walkDuration = 0;
    this.walkSpeed = 80;       // 像素/秒，与 Rust walk.rs 对齐
    this._walkAccum = 0;       // 亚像素累积器，避免整数截断导致抖动

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
    this.currentAnimatType = 'b_loop';
    this.currentAction = null;
    this.idleDuration = 120 + Math.random() * 180;
    this.idleTimer = 0;
    this.animTimer = 0;
    this._walkAccum = 0;
  }

  startWalking() {
    this.state = PetState.WALK;
    this.currentAnimatType = 'b_loop';
    this.currentAction = null;

    // 随机方向
    this.direction = Math.random() < 0.5 ? 1 : -1;

    // 行走持续时间：3~8秒（与Rust walk.rs对齐）
    this.walkDuration = 180 + Math.random() * 300; // 帧数（≈3~8秒@60fps）
    this.walkTimer = 0;

    // 速度根据心情变化（与Rust walk.rs对齐）
    const speedRoll = Math.random();
    if (speedRoll < WALK_SPEED.SLOW_CHANCE) {
      this.walkSpeed = WALK_SPEED.SLOW;
    } else if (speedRoll < WALK_SPEED.FAST_CHANCE) {
      this.walkSpeed = WALK_SPEED.FAST;
    } else {
      this.walkSpeed = WALK_SPEED.NORMAL;
    }

    this._walkAccum = 0;
    this.animTimer = 0;

    // 根据方向和速度选择正确的行走动画 graphType（需在 direction 和 walkSpeed 设置后调用）
    this._updateWalkGraphType();
  }

  // 根据方向和速度选择正确的行走 graphType
  _updateWalkGraphType() {
    const dir = this.direction > 0 ? 'right' : 'left';
    if (this.walkSpeed <= WALK_SPEED.SLOW) {
      this.currentGraphType = `move.walk.${dir}.slow`;
    } else if (this.walkSpeed >= WALK_SPEED.FAST) {
      this.currentGraphType = `move.walk.${dir}.faster`;
    } else {
      this.currentGraphType = `move.walk.${dir}`;
    }
  }
}
