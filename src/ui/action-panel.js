class ActionPanel {
  constructor(core, options = {}) {
    this.core = core;
    this.actions = options.actions || {};
    this.inventory = options.inventory || null;
    this.onUseItem = options.onUseItem || null;
    this.isExpanded = loadFromStorage('desktop-pet-action-panel-open', true);
    this.activeTab = 'study';

    this._createDOM();
    this._setupEvents();
    this.refresh();
  }

  _createDOM() {
    this.el = document.createElement('div');
    this.el.id = 'action-panel';
    this.el.className = this.isExpanded ? 'expanded' : 'collapsed';

    this.el.innerHTML = `
      <button id="action-panel-toggle" type="button" title="展开/收起操作面板">☰</button>
      <div id="action-panel-body">
        <div id="action-panel-tabs"></div>
        <div id="action-panel-content"></div>
        <div id="action-progress-card" class="hidden"></div>
      </div>
    `;

    document.getElementById('pet-container').appendChild(this.el);
    this.tabsEl = this.el.querySelector('#action-panel-tabs');
    this.contentEl = this.el.querySelector('#action-panel-content');
    this.progressEl = this.el.querySelector('#action-progress-card');
  }

  _setupEvents() {
    ['mousedown', 'mouseup', 'mousemove', 'click', 'contextmenu'].forEach((type) => {
      this.el.addEventListener(type, (e) => e.stopPropagation());
    });

    this.el.querySelector('#action-panel-toggle').addEventListener('click', () => {
      this.isExpanded = !this.isExpanded;
      this.el.className = this.isExpanded ? 'expanded' : 'collapsed';
      saveToStorage('desktop-pet-action-panel-open', this.isExpanded);
    });

    this.tabsEl.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-panel-tab]');
      if (!tab) return;
      this.activeTab = tab.dataset.panelTab;
      this.refresh();
    });

    this.contentEl.addEventListener('click', (e) => {
      const itemBtn = e.target.closest('[data-item-id]');
      if (itemBtn) {
        if (this.onUseItem) this.onUseItem(itemBtn.dataset.itemId);
        this.refresh();
        return;
      }

      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (this.actions[action]) this.actions[action]();
      this.refresh();
    });
  }

  refresh() {
    this._renderTabs();
    this._renderActions();
    this._renderProgress();
  }

  refreshProgress() {
    this._renderProgress();
  }

  setActiveTab(tabId) {
    this.activeTab = tabId;
    if (this.activeTab === 'bag') this.isExpanded = true;
    this.el.className = this.isExpanded ? 'expanded' : 'collapsed';
    saveToStorage('desktop-pet-action-panel-open', this.isExpanded);
    this.refresh();
  }

  _renderTabs() {
    this.tabsEl.innerHTML = PANEL_GROUPS.map((groupId) => {
      const group = getActionGroup(groupId);
      const active = groupId === this.activeTab ? 'active' : '';
      return `<button class="panel-tab ${active}" data-panel-tab="${groupId}" type="button"><span>${group.icon}</span>${group.shortLabel}</button>`;
    }).join('');
  }

  _renderActions() {
    if (this.activeTab === 'bag') {
      this._renderBag();
      return;
    }

    const actions = getActionsByGroup(this.activeTab);
    const counts = this.inventory ? this.inventory.getCountsByType() : {};

    this.contentEl.innerHTML = actions.map((action) => {
      const count = action.itemType ? counts[action.itemType] || 0 : null;
      const badge = count === null ? '' : `<span class="action-count">${count}</span>`;
      const disabled = count === 0 && action.kind === 'inventory' ? 'disabled' : '';
      return `
        <button class="panel-action ${disabled}" data-action="${action.id}" type="button" ${disabled ? 'disabled' : ''}>
          <span class="panel-action-icon">${action.icon}</span>
          <span class="panel-action-main">
            <strong>${action.label}</strong>
            <small>${this._getActionHint(action)}</small>
          </span>
          ${badge}
        </button>
      `;
    }).join('');
  }

  _renderBag() {
    const items = this.inventory ? this.inventory.list() : [];
    if (!items.length) {
      this.contentEl.innerHTML = '<div class="bag-empty">背包还是空的喵~</div>';
      return;
    }

    this.contentEl.innerHTML = `
      <div class="bag-list">
        ${items.map((item) => {
          const disabled = item.count <= 0 ? 'disabled' : '';
          return `
            <button class="bag-item ${disabled}" data-item-id="${item.id}" type="button" ${disabled ? 'disabled' : ''}>
              <span class="bag-item-icon">${item.icon}</span>
              <span class="bag-item-main">
                <strong>${item.name}</strong>
                <small>${this._formatEffects(item.effects)}</small>
              </span>
              <span class="bag-item-count">×${item.count}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  _renderProgress() {
    const progress = this.core.workProgress;
    if (!progress) {
      this.progressEl.classList.add('hidden');
      this.progressEl.innerHTML = '';
      return;
    }

    this.progressEl.classList.remove('hidden');
    this.progressEl.innerHTML = `
      <div class="progress-title">
        <span>${progress.icon || '⏳'}</span>
        <strong>${progress.label || '活动中'}</strong>
        <em>${formatTime(progress.remaining || 0)}</em>
      </div>
      <div class="progress-track"><div style="width:${progress.pct || 0}%"></div></div>
      <div class="progress-subtitle">${progress.progressLabel || '进行中'} · ${progress.pct || 0}%</div>
    `;
  }

  _formatEffects(effects = {}) {
    const labels = {
      hunger: '饱食',
      happiness: '快乐',
      energy: '体力',
      health: '健康',
      feeling: '心情',
      likability: '好感',
    };
    return Object.entries(effects)
      .filter(([, value]) => value)
      .map(([key, value]) => `${labels[key] || key}${value > 0 ? '+' : ''}${value}`)
      .join(' · ') || '普通物品';
  }

  _getActionHint(action) {
    if (action.kind === 'activity') return action.activity?.progressLabel || '开始活动';
    if (action.kind === 'inventory') return '使用背包物品';
    if (action.id === 'work.cleanScreen') return '短动作清理画面';
    if (action.id === 'feed.bag') return '查看所有库存';
    return '立即触发';
  }

  isEventInside(e) {
    return !!(e && e.target && this.el.contains(e.target));
  }
}