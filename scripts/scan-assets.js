// 扫描 VPet 资产目录，生成动画清单 JSON
// 用法: node scripts/scan-assets.js <VPet_vup_dir> <output_json>

const fs = require('fs');
const path = require('path');

const VPET_DIR = process.argv[2] || 'D:/demo3/VPet/VPet-Simulator.Windows/mod/0000_core/pet/vup';
const OUTPUT = process.argv[3] || 'assets/pet-manifest.json';

// === GraphType 映射：目录名 → 动画类型 ===
const DIR_TO_GRAPH = {
  'Default': 'default',
  'MOVE': 'move',
  'IDEL': 'idle',
  'Sleep': 'sleep',
  'StartUP': 'startup',
  'Shutdown': 'shutdown',
  'Touch_Head': 'touch_head',
  'Touch_Body': 'touch_body',
  'Raise': 'raise',
  'Pinch': 'pinch',
  'Say': 'say',
  'Eat': 'eat',
  'Drink': 'drink',
  'WORK': 'work',
  'Think': 'think',
  'Music': 'music',
  'Gift': 'gift',
  'BDay': 'bday',
  'LevelUP': 'levelup',
  'State': 'state',
  'Switch': 'switch',
  'SideHide_Left_Main': 'sidehide_left_main',
  'SideHide_Left_Rise': 'sidehide_left_rise',
  'SideHide_Right_Main': 'sidehide_right_main',
  'SideHide_Right_Rise': 'sidehide_right_rise',
};

// === ModeType 映射：子目录名 → 状态 ===
const DIR_TO_MODE = {
  'Happy': 'happy',
  'Nomal': 'normal',     // VPet 原文拼写
  'PoorCondition': 'poorCondition',
  'Ill': 'ill',
  'ill': 'ill',
};

// === animatType 映射：子目录名模式 ===
function guessAnimatType(dirName) {
  const upper = dirName.toUpperCase();
  if (upper.startsWith('A_') || upper === 'A') return 'a_start';
  if (upper.startsWith('B_') || upper === 'B') return 'b_loop';
  if (upper.startsWith('C_') || upper === 'C') return 'c_end';
  if (upper === 'SINGLE' || upper.startsWith('SINGLE')) return 'single';
  // Default: treat as b_loop if it has numbers
  if (/^[0-9]/.test(dirName) || /^[A-Z]_[0-9]/.test(dirName)) return 'b_loop';
  return 'b_loop'; // fallback
}

// 从文件名提取帧时长（ms）
function extractDuration(filename) {
  const match = filename.match(/_(\d{3,4})\.png$/i);
  if (match) return parseInt(match[1], 10);
  return 125; // default
}

// 扫描目录树
function scanDir(dirPath, relativeRoot) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result = { dirs: {}, pngs: [] };

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(relativeRoot, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      result.dirs[entry.name] = scanDir(fullPath, relativeRoot);
    } else if (entry.name.toLowerCase().endsWith('.png')) {
      result.pngs.push({
        file: relPath,
        name: entry.name,
        duration: extractDuration(entry.name),
        index: parseInt((entry.name.match(/_(\d{3})_/) || [0, 0])[1], 10),
      });
    }
  }

  // Sort PNGs by filename
  result.pngs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return result;
}

// 主扫描函数：从 vup 目录构建动画清单
function buildManifest(vupDir) {
  const root = scanDir(vupDir, vupDir);
  const manifest = { animations: {}, meta: { source: vupDir, scanned: new Date().toISOString() } };

  // 遍历顶级目录（GraphType）
  for (const [graphDirName, graphDir] of Object.entries(root.dirs)) {
    const graphType = DIR_TO_GRAPH[graphDirName];
    if (!graphType) {
      console.log(`跳过未知 GraphType: ${graphDirName}`);
      continue;
    }

    manifest.animations[graphType] = {};

    // 遍历二级目录：可能是 ModeType 或 AnimatType
    for (const [subName, subDir] of Object.entries(graphDir.dirs)) {
      const modeType = DIR_TO_MODE[subName];

      if (modeType) {
        // subName 是 ModeType，下一层是 AnimatType
        manifest.animations[graphType][modeType] = {};

        for (const [animName, animDir] of Object.entries(subDir.dirs)) {
          const animatType = guessAnimatType(animName);
          const frames = collectFramePaths(animDir, vupDir);
          if (frames.length > 0) {
            manifest.animations[graphType][modeType][animatType] = frames;
          }
        }

        // 如果该 modeType 目录下直接有 PNG
        if (subDir.pngs.length > 0) {
          manifest.animations[graphType][modeType]['single'] = collectPngs(subDir, vupDir);
        }

      } else {
        // subName 是 AnimatType，无 ModeType 区分（所有状态通用）
        const animatType = guessAnimatType(subName);
        const frames = collectFramePaths(subDir, vupDir);
        if (frames.length > 0) {
          // 注册到所有 4 种状态
          for (const mt of ['happy', 'normal', 'poorCondition', 'ill']) {
            if (!manifest.animations[graphType][mt]) {
              manifest.animations[graphType][mt] = {};
            }
            manifest.animations[graphType][mt][animatType] = frames;
          }
        }
      }
    }

    // 顶级目录直接有 PNG（无子目录）
    if (graphDir.pngs.length > 0) {
      for (const mt of ['happy', 'normal', 'poorCondition', 'ill']) {
        if (!manifest.animations[graphType][mt]) {
          manifest.animations[graphType][mt] = {};
        }
        manifest.animations[graphType][mt]['single'] = collectPngs(graphDir, vupDir);
      }
    }
  }

  return manifest;
}

function collectFramePaths(dir, root) {
  const frames = [];
  _collectFrames(dir, root, frames);
  // Sort by filename naturally
  frames.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return frames;
}

function _collectFrames(dir, root, out) {
  for (const p of dir.pngs) out.push(p);
  for (const [_, sub] of Object.entries(dir.dirs)) {
    _collectFrames(sub, root, out);
  }
}

function collectPngs(dir, root) {
  return dir.pngs.map(p => p);
}

// === 运行 ===
try {
  const manifest = buildManifest(VPET_DIR);
  fs.writeFileSync(OUTPUT, JSON.stringify(manifest, null, 2), 'utf-8');

  // 统计
  let totalAnims = 0;
  for (const [gt, modes] of Object.entries(manifest.animations)) {
    for (const [mt, atypes] of Object.entries(modes)) {
      totalAnims += Object.keys(atypes).length;
    }
  }
  console.log(`扫描完成: ${Object.keys(manifest.animations).length} 种动画类型, ${totalAnims} 个动画片段`);
  console.log(`输出: ${OUTPUT}`);
} catch (e) {
  console.error('扫描失败:', e.message);
  process.exit(1);
}