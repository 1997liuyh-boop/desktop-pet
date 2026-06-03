// Toolbar - 右键弹出工具栏（对标 VPet ToolBar）
class Toolbar {
  constructor(core, actions, options = {}) {
    this.core = core;
    this.actions = actions || {};
    this.groups = options.groups || TOOLBAR_GROUPS;
    this.isVisible = false;

    this._createDOM();
    this._setupEvents();
  }

  _createDOM() {
    this.el = document.createElement('div');
    this.el.id = 'toolbar';
    this.el.className = 'hidden';

    const statsSection = document.createElement('div');
    statsSection.id = 'toolbar-stats';
    statsSection.innerHTML = `
      <div class="toolbar-stat"><span>Lv.</span><span id="tb-level">1</span></div>
      <div class="toolbar-stat" id="tb-mood">😐</div>
      <div class="toolbar-stat"><span>🍖</span><div class="tb-bar"><div id="tb-hunger" class="tb-fill hunger"></div></div></div>
      <div class="toolbar-stat"><span>❤️</span><div class="tb-bar"><div id="tb-happy" class="tb-fill happy"></div></div></div>
      <div class="toolbar-stat"><span>⚡</span><div class="tb-bar"><div id="tb-energy" class="tb-fill energy"></div></div></div>
    `;
    this.el.appendChild(statsSection);

    const actionsEl = document.createElement('div');
    actionsEl.id = 'toolbar-actions';
    actionsEl.innerHTML = this.groups.map((groupId) => this._renderGroup(groupId)).join('');
    this.el.appendChild(actionsEl);

    document.getElementById('pet-container').appendChild(this.el);
  }

  _renderGroup(groupId) {
    const group = getActionGroup(groupId);
    const actions = getActionsByGroup(groupId);
    if (!group || !actions.length) return '';

    return `
      <div class="tb-group">
        <div class="tb-group-title"><span>${group.icon}</span>${group.shortLabel}</div>
        <div class="tb-group-actions">
          ${actions.map((action) => `
            <button class="tb-btn" data-action="${action.id}" type="button" title="${action.label}">
              <span>${action.icon}</span>${action.label}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  _setupEvents() {
    ['mousedown', 'mouseup', 'mousemove', 'click', 'contextmenu'].forEach((type) => {
      this.el.addEventListener(type, (e) => {
        e.stopPropagation();
      });
    });

    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (this.actions[action]) {
        this.actions[action]();
        this.hide();
      }
    });
  }

  show(x, y) {
    this.el.classList.remove('hidden');
    const container = document.getElementById('pet-container');
    const maxLeft = Math.max(8, (container?.clientWidth || 350) - this.el.offsetWidth - 8);
    const maxTop = Math.max(8, (container?.clientHeight || 400) - this.el.offsetHeight - 8);
    this.el.style.left = `${clamp(x, 8, maxLeft)}px`;
    this.el.style.top = `${clamp(y, 8, maxTop)}px`;
    this.isVisible = true;
    this.refreshStats();
  }

  hide() {
    this.el.classList.add('hidden');
    this.isVisible = false;
  }

  toggle(x, y) {
    if (this.isVisible) this.hide();
    else this.show(x, y);
  }

  isEventInside(e) {
    return !!(e && e.target && this.el.contains(e.target));
  }

  refreshStats() {
    const s = this.core.stats;
    if (!s) return;
    const mood = this.core.mood;
    const moodEmojis = { [ModeType.HAPPY]: '😊', [ModeType.NORMAL]: '😐', [ModeType.POOR_CONDITION]: '😞', [ModeType.ILL]: '🤒' };

    document.getElementById('tb-level').textContent = s.level;
    document.getElementById('tb-mood').textContent = moodEmojis[mood] || '😐';
    document.getElementById('tb-hunger').style.width = `${s.hunger}%`;
    document.getElementById('tb-happy').style.width = `${s.happiness}%`;
    document.getElementById('tb-energy').style.width = `${s.energy}%`;
  }
}