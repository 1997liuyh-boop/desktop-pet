/// 加载 VPet 原版托盘图标 (vpeticon.png, 32×32)
pub fn generate_tray_icon() -> tauri::image::Image<'static> {
    let bytes = include_bytes!("../icons/vpeticon.png");
    let img = image::load_from_memory(bytes)
        .expect("无法加载托盘图标")
        .into_rgba8();
    let (w, h) = img.dimensions();
    tauri::image::Image::new_owned(img.into_raw(), w, h)
}
