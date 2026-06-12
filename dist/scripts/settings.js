// Settings page JS — 运行在独立设置窗口中
const { invoke } = window.PetRuntime;

const TTS_DEFAULT = {
  endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
  model: 'mimo-v2.5-tts-voicedesign',
  voice: '16 岁少女感的可爱萝莉音，音色清亮甜美，声音轻盈、有亲近感，像活泼可爱的桌面伙伴在说话',
  style: '语速偏轻快，情绪自然灵动，尾音柔和上扬，表达可爱但不过度夸张',
};

async function loadConfig() {
  try {
    // 加载 LLM 配置
    const config = await invoke('load_llm_config', {});
    document.getElementById('endpoint').value = config.endpoint || '';
    document.getElementById('apiKey').value = '';
    document.getElementById('model').value = config.model || '';
    document.getElementById('temperature').value = String(config.temperature || 0.8);
    document.getElementById('protocol').value = config.protocol || 'openai';
    document.getElementById('petName').value = config.pet_name || '';

    const hasLlmKey = await invoke('has_llm_api_key', {}).catch(() => false);
    document.getElementById('apiKey').placeholder = hasLlmKey ? '已配置（重新输入可更新）' : 'sk-...';

    const presets = await invoke('get_persona_presets', {});
    const personaSelect = document.getElementById('persona');
    personaSelect.innerHTML = '';
    presets.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = `${p.name} — ${p.description}`;
      personaSelect.appendChild(opt);
    });
    if (config.persona) personaSelect.value = config.persona;

    // 加载 TTS 配置
    const tts = await invoke('load_tts_config', {}).catch(() => ({}));
    document.getElementById('ttsEndpoint').value = tts.endpoint || TTS_DEFAULT.endpoint;
    document.getElementById('ttsModel').value = tts.model || TTS_DEFAULT.model;
    document.getElementById('ttsVoice').value = tts.voice || TTS_DEFAULT.voice;
    document.getElementById('ttsStyle').value = tts.style || TTS_DEFAULT.style;

    const hasTtsKey = await invoke('has_tts_api_key', {}).catch(() => false);
    document.getElementById('ttsApiKey').placeholder = hasTtsKey ? '已配置（重新输入可更新）' : '留空则不启用语音合成';

    // 加载桌宠设置
    await loadPetSettings();
  } catch (e) {
    showStatus('加载配置失败: ' + e, true);
  }
}

function bindRange(id, valId, fmt) {
  const el = document.getElementById(id);
  const valEl = document.getElementById(valId);
  const update = () => { valEl.textContent = fmt(parseFloat(el.value)); };
  el.addEventListener('input', update);
  return update;
}

async function loadPetSettings() {
  try {
    const s = await invoke('get_settings', {}).catch(() => null);
    if (!s) return;
    document.getElementById('scale').value = s.scale ?? 1;
    document.getElementById('opacity').value = s.opacity ?? 1;
    document.getElementById('volume').value = s.volume ?? 1;
    document.getElementById('alwaysOnTop').checked = s.always_on_top !== false;
    document.getElementById('enableMovement').checked = s.enable_movement !== false;
    document.getElementById('enableDataCalc').checked = s.enable_data_calc !== false;
    const pct = (v) => `${Math.round(v * 100)}%`;
    bindRange('scale', 'scaleVal', pct)();
    bindRange('opacity', 'opacityVal', pct)();
    bindRange('volume', 'volumeVal', pct)();
  } catch (_) {}
}

async function savePetSettings() {
  const settings = {
    scale: parseFloat(document.getElementById('scale').value) || 1,
    opacity: parseFloat(document.getElementById('opacity').value) || 1,
    volume: parseFloat(document.getElementById('volume').value),
    always_on_top: document.getElementById('alwaysOnTop').checked,
    enable_movement: document.getElementById('enableMovement').checked,
    enable_auto_buy: false,
    enable_data_calc: document.getElementById('enableDataCalc').checked,
  };
  if (isNaN(settings.volume)) settings.volume = 1;
  await invoke('save_settings', { settings });
}

async function saveConfig() {
  try {
    // 保存 LLM 配置
    const apiKey = document.getElementById('apiKey').value.trim();
    const config = {
      endpoint: document.getElementById('endpoint').value.trim(),
      api_key: '',
      model: document.getElementById('model').value.trim(),
      temperature: parseFloat(document.getElementById('temperature').value || '0.8'),
      max_tokens: 1024,
      protocol: document.getElementById('protocol').value,
      persona: document.getElementById('persona').value,
      pet_name: document.getElementById('petName').value.trim() || '喵喵',
    };
    await invoke('save_llm_config', { config });
    if (apiKey) {
      await invoke('save_llm_api_key', { apiKey });
      document.getElementById('apiKey').value = '';
      document.getElementById('apiKey').placeholder = '已配置（重新输入可更新）';
    }

    // 保存 TTS 配置
    const ttsConfig = {
      endpoint: document.getElementById('ttsEndpoint').value.trim(),
      model: document.getElementById('ttsModel').value.trim(),
      voice: document.getElementById('ttsVoice').value.trim(),
      style: document.getElementById('ttsStyle').value.trim(),
    };
    await invoke('save_tts_config', { config: ttsConfig });

    const ttsApiKey = document.getElementById('ttsApiKey').value.trim();
    if (ttsApiKey) {
      await invoke('save_tts_api_key', { apiKey: ttsApiKey });
      document.getElementById('ttsApiKey').value = '';
      document.getElementById('ttsApiKey').placeholder = '已配置（重新输入可更新）';
    }

    // 保存桌宠设置 (会触发宠物窗口实时应用)
    await savePetSettings();

    showStatus('已保存');
    setTimeout(() => { showStatus(''); }, 2000);
  } catch (e) {
    showStatus('保存失败: ' + e, true);
  }
}

function showStatus(msg, isError) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.style.color = isError ? '#e44' : '#4a4';
}

document.getElementById('btn-save').addEventListener('click', saveConfig);
document.getElementById('btn-close').addEventListener('click', () => {
  window.PetRuntime.currentWindow().hide();
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveConfig(); }
  if (e.key === 'Escape') window.PetRuntime.currentWindow().hide();
});

loadConfig();
