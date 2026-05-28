// 生成有效的 Windows ICO 文件 (16x16 + 32x32 + 48x48)
// 运行: node scripts/gen-ico.js

const fs = require('fs');
const path = require('path');
const { createCanvas } = (() => {
  // 不依赖 canvas 库，手写 ICO 二进制
  return { createCanvas: null };
})();

function createOrangeIco() {
  // ICO 文件格式:
  // ICONDIR (6 bytes) + ICONDIRENTRY * N + PNG data * N

  // 生成不同尺寸的 PNG
  const sizes = [16, 32, 48];

  // 用最简方式: 创建有效的 PNG 字节
  function createPng(width, height) {
    // 使用 zlib 压缩的 IDAT
    const zlib = require('zlib');

    // 构建原始图像数据 (每行: filter byte + RGBA pixels)
    const rawData = [];
    for (let y = 0; y < height; y++) {
      rawData.push(0); // filter: none
      for (let x = 0; x < width; x++) {
        // 橙色圆形
        const cx = width / 2, cy = height / 2;
        const r = width * 0.4;
        const dx = x - cx + 0.5, dy = y - cy + 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < r) {
          // 橙色
          rawData.push(0xFF, 0x98, 0x00, 0xFF); // R, G, B, A
        } else {
          // 透明
          rawData.push(0, 0, 0, 0);
        }
      }
    }

    const rawBuf = Buffer.from(rawData);
    const compressed = zlib.deflateSync(rawBuf);

    // 构建 PNG
    const chunks = [];

    // Signature
    chunks.push(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));

    // IHDR
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type: RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace
    chunks.push(makeChunk('IHDR', ihdr));

    // IDAT
    chunks.push(makeChunk('IDAT', compressed));

    // IEND
    chunks.push(makeChunk('IEND', Buffer.alloc(0)));

    return Buffer.concat(chunks);
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);

    const typeB = Buffer.from(type, 'ascii');
    const crcData = Buffer.concat([typeB, data]);

    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData), 0);

    return Buffer.concat([len, typeB, data, crc]);
  }

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  const pngs = sizes.map(s => createPng(s, s));

  // ICO header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);    // reserved
  header.writeUInt16LE(1, 2);    // type: ICO
  header.writeUInt16LE(sizes.length, 4); // image count

  // ICO directory entries
  const entries = [];
  let dataOffset = 6 + sizes.length * 16;

  for (let i = 0; i < sizes.length; i++) {
    const entry = Buffer.alloc(16);
    entry[0] = sizes[i] >= 256 ? 0 : sizes[i]; // width
    entry[1] = sizes[i] >= 256 ? 0 : sizes[i]; // height
    entry[2] = 0;   // color palette
    entry[3] = 0;   // reserved
    entry.writeUInt16LE(1, 4);  // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(pngs[i].length, 8); // size
    entry.writeUInt32LE(dataOffset, 12);     // offset
    entries.push(entry);
    dataOffset += pngs[i].length;
  }

  return Buffer.concat([header, ...entries, ...pngs]);
}

function createPngIcon(size) {
  // 复用 ICO 中的 PNG 生成逻辑
  const zlib = require('zlib');

  const rawData = [];
  for (let y = 0; y < size; y++) {
    rawData.push(0);
    for (let x = 0; x < size; x++) {
      const cx = size / 2, cy = size / 2;
      const r = size * 0.4;
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < r) {
        rawData.push(0xFF, 0x98, 0x00, 0xFF);
      } else {
        rawData.push(0, 0, 0, 0);
      }
    }
  }

  const rawBuf = Buffer.from(rawData);
  const compressed = zlib.deflateSync(rawBuf);

  const chunks = [];
  chunks.push(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(makeChunk('IHDR', ihdr));
  chunks.push(makeChunk('IDAT', compressed));
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type, 'ascii');
    const crcData = Buffer.concat([typeB, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData), 0);
    return Buffer.concat([len, typeB, data, crc]);
  }

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
}

const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

// 生成 ICO
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), createOrangeIco());
console.log('Created: icon.ico (16+32+48)');

// 生成 PNG 图标
fs.writeFileSync(path.join(iconsDir, '32x32.png'), createPngIcon(32));
console.log('Created: 32x32.png');

fs.writeFileSync(path.join(iconsDir, '128x128.png'), createPngIcon(128));
console.log('Created: 128x128.png');

fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), createPngIcon(256));
console.log('Created: 128x128@2x.png');

// ICNS 用 PNG 占位 (macOS 专用, Windows 构建不会用到)
fs.writeFileSync(path.join(iconsDir, 'icon.icns'), createPngIcon(128));
console.log('Created: icon.icns (png placeholder)');

console.log('Done! 所有图标已生成。');