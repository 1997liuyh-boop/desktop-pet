/// WalkSystem — 自主行走 + 闲置行为状态机
///
/// 顶层: Idle ↔ Walk
/// Idle 子行为: Standing(default) → IdleAnim(idle) → Think(think) → Switch(switch)
/// 权重: Standing 60% / IdleAnim 25% / Think 10% / Switch 5%
/// Walk: 随机左右方向行走 2~6 秒，碰壁弹回

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WalkState {
    Idle,
    Walking,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum IdlePhase {
    Standing,  // "default" 动画
    IdleAnim,  // "idle" 动画 (打哈欠等)
    Think,     // "think" 动画
    Switch,    // "switch" 动画
}

pub struct WalkSystem {
    pub state: WalkState,
    pub idle_phase: IdlePhase,
    /// 行走方向: 1.0 = 右, -1.0 = 左
    pub direction: f64,
    /// 行走速度 (屏幕像素/秒)
    pub speed_px_per_sec: f64,
    /// 顶层状态计时器 (秒)
    timer: f64,
    /// 闲置子行为计时器 (秒)
    idle_timer: f64,
}

impl WalkSystem {
    pub fn new() -> Self {
        let mut ws = Self {
            state: WalkState::Idle,
            idle_phase: IdlePhase::Standing,
            direction: 1.0,
            speed_px_per_sec: 80.0,
            timer: Self::random_idle_duration(),
            idle_timer: 0.0,
        };
        ws.reset_idle_phase();
        ws
    }

    fn random_idle_duration() -> f64 {
        12.0 + rand::random::<f64>() * 18.0  // 12~30s (对标 VPet 15s 间隔)
    }

    fn random_walk_duration() -> f64 {
        3.0 + rand::random::<f64>() * 5.0   // 3~8s
    }

    fn random_standing_duration() -> f64 {
        15.0 + rand::random::<f64>() * 15.0  // 15~30s
    }

    fn random_anim_duration() -> f64 {
        5.0 + rand::random::<f64>() * 5.0   // 5~10s
    }

    fn random_think_duration() -> f64 {
        10.0 + rand::random::<f64>() * 10.0  // 10~20s
    }

    /// 重置闲置子行为 (随机选择下一个)
    fn reset_idle_phase(&mut self) {
        let roll: f64 = rand::random::<f64>() * 100.0;
        (self.idle_phase, self.idle_timer) = if roll < 70.0 {
            (IdlePhase::Standing, Self::random_standing_duration())
        } else if roll < 85.0 {
            (IdlePhase::IdleAnim, Self::random_anim_duration())
        } else if roll < 99.0 {
            (IdlePhase::Think, Self::random_think_duration())
        } else {
            (IdlePhase::Switch, Self::random_anim_duration())
        };
    }

    /// 返回当前应该播放的 graph_type
    pub fn current_graph_type(&self) -> &str {
        if self.state == WalkState::Walking {
            return "move";
        }
        match self.idle_phase {
            IdlePhase::Standing => "default",
            IdlePhase::IdleAnim => "idle",
            IdlePhase::Think => "think",
            IdlePhase::Switch => "switch",
        }
    }

    /// 每帧更新，返回建议的窗口位移量 (dx, dy)
    /// 不包含边缘检测 — 由调用方通过 Controller 处理
    pub fn update(&mut self, dt: f64) -> (i32, i32) {
        self.timer -= dt;

        match self.state {
            WalkState::Idle => {
                // 闲置子行为计时
                self.idle_timer -= dt;
                if self.idle_timer <= 0.0 {
                    self.reset_idle_phase();
                }

                // 顶层: Idle → Walk 切换
                if self.timer <= 0.0 {
                    self.state = WalkState::Walking;
                    self.idle_phase = IdlePhase::Standing;
                    self.direction = if rand::random::<bool>() { 1.0 } else { -1.0 };
                    self.timer = Self::random_walk_duration();
                }
                (0, 0)
            }
            WalkState::Walking => {
                if self.timer <= 0.0 {
                    self.state = WalkState::Idle;
                    self.timer = Self::random_idle_duration();
                    self.reset_idle_phase();
                    return (0, 0);
                }

                let pixels = (self.speed_px_per_sec * dt) as i32;
                let dx = if self.direction > 0.0 { pixels } else { -pixels };
                (dx, 0)
            }
        }
    }
}