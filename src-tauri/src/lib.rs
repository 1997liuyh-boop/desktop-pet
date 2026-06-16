mod commands;
mod core;
mod animation;
mod systems;
mod ai;
mod logic;
mod app_state;
mod tray_icon;

use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tauri::tray::TrayIconBuilder;
use app_state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(AppState::new()))
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::get_manifest,
            commands::get_animation_frames,
            commands::read_png_frame,
            commands::read_png_frames_batch,
            commands::get_screen_info,
            commands::move_window_by,
            commands::set_window_position,
            commands::get_window_position,
            commands::get_cursor_position,
            commands::get_system_audio_level,
            commands::quit_app,
            commands::save_stats,
            commands::load_stats,
            commands::save_llm_config,
            commands::load_llm_config,
            commands::save_llm_api_key,
            commands::clear_llm_api_key,
            commands::has_llm_api_key,
            commands::load_memory,
            commands::save_memory,
            commands::memory_summary,
            commands::get_persona_presets,
            commands::build_persona_prompt,
            commands::chat_stream,
            commands::hit_test,
            commands::process_interaction,
            commands::get_pet_status,
            commands::pet_action_feed,
            commands::pet_action_drink,
            commands::get_food_menu,
            commands::pet_action_eat,
            commands::pet_action_play,
            commands::pet_action_work,
            commands::pet_action_stop_work,
            commands::pet_action_pinch,
            commands::pet_action_sleep,
            commands::get_work_types,
            commands::game_tick,
            commands::walk_tick,
            commands::reset_walk_state,
            commands::force_walk,
            commands::sidehide_check,
            commands::open_settings_window,
            commands::open_chat_window,
            commands::open_food_panel,
            commands::open_work_panel,
            commands::open_status_panel,
            commands::open_monitor_panel,
            commands::open_shop_panel,
            commands::open_schedule_panel,
            commands::set_pet_window_scale,
            commands::cheat_set_level,
            commands::cheat_set_stat,
            commands::get_statistics,
            commands::stat_increment,
            commands::get_activity_log,
            commands::log_event,
            commands::get_shop_items,
            commands::get_inventory,
            commands::buy_item,
            commands::use_inventory_item,
            commands::get_mailbox,
            commands::open_mail,
            commands::get_schedule,
            commands::set_schedule,
            commands::set_schedule_enabled,
            commands::get_settings,
            commands::save_settings,
            commands::set_clickthrough,
            commands::aux_window_visible,
            commands::tts_speak,
            commands::save_tts_api_key,
            commands::has_tts_api_key,
            commands::save_tts_config,
            commands::load_tts_config,
            commands::coding_tools_poll,
            commands::coding_tools_status,
            commands::coding_tools_start_monitor,
            commands::pet_action_gift,
        ])
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItemBuilder};

            // 托盘菜单
            let show = MenuItemBuilder::with_id("show", "显示宠物").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let tray_menu = MenuBuilder::new(app).item(&show).item(&quit).build()?;

            // 托盘图标
            let tray_icon = tray_icon::generate_tray_icon();
            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("Desktop Pet")
                .menu(&tray_menu)
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "show" {
                        if let Some(window) = app.get_webview_window("pet") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    } else if event.id().as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            // 设置/聊天/面板窗口: 拦截关闭按钮, 改为隐藏而非销毁, 以便可再次打开
            for label in ["settings", "chat", "food-panel", "work-panel", "status-panel", "monitor-panel", "schedule-panel"] {
                if let Some(win) = app.get_webview_window(label) {
                    let win_clone = win.clone();
                    win.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = win_clone.hide();
                        }
                    });
                }
            }

            // 窗口初始位置 — 放在屏幕右下角且完整可见 (窗口 250x370 逻辑像素)
            // 配置中 pet 窗口为 visible:false, 先定位再显示, 避免启动时在左上角闪现
            if let Some(window) = app.get_webview_window("pet") {
                let _ = window.set_always_on_top(true);
                if let Ok(Some(m)) = window.primary_monitor() {
                    let size = m.size();          // 物理像素
                    let scale = m.scale_factor();
                    // 窗口物理尺寸 = 逻辑尺寸 * 缩放; 留出右侧与底部任务栏边距
                    let win_w_phys = (250.0 * scale) as i32;
                    let win_h_phys = (370.0 * scale) as i32;
                    let margin_right = (20.0 * scale) as i32;
                    let margin_bottom = (60.0 * scale) as i32;
                    let x = (size.width as i32 - win_w_phys - margin_right).max(0);
                    let y = (size.height as i32 - win_h_phys - margin_bottom).max(0);
                    let _ = window.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition::new(x, y),
                    ));
                }
                let _ = window.show();
            }

            // 启动 Coding Tool 监控后台服务 — 已关闭
            // {
            //     use crate::systems::coding_tools::WatcherEvent;
            //     use std::sync::mpsc;
            //
            //     let (tx, rx) = mpsc::channel::<WatcherEvent>();
            //     let tx_arc = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
            //
            //     // 启动 file watcher
            //     {
            //         let state = app.state::<std::sync::Arc<AppState>>();
            //         let mut monitor = state.coding_monitor.lock().unwrap();
            //         monitor.start_watcher(tx_arc);
            //     }
            //
            //     // 后台轮询 + event 推送
            //     let app_handle = app.handle().clone();
            //     let state = app.state::<std::sync::Arc<AppState>>().inner().clone();
            //     std::thread::spawn(move || {
            //         // 等 3 秒让应用完全就绪
            //         std::thread::sleep(std::time::Duration::from_secs(3));
            //         loop {
            //             // 处理 watcher 事件
            //             while let Ok(event) = rx.try_recv() {
            //                 if let Ok(mut monitor) = state.coding_monitor.lock() {
            //                     monitor.on_watcher_event(&event);
            //                 }
            //             }
            //             // 完整检测
            //             let snapshot = {
            //                 if let Ok(mut monitor) = state.coding_monitor.lock() {
            //                     monitor.poll()
            //                 } else {
            //                     break;
            //                 }
            //             };
            //             // 推送到前端
            //             let _ = app_handle.emit("coding-monitor-snapshot", &snapshot);
            //             if !snapshot.any_just_completed.is_empty() {
            //                 let _ = app_handle.emit("coding-monitor-task-complete", &snapshot.any_just_completed);
            //             }
            //             std::thread::sleep(std::time::Duration::from_secs(5));
            //         }
            //     });
            // }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}