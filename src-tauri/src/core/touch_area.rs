/// TouchArea — 触摸区域命中检测

/// 触摸区域类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TouchAreaType {
    Head,   // 摸头
    Body,   // 摸身体
    None,   // 未命中
}

/// 触摸检测结果
#[derive(Debug)]
pub struct TouchResult {
    pub area: TouchAreaType,
    pub local_x: f64,
    pub local_y: f64,
}

pub struct TouchArea;

impl TouchArea {
    pub fn new() -> Self { Self }

    /// 检测触点 (lx, ly) 是否命中头部区域
    /// 逻辑坐标空间: 500x500，原点在左上角
    /// 头部区域: 近似椭圆，中心 (250, 180)，rx=100, ry=90
    /// 身体区域: 近似椭圆，中心 (250, 320)，rx=85, ry=110
    pub fn hit_test(&self, lx: f64, ly: f64) -> TouchResult {
        let head_hit = self._in_ellipse(lx, ly, 250.0, 180.0, 100.0, 90.0);
        let body_hit = self._in_ellipse(lx, ly, 250.0, 320.0, 85.0, 110.0);

        let area = if head_hit {
            TouchAreaType::Head
        } else if body_hit {
            TouchAreaType::Body
        } else {
            TouchAreaType::None
        };

        TouchResult { area, local_x: lx, local_y: ly }
    }

    fn _in_ellipse(&self, x: f64, y: f64, cx: f64, cy: f64, rx: f64, ry: f64) -> bool {
        if rx <= 0.0 || ry <= 0.0 { return false; }
        let dx = (x - cx) / rx;
        let dy = (y - cy) / ry;
        dx * dx + dy * dy <= 1.0
    }
}