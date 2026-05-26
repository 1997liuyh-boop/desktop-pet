// EnhancedStats - manages all pet statistics and mood calculation
class EnhancedStats {
  constructor(savedData = null) {
    this.hunger = 80;
    this.happiness = 70;
    this.energy = 90;
    this.health = 90;
    this.strength = 50;
    this.feeling = 70;
    this.likability = 50;
    this.level = 1;
    this.exp = 0;
    this.money = 0;
    this.lastInteractionTime = Date.now();

    if (savedData) this.loadFromObject(savedData);
  }

  // ---- Mood calculation ----
  getMood() {
    const f = this.feeling;
    const h = this.health;
    if (f >= MOOD_THRESHOLDS.HAPPY_MIN_FEELING && h >= MOOD_THRESHOLDS.HAPPY_MIN_HEALTH) return ModeType.HAPPY;
    if (f >= MOOD_THRESHOLDS.NORMAL_MIN_FEELING && h >= MOOD_THRESHOLDS.NORMAL_MIN_HEALTH) return ModeType.NORMAL;
    if (f >= MOOD_THRESHOLDS.POOR_MIN_FEELING || h >= MOOD_THRESHOLDS.POOR_MIN_HEALTH) return ModeType.POOR;
    return ModeType.ILL;
  }

  getMoodText() {
    const map = {
      [ModeType.HAPPY]: '开心',
      [ModeType.NORMAL]: '正常',
      [ModeType.POOR]: '不适',
      [ModeType.ILL]: '生病',
    };
    return map[this.getMood()] || '正常';
  }

  // ---- Stat updates ----
  update(dt) {
    const now = Date.now();
    const elapsed = Math.min((now - (this._lastUpdate || now)) / 1000, 1);
    this._lastUpdate = now;

    if (elapsed <= 0) return;

    // Passive decay
    this.hunger = clamp(this.hunger - STAT_DECAY.hunger * elapsed, 0, 100);
    this.happiness = clamp(this.happiness - STAT_DECAY.happiness * elapsed, 0, 100);
    this.energy = clamp(this.energy - STAT_DECAY.energy * elapsed, 0, 100);
    this.feeling = clamp(this.feeling - STAT_DECAY.feeling * elapsed, 0, 100);

    // Health decays when hungry or low energy
    if (this.hunger < 10 || this.energy < 10) {
      this.health = clamp(this.health - STAT_DECAY.health * elapsed * 3, 0, 100);
    } else if (this.hunger < 25) {
      this.health = clamp(this.health - STAT_DECAY.health * elapsed, 0, 100);
    }

    // Neglect penalty
    const idleMinutes = (now - this.lastInteractionTime) / 60000;
    if (idleMinutes > 1) {
      const neglectDrop = Math.sqrt(idleMinutes) * elapsed / (60 * 4);
      this.feeling = clamp(this.feeling - neglectDrop * 100, 0, 100);
    }
  }

  // ---- Interaction methods ----
  feed(amount = 20) {
    this.hunger = clamp(this.hunger + amount, 0, 100);
    this.happiness = clamp(this.happiness + 5, 0, 100);
    this.likability = clamp(this.likability + 1, 0, 100);
    this.lastInteractionTime = Date.now();
  }

  play(amount = 15) {
    this.happiness = clamp(this.happiness + amount, 0, 100);
    this.energy = clamp(this.energy - 5, 0, 100);
    this.feeling = clamp(this.feeling + 10, 0, 100);
    this.likability = clamp(this.likability + 2, 0, 100);
    this.lastInteractionTime = Date.now();
  }

  pet() {
    this.happiness = clamp(this.happiness + 8, 0, 100);
    this.feeling = clamp(this.feeling + 5, 0, 100);
    this.likability = clamp(this.likability + 1, 0, 100);
    this.lastInteractionTime = Date.now();
  }

  sleepRecover() {
    this.energy = clamp(this.energy + 0.15, 0, 100);
    this.health = clamp(this.health + 0.03, 0, 100);
  }

  applyActivityReward(config) {
    if (config.rewards.money) this.money += config.rewards.money;
    if (config.rewards.exp) this.gainExp(config.rewards.exp);
    if (config.rewards.strength) this.strength = clamp(this.strength + config.rewards.strength, 0, 100);
    if (config.rewards.hungerCost) this.hunger = clamp(this.hunger - config.rewards.hungerCost, 0, 100);
    if (config.rewards.energyCost) this.energy = clamp(this.energy - config.rewards.energyCost, 0, 100);
    if (config.rewards.feelingCost) this.feeling = clamp(this.feeling + config.rewards.feelingCost, 0, 100);
  }

  // ---- Level/Exp ----
  gainExp(amount) {
    this.exp += amount;
    const needed = this.levelUpNeed();
    while (this.exp >= needed) {
      this.exp -= needed;
      this.level++;
    }
  }

  levelUpNeed() {
    return Math.pow(this.level * 10, 2);
  }

  // ---- Persistence ----
  getStatsObject() {
    return {
      hunger: this.hunger, happiness: this.happiness, energy: this.energy,
      health: this.health, strength: this.strength, feeling: this.feeling,
      likability: this.likability, level: this.level, exp: this.exp, money: this.money,
      lastInteractionTime: this.lastInteractionTime, timestamp: Date.now(),
    };
  }

  loadFromObject(obj) {
    if (!obj) return;
    const keys = ['hunger', 'happiness', 'energy', 'health', 'strength', 'feeling', 'likability', 'level', 'exp', 'money', 'timestamp'];
    keys.forEach(k => { if (obj[k] !== undefined) this[k] = obj[k]; });
    if (obj.lastInteractionTime) this.lastInteractionTime = obj.lastInteractionTime;
    // Decay stats for offline time
    if (obj.timestamp) {
      const elapsed = (Date.now() - obj.timestamp) / 1000;
      const decayFactor = Math.max(0.5, 1 - elapsed * 0.00008);
      this.hunger = Math.round(this.hunger * decayFactor);
      this.happiness = Math.round(this.happiness * decayFactor);
      this.energy = Math.round(this.energy * decayFactor);
    }
  }

  getContextForLLM() {
    const mood = this.getMood();
    return `等级: ${this.level} | 心情: ${this.getMoodText()} | 饱食度: ${Math.round(this.hunger)}/100 | 快乐度: ${Math.round(this.happiness)}/100 | 体力: ${Math.round(this.energy)}/100 | 健康: ${Math.round(this.health)}/100 | 好感度: ${Math.round(this.likability)}/100 | 金币: ${this.money}`;
  }
}
