const ACTION_GROUPS = [
  { id: 'study', label: '学习面板', shortLabel: '学习', icon: '✒️' },
  { id: 'work', label: '工作面板', shortLabel: '工作', icon: '🎙️' },
  { id: 'monitor', label: '监控面板', shortLabel: '监控', icon: '📡' },
  { id: 'feed', label: '投喂', shortLabel: '投喂', icon: '🍱' },
  { id: 'bag', label: '背包', shortLabel: '背包', icon: '🎒' },
  { id: 'interaction', label: '互动', shortLabel: '互动', icon: '🐾' },
  { id: 'system', label: '系统', shortLabel: '系统', icon: '⚙️' },
];

const ACTION_CATALOG = {
  'study.calligraphy': {
    id: 'study.calligraphy', group: 'study', label: '学书法', icon: '✒️', kind: 'activity',
    activity: { duration: 360, label: '学书法', progressLabel: '墨迹练习中' },
    animation: { graphTypes: ['calligraphy', 'study', 'work', 'idle'], breakGraphTypes: ['playone', 'idle', 'move'] },
    rewards: { exp: 42, money: 12, strength: 2, hungerCost: 16, energyCost: 22, feelingCost: 5 },
    messages: { start: '铺纸研墨，开始练字喵~', complete: '书法练习完成，字更有精神了喵！' },
  },
  'study.paint': {
    id: 'study.paint', group: 'study', label: '学画画', icon: '🎨', kind: 'activity',
    activity: { duration: 360, label: '学画画', progressLabel: '调色创作中' },
    animation: { graphTypes: ['studypaint', 'study', 'work', 'idle'], breakGraphTypes: ['playone', 'idle', 'move'] },
    rewards: { exp: 40, money: 10, strength: 1, hungerCost: 14, energyCost: 20, feelingCost: 8 },
    messages: { start: '拿起画笔，今天画点可爱的喵~', complete: '画画完成，灵感满满喵！' },
  },
  'study.lookAround': {
    id: 'study.lookAround', group: 'study', label: '看看周围', icon: '👀', kind: 'activity',
    activity: { duration: 180, label: '看看周围', progressLabel: '观察环境中' },
    animation: { graphTypes: ['idle', 'move', 'say', 'default'], breakGraphTypes: ['move', 'idle'] },
    rewards: { exp: 12, money: 0, hungerCost: 4, energyCost: 5, feelingCost: 8 },
    messages: { start: '让我看看周围有什么新鲜事喵~', complete: '观察结束，发现好多有趣的东西喵！' },
  },
  'study.dance': {
    id: 'study.dance', group: 'study', label: '跳舞', icon: '♪', kind: 'activity',
    activity: { duration: 240, label: '跳舞练习', progressLabel: '踩节拍中' },
    animation: { graphTypes: ['music', 'playone', 'idle'], breakGraphTypes: ['music', 'playone'] },
    rewards: { exp: 18, money: 4, hungerCost: 8, energyCost: 18, feelingCost: 18 },
    messages: { start: '音乐响起来，跟着节拍动起来喵~', complete: '跳舞练习完成，心情亮晶晶喵！' },
  },
  'work.live': {
    id: 'work.live', group: 'work', label: '直播', icon: '🎙️', kind: 'activity',
    activity: { duration: 480, label: '直播', progressLabel: '直播营业中' },
    animation: { graphTypes: ['worktwo', 'workone', 'work', 'say'], breakGraphTypes: ['say', 'work'] },
    rewards: { exp: 35, money: 70, strength: 3, hungerCost: 24, energyCost: 34, feelingCost: -4 },
    messages: { start: '直播开始，欢迎大家来看小橘喵~', complete: '直播结束，收到好多打赏喵！' },
  },
  'work.cleanScreen': {
    id: 'work.cleanScreen', group: 'work', label: '清屏', icon: '🧽', kind: 'instant',
    animation: { graphTypes: ['workclean', 'work', 'idle'] },
    rewards: { exp: 6, money: 2, hungerCost: 1, energyCost: 3, feelingCost: 2 },
    messages: { start: '我来擦一擦屏幕喵~', complete: '屏幕变干净啦！' },
  },
  'work.copywriting': {
    id: 'work.copywriting', group: 'work', label: '文案', icon: '📝', kind: 'activity',
    activity: { duration: 300, label: '文案', progressLabel: '撰写文案中' },
    animation: { graphTypes: ['workone', 'work', 'idle'], breakGraphTypes: ['playone', 'idle', 'move'] },
    rewards: { exp: 20, money: 15, strength: 1, hungerCost: 10, energyCost: 12, feelingCost: 3 },
    messages: { start: '开始写文案喵~', complete: '文案写完了喵！' },
  },
  'monitor.status': {
    id: 'monitor.status', group: 'monitor', label: '工具监控', icon: '📡', kind: 'monitor',
    animation: { graphTypes: ['workone', 'work', 'idle'] },
    messages: { start: '让我看看主人的 coding 工具状态喵~' },
  },
  'feed.food': {
    id: 'feed.food', group: 'feed', label: '吃饭', icon: '🍚', kind: 'inventory', itemType: 'food',
    animation: { graphTypes: ['eat', 'idle'] },
  },
  'feed.water': {
    id: 'feed.water', group: 'feed', label: '喝水', icon: '🥛', kind: 'inventory', itemType: 'drink',
    animation: { graphTypes: ['drink', 'eat', 'idle'] },
  },
  'feed.medicine': {
    id: 'feed.medicine', group: 'feed', label: '药品', icon: '💊', kind: 'inventory', itemType: 'medicine',
    animation: { graphTypes: ['eat', 'say', 'idle'] },
  },
  'feed.gift': {
    id: 'feed.gift', group: 'feed', label: '礼品', icon: '🎁', kind: 'inventory', itemType: 'gift',
    animation: { graphTypes: ['gift', 'touch_head', 'say', 'idle'] },
  },
  'feed.bag': {
    id: 'feed.bag', group: 'feed', label: '背包', icon: '🎒', kind: 'panel', panel: 'bag',
  },
  'interaction.play': {
    id: 'interaction.play', group: 'interaction', label: '玩耍', icon: '⚽', kind: 'direct', legacyAction: 'play',
  },
  'interaction.pinch': {
    id: 'interaction.pinch', group: 'interaction', label: '捏脸', icon: '🤏', kind: 'direct', legacyAction: 'pinch',
  },
  'interaction.mischief': {
    id: 'interaction.mischief', group: 'interaction', label: '捣蛋', icon: '!', kind: 'direct', legacyAction: 'mischief',
  },
  'system.sleep': {
    id: 'system.sleep', group: 'system', label: '睡觉', icon: '💤', kind: 'direct', legacyAction: 'sleep',
  },
  'system.chat': {
    id: 'system.chat', group: 'system', label: '聊天', icon: '💬', kind: 'direct', legacyAction: 'chat',
  },
  'system.settings': {
    id: 'system.settings', group: 'system', label: '设置', icon: '⚙️', kind: 'direct', legacyAction: 'settings',
  },
};

const TOOLBAR_GROUPS = ['study', 'work', 'monitor', 'feed', 'interaction', 'system'];
const PANEL_GROUPS = ['study', 'work', 'feed', 'bag', 'monitor'];

function getActionMeta(actionId) {
  return ACTION_CATALOG[actionId] || null;
}

function getActionsByGroup(groupId) {
  return Object.values(ACTION_CATALOG).filter(action => action.group === groupId);
}

function getActionGroup(groupId) {
  return ACTION_GROUPS.find(group => group.id === groupId) || null;
}

function getPreferredGraphType(graphCore, mood, graphTypes) {
  const candidates = Array.isArray(graphTypes) ? graphTypes : [];
  for (const graphType of candidates) {
    if (
      graphCore.findCachedExact(graphType, mood, AnimatType.A_START) ||
      graphCore.findCachedExact(graphType, mood, AnimatType.B_LOOP) ||
      graphCore.findCachedExact(graphType, mood, AnimatType.SINGLE) ||
      graphCore.findCachedExact(graphType, ModeType.NORMAL, AnimatType.A_START) ||
      graphCore.findCachedExact(graphType, ModeType.NORMAL, AnimatType.B_LOOP) ||
      graphCore.findCachedExact(graphType, ModeType.NORMAL, AnimatType.SINGLE)
    ) {
      return graphType;
    }
  }
  return candidates[0] || GraphType.DEFAULT;
}