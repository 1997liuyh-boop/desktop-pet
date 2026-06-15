// 生成礼物图片 PNG — 纯 Node.js，无外部依赖
// 用法: node scripts/gen-gift-images.js
// 输出: assets/image/food/<礼物名>.png

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const OUT_DIR = path.join('assets', 'image', 'food');

// CRC32 表
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xFF];
  return ((c ^ 0xFFFFFFFF) >>> 0);
}

function chunk(type, data) {
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0);
  const tb  = Buffer.from(type, 'ascii');
  const crcVal = Buffer.allocUnsafe(4);
  crcVal.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crcVal]);
}

// 生成 100×100 PNG (RGBA)，带圆形礼物图标
function makePNG(bgR, bgG, bgB, fgR, fgG, fgB) {
  const W = 100, H = 100;
  const cx = W / 2, cy = H / 2, r1 = 36, r2 = 22;
  const rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.allocUnsafe(1 + W * 4);
    row[0] = 0; // filter None
    for (let x = 0; x < W; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const inOuter = d <= r1;
      const inInner = d <= r2;
      const rr = inInner ? Math.round(fgR * 1.25) : inOuter ? fgR : bgR;
      const gg = inInner ? Math.round(fgG * 1.25) : inOuter ? fgG : bgG;
      const bb = inInner ? Math.round(fgB * 1.25) : inOuter ? fgB : bgB;
      const aa = 255;
      row[1 + x * 4    ] = Math.min(255, rr);
      row[1 + x * 4 + 1] = Math.min(255, gg);
      row[1 + x * 4 + 2] = Math.min(255, bb);
      row[1 + x * 4 + 3] = aa;
    }
    rows.push(row);
  }
  const raw  = Buffer.concat(rows);
  const idat = zlib.deflateSync(raw, { level: 6 });

  const ihdrData = Buffer.from([
    0, 0, 0, W,   // width
    0, 0, 0, H,   // height
    8,            // bit depth
    6,            // color type: RGBA
    0, 0, 0,      // compression, filter, interlace
  ]);

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG sig
    chunk('IHDR', ihdrData),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 礼物图标色彩方案 [名字, 背景RGB, 前景RGB]
const GIFTS = [
  ['小花束',      [255, 235, 240], [230,  80, 120]],
  ['毛绒玩偶',    [240, 230, 255], [150,  90, 210]],
  ['拍立得相机',  [255, 255, 220], [200, 160,  30]],
  ['生日蛋糕',    [255, 235, 210], [230, 110,  40]],
  ['游戏机',      [220, 255, 230], [ 50, 160,  90]],
  ['项链',        [255, 248, 210], [200, 165,  20]],
];

let generated = 0;
for (const [name, [br, bg, bb], [fr, fg, fb]] of GIFTS) {
  const outPath = path.join(OUT_DIR, `${name}.png`);
  if (fs.existsSync(outPath)) {
    console.log(`跳过(已存在): ${name}.png`);
    continue;
  }
  const png = makePNG(br, bg, bb, fr, fg, fb);
  fs.writeFileSync(outPath, png);
  console.log(`生成: ${name}.png  (${png.length} bytes)`);
  generated++;
}
console.log(`\n完成: 生成 ${generated} 张礼物图片 → ${OUT_DIR}`);
