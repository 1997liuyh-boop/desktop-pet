/// MainLogic — 对标 VPet MainLogic.cs 的交互模型
///
/// 短按: 遍历 TouchEvent 执行对应动作
/// 长按: PressLength 超时后触发 Raise (被拎起来)
/// 拖拽: MoveWindows
/// 右键: 切换 ToolBar

use super::super::core::touch_area::{TouchArea, TouchAreaType};
use super::super::core::game_core::{GameCore, PetState};

/// 触摸事件类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TouchEventType {
    HeadClick,      // 短按头部
    BodyClick,      // 短按身体
    LongPress,      // 长按 (被拎起来)
    DragStart,      // 开始拖拽
    DragEnd,        // 释放拖拽
}

/// 交互结果
#[derive(Debug)]
pub struct InteractResult {
    pub event: TouchEventType,
    pub graph_type_change: Option<String>,
    pub should_feed: bool,
    pub should_play: bool,
    pub should_chat: bool,
    pub message: Option<String>,
}

pub struct MainLogic {
    pub touch_area: TouchArea,
    /// 长按计时器 (ms)
    press_timer: f64,
    /// 长按阈值 (ms)
    press_threshold: f64,
    /// 是否正在长按检测中
    is_pressing: bool,
    /// 当前按压区域
    press_area: TouchAreaType,
}

impl MainLogic {
    pub fn new() -> Self {
        Self {
            touch_area: TouchArea::new(),
            press_timer: 0.0,
            press_threshold: 300.0, // 0.3s 长按判定 (与 VPet 一致)
            is_pressing: false,
            press_area: TouchAreaType::None,
        }
    }

    /// 开始按压 (mousedown)
    pub fn on_press_start(&mut self, lx: f64, ly: f64) -> TouchAreaType {
        let result = self.touch_area.hit_test(lx, ly);
        self.is_pressing = true;
        self.press_timer = 0.0;
        self.press_area = result.area;
        result.area
    }

    /// 释放按压 (mouseup), dt 为按压持续时间(ms)
    pub fn on_press_end(&mut self, dt: f64, has_moved: bool, core: &mut GameCore) -> InteractResult {
        self.is_pressing = false;
        let result = InteractResult {
            event: TouchEventType::BodyClick,
            graph_type_change: None,
            should_feed: false,
            should_play: false,
            should_chat: false,
            message: None,
        };

        if has_moved {
            return result; // 拖拽中，不触发点击
        }

        if dt >= self.press_threshold {
            // 长按 → 拎起
            core.set_state(PetState::Drag);
            return InteractResult {
                event: TouchEventType::LongPress,
                graph_type_change: Some("raise".into()),
                message: Some("被主人拎起来了喵~".into()),
                ..result
            };
        }

        // 短按
        match self.press_area {
            TouchAreaType::Head => InteractResult {
                event: TouchEventType::HeadClick,
                graph_type_change: Some("touch_head".into()),
                message: Some(match core.mood.as_str() {
                    "happy" => "喵呜~ 好舒服！".into(),
                    "poorCondition" => "呜...".into(),
                    "ill" => "主人... 摸头好温暖...".into(),
                    _ => "喵？".into(),
                }),
                ..result
            },
            TouchAreaType::Body => InteractResult {
                event: TouchEventType::BodyClick,
                graph_type_change: Some("touch_body".into()),
                message: Some(match core.mood.as_str() {
                    "poorCondition" => "别摸了，我有点不舒服...".into(),
                    _ => "哼，摸身体要收费的！(开玩笑的)".into(),
                }),
                ..result
            },
            TouchAreaType::None => result,
        }
    }

    /// 更新长按计时器
    pub fn update_press_timer(&mut self, dt: f64) -> bool {
        if !self.is_pressing { return false; }
        self.press_timer += dt;
        self.press_timer >= self.press_threshold
    }

    /// 开始拖拽
    pub fn on_drag_start(core: &mut GameCore) {
        core.set_state(PetState::Drag);
    }

    /// 结束拖拽
    pub fn on_drag_end(core: &mut GameCore) {
        core.set_state(PetState::Idle);
        core.update_graph_type();
    }
}