mod commands;
mod core;
mod animation;
mod systems;
mod ai;
mod logic;
mod app_state;
mod tray_icon;

use std::sync::Arc;
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
            commands::quit_app,
            commands::save_stats,
            commands::load_stats,
            commands::save_llm_config,
            commands::load_llm_config,
            commands::get_persona_presets,
            commands::build_persona_prompt,
            commands::chat_stream,
            commands::hit_test,
            commands::process_interaction,
            commands::get_pet_status,
            commands::pet_action_feed,
            commands::pet_action_drink,
            commands::pet_action_play,
            commands::pet_action_work,
            commands::pet_action_pinch,
            commands::pet_action_sleep,
            commands::get_work_types,
            commands::game_tick,
            commands::walk_tick,
            commands::sidehide_check,
            commands::open_settings_window,
            commands::set_clickthrough,
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

            // 窗口初始位置
            if let Some(window) = app.get_webview_window("pet") {
                let _ = window.set_always_on_top(true);
                if let Ok(monitor) = window.primary_monitor() {
                    if let Some(m) = monitor {
                        let size = m.size();
                        let scale = m.scale_factor();
                        let screen_w = size.width as f64 / scale;
                        let screen_h = size.height as f64 / scale;
                        let _ = window.set_position(tauri::Position::Physical(
                            tauri::PhysicalPosition::new(
                                ((screen_w - 400.0) * scale) as i32,
                                ((screen_h - 500.0) * scale) as i32,
                            ),
                        ));
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}