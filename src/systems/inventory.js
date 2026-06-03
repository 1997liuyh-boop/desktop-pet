const INVENTORY_STORAGE_KEY = 'desktop-pet-inventory';

const INVENTORY_ITEMS = {
  rice: {
    id: 'rice', type: 'food', name: '猫猫饭团', icon: '🍙', count: 3,
    effects: { hunger: 24, happiness: 4, likability: 1 },
    message: '饭团软乎乎，好吃喵~',
  },
  fish: {
    id: 'fish', type: 'food', name: '小鱼干', icon: '🐟', count: 2,
    effects: { hunger: 32, happiness: 8, likability: 2 },
    message: '小鱼干天下第一喵！',
  },
  water: {
    id: 'water', type: 'drink', name: '清水', icon: '🥛', count: 4,
    effects: { hunger: 6, energy: 8, health: 3 },
    message: '喝完水精神一点了喵~',
  },
  milk: {
    id: 'milk', type: 'drink', name: '温牛奶', icon: '🍼', count: 2,
    effects: { hunger: 10, energy: 14, happiness: 4 },
    message: '牛奶暖暖的喵~',
  },
  capsule: {
    id: 'capsule', type: 'medicine', name: '恢复药', icon: '💊', count: 2,
    effects: { health: 28, energy: 8, happiness: -2 },
    message: '药有点苦，但身体好多了喵~',
  },
  flower: {
    id: 'flower', type: 'gift', name: '小花束', icon: '💐', count: 1,
    effects: { happiness: 18, feeling: 12, likability: 4 },
    message: '送给我的吗？好开心喵！',
  },
  ribbon: {
    id: 'ribbon', type: 'gift', name: '漂亮缎带', icon: '🎀', count: 1,
    effects: { happiness: 16, feeling: 10, likability: 5 },
    message: '戴起来一定很好看喵~',
  },
};

class InventorySystem {
  constructor() {
    this.items = this._createDefaultItems();
    this.load();
  }

  _createDefaultItems() {
    return Object.fromEntries(
      Object.values(INVENTORY_ITEMS).map(item => [item.id, { ...item }])
    );
  }

  load() {
    const saved = this._loadPersisted();
    if (!saved || typeof saved !== 'object') return;

    Object.values(saved.items || saved).forEach(item => {
      if (!item || !item.id) return;
      const base = INVENTORY_ITEMS[item.id] || item;
      this.items[item.id] = {
        ...base,
        ...item,
        count: Math.max(0, Number(item.count) || 0),
      };
    });
  }

  _loadPersisted() {
    try {
      if (isElectron() && window.electronAPI.loadInventory) {
        return window.electronAPI.loadInventory();
      }
      return loadFromStorage(INVENTORY_STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  save() {
    const payload = this.getSnapshot();
    try {
      if (isElectron() && window.electronAPI.saveInventory) {
        window.electronAPI.saveInventory(payload);
      } else {
        saveToStorage(INVENTORY_STORAGE_KEY, payload);
      }
    } catch (e) { /* ignore */ }
  }

  getSnapshot() {
    return {
      version: 1,
      updatedAt: Date.now(),
      items: Object.fromEntries(
        Object.values(this.items).map(item => [item.id, { ...item }])
      ),
    };
  }

  list(type = null) {
    return Object.values(this.items)
      .filter(item => !type || item.type === type)
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  }

  getFirstAvailable(type) {
    return this.list(type).find(item => item.count > 0) || null;
  }

  useFirst(type, stats) {
    const item = this.getFirstAvailable(type);
    if (!item) {
      return { ok: false, reason: 'empty', type };
    }
    return this.useItem(item.id, stats);
  }

  useItem(itemId, stats) {
    const item = this.items[itemId];
    if (!item || item.count <= 0) {
      return { ok: false, reason: 'empty', item };
    }

    item.count -= 1;
    this._applyEffects(item.effects || {}, stats);
    this.save();

    return { ok: true, item: { ...item, count: item.count } };
  }

  addItem(itemId, count = 1) {
    const base = INVENTORY_ITEMS[itemId];
    if (!base) return false;
    if (!this.items[itemId]) this.items[itemId] = { ...base, count: 0 };
    this.items[itemId].count += Math.max(1, count);
    this.save();
    return true;
  }

  _applyEffects(effects, stats) {
    if (!stats) return;
    Object.entries(effects).forEach(([key, value]) => {
      if (typeof stats[key] !== 'number') return;
      stats[key] = clamp(stats[key] + value, 0, 100);
    });
    stats.lastInteractionTime = Date.now();
  }

  getCountsByType() {
    return this.list().reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + item.count;
      return acc;
    }, {});
  }
}