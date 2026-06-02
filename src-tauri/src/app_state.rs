/// AppState — 全局管理状态，由 Tauri 托管
/// 包含: GameCore + Stats + WorkSystem + MainLogic

use std::sync::Mutex;
use crate::core::game_core::GameCore;
use crate::core::controller::Controller;
use crate::systems::stats::Stats;
use crate::systems::work::WorkSystem;
use crate::systems::walk::WalkSystem;
use crate::logic::main_logic::MainLogic;

pub struct AppState {
    pub core: Mutex<GameCore>,
    pub stats: Mutex<Stats>,
    pub work: Mutex<WorkSystem>,
    pub walk: Mutex<WalkSystem>,
    pub controller: Mutex<Controller>,
    pub logic: Mutex<MainLogic>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            core: Mutex::new(GameCore::new()),
            stats: Mutex::new(Stats::new()),
            work: Mutex::new(WorkSystem::new()),
            walk: Mutex::new(WalkSystem::new()),
            controller: Mutex::new(Controller::new()),
            logic: Mutex::new(MainLogic::new()),
        }
    }
}
