/// 生成一个简单的 32x32 RGBA 托盘图标 (橘色圆形)
pub fn generate_tray_icon() -> tauri::image::Image<'static> {
    let size: u32 = 32;
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);
    let cx: f64 = (size as f64) / 2.0;
    let cy: f64 = (size as f64) / 2.0;
    let radius: f64 = 13.0;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist <= radius {
                // 橘色猫脸
                rgba.push(255); // R
                rgba.push(140); // G
                rgba.push(50);  // B
                rgba.push(255); // A
            } else if dist <= radius + 1.5 {
                // 外边框
                rgba.push(200);
                rgba.push(100);
                rgba.push(30);
                rgba.push(255);
            } else {
                // 透明
                rgba.push(0);
                rgba.push(0);
                rgba.push(0);
                rgba.push(0);
            }
        }
    }

    tauri::image::Image::new_owned(
        rgba,
        size,
        size,
    )
}