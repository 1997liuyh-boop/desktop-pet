/// AppState — 全局管理状态，由 Tauri 托管
/// 包含: GameCore + Stats + WorkSystem + MainLogic

use std::sync::Mutex;
use std::path::PathBuf;
use crate::core::game_core::GameCore;
use crate::core::controller::Controller;
use crate::systems::stats::Stats;
use crate::systems::work::WorkSystem;
use crate::systems::walk::WalkSystem;
use crate::logic::main_logic::MainLogic;
use crate::animation::pet_loader::PetLoader;

pub struct AppState {
    pub core: Mutex<GameCore>,
    pub stats: Mutex<Stats>,
    pub work: Mutex<WorkSystem>,
    pub walk: Mutex<WalkSystem>,
    pub controller: Mutex<Controller>,
    pub pet_loader: Mutex<PetLoader>,
    pub logic: Mutex<MainLogic>,
}

impl AppState {
    pub fn new() -> Self {
        let vpet_base = PathBuf::from("D:/demo3/VPet/VPet-Simulator.Windows/mod/0000_core/pet/vup/");
        Self {
            core: Mutex::new(GameCore::new()),
            stats: Mutex::new(Stats::new()),
            work: Mutex::new(WorkSystem::new()),
            walk: Mutex::new(WalkSystem::new()),
            controller: Mutex::new(Controller::new()),
            pet_loader: Mutex::new(PetLoader::new(serde_json::json!({}), vpet_base)),
            logic: Mutex::new(MainLogic::new()),
        }
    }
}