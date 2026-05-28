// === VPet 风格的动画类型层级 ===
// GraphType (动作大类) → AnimatType (动作段) × ModeType (状态)

const GraphType = {
  DEFAULT:    'default',      // 默认待机
  MOVE:       'move',         // 行走
  IDLE:       'idle',         // 空闲变化
  TOUCH_HEAD: 'touch_head',   // 摸头反应
  TOUCH_BODY: 'touch_body',   // 摸身体反应
  SAY:        'say',          // 说话
  EAT:        'eat',          // 吃东西
  DRINK:      'drink',        // 喝水
  SLEEP:      'sleep',        // 睡觉
  STARTUP:    'startup',      // 启动
  SHUTDOWN:   'shutdown',     // 关闭
  WORK:       'work',         // 工作
  HAPPY:      'happy',        // 开心跳跃
  RAISE:      'raise',        // 被提起
  SIT:        'sit',          // 坐下
};

const AnimatType = {
  A_START: 'a_start',   // 开始过渡
  B_LOOP:  'b_loop',    // 循环中间段
  C_END:   'c_end',     // 结束过渡
  SINGLE:  'single',    // 一次性完整动画
};

const ModeType = {
  HAPPY:         'happy',
  NORMAL:        'normal',
  POOR_CONDITION:'poorCondition',
  ILL:           'ill',
};

const Expression = {
  NORMAL:    'normal',
  HAPPY:     'happy',
  SAD:       'sad',
  SLEEPY:    'sleepy',
  SURPRISED: 'surprised',
  SICK:      'sick',
  CURIOUS:   'curious',
  ANGRY:     'angry',
  BLUSH:     'blush',
};

const PetState = {
  IDLE:   'idle',
  WALK:   'walk',
  SIT:    'sit',
  SLEEP:  'sleep',
  HAPPY:  'happy',
  DRAG:   'drag',
  EAT:    'eat',
  WORK:   'work',
  CHAT:   'chat',
  RAISE:  'raise',
  SAY:    'say',
};

const ActivityType = {
  NONE:  null,
  WORK:  'work',
  STUDY: 'study',
  PLAY:  'play',
};

// 动画描述结构（替代 VPet 的 .lps 配置）
// {
//   graphType: string,     // GraphType 枚举值
//   animatType: string,    // AnimatType 枚举值
//   modeTypes: string[],   // 适用的 ModeType 列表
//   frameCount: number,    // 帧数
//   frameInterval: number, // 每帧间隔(ms)
//   loop: boolean,         // 是否循环
//   offsetX: number,       // X偏移
//   offsetY: number,       // Y偏移
// }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GraphType, AnimatType, ModeType, Expression, PetState, ActivityType };
}