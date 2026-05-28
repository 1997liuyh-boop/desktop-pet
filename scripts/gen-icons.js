// 生成 Tauri 需要的最小占位图标
// 运行: node scripts/gen-icons.js

const fs = require('fs');
const path = require('path');

// 最小有效 PNG (1x1 橙色像素)
function createMinimalPNG(size) {
  // PNG 文件结构: signature + IHDR + IDAT + IEND
  const width = size;
  const height = size;
  
  // 使用更简单的方式: 写一个最小的有效 PNG
  // 实际上 Tauri 编译时需要真实图标，先用 1x1 占位
  const png = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, // IHDR length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width: 1
    0x00, 0x00, 0x00, 0x01, // height: 1
    0x08, 0x02, // 8-bit RGB
    0x00, 0x00, 0x00, // compression, filter, interlace
    0x90, 0x77, 0x53, 0xDE, // CRC
    0x00, 0x00, 0x00, 0x0C, // IDAT length
    0x49, 0x44, 0x41, 0x54, // IDAT
    0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // compressed data (orange-ish)
    0xE2, 0x21, 0xBC, 0x33, // CRC
    0x00, 0x00, 0x00, 0x00, // IEND length
    0x49, 0x45, 0x4E, 0x44, // IEND
    0xAE, 0x42, 0x60, 0x82  // CRC
  ]);
  
  return png;
}

const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const files = [
  '32x32.png',
  '128x128.png', 
  '128x128@2x.png',
  'icon.icns',
  'icon.ico'
];

const png = createMinimalPNG(1);
for (const file of files) {
  fs.writeFileSync(path.join(iconsDir, file), png);
  console.log(`Created: ${file}`);
}

console.log('Done! 占位图标已生成。生产构建前需要替换为真实图标。');