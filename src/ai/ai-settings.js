// AISettings - 增强的AI设置面板
// 语气预设选择器 + API配置 + 人设编辑器 + 行为开关

class AISettings {
  constructor(llmClient, personaSystem) {
    this.llmClient = llmClient;
    this.persona = personaSystem;
    this.isVisible = false;

    this._createDOM();
    this._setupEvents();
  }

  _createDOM() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'settings-overlay';
    this.overlay.className = 'hidden';

    this.panel = document.createElement('div');
    this.panel.id = 'settings-panel';

    // 页签导航
    const tabs = document.createElement('div');
    tabs.className = 'settings-tabs';
    tabs.innerHTML = `
      <button class="settings-tab active" data-tab="ai">🤖 AI设置</button>
      <button class="settings-tab" data-tab="persona">🎭 语气人设</button>
      <button class="settings-tab" data-tab="behavior">⚙️ 行为</button>
    `;

    // AI设置页
    const tabAI = document.createElement('div');
    tabAI.className = 'settings-tab-content active';
    tabAI.id = 'tab-ai';
    tabAI.innerHTML = `
      <div class="settings-section">
        <h4>API 端点</h4>
        <input type="text" id="set-endpoint" placeholder="https://api.openai.com/v1/chat/completions" />
        <label>模型名称</label>
        <input type="text" id="set-model" placeholder="gpt-3.5-turbo" />
        <label>API Key</label>
        <div class="api-key-row">
          <input type="password" id="set-apikey" placeholder="sk-..." />
          <button id="set-toggle-apikey" title="显示/隐藏">👁</button>
        </div>
        <button id="set-test-connection" class="btn-secondary">测试连接</button>
        <span id="set-test-result"></span>
      </div>
    `;

    // 语气人设页
    const tabPersona = document.createElement('div');
    tabPersona.className = 'settings-tab-content';
    tabPersona.id = 'tab-persona';
    tabPersona.innerHTML = `
      <div class="settings-section">
        <h4>语气预设</h4>
        <div id="tone-preset-list" class="tone-preset-list"></div>
      </div>
      <div class="settings-section">
        <h4>自定义人设提示词</h4>
        <textarea id="set-system-prompt" rows="6" placeholder="留空则使用预设模板&#10;可用变量：{STATS_CONTEXT}, {TIME_CONTEXT}, {RECENT_EVENTS}"></textarea>
        <small>自定义提示词会覆盖所有预设语气，留空则使用预设模板</small>
      </div>
    `;

    // 行为设置页
    const tabBehavior = document.createElement('div');
    tabBehavior.className = 'settings-tab-content';
    tabBehavior.id = 'tab-behavior';
    tabBehavior.innerHTML = `
      <div class="settings-section">
        <h4>行为设置</h4>
        <label class="toggle-label">
          <input type="checkbox" id="set-sidehide" checked />
          <span>启用侧边隐藏</span>
        </label>
        <label class="toggle-label">
          <input type="checkbox" id="set-proactive" checked />
          <span>启用主动说话</span>
        </label>
      </div>
    `;

    // 底部按钮
    const buttons = document.createElement('div');
    buttons.className = 'settings-buttons';
    buttons.innerHTML = `
      <button id="set-save-btn" class="btn-primary">保存</button>
      <button id="set-cancel-btn" class="btn-secondary">取消</button>
    `;

    this.panel.appendChild(tabs);
    this.panel.appendChild(tabAI);
    this.panel.appendChild(tabPersona);
    this.panel.appendChild(tabBehavior);
    this.panel.appendChild(buttons);
    this.overlay.appendChild(this.panel);
    document.getElementById('pet-container').appendChild(this.overlay);

    // 生成语气预设按钮
    this._renderTonePresets();
  }

  _renderTonePresets() {
    const list = document.getElementById('tone-preset-list');
    if (!list) return;

    const presets = this.persona._tonePresets;
    const activeId = this.persona.activePreset;

    list.innerHTML = '';
    for (const [id, preset] of Object.entries(presets)) {
      const card = document.createElement('div');
      card.className = `tone-preset-card${id === activeId ? ' active' : ''}`;
      card.dataset.presetId = id;
      card.innerHTML = `
        <span class="tone-preset-icon">${preset.icon}</span>
        <div class="tone-preset-info">
          <span class="tone-preset-name">${preset.name}</span>
          <span class="tone-preset-desc">${preset.description}</span>
        </div>
      `;
      card.addEventListener('click', () => {
        this._selectPreset(id);
      });
      list.appendChild(card);
    }
  }

  _selectPreset(id) {
    document.querySelectorAll('.tone-preset-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`.tone-preset-card[data-preset-id="${id}"]`);
    if (card) card.classList.add('active');
    this._selectedPreset = id;
  }

  _setupEvents() {
    // 页签切换
    this.panel.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        this.panel.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        this.panel.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const content = document.getElementById(`tab-${target}`);
        if (content) content.classList.add('active');
      });
    });

    document.getElementById('set-save-btn').addEventListener('click', () => this.save());
    document.getElementById('set-cancel-btn').addEventListener('click', () => this.hide());
    document.getElementById('set-test-connection').addEventListener('click', () => this.testConnection());
    document.getElementById('set-toggle-apikey').addEventListener('click', () => {
      const el = document.getElementById('set-apikey');
      el.type = el.type === 'password' ? 'text' : 'password';
    });

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  show() {
    this._load();
    this.overlay.classList.remove('hidden');
    this.isVisible = true;
  }

  hide() {
    this.overlay.classList.add('hidden');
    this.isVisible = false;
  }

  _load() {
    const cfg = this.llmClient.config;
    document.getElementById('set-endpoint').value = cfg.endpoint || '';
    document.getElementById('set-model').value = cfg.model || '';
    document.getElementById('set-apikey').value = '';
    document.getElementById('set-system-prompt').value = this.persona.customPrompt || '';

    if (this.llmClient.hasApiKey()) {
      document.getElementById('set-apikey').placeholder = '已设置 (留空不修改)';
    }

    // 语气预设选中状态
    this._selectedPreset = this.persona.activePreset;
    this._renderTonePresets();
  }

  async save() {
    const endpoint = document.getElementById('set-endpoint').value.trim();
    const model = document.getElementById('set-model').value.trim();
    const apiKey = document.getElementById('set-apikey').value.trim();
    const systemPrompt = document.getElementById('set-system-prompt').value.trim();

    if (endpoint) await this.llmClient.updateConfig({ endpoint, model });
    if (apiKey) await this.llmClient.setApiKey(apiKey);

    if (systemPrompt) {
      this.persona.setCustomPrompt(systemPrompt);
      await this.llmClient.updateConfig({ systemPrompt });
    } else {
      this.persona.setCustomPrompt('');
      await this.llmClient.updateConfig({ systemPrompt: '' });
    }

    // 保存语气预设
    if (this._selectedPreset) {
      this.persona.setTonePreset(this._selectedPreset);
    }

    const behavior = {
      sideHide: document.getElementById('set-sidehide').checked,
      proactive: document.getElementById('set-proactive').checked,
    };
    saveToStorage('pet-behavior-settings', behavior);

    this.hide();
  }

  async testConnection() {
    const resultEl = document.getElementById('set-test-result');
    resultEl.textContent = '测试中...';
    resultEl.style.color = '#999';

    const endpoint = document.getElementById('set-endpoint').value.trim() || LLM_DEFAULT.endpoint;
    const model = document.getElementById('set-model').value.trim() || LLM_DEFAULT.model;
    const apiKey = document.getElementById('set-apikey').value.trim();

    try {
      await this.llmClient.testConnection(endpoint, model, apiKey);
      resultEl.textContent = '✓ 连接成功';
      resultEl.style.color = '#4caf50';
    } catch (e) {
      resultEl.textContent = `✗ 连接失败: ${e.message}`;
      resultEl.style.color = '#f44336';
    }
  }
}