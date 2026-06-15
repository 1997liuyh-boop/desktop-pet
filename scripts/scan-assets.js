// 扫描本地 vup 资产目录，生成动画清单 JSON
// 用法: node scripts/scan-assets.js <assets_vup_dir> <output_json>

const fs = require('fs');
const path = require('path');

const VUP_DIR = process.argv[2] || path.join('assets', 'vup');
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

const MODE_TYPES = ['happy', 'normal', 'poorCondition', 'ill'];

const SWITCH_TO_GRAPH = {
  Up: 'switch_up',
  Down: 'switch_down',
  Hunger: 'switch_hunger',
  Thirsty: 'switch_thirsty',
};

function graphSlug(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function modeFromName(name) {
  if (DIR_TO_MODE[name]) return DIR_TO_MODE[name];
  const lower = String(name || '').toLowerCase();
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.includes('poorcondition') || lower.includes('poorcondition')) return 'poorCondition';
  if (tokens.includes('nomal') || tokens.includes('normal')) return 'normal';
  if (tokens.includes('happy')) return 'happy';
  if (tokens.includes('ill')) return 'ill';
  return null;
}

function sortedDirEntries(node) {
  return Object.entries(node.dirs).sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true })
  );
}

function ensureModePhase(modes, mode, phase) {
  modes[mode] = modes[mode] || {};
  modes[mode][phase] = modes[mode][phase] || null;
  return modes[mode];
}

function setModePhaseOnce(modes, mode, phase, frames) {
  if (!frames || frames.length === 0) return;
  const entry = ensureModePhase(modes, mode, phase);
  if (!entry[phase]) entry[phase] = frames;
}

function firstFrameBranch(node, vupDir) {
  if (node.pngs.length > 0) return collectPngs(node, vupDir);

  for (const [_, child] of sortedDirEntries(node)) {
    const frames = firstFrameBranch(child, vupDir);
    if (frames.length > 0) return frames;
  }

  return [];
}

function parsePhasesInsideMode(modeNode, mode, vupDir, modes) {
  if (modeNode.pngs.length > 0) {
    setModePhaseOnce(modes, mode, 'b_loop', collectPngs(modeNode, vupDir));
  }

  for (const [phaseName, phaseNode] of sortedDirEntries(modeNode)) {
    const phase = guessAnimatType(phaseName);
    const frames = firstFrameBranch(phaseNode, vupDir);
    setModePhaseOnce(modes, mode, phase, frames);
  }
}

function parseGenericPhasesForAllModes(node, vupDir, modes) {
  const phaseDirs = sortedDirEntries(node);
  if (node.pngs.length > 0) {
    for (const mode of MODE_TYPES) {
      setModePhaseOnce(modes, mode, 'b_loop', collectPngs(node, vupDir));
    }
  }

  for (const [phaseName, phaseNode] of phaseDirs) {
    const phase = guessAnimatType(phaseName);
    const frames = firstFrameBranch(phaseNode, vupDir);
    if (!frames.length) continue;
    for (const mode of MODE_TYPES) {
      setModePhaseOnce(modes, mode, phase, frames);
    }
  }
}

function parsePhasedModeTree(rootNode, vupDir) {
  const modes = {};

  if (rootNode.pngs.length > 0) {
    for (const mode of MODE_TYPES) {
      setModePhaseOnce(modes, mode, 'b_loop', collectPngs(rootNode, vupDir));
    }
  }

  for (const [name, node] of sortedDirEntries(rootNode)) {
    const directMode = DIR_TO_MODE[name];
    if (directMode) {
      parsePhasesInsideMode(node, directMode, vupDir, modes);
      continue;
    }

    const childModeDirs = sortedDirEntries(node).filter(([childName]) => !!DIR_TO_MODE[childName]);
    if (childModeDirs.length > 0) {
      for (const [childName, childNode] of childModeDirs) {
        parsePhasesInsideMode(childNode, DIR_TO_MODE[childName], vupDir, modes);
      }
      continue;
    }

    const embeddedMode = modeFromName(name);
    if (embeddedMode) {
      const phase = guessAnimatType(name);
      const frames = firstFrameBranch(node, vupDir);
      setModePhaseOnce(modes, embeddedMode, phase, frames);
      continue;
    }

    parseGenericPhasesForAllModes(node, vupDir, modes);
  }

  for (const [mode, phases] of Object.entries(modes)) {
    for (const [phase, frames] of Object.entries(phases)) {
      if (!frames || frames.length === 0) delete phases[phase];
    }
    if (Object.keys(phases).length === 0) delete modes[mode];
  }

  return modes;
}

function buildSimpleGraph(graphType, graphNode, vupDir, manifest) {
  const modes = parsePhasedModeTree(graphNode, vupDir);
  if (Object.keys(modes).length > 0) manifest.animations[graphType] = modes;
}

function buildStateAnimations(stateRoot, vupDir, manifest) {
  for (const [stateName, stateNode] of sortedDirEntries(stateRoot)) {
    const graphType = stateName.toLowerCase();
    const modes = parsePhasedModeTree(stateNode, vupDir);
    if (Object.keys(modes).length > 0) manifest.animations[graphType] = modes;
  }

  if (manifest.animations.stateone && !manifest.animations.state) {
    manifest.animations.state = manifest.animations.stateone;
  }
}

// === MOVE 专属解析 ===
// MOVE 下每个子目录(walk.left / walk.right.faster / climb.left / fall.left ...)
// 是一个独立的位移动画，graphType 形如 "move.walk.left"。
// 每个子目录内部使用 A_{Mode}/B_{Mode}/C_{Mode} 三阶段或 {Mode}/A,B,C 嵌套形式。
function buildMoveItems(moveRoot, vupDir, manifest) {
  for (const [moveName, moveNode] of sortedDirEntries(moveRoot)) {
    const graphType = `move.${moveName.toLowerCase()}`;
    const modes = parsePhasedModeTree(moveNode, vupDir);
    if (Object.keys(modes).length > 0) {
      manifest.animations[graphType] = modes;
    }
  }
}

function buildSwitchAnimations(switchRoot, vupDir, manifest) {
  for (const [switchName, switchNode] of sortedDirEntries(switchRoot)) {
    const graphType = SWITCH_TO_GRAPH[switchName] || `switch_${graphSlug(switchName)}`;
    const modes = parsePhasedModeTree(switchNode, vupDir);
    if (Object.keys(modes).length > 0) manifest.animations[graphType] = modes;
  }

  if (manifest.animations.switch_down && !manifest.animations.switch) {
    manifest.animations.switch = manifest.animations.switch_down;
  }
}

function buildIdleAnimations(idleRoot, vupDir, manifest) {
  const builtGraphs = [];

  for (const [actionName, actionNode] of sortedDirEntries(idleRoot)) {
    const suffix = graphSlug(actionName);
    if (!suffix) continue;

    const graphType = `idle_${suffix}`;
    const modes = parsePhasedModeTree(actionNode, vupDir);
    if (Object.keys(modes).length > 0) {
      manifest.animations[graphType] = modes;
      builtGraphs.push(graphType);
    }
  }

  const preferred = ['idle_yawning', 'idle_meow', 'idle_aside', 'idle_squat', 'idle_boring']
    .find((graphType) => manifest.animations[graphType]);
  const alias = preferred || builtGraphs[0];
  if (alias && !manifest.animations.idle) {
    manifest.animations.idle = manifest.animations[alias];
  }
}

// === animatType 映射：子目录名模式 ===
// 支持的命名:
//   A / A_xxx / xxx_A   → a_start
//   B / B_xxx / xxx_B   → b_loop
//   C / C_xxx / xxx_C   → c_end
//   {Mode}_A / {Mode}_C → 走路慢速等使用 PoorCondition_A 这种 mode 前缀 + phase 后缀
function guessAnimatType(dirName) {
  const upper = dirName.toUpperCase();
  if (upper.startsWith('A_') || upper === 'A' || /_A(_|$)/.test(upper)) return 'a_start';
  if (upper.startsWith('C_') || upper === 'C' || /_C(_|$)/.test(upper)) return 'c_end';
  if (upper.startsWith('B_') || upper === 'B' || /_B(_|$)/.test(upper)) return 'b_loop';
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
  const entries = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
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
    // WORK 特殊处理: 其下每个子目录(Study/WorkONE/PlayONE...)是一个独立工种动画
    if (graphDirName === 'WORK') {
      buildWorkItems(graphDir, vupDir, manifest);
      continue;
    }

    // Eat/Drink/Gift 特殊处理: VPet FoodAnimation 三层夹心动画
    // 后层(back_lay)=宠物身体, 中间层=物品图(关键帧运动), 前层(front_lay)=爪子/嘴
    if (graphDirName === 'Eat' || graphDirName === 'Drink' || graphDirName === 'Gift') {
      buildFoodAnimation(graphDirName, DIR_TO_GRAPH[graphDirName], graphDir, vupDir, manifest);
      continue;
    }

    const graphType = DIR_TO_GRAPH[graphDirName];
    if (!graphType) {
      console.log(`跳过未知 GraphType: ${graphDirName}`);
      continue;
    }

    if (graphDirName === 'State') {
      buildStateAnimations(graphDir, vupDir, manifest);
      continue;
    }

    if (graphDirName === 'Switch') {
      buildSwitchAnimations(graphDir, vupDir, manifest);
      continue;
    }

    if (graphDirName === 'IDEL') {
      buildIdleAnimations(graphDir, vupDir, manifest);
      continue;
    }

    if (graphDirName === 'MOVE') {
      buildMoveItems(graphDir, vupDir, manifest);
      continue;
    }

    buildSimpleGraph(graphType, graphDir, vupDir, manifest);
  }

  return manifest;
}

// === WORK 专属解析 ===
// WORK 下每个子目录是一个独立工种, 目录名小写即 graphType (workone/study/playone...)
// 工种内部结构有两种:
//   (a) Mode 目录 (Happy/Nomal/PoorCondition/Ill), 内含 A/B/C 阶段子目录
//   (b) 阶段_模式 目录 (A_Nomal / B_1_Nomal / C_Nomal), 直接含帧 PNG; 模式默认为 Nomal
function buildWorkItems(workRoot, vupDir, manifest) {
  for (const [itemName, itemNode] of Object.entries(workRoot.dirs)) {
    const graphType = itemName.toLowerCase();
    const modes = parseWorkItem(itemNode, vupDir);
    if (Object.keys(modes).length > 0) {
      manifest.animations[graphType] = modes;
    }
  }
  // 提供通用 "work" 别名 (回退到文案 workone), 兼容旧调用
  if (manifest.animations['workone'] && !manifest.animations['work']) {
    manifest.animations['work'] = manifest.animations['workone'];
  }
}

// === Eat/Drink 食物动画专属解析 ===
// VPet FoodAnimation: 三层 (back_lay 后/食物中间/front_lay 前)
// 输出每个 mode: { b_loop: 后层帧, b_loop_front: 前层帧, food_anim: 食物关键帧 }
function buildFoodAnimation(graphDirName, graphType, graphDir, vupDir, manifest) {
  const modeDirs = ['Happy', 'Nomal', 'PoorCondition', 'Ill'];
  manifest.animations[graphType] = {};

  // 收集 info.lps 内容: Eat 在各 mode 子目录, Drink 在顶层单文件
  const lpsCache = {};
  for (const md of modeDirs) {
    const p = path.join(vupDir, graphDirName, md, 'info.lps');
    if (fs.existsSync(p)) lpsCache[md] = fs.readFileSync(p, 'utf-8');
  }
  const topLps = (() => {
    const p = path.join(vupDir, graphDirName, 'info.lps');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  })();

  for (const md of modeDirs) {
    const mode = DIR_TO_MODE[md];
    const modeNode = graphDir.dirs[md];
    if (!modeNode) continue;

    const entry = {};

    // 后层: back_lay 或 back → b_loop
    const backNode = modeNode.dirs['back_lay'] || modeNode.dirs['back'];
    if (backNode) {
      const back = collectFramePaths(backNode, vupDir);
      if (back.length) entry.b_loop = back;
    }

    // 前层: front_lay 或 front → b_loop_front (优先 mode 内，回退顶层)
    const frontNode = modeNode.dirs['front_lay'] || modeNode.dirs['front']
      || graphDir.dirs['front_lay'] || graphDir.dirs['front'];
    if (frontNode) {
      const front = collectFramePaths(frontNode, vupDir);
      if (front.length) entry.b_loop_front = front;
    }

    // 食物关键帧: Eat 用各 mode 自己的 info.lps, Drink 用顶层 info.lps
    const lps = lpsCache[md] || topLps;
    const kf = parseFoodKeyframes(lps, graphType, mode);
    if (kf.length) entry.food_anim = kf;

    if (Object.keys(entry).length) manifest.animations[graphType][mode] = entry;
  }
}

// 解析 info.lps 中的 FoodAnimation 关键帧行
// 行格式: FoodAnimation#eat:|mode#nomal:|a0#时长,X,Y,宽,旋转,透明度:|...
// 单值 aI#时长 表示不可见帧(占位等待)
function parseFoodKeyframes(lpsContent, graphName, targetMode) {
  if (!lpsContent) return [];
  const lines = lpsContent.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    // 跳过注释行 (/// 开头)
    if (!line || line.startsWith('///')) continue;
    if (!line.startsWith(`FoodAnimation#${graphName}`)) continue;

    const fields = {};
    for (const seg of line.split(':|')) {
      const i = seg.indexOf('#');
      if (i > 0) fields[seg.slice(0, i)] = seg.slice(i + 1);
    }
    // mode 匹配 (info.lps 拼写: nomal/happy/PoorCondition/ill → 统一映射)
    const lpsMode = DIR_TO_MODE[fields['mode']] || (fields['mode'] || '').toLowerCase();
    const normMode = lpsMode === 'nomal' ? 'normal' : lpsMode;
    if (normMode !== targetMode) continue;

    const frames = [];
    let i = 0;
    while (fields[`a${i}`] !== undefined) {
      const parts = fields[`a${i}`].split(',');
      const time = parseFloat(parts[0]) || 0;
      if (parts.length === 1) {
        // 仅时长 → 不可见占位帧
        frames.push({ time, visible: false });
      } else {
        frames.push({
          time,
          visible: true,
          x: parseFloat(parts[1]) || 0,
          y: parseFloat(parts[2]) || 0,
          width: parseFloat(parts[3]) || 0,
          rotate: parts.length > 4 ? (parseFloat(parts[4]) || 0) : 0,
          opacity: parts.length > 5 ? (parseFloat(parts[5]) || 1) : 1,
        });
      }
      i++;
    }
    return frames;
  }
  return [];
}

// 解析单个工种目录 → { mode: { phase: [frames] } }
function parseWorkItem(itemNode, vupDir) {
  const modes = {};
  const ensure = (mode, phase) => {
    modes[mode] = modes[mode] || {};
    modes[mode][phase] = modes[mode][phase] || [];
    return modes[mode][phase];
  };

  // 按子目录名排序处理, 保证 B_1 在 B_2 之前拼接
  const entries = Object.entries(itemNode.dirs).sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true })
  );

  for (const [subName, subNode] of entries) {
    const subMode = DIR_TO_MODE[subName];

    if (subMode) {
      // (a) Mode 目录: 内含阶段子目录, 或直接含帧
      const phaseEntries = Object.entries(subNode.dirs).sort((a, b) =>
        a[0].localeCompare(b[0], undefined, { numeric: true })
      );
      for (const [phName, phNode] of phaseEntries) {
        const phase = guessAnimatType(phName);
        const frames = collectFramePaths(phNode, vupDir);
        if (frames.length) ensure(subMode, phase).push(...frames);
      }
      if (subNode.pngs.length) {
        ensure(subMode, 'b_loop').push(...subNode.pngs);
      }
    } else {
      // (b) 阶段_模式 目录 (A_Nomal / B_1_Nomal) 或裸阶段目录 (A/B/C)
      const phase = guessAnimatType(subName);
      // 裸阶段目录内部可能再按 Mode 细分 (如 WorkONE/B → Happy/Nomal/PoorCondition)
      const childDirs = Object.keys(subNode.dirs);
      const childModes = childDirs.filter((d) => DIR_TO_MODE[d]);
      if (childDirs.length > 0 && childModes.length === childDirs.length) {
        for (const cm of childModes) {
          const frames = collectFramePaths(subNode.dirs[cm], vupDir);
          if (frames.length) ensure(DIR_TO_MODE[cm], phase).push(...frames);
        }
      } else {
        // 目录名自带模式标记 (A_Nomal), 否则归入 normal
        let mode = 'normal';
        for (const tok of subName.split('_')) {
          if (DIR_TO_MODE[tok]) { mode = DIR_TO_MODE[tok]; break; }
        }
        const frames = collectFramePaths(subNode, vupDir);
        if (frames.length) ensure(mode, phase).push(...frames);
      }
    }
  }

  return modes;
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
  const manifest = buildManifest(VUP_DIR);
  fs.writeFileSync(OUTPUT, JSON.stringify(manifest), 'utf-8');

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