use serde::{Deserialize, Serialize};

/// 工作类型 — 对标 VPet GraphHelper.Work.WorkType
/// Work: 收益进金钱; Study/Play: 收益进经验
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkType {
    Work,
    Study,
    Play,
}

/// 工作态 — 对标 VPet MainLogic.WorkingState
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkingState {
    /// 默认: 啥都没干
    Nomal,
    /// 正在干活/学习中
    Work,
    /// 睡觉
    Sleep,
    /// 旅行
    Travel,
    /// 空 (不消耗)
    Empty,
}

/// 工作定义 — 对标 VPet GraphHelper.Work
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Work {
    pub work_type: WorkType,
    pub name: String,
    pub graph: String,
    /// 工作盈利/学习基本倍率
    pub money_base: f64,
    /// 工作体力(食物)消耗倍率
    pub strength_food: f64,
    /// 工作体力(饮料)消耗倍率
    pub strength_drink: f64,
    /// 心情消耗倍率
    pub feeling: f64,
    /// 等级限制
    pub level_limit: i32,
    /// 花费时间(分钟)
    pub time_minutes: i32,
    /// 完成奖励倍率(0+)
    pub finish_bonus: f64,
}

impl Work {
    /// 工作总时长 (秒)
    pub fn duration_secs(&self) -> f64 {
        self.time_minutes as f64 * 60.0
    }
}

/// VPet vup.lps 中的真实工种定义 (1:1 复刻)
pub fn all_works() -> Vec<Work> {
    vec![
        Work { work_type: WorkType::Work, name: "文案".into(), graph: "workone".into(), money_base: 8.0, strength_food: 3.5, strength_drink: 2.5, feeling: 1.0, level_limit: 0, time_minutes: 60, finish_bonus: 0.1 },
        Work { work_type: WorkType::Work, name: "清屏".into(), graph: "workclean".into(), money_base: 16.0, strength_food: 5.0, strength_drink: 5.0, feeling: 2.5, level_limit: 10, time_minutes: 90, finish_bonus: 0.2 },
        Work { work_type: WorkType::Work, name: "直播".into(), graph: "worktwo".into(), money_base: 28.0, strength_food: 5.0, strength_drink: 10.0, feeling: 4.0, level_limit: 20, time_minutes: 180, finish_bonus: 0.25 },
        Work { work_type: WorkType::Study, name: "学习".into(), graph: "study".into(), money_base: 80.0, strength_food: 2.0, strength_drink: 2.0, feeling: 3.0, level_limit: 0, time_minutes: 45, finish_bonus: 0.2 },
        Work { work_type: WorkType::Study, name: "研究".into(), graph: "studytwo".into(), money_base: 120.0, strength_food: 2.5, strength_drink: 3.5, feeling: 4.0, level_limit: 15, time_minutes: 75, finish_bonus: 0.4 },
        Work { work_type: WorkType::Play, name: "玩游戏".into(), graph: "playone".into(), money_base: 18.0, strength_food: 1.0, strength_drink: 1.5, feeling: -1.0, level_limit: 0, time_minutes: 30, finish_bonus: 0.2 },
        Work { work_type: WorkType::Play, name: "删错误".into(), graph: "removeobject".into(), money_base: 18.0, strength_food: 0.5, strength_drink: 0.5, feeling: -0.5, level_limit: 6, time_minutes: 60, finish_bonus: 0.25 },
        Work { work_type: WorkType::Play, name: "跳绳".into(), graph: "ropeskipping".into(), money_base: 10.0, strength_food: 1.0, strength_drink: 1.0, feeling: 0.5, level_limit: 12, time_minutes: 10, finish_bonus: 0.2 },
        Work { work_type: WorkType::Study, name: "学书法".into(), graph: "calligraphy".into(), money_base: 0.0, strength_food: 1.0, strength_drink: 1.0, feeling: 1.0, level_limit: 8, time_minutes: 20, finish_bonus: 0.2 },
        Work { work_type: WorkType::Study, name: "学画画".into(), graph: "studypaint".into(), money_base: 0.0, strength_food: 2.2, strength_drink: 1.2, feeling: 0.8, level_limit: 25, time_minutes: 120, finish_bonus: 0.25 },
    ]
}

/// 按图名查找工种
pub fn find_work(graph: &str) -> Option<Work> {
    all_works().into_iter().find(|w| w.graph == graph)
}

/// 工作完成结果
pub struct WorkFinish {
    /// 完成奖励 (按类型进入金钱或经验)
    pub bonus: f64,
    pub work_type: WorkType,
}

/// WorkSystem — 当前进行中的工作运行态 (对标 VPet WorkTimer)
pub struct WorkSystem {
    pub is_active: bool,
    pub now_work: Option<Work>,
    /// 已工作时间 (秒)
    pub elapsed_secs: f64,
    /// 累计收益 (FunctionSpend 每 tick 累加, 用于完成奖励)
    pub get_count: f64,
}

impl WorkSystem {
    pub fn new() -> Self {
        Self {
            is_active: false,
            now_work: None,
            elapsed_secs: 0.0,
            get_count: 0.0,
        }
    }

    /// 开始工作
    pub fn start(&mut self, work: Work) {
        self.now_work = Some(work);
        self.is_active = true;
        self.elapsed_secs = 0.0;
        self.get_count = 0.0;
    }

    /// 停止 (中途) — 返回 None (中途停止无完成奖励)
    pub fn stop(&mut self) {
        self.is_active = false;
        self.now_work = None;
        self.elapsed_secs = 0.0;
        self.get_count = 0.0;
    }

    /// 推进计时 (秒); 时间到则返回完成奖励
    pub fn advance(&mut self, dt: f64) -> Option<WorkFinish> {
        if !self.is_active {
            return None;
        }
        self.elapsed_secs += dt;
        let work = self.now_work.as_ref()?;
        if self.elapsed_secs >= work.duration_secs() {
            // 完成: 奖励 = GetCount * FinishBonus
            let finish = WorkFinish {
                bonus: self.get_count * work.finish_bonus,
                work_type: work.work_type,
            };
            self.is_active = false;
            self.now_work = None;
            self.elapsed_secs = 0.0;
            self.get_count = 0.0;
            Some(finish)
        } else {
            None
        }
    }

    /// 进度 0.0 - 1.0
    pub fn progress(&self) -> f64 {
        match &self.now_work {
            Some(w) if w.duration_secs() > 0.0 => (self.elapsed_secs / w.duration_secs()).min(1.0),
            _ => 0.0,
        }
    }
}
