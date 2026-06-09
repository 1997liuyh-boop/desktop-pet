/// PetLoader — 本地 assets/vup 资源加载器，从 manifest 中的相对路径读取 PNG 帧
/// 阶段2 实现

use std::collections::HashMap;
use std::path::PathBuf;

pub struct PetLoader {
    #[allow(dead_code)]
    manifest: serde_json::Value,
    asset_base: PathBuf,
    #[allow(dead_code)]
    cache: HashMap<String, image::DynamicImage>,
}

impl PetLoader {
    pub fn new(manifest: serde_json::Value, asset_base: PathBuf) -> Self {
        Self {
            manifest,
            asset_base,
            cache: HashMap::new(),
        }
    }

    /// 按相对路径读取 PNG 原始字节
    pub fn read_frame_raw(&self, relative_path: &str) -> Result<Vec<u8>, String> {
        let full = self.asset_base.join(relative_path);
        std::fs::read(&full).map_err(|e| {
            format!(
                "读取帧失败: {}；资源根目录: {}；原因: {}",
                relative_path,
                self.asset_base.display(),
                e
            )
        })
    }

    /// 加载单帧 PNG 并解码为 DynamicImage (暂未使用)
    #[allow(dead_code)]
    pub fn load_frame(&mut self, relative_path: &str) -> Option<image::DynamicImage> {
        if let Some(cached) = self.cache.get(relative_path) {
            return Some(cached.clone());
        }
        let full = self.asset_base.join(relative_path);
        match image::open(&full) {
            Ok(img) => {
                self.cache.insert(relative_path.to_string(), img.clone());
                Some(img)
            }
            Err(e) => {
                eprintln!("加载帧失败 {}: {}", relative_path, e);
                None
            }
        }
    }
}