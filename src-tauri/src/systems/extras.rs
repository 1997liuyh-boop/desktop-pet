//! 扩展系统：统计 / 背包 / 日程表 / 设置 / 活动日志
//! 统一持久化到 ../data/pet-extras.json (与 Stats 同目录约定)

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 累计统计 — 对标 VPet Statistics 面板
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Statistics {
    /// 总在线时长 (秒)
    pub total_online_secs: f64,
    pub work_secs: f64,
    pub study_secs: f64,
    pub play_secs: f64,
    pub sleep_secs: f64,
    pub idle_secs: f64,
    pub touch_head_count: u64,
    pub touch_body_count: u64,
    pub pinch_count: u64,
    pub drag_count: u64,
    pub dance_count: u64,
    pub talk_count: u64,
    pub feed_count: u64,
    pub drink_count: u64,
    pub gift_count: u64,
    pub work_done_count: u64,
    pub money_earned: f64,
    pub money_spent: f64,
    /// 累计移动距离 (像素)
    pub move_distance: f64,
    pub level_up_count: u64,
}

/// 活动日志条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub ts: u64,
    pub kind: String,
    pub text: String,
}

/// 日程表条目
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ScheduleItem {
    /// 工作图名 (workone/study/playone...) 或 "rest"
    pub graph: String,
    /// 分类: Work / Study / Play / Rest
    pub kind: String,
    pub name: String,
    /// 时长 (分钟)
    pub minutes: f64,
}

/// 日程表 — 对标 VPet Schedule
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Schedule {
    pub items: Vec<ScheduleItem>,
    pub enabled: bool,
    pub loop_forever: bool,
    pub current_index: usize,
    /// 休息条目结束的 unix 时间 (秒)
    pub rest_until: u64,
}

impl Default for Schedule {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            enabled: false,
            loop_forever: true,
            current_index: 0,
            rest_until: 0,
        }
    }
}

/// 桌宠设置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PetSettings {
    /// 缩放 0.6 - 1.8
    pub scale: f64,
    /// 不透明度 0.3 - 1.0
    pub opacity: f64,
    /// 窗口置顶
    pub always_on_top: bool,
    /// 语音音量 0 - 1
    pub volume: f64,
    /// 允许自主移动
    pub enable_movement: bool,
    /// 自动投喂/购买
    pub enable_auto_buy: bool,
    /// 数据计算 (需求消耗) 开关
    pub enable_data_calc: bool,
}

impl Default for PetSettings {
    fn default() -> Self {
        Self {
            scale: 1.0,
            opacity: 1.0,
            always_on_top: true,
            volume: 1.0,
            enable_movement: true,
            enable_auto_buy: false,
            enable_data_calc: true,
        }
    }
}

/// 持久化数据集合
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct GameExtrasData {
    pub statistics: Statistics,
    /// 背包: 物品名 -> 数量
    pub inventory: BTreeMap<String, u32>,
    pub schedule: Schedule,
    pub settings: PetSettings,
    pub log: Vec<LogEntry>,
}

/// 扩展系统 — 持有数据 + 存档
pub struct GameExtras {
    pub data: GameExtrasData,
    save_path: PathBuf,
}

impl GameExtras {
    pub fn new() -> Self {
        let save_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("data")
            .join("pet-extras.json");
        let data = fs::read_to_string(&save_path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default();
        Self { data, save_path }
    }

    pub fn save(&self) {
        if let Some(parent) = self.save_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&self.data) {
            let _ = fs::write(&self.save_path, json);
        }
    }

    /// 追加活动日志 (保留最近 200 条)
    pub fn add_log(&mut self, kind: &str, text: String) {
        self.data.log.push(LogEntry {
            ts: now_unix(),
            kind: kind.to_string(),
            text,
        });
        let len = self.data.log.len();
        if len > 200 {
            self.data.log.drain(0..len - 200);
        }
    }

    pub fn inventory_add(&mut self, name: &str, count: u32) {
        let entry = self.data.inventory.entry(name.to_string()).or_insert(0);
        *entry += count;
    }

    /// 消耗一个物品, 返回是否成功
    pub fn inventory_take(&mut self, name: &str) -> bool {
        if let Some(entry) = self.data.inventory.get_mut(name) {
            if *entry > 0 {
                *entry -= 1;
                if *entry == 0 {
                    self.data.inventory.remove(name);
                }
                return true;
            }
        }
        false
    }
}
