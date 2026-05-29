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
    // 去除 Windows 工具可能写入的 UTF-8 BOM (EF BB BF)
    let content = content.trim_start_matches('\u{FEFF}');
    serde_json::from_str(content).map_err(|e| e.to_string())
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

    // 随机挑一份可吃食物, 取其真实属性
    let food = crate::systems::food::pick_random("eat")
        .ok_or("未找到可吃食物")?;
    stats.data.eat_food(
        food.exp, food.strength, food.strength_food,
        food.strength_drink, food.feeling, food.health, 0.0,
    );
    stats.data.mark_interaction();
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

    // 随机挑一份饮料, 取其真实属性
    let food = crate::systems::food::pick_random("drink")
        .ok_or("未找到可喝饮料")?;
    stats.data.eat_food(
        food.exp, food.strength, food.strength_food,
        food.strength_drink, food.feeling, food.health, 0.0,
    );
    stats.data.mark_interaction();
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

    let food = crate::systems::food::find_food(&food_name)
        .ok_or_else(|| format!("未找到食物: {}", food_name))?;
    stats.data.eat_food(
        food.exp, food.strength, food.strength_food,
        food.strength_drink, food.feeling, food.health, 0.0,
    );
    stats.data.mark_interaction();
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
    // 启动 Play 类型工作 (玩游戏: 收益进经验, 使用专属玩耍动画)
    let play_work = crate::systems::work::find_work("playone")
        .ok_or("未找到玩耍工种")?;
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
    use crate::systems::work::{WorkingState, WorkType};

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

    // 工作计时 (真实时间推进); 完成则发放完成奖励
    let mut work_finished = false;
    if let Some(fin) = work.advance(dt_seconds) {
        let bonus = fin.bonus;
        match fin.work_type {
            WorkType::Work => stats.data.money += bonus,
            _ => stats.data.exp += bonus,
        }
        work_finished = true;
        core.set_action_lock(0.0);
        core.set_state(PetState::Idle);
    }

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
        "workFinished": work_finished,
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
    let work = state.work.lock().map_err(|e| e.to_string())?;

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

    let _ = chat.show();
    let _ = chat.set_focus();

    // 重新置顶宠物窗口，防止聊天窗口夺走 z-order
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