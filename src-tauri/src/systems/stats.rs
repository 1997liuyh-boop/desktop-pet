use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use rand::Rng;
use crate::systems::work::{Work, WorkType, WorkingState};

/// 体力上限 (对标 VPet StrengthMax)
const STRENGTH_MAX: f64 = 100.0;

/// 宠物属性数据 — 1:1 复刻 VPet GameSave.cs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsData {
    pub name: String,
    /// 金钱
    pub money: f64,
    /// 经验值 (VPet 中为浮点累加值)
    pub exp: f64,

    /// 体力 0-100
    pub strength: f64,
    /// 待补充的体力 (随时间缓慢加给桌宠)
    pub store_strength: f64,
    /// 变化 体力
    pub change_strength: f64,

    /// 饱腹度 0-100
    pub strength_food: f64,
    pub store_strength_food: f64,
    pub change_strength_food: f64,

    /// 口渴度 0-100
    pub strength_drink: f64,
    pub store_strength_drink: f64,
    pub change_strength_drink: f64,

    /// 心情 0-100
    pub feeling: f64,
    pub change_feeling: f64,

    /// 健康 (隐藏) 0-100
    pub health: f64,
    /// 好感度 (隐藏, 累加值)
    pub likability: f64,

    /// 当前状态 happy/normal/poorCondition/ill
    pub mode: String,

    /// 距上次交互的秒数 (用于 freedrop 心情自然下降)
    pub seconds_since_interaction: f64,
    /// FunctionSpend 15 秒 tick 累加器
    pub tick_accumulator: f64,

    pub last_update: u64,
}

impl Default for StatsData {
    /// 新游戏初始值 — 对标 VPet GameSave(string name) 构造
    fn default() -> Self {
        let mut d = Self {
            name: "小橘".into(),
            money: 100.0,
            exp: 0.0,
            strength: 100.0,
            store_strength: 0.0,
            change_strength: 0.0,
            strength_food: 100.0,
            store_strength_food: 0.0,
            change_strength_food: 0.0,
            strength_drink: 100.0,
            store_strength_drink: 0.0,
            change_strength_drink: 0.0,
            feeling: 60.0,
            change_feeling: 0.0,
            health: 100.0,
            likability: 0.0,
            mode: "normal".into(),
            seconds_since_interaction: 0.0,
            tick_accumulator: 0.0,
            last_update: 0,
        };
        d.mode = mode_to_str(d.cal_mode());
        d
    }
}

/// ModeType 数值: 0=Happy 1=Nomal 2=PoorCondition 3=Ill (对标 VPet IGameSave.ModeType)
fn mode_to_str(mode: i32) -> String {
    match mode {
        0 => "happy",
        2 => "poorCondition",
        3 => "ill",
        _ => "normal",
    }
    .to_string()
}

impl StatsData {
    // ===== 等级 / 上限 (对标 GameSave 派生属性) =====

    /// 等级: Exp<0 ? 1 : sqrt(Exp)/10 + 1
    pub fn level(&self) -> i32 {
        if self.exp < 0.0 {
            1
        } else {
            (self.exp.sqrt() / 10.0) as i32 + 1
        }
    }

    /// 升级所需经验值: (Level*10)^2
    pub fn level_up_need(&self) -> f64 {
        (self.level() as f64 * 10.0).powi(2)
    }

    /// 好感度上限: 90 + Level*10
    pub fn likability_max(&self) -> f64 {
        90.0 + self.level() as f64 * 10.0
    }

    /// 心情上限 (对标 Core GameSave.FeelingMax => 100)
    pub fn feeling_max(&self) -> f64 {
        100.0
    }

    // ===== 带溢出的 setter (对标 GameSave 的属性 setter) =====

    fn set_strength(&mut self, value: f64) {
        self.strength = STRENGTH_MAX.min(value.max(0.0));
    }

    fn set_health(&mut self, value: f64) {
        self.health = 100.0_f64.min(value.max(0.0));
    }

    /// 饱腹度 setter: value<=0 时溢出量计入健康
    fn set_strength_food(&mut self, value: f64) {
        let value = 100.0_f64.min(value);
        if value <= 0.0 {
            self.set_health(self.health + value);
            self.strength_food = 0.0;
        } else {
            self.strength_food = value;
        }
    }

    /// 口渴度 setter: value<=0 时溢出量计入健康
    fn set_strength_drink(&mut self, value: f64) {
        let value = 100.0_f64.min(value);
        if value <= 0.0 {
            self.set_health(self.health + value);
            self.strength_drink = 0.0;
        } else {
            self.strength_drink = value;
        }
    }

    /// 心情 setter: value<=0 时溢出量一半计健康一半计好感度
    fn set_feeling(&mut self, value: f64) {
        let value = 100.0_f64.min(value);
        if value <= 0.0 {
            self.set_health(self.health + value / 2.0);
            self.set_likability(self.likability + value / 2.0);
            self.feeling = 0.0;
        } else {
            self.feeling = value;
        }
    }

    /// 好感度 setter: 超过上限的部分计入健康
    fn set_likability(&mut self, value: f64) {
        let max = self.likability_max();
        let value = value.max(0.0);
        if value > max {
            self.likability = max;
            self.set_health(self.health + value - max);
        } else {
            self.likability = value;
        }
    }

    // ===== 变化方法 (记录 Change 并应用) =====

    fn strength_change(&mut self, value: f64) {
        self.change_strength += value;
        self.set_strength(self.strength + value);
    }

    fn strength_change_food(&mut self, value: f64) {
        self.change_strength_food += value;
        self.set_strength_food(self.strength_food + value);
    }

    fn strength_change_drink(&mut self, value: f64) {
        self.change_strength_drink += value;
        self.set_strength_drink(self.strength_drink + value);
    }

    fn feeling_change(&mut self, value: f64) {
        self.change_feeling += value;
        self.set_feeling(self.feeling + value);
    }

    /// 清除变化 (各 Change 减半)
    fn clean_change(&mut self) {
        self.change_strength /= 2.0;
        self.change_feeling /= 2.0;
        self.change_strength_drink /= 2.0;
        self.change_strength_food /= 2.0;
    }

    /// 取回被储存的体力 (每 tick 释放 1/10)
    fn store_take(&mut self) {
        const T: f64 = 10.0;

        let s = self.store_strength / T;
        self.store_strength -= s;
        if self.store_strength.abs() < 1.0 {
            self.store_strength = 0.0;
        } else {
            self.strength_change(s);
        }

        let s = self.store_strength_drink / T;
        self.store_strength_drink -= s;
        if self.store_strength_drink.abs() < 1.0 {
            self.store_strength_drink = 0.0;
        } else {
            self.strength_change_drink(s);
        }

        let s = self.store_strength_food / T;
        self.store_strength_food -= s;
        if self.store_strength_food.abs() < 1.0 {
            self.store_strength_food = 0.0;
        } else {
            self.strength_change_food(s);
        }
    }

    /// 吃食物 (对标 GameSave.EatFood)
    #[allow(clippy::too_many_arguments)]
    pub fn eat_food(
        &mut self,
        exp: f64,
        strength: f64,
        strength_food: f64,
        strength_drink: f64,
        feeling: f64,
        health: f64,
        likability: f64,
    ) {
        self.exp += exp;
        let tmp = strength / 2.0;
        self.strength_change(tmp);
        self.store_strength += tmp;
        let tmp = strength_food / 2.0;
        self.strength_change_food(tmp);
        self.store_strength_food += tmp;
        let tmp = strength_drink / 2.0;
        self.strength_change_drink(tmp);
        self.store_strength_drink += tmp;
        self.feeling_change(feeling);
        self.set_health(self.health + health);
        self.set_likability(self.likability + likability);
    }

    /// 计算宠物当前状态 (对标 GameSave.CalMode) -> 0=Happy 1=Nomal 2=PoorCondition 3=Ill
    pub fn cal_mode(&self) -> i32 {
        let realhel: i32 = 60
            - (if self.feeling >= 80.0 { 12 } else { 0 })
            - (if self.likability >= 80.0 {
                12
            } else if self.likability >= 40.0 {
                6
            } else {
                0
            });
        // 先从最次的开始
        if self.health <= realhel as f64 {
            if self.health <= (realhel / 2) as f64 {
                return 3; // 生病
            } else {
                return 2; // 状态不佳
            }
        }
        // 再判断高兴还是普通
        let realfel = 0.90
            - (if self.likability >= 80.0 {
                0.20
            } else if self.likability >= 40.0 {
                0.10
            } else {
                0.0
            });
        let felps = self.feeling / self.feeling_max();
        if felps >= realfel {
            0 // Happy
        } else if felps <= realfel / 2.0 {
            2 // PoorCondition
        } else {
            1 // Nomal
        }
    }

    /// 当前心情字符串 (供动画选择)
    pub fn get_mood(&self) -> String {
        mode_to_str(self.cal_mode())
    }

    /// 状态消耗 tick — 1:1 复刻 VPet MainLogic.FunctionSpend(TimePass)
    /// 返回 (本 tick 工作收益累计, 是否因生病需停止工作)
    pub fn function_spend(
        &mut self,
        time_pass: f64,
        state: WorkingState,
        now_work: Option<&Work>,
    ) -> (f64, bool) {
        let mut rng = rand::thread_rng();
        // Rnd.Next(min,max): [min,max) 整数
        let rnd_next = |rng: &mut rand::rngs::ThreadRng, min: i32, max: i32| -> f64 {
            if max <= min {
                min as f64
            } else {
                rng.gen_range(min..max) as f64
            }
        };

        self.clean_change();
        self.store_take();

        let mut freedrop = self.seconds_since_interaction / 60.0;
        if freedrop < 1.0 {
            freedrop = 0.0;
        } else {
            freedrop = (freedrop.sqrt() * time_pass / 4.0).min(self.feeling_max() / 800.0);
        }

        let sm25 = STRENGTH_MAX * 0.25;
        let sm50 = STRENGTH_MAX * 0.5;
        let sm60 = STRENGTH_MAX * 0.6;
        let sm75 = STRENGTH_MAX * 0.75;

        let mut work_get_count_add = 0.0;

        match state {
            WorkingState::Empty => {}
            WorkingState::Sleep => {
                // 睡觉: 缓慢恢复所有(心情不下降)
                self.strength_change(time_pass * 2.0);
                self.strength_change_food(time_pass);
                if self.strength_food <= sm25 {
                    self.strength_change_food(time_pass);
                } else if self.strength_food >= sm75 {
                    self.set_health(self.health + time_pass * 2.0);
                }
                self.strength_change_drink(time_pass);
                if self.strength_drink >= sm25 {
                    self.strength_change_drink(time_pass);
                } else if self.strength_drink >= sm75 {
                    self.set_health(self.health + time_pass * 2.0);
                }
                self.seconds_since_interaction = 0.0;
            }
            WorkingState::Work => {
                if let Some(work) = now_work {
                    let mut needfood = time_pass * work.strength_food;
                    let mut needdrink = time_pass * work.strength_drink;
                    let mut efficiency = 0.0;
                    let mut addhealth = -2.0;

                    let nsfood = needfood * 0.3;
                    let nsdrink = needdrink * 0.3;
                    if self.strength > sm25 + nsfood + nsdrink {
                        // 可用体力减少消耗并增加效率
                        self.strength_change(-nsfood - nsdrink);
                        efficiency += 0.1;
                        needfood -= nsfood;
                        needdrink -= nsdrink;
                    }

                    if self.strength_food <= sm25 {
                        // 低状态低效率
                        self.strength_change_food(-needfood / 2.0);
                        efficiency += 0.2;
                        if self.strength >= needfood {
                            self.strength_change(-needfood);
                            efficiency += 0.1;
                        }
                        addhealth -= 2.0;
                    } else {
                        self.strength_change_food(-needfood);
                        efficiency += 0.4;
                        if self.strength_food >= sm60 {
                            addhealth += rnd_next(&mut rng, 1, 3);
                            efficiency += 0.1;
                        }
                    }

                    if self.strength_drink <= sm25 {
                        self.strength_change_drink(-needdrink / 2.0);
                        efficiency += 0.2;
                        if self.strength >= needdrink {
                            self.strength_change(-needdrink);
                            efficiency += 0.1;
                        }
                        addhealth -= 2.0;
                    } else {
                        self.strength_change_drink(-needdrink);
                        efficiency += 0.4;
                        if self.strength_drink >= sm60 {
                            addhealth += rnd_next(&mut rng, 1, 3);
                            efficiency += 0.1;
                        }
                    }

                    if addhealth > 0.0 {
                        self.set_health(self.health + addhealth * time_pass);
                    }
                    let addmoney =
                        (time_pass * work.money_base * (2.0 * efficiency - 0.5)).max(0.0);
                    if work.work_type == WorkType::Work {
                        self.money += addmoney;
                    } else {
                        self.exp += addmoney;
                    }
                    work_get_count_add = addmoney;

                    if work.work_type == WorkType::Play {
                        self.seconds_since_interaction = 0.0;
                        self.feeling_change(-work.feeling * time_pass);
                    } else {
                        self.feeling_change(-freedrop * (0.5 + work.feeling / 2.0));
                    }
                }
            }
            // 默认 (Nomal / Travel)
            _ => {
                let mut addhealth = -2.0;
                if self.strength_food >= sm50 {
                    self.strength_change_food(-time_pass);
                    self.strength_change(time_pass);
                    if self.strength_food >= sm75 {
                        addhealth += rnd_next(&mut rng, 1, 3);
                    }
                } else if self.strength_food <= sm25 {
                    self.set_health(self.health - rng.gen::<f64>() * time_pass);
                    addhealth -= 2.0;
                }
                if self.strength_drink >= sm50 {
                    self.strength_change_drink(-time_pass);
                    self.strength_change(time_pass);
                    if self.strength_drink >= sm75 {
                        addhealth += rnd_next(&mut rng, 1, 3);
                    }
                } else if self.strength_drink <= sm25 {
                    self.set_health(self.health - rng.gen::<f64>() * time_pass);
                    addhealth -= 2.0;
                }
                if addhealth > 0.0 {
                    self.set_health(self.health + addhealth * time_pass);
                }
                self.strength_change_food(-time_pass);
                self.strength_change_drink(-time_pass);
                self.feeling_change(-freedrop);
            }
        }

        self.exp += time_pass;
        // 心情高提升好感度/经验/健康
        if self.feeling >= self.feeling_max() * 0.75 {
            if self.feeling >= self.feeling_max() * 0.90 {
                self.set_likability(self.likability + time_pass);
            }
            self.exp += time_pass * 2.0;
            self.set_health(self.health + time_pass);
        } else if self.feeling <= 25.0 {
            self.set_likability(self.likability - time_pass);
            self.exp -= time_pass;
        }
        if self.strength_drink <= sm25 {
            self.set_health(self.health - rnd_next(&mut rng, 0, 1) * time_pass);
            self.exp -= time_pass;
        } else if self.strength_drink >= sm75 {
            self.set_health(self.health + rnd_next(&mut rng, 0, 1) * time_pass);
        }

        let newmode = self.cal_mode();
        self.mode = mode_to_str(newmode);
        let should_stop_work_ill = newmode == 3 && state == WorkingState::Work;
        (work_get_count_add, should_stop_work_ill)
    }

    // ===== 手动交互动作 =====

    /// 喂食 (一份基础食物) — 现已由 food 模块按真实食物属性驱动, 保留作兜底
    #[allow(dead_code)]
    pub fn feed(&mut self) {
        self.eat_food(2.0, 0.0, 40.0, 0.0, 3.0, 0.0, 0.0);
    }

    /// 喝水 (一份基础饮料) — 现已由 food 模块按真实食物属性驱动, 保留作兜底
    #[allow(dead_code)]
    pub fn drink(&mut self) {
        self.eat_food(1.0, 0.0, 0.0, 40.0, 2.0, 0.0, 0.0);
    }

    /// 摸头/玩耍 — 提升心情
    pub fn play(&mut self) {
        self.feeling_change(5.0);
    }

    /// 捏脸 — 降低心情
    pub fn pinch(&mut self) {
        self.feeling_change(-5.0);
    }

    /// 增加好感度
    pub fn add_likability(&mut self, amount: f64) {
        self.set_likability(self.likability + amount);
    }

    /// 标记发生交互 (重置自然下降计时)
    pub fn mark_interaction(&mut self) {
        self.seconds_since_interaction = 0.0;
    }
}

/// Stats 系统 — 持有数据 + 存档
pub struct Stats {
    pub data: StatsData,
    save_path: PathBuf,
}

impl Stats {
    pub fn new() -> Self {
        let save_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("data")
            .join("pet-stats.json");

        let data = Self::load_from_file(&save_path).unwrap_or_default();
        Self { data, save_path }
    }

    fn load_from_file(path: &PathBuf) -> Option<StatsData> {
        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    pub fn save(&self) {
        if let Some(parent) = self.save_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&self.data) {
            let _ = fs::write(&self.save_path, json);
        }
    }

    pub fn get_mood(&self) -> String {
        self.data.get_mood()
    }
}
