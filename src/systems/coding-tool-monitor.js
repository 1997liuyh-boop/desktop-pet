// CodingToolMonitor — 监控 Cursor/Claude Code/Codex/Gemini CLI 运行状态
// 双通道：优先监听 Tauri event（实时推送），fallback 到定时轮询

const CODING_TOOL_POLL_INTERVAL = 5000;
const TOOL_STATUS = {
  NOT_INSTALLED: 'not_installed',
  NOT_RUNNING: 'not_running',
  IDLE: 'idle',
  WORKING: 'working',
  TASK_COMPLETED1: 'task_completed',
};

const COMPLETE_MESSAGES = {
  cursor: [
    '{name}, Cursor 中的任务已经执行完成啦！',
    '主人，Cursor 的任务跑完咯~',
    'Cursor 干完活了喵，去看看吧！',
  ],
  claude_code: [
    '{name}, Claude Code 中的任务已经执行完成啦！',
    'Claude Code 跑完了喵~',
    '主人，Claude Code 那边搞定了！',
  ],
  codex: [
    '{name}, Codex 中的任务已经执行完成啦！',
    'Codex 完成了喵，快去看看！',
    '主人，Codex 的任务结束啦~',
  ],
  gemini: [
    '{name}, Gemini CLI 中的任务已经执行完成啦！',
    'Gemini 那边跑完了喵~',
    '主人，Gemini CLI 的工作搞定了！',
  ],
};

class CodingToolMonitor {
  constructor() {
    this.tools = [];
    this.anyWorking = false;
    this._timer = null;
    this._running = false;
    this._onTaskComplete = null;
    this._onWorkStateChange = null;
    this._prevAnyWorking = false;
    this._eventUnsubscribers = [];
  }

  get isMonitoring() { return this._running; }

  get statusText() {
    if (!this._running) return '未启动监控';
    if (!this.tools.length) return '检测中...';
    const working = this.tools.filter(t => t.status === 'working');
    const running = this.tools.filter(t => t.status === 'idle' || t.status === 'working');
    if (working.length > 0) return `${working.map(t => t.name).join('、')} 正在工作中`;
    if (running.length > 0) return `${running.map(t => t.name).join('、')} 已启动`;
    return '暂无工具运行';
  }

  onTaskComplete(callback) { this._onTaskComplete = callback; }
  onWorkStateChange(callback) { this._onWorkStateChange = callback; }

  start() {
    if (this._running) return;
    this._running = true;

    // 通道1：监听 Tauri event（实时推送，由 Rust 后台线程每3秒 emit）
    this._setupTauriEvents();

    // 通道2：轮询 fallback（浏览器预览模式 或 event 不可用时使用）
    this._poll();
    this._timer = setInterval(() => this._poll(), CODING_TOOL_POLL_INTERVAL);
  }

  stop() {
    this._running = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    // 清理 event 监听
    for (const unsub of this._eventUnsubscribers) {
      try { unsub(); } catch (_) {}
    }
    this._eventUnsubscribers = [];
  }

  /// 监听 Tauri event
  _setupTauriEvents() {
    const runtime = window.PetRuntime;
    if (!runtime || !runtime.listen) return;

    // coding-monitor-snapshot：每3秒推送完整快照
    runtime.listen('coding-monitor-snapshot', (event) => {
      const snapshot = event.payload;
      if (!snapshot) return;
      this._processSnapshot(snapshot);
    }).then(unsub => { if (unsub) this._eventUnsubscribers.push(unsub); });

    // coding-monitor-task-complete：任务完成时立即推送
    runtime.listen('coding-monitor-task-complete', (event) => {
      const completed = event.payload;
      if (!Array.isArray(completed) || completed.length === 0) return;
      if (!this._onTaskComplete) return;
      for (const toolName of completed) {
        const toolId = this._nameToId(toolName);
        const messages = COMPLETE_MESSAGES[toolId] || ['{name}, {tool} 中的任务已经执行完成啦！'];
        const msg = randomChoice(messages).replace('{name}', '主人').replace('{tool}', toolName);
        this._onTaskComplete(toolName, toolId, msg);
      }
    }).then(unsub => { if (unsub) this._eventUnsubscribers.push(unsub); });
  }

  /// 处理快照数据
  _processSnapshot(snapshot) {
    this.tools = snapshot.tools || [];
    this.anyWorking = !!snapshot.any_working;

    // 任务完成通知（从 snapshot 中检测）
    const justCompleted = snapshot.any_just_completed || [];
    if (justCompleted.length > 0 && this._onTaskComplete) {
      for (const toolName of justCompleted) {
        const toolId = this._nameToId(toolName);
        const messages = COMPLETE_MESSAGES[toolId] || ['{name}, {tool} 中的任务已经执行完成啦！'];
        const msg = randomChoice(messages).replace('{name}', '主人').replace('{tool}', toolName);
        this._onTaskComplete(toolName, toolId, msg);
      }
    }

    // 工作状态变化
    if (this.anyWorking !== this._prevAnyWorking) {
      if (this._onWorkStateChange) this._onWorkStateChange(this.anyWorking);
      this._prevAnyWorking = this.anyWorking;
    }
  }

  async _poll() {
    try {
      const snapshot = await this._invoke('coding_tools_poll', {});
      if (snapshot) this._processSnapshot(snapshot);
    } catch (e) {
      console.warn('[CodingToolMonitor] poll error:', e);
    }
  }

  async getStatus() {
    try {
      const tools = await this._invoke('coding_tools_status', {});
      return tools || [];
    } catch (_) {
      return this.tools;
    }
  }

  _nameToId(name) {
    const map = { 'Cursor': 'cursor', 'Claude Code': 'claude_code', 'Codex': 'codex', 'Gemini CLI': 'gemini' };
    return map[name] || name.toLowerCase().replace(/\s+/g, '_');
  }

  async _invoke(command, args) {
    if (window.PetRuntime && typeof window.PetRuntime.invoke === 'function') {
      return window.PetRuntime.invoke(command, args);
    }
    return this._browserFallback(command, args);
  }

  _browserFallback(command, _args) {
    if (command === 'coding_tools_poll') {
      return {
        tools: [
          { id: 'cursor', name: 'Cursor', icon: '🟢', status: 'not_installed', current_task: null, last_completed_at: null },
          { id: 'claude_code', name: 'Claude Code', icon: '🟠', status: 'not_installed', current_task: null, last_completed_at: null },
          { id: 'codex', name: 'Codex', icon: '🔵', status: 'not_installed', current_task: null, last_completed_at: null },
          { id: 'gemini', name: 'Gemini CLI', icon: '🔷', status: 'not_installed', current_task: null, last_completed_at: null },
        ],
        any_working: false,
        any_just_completed: [],
      };
    }
    if (command === 'coding_tools_status') {
      return this.tools.length ? this.tools : this._browserFallback('coding_tools_poll', {}).tools;
    }
    return null;
  }
}