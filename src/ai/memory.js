// PetMemory - 轻量本地记忆模型

class PetMemory {
  constructor() {
    this.data = this._load();
  }

  _empty() {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      facts: [],
      preferences: [],
      recentTopics: [],
      affinity: 50,
    };
  }

  _compactItems(items, limit, maxLength = 48) {
    const seen = new Set();
    const compacted = [];
    for (const item of Array.isArray(items) ? items : []) {
      const normalized = String(item || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      compacted.push(normalized);
    }
    return compacted.slice(-limit);
  }

  _normalize(memory) {
    const base = this._empty();
    const data = memory || {};
    return {
      version: 1,
      updatedAt: data.updatedAt || base.updatedAt,
      facts: this._compactItems(data.facts, 20),
      preferences: this._compactItems(data.preferences, 20),
      recentTopics: this._compactItems(data.recentTopics, 12, 80),
      affinity: Number.isFinite(data.affinity) ? clamp(data.affinity, 0, 100) : base.affinity,
    };
  }

  _load() {
    if (isElectron() && window.electronAPI.loadMemory) {
      return this._normalize(window.electronAPI.loadMemory());
    }
    return this._normalize(loadFromStorage('pet-memory', this._empty()));
  }

  save(memory = this.data) {
    this.data = this._normalize({ ...memory, updatedAt: new Date().toISOString() });
    if (isElectron() && window.electronAPI.saveMemory) {
      window.electronAPI.saveMemory(this.data);
    } else {
      saveToStorage('pet-memory', this.data);
    }
    return this.data;
  }

  summary() {
    if (isElectron() && window.electronAPI.getMemorySummary) {
      return window.electronAPI.getMemorySummary();
    }
    const lines = [];
    if (this.data.preferences.length) lines.push(`偏好：${this.data.preferences.slice(-5).join('；')}`);
    if (this.data.facts.length) lines.push(`已知信息：${this.data.facts.slice(-5).join('；')}`);
    if (this.data.recentTopics.length) lines.push(`最近话题：${this.data.recentTopics.slice(-5).join('；')}`);
    lines.push(`亲近度：${Math.round(this.data.affinity)}/100`);
    return lines.join('\n');
  }

  updateFromChat(userText, assistantText) {
    if (isElectron() && window.electronAPI.updateMemoryFromChat) {
      this.data = this._normalize(window.electronAPI.updateMemoryFromChat(userText, assistantText));
      return this.data;
    }

    const user = String(userText || '').replace(/\s+/g, ' ').trim();
    const assistant = String(assistantText || '').replace(/\s+/g, ' ').trim();
    const preferenceMatch = user.match(/(?:我喜欢|喜欢|爱吃|想要|偏好)([^，。！？\n]{1,24})/);
    const factMatch = user.match(/(?:我是|我叫|我的)([^，。！？\n]{1,28})/);
    const recentTopics = this._compactItems([...this.data.recentTopics, user.slice(0, 60)], 12, 80);
    const next = this._normalize({
      ...this.data,
      recentTopics,
      affinity: Math.min(100, this.data.affinity + (assistant ? 1 : 0)),
    });
    if (preferenceMatch) next.preferences = this._compactItems([...next.preferences, preferenceMatch[0]], 20);
    if (factMatch) next.facts = this._compactItems([...next.facts, factMatch[0]], 20);
    return this.save(next);
  }
}