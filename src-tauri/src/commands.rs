use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use crate::systems::stats::StatsData;
use crate::ai::persona::PersonaSystem;
use crate::ai::llm_client::{LLMConfig, ChatMessage, chat_stream as llm_chat_stream};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::POINT;
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
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

// ── 动画/帧相�?──

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

fn vup_dir_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = std::env::var("DESKTOP_PET_VUP_DIR") {
        candidates.push(PathBuf::from(path));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("assets").join("vup"));
        candidates.push(resource_dir.join("vup"));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("assets").join("vup"));
    }

    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("assets")
            .join("vup"),
    );

    candidates
}

fn food_dir_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = std::env::var("DESKTOP_PET_FOOD_DIR") {
        candidates.push(PathBuf::from(path));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("assets").join("image").join("food"));
        candidates.push(resource_dir.join("image").join("food"));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("assets").join("image").join("food"));
    }

    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("assets")
            .join("image")
            .join("food"),
    );

    candidates
}

fn looks_like_vup_dir(path: &Path) -> bool {
    path.join("Default").is_dir() && path.join("BDay").is_dir()
}

fn resolve_vup_base(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let candidates = vup_dir_candidates(app);
    for candidate in &candidates {
        if looks_like_vup_dir(candidate) {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "本地 vup 资源目录未找�? {}",
        candidates
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join("; ")
    ))
}

fn food_image_name(frame_path: &str) -> Option<String> {
    let normalized = frame_path.replace('\\', "/");
    let lower = normalized.to_ascii_lowercase();
    let marker = "image/food/";
    let index = lower.find(marker)?;
    let name = &normalized[index + marker.len()..];
    if name.is_empty() || name.contains('/') || name.contains('\\') {
        return None;
    }
    Some(name.to_string())
}

fn read_food_image_raw(app: &tauri::AppHandle, frame_path: &str) -> Option<Result<Vec<u8>, String>> {
    let file_name = food_image_name(frame_path)?;
    let candidates = food_dir_candidates(app);
    for base in &candidates {
        let full = base.join(&file_name);
        if full.is_file() {
            return Some(fs::read(&full).map_err(|e| {
                format!(
                    "读取食物图片失败: {}；资源目�? {}；原�? {}",
                    file_name,
                    base.display(),
                    e
                )
            }));
        }
    }

    Some(Err(format!(
        "本地食物图片未找�? {}；候选目�? {}",
        file_name,
        candidates
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join("; ")
    )))
}

fn read_frame_raw(app: &tauri::AppHandle, frame_path: &str) -> Result<Vec<u8>, String> {
    if let Some(result) = read_food_image_raw(app, frame_path) {
        return result;
    }

    let base = resolve_vup_base(app)?;
    let full = base.join(frame_path);
    fs::read(&full).map_err(|e| {
        format!(
            "读取帧失�? {}；资源根目录: {}；原�? {}",
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

fn move_phase_hint(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    if lower == "a" || lower.starts_with("a_") || lower.ends_with("_a") || lower.contains("_a_") {
        Some("a_start")
    } else if lower == "c" || lower.starts_with("c_") || lower.ends_with("_c") || lower.contains("_c_") {
        Some("c_end")
    } else if lower == "b" || lower.starts_with("b_") || lower.ends_with("_b") || lower.contains("_b_") {
        Some("b_loop")
    } else {
        None
    }
}

fn move_mode_from_dir(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    if lower.contains("poorcondition") || lower.contains("poor_condition") {
        Some("poorcondition")
    } else if lower.contains("nomal") || lower.contains("normal") {
        Some("normal")
    } else if lower.contains("happy") {
        Some("happy")
    } else if lower.contains("ill") {
        Some("ill")
    } else {
        None
    }
}

fn normalize_move_mode(mode: &str) -> &'static str {
    match mode.to_ascii_lowercase().as_str() {
        "happy" => "happy",
        "poorcondition" | "poor_condition" => "poorcondition",
        "ill" => "ill",
        _ => "normal",
    }
}

fn move_mode_preference(mode: &str) -> [&'static str; 4] {
    match normalize_move_mode(mode) {
        "happy" => ["happy", "normal", "poorcondition", "ill"],
        "poorcondition" => ["poorcondition", "normal", "happy", "ill"],
        "ill" => ["ill", "poorcondition", "normal", "happy"],
        _ => ["normal", "happy", "poorcondition", "ill"],
    }
}

#[derive(Debug)]
struct MoveDirCandidate {
    phase: &'static str,
    mode: Option<&'static str>,
    rel_dir: String,
    path: PathBuf,
}

fn dir_has_direct_png(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|entries| {
            entries.filter_map(Result::ok).any(|entry| {
                entry.path().is_file()
                    && entry
                        .file_name()
                        .to_string_lossy()
                        .to_ascii_lowercase()
                        .ends_with(".png")
            })
        })
        .unwrap_or(false)
}

fn collect_move_candidates(
    dir: &Path,
    rel_prefix: &str,
    current_mode: Option<&'static str>,
    current_phase: Option<&'static str>,
    out: &mut Vec<MoveDirCandidate>,
) -> Result<(), String> {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| format!("读取行走资源目录失败 {}: {}", dir.display(), e))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .collect();

    entries.sort_by(|a, b| {
        a.file_name()
            .to_string_lossy()
            .cmp(&b.file_name().to_string_lossy())
    });

    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let rel_dir = if rel_prefix.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_prefix, name)
        };
        let next_mode = move_mode_from_dir(&name).or(current_mode);
        let next_phase = move_phase_hint(&name).or(current_phase);

        if dir_has_direct_png(&path) {
            out.push(MoveDirCandidate {
                phase: next_phase.unwrap_or("b_loop"),
                mode: next_mode,
                rel_dir,
                path,
            });
            continue;
        }

        collect_move_candidates(&path, &rel_dir, next_mode, next_phase, out)?;
    }

    Ok(())
}

fn pick_move_candidate<'a>(
    candidates: &'a [MoveDirCandidate],
    phase: &'static str,
    mode_preference: &[&str],
) -> Option<&'a MoveDirCandidate> {
    for mode in mode_preference {
        if let Some(candidate) = candidates
            .iter()
            .find(|candidate| candidate.phase == phase && candidate.mode == Some(*mode))
        {
            return Some(candidate);
        }
    }

    candidates
        .iter()
        .find(|candidate| candidate.phase == phase && candidate.mode.is_none())
        .or_else(|| candidates.iter().find(|candidate| candidate.phase == phase))
}

fn push_move_dir_frames(
    frames: &mut Vec<serde_json::Value>,
    variant: &str,
    dir_name: &str,
    dir_path: &Path,
) -> Result<(), String> {
    fn collect_png_files(dir: &Path, out: &mut Vec<(String, String)>) -> Result<(), String> {
        let mut entries: Vec<_> = fs::read_dir(dir)
            .map_err(|e| format!("读取行走帧目录失�?{}: {}", dir.display(), e))?
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_file())
            .collect();

        entries.sort_by(|a, b| {
            a.file_name()
                .to_string_lossy()
                .cmp(&b.file_name().to_string_lossy())
        });

        for entry in entries {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.to_ascii_lowercase().ends_with(".png") {
                continue;
            }

            let rel = path
                .file_name()
                .ok_or_else(|| format!("行走帧文件名无效: {}", path.display()))?
                .to_string_lossy()
                .replace('\\', "/");
            out.push((rel, name));
        }

        Ok(())
    }

    let mut files = Vec::new();
    collect_png_files(dir_path, &mut files)?;

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
    _manifest: &serde_json::Value,
    variant: &str,
    mode: &str,
) -> Result<serde_json::Value, String> {
    const ALLOWED: [&str; 6] = [
        "walk.left",
        "walk.right",
        "walk.left.slow",
        "walk.right.slow",
        "walk.left.faster",
        "walk.right.faster",
    ];

    let base = resolve_vup_base(app)?;

    if !ALLOWED.contains(&variant) {
        let dynamic_dir = base.join("MOVE").join(variant);
        if !dynamic_dir.exists() {
            return Err(format!("unsupported move variant: {}", variant));
        }
    }

    let dir = base.join("MOVE").join(variant);
    if !dir.exists() {
        return Err(format!("move variant not found: {}", dir.display()));
    }

    let mut candidates = Vec::new();
    collect_move_candidates(&dir, "", None, None, &mut candidates)?;

    let mode_preference = move_mode_preference(mode);
    let mut a_start = Vec::new();
    let mut b_loop = Vec::new();
    let mut c_end = Vec::new();

    if let Some(candidate) = pick_move_candidate(&candidates, "a_start", &mode_preference) {
        push_move_dir_frames(&mut a_start, variant, &candidate.rel_dir, &candidate.path)?;
    }
    if let Some(candidate) = pick_move_candidate(&candidates, "b_loop", &mode_preference) {
        push_move_dir_frames(&mut b_loop, variant, &candidate.rel_dir, &candidate.path)?;
    }
    if let Some(candidate) = pick_move_candidate(&candidates, "c_end", &mode_preference) {
        push_move_dir_frames(&mut c_end, variant, &candidate.rel_dir, &candidate.path)?;
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
        match get_move_variant_frames(&app, &manifest, variant, &mode) {
            Ok(frames) => return Ok(frames),
            Err(e) => {
                if variant.starts_with("walk.")
                    || variant.starts_with("climb.")
                    || variant.starts_with("crawl.")
                    || variant.starts_with("fall.")
                {
                    return Err(format!("动态动�?'{}' 加载失败: {}", graph_type, e));
                }
                eprintln!("动态行走帧加载失败，回退 move: {}", e);
            }
        }
    }

    let lookup_graph_type = if graph_type.starts_with("move.") { "move" } else { graph_type.as_str() };
    let anims = manifest.get("animations").ok_or("manifest missing 'animations'")?;
    let graph = anims.get(lookup_graph_type)
        .ok_or_else(|| format!("graphType '{}' not found", graph_type))?;
    let mood_data = graph.get(&mode)
        .or_else(|| graph.get("normal"))
        .or_else(|| graph.get("happy"))
        .or_else(|| graph.as_object().and_then(|m| m.values().next()))
        .ok_or_else(|| format!("mode '{}' not found in '{}'", mode, graph_type))?;
    Ok(mood_data.clone())
}

#[tauri::command]
pub fn read_png_frames_batch(
    app: tauri::AppHandle,
    frame_paths: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    use base64::Engine;
    let mut result = std::collections::HashMap::new();
    for path in frame_paths {
        if let Ok(bytes) = read_frame_raw(&app, &path) {
            result.insert(path, base64::engine::general_purpose::STANDARD.encode(&bytes));
        }
    }
    Ok(result)
}

// ── 窗口相关 ──

#[tauri::command]
pub fn get_screen_info(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    let monitor = match window.current_monitor().map_err(|e| e.to_string())? {
        Some(monitor) => monitor,
        None => window.primary_monitor().map_err(|e| e.to_string())?.ok_or("No monitor")?,
    };
    let size = monitor.size();
    let position = monitor.position();
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    Ok(serde_json::json!({
        "screenX": position.x,
        "screenY": position.y,
        "screenWidth": size.width,
        "screenHeight": size.height,
        "workAreaX": work_area.position.x,
        "workAreaY": work_area.position.y,
        "workAreaWidth": work_area.size.width,
        "workAreaHeight": work_area.size.height,
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
pub fn get_cursor_position() -> Result<serde_json::Value, String> {
    unsafe {
        let mut point = POINT::default();
        GetCursorPos(&mut point).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({
            "x": point.x,
            "y": point.y,
            "screen": true,
        }))
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn get_cursor_position() -> Result<serde_json::Value, String> {
    Err("get_cursor_position is only supported on Windows".into())
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

/// 辅助窗口(聊天/设置)是否可见 �?用于暂停 SideHide, 防止聊天时宠物被滑出屏幕
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

/// 切换窗口点击穿�?(透明区域鼠标事件透传到下层窗�?
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
    values[start..].join(", ")
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

// ── LLM 聊天 (流式, 无状�? ──

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

use crate::app_state::AppState;
use crate::core::game_core::PetState;
use crate::core::touch_area::TouchAreaType;
use crate::logic::main_logic::TouchEventType;

/// 命中检�?�?返回点击部位
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

/// 构建前端可读的属�?JSON (VPet 内部字段 �?前端键名映射)
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

    // Hit test before release handling.
    let _ = logic.on_press_start(lx, ly);

    // 处理释放
    let result = logic.on_press_end(press_duration_ms, has_moved, &mut core);

    // Update game state from the touch event.
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
            core.is_dragging = true;
        }
        TouchEventType::DragStart => {
            core.set_state(PetState::Drag);
            core.is_dragging = true;
        }
        TouchEventType::DragEnd => {
            core.set_state(PetState::Idle);
            core.is_dragging = false;
        }
    }

    // Any interaction resets passive mood decay.
    stats.data.mark_interaction();
    core.update_graph_type();

    Ok(serde_json::json!({
        "graphType": result.graph_type_change.unwrap_or(core.current_graph_type.clone()),
        "message": result.message,
        "mood": stats.get_mood(),
        "stats": stats_json(&stats.data),
    }))
}

/// 工作运行态 JSON — 含计时信息, 供前端展示工作/玩耍进行计时
fn work_status_json(work: &crate::systems::work::WorkSystem) -> serde_json::Value {
    serde_json::json!({
        "isActive": work.is_active,
        "progress": work.progress(),
        "name": work.now_work.as_ref().map(|w| w.name.clone()),
        "graph": work.now_work.as_ref().map(|w| w.graph.clone()),
        "type": work.now_work.as_ref().map(|w| format!("{:?}", w.work_type)),
        "elapsedSecs": work.elapsed_secs,
        "durationSecs": work.now_work.as_ref().map(|w| w.duration_secs()).unwrap_or(0.0),
        "getCount": work.get_count,
    })
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
        "work": work_status_json(&work),
    }))
}

/// 喂食 �?随机挑选一份食�? 套用其真实属�?(1:1 复刻 VPet EatFood)
#[tauri::command]
pub fn pet_action_feed(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;
    let mut work = state.work.lock().map_err(|e| e.to_string())?;

    // Manual eating interrupts active work.
    if work.is_active {
        work.stop();
    }

    // Pick a random edible item and apply its real stats.
    let food = crate::systems::food::pick_random("eat")
        .ok_or("no edible food found")?;
    stats.data.eat_food(
        food.exp, food.strength, food.strength_food,
        food.strength_drink, food.feeling, food.health, food.likability,
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

/// 喝水 �?随机挑选一份饮�? 套用其真实属�?(1:1 复刻 VPet EatFood)
#[tauri::command]
pub fn pet_action_drink(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;
    let mut work = state.work.lock().map_err(|e| e.to_string())?;

    // Manual drinking interrupts active work.
    if work.is_active {
        work.stop();
    }

    // Pick a random drink and apply its real stats.
    let food = crate::systems::food::pick_random("drink")
        .ok_or("no drink found")?;
    stats.data.eat_food(
        food.exp, food.strength, food.strength_food,
        food.strength_drink, food.feeling, food.health, food.likability,
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

/// 食物菜单 �?列举所有可�?可喝食物及其属�?(供前端弹窗展�?
#[tauri::command]
pub fn get_food_menu() -> Result<serde_json::Value, String> {
    let items: Vec<serde_json::Value> = crate::systems::food::all_foods()
        .into_iter()
        .map(|f| serde_json::json!({
            "name": f.name,
            "type": f.food_type,
            "graph": f.graph,
            "exp": f.exp,
            "strength": f.strength,
            "strengthDrink": f.strength_drink,
            "strengthFood": f.strength_food,
            "health": f.health,
            "feeling": f.feeling,
            "likability": f.likability,
            "price": f.price,
            "desc": f.desc,
            "image": f.image_rel_path(),
        }))
        .collect();
    Ok(serde_json::json!({ "items": items }))
}

/// Eat the selected food item from the menu.
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
        .ok_or_else(|| format!("food not found: {}", food_name))?;

    // 金币不足时拒绝购买，返回提示而非报错
    if stats.data.money < food.price {
        return Ok(serde_json::json!({
            "canAfford": false,
            "message": format!("not enough coins: need {:.0}, current {:.0}", food.price, stats.data.money),
            "required": food.price,
            "current": stats.data.money,
            "stats": stats_json(&stats.data),
        }));
    }
    // 扣除金币
    stats.data.money -= food.price;

    stats.data.eat_food(
        food.exp, food.strength, food.strength_food,
        food.strength_drink, food.feeling, food.health, food.likability,
    );
    stats.data.mark_interaction();
    core.set_state(PetState::Idle);
    // Medicine uses the eat animation.
    let anim_graph = if food.graph == "medicine" { "eat" } else { food.graph.as_str() };
    core.current_graph_type = anim_graph.into();
    core.set_action_lock(3.0);

    let is_drink = food.graph == "drink";
    let is_medicine = food.graph == "medicine";
    let stat_now = if is_drink { stats.data.strength_drink } else { stats.data.strength_food };
    let (message, bubble) = if is_medicine {
        (
            format!("正在吃药：{} (健康: {:.0})", food.name, stats.data.health),
            format!("吃了{}，快点好起来喵~", food.name),
        )
    } else {
        let verb = if is_drink { "drink" } else { "eat" };
        (
            format!("正在{}{} ({}: {:.0})", verb, food.name, if is_drink {"口渴"} else {"饱腹"}, stat_now),
            format!("{} {}~", if is_drink {"drink"} else {"eat"}, food.name),
        )
    };

    Ok(serde_json::json!({
        "graphType": anim_graph,
        "mood": stats.get_mood(),
        "foodName": food.name,
        "foodImage": food.image_rel_path(),
        "message": message,
        "showBubble": bubble,
        "stats": stats_json(&stats.data),
    }))
}

/// 玩�?�?VPet 中对�?Play 类型工作, 使用工作动画
#[tauri::command]
pub fn pet_action_play(
    play_type: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;
    let mut work = state.work.lock().map_err(|e| e.to_string())?;

    let play_candidates = crate::systems::work::all_works()
        .into_iter()
        .filter(|w| w.work_type == crate::systems::work::WorkType::Play)
        .collect::<Vec<_>>();
    if play_candidates.is_empty() {
        return Err("play work not found".into());
    }

    let play_work = if let Some(graph) = play_type.as_deref().filter(|v| !v.trim().is_empty()) {
        crate::systems::work::find_work(graph)
            .filter(|w| w.work_type == crate::systems::work::WorkType::Play)
            .ok_or_else(|| format!("play item not found: {}", graph))?
    } else {
        let index = ((rand::random::<f64>() * play_candidates.len() as f64).floor() as usize)
            .min(play_candidates.len() - 1);
        play_candidates[index].clone()
    };

    if stats.data.level() < play_work.level_limit {
        return Ok(serde_json::json!({
            "workStarted": false,
            "message": format!("level too low, need Lv.{}", play_work.level_limit),
        }));
    }

    stats.data.play();
    stats.data.mark_interaction();
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
        "workType": "Play",
        "workName": work_name,
        "duration": dur,
        "moneyBase": money_base,
        "message": format!("started {}: {:.0} minutes", work_name, dur / 60.0),
        "stats": stats_json(&stats.data),
    }))
}

/// 睡觉 (手动切换)
#[tauri::command]
pub fn pet_action_sleep(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let work = state.work.lock().map_err(|e| e.to_string())?;

    // Sleeping is disabled while work is active.
    if work.is_active {
        return Ok(serde_json::json!({ "sleepToggled": false, "message": "工作中不能睡觉哦" }));
    }

    // Toggle sleep state.
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
    // pinch 动画: a_start(0.125s) + b_loop(~0.75s×3) + c_end(~0.875s) �?4s
    core.set_action_lock(5.0);

    Ok(serde_json::json!({
        "graphType": "pinch",
        "mood": stats.get_mood(),
        "message": "呜哇! 不要捏我!",
        "stats": stats_json(&stats.data),
    }))
}

/// 开始工�?(可选工作类�?
#[tauri::command]
pub fn pet_action_work(
    work_type: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut work = state.work.lock().map_err(|e| e.to_string())?;
    let stats = state.stats.lock().map_err(|e| e.to_string())?;
    let requested = work_type
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("workone");

    let graph = match requested {
        "work" | "work.copywriting" => "workone",
        "clean" | "work.clean" | "work.cleanScreen" => "workclean",
        "live" | "work.live" => "worktwo",
        "study" | "study.basic" => "study",
        "research" | "study.research" => "studytwo",
        "painting" | "paint" | "study.paint" => "studypaint",
        "calligraphy" | "study.calligraphy" => "calligraphy",
        "play" => "playone",
        other => other,
    };

    let w = crate::systems::work::find_work(graph).ok_or_else(|| format!("未找到该工种: {}", requested))?;
    if stats.data.level() < w.level_limit {
        return Ok(serde_json::json!({
            "workStarted": false,
            "message": format!("level too low, need Lv.{}", w.level_limit),
        }));
    }
    drop(stats);

    let dur = w.duration_secs();
    let money_base = w.money_base;
    let work_type_str = format!("{:?}", w.work_type);
    let work_name = w.name.clone();
    let graph_name = w.graph.clone();
    work.start(w);
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    core.current_graph_type = graph_name.clone();
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
        "message": if was_working { "stopped" } else { "no active task" },
        "stats": stats_json(&stats.data),
    }))
}

/// 获取可选工作类型列�?(来自 VPet 真实工种)
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

/// 游戏时钟推进 (每秒调用一�?
#[tauri::command]
pub fn game_tick(dt_seconds: f64, state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    use crate::systems::work::{WorkingState, WorkType};

    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;
    let mut work = state.work.lock().map_err(|e| e.to_string())?;

    let level_before = stats.data.level();
    let mut completed_work: Option<serde_json::Value> = None;

    // Decrement the action lock.
    core.tick_action_lock(dt_seconds);
    // 累计真实空闲时间 (�?freedrop 心情自然下降)
    stats.data.seconds_since_interaction += dt_seconds;

    // FunctionSpend �?15 秒触发一�? TimePass=0.05 (1:1 复刻 VPet EventTimer)
    stats.data.tick_accumulator += dt_seconds;
    while stats.data.tick_accumulator >= 15.0 {
        stats.data.tick_accumulator -= 15.0;

        // Derive the current working state.
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

        // 生病时停止工�?(对标 VPet: Ill && Work �?Stop)
        if stop_ill && work.is_active {
            work.stop();
            core.set_action_lock(0.0);
            core.set_state(PetState::Idle);
        }
    }

    // Advance active work and settle it when its duration is reached.
    work.advance(dt_seconds);
    if work.is_active {
        if let Some(current) = work.now_work.clone() {
            let duration_secs = current.duration_secs();
            if duration_secs > 0.0 && work.elapsed_secs >= duration_secs {
                let finish_bonus = work.get_count * current.finish_bonus;
                if current.work_type == WorkType::Work {
                    stats.data.money += finish_bonus;
                } else {
                    stats.data.exp += finish_bonus;
                }
                let total_count = work.get_count * (1.0 + current.finish_bonus);
                let unit = if current.work_type == WorkType::Work { "金币" } else { "经验" };
                completed_work = Some(serde_json::json!({
                    "name": current.name,
                    "graphType": current.graph,
                    "type": format!("{:?}", current.work_type),
                    "reward": total_count,
                    "bonus": finish_bonus,
                    "unit": unit,
                    "message": format!("{}完成啦，累计获得 {:.1} {}", current.name, total_count, unit),
                }));
                work.stop();
                core.set_action_lock(0.0);
                core.set_state(PetState::Idle);
                core.current_graph_type = "default".into();
            }
        }
    }

    // 生病自动卧床: 状态为 ill 时切到睡眠动�? 康复后自动唤�?    // (仅影响生病卧�? 不打断用户手动睡�?
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

    // 更新 graph type (工作期间维持该工种专属动�?
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
    let work_json = work_status_json(&work);

    // 自动存档
    drop(core);
    stats.save();

    Ok(serde_json::json!({
        "mood": stats.data.get_mood(),
        "graphType": graph_type,
        "working": working,
        "work": work_json,
        "completedWork": completed_work,
        "stats": stats_json(&stats.data),
        "leveledUp": leveled_up,
    }))
}

fn pick_edge_move_graph(side: &str, speed_px_per_sec: f64) -> String {
    let _ = speed_px_per_sec;
    format!("move.climb.{}", side)
}

/// 自主行走 tick
/// 返回窗口位移�?+ 朝向 + 动画类型
#[tauri::command]
pub fn walk_tick(
    window: tauri::WebviewWindow,
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

    let mood = stats.data.get_mood();
    let (_system_dx, dy) = walk.update(dt_seconds);

    if walk.state == crate::systems::walk::WalkState::Walking {
        walk.speed_px_per_sec = if mood == "poorCondition" || mood == "ill" {
            55.0
        } else if mood == "happy" {
            115.0
        } else {
            80.0
        };
    }

    let raw_dx = if walk.state == crate::systems::walk::WalkState::Walking {
        let pixels = (walk.speed_px_per_sec * dt_seconds).round().max(1.0) as i32;
        if walk.direction > 0.0 { pixels } else { -pixels }
    } else {
        0
    };

    // Controller 边缘检�?+ 弹壁
    let (dx, new_dir) = controller.check_screen_edge(window_x, window_w, screen_w, raw_dx, walk.direction);
    walk.direction = new_dir;

    // 更新朝向
    core.facing_right = walk.direction > 0.0;

    // 使用 VPet 的方�?心情行走资源；非行走时返回闲置子行为
    let edge_hit = raw_dx != 0 && dx != raw_dx;
    let edge_side = if edge_hit {
        Some(if raw_dx > 0 { "right" } else { "left" })
    } else {
        None
    };
    let graph_type = if edge_hit {
        pick_edge_move_graph(edge_side.unwrap_or("left"), walk.speed_px_per_sec)
    } else if walk.state == crate::systems::walk::WalkState::Walking && dx != 0 {
        let direction = if core.facing_right { "right" } else { "left" };
        let speed_suffix = if mood == "poorCondition" || mood == "ill" {
            ".slow"
        } else if mood == "happy" {
            ".faster"
        } else {
            ""
        };
        format!("move.walk.{}{}", direction, speed_suffix)
    } else if walk.state == crate::systems::walk::WalkState::Walking {
        // 切换�? 状态已变为 Walking 但本�?dx=0，保�?default 避免走路动画在移动前闪现
        "default".to_string()
    } else {
        walk.current_graph_type().to_string()
    };
    let edge_move_dy = if edge_hit { -5 } else { 0 };
    let edge_duration_ms = if edge_hit { 3200 } else { 0 };

    if edge_hit {
        walk.reset_to_idle();
        core.current_graph_type = "default".into();
    }

    // 位移直接在 Rust 端应用 — 之前由前端再发一次 move_window_by 才移动,
    // IPC 拥塞时动画继续循环而窗口不动, 表现为"原地跑"
    if dx != 0 || dy != 0 {
        if let Ok(pos) = window.outer_position() {
            let _ = window.set_position(tauri::Position::Physical(
                tauri::PhysicalPosition::new(pos.x + dx, pos.y + dy),
            ));
        }
    }

    Ok(serde_json::json!({
        "dx": dx,
        "dy": dy,
        "facingRight": core.facing_right,
        "graphType": graph_type,
        "walking": walk.state == crate::systems::walk::WalkState::Walking,
        "edgeHit": edge_hit,
        "edgeSide": edge_side,
        "edgeLoop": edge_hit,
        "edgeMoveDy": edge_move_dy,
        "edgeDurationMs": edge_duration_ms,
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

/// 打开设置窗口 (预配置窗�? 居中, 可拖�?
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

/// Position a panel near the pet window without covering it.
fn panel_position_near_pet(
    app: &tauri::AppHandle,
    panel_win: &tauri::WebviewWindow,
    panel_w: i32,
    panel_h: i32,
) {
    use tauri::Manager;
    let Some(pet) = app.get_webview_window("pet") else { return };
    let (Ok(pet_pos), Ok(pet_size)) = (pet.outer_position(), pet.outer_size()) else { return };
    let gap = 12_i32;
    let (screen_w, screen_h) = panel_win
        .available_monitors()
        .ok()
        .and_then(|ms| ms.into_iter().next())
        .map(|m| (m.size().width as i32, m.size().height as i32))
        .unwrap_or((1920, 1080));
    // Prefer the right side, then fall back to the left side.
    let x = if pet_pos.x + pet_size.width as i32 + gap + panel_w <= screen_w {
        pet_pos.x + pet_size.width as i32 + gap
    } else {
        (pet_pos.x - panel_w - gap).max(0)
    };
    let y = pet_pos.y.max(0).min((screen_h - panel_h).max(0));
    let _ = panel_win.set_position(tauri::Position::Physical(
        tauri::PhysicalPosition::new(x, y),
    ));
}

/// 打开食物面板 (宠物旁边定位, 不遮�?
#[tauri::command]
pub fn open_food_panel(app: tauri::AppHandle, filter: Option<String>) -> Result<(), String> {
    use tauri::Manager;

    let win = app.get_webview_window("food-panel").ok_or("Food panel window not found")?;
    panel_position_near_pet(&app, &win, 280, 440);
    // 设置筛选条件并刷新列表 (面板�?hide 而非 destroy, 需手动重新初始�?
    let filter_json = serde_json::to_string(&filter).unwrap_or("null".into());
    let _ = win.eval(&format!(
        "window.__foodFilter = {}; var el=document.getElementById('food-list'); if(el)el.innerHTML=''; var em=document.getElementById('empty-msg'); if(em)em.style.display='none'; if(typeof init==='function')init();",
        filter_json
    ));
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/// 打开工作面板 (宠物旁边定位, 不遮�?
#[tauri::command]
pub fn open_work_panel(app: tauri::AppHandle, kind: Option<String>) -> Result<(), String> {
    use tauri::Manager;

    let win = app.get_webview_window("work-panel").ok_or("Work panel window not found")?;
    panel_position_near_pet(&app, &win, 280, 460);
    // 设置类型并刷新列�?(面板�?hide 而非 destroy, 需手动重新初始�?
    let kind_json = serde_json::to_string(&kind).unwrap_or("\"work\"".into());
    let _ = win.eval(&format!(
        "window.__workKind = {}; var el=document.getElementById('work-list'); if(el)el.innerHTML=''; var em=document.getElementById('empty-msg'); if(em)em.style.display='none'; if(typeof init==='function')init();",
        kind_json
    ));
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/// 打开状态面�?(宠物旁边定位, 不遮�?
#[tauri::command]
pub fn open_status_panel(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let win = app.get_webview_window("status-panel").ok_or("Status panel window not found")?;
    panel_position_near_pet(&app, &win, 280, 420);
    let _ = win.eval("if(typeof load==='function')load();");
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/// 打开 Coding 工具监控面板 (独立窗口, 宠物旁边定位, 不遮挡)
#[tauri::command]
pub fn open_monitor_panel(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let win = app.get_webview_window("monitor-panel").ok_or("Monitor panel window not found")?;
    panel_position_near_pet(&app, &win, 380, 520);
    // 面板是 hide 而非 destroy, 重新打开时手动刷新一次数据
    let _ = win.eval("if(typeof load==='function')load();");
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/// 作弊: 设置等级 (通过调整经验�?
#[tauri::command]
pub fn cheat_set_level(level: i32, state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;
    let target_level = level.max(1).min(999);
    // exp = ((level-1) * 10)^2
    let exp = ((target_level - 1) as f64 * 10.0).powi(2);
    stats.data.exp = exp;
    stats.save();
    Ok(serde_json::json!({ "level": target_level, "exp": exp }))
}

/// 作弊: 强制设置单项属性�?(调试�?
/// stat 可�? health / strength / strength_food / strength_drink / feeling
#[tauri::command]
pub fn cheat_set_stat(stat: String, value: f64, state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;
    let v = value.clamp(0.0, 100.0);
    match stat.as_str() {
        "health"                     => stats.data.health = v,
        "energy" | "strength"        => stats.data.strength = v,
        "hunger" | "strength_food"   => stats.data.strength_food = v,
        "thirst" | "strength_drink"  => stats.data.strength_drink = v,
        "happiness" | "feeling"      => stats.data.feeling = v,
        _ => return Err(format!("unknown stat: {stat}")),
    }
    stats.data.mode = stats.data.get_mood();
    stats.save();
    Ok(serde_json::json!({ "stat": stat, "value": v }))
}

/// 打开聊天窗口 (独立弹窗, 居中)
#[tauri::command]
pub fn open_chat_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let chat = app.get_webview_window("chat").ok_or("Chat window not found")?;
    // 居中显示
    let monitors = chat.available_monitors().map_err(|e| e.to_string())?;
    if let Some(monitor) = monitors.into_iter().next() {
        let m = monitor.size();
        let s = chat.outer_size().map_err(|e| e.to_string())?;
        let x = ((m.width as i32) - (s.width as i32)) / 2;
        let y = ((m.height as i32) - (s.height as i32)) / 2;
        let _ = chat.set_position(tauri::Position::Physical(
            tauri::PhysicalPosition::new(x.max(0), y.max(0)),
        ));
    }

    // Show the pet window and keep it above the chat panel.
    if let Some(pet) = app.get_webview_window("pet") {
        let _ = pet.show();
        let _ = pet.set_always_on_top(true);
    }

    let _ = chat.show();
    let _ = chat.set_focus();

    if let Some(pet) = app.get_webview_window("pet") {
        let _ = pet.set_always_on_top(true);
    }

    Ok(())
}

// ── TTS 语音合成 ──

/// TTS config stored separately from the LLM config.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TtsConfig {
    #[serde(default = "tts_default_endpoint")]
    pub endpoint: String,
    #[serde(default = "tts_default_model")]
    pub model: String,
    /// In voicedesign mode this stores the voice prompt; in preset mode it stores the Voice ID.
    #[serde(default = "tts_default_voice")]
    pub voice: String,
    #[serde(default = "tts_default_style")]
    pub style: String,
}

fn tts_default_endpoint() -> String { "https://api.xiaomimimo.com/v1/chat/completions".into() }
fn tts_default_model()    -> String { "mimo-v2.5-tts-voicedesign".into() }
fn tts_default_voice()    -> String { "16 岁少女感的可爱萝莉音，音色清亮甜美，声音轻盈、有亲近感，像活泼可爱的桌面伙伴在说话".into() }
fn tts_default_style()    -> String { "语速偏轻快，情绪自然灵动，尾音柔和上扬，表达可爱但不过度夸张".into() }

fn normalize_tts_config(mut config: TtsConfig) -> TtsConfig {
    config.endpoint = if config.endpoint.trim().is_empty() {
        tts_default_endpoint()
    } else {
        config.endpoint.trim().to_string()
    };
    config.model = if config.model.trim().is_empty() {
        tts_default_model()
    } else {
        config.model.trim().to_string()
    };
    config.voice = if config.voice.trim().is_empty() {
        tts_default_voice()
    } else {
        config.voice.trim().to_string()
    };
    config.style = if config.style.trim().is_empty() {
        tts_default_style()
    } else {
        config.style.trim().to_string()
    };
    config
}

impl Default for TtsConfig {
    fn default() -> Self {
        Self {
            endpoint: tts_default_endpoint(),
            model:    tts_default_model(),
            voice:    tts_default_voice(),
            style:    tts_default_style(),
        }
    }
}

#[tauri::command]
pub fn save_tts_config(app: tauri::AppHandle, config: TtsConfig) -> Result<(), String> {
    let config = normalize_tts_config(config);
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(data_dir(&app)?.join("tts-config.json"), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_tts_config(app: tauri::AppHandle) -> Result<TtsConfig, String> {
    let path = data_dir(&app)?.join("tts-config.json");
    if !path.exists() { return Ok(TtsConfig::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let config = serde_json::from_str::<TtsConfig>(&content).map_err(|e| e.to_string())?;
    Ok(normalize_tts_config(config))
}

/// Save the TTS API key separately from tts-config.json.
#[tauri::command]
pub fn save_tts_api_key(app: tauri::AppHandle, api_key: String) -> Result<(), String> {
    fs::write(data_dir(&app)?.join("tts-api-key.txt"), api_key).map_err(|e| e.to_string())
}

/// 检查是否已配置 TTS API Key
#[tauri::command]
pub fn has_tts_api_key(app: tauri::AppHandle) -> Result<bool, String> {
    let path = data_dir(&app)?.join("tts-api-key.txt");
    if !path.exists() { return Ok(false); }
    let key = fs::read_to_string(&path).unwrap_or_default();
    Ok(!key.trim().is_empty())
}

/// Call the TTS API and return base64 WAV data.
/// When `sing` is true, switches to `mimo-v2.5-tts` with a preset voice
/// and prepends the `(唱歌)` tag to the synthesis text (required by MiMo TTS).
#[tauri::command]
pub async fn tts_speak(app: tauri::AppHandle, text: String, sing: Option<bool>) -> Result<String, String> {
    let key_path = data_dir(&app)?.join("tts-api-key.txt");
    if !key_path.exists() {
        return Err("TTS API Key not configured".into());
    }
    let api_key = fs::read_to_string(&key_path).map_err(|e| e.to_string())?;
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("TTS API Key 为空".into());
    }

    // Load independent TTS config; use defaults when it does not exist.
    let cfg = {
        let path = data_dir(&app)?.join("tts-config.json");
        if path.exists() {
            let content = fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str::<TtsConfig>(&content).unwrap_or_default()
        } else {
            TtsConfig::default()
        }
    };

    let cfg = normalize_tts_config(cfg);
    let synthesis_text = text.trim();
    if synthesis_text.is_empty() {
        return Err("TTS 文本为空".into());
    }

    let is_sing = sing.unwrap_or(false);

    // Sing mode: must use mimo-v2.5-tts with a preset voice;
    // voicedesign does not support singing.
    let (model, user_content, assistant_content, audio) = if is_sing {
        let tagged = format!("(唱歌){}", synthesis_text);
        let style = cfg.style.trim().to_string();
        ("mimo-v2.5-tts".to_string(), style, tagged,
         serde_json::json!({ "format": "wav", "voice": "冰糖" }))
    } else {
        let is_voice_design = cfg.model.trim() == "mimo-v2.5-tts-voicedesign";
        let uc = if is_voice_design {
            format!("音色设定：{}\n演绎风格：{}", cfg.voice.trim(), cfg.style.trim())
        } else {
            cfg.style.trim().to_string()
        };
        let aud = if is_voice_design {
            serde_json::json!({ "format": "wav", "optimize_text_preview": false })
        } else {
            serde_json::json!({ "format": "wav", "voice": cfg.voice })
        };
        (cfg.model.clone(), uc, synthesis_text.to_string(), aud)
    };

    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "user", "content": user_content },
            { "role": "assistant", "content": assistant_content }
        ],
        "audio": audio
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&cfg.endpoint)
        .header("Content-Type", "application/json")
        .header("api-key", &api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("TTS 请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("TTS API 错误 ({status}): {body_text}"));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("TTS 响应解析失败: {}", e))?;

    json["choices"][0]["message"]["audio"]["data"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("TTS 响应格式异常: {}", json))
}

/// SideHide 边缘隐藏检�?+ 弹出
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

// ── Coding Tools 监控 ──

use crate::systems::coding_tools::{MonitorSnapshot, WatcherEvent};
use std::sync::mpsc;
use tauri::Emitter;

/// 轮询一次 coding 工具状态，返回快照
#[tauri::command]
pub fn coding_tools_poll(state: tauri::State<'_, std::sync::Arc<AppState>>) -> Result<MonitorSnapshot, String> {
    let mut monitor = state.coding_monitor.lock().map_err(|e| e.to_string())?;
    Ok(monitor.poll())
}

/// 获取当前 coding 工具状态（不轮询，只读快照）
#[tauri::command]
pub fn coding_tools_status(state: tauri::State<'_, std::sync::Arc<AppState>>) -> Result<Vec<crate::systems::coding_tools::CodingTool>, String> {
    let monitor = state.coding_monitor.lock().map_err(|e| e.to_string())?;
    Ok(monitor.tools.clone())
}

/// 启动 file watcher + 定时轮询 + Tauri event 推送
/// 这个命令在应用启动时调用一次
#[tauri::command]
pub async fn coding_tools_start_monitor(app: tauri::AppHandle, state: tauri::State<'_, std::sync::Arc<AppState>>) -> Result<String, String> {
    // 创建 watcher 事件的 channel
    let (tx, rx) = mpsc::channel::<WatcherEvent>();
    let tx_arc = Arc::new(Mutex::new(Some(tx)));

    // 启动 file watcher
    {
        let mut monitor = state.coding_monitor.lock().map_err(|e| e.to_string())?;
        monitor.start_watcher(tx_arc);
    }

    // 启动后台线程：接收 watcher 事件 + 定时轮询
    let app_clone = app.clone();
    let state_clone = state.inner().clone();

    std::thread::spawn(move || {
        // watcher 事件处理循环
        loop {
            // 处理 watcher 事件（非阻塞）
            while let Ok(event) = rx.try_recv() {
                if let Ok(mut monitor) = state_clone.coding_monitor.lock() {
                    monitor.on_watcher_event(&event);
                }
            }

            // 执行一轮完整检测
            let snapshot = {
                if let Ok(mut monitor) = state_clone.coding_monitor.lock() {
                    monitor.poll()
                } else {
                    break;
                }
            };

            // 如果有任务完成或有工具在工作，推送事件到前端
            if !snapshot.any_just_completed.is_empty() || snapshot.any_working {
                let _ = app_clone.emit("coding-monitor-update", &snapshot);
            }

            // 即使没有变化也每 5 秒推送一次完整快照（给前端面板刷新用）
            let _ = app_clone.emit("coding-monitor-snapshot", &snapshot);

            std::thread::sleep(Duration::from_secs(5));
        }
    });

    Ok("monitor started".into())
}
