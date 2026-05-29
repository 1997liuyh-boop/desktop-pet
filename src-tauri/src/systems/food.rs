use serde::{Deserialize, Serialize};

/// 食物类型 — 对标 VPet food.lps 的 type 字段
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FoodType {
    /// 饮料 (graph#drink)
    Drink,
    /// 零食/正餐 (graph#eat)
    Food,
}

/// 食物定义 — 1:1 复刻 VPet food.lps / moredrink.lps 的条目
/// 字段对应 VPet: Exp / Strength / StrengthDrink / StrengthFood / Health / Feeling
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Food {
    /// 名字 (同时是图片文件名: image/food/<name>.png)
    pub name: String,
    /// 食物类型
    pub food_type: FoodType,
    /// 经验
    pub exp: f64,
    /// 体力
    pub strength: f64,
    /// 口渴值 (StrengthDrink)
    pub strength_drink: f64,
    /// 饱腹值 (StrengthFood)
    pub strength_food: f64,
    /// 健康
    pub health: f64,
    /// 心情
    pub feeling: f64,
    /// 价格
    pub price: f64,
    /// 动画图名 (eat / drink)
    pub graph: String,
}

impl Food {
    /// 食物图片相对路径 (相对 vup 资产根, 回溯到 image/food/)
    pub fn image_rel_path(&self) -> String {
        format!("../../image/food/{}.png", self.name)
    }
}

/// VPet food.lps + moredrink.lps 中的真实食物数据 (精选可吃/可喝条目, 1:1 复刻属性)
pub fn all_foods() -> Vec<Food> {
    vec![
        // ===== 可吃 (graph#eat) =====
        Food { name: "爆米花".into(), food_type: FoodType::Food, exp: 8.0, strength: 40.0, strength_drink: -5.0, strength_food: 30.0, health: -1.0, feeling: 25.0, price: 8.5, graph: "eat".into() },
        Food { name: "冰激凌".into(), food_type: FoodType::Food, exp: 4.0, strength: 40.0, strength_drink: 5.0, strength_food: 24.0, health: -0.5, feeling: 50.0, price: 10.0, graph: "eat".into() },
        Food { name: "瓜子".into(), food_type: FoodType::Food, exp: 4.0, strength: 30.0, strength_drink: -2.0, strength_food: 26.0, health: 0.0, feeling: 37.0, price: 8.5, graph: "eat".into() },
        Food { name: "核桃仁".into(), food_type: FoodType::Food, exp: 32.0, strength: 20.0, strength_drink: -2.0, strength_food: 5.0, health: 5.0, feeling: 0.0, price: 12.0, graph: "eat".into() },
        Food { name: "火腿肠".into(), food_type: FoodType::Food, exp: 4.0, strength: 40.0, strength_drink: 0.0, strength_food: 38.0, health: -0.5, feeling: 0.0, price: 9.0, graph: "eat".into() },
        Food { name: "花生米".into(), food_type: FoodType::Food, exp: 4.0, strength: 20.0, strength_drink: -2.0, strength_food: 20.0, health: -0.5, feeling: 0.0, price: 4.5, graph: "eat".into() },
        Food { name: "汉堡".into(), food_type: FoodType::Food, exp: 12.0, strength: 60.0, strength_drink: -10.0, strength_food: 70.0, health: -2.0, feeling: 30.0, price: 22.0, graph: "eat".into() },
        Food { name: "红烧牛肉".into(), food_type: FoodType::Food, exp: 40.0, strength: 70.0, strength_drink: -10.0, strength_food: 85.0, health: 2.0, feeling: 40.0, price: 38.0, graph: "eat".into() },
        Food { name: "番茄意面".into(), food_type: FoodType::Food, exp: 32.0, strength: 65.0, strength_drink: 5.0, strength_food: 80.0, health: 1.0, feeling: 35.0, price: 32.0, graph: "eat".into() },
        Food { name: "白切鸡".into(), food_type: FoodType::Food, exp: 32.0, strength: 60.0, strength_drink: 5.0, strength_food: 75.0, health: 3.0, feeling: 30.0, price: 36.0, graph: "eat".into() },
        // ===== 可喝 (graph#drink) =====
        Food { name: "ab钙奶".into(), food_type: FoodType::Drink, exp: 4.0, strength: 10.0, strength_drink: 40.0, strength_food: 5.0, health: 1.0, feeling: 2.0, price: 7.5, graph: "drink".into() },
        Food { name: "果汁".into(), food_type: FoodType::Drink, exp: 8.0, strength: 10.0, strength_drink: 40.0, strength_food: 4.0, health: 3.0, feeling: 7.0, price: 10.5, graph: "drink".into() },
        Food { name: "可乐".into(), food_type: FoodType::Drink, exp: 4.0, strength: 10.0, strength_drink: 50.0, strength_food: 2.0, health: -1.0, feeling: 50.0, price: 9.0, graph: "drink".into() },
        Food { name: "凉茶".into(), food_type: FoodType::Drink, exp: 20.0, strength: 10.0, strength_drink: 60.0, strength_food: 1.0, health: 5.0, feeling: 12.0, price: 16.5, graph: "drink".into() },
        Food { name: "维他奶".into(), food_type: FoodType::Drink, exp: 8.0, strength: 15.0, strength_drink: 35.0, strength_food: 5.0, health: 1.0, feeling: 2.0, price: 8.0, graph: "drink".into() },
        Food { name: "椰汁".into(), food_type: FoodType::Drink, exp: 8.0, strength: 15.0, strength_drink: 50.0, strength_food: 4.0, health: 2.0, feeling: 25.0, price: 11.5, graph: "drink".into() },
        Food { name: "盐汽水".into(), food_type: FoodType::Drink, exp: 8.0, strength: 15.0, strength_drink: 40.0, strength_food: 3.0, health: -0.5, feeling: 37.0, price: 8.5, graph: "drink".into() },
        Food { name: "茶".into(), food_type: FoodType::Drink, exp: 10.0, strength: 10.0, strength_drink: 100.0, strength_food: -1.0, health: 5.0, feeling: 25.0, price: 19.5, graph: "drink".into() },
        Food { name: "纯牛奶".into(), food_type: FoodType::Drink, exp: 10.0, strength: 20.0, strength_drink: 70.0, strength_food: 20.0, health: 2.0, feeling: 30.0, price: 17.5, graph: "drink".into() },
        Food { name: "奶茶".into(), food_type: FoodType::Drink, exp: 40.0, strength: 70.0, strength_drink: 65.0, strength_food: 20.0, health: -1.0, feeling: 25.0, price: 22.0, graph: "drink".into() },
    ]
}

/// 随机挑选一个指定动画图名 (eat / drink) 的食物
pub fn pick_random(graph: &str) -> Option<Food> {
    use rand::seq::SliceRandom;
    let candidates: Vec<Food> = all_foods().into_iter().filter(|f| f.graph == graph).collect();
    candidates.choose(&mut rand::thread_rng()).cloned()
}

/// 按名字查找食物
pub fn find_food(name: &str) -> Option<Food> {
    all_foods().into_iter().find(|f| f.name == name)
}
