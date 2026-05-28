use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use crate::systems::stats::StatsData;
use crate::ai::persona::PersonaSystem;
use crate::ai::llm_client::{LLMConfig, ChatMessage, chat_stream as llm_chat_stream};

// ── 动画/帧相关 ──

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Desktop Pet (Tauri v2)", name)
}

#[tauri::command]
pub fn get_manifest(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let resource_path = app.path().resource_dir()
        .map_err(|e| e.to_string())?
        .join("assets")
        .join("pet-manifest.json");
    load_json_or_dev_fallback(&resource_path)
}

fn load_json_or_dev_fallback(resource_path: &PathBuf) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(resource_path)
        .unwrap_or_else(|_| {
            let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("assets")
                .join("pet-manifest.json");
            fs::read_to_string(&dev_path).unwrap_or_default()
        });
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_png_frame(
    frame_path: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let loader = state.pet_loader.lock().map_err(|e| e.to_string())?;
    let bytes = loader.read_frame_raw(&frame_path)?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
pub fn get_animation_frames(
    app: tauri::AppHandle,
    graph_type: String,
    mode: String,
) -> Result<serde_json::Value, String> {
    let manifest = get_manifest(app)?;
    let anims = manifest.get("animations").ok_or("manifest missing 'animations'")?;
    let graph = anims.get(&graph_type)
        .ok_or_else(|| format!("graphType '{}' not found", graph_type))?;
    let mood_data = graph.get(&mode)
        .or_else(|| graph.get("normal"))
        .ok_or_else(|| format!("mode '{}' not found in '{}'", mode, graph_type))?;
    Ok(mood_data.clone())
}

#[tauri::command]
pub fn read_png_frames_batch(
    frame_paths: Vec<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<std::collections::HashMap<String, String>, String> {
    use base64::Engine;
    let loader = state.pet_loader.lock().map_err(|e| e.to_string())?;
    let mut result = std::collections::HashMap::new();
    for path in frame_paths {
        if let Ok(bytes) = loader.read_frame_raw(&path) {
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

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ── 存档相关 ──

fn data_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("data")
}

#[tauri::command]
pub fn save_stats(stats: StatsData) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&stats).map_err(|e| e.to_string())?;
    fs::write(dir.join("pet-stats.json"), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_stats() -> Result<StatsData, String> {
    let path = data_dir().join("pet-stats.json");
    if !path.exists() { return Ok(StatsData::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

// ── LLM 配置 ──

#[tauri::command]
pub fn save_llm_config(config: LLMConfig) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(dir.join("llm-config.json"), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_llm_config() -> Result<LLMConfig, String> {
    let path = data_dir().join("llm-config.json");
    if !path.exists() { return Ok(LLMConfig::default()); }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
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
) -> Result<String, String> {
    let system = PersonaSystem::new();
    let custom = custom_prompt.as_deref();
    Ok(system.build_prompt(custom, &mood, hunger, happiness, is_working))
}

// ── LLM 聊天 (流式, 无状态) ──

#[tauri::command]
pub async fn chat_stream(
    app: tauri::AppHandle,
    message: String,
    config: LLMConfig,
    system_prompt: String,
    history: Vec<ChatMessage>,
) -> Result<Vec<ChatMessage>, String> {
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
            stats.play();
            stats.add_likability(1.0);
        }
        TouchEventType::BodyClick => {
            core.set_state(PetState::Idle);
            stats.add_likability(0.5);
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

    core.update_graph_type();

    Ok(serde_json::json!({
        "graphType": result.graph_type_change.unwrap_or(core.current_graph_type.clone()),
        "message": result.message,
        "mood": stats.get_mood(),
        "stats": {
            "hunger": stats.data.hunger,
            "happiness": stats.data.happiness,
            "health": stats.data.health,
        }
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
        "stats": {
            "hunger": stats.data.hunger,
            "thirst": stats.data.thirst,
            "happiness": stats.data.happiness,
            "energy": stats.data.energy,
            "health": stats.data.health,
            "level": stats.data.level,
            "exp": stats.data.exp,
            "money": stats.data.money,
        },
        "work": {
            "isActive": work.is_active,
            "progress": work.progress(),
        },
    }))
}

/// 喂食
#[tauri::command]
pub fn pet_action_feed(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;

    stats.feed(25.0);
    core.current_graph_type = "eat".into();
    core.set_action_lock(4.0);

    Ok(serde_json::json!({
        "graphType": "eat",
        "mood": "normal",
        "message": format!("饱腹度 +25 (当前: {:.0})", stats.data.hunger),
        "stats": {
            "hunger": stats.data.hunger,
            "happiness": stats.data.happiness,
        }
    }))
}

/// 喝水
#[tauri::command]
pub fn pet_action_drink(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;

    stats.drink(25.0);
    core.current_graph_type = "drink".into();
    core.set_action_lock(4.0);

    Ok(serde_json::json!({
        "graphType": "drink",
        "mood": "normal",
        "message": format!("口渴度 +25 (当前: {:.0})", stats.data.thirst),
        "stats": {
            "thirst": stats.data.thirst,
            "happiness": stats.data.happiness,
        }
    }))
}

/// 玩耍
#[tauri::command]
pub fn pet_action_play(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;

    stats.play();
    core.current_graph_type = "default".into();

    Ok(serde_json::json!({
        "graphType": "default",
        "mood": stats.get_mood(),
        "message": format!("心情 +15 (当前: {:.0})", stats.data.happiness),
        "stats": {
            "happiness": stats.data.happiness,
            "energy": stats.data.energy,
        }
    }))
}

/// 捏合交互 (Pinch)
#[tauri::command]
pub fn pet_action_pinch(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;

    stats.data.happiness = (stats.data.happiness - 5.0).max(0.0);
    core.current_graph_type = "pinch".into();
    core.set_action_lock(3.0);

    Ok(serde_json::json!({
        "graphType": "pinch",
        "mood": stats.get_mood(),
        "message": "呜哇! 不要捏我!",
        "stats": { "happiness": stats.data.happiness }
    }))
}

/// 开始工作 (可选工作类型)
#[tauri::command]
pub fn pet_action_work(
    work_type: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut work = state.work.lock().map_err(|e| e.to_string())?;
    let at = match work_type.as_deref() {
        Some("study") => crate::systems::work::ActivityType::Study,
        Some("clean") => crate::systems::work::ActivityType::WorkClean,
        Some("painting") => crate::systems::work::ActivityType::StudyPaint,
        Some("play") => crate::systems::work::ActivityType::Play,
        _ => crate::systems::work::ActivityType::Work,
    };
    work.start(at);
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    core.current_graph_type = "work".into();
    core.set_action_lock(5.0);
    Ok(serde_json::json!({
        "workStarted": true,
        "graphType": "work",
        "workType": format!("{:?}", at),
        "duration": work.duration,
        "rewardPerSec": work.reward_per_sec,
    }))
}

/// 获取可选工作类型列表
#[tauri::command]
pub fn get_work_types() -> Result<Vec<serde_json::Value>, String> {
    Ok(vec![
        serde_json::json!({"id": "work", "name": "打工", "duration": 300, "reward": 0.05, "desc": "基础打工, 稳定收入"}),
        serde_json::json!({"id": "study", "name": "学习", "duration": 600, "reward": 0.08, "desc": "学习知识, 收获更多"}),
        serde_json::json!({"id": "clean", "name": "清洁", "duration": 200, "reward": 0.04, "desc": "打扫卫生, 快速完成"}),
        serde_json::json!({"id": "painting", "name": "绘画", "duration": 450, "reward": 0.07, "desc": "艺术创作, 心情加成"}),
        serde_json::json!({"id": "play", "name": "玩耍", "duration": 120, "reward": 0.0, "desc": "纯娱乐, 不加钱但加心情"}),
    ])
}

/// 游戏时钟推进 (每秒调用一次)
#[tauri::command]
pub fn game_tick(dt_seconds: f64, state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let mut stats = state.stats.lock().map_err(|e| e.to_string())?;
    let mut work = state.work.lock().map_err(|e| e.to_string())?;

    // 属性衰减
    stats.passive_decay();
    // 好感度衰减
    stats.likability_decay();

    // 递减动作锁
    core.tick_action_lock(dt_seconds);

    // 根据 stats 条件触发睡眠/生病状态 (仅在无手动动作锁时)
    if core.action_lock_remaining <= 0.0 {
        if stats.data.energy < 15.0 || stats.data.health < 20.0 {
            core.set_state(PetState::Sleep);
        } else if stats.data.health >= 25.0 && stats.data.energy >= 30.0 && core.state == PetState::Sleep {
            core.set_state(PetState::Idle);
        }
    }

    // 工作计时
    let work_result = work.update(dt_seconds);

    // 应用工作收益
    if let Some(ref wr) = work_result {
        if wr.reward > 0.0 || wr.exp > 0 {
            stats.work(wr.reward, wr.exp);
        }
    }

    // 检查升级
    let leveled_up = stats.check_level_up();

    // 更新 graph type
    core.mood = stats.get_mood().to_string();
    core.update_graph_type();
    let graph_type = core.current_graph_type.clone();

    // 自动存档
    drop(core);
    stats.save();

    Ok(serde_json::json!({
        "mood": stats.get_mood(),
        "graphType": graph_type,
        "stats": {
            "hunger": stats.data.hunger,
            "thirst": stats.data.thirst,
            "happiness": stats.data.happiness,
            "energy": stats.data.energy,
            "health": stats.data.health,
            "level": stats.data.level,
            "exp": stats.data.exp,
            "money": stats.data.money,
        },
        "leveledUp": leveled_up,
        "workFinished": work_result.map(|w| w.finished).unwrap_or(false),
    }))
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

    // 如果正在被拖拽，跳过自主行走
    if core.is_dragging {
        return Ok(serde_json::json!({ "dx": 0, "dy": 0, "facingRight": core.facing_right, "graphType": core.current_graph_type }));
    }

    let (raw_dx, dy) = walk.update(dt_seconds);

    // Controller 边缘检测 + 弹壁
    let (dx, new_dir) = controller.check_screen_edge(window_x, window_w, screen_w, raw_dx, walk.direction);
    walk.direction = new_dir;

    // 更新朝向
    core.facing_right = walk.direction > 0.0;

    // 使用 WalkSystem 的当前 graph_type (Walking→default, Idle→子行为动画)
    let graph_type = walk.current_graph_type().to_string();

    Ok(serde_json::json!({
        "dx": dx,
        "dy": dy,
        "facingRight": core.facing_right,
        "graphType": graph_type,
        "walking": walk.state == crate::systems::walk::WalkState::Walking,
    }))
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