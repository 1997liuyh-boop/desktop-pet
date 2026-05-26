// Central constants for desktop pet system

// Pet mood modes
const ModeType = {
  HAPPY: 'happy',
  NORMAL: 'normal',
  POOR: 'poorCondition',
  ILL: 'ill',
};

// Expressions
const Expression = {
  NORMAL: 'normal',
  HAPPY: 'happy',
  SAD: 'sad',
  SLEEPY: 'sleepy',
  SURPRISED: 'surprised',
  SICK: 'sick',
  CURIOUS: 'curious',
};

// Activity types
const ActivityType = {
  NONE: null,
  WORK: 'work',
  STUDY: 'study',
  PLAY: 'play',
};

// Default stats
const DEFAULT_STATS = {
  hunger: 80, happiness: 70, energy: 90,
  health: 90, strength: 50, feeling: 70, likability: 50,
  level: 1, exp: 0, money: 0,
};

// Stat decay per second
const STAT_DECAY = {
  hunger: 0.02,
  happiness: 0.015,
  energy: 0.01,
  health: 0.005,
  feeling: 0.008,
  strength: 0.01,
};

// Activity configurations
const ACTIVITY_CONFIG = {
  work: { duration: 1800, rewards: { money: 50, exp: 30, strength: 5, hungerCost: 30, energyCost: 40, feelingCost: -15 } },
  study: { duration: 1200, rewards: { money: 20, exp: 40, strength: 3, hungerCost: 20, energyCost: 30, feelingCost: -10 } },
  play:  { duration: 600,  rewards: { money: 5,  exp: 10, strength: -2, hungerCost: 15, energyCost: 20,  feelingCost: 25 } },
};

// Mood thresholds
const MOOD_THRESHOLDS = {
  HAPPY_MIN_FEELING: 70,
  HAPPY_MIN_HEALTH: 50,
  NORMAL_MIN_FEELING: 30,
  NORMAL_MIN_HEALTH: 30,
  POOR_MIN_FEELING: 10,
  POOR_MIN_HEALTH: 10,
};

// Side-hide settings
const SIDE_HIDE = {
  IDLE_TIMEOUT: 15000,
  TAB_SIZE: 15,
  ANIMATION_DURATION: 300,
  SHOW_ON_HOVER: 30,
};

// Speech settings
const SPEECH_CFG = {
  DEFAULT_SPEED: 40,
  FAST_SPEED: 15,
  FADE_DURATION: 180,
  DISPLAY_TICKS_PER_CHAR: 10,
  CLOSE_STEP: 0.02,
};

// Chat settings
const CHAT_CFG = {
  MAX_HISTORY: 20,
  THINKING_DOT_INTERVAL: 300,
  EXPANDED_WIDTH: 400,
  EXPANDED_HEIGHT: 350,
  BASE_WIDTH: 200,
  BASE_HEIGHT: 250,
};

// LLM defaults
const LLM_DEFAULT = {
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-3.5-turbo',
};

// Pet state machine
const PetState = {
  IDLE: 'idle',
  WALK: 'walk',
  SIT: 'sit',
  SLEEP: 'sleep',
  HAPPY: 'happy',
  DRAG: 'drag',
  EAT: 'eat',
  WORK: 'work',
  CHAT: 'chat',
};

// Proactive speech thresholds
const PROACTIVE = {
  HUNGER_LOW: 25,
  HAPPINESS_LOW: 20,
  ENERGY_LOW: 20,
  HEALTH_LOW: 25,
  IDLE_SPEAK_MIN: 300,    // 5 minutes idle
  IDLE_SPEAK_MAX: 600,    // 10 minutes
};
