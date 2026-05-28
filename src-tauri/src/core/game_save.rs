use serde::{Deserialize, Serialize};
use crate::systems::stats::StatsData;

/// GameSave — JSON 存档序列化/反序列化
#[derive(Debug, Serialize, Deserialize)]
pub struct GameSave {
    pub stats: StatsData,
    pub persona: String,  // 当前语气预设
}

impl GameSave {
    pub fn new(stats: &StatsData, persona: &str) -> Self {
        Self {
            stats: stats.clone(),
            persona: persona.to_string(),
        }
    }

    pub fn to_json_string(&self) -> Result<String, String> {
        serde_json::to_string_pretty(self).map_err(|e| e.to_string())
    }

    pub fn from_json_string(json: &str) -> Result<Self, String> {
        serde_json::from_str(json).map_err(|e| e.to_string())
    }
}