// Toolbar - 右键弹出工具栏（对标 VPet ToolBar）
class Toolbar {
  constructor(core, actions) {
    this.core = core;
    this.actions = actions || {};
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
    actionsEl.innerHTML = `
      <button class="tb-btn" data-action="feed">🍖 喂食</button>
      <button class="tb-btn" data-action="play">⚽ 玩耍</button>
      <button class="tb-btn" data-action="work">💼 工作</button>
      <button class="tb-btn" data-action="chat">💬 聊天</button>
      <button class="tb-btn" data-action="settings">⚙️ 设置</button>
    `;
    this.el.appendChild(actionsEl);

    document.getElementById('pet-container').appendChild(this.el);
  }

  _setupEvents() {
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
    this.el.style.left = `${Math.min(x, 40)}px`;
    this.el.style.top = `${Math.min(y, 80)}px`;
    this.el.classList.remove('hidden');
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