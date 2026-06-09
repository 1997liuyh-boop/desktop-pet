// PetRuntime — 前端运行时边界
// 目标: 页面只依赖这里的能力，Tauri / 浏览器预览差异在这里消化。

(function () {
  const tauri = window.__TAURI__ || null;
  const core = tauri && tauri.core ? tauri.core : null;
  const events = tauri && tauri.event ? tauri.event : null;
  const tauriWindow = tauri && tauri.window ? tauri.window : null;

  const storage = {
    get(key, fallback = null) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (_) {
        return false;
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(key);
      } catch (_) {}
    },
  };

  async function browserCommandFallback(command, args = {}) {
    switch (command) {
      case 'greet':
        return `Hello, ${args.name || 'Browser'}! Desktop Pet preview`;
      case 'get_manifest':
        return loadManifestFallback();
      case 'get_animation_frames': {
        const manifest = await loadManifestFallback();
        const graphType = args.graphType || 'default';
        const lookupGraphType = graphType.startsWith('move.') ? 'move' : graphType;
        const graph = manifest.animations?.[lookupGraphType] || manifest.animations?.default;
        const modes = graph?.[args.mode] || graph?.normal || graph?.happy || {};
        return modes;
      }
      case 'read_png_frames_batch':
        return readPngFramesBatchFallback(args);
      case 'read_png_frame':
        return '';
      case 'get_system_audio_level':
        return 0;
      case 'get_screen_info':
        return { workAreaWidth: window.innerWidth || 500, workAreaHeight: window.innerHeight || 500, scaleFactor: window.devicePixelRatio || 1 };
      case 'get_window_position':
        return { x: 0, y: 0, width: window.innerWidth || 500, height: window.innerHeight || 500 };
      case 'get_cursor_position':
        return null;
      case 'move_window_by':
      case 'set_window_position':
      case 'set_clickthrough':
      case 'quit_app':
      case 'open_chat_window':
      case 'open_settings_window':
      case 'save_stats':
        return null;
      case 'aux_window_visible':
        return false;
      case 'load_stats':
        return storage.get('desktop-pet-stats', null);
      case 'load_llm_config':
        return storage.get('pet-llm-config', {
          endpoint: 'https://api.openai.com/v1/chat/completions',
          api_key: '',
          model: 'gpt-3.5-turbo',
          temperature: 0.8,
          max_tokens: 1024,
          protocol: 'openai',
          persona: null,
          pet_name: '喵喵',
        });
      case 'save_llm_config':
        storage.set('pet-llm-config', args.config || {});
        return null;
      case 'save_llm_api_key':
        if (args.apiKey || args.api_key) {
          storage.set('pet-llm-api-key', args.apiKey || args.api_key);
        }
        return null;
      case 'clear_llm_api_key':
        storage.remove('pet-llm-api-key');
        return null;
      case 'has_llm_api_key':
        return !!storage.get('pet-llm-api-key', '');
      case 'get_persona_presets':
        return [
          { name: '默认', description: '温柔活泼', temperature: 0.8 },
          { name: '元气', description: '更主动热情', temperature: 0.9 },
        ];
      case 'build_persona_prompt':
        return args.customPrompt || `你是一只桌面宠物，当前心情是 ${args.mood || 'normal'}。`;
      case 'get_pet_status':
        return {
          state: 'Idle',
          mood: 'normal',
          graphType: 'default',
          stats: { hunger: 80, thirst: 80, happiness: 80, energy: 80, health: 100, likability: 0, level: 1, exp: 0, money: 0 },
          work: { isActive: false, progress: 0, name: null },
        };
      case 'game_tick':
        return { working: false, mood: 'normal', graphType: 'default', leveledUp: false, workFinished: false };
      case 'walk_tick':
        return { dx: 0, dy: 0, facingRight: true, graphType: 'default', walking: false };
      case 'sidehide_check':
        return { action: 'none' };
      default:
        throw new Error(`当前运行环境不支持 ${command}`);
    }
  }

  async function invoke(command, args = {}, fallback) {
    if (core && typeof core.invoke === 'function') {
      return core.invoke(command, args);
    }
    if (typeof fallback === 'function') return fallback(args);
    if (fallback !== undefined) return fallback;
    return browserCommandFallback(command, args);
  }

  async function loadManifestFallback() {
    const urls = ['../assets/pet-manifest.json', '/assets/pet-manifest.json', 'assets/pet-manifest.json'];
    for (const url of urls) {
      try {
        const resp = await fetch(url, { cache: 'no-store' });
        if (resp.ok) return resp.json();
      } catch (_) {}
    }
    throw new Error('manifest fallback 加载失败');
  }

  async function readPngFramesBatchFallback() {
    return {};
  }

  const runtime = {
    kind: core ? 'tauri' : 'browser',
    isTauri: !!core,
    storage,
    invoke,

    getManifest() {
      return invoke('get_manifest', {}, loadManifestFallback);
    },

    getAnimationFrames(graphType, mode) {
      return invoke('get_animation_frames', { graphType, mode });
    },

    readPngFramesBatch(framePaths) {
      return invoke('read_png_frames_batch', { framePaths }, readPngFramesBatchFallback);
    },

    readPngFrame(framePath) {
      return invoke('read_png_frame', { framePath }, '');
    },

    getPetStatus() {
      return invoke('get_pet_status', {}, null);
    },

    listen(name, handler) {
      if (events && typeof events.listen === 'function') {
        return events.listen(name, handler);
      }
      const domHandler = (event) => handler({ payload: event.detail });
      window.addEventListener(name, domHandler);
      return Promise.resolve(() => window.removeEventListener(name, domHandler));
    },

    emit(name, payload) {
      if (events && typeof events.emit === 'function') {
        return events.emit(name, payload);
      }
      window.dispatchEvent(new CustomEvent(name, { detail: payload }));
      return Promise.resolve();
    },

    currentWindow() {
      if (tauriWindow && typeof tauriWindow.getCurrentWindow === 'function') {
        return tauriWindow.getCurrentWindow();
      }
      if (tauriWindow && typeof tauriWindow.getCurrent === 'function') {
        return tauriWindow.getCurrent();
      }
      return {
        hide: () => Promise.resolve(),
        setTitle: (title) => {
          document.title = title;
          return Promise.resolve();
        },
        setAlwaysOnTop: () => Promise.resolve(),
        cursorPosition: () => Promise.resolve(null),
      };
    },

    cursorPosition(fallback = null) {
      const current = this.currentWindow();
      if (current && typeof current.cursorPosition === 'function') {
        return current.cursorPosition().catch(() => fallback);
      }
      return Promise.resolve(fallback);
    },
  };

  window.PetRuntime = runtime;
})();