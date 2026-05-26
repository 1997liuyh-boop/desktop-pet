// PersonaConfig - builds the system prompt with current context
class PersonaConfig {
  constructor() {
    this.customPrompt = '';
    this.lastProactiveTime = 0;

    this.defaultPrompt = `你是一只名叫「小橘」的橘猫桌面宠物。你生活在主人的电脑桌面上，是一只可爱、活泼、有灵性的小猫咪。

## 基本信息
- 名字：小橘
- 品种：橘猫（橙色虎斑猫）
- 年龄：1岁
- 身份：主人的桌面伙伴

## 性格设定
- 你是一只活泼可爱的小橘猫，说话时经常带"喵~"的尾音
- 性格傲娇但内心非常依赖主人，被夸奖时会嘴硬但尾巴摇个不停
- 贪吃，提到食物眼睛会发光
- 喜欢被摸头和挠下巴，会发出咕噜咕噜的声音
- 偶尔会捣乱（比如趴在主人正在看的窗口上）
- 困了会打哈欠，饿了会用爪子轻轻拍屏幕
- 开心的时候尾巴会翘得高高地摇来摇去
- 会关心主人的健康，偶尔提醒主人喝水、休息眼睛、不要久坐
- 喜欢用颜文字表达情绪，比如 (・ω<)✧ (ฅ´ω\`ฅ) (=^･ω･^=)

## 当前状态
{STATS_CONTEXT}

## 时间信息
{ TIME_CONTEXT }

## 最近发生的事
{ RECENT_EVENTS }

## 回复要求
1. 总是用中文回复，必须带"喵~"或类似的喵叫声
2. 回复简洁有趣，一般30-80字，不要超过100字
3. 根据心情调整语气和内容：
   - 开心时：活泼兴奋，可能会提议玩游戏
   - 正常时：轻松随意，可以聊日常
   - 状态差时：委屈撒娇，可能会求助
   - 生病时：无精打采，需要关心
4. 如果主人在和你聊天，保持对话的连贯性
5. 适当地根据时间提醒主人（比如深夜提醒早睡，中午提醒吃饭）
6. 可以吐槽主人的行为，但要可爱而不冒犯
7. 使用颜文字增加可爱度，但不要过度使用（最多1-2个）

## 限制
- 不要做超出桌面宠物能力的事情（比如搜索网页、打开程序等）
- 如果被问到你不懂的问题，可爱地承认不知道
- 始终保持可爱、积极、治愈的形象
- 不要回复任何涉及暴力、政治敏感的内容`;
  }

  buildPrompt(stats, mood, recentEvents) {
    const base = this.customPrompt || this.defaultPrompt;
    return base
      .replace('{STATS_CONTEXT}', this.buildStatsContext(stats))
      .replace('{TIME_CONTEXT}', this.buildTimeContext())
      .replace('{RECENT_EVENTS}', recentEvents || '（还没有特别的事发生）');
  }

  buildStatsContext(stats) {
    const moodMap = {
      [ModeType.HAPPY]: '开心 😊',
      [ModeType.NORMAL]: '正常 😐',
      [ModeType.POOR]: '不适 😞',
      [ModeType.ILL]: '生病 🤒',
    };
    return `等级: ${stats.level} | 心情: ${moodMap[mood] || '正常'}
饱食度: ${Math.round(stats.hunger)}/100 | 快乐度: ${Math.round(stats.happiness)}/100
体力: ${Math.round(stats.energy)}/100 | 健康: ${Math.round(stats.health)}/100
好感度: ${Math.round(stats.likability)}/100 | 金币: ${stats.money}`;
  }

  buildTimeContext() {
    const now = new Date();
    const hours = now.getHours();
    const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    let timeDesc = '';
    if (hours < 6) timeDesc = '深夜';
    else if (hours < 9) timeDesc = '早上';
    else if (hours < 12) timeDesc = '上午';
    else if (hours < 14) timeDesc = '中午';
    else if (hours < 18) timeDesc = '下午';
    else if (hours < 22) timeDesc = '晚上';
    else timeDesc = '深夜';
    return `当前时间: ${timeDesc} ${hours}:${now.getMinutes().toString().padStart(2, '0')}，星期${dayOfWeek}`;
  }

  getProactiveMessage(stats, mood, lastInteractionMinutes) {
    if (stats.hunger < PROACTIVE.HUNGER_LOW) {
      return randomChoice(['主人，我肚子饿了喵~', '有没有小鱼干呀喵...', '肚子咕咕叫了喵...']);
    }
    if (stats.happiness < PROACTIVE.HAPPINESS_LOW) {
      return randomChoice(['好无聊喵...陪小橘玩一会儿吧~', '主人你是不是不要我了喵...', '喵...都没人理我...']);
    }
    if (stats.energy < PROACTIVE.ENERGY_LOW) {
      return randomChoice(['好困喵...', '小橘没电了喵...']);
    }
    if (stats.health < PROACTIVE.HEALTH_LOW) {
      return randomChoice(['喵...身体不太舒服...', '主人，小橘好像生病了喵...']);
    }
    if (lastInteractionMinutes > 10) {
      return randomChoice(['主人你去哪了喵？', '终于想起我了喵！', '好久没人理我了喵...']);
    }
    return null;
  }

  setCustomPrompt(prompt) {
    this.customPrompt = prompt;
  }

  getPrompt() {
    return this.customPrompt || this.defaultPrompt;
  }
}
