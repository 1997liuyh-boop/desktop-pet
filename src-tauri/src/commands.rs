use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use crate::systems::stats::StatsData;
use crate::ai::persona::PersonaSystem;
use crate::ai::llm_client::{LLMConfig, ChatMessage, chat_stream as llm_chat_stream};

#[cfg(target_os = "windows")]
use windows::Win32::Media::Audio::{
    eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
};
#[cfg(target_os = "windows")]
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

// ── 动画/帧相关 ──

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Desktop Pet (Tauri v2)", name)
}

#[tauri::command]
pub fn get_manifest(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let candidates = vec![
        resource_dir.join("assets").join("pet-manifest.json"),
        resource_dir.join("pet-manifest.json"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("assets")
            .join("pet-manifest.json"),
    ];
    load_json_from_candidates(&candidates)
}

fn load_json_from_candidates(paths: &[PathBuf]) -> Result<serde_json::Value, String> {
    let mut errors = Vec::new();

    for path in paths {
        match fs::read_to_string(path) {
            Ok(content) => {
                let content = content.trim_start_matches('\u{FEFF}');
                return serde_json::from_str(content).map_err(|e| e.to_string());
            }
            Err(e) => errors.push(format!("{}: {}", path.display(), e)),
        }
    }

    Err(format!("pet-manifest.json not found: {}", errors.join("; ")))
}

fn resolve_vpet_base(app: &tauri::AppHandle, manifest: &serde_json::Value) -> PathBuf {
    if let Ok(path) = std::env::var("DESKTOP_PET_VPET_BASE") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return candidate;
        }
    }

    if let Some(source) = manifest
        .get("meta")
        .and_then(|meta| meta.get("source"))
        .and_then(|source| source.as_str())
    {
        let candidate = Path::new(source).to_path_buf();
        if candidate.exists() {
            return candidate;
        }
    }

    app.path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
        .join("assets")
        .join("vup")
}

fn read_frame_raw(app: &tauri::AppHandle, frame_path: &str) -> Result<Vec<u8>, String> {
    let manifest = get_manifest(app.clone())?;
    let base = resolve_vpet_base(app, &manifest);
    let full = base.join(frame_path);
    fs::read(&full).map_err(|e| {
        format!(
            "读取帧失败: {}；资源根目录: {}；原因: {}",
            frame_path,
            base.display(),
            e
        )
    })
}

#[tauri::command]
pub fn read_png_frame(
    app: tauri::AppHandle,
    frame_path: String,
) -> Result<String, String> {
    let bytes = read_frame_raw(&app, &frame_path)?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

fn parse_frame_duration_ms(name: &str) -> u64 {
    let stem = name.rsplit_once('.').map(|(left, _)| left).unwrap_or(name);
    stem.rsplit('_')
        .next()
        .and_then(|part| part.parse::<u64>().ok())
        .unwrap_or(125)
}

fn move_phase_from_dir(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.starts_with("a_") || lower.ends_with("_a") || lower.contains("_a_") {
        "a_start"
    } else if lower.starts_with("c_") || lower.ends_with("_c") || lower.contains("_c_") {
        "c_end"
    } else {
        "b_loop"
    }
}

fn push_move_dir_frames(
    frames: &mut Vec<serde_json::Value>,
    variant: &str,
    dir_name: &str,
    dir_path: &Path,
) -> Result<(), String> {
    fn collect_png_files(root: &Path, dir: &Path, out: &mut Vec<(String, String)>) -> Result<(), String> {
        let mut entries: Vec<_> = fs::read_dir(dir)
            .map_err(|e| format!("读取行走帧目录失败 {}: {}", dir.display(), e))?
            .filter_map(Result::ok)
            .collect();

        entries.sort_by(|a, b| {
            a.file_name()
                .to_string_lossy()
                .cmp(&b.file_name().to_string_lossy())
        });

        for entry in entries {
            let path = entry.path();
            if path.is_dir() {
                collect_png_files(root, &path, out)?;
                continue;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            if !name.to_ascii_lowercase().ends_with(".png") {
                continue;
            }

            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            out.push((rel, name));
        }

        Ok(())
    }

    let mut files = Vec::new();
    collect_png_files(dir_path, dir_path, &mut files)?;

    for (rel_path, name) in files {
        let index = frames.len();
        frames.push(serde_json::json!({
            "file": format!("MOVE/{}/{}/{}", variant, dir_name, rel_path),
            "name": name,
            "duration": parse_frame_duration_ms(&name),
            "index": index,
        }));
    }

    Ok(())
}

fn get_move_variant_frames(
    app: &tauri::AppHandle,
    manifest: &serde_json::Value,
    variant: &str,
) -> Result<serde_json::Value, String> {
    const ALLOWED: [&str; 6] = [
        "walk.left",
        "walk.right",
        "walk.left.slow",
        "walk.right.slow",
        "walk.left.faster",
        "walk.right.faster",
    ];

    if !ALLOWED.contains(&variant) {
        let base = resolve_vpet_base(app, manifest);
        let dynamic_dir = base.join("MOVE").join(variant);
        if !dynamic_dir.exists() {
            return Err(format!("unsupported move variant: {}", variant));
        }
    }

    let base = resolve_vpet_base(app, manifest);
    let dir = base.join("MOVE").join(variant);
    if !dir.exists() {
        return Err(format!("move variant not found: {}", dir.display()));
    }

    let mut subdirs: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| format!("读取行走资源目录失败 {}: {}", dir.display(), e))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .collect();

    subdirs.sort_by(|a, b| {
        a.file_name()
            .to_string_lossy()
            .cmp(&b.file_name().to_string_lossy())
    });

    let mut a_start = Vec::new();
    let mut b_loop = Vec::new();
    let mut c_end = Vec::new();

    for entry in subdirs {
        let dir_name = entry.file_name().to_string_lossy().to_string();
        match move_phase_from_dir(&dir_name) {
            "a_start" => push_move_dir_frames(&mut a_start, variant, &dir_name, &entry.path())?,
            "c_end" => push_move_dir_frames(&mut c_end, variant, &dir_name, &entry.path())?,
            _ => push_move_dir_frames(&mut b_loop, variant, &dir_name, &entry.path())?,
        }
    }

    if b_loop.is_empty() {
        b_loop.extend(a_start.clone());
        a_start.clear();
    }

    Ok(serde_json::json!({
        "a_start": a_start,
        "b_loop": b_loop,
        "c_end": c_end,
    }))
}

#[tauri::command]
pub fn get_animation_frames(
    app: tauri::AppHandle,
    graph_type: String,
    mode: String,
) -> Result<serde_json::Value, String> {
    let manifest = get_manifest(app.clone())?;

    if let Some(variant) = graph_type.strip_prefix("move.") {
        match get_move_variant_frames(&app, &manifest, variant) {
            Ok(frames) => return Ok(frames),
            Err(e) => eprintln!("动态行走帧加载失败，回退 move: {}", e),
        }
    }

    let lookup_graph_type = if graph_type.starts_with("move.") { "move" } else { graph_type.as_str() };
    let anims = manifest.get("animations").ok_or("manifest missing 'animations'")?;
    let graph = anims.get(lookup_graph_type)
        .ok_or_else(|| format!("graphType '{}' not found", graph_type))?;
    let mood_data = graph.get(&mode)
        .or_else(|| graph.get("normal"))
        .ok_or_else(|| format!("mode '{}' not found in '{}'", mode, graph_type))?;
    Ok(mood_data.clone())
}

#[tauri::command]
pub fn read_png_frames_batch(
    app: tauri::AppHandle,
    frame_paths: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    use base64::Engine;
    let manifest = get_manifest(app.clone())?;
    let base = resolve_vpet_base(&app, &manifest);
    let mut result = std::collections::HashMap::new();
    for path in frame_paths {
        let full = base.join(&path);
        if let Ok(bytes) = fs::read(&full) {
            result.insert(path, base64::engine::general_purpose::STANDARD.encode(&bytes));
        }
    }
    Ok(result)
}

// ── 窗口相关 ──

#[tauri::command]
pub fn get_screen_info(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    let monitor = window.primary_monitor().map_err(|e| e.to_string())?.ok_or("No monitor")?;
    let size = monitor.size();
    let scale = monitor.scale_factor();
    Ok(serde_json::json!({
        "workAreaWidth": size.width as f64 / scale,
        "workAreaHeight": size.height as f64 / scale,
        "scaleFactor": scale,
    }))
}

#[tauri::command]
pub fn move_window_by(window: tauri::WebviewWindow, dx: i32, dy: i32) -> Result<(), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    window.set_position(tauri::Position::Physical(
        tauri::PhysicalPosition::new(pos.x + dx, pos.y + dy)
    )).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_window_position(window: tauri::WebviewWindow, x: i32, y: i32) -> Result<(), String> {
    window.set_position(tauri::Position::Physical(
        tauri::PhysicalPosition::new(x, y)
    )).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_window_position(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "x": pos.x,
        "y": pos.y,
        "width": size.width,
        "height": size.height,
    }))
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn get_system_audio_level() -> Result<f64, String> {
    unsafe {
        let com_initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let result = (|| -> windows::core::Result<f64> {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let meter: IAudioMeterInformation = device.Activate(CLSCTX_ALL, None)?;
            let peak = meter.GetPeakValue()?;
            Ok(f64::from(peak.clamp(0.0, 1.0)))
        })();
        if com_initialized {
            CoUninitialize();
        }
        result.map_err(|e| e.to_string())
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn get_system_audio_level() -> Result<f64, String> {
    Ok(0.0)
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// 辅助窗口(聊天/设置)是否可见 — 用于暂停 SideHide, 防止聊天时宠物被滑出屏幕
#[tauri::command]
pub fn aux_window_visible(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::Manager;
    for label in ["chat", "settings"] {
        if let Some(win) = app.get_webview_window(label) {
            if win.is_visible().unwrap_or(false) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// 切换窗口点击穿透 (透明区域鼠标事件透传到下层窗口)
#[tauri::command]
pub fn set_clickthrough(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(enabled).map_err(|e| e.to_string())
}

// ── 存档相关 ──

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn save_stats(app: tauri::AppHandle, stats: StatsData) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let json = serde_json::to_string_pretty(&stats).map_err(|e| e.to_string())?;
    fs::write(dir.join("pet-stats.json"), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_stats(app: tauri::AppHandle) -> Result<StatsData, String> {
    let path = data_dir(&app)?.join("pet-stats.json");
    if !path.exists() { return Ok(StatsData::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

// ── LLM 配置 ──

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PetMemory {
    #[serde(default = "default_memory_version")]
    pub version: u32,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub facts: Vec<String>,
    #[serde(default)]
    pub preferences: Vec<String>,
    #[serde(default)]
    pub recent_topics: Vec<String>,
    #[serde(default = "default_affinity")]
    pub affinity: f64,
}

fn default_memory_version() -> u32 { 1 }
fn default_affinity() -> f64 { 50.0 }

impl Default for PetMemory {
    fn default() -> Self {
        Self {
            version: 1,
            updated_at: String::new(),
            facts: Vec::new(),
            preferences: Vec::new(),
            recent_topics: Vec::new(),
            affinity: 50.0,
        }
    }
}

fn sanitize_llm_config(mut config: LLMConfig) -> LLMConfig {
    config.api_key = String::new();
    config
}

fn api_key_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("llm-api-key.txt"))
}

fn trim_recent(mut values: Vec<String>, limit: usize) -> Vec<String> {
    values.retain(|s| !s.trim().is_empty());
    if values.len() > limit {
        values = values.split_off(values.len() - limit);
    }
    values
}

fn normalize_memory(mut memory: PetMemory) -> PetMemory {
    memory.version = 1;
    memory.facts = trim_recent(memory.facts, 20);
    memory.preferences = trim_recent(memory.preferences, 20);
    memory.recent_topics = trim_recent(memory.recent_topics, 12);
    memory.affinity = memory.affinity.clamp(0.0, 100.0);
    memory
}

#[tauri::command]
pub fn save_llm_config(app: tauri::AppHandle, config: LLMConfig) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let safe_config = sanitize_llm_config(config);
    let json = serde_json::to_string_pretty(&safe_config).map_err(|e| e.to_string())?;
    fs::write(dir.join("llm-config.json"), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_llm_config(app: tauri::AppHandle) -> Result<LLMConfig, String> {
    let path = data_dir(&app)?.join("llm-config.json");
    if !path.exists() { return Ok(LLMConfig::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let config: LLMConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(sanitize_llm_config(config))
}

#[tauri::command]
pub fn save_llm_api_key(app: tauri::AppHandle, api_key: String) -> Result<(), String> {
    fs::write(api_key_path(&app)?, api_key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_llm_api_key(app: tauri::AppHandle) -> Result<(), String> {
    let path = api_key_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn has_llm_api_key(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(api_key_path(&app)?.exists())
}

#[tauri::command]
pub fn load_memory(app: tauri::AppHandle) -> Result<PetMemory, String> {
    let path = data_dir(&app)?.join("pet-memory.json");
    if !path.exists() { return Ok(PetMemory::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let memory: PetMemory = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(normalize_memory(memory))
}

#[tauri::command]
pub fn save_memory(app: tauri::AppHandle, memory: PetMemory) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let json = serde_json::to_string_pretty(&normalize_memory(memory)).map_err(|e| e.to_string())?;
    fs::write(dir.join("pet-memory.json"), json).map_err(|e| e.to_string())
}

fn last_items(values: &[String], limit: usize) -> String {
    let start = values.len().saturating_sub(limit);
    values[start..].join("；")
}

#[tauri::command]
pub fn memory_summary(app: tauri::AppHandle) -> Result<String, String> {
    let memory = load_memory(app)?;
    let mut lines = Vec::new();
    if !memory.preferences.is_empty() {
        lines.push(format!("偏好：{}", last_items(&memory.preferences, 5)));
    }
    if !memory.facts.is_empty() {
        lines.push(format!("已知信息：{}", last_items(&memory.facts, 5)));
    }
    if !memory.recent_topics.is_empty() {
        lines.push(format!("最近话题：{}", last_items(&memory.recent_topics, 5)));
    }
    lines.push(format!("亲近度：{}/100", memory.affinity.round() as u32));
    Ok(lines.join("\n"))
}

// ── 人设预设 ──

#[tauri::command]
pub fn get_persona_presets() -> Result<Vec<serde_json::Value>, String> {
    let system = PersonaSystem::new();
    let presets: Vec<serde_json::Value> = system.presets.iter().map(|p| {
        serde_json::json!({
            "name": p.name,
            "description": p.description,
            "temperature": p.temperature,
        })
    }).collect();
    Ok(presets)
}

#[tauri::command]
pub fn build_persona_prompt(
    custom_prompt: Option<String>,
    mood: String,
    hunger: f64,
    happiness: f64,
    is_working: bool,
    memory_summary: Option<String>,
) -> Result<String, String> {
    let system = PersonaSystem::new();
    let custom = custom_prompt.as_deref();
    Ok(system.build_prompt(custom, &mood, hunger, happiness, is_working, memory_summary.as_deref()))
}

// ── LLM 聊天 (流式, 无状态) ──

#[tauri::command]
pub async fn chat_stream(
    app: tauri::AppHandle,
    message: String,
    mut config: LLMConfig,
    system_prompt: String,
    history: Vec<ChatMessage>,
) -> Result<Vec<ChatMessage>, String> {
    if config.api_key.is_empty() {
        let path = api_key_path(&app)?;
        if path.exists() {
            config.api_key = fs::read_to_string(path).map_err(|e| e.to_string())?;
        }
    }
    llm_chat_stream(config, system_prompt, history, message, app).await
}

// ── 交互系统 ──

use std::sync::Arc;
use crate::app_state::AppState;
use crate::core::game_core::PetState;
use crate::core::touch_area::TouchAreaType;
use crate::logic::main_logic::TouchEventType;

/// 命中检测 — 返回点击部位
#[tauri::command]
pub fn hit_test(lx: f64, ly: f64, state: tauri::State<'_, Arc<AppState>>) -> Result<String, String> {
    let logic = state.logic.lock().map_err(|e| e.to_string())?;
    let result = logic.touch_area.hit_test(lx, ly);
    match result.area {
        TouchAreaType::Head => Ok("head".into()),
        TouchAreaType::Body => Ok("body".into()),
        TouchAreaType::None => Ok("none".into()),
    }
}

/// 构建前端可读的属性 JSON (VPet 内部字段 → 前端键名映射)
/// hunger=饱腹 thirst=口渴 happiness=心情 energy=体力
fn stats_json(d: &StatsData) -> serde_json::Value {
    serde_json::json!({
        "hunger": d.strength_food,
        "thirst": d.strength_drink,
        "happiness": d.feeling,
        "energy": d.strength,
        "health": d.health,
        "likability": d.likability,
        "level": d.level(),
        "exp": d.exp,
        "money": d.money,
    })
}

/// 处理交互 (前端调用)
/// press_duration: ms, 0 表示短按, >800 表示长按
#[tauri::command]
pub fn process_interaction(
    lx: f64,
    ly: f64,
    press_duration_ms: f64,
    has_moved: bool,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;
    let mut logic = state.logic.lock().map_err(|e| e.to_string())?;

    // 命中检测
    let _ = logic.on_press_start(lx, ly);

    // 处理释放
    let result = logic.on_press_end(press_duration_ms, has_moved, &mut core);

    // 根据事件类型更新游戏状态
    match result.event {
        TouchEventType::HeadClick => {
            core.set_state(PetState::Idle);
            stats.data.play();
            stats.data.add_likability(1.0);
        }
        TouchEventType::BodyClick => {
            core.set_state(PetState::Idle);
            stats.data.add_likability(0.5);
        }
        TouchEventType::LongPress => {
            core.set_state(PetState::Drag);
        }
        TouchEventType::DragStart => {
            core.is_dragging = true;
        }
        TouchEventType::DragEnd => {
            core.is_dragging = false;
        }
    }

    // 任何交互都重置心情自然下降计时
    stats.data.mark_interaction();
    core.update_graph_type();

    Ok(serde_json::json!({
        "graphType": result.graph_type_change.unwrap_or(core.current_graph_type.clone()),
        "message": result.message,
        "mood": stats.get_mood(),
        "stats": stats_json(&stats.data),
    }))
}

/// 获取宠物当前状态
#[tauri::command]
pub fn get_pet_status(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let core = state.core.lock().map_err(|e| e.to_string())?;
    let stats = state.stats.lock().map_err(|e| e.to_string())?;
    let work = state.work.lock().map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "state": format!("{:?}", core.state),
        "mood": stats.get_mood(),
        "graphType": core.current_graph_type,
        "stats": stats_json(&stats.data),
        "work": {
            "isActive": work.is_active,
            "progress": work.progress(),
            "name": work.now_work.as_ref().map(|w| w.name.clone()),
        },
    }))
}

/// 喂食 — 随机挑选一份食物, 套用其真实属性 (1:1 复刻 VPet EatFood)
#[tauri::command]
pub fn pet_action_feed(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;
    let mut work = state.work.lock().map_err(|e| e.to_string())?;

    // 手动吃喝优先级高于工作：中断当前工作，动作结束后回到待机。
    if work.is_active {
        work.stop();
    }

    // 随机挑一份可吃食物, 取其真实属性
    let food = crate::systems::food::pick_random("eat")
        .ok_or("未找到可吃食物")?;
    stats.data.eat_food(
        food.exp, food.strength, food.strength_food,
        food.strength_drink, food.feeling, food.health, 0.0,
    );
    stats.data.mark_interaction();
    core.set_state(PetState::Idle);
    core.current_graph_type = "eat".into();
    core.set_action_lock(3.0);

    Ok(serde_json::json!({
        "graphType": "eat",
        "mood": stats.get_mood(),
        "foodName": food.name,
        "foodImage": food.image_rel_path(),
        "message": format!("正在吃{} (饱腹: {:.0})", food.name, stats.data.strength_food),
        "showBubble": format!("好吃的{}~", food.name),
        "stats": stats_json(&stats.data),
    }))
}

/// 喝水 — 随机挑选一份饮料, 套用其真实属性 (1:1 复刻 VPet EatFood)
#[tauri::command]
pub fn pet_action_drink(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;
    let mut work = state.work.lock().map_err(|e| e.to_string())?;

    // 手动吃喝优先级高于工作：中断当前工作，动作结束后回到待机。
    if work.is_active {
        work.stop();
    }

    // 随机挑一份饮料, 取其真实属性
    let food = crate::systems::food::pick_random("drink")
        .ok_or("未找到可喝饮料")?;
    stats.data.eat_food(
        food.exp, food.strength, food.strength_food,
        food.strength_drink, food.feeling, food.health, 0.0,
    );
    stats.data.mark_interaction();
    core.set_state(PetState::Idle);
    core.current_graph_type = "drink".into();
    core.set_action_lock(3.0);

    Ok(serde_json::json!({
        "graphType": "drink",
        "mood": stats.get_mood(),
        "foodName": food.name,
        "foodImage": food.image_rel_path(),
        "message": format!("正在喝{} (口渴: {:.0})", food.name, stats.data.strength_drink),
        "showBubble": format!("好喝的{}~", food.name),
        "stats": stats_json(&stats.data),
    }))
}

/// 食物菜单 — 列举所有可吃/可喝食物及其属性 (供前端弹窗展示)
#[tauri::command]
pub fn get_food_menu() -> Result<serde_json::Value, String> {
    let items: Vec<serde_json::Value> = crate::systems::food::all_foods()
        .into_iter()
        .map(|f| serde_json::json!({
            "name": f.name,
            "graph": f.graph,
            "exp": f.exp,
            "strength": f.strength,
            "strengthDrink": f.strength_drink,
            "strengthFood": f.strength_food,
            "health": f.health,
            "feeling": f.feeling,
            "price": f.price,
            "image": f.image_rel_path(),
        }))
        .collect();
    Ok(serde_json::json!({ "items": items }))
}

/// 吃指定名字的食物 — 套用其真实属性 (1:1 复刻 VPet EatFood), 供菜单点选
#[tauri::command]
pub fn pet_action_eat(
    food_name: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;
    let mut work = state.work.lock().map_err(|e| e.to_string())?;

    if work.is_active {
        work.stop();
    }

    let food = crate::systems::food::find_food(&food_name)
        .ok_or_else(|| format!("未找到食物: {}", food_name))?;
    stats.data.eat_food(
        food.exp, food.strength, food.strength_food,
        food.strength_drink, food.feeling, food.health, 0.0,
    );
    stats.data.mark_interaction();
    core.set_state(PetState::Idle);
    core.current_graph_type = food.graph.clone();
    core.set_action_lock(3.0);

    let is_drink = food.graph == "drink";
    let stat_now = if is_drink { stats.data.strength_drink } else { stats.data.strength_food };
    let verb = if is_drink { "喝" } else { "吃" };

    Ok(serde_json::json!({
        "graphType": food.graph,
        "mood": stats.get_mood(),
        "foodName": food.name,
        "foodImage": food.image_rel_path(),
        "message": format!("正在{}{} ({}: {:.0})", verb, food.name, if is_drink {"口渴"} else {"饱腹"}, stat_now),
        "showBubble": format!("好{}的{}~", if is_drink {"喝"} else {"吃"}, food.name),
        "stats": stats_json(&stats.data),
    }))
}

/// 玩耍 — VPet 中对应 Play 类型工作, 使用工作动画
#[tauri::command]
pub fn pet_action_play(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;
    let mut work = state.work.lock().map_err(|e| e.to_string())?;

    stats.data.play();
    stats.data.mark_interaction();
    // 菜单玩耍优先展示 VPet 已有 Play 动画变体，而不是低等级时固定 playone
    let play_candidates = crate::systems::work::all_works()
        .into_iter()
        .filter(|w| w.work_type == crate::systems::work::WorkType::Play)
        .collect::<Vec<_>>();
    if play_candidates.is_empty() {
        return Err("未找到玩耍工种".into());
    }
    let index = ((rand::random::<f64>() * play_candidates.len() as f64).floor() as usize)
        .min(play_candidates.len() - 1);
    let play_work = play_candidates[index].clone();
    let dur = play_work.duration_secs();
    let work_name = play_work.name.clone();
    let graph_name = play_work.graph.clone();
    let money_base = play_work.money_base;
    work.start(play_work);
    core.current_graph_type = graph_name.clone();
    core.set_action_lock(dur + 10.0);
    core.set_state(PetState::Idle);

    Ok(serde_json::json!({
        "graphType": graph_name,
        "mood": stats.get_mood(),
        "workStarted": true,
        "workName": work_name,
        "duration": dur,
        "moneyBase": money_base,
        "message": format!("开始{}! 收益进经验, 时长 {:.0} 分钟", work_name, dur / 60.0),
        "stats": stats_json(&stats.data),
    }))
}

/// 睡觉 (手动切换)
#[tauri::command]
pub fn pet_action_sleep(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let work = state.work.lock().map_err(|e| e.to_string())?;

    // 工作中不能睡觉
    if work.is_active {
        return Ok(serde_json::json!({ "sleepToggled": false, "message": "工作中不能睡觉哦" }));
    }

    // 切换睡眠状态
    if core.state == PetState::Sleep {
        core.set_state(PetState::Idle);
        core.current_graph_type = "default".into();
        Ok(serde_json::json!({ "sleepToggled": true, "isSleeping": false, "graphType": "default" }))
    } else {
        core.set_state(PetState::Sleep);
        core.current_graph_type = "sleep".into();
        core.set_action_lock(3.0);
        Ok(serde_json::json!({ "sleepToggled": true, "isSleeping": true, "graphType": "sleep" }))
    }
}

/// 捏合交互 (Pinch)
#[tauri::command]
pub fn pet_action_pinch(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;

    stats.data.pinch();
    stats.data.mark_interaction();
    core.current_graph_type = "pinch".into();
    // pinch 动画: a_start(0.125s) + b_loop(~0.75s×3) + c_end(~0.875s) ≈ 4s
    core.set_action_lock(5.0);

    Ok(serde_json::json!({
        "graphType": "pinch",
        "mood": stats.get_mood(),
        "message": "呜哇! 不要捏我!",
        "stats": stats_json(&stats.data),
    }))
}

/// 开始工作 (可选工作类型)
#[tauri::command]
pub fn pet_action_work(
    work_type: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut work = state.work.lock().map_err(|e| e.to_string())?;
    let stats = state.stats.lock().map_err(|e| e.to_string())?;
    // work_type 映射到具体工种图名
    let graph = match work_type.as_deref() {
        Some("study") => "study",
        Some("clean") => "workclean",
        Some("painting") => "studypaint",
        Some("play") => "playone",
        _ => "workone",
    };
    let w = crate::systems::work::find_work(graph).ok_or("未找到该工种")?;
    // 等级限制检查 (对标 VPet StartWork)
    if stats.data.level() < w.level_limit {
        return Ok(serde_json::json!({
            "workStarted": false,
            "message": format!("等级不足, 需要 Lv.{}", w.level_limit),
        }));
    }
    drop(stats);
    let dur = w.duration_secs();
    let money_base = w.money_base;
    let work_type_str = format!("{:?}", w.work_type);
    let work_name = w.name.clone();
    // 使用该工种专属动画图名 (study / workone / workclean ...)
    let graph_name = w.graph.clone();
    work.start(w);
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    core.current_graph_type = graph_name.clone();
    // 工作期间由 game_tick 维持工作动画; action_lock 只保护初始几秒不被 walk 打断
    core.set_action_lock(5.0);
    core.set_state(PetState::Idle);
    Ok(serde_json::json!({
        "workStarted": true,
        "graphType": graph_name,
        "workType": work_type_str,
        "workName": work_name,
        "duration": dur,
        "moneyBase": money_base,
    }))
}

/// 停止当前工作/学习/玩耍，恢复默认动画
#[tauri::command]
pub fn pet_action_stop_work(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut work = state.work.lock().map_err(|e| e.to_string())?;
    let was_working = work.is_active;
    work.stop();

    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    core.set_action_lock(0.0);
    core.set_state(PetState::Idle);
    core.current_graph_type = "default".into();

    let stats = state.stats.lock().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "stopped": was_working,
        "working": false,
        "graphType": "default",
        "mood": stats.get_mood(),
        "message": if was_working { "已停止" } else { "当前没有进行中的任务" },
        "stats": stats_json(&stats.data),
    }))
}

/// 获取可选工作类型列表 (来自 VPet 真实工种)
#[tauri::command]
pub fn get_work_types() -> Result<Vec<serde_json::Value>, String> {
    let works = crate::systems::work::all_works();
    Ok(works
        .iter()
        .map(|w| {
            serde_json::json!({
                "name": w.name,
                "graph": w.graph,
                "type": format!("{:?}", w.work_type),
                "moneyBase": w.money_base,
                "levelLimit": w.level_limit,
                "timeMinutes": w.time_minutes,
                "finishBonus": w.finish_bonus,
            })
        })
        .collect())
}

/// 游戏时钟推进 (每秒调用一次)
#[tauri::command]
pub fn game_tick(dt_seconds: f64, state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    use crate::systems::work::WorkingState;

    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;
    let mut work = state.work.lock().map_err(|e| e.to_string())?;

    let level_before = stats.data.level();

    // 递减动作锁
    core.tick_action_lock(dt_seconds);
    // 累计真实空闲时间 (供 freedrop 心情自然下降)
    stats.data.seconds_since_interaction += dt_seconds;

    // FunctionSpend 每 15 秒触发一次, TimePass=0.05 (1:1 复刻 VPet EventTimer)
    stats.data.tick_accumulator += dt_seconds;
    while stats.data.tick_accumulator >= 15.0 {
        stats.data.tick_accumulator -= 15.0;

        // 推导当前工作态
        let working_state = if work.is_active {
            WorkingState::Work
        } else if core.state == PetState::Sleep {
            WorkingState::Sleep
        } else {
            WorkingState::Nomal
        };

        let (get_count_add, stop_ill) = {
            let nw = work.now_work.as_ref();
            stats.data.function_spend(0.05, working_state, nw)
        };
        work.get_count += get_count_add;

        // 生病时停止工作 (对标 VPet: Ill && Work → Stop)
        if stop_ill && work.is_active {
            work.stop();
            core.set_action_lock(0.0);
            core.set_state(PetState::Idle);
        }
    }

    // 工作计时只累计运行时间；收益/消耗仍由 FunctionSpend 周期处理。
    work.advance(dt_seconds);

    // 生病自动卧床: 状态为 ill 时切到睡眠动画; 康复后自动唤醒
    // (仅影响生病卧床, 不打断用户手动睡觉)
    if core.action_lock_remaining <= 0.0 && !work.is_active {
        let mood = stats.data.get_mood();
        if mood == "ill" && core.state != PetState::Sleep {
            core.set_state(PetState::Sleep);
            core.ill_sleep = true;
        } else if core.ill_sleep && mood != "ill" {
            core.set_state(PetState::Idle);
            core.ill_sleep = false;
        }
    }

    // 更新 graph type (工作期间维持该工种专属动画)
    core.mood = stats.data.get_mood();
    if work.is_active {
        core.current_graph_type = work
            .now_work
            .as_ref()
            .map(|w| w.graph.clone())
            .unwrap_or_else(|| "workone".into());
    } else {
        core.update_graph_type();
    }
    let graph_type = core.current_graph_type.clone();
    let working = work.is_active;
    let leveled_up = stats.data.level() > level_before;

    // 自动存档
    drop(core);
    stats.save();

    Ok(serde_json::json!({
        "mood": stats.data.get_mood(),
        "graphType": graph_type,
        "working": working,
        "stats": stats_json(&stats.data),
        "leveledUp": leveled_up,
    }))
}

fn pick_edge_move_graph(side: &str, speed_px_per_sec: f64) -> String {
    let roll = rand::random::<f64>();
    let family = if speed_px_per_sec >= 110.0 {
        if roll < 0.45 { "fall" } else if roll < 0.75 { "crawl" } else if roll < 0.9 { "climb.top" } else { "climb" }
    } else if speed_px_per_sec <= 65.0 {
        if roll < 0.55 { "crawl" } else if roll < 0.85 { "climb" } else { "climb.top" }
    } else if roll < 0.45 {
        "climb"
    } else if roll < 0.75 {
        "climb.top"
    } else {
        "crawl"
    };
    format!("move.{}.{}", family, side)
}

/// 自主行走 tick
/// 返回窗口位移量 + 朝向 + 动画类型
#[tauri::command]
pub fn walk_tick(
    dt_seconds: f64,
    window_x: i32,
    _window_y: i32,
    window_w: i32,
    _window_h: i32,
    screen_w: i32,
    _screen_h: i32,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut walk = state.walk.lock().map_err(|e| e.to_string())?;
    let controller = state.controller.lock().map_err(|e| e.to_string())?;
    let work = state.work.lock().map_err(|e| e.to_string())?;
    let stats = state.stats.lock().map_err(|e| e.to_string())?;

    // 如果正在被拖拽或工作中，跳过自主行走
    if core.is_dragging || work.is_active {
        return Ok(serde_json::json!({ "dx": 0, "dy": 0, "facingRight": core.facing_right, "graphType": core.current_graph_type }));
    }

    let (raw_dx, dy) = walk.update(dt_seconds);

    // Controller 边缘检测 + 弹壁
    let (dx, new_dir) = controller.check_screen_edge(window_x, window_w, screen_w, raw_dx, walk.direction);
    walk.direction = new_dir;

    // 更新朝向
    core.facing_right = walk.direction > 0.0;

    // 使用 VPet 的方向/速度/状态行走资源；非行走时返回闲置子行为
    let mood = stats.data.get_mood();
    let edge_hit = raw_dx != 0 && dx != raw_dx;
    let graph_type = if edge_hit {
        let side = if raw_dx > 0 { "right" } else { "left" };
        pick_edge_move_graph(side, walk.speed_px_per_sec)
    } else if walk.state == crate::systems::walk::WalkState::Walking {
        let direction = if core.facing_right { "right" } else { "left" };
        let speed_suffix = if mood == "poorCondition" || mood == "ill" || walk.speed_px_per_sec <= 65.0 {
            ".slow"
        } else if walk.speed_px_per_sec >= 110.0 {
            ".faster"
        } else {
            ""
        };
        format!("move.walk.{}{}", direction, speed_suffix)
    } else {
        walk.current_graph_type().to_string()
    };

    Ok(serde_json::json!({
        "dx": dx,
        "dy": dy,
        "facingRight": core.facing_right,
        "graphType": graph_type,
        "walking": walk.state == crate::systems::walk::WalkState::Walking,
        "edgeHit": edge_hit,
        "speedPxPerSec": walk.speed_px_per_sec,
    }))
}

#[tauri::command]
pub fn reset_walk_state(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut walk = state.walk.lock().map_err(|e| e.to_string())?;

    walk.reset_to_idle();
    core.set_action_lock(0.0);
    core.set_state(PetState::Idle);
    core.current_graph_type = "default".into();

    Ok(serde_json::json!({
        "graphType": "default",
        "walking": false,
    }))
}

/// 打开设置窗口 (预配置窗口, 居中, 可拖动)
#[tauri::command]
pub fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    Err("Settings window not found".into())
}

/// 打开聊天窗口 (独立弹窗)
#[tauri::command]
pub fn open_chat_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let chat = app.get_webview_window("chat").ok_or("Chat window not found")?;

    // 将聊天窗口摆到宠物旁边 (而非屏幕正中), 修复"位置错误"
    if let Some(pet) = app.get_webview_window("pet") {
        if let (Ok(pet_pos), Ok(pet_size), Ok(chat_size)) =
            (pet.outer_position(), pet.outer_size(), chat.outer_size())
        {
            // 默认放到宠物左侧; 若左侧空间不足则放右侧
            let gap = 8i32;
            let mut x = pet_pos.x - chat_size.width as i32 - gap;
            if x < 0 {
                x = pet_pos.x + pet_size.width as i32 + gap;
            }
            // 垂直方向与宠物顶部对齐, 不低于 0
            let y = pet_pos.y.max(0);
            let _ = chat.set_position(tauri::Position::Physical(
                tauri::PhysicalPosition::new(x, y),
            ));
        }
    }

    // 重新显示并置顶宠物窗口，防止聊天窗口打开后宠物被覆盖或保持隐藏
    if let Some(pet) = app.get_webview_window("pet") {
        let _ = pet.show();
        let _ = pet.set_always_on_top(true);
    }

    let _ = chat.show();
    let _ = chat.set_focus();

    // 聊天窗口拿到焦点后再置顶一次宠物，保持桌宠可见
    if let Some(pet) = app.get_webview_window("pet") {
        let _ = pet.set_always_on_top(true);
    }

    Ok(())
}

/// SideHide 边缘隐藏检测 + 弹出
#[tauri::command]
pub fn sidehide_check(
    window_x: i32,
    _window_y: i32,
    window_w: i32,
    _window_h: i32,
    screen_w: i32,
    _screen_h: i32,
    mouse_screen_x: i32,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut controller = state.controller.lock().map_err(|e| e.to_string())?;

    use crate::core::controller::SideHideState;

    let new_state = controller.check_side_hide(window_x, window_w, screen_w);

    match new_state {
        SideHideState::HiddenLeft if controller.side_hide != SideHideState::HiddenLeft => {
            controller.side_hide = SideHideState::HiddenLeft;
            core.is_side_hidden = true;
            let target_x = -(window_w as i32) + 30;
            Ok(serde_json::json!({
                "action": "hide",
                "side": "left",
                "targetX": target_x,
                "graphType": "sidehide_left_main"
            }))
        }
        SideHideState::HiddenRight if controller.side_hide != SideHideState::HiddenRight => {
            controller.side_hide = SideHideState::HiddenRight;
            core.is_side_hidden = true;
            let target_x = screen_w - 30;
            Ok(serde_json::json!({
                "action": "hide",
                "side": "right",
                "targetX": target_x,
                "graphType": "sidehide_right_main"
            }))
        }
        SideHideState::None if core.is_side_hidden => {
            controller.side_hide = SideHideState::None;
            core.is_side_hidden = false;
            Ok(serde_json::json!({ "action": "rise", "side": "none" }))
        }
        _ => {
            if let Some(target_x) = controller.get_rise_target(window_x, window_w, screen_w, mouse_screen_x) {
                controller.side_hide = SideHideState::None;
                core.is_side_hidden = false;
                let side = if target_x < 100 { "left" } else { "right" };
                Ok(serde_json::json!({
                    "action": "rise",
                    "side": side,
                    "targetX": target_x,
                    "graphType": if side == "left" { "sidehide_left_rise" } else { "sidehide_right_rise" }
                }))
            } else {
                Ok(serde_json::json!({ "action": "none" }))
            }
        }
    }
}