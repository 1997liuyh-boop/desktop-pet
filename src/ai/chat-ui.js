// ChatUI - 聊天面板（增强版）
// 支持语气预设和人格编辑

class ChatUI {
  constructor(container, core, llmClient, personaSystem, messageBar) {
    this.container = container;
    this.core = core;
    this.llmClient = llmClient;
    this.persona = personaSystem;
    this.messageBar = messageBar;
    this.isVisible = false;
    this.isThinking = false;
    this.messages = [];
    this.history = [];

    this._createDOM();
    this._setupEvents();
  }

  _createDOM() {
    this.panel = document.createElement('div');
    this.panel.id = 'chat-panel';
    this.panel.className = 'hidden';

    // Header
    const header = document.createElement('div');
    header.id = 'chat-header';
    const preset = this.persona._tonePresets[this.persona.activePreset];
    header.innerHTML = `<span>${preset ? preset.icon : '💬'} 和小橘聊天</span>`;

    this.closeBtn = document.createElement('button');
    this.closeBtn.id = 'chat-close-btn';
    this.closeBtn.textContent = '×';
    this.closeBtn.addEventListener('click', () => this.hide());
    header.appendChild(this.closeBtn);
    this.panel.appendChild(header);

    // Messages area
    this.messagesEl = document.createElement('div');
    this.messagesEl.id = 'chat-messages';
    this.panel.appendChild(this.messagesEl);

    // Thinking indicator
    this.thinkingEl = document.createElement('div');
    this.thinkingEl.id = 'chat-thinking';
    this.thinkingEl.innerHTML = '小橘思考中<span class="dot-anim"></span>';
    this.panel.appendChild(this.thinkingEl);

    // Input row
    const inputRow = document.createElement('div');
    inputRow.id = 'chat-input-row';

    this.inputEl = document.createElement('input');
    this.inputEl.id = 'chat-input';
    this.inputEl.type = 'text';
    this.inputEl.placeholder = '说点什么...';
    this.inputEl.maxLength = 200;
    inputRow.appendChild(this.inputEl);

    this.sendBtn = document.createElement('button');
    this.sendBtn.id = 'chat-send-btn';
    this.sendBtn.textContent = '发送';
    inputRow.appendChild(this.sendBtn);

    this.panel.appendChild(inputRow);
    this.container.appendChild(this.panel);

    this._addWelcomeMessage();
  }

  _addWelcomeMessage() {
    this.history = [];
    this.messagesEl.innerHTML = '';

    const stats = this.core.stats;
    const mood = this.core.mood;
    const recentEvents = this.core.getRecentEventsText();
    const sysPrompt = this.persona.buildPrompt(stats, mood, recentEvents);
    this.history.push({ role: 'system', content: sysPrompt });

    this._addBubble('pet', '喵~主人你好！我是小橘，你的桌面伙伴！有什么想聊的吗？(*´∀`*)');
  }

  _setupEvents() {
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
  }

  show() {
    this.isVisible = true;
    this.panel.classList.remove('hidden');
    this.panel.classList.add('visible');
    if (isElectron()) this._expandWindow();
    this.container.classList.add('chat-open');
    setTimeout(() => this.inputEl.focus(), 300);

    // 更新系统提示词（刷新当前上下文）
    const stats = this.core.stats;
    const mood = this.core.mood;
    const recentEvents = this.core.getRecentEventsText();
    this.history[0] = { role: 'system', content: this.persona.buildPrompt(stats, mood, recentEvents) };
  }

  hide() {
    this.isVisible = false;
    this.panel.classList.add('hidden');
    this.panel.classList.remove('visible');
    if (isElectron()) this._restoreWindow();
    this.container.classList.remove('chat-open');
  }

  toggle() {
    if (this.isVisible) this.hide();
    else this.show();
  }

  _expandWindow() {
    try {
      window.electronAPI.setWindowBounds(undefined, undefined, CHAT_CFG.EXPANDED_WIDTH, CHAT_CFG.EXPANDED_HEIGHT);
    } catch (e) { /* ignore */ }
  }

  _restoreWindow() {
    try {
      window.electronAPI.setWindowBounds(undefined, undefined, CHAT_CFG.BASE_WIDTH, CHAT_CFG.BASE_HEIGHT);
    } catch (e) { /* ignore */ }
  }

  async sendMessage() {
    const text = this.inputEl.value.trim();
    if (!text || this.isThinking) return;

    this.inputEl.value = '';
    this._addBubble('user', text);
    this.history.push({ role: 'user', content: text });

    if (this.history.length > CHAT_CFG.MAX_HISTORY + 1) {
      this.history = [this.history[0], ...this.history.slice(this.history.length - CHAT_CFG.MAX_HISTORY)];
    }

    this.setThinking(true);
    this.core.state = PetState.CHAT;
    this.core.currentGraphType = GraphType.SAY;
    this.core.addEvent('和主人聊天');

    let responseText = '';
    let currentBubble = null;

    await this.llmClient.chat(
      text,
      this.history.slice(1),
      (chunk, index) => {
        responseText += chunk;
        if (index === 0) {
          this.messageBar.appendChunk(chunk);
          currentBubble = this._addBubble('pet', '', true);
        }
        if (currentBubble) {
          currentBubble.textContent = responseText;
          this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        }
      },
      () => {
        this.setThinking(false);
        this.history.push({ role: 'assistant', content: responseText });
        this.messageBar.finishStreaming();
        this.core.state = PetState.IDLE;
        this.core.currentGraphType = GraphType.DEFAULT;
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      },
      (err) => {
        this.setThinking(false);
        this._addBubble('pet', '喵...出错了...' + err.message);
        this.core.state = PetState.IDLE;
        this.core.currentGraphType = GraphType.DEFAULT;
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      }
    );
  }

  _addBubble(role, content, isStreaming = false) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.textContent = content;
    this.messagesEl.appendChild(bubble);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return bubble;
  }

  setThinking(val) {
    this.isThinking = val;
    if (val) {
      this.thinkingEl.classList.add('active');
      this.sendBtn.disabled = true;
      this.inputEl.disabled = true;
    } else {
      this.thinkingEl.classList.remove('active');
      this.sendBtn.disabled = false;
      this.inputEl.disabled = false;
      this.inputEl.focus();
    }
  }
}