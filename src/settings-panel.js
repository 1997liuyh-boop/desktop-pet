// SettingsPanel - LLM config and behavior settings overlay
class SettingsPanel {
  constructor(llmClient, persona) {
    this.llmClient = llmClient;
    this.persona = persona;
    this.isVisible = false;

    this._createDOM();
    this._setupEvents();
  }

  _createDOM() {
    // Overlay
    this.overlay = document.createElement('div');
    this.overlay.id = 'settings-overlay';
    this.overlay.className = 'hidden';

    this.panel = document.createElement('div');
    this.panel.id = 'settings-panel';
    this.panel.innerHTML = `
      <div class="settings-header">
        <h3>设置</h3>
        <button id="settings-close-btn">×</button>
      </div>

      <div class="settings-section">
        <h4>LLM 设置</h4>
        <label>API 端点</label>
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

      <div class="settings-section">
        <h4>宠物人设</h4>
        <label>系统提示词（自定义覆盖）</label>
        <textarea id="set-system-prompt" rows="4" placeholder="留空则使用默认人设"></textarea>
        <small>留空使用默认提示词。可用变量：{STATS_CONTEXT}, {TIME_CONTEXT}, {RECENT_EVENTS}</small>
      </div>

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

      <div class="settings-buttons">
        <button id="set-save-btn" class="btn-primary">保存</button>
        <button id="set-cancel-btn" class="btn-secondary">取消</button>
      </div>
    `;
    this.overlay.appendChild(this.panel);
    document.getElementById('pet-container').appendChild(this.overlay);
  }

  _setupEvents() {
    document.getElementById('settings-close-btn').addEventListener('click', () => this.hide());
    document.getElementById('set-cancel-btn').addEventListener('click', () => this.hide());
    document.getElementById('set-save-btn').addEventListener('click', () => this.save());
    document.getElementById('set-test-connection').addEventListener('click', () => this.testConnection());
    document.getElementById('set-toggle-apikey').addEventListener('click', () => {
      const el = document.getElementById('set-apikey');
      el.type = el.type === 'password' ? 'text' : 'password';
    });

    // Close on overlay click
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

  async _load() {
    const cfg = this.llmClient.config;
    document.getElementById('set-endpoint').value = cfg.endpoint || '';
    document.getElementById('set-model').value = cfg.model || '';
    document.getElementById('set-apikey').value = '';
    document.getElementById('set-system-prompt').value = this.persona.customPrompt || '';

    // Check if API key exists
    if (this.llmClient.hasApiKey()) {
      document.getElementById('set-apikey').placeholder = '已设置 (留空不修改)';
    }
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
    }

    // Save behavior toggles
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
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: '喵' }],
          max_tokens: 5,
        }),
      });

      if (resp.ok) {
        resultEl.textContent = '✓ 连接成功';
        resultEl.style.color = '#4caf50';
      } else {
        const err = await resp.text().catch(() => resp.statusText);
        resultEl.textContent = `✗ 连接失败: ${resp.status}`;
        resultEl.style.color = '#f44336';
      }
    } catch (e) {
      resultEl.textContent = `✗ 错误: ${e.message}`;
      resultEl.style.color = '#f44336';
    }
  }
}
