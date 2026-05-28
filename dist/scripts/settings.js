// Settings page JS — 运行在独立设置窗口中
const { invoke } = window.__TAURI__.core;

async function loadConfig() {
  try {
    const config = await invoke('load_llm_config', {});
    document.getElementById('endpoint').value = config.endpoint || '';
    document.getElementById('apiKey').value = config.api_key || '';
    document.getElementById('model').value = config.model || '';
    document.getElementById('temperature').value = String(config.temperature || 0.8);
    document.getElementById('protocol').value = config.protocol || 'openai';

    const presets = await invoke('get_persona_presets', {});
    const personaSelect = document.getElementById('persona');
    personaSelect.innerHTML = '';
    presets.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = `${p.name} — ${p.description}`;
      personaSelect.appendChild(opt);
    });

    // 设定上次保存的人设
    if (config.persona) {
      personaSelect.value = config.persona;
    }
  } catch (e) {
    showStatus('加载配置失败: ' + e, true);
  }
}

async function saveConfig() {
  try {
    const config = {
      endpoint: document.getElementById('endpoint').value,
      api_key: document.getElementById('apiKey').value,
      model: document.getElementById('model').value,
      temperature: parseFloat(document.getElementById('temperature').value || '0.8'),
      max_tokens: 1024,
      protocol: document.getElementById('protocol').value,
      persona: document.getElementById('persona').value,
    };
    await invoke('save_llm_config', { config });
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
  window.__TAURI__.window.getCurrent().close();
});

// 键盘快捷键: Ctrl+S 保存, Escape 关闭
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    saveConfig();
  }
  if (e.key === 'Escape') {
    window.__TAURI__.window.getCurrent().close();
  }
});

loadConfig();