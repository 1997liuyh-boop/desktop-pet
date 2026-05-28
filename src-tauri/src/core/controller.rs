/// Controller — 屏幕边缘检测 + 位置修正 + SideHide 边缘隐藏

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SideHideState {
    None,
    HiddenLeft,
    HiddenRight,
    RisingLeft,   // 正在从左侧滑出
    RisingRight,  // 正在从右侧滑出
}

#[derive(Debug)]
pub struct Controller {
    pub margin: i32,
    pub side_hide: SideHideState,
}

impl Controller {
    pub fn new() -> Self {
        Self { margin: 20, side_hide: SideHideState::None }
    }

    /// 屏幕边缘检测：修正窗口位移量，碰壁时反转方向
    /// 返回 (修正后的 dx, 修正后的 direction)
    pub fn check_screen_edge(
        &self,
        window_x: i32,
        window_w: i32,
        screen_w: i32,
        desired_dx: i32,
        current_dir: f64,
    ) -> (i32, f64) {
        let mut dx = desired_dx;
        let mut dir = current_dir;
        let new_x = window_x + dx;

        if new_x + window_w > screen_w - self.margin {
            dx = (screen_w - self.margin - window_w) - window_x;
            dir = -1.0;
        } else if new_x < self.margin {
            dx = self.margin - window_x;
            dir = 1.0;
        }

        (dx, dir)
    }

    /// 检测是否应该触发 SideHide (窗口超出屏幕过多)
    /// 返回建议的 SideHide 状态变化
    pub fn check_side_hide(
        &self,
        window_x: i32,
        window_w: i32,
        screen_w: i32,
    ) -> SideHideState {
        let _hide_ratio = 0.7;  // 超过 70% 出屏时触发隐藏
        let reveal_px = 30;     // 隐藏后露出 30px 供鼠标触碰

        // 已经在隐藏状态 → 保持
        match self.side_hide {
            SideHideState::HiddenLeft => {
                // 检查窗口是否还在左侧隐藏位置
                let expected_x = -(window_w as i32) + reveal_px;
                if (window_x - expected_x).abs() < 20 { return SideHideState::HiddenLeft; }
                return SideHideState::None;
            }
            SideHideState::HiddenRight => {
                let expected_x = screen_w - reveal_px;
                if (window_x - expected_x).abs() < 20 { return SideHideState::HiddenRight; }
                return SideHideState::None;
            }
            _ => {}
        }

        if window_x + window_w < window_w as i32 / 3 {
            // 左边超出 → 触发左侧隐藏
            return SideHideState::HiddenLeft;
        }
        if window_x > screen_w - window_w as i32 / 3 {
            return SideHideState::HiddenRight;
        }
        SideHideState::None
    }

    /// 鼠标靠近隐藏区域时，计算弹出位置
    pub fn get_rise_target(
        &self,
        _window_x: i32,
        window_w: i32,
        screen_w: i32,
        mouse_screen_x: i32,
    ) -> Option<i32> {
        let trigger_zone = 50;
        match self.side_hide {
            SideHideState::HiddenLeft => {
                if mouse_screen_x < trigger_zone {
                    Some(0)  // 滑出到左边缘对齐
                } else {
                    None
                }
            }
            SideHideState::HiddenRight => {
                if mouse_screen_x > screen_w - trigger_zone {
                    Some(screen_w - window_w as i32)
                } else {
                    None
                }
            }
            _ => None,
        }
    }
}