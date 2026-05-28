use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 宠物属性数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsData {
    pub hunger: f64,       // 饱腹度 0-100
    pub thirst: f64,       // 口渴度 0-100
    pub happiness: f64,    // 心情值 0-100
    pub energy: f64,       // 精力 0-100
    pub health: f64,       // 健康 0-100
    pub exp: u64,          // 经验值
    pub level: u32,        // 等级
    pub money: f64,        // 金币
    pub likability: f64,   // 好感度 0-100 (隐藏属性)
    pub last_update: u64,  // 上次更新时间戳 (秒)
}

impl Default for StatsData {
    fn default() -> Self {
        Self {
            hunger: 80.0,
            thirst: 80.0,
            happiness: 70.0,
            energy: 90.0,
            health: 100.0,
            exp: 0,
            level: 1,
            money: 0.0,
            likability: 50.0,
            last_update: 0,
        }
    }
}

/// Stats 系统 — 属性计算 + 被动衰减
pub struct Stats {
    pub data: StatsData,
    save_path: PathBuf,
}

impl Stats {
    pub fn new() -> Self {
        let save_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("data")
            .join("pet-stats.json");

        // 尝试加载存档
        let data = Self::load_from_file(&save_path).unwrap_or_default();

        Self { data, save_path }
    }

    fn load_from_file(path: &PathBuf) -> Option<StatsData> {
        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    pub fn save(&self) {
        if let Some(parent) = self.save_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&self.data) {
            let _ = fs::write(&self.save_path, json);
        }
    }

    /// 被动衰减 - 每秒调用一次
    pub fn passive_decay(&mut self) {
        self.data.hunger = (self.data.hunger - 0.02).max(0.0);
        self.data.thirst = (self.data.thirst - 0.025).max(0.0);
        self.data.happiness = (self.data.happiness - 0.01).max(0.0);
        self.data.energy = (self.data.energy - 0.015).max(0.0);
        if self.data.hunger < 10.0 || self.data.thirst < 10.0 {
            self.data.health = (self.data.health - 0.05).max(0.0);
        }
        self.data.likability = (self.data.likability - 0.003).max(0.0);
    }

    /// 喂食
    pub fn feed(&mut self, amount: f64) {
        self.data.hunger = (self.data.hunger + amount).min(100.0);
        self.data.happiness = (self.data.happiness + amount * 0.3).min(100.0);
    }

    /// 喝水
    pub fn drink(&mut self, amount: f64) {
        self.data.thirst = (self.data.thirst + amount).min(100.0);
        self.data.happiness = (self.data.happiness + amount * 0.2).min(100.0);
    }

    /// 玩耍
    pub fn play(&mut self) {
        self.data.happiness = (self.data.happiness + 15.0).min(100.0);
        self.data.energy = (self.data.energy - 8.0).max(0.0);
        self.data.likability = (self.data.likability + 2.0).min(100.0);
        self.data.exp += 5;
    }

    /// 好感度被动衰减 (每秒)
    pub fn likability_decay(&mut self) {
        self.data.likability = (self.data.likability - 0.003).max(0.0);
    }

    /// 增加好感度
    pub fn add_likability(&mut self, amount: f64) {
        self.data.likability = (self.data.likability + amount).min(100.0);
    }

    /// 工作/学习
    pub fn work(&mut self, reward: f64, exp_gain: u64) {
        self.data.money += reward;
        self.data.exp += exp_gain;
        self.data.energy = (self.data.energy - 15.0).max(0.0);
        self.data.hunger = (self.data.hunger - 5.0).max(0.0);
        self.data.thirst = (self.data.thirst - 5.0).max(0.0);
    }

    /// 获取当前心情 (用于选择动画模式)
    pub fn get_mood(&self) -> &str {
        if self.data.health < 20.0 { return "ill"; }
        if self.data.happiness > 70.0 { return "happy"; }
        if self.data.happiness < 25.0 || self.data.hunger < 15.0 || self.data.thirst < 15.0 {
            return "poorCondition";
        }
        "normal"
    }

    /// 检查升级
    pub fn check_level_up(&mut self) -> bool {
        let required = self.data.level as u64 * 100;
        if self.data.exp >= required {
            self.data.exp -= required;
            self.data.level += 1;
            true
        } else {
            false
        }
    }
}