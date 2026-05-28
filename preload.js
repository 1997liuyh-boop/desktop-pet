const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', { dx, dy }),
  setWindowPosition: (x, y) => ipcRenderer.send('set-window-position', { x, y }),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),

  // Window bounds (for resize)
  setWindowBounds: (x, y, width, height) => ipcRenderer.send('set-window-bounds', { x, y, width, height }),
  getWindowBounds: () => ipcRenderer.sendSync('get-window-bounds'),
  getScreenInfo: () => ipcRenderer.sendSync('get-screen-info'),

  // Action from tray/menu
  onAction: (callback) => {
    const handler = (_, action) => callback(action);
    ipcRenderer.on('action', handler);
    return () => ipcRenderer.removeListener('action', handler);
  },

  // LLM Chat (streaming)
  sendChatMessage: (message, history) => ipcRenderer.send('llm-chat', { message, history }),
  abortChat: () => ipcRenderer.send('llm-abort'),
  onStreamChunk: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('llm-stream-chunk', handler);
    return () => ipcRenderer.removeListener('llm-stream-chunk', handler);
  },
  onStreamError: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('llm-stream-error', handler);
    return () => ipcRenderer.removeListener('llm-stream-error', handler);
  },

  // Settings (sync for load)
  loadSettings: () => ipcRenderer.sendSync('load-settings'),
  saveSettings: (settings) => ipcRenderer.send('save-settings', settings),
  setApiKey: (apiKey) => ipcRenderer.send('set-api-key', { apiKey }),
  clearApiKey: () => ipcRenderer.send('clear-api-key'),

  // Stats persistence
  saveStats: (stats) => ipcRenderer.send('save-stats', { stats }),
  loadStats: () => ipcRenderer.sendSync('load-stats'),

  // App path for asset loading
  getAppPath: () => ipcRenderer.sendSync('get-app-path'),
  readAssetFile: (relativePath) => ipcRenderer.sendSync('read-asset-file', relativePath),
  readPngFrame: (framePath) => ipcRenderer.sendSync('read-png-frame', framePath),
});
