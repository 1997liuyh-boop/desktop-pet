const { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage, globalShortcut, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

let petWindow = null;
let tray = null;
let activeLLMController = null;
let settingsPath = '';
let statsPath = '';

function getSettingsPath() {
  if (!settingsPath) {
    settingsPath = path.join(app.getPath('userData'), 'pet-settings.json');
  }
  return settingsPath;
}

function getStatsPath() {
  if (!statsPath) {
    statsPath = path.join(app.getPath('userData'), 'pet-stats.json');
  }
  return statsPath;
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
  } catch (e) {
    return { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-3.5-turbo' };
  }
}

function saveSettings(settings) {
  try {
    const current = loadSettings();
    const merged = { ...current, ...settings };
    fs.writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2), 'utf-8');
  } catch (e) { /* ignore */ }
}

function createPetWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  petWindow = new BrowserWindow({
    width: 200,
    height: 250,
    x: screenWidth - 250,
    y: screenHeight - 350,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  petWindow.setVisibleOnAllWorkspaces(true);
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.setIgnoreMouseEvents(false);

  petWindow.loadFile('src/index.html');

  petWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      petWindow.hide();
    }
  });

  petWindow.on('blur', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });
}

function createTrayIcon() {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  const setPixel = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    buffer[i] = r; buffer[i + 1] = g; buffer[i + 2] = b; buffer[i + 3] = a;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x - 7.5, cy = y - 6.5;
      const bodyDist = Math.sqrt(cx * cx + cy * cy * 1.3);
      const earL = Math.sqrt((x - 2.5) * (x - 2.5) + (y - 1) * (y - 1) * 2);
      const earR = Math.sqrt((x - 12.5) * (x - 12.5) + (y - 1) * (y - 1) * 2);

      if (earL < 3.5 && y < 5) setPixel(x, y, 255, 152, 0);
      else if (earR < 3.5 && y < 5) setPixel(x, y, 255, 152, 0);
      else if (bodyDist < 6.5) setPixel(x, y, 255, 152, 0);
      else if (bodyDist < 5 && x > 4 && x < 11 && y > 8) setPixel(x, y, 255, 224, 178);
    }
  }
  setPixel(5, 5, 62, 39, 35); setPixel(6, 5, 62, 39, 35);
  setPixel(9, 5, 62, 39, 35); setPixel(10, 5, 62, 39, 35);
  setPixel(7, 8, 255, 138, 128); setPixel(8, 8, 255, 138, 128);

  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏宠物',
      click: () => {
        if (petWindow) {
          petWindow.isVisible() ? petWindow.hide() : petWindow.show();
        }
      },
    },
    {
      label: '聊天',
      click: () => {
        if (petWindow) {
          petWindow.show();
          petWindow.webContents.send('action', 'chat');
        }
      },
    },
    {
      label: '喂食',
      click: () => {
        if (petWindow) petWindow.webContents.send('action', 'feed');
      },
    },
    {
      label: '玩耍',
      click: () => {
        if (petWindow) petWindow.webContents.send('action', 'play');
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('桌面宠物 · 小橘');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (petWindow) {
      petWindow.isVisible() ? petWindow.hide() : petWindow.show();
    }
  });
}

// ==== Settings & Stats IPC ====

ipcMain.on('save-settings', (event, settings) => {
  saveSettings(settings);
});

ipcMain.on('load-settings', (event) => {
  const settings = loadSettings();
  let hasApiKey = false;
  try {
    hasApiKey = !!(settings.encryptedApiKey && settings.encryptedApiKey.length > 0);
  } catch (e) { /* ignore */ }
  event.returnValue = {
    endpoint: settings.endpoint,
    model: settings.model,
    systemPrompt: settings.systemPrompt || '',
    hasApiKey,
  };
});

ipcMain.on('set-api-key', (event, { apiKey }) => {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(apiKey);
      saveSettings({ encryptedApiKey: encrypted.toString('base64') });
    } else {
      saveSettings({ apiKey }); // fallback: plain text (less secure)
    }
  } catch (e) {
    saveSettings({ apiKey });
  }
});

ipcMain.on('clear-api-key', () => {
  saveSettings({ encryptedApiKey: null, apiKey: null });
});

ipcMain.on('save-stats', (event, { stats }) => {
  try {
    fs.writeFileSync(getStatsPath(), JSON.stringify(stats), 'utf-8');
  } catch (e) { /* ignore */ }
});

ipcMain.on('load-stats', (event) => {
  try {
    const raw = fs.readFileSync(getStatsPath(), 'utf-8');
    event.returnValue = JSON.parse(raw);
  } catch (e) {
    event.returnValue = null;
  }
});

// ==== LLM Streaming IPC ====

ipcMain.on('llm-chat', async (event, { message, history }) => {
  const settings = loadSettings();
  let apiKey = '';

  if (settings.encryptedApiKey && safeStorage.isEncryptionAvailable()) {
    try {
      apiKey = safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, 'base64'));
    } catch (e) {
      petWindow.webContents.send('llm-stream-error', { error: 'API Key decryption failed' });
      return;
    }
  } else if (settings.apiKey) {
    apiKey = settings.apiKey;
  } else {
    petWindow.webContents.send('llm-stream-error', { error: 'API Key not configured' });
    return;
  }

  const endpoint = settings.endpoint || 'https://api.openai.com/v1/chat/completions';
  const model = settings.model || 'gpt-3.5-turbo';
  const systemPrompt = settings.systemPrompt || '';

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push(...history);
  messages.push({ role: 'user', content: message });

  activeLLMController = new AbortController();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal: activeLLMController.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      petWindow.webContents.send('llm-stream-error', { error: `API Error (${response.status}): ${errText}` });
      return;
    }

    const reader = response.body.getReader();
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
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        if (data === '[DONE]') {
          petWindow.webContents.send('llm-stream-chunk', { content: '', index: -1, done: true });
          activeLLMController = null;
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            petWindow.webContents.send('llm-stream-chunk', { content, index: index++, done: false });
          }
        } catch (e) { /* skip non-JSON */ }
      }
    }

    // If stream ended without [DONE]
    petWindow.webContents.send('llm-stream-chunk', { content: '', index: -1, done: true });
    activeLLMController = null;
  } catch (err) {
    if (err.name !== 'AbortError') {
      petWindow.webContents.send('llm-stream-error', { error: err.message });
    }
    activeLLMController = null;
  }
});

ipcMain.on('llm-abort', () => {
  if (activeLLMController) {
    activeLLMController.abort();
    activeLLMController = null;
  }
});

// ==== Window IPC ====

ipcMain.on('move-window', (event, { dx, dy }) => {
  if (petWindow) {
    const [x, y] = petWindow.getPosition();
    petWindow.setPosition(x + dx, y + dy);
  }
});

ipcMain.on('set-window-position', (event, { x, y }) => {
  if (petWindow) {
    petWindow.setPosition(Math.round(x), Math.round(y));
  }
});

ipcMain.on('set-window-bounds', (event, { x, y, width, height }) => {
  if (petWindow) {
    if (x !== undefined && y !== undefined) {
      petWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width || 200), height: Math.round(height || 250) });
    }
  }
});

ipcMain.on('get-window-bounds', (event) => {
  if (petWindow) {
    event.returnValue = petWindow.getBounds();
  } else {
    event.returnValue = { x: 0, y: 0, width: 200, height: 250 };
  }
});

ipcMain.on('get-screen-info', (event) => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  event.returnValue = { workAreaWidth: width, workAreaHeight: height };
});

ipcMain.on('get-bounds', (event) => {
  if (petWindow) {
    const bounds = petWindow.getBounds();
    const cursor = screen.getCursorScreenPoint();
    event.returnValue = { ...bounds, cursorX: cursor.x, cursorY: cursor.y };
  }
});

ipcMain.on('set-ignore-mouse', (event, ignore) => {
  if (petWindow) {
    if (ignore) {
      petWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      petWindow.setIgnoreMouseEvents(false);
    }
  }
});

ipcMain.on('show-context-menu', (event) => {
  const menu = Menu.buildFromTemplate([
    {
      label: '喂食',
      click: () => petWindow.webContents.send('action', 'feed'),
    },
    {
      label: '玩耍',
      click: () => petWindow.webContents.send('action', 'play'),
    },
    {
      label: '聊天',
      click: () => petWindow.webContents.send('action', 'chat'),
    },
    {
      label: '睡觉',
      click: () => petWindow.webContents.send('action', 'sleep'),
    },
    { type: 'separator' },
    {
      label: '隐藏宠物',
      click: () => petWindow.hide(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  menu.popup({ window: petWindow });
});

// ==== App lifecycle ====

app.whenReady().then(() => {
  createPetWindow();
  createTray();

  // Global shortcut: Ctrl+Shift+P to toggle pet visibility
  try {
    globalShortcut.register('CommandOrControl+Shift+P', () => {
      if (petWindow) {
        if (petWindow.isVisible()) {
          petWindow.hide();
        } else {
          petWindow.show();
          petWindow.focus();
        }
      }
    });
  } catch (e) { /* shortcut may conflict */ }
});

app.on('window-all-closed', () => {
  // Don't quit - keep running in tray
});

app.on('before-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
});
