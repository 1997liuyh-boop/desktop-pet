use serde::{Deserialize, Serialize};

/// 宠物状态枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PetState {
    Idle,
    Walk,
    Drag,
    Chat,
    Sleep,
}

/// GameCore — 统一容器，持有所有子系统引用
#[derive(Debug)]
pub struct GameCore {
    // 逻辑坐标 (500x500 空间)
    pub x: f64,
    pub y: f64,
    pub logic_w: f64,
    pub logic_h: f64,

    // 动画状态
    pub current_graph_type: String,
    pub mood: String,
    pub state: PetState,

    // 交互状态
    pub is_dragging: bool,
    pub is_hovered: bool,
    pub is_side_hidden: bool,

    // 空闲计时器
    pub idle_timer: f64,

    // 行走方向
    pub facing_right: bool,

    // 手动动作锁 (喝水/喂食等的剩余时间, 秒)
    pub action_lock_remaining: f64,
}

impl GameCore {
    pub fn new() -> Self {
        Self {
            x: 250.0,
            y: 280.0,
            logic_w: 500.0,
            logic_h: 500.0,
            current_graph_type: "default".into(),
            mood: "normal".into(),
            state: PetState::Idle,
            is_dragging: false,
            is_hovered: false,
            is_side_hidden: false,
            idle_timer: 0.0,
            facing_right: true,
            action_lock_remaining: 0.0,
        }
    }

    pub fn reset_idle(&mut self) {
        self.idle_timer = 0.0;
    }

    pub fn set_state(&mut self, state: PetState) {
        self.state = state;
    }

    /// 根据心情选择 graph type
    /// 若 action_lock_remaining > 0 则跳过覆盖 (保护手动动作动画)
    pub fn update_graph_type(&mut self) {
        if self.action_lock_remaining > 0.0 {
            return;
        }
        if self.state == PetState::Chat {
            self.current_graph_type = "default".into();
            return;
        }
        if self.state == PetState::Sleep {
            self.current_graph_type = "sleep".into();
            return;
        }
        if self.is_dragging {
            self.current_graph_type = "raise".into();
            return;
        }
        self.current_graph_type = "default".into();
    }

    /// 设置手动动作锁 (秒)
    pub fn set_action_lock(&mut self, duration: f64) {
        self.action_lock_remaining = duration;
    }

    /// 递减动作锁 (由 game_tick 调用)
    pub fn tick_action_lock(&mut self, dt: f64) {
        if self.action_lock_remaining > 0.0 {
            self.action_lock_remaining = (self.action_lock_remaining - dt).max(0.0);
        }
    }
}