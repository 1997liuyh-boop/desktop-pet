use serde::{Deserialize, Serialize};

/// 工作类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActivityType {
    Work,
    Study,
    Play,
    WorkClean,
    StudyPaint,
}

/// WorkSystem — 定时工作/学习/玩耍
pub struct WorkSystem {
    pub is_active: bool,
    pub activity_type: ActivityType,
    pub elapsed: f64,       // 已用时间 (秒)
    pub duration: f64,      // 总时长 (秒)
    pub reward_per_sec: f64,
    pub exp_per_sec: u64,
}

impl WorkSystem {
    pub fn new() -> Self {
        Self {
            is_active: false,
            activity_type: ActivityType::Work,
            elapsed: 0.0,
            duration: 300.0,  // 默认5分钟
            reward_per_sec: 0.05,
            exp_per_sec: 1,
        }
    }

    /// 开始活动
    pub fn start(&mut self, at: ActivityType) {
        self.is_active = true;
        self.activity_type = at;
        self.elapsed = 0.0;
        match at {
            ActivityType::Work => { self.duration = 300.0; self.reward_per_sec = 0.05; self.exp_per_sec = 1; }
            ActivityType::Study => { self.duration = 600.0; self.reward_per_sec = 0.08; self.exp_per_sec = 3; }
            ActivityType::Play => { self.duration = 120.0; self.reward_per_sec = 0.0; self.exp_per_sec = 0; }
            ActivityType::WorkClean => { self.duration = 200.0; self.reward_per_sec = 0.04; self.exp_per_sec = 1; }
            ActivityType::StudyPaint => { self.duration = 450.0; self.reward_per_sec = 0.07; self.exp_per_sec = 2; }
        }
    }

    /// 停止
    pub fn stop(&mut self) {
        self.is_active = false;
    }

    /// 更新 (dt: 秒)
    pub fn update(&mut self, dt: f64) -> Option<WorkTickResult> {
        if !self.is_active { return None; }
        self.elapsed += dt;
        if self.elapsed >= self.duration {
            self.is_active = false;
            Some(WorkTickResult {
                reward: self.reward_per_sec * self.duration,
                exp: self.exp_per_sec * self.duration as u64,
                finished: true,
            })
        } else {
            Some(WorkTickResult {
                reward: self.reward_per_sec * dt,
                exp: self.exp_per_sec * dt as u64,
                finished: false,
            })
        }
    }

    /// 进度 0.0 - 1.0
    pub fn progress(&self) -> f64 {
        if self.duration <= 0.0 { return 0.0; }
        (self.elapsed / self.duration).min(1.0)
    }
}

pub struct WorkTickResult {
    pub reward: f64,
    pub exp: u64,
    pub finished: bool,
}