// LLMClient - AI客户端（双路径：Electron IPC / 浏览器 fetch）
// 增强：支持配置导入导出、连接状态通知

class LLMClient {
  constructor() {
    this.config = { endpoint: LLM_DEFAULT.endpoint, model: LLM_DEFAULT.model };
    this.abortController = null;
    this.isStreaming = false;
    this._onChunk = null;
    this._onComplete = null;
    this._onError = null;
    this._statusListeners = [];

    this._loadConfig();
    this._setupIPC();
  }

  _loadConfig() {
    try {
      if (isElectron() && window.electronAPI.loadSettings) {
        const s = window.electronAPI.loadSettings();
        if (s) {
          this.config.endpoint = s.endpoint || LLM_DEFAULT.endpoint;
          this.config.model = s.model || LLM_DEFAULT.model;
        }
      } else {
        const s = loadFromStorage('pet-llm-config');
        if (s) {
          this.config.endpoint = s.endpoint || LLM_DEFAULT.endpoint;
          this.config.model = s.model || LLM_DEFAULT.model;
        }
      }
    } catch (e) { /* use defaults */ }
  }

  _setupIPC() {
    if (!isElectron()) return;
    window.electronAPI.onStreamChunk((data) => {
      if (data.done) {
        this.isStreaming = false;
        this._notifyStatus('ready');
        if (this._onComplete) this._onComplete();
      } else if (this._onChunk) {
        this._onChunk(data.content, data.index);
      }
    });
    window.electronAPI.onStreamError((data) => {
      this.isStreaming = false;
      this._notifyStatus('error');
      if (this._onError) this._onError(new Error(data.error));
    });
  }

  onStatusChange(callback) {
    this._statusListeners.push(callback);
    return () => {
      this._statusListeners = this._statusListeners.filter(cb => cb !== callback);
    };
  }

  _notifyStatus(status) {
    for (const cb of this._statusListeners) {
      try { cb(status); } catch (e) { /* ignore */ }
    }
  }

  async chat(message, history, onChunk, onComplete, onError) {
    this._onChunk = onChunk;
    this._onComplete = onComplete;
    this._onError = onError;

    if (isElectron() && window.electronAPI.sendChatMessage) {
      this.isStreaming = true;
      this._notifyStatus('streaming');
      window.electronAPI.sendChatMessage(message, history);
    } else {
      await this._chatBrowser(message, history, onChunk, onComplete, onError);
    }
  }

  async _chatBrowser(message, history, onChunk, onComplete, onError) {
    const apiKey = loadFromStorage('pet-api-key', '');
    if (!apiKey) {
      onError(new Error('请先在设置中配置API Key'));
      return;
    }

    this.abortController = new AbortController();
    this.isStreaming = true;
    this._notifyStatus('streaming');

    try {
      const resp = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [...history, { role: 'user', content: message }],
          stream: true,
        }),
        signal: this.abortController.signal,
      });

      if (!resp.ok) {
        const err = await resp.text().catch(() => resp.statusText);
        throw new Error(`API Error (${resp.status}): ${err}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let index = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            this.isStreaming = false;
            this._notifyStatus('ready');
            if (onComplete) onComplete();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content && onChunk) onChunk(content, index++);
          } catch (e) { /* skip non-JSON */ }
        }
      }
      this.isStreaming = false;
      this._notifyStatus('ready');
      if (onComplete) onComplete();
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.isStreaming = false;
        this._notifyStatus('error');
        if (onError) onError(err);
      }
    }
  }

  abort() {
    if (isElectron() && window.electronAPI.abortChat) {
      window.electronAPI.abortChat();
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isStreaming = false;
    this._notifyStatus('ready');
  }

  async updateConfig(config) {
    this.config = { ...this.config, ...config };
    if (isElectron() && window.electronAPI.saveSettings) {
      window.electronAPI.saveSettings(config);
    } else {
      saveToStorage('pet-llm-config', this.config);
    }
  }

  async setApiKey(key) {
    if (isElectron() && window.electronAPI.setApiKey) {
      window.electronAPI.setApiKey(key);
    } else {
      saveToStorage('pet-api-key', key);
    }
  }

  async clearApiKey() {
    if (isElectron() && window.electronAPI.clearApiKey) {
      window.electronAPI.clearApiKey();
    } else {
      localStorage.removeItem('pet-api-key');
    }
  }

  hasApiKey() {
    if (isElectron()) {
      const s = window.electronAPI.loadSettings();
      return s && s.hasApiKey;
    }
    return !!loadFromStorage('pet-api-key');
  }

  // 测试连接
  async testConnection(endpoint, model, apiKey) {
    const resp = await fetch(endpoint || this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || this.config.model,
        messages: [{ role: 'user', content: '喵' }],
        max_tokens: 5,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => resp.statusText);
      throw new Error(`${resp.status}: ${err}`);
    }
    return true;
  }
}