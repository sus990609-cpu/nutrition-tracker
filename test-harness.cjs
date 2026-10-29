// 冒烟测试：用轻量 DOM 桩加载 app.js，验证核心数据与计算逻辑
const store = {};

function makeEl() {
  return {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    innerHTML: "",
    textContent: "",
    value: "",
    files: [],
    hidden: false,
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => makeEl(),
    click() {},
    remove() {},
    setAttribute() {},
    closest: () => null
  };
}

const elCache = new Map();
globalThis.document = {
  querySelector(sel) {
    if (!elCache.has(sel)) elCache.set(sel, makeEl());
    return elCache.get(sel);
  },
  querySelectorAll: () => [],
  createElement: () => makeEl(),
  addEventListener() {}
};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.navigator = {};
globalThis.URL = { createObjectURL: () => "blob:x", revokeObjectURL: () => {} };
globalThis.Blob = class {};

const fs = require("fs");
const vm = require("vm");
const code = fs.readFileSync("app.js", "utf8");
const catalogCode = fs.existsSync("catalog.js") ? fs.readFileSync("catalog.js", "utf8") : "";
const ctx = vm.createContext(globalThis);
if (catalogCode) vm.runInContext(catalogCode, ctx, { filename: "catalog.js" });
vm.runInContext(code, ctx, { filename: "app.js" });

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

/* ---------- 1. 身体数据回归（不得退化） ---------- */
const bmr = ctx.calcBMR("male", 65, 170, 25);
check("BMR male 65/170/25 = 1592.5", Math.abs(bmr - 1592.5) < 0.01, bmr);
check("BMI 65/170 ≈ 22.49", Math.abs(ctx.calcBMI(65, 170) - 22.49) < 0.01);
check("TDEE = BMR × 1.55", Math.abs(ctx.calcTDEE(bmr, 1.55) - bmr * 1.55) < 0.01);

/* ---------- 2. 食品搜索：细分与品牌 ---------- */
const greek = ctx.searchFoods("希腊酸奶");
check("搜索「希腊酸奶」命中多个细分产品", greek.length >= 2, greek.map(f => f.name).join("|"));
check("包含乐纯希腊酸奶", greek.some(f => f.brand === "乐纯"), greek.map(f => f.brand + f.name).join("|"));
check("包含原味希腊酸奶参考项", greek.some(f => f.name.includes("希腊酸奶")), greek.map(f => f.name).join("|"));

const jianai = ctx.searchFoods("简爱");
check("品牌「简爱」返回多个具体产品", jianai.length >= 2, jianai.length);

const specific = ctx.searchFoods("简爱 高蛋白酸奶")[0];
check("品牌+产品精确匹配到高蛋白酸奶", specific && specific.name === "高蛋白酸奶" && specific.brand === "简爱", specific && specific.brand + specific.name);
check("不会错误返回其他产品营养（74 kcal）", specific && specific.nutrition.calories === 74, specific && specific.nutrition.calories);

const anmuxi = ctx.searchFoods("安慕希")[0];
check("「安慕希」返回对应产品与营养（105 kcal）", anmuxi && anmuxi.brand === "伊利" && anmuxi.nutrition.calories === 105, anmuxi && anmuxi.nutrition.calories);

const mengniu = ctx.searchFoods("蒙牛纯牛奶")[0];
check("品牌+品类「蒙牛纯牛奶」命中蒙牛", mengniu && mengniu.brand === "蒙牛", mengniu && mengniu.brand + mengniu.name);

/* ---------- 3. 摄入营养计算 ---------- */
const rice = ctx.searchFoods("米饭")[0];
const rice200 = ctx.calcNutrition(rice, 200, "g");
check("200g 米饭 = 232 kcal / 5.2g 蛋白", Math.abs(rice200.calories - 232) < 0.01 && Math.abs(rice200.protein - 5.2) < 0.01, JSON.stringify(rice200));

const greekFood = greek.find(f => f.name.includes("希腊酸奶（原味）"));
const greekServing = ctx.calcNutrition(greekFood, 1, "serving");
check("希腊酸奶 1 杯（135g）正确换算", Math.abs(greekServing.grams - 135) < 0.01 && Math.abs(greekServing.calories - 130.95) < 0.01, JSON.stringify(greekServing));

const baguette = ctx.searchFoods("法棍")[0];
check("无每份重量的食品按份换算返回 null", ctx.calcNutrition(baguette, 1, "serving") === null);

const milk = ctx.searchFoods("全脂牛奶")[0];
const milk250 = ctx.calcNutrition(milk, 250, "ml");
check("250ml 全脂牛奶 = 160 kcal", Math.abs(milk250.calories - 160) < 0.01, milk250.calories);

const e1 = ctx.makeEntry({ food: rice, amount: 200, unit: "g", mealIndex: 0, pending: false });
const e2 = ctx.makeEntry({ food: rice, amount: 100, unit: "g", mealIndex: 1, pending: true });
const sums = ctx.sumEntries([e1, e2]);
check("待补充记录不计入统计", sums.calories === 232 && sums.pendingCount === 1, JSON.stringify(sums));

/* ---------- 4. 包装文本解析 ---------- */
const label = ctx.parseProductText(`简爱 原味无糖酸奶
配料：生牛乳、乳酸菌
营养成分表（每100g）：能量 320kJ，蛋白质 3.8g，脂肪 3.5g，碳水化合物 4.5g，钠 55mg
净含量：135g`);
check("解析成功且识别品牌", label.ok && label.data.brand === "简爱", label.data && label.data.brand);
check("kJ 正确换算 kcal（320kJ≈76.5）", label.data.nutrition && Math.abs(label.data.nutrition.calories - 76.5) < 0.2, label.data.nutrition && label.data.nutrition.calories);
check("识别蛋白质/脂肪/碳水", label.data.nutrition.protein === 3.8 && label.data.nutrition.fat === 3.5 && label.data.nutrition.carbs === 4.5);
check("识别净含量 135g", label.data.netGrams === 135, label.data.netGrams);
check("识别配料表", label.data.ingredients.length === 2, label.data.ingredients.join("|"));

const servingLabel = ctx.parseProductText(`某品牌 蛋白棒
配料：乳清蛋白、坚果
营养成分表（每份 30g）：能量 500kJ，蛋白质 15g，脂肪 5g，碳水化合物 20g`);
check("每份营养换算为每 100g（能量≈398）", Math.abs(servingLabel.data.nutrition.calories - 398.3) < 1, servingLabel.data.nutrition.calories);
check("每份换算蛋白质 = 50g", Math.abs(servingLabel.data.nutrition.protein - 50) < 0.1, servingLabel.data.nutrition.protein);

const onlyIngredients = ctx.parseProductText(`手工水饺
配料：小麦粉、猪肉、白菜、食用盐`);
check("仅有配料表时不生成营养数据", onlyIngredients.ingredientOnly === true && onlyIngredients.data.nutrition === null);
check("仅有配料表时给出明确提示", onlyIngredients.warnings.some(w => w.includes("无法生成精确营养数据")));

const barcodeLabel = ctx.parseProductText(`某品牌 苏打饼干
条形码：6901234567890
营养成分表（每100g）：能量 400kJ，蛋白质 8g，脂肪 10g，碳水化合物 60g`);
check("解析包装条形码", barcodeLabel.data.barcode === "6901234567890", barcodeLabel.data.barcode);

const zeroCola = ctx.searchFoods("零糖可乐")[0];
check("别名「零糖可乐」命中零度可乐", zeroCola && zeroCola.name === "零度可乐", zeroCola && zeroCola.name);

/* ---------- 5. 画像多选与持久化 ---------- */
const combo = { identity: ["student"], activity: ["strength"], diet: ["eatout"], lifeStage: [] };
const plan = ctx.generatePlan(combo, { sex: "male", age: 25, height: 175, weight: 70, activity: 1.55 }, { goalType: "gain", targetWeight: 76, weeks: 12, mealsPerDay: 3 });
check("多画像标签全部生效", plan.labels.length === 3, plan.labels.join("|"));
check("力量训练提高蛋白质（≥2.0g/kg）", plan.proteinPerKg >= 2.0, plan.proteinPerKg);
check("目标热量高于 TDEE（增肌）", plan.targetCalories > plan.tdee, `${plan.targetCalories} vs ${plan.tdee}`);

ctx.setProfileTags(combo);
const reloaded = ctx.loadState();
check("保存后重新读取仍保留多选画像",
  reloaded.profileTags.identity.includes("student") &&
  reloaded.profileTags.activity.includes("strength") &&
  reloaded.profileTags.diet.includes("eatout"),
  JSON.stringify(reloaded.profileTags));

ctx.setProfileTags({ identity: ["office"], activity: ["strength"], diet: [], lifeStage: [] });
const reloaded2 = ctx.loadState();
check("再次修改不会覆盖其他类别标签",
  reloaded2.profileTags.identity.includes("office") && reloaded2.profileTags.activity.includes("strength"),
  JSON.stringify(reloaded2.profileTags));

/* ---------- 6. AI 分量估算 ---------- */
const est = ctx.estimateAI({
  refMode: "object",
  refObject: "card",
  rows: [{ foodId: rice.id, size: "1", thickness: "medium" }],
  cookMethod: "steam"
});
check("AI 估算成功", est.ok && est.items.length === 1);
check("估算重量区间合理（低<中<高）", est.items[0].gramsLow < est.items[0].gramsMid && est.items[0].gramsMid < est.items[0].gramsHigh, JSON.stringify(est.items[0]));
check("能量区间合理", est.items[0].caloriesLow < est.items[0].caloriesMid && est.items[0].caloriesMid < est.items[0].caloriesHigh);
check("输出不确定性说明", est.uncertainty.length >= 2, est.uncertainty.join("|"));

const estBody = ctx.estimateAI({
  refMode: "body",
  bodyRef: "fist",
  rows: [{ foodId: rice.id, size: "1", thickness: "medium" }],
  cookMethod: "steam"
});
check("人体参照也能给出估算", estBody.ok && estBody.items[0].gramsMid > 100, estBody.items[0].gramsMid);

/* ---------- 7. 数据迁移（v1 -> v2） ---------- */
store["nutritionTrackerState"] = JSON.stringify({
  profile: "office",
  mealsPerDay: 3,
  body: { sex: "female", age: 30, height: 160, weight: 55, activity: 1.375 },
  entries: [{ id: 1, date: "2026-01-01", mealIndex: 0, name: "旧数据", amount: 100, unit: "g", calories: 100, protein: 5, carbs: 10, fat: 2 }],
  settings: { defaultProfile: "office", defaultMeals: 3 }
});
const migrated = ctx.loadState();
check("旧版单选画像迁移为标签", migrated.profileTags.identity.includes("office"), JSON.stringify(migrated.profileTags));
check("旧版记录保留且补全状态", migrated.entries.length === 1 && migrated.entries[0].status === "complete");
check("旧版身体数据保留", migrated.body.weight === 55 && migrated.body.sex === "female");

/* ---------- 8. P1 回归：本地日期（UTC+8 凌晨不再记到昨天） ---------- */
const earlyMorning = new Date(2026, 0, 2, 0, 30); // 本地 00:30；UTC 仍是前一天 16:30
check("todayStr 使用本地日期（00:30 不会算成昨天）", ctx.todayStr(earlyMorning) === "2026-01-02", ctx.todayStr(earlyMorning));
check("todayStr 本地跨年边界正确（12-31 23:59）", ctx.todayStr(new Date(2026, 11, 31, 23, 59)) === "2026-12-31", ctx.todayStr(new Date(2026, 11, 31, 23, 59)));
check("todayStr 月份/日期补零（03-05）", ctx.todayStr(new Date(2026, 2, 5, 0, 5)) === "2026-03-05", ctx.todayStr(new Date(2026, 2, 5, 0, 5)));
check("不再用 toISOString().slice(0,10) 取日期", !/toISOString\(\)\s*\.slice\(0,\s*10\)/.test(code));
const dateEntry = ctx.makeEntry({ food: rice, amount: 100, unit: "g", mealIndex: 0, pending: false });
check("新增记录日期与本地日期一致", dateEntry && dateEntry.date === ctx.todayStr(), dateEntry && dateEntry.date);

/* ---------- 9. P1 回归：待补充 → 补全闭环 ---------- */
const pendingEntry = {
  id: "p1", date: ctx.todayStr(), mealIndex: 0, name: "自制沙拉",
  grams: 150, amount: 150, unit: "g", unitLabel: "g",
  calories: null, protein: null, carbs: null, fat: null, status: "pending", source: "user"
};
const completed = ctx.completePendingEntry(pendingEntry, { calories: 120, protein: 8, carbs: 10, fat: 5 });
check("待补充记录补全后 status=complete", completed && completed.status === "complete");
check("补全按克数折算并写回四项营养",
  completed && Math.abs(completed.calories - 180) < 1e-9 && Math.abs(completed.protein - 12) < 1e-9 &&
  Math.abs(completed.carbs - 15) < 1e-9 && Math.abs(completed.fat - 7.5) < 1e-9,
  JSON.stringify(completed));
check("补全后 source 标记为用户填写", completed && completed.source === "user", completed && completed.source);
const afterSum = ctx.sumEntries([completed]);
check("补全后计入汇总且待补充计数归零", afterSum.calories === 180 && afterSum.pendingCount === 0, JSON.stringify(afterSum));
const filledGrams = ctx.completePendingEntry(
  { id: "p2", grams: null, status: "pending" },
  { calories: 200, protein: 10, carbs: 20, fat: 5 }, 50
);
check("无 grams 的记录可用填写的克数补全", filledGrams && filledGrams.grams === 50 && Math.abs(filledGrams.calories - 100) < 1e-9, JSON.stringify(filledGrams));
check("缺营养或缺克数时拒绝补全，不产生脏数据",
  ctx.completePendingEntry({ id: "p3", grams: null, status: "pending" }, { calories: 0, protein: 0, carbs: 0, fat: 0 }, null) === null &&
  ctx.completePendingEntry({ id: "p4", grams: null, status: "pending" }, { calories: 100, protein: 1, carbs: 1, fat: 1 }, 0) === null);
check("补全后不再计入待补充（sumEntries）", ctx.sumEntries([{ id: "p5", status: "complete", calories: 50, protein: 1, carbs: 1, fat: 1 }]).pendingCount === 0);

/* ---------- 10. P1 回归：体脂率不再用硬编码颈围/臀围 ---------- */
const bfMale = ctx.calcBodyFat("male", 85, 40, 175, 0);
check("男性数据齐全时体脂率有限且合理", Number.isFinite(bfMale) && bfMale > 5 && bfMale < 45, bfMale);
const bfFemale = ctx.calcBodyFat("female", 70, 32, 165, 92);
check("女性用实测颈围/臀围计算，结果合理（无 50%+ 荒谬值）", Number.isFinite(bfFemale) && bfFemale > 10 && bfFemale < 45, bfFemale);
check("男性缺颈围时返回 null（不是 NaN/硬编码 35）", ctx.calcBodyFat("male", 85, 0, 175, 0) === null);
check("女性缺臀围或颈围时返回 null", ctx.calcBodyFat("female", 70, 32, 165, 0) === null && ctx.calcBodyFat("female", 70, 0, 165, 92) === null);
check("非法围度（腰围 ≤ 颈围）返回 null", ctx.calcBodyFat("male", 38, 40, 175, 0) === null);
check("拒绝未知性别/非法身高（不产生 NaN）", ctx.calcBodyFat("other", 85, 40, 175, 0) === null && ctx.calcBodyFat("male", 85, 40, 0, 0) === null);
check("代码中已无硬编码 35/95 的 calcBodyFat 调用",
  !/calcBodyFat\([^)]*,\s*35\s*,/.test(code) && !/sex\s*===\s*"female"\s*\?\s*95/.test(code));

store["nutritionTrackerState"] = JSON.stringify({
  body: { sex: "female", age: 30, height: 165, weight: 55, waist: 70, neck: 32, hip: 92, activity: 1.375 },
  entries: []
});
const bodyState = ctx.loadState();
check("颈围/臀围写入 state.body 并可从 localStorage 读回",
  bodyState.body.neck === 32 && bodyState.body.hip === 92, JSON.stringify(bodyState.body));

/* ---------- 11. P1 回归：计划速率安全钳制 ---------- */
const planBody = { sex: "male", age: 30, height: 175, weight: 70, activity: 1.55 };
const losePlan = ctx.generatePlan({}, planBody, { goalType: "lose", targetWeight: 50, weeks: 1, mealsPerDay: 3 });
check("减脂极端目标钳制为每周 -1kg", Math.abs(losePlan.weeklyChange + 1) < 1e-9, losePlan.weeklyChange);
check("减脂极端目标热量不低于 1200 kcal", losePlan.targetCalories >= 1200, losePlan.targetCalories);
check("plan 返回 warning（字符串）说明已按安全速率调整", typeof losePlan.warning === "string" && losePlan.warning.length > 0, losePlan.warning);
check("减脂极端目标时间线每周减重不超过 1kg",
  losePlan.timeline.flatMap(m => m.weeks).every(w => Math.abs(planBody.weight - w.expectedWeight) <= 1 * w.weekIndex + 1e-9),
  JSON.stringify(losePlan.timeline.flatMap(m => m.weeks).map(w => w.expectedWeight)));
check("减脂钳制后热量与时间线速率一致",
  Math.abs(losePlan.targetCalories - (losePlan.tdee + losePlan.weeklyChange * 7700 / 7)) < 1e-9,
  `${losePlan.targetCalories} vs ${losePlan.tdee + losePlan.weeklyChange * 7700 / 7}`);

const gainPlan = ctx.generatePlan({}, planBody, { goalType: "gain", targetWeight: 90, weeks: 1, mealsPerDay: 3 });
check("增肌极端目标钳制为每周 +0.5kg", Math.abs(gainPlan.weeklyChange - 0.5) < 1e-9, gainPlan.weeklyChange);
check("增肌极端目标返回 warning", typeof gainPlan.warning === "string" && gainPlan.warning.length > 0, gainPlan.warning);
check("增肌极端目标时间线每周增重不超过 0.5kg",
  gainPlan.timeline.flatMap(m => m.weeks).every(w => w.expectedWeight - planBody.weight <= 0.5 * w.weekIndex + 1e-9),
  JSON.stringify(gainPlan.timeline.flatMap(m => m.weeks).map(w => w.expectedWeight)));
check("增肌钳制后热量与时间线速率一致",
  Math.abs(gainPlan.targetCalories - (gainPlan.tdee + gainPlan.weeklyChange * 7700 / 7)) < 1e-9,
  `${gainPlan.targetCalories} vs ${gainPlan.tdee + gainPlan.weeklyChange * 7700 / 7}`);

const multiWeekPlan = ctx.generatePlan({}, planBody, { goalType: "lose", targetWeight: 40, weeks: 8, mealsPerDay: 3 });
check("多周极端计划每周减重均 ≤1kg 且体重非负",
  multiWeekPlan.timeline.flatMap(m => m.weeks).every(w => w.expectedWeight >= 0) &&
  multiWeekPlan.timeline.flatMap(m => m.weeks).every((w, i) => i === 0 || (w.expectedWeight - multiWeekPlan.timeline.flatMap(mm => mm.weeks)[i - 1].expectedWeight) >= -1 - 1e-9),
  JSON.stringify(multiWeekPlan.timeline.flatMap(m => m.weeks).map(w => w.expectedWeight)));

const normalPlan = ctx.generatePlan({}, planBody, { goalType: "lose", targetWeight: 68, weeks: 12, mealsPerDay: 3 });
check("正常速率目标不误报 warning", !normalPlan.warning, normalPlan.warning);
check("正常速率每周变化未被改写", Math.abs(normalPlan.weeklyChange - (-2 / 12)) < 1e-9, normalPlan.weeklyChange);

ctx.renderPlanOverview(losePlan);
const overviewHtml = globalThis.document.querySelector("#planOverview").innerHTML;
check("计划概览显著展示速率 warning", overviewHtml.includes("安全减脂速度") && overviewHtml.includes("⚠️"), overviewHtml.slice(0, 120));

/* ---------- 12. task-4 回归：方向 / maintain / 热量与时间线一致性 ---------- */
const planBody2 = { sex: "male", age: 30, height: 175, weight: 70, activity: 1.55 };

// A) 方向矛盾：lose 目标高于当前体重
const reverseLose = ctx.generatePlan({}, planBody2, { goalType: "lose", targetWeight: 75, weeks: 8, mealsPerDay: 3 });
check("lose 目标高于当前体重时按保持处理（weeklyChange=0）", reverseLose.weeklyChange === 0, reverseLose.weeklyChange);
check("lose 反向目标 targetCalories=TDEE",
  Math.abs(reverseLose.targetCalories - reverseLose.tdee) < 1e-9, `${reverseLose.targetCalories} vs ${reverseLose.tdee}`);
check("lose 反向目标时间线恒定当前体重",
  reverseLose.timeline.flatMap(m => m.weeks).every(w => Math.abs(w.expectedWeight - planBody2.weight) < 1e-9));
check("lose 反向目标返回方向 warning", reverseLose.warnings.some(w => w.includes("无法形成热量缺口")), reverseLose.warning);
check("lose 目标等于当前体重同样按保持处理",
  ctx.generatePlan({}, planBody2, { goalType: "lose", targetWeight: 70, weeks: 12 }).weeklyChange === 0);

// gain 目标低于当前体重
const reverseGain = ctx.generatePlan({}, planBody2, { goalType: "gain", targetWeight: 65, weeks: 8, mealsPerDay: 3 });
check("gain 目标低于当前体重时按保持处理",
  reverseGain.weeklyChange === 0 && Math.abs(reverseGain.targetCalories - reverseGain.tdee) < 1e-9,
  `${reverseGain.weeklyChange} / ${reverseGain.targetCalories}`);
check("gain 反向目标时间线恒定并给出 warning",
  reverseGain.timeline.flatMap(m => m.weeks).every(w => Math.abs(w.expectedWeight - planBody2.weight) < 1e-9) &&
  reverseGain.warnings.some(w => w.includes("无法形成热量盈余")), reverseGain.warning);

// B) maintain：强制不变 + 目标不一致 warning
const maintainPlan = ctx.generatePlan({}, planBody2, { goalType: "maintain", targetWeight: 60, weeks: 12, mealsPerDay: 3 });
check("maintain 强制 weeklyChange=0 且热量=TDEE",
  maintainPlan.weeklyChange === 0 && Math.abs(maintainPlan.targetCalories - maintainPlan.tdee) < 1e-9,
  `${maintainPlan.weeklyChange} / ${maintainPlan.targetCalories}`);
check("maintain 时间线恒定当前体重",
  maintainPlan.timeline.flatMap(m => m.weeks).every(w => Math.abs(w.expectedWeight - planBody2.weight) < 1e-9),
  JSON.stringify(maintainPlan.timeline.flatMap(m => m.weeks).map(w => w.expectedWeight)));
check("maintain 目标与当前不一致时 warning", maintainPlan.warnings.some(w => w.includes("保持模式不改变体重")), maintainPlan.warning);
const maintainSame = ctx.generatePlan({}, planBody2, { goalType: "maintain", targetWeight: 70, weeks: 12, mealsPerDay: 3 });
check("maintain 目标与当前一致时不误报 warning", !maintainSame.warning, maintainSame.warning);

// C) 正常 2kg/12周：去掉 300 kcal 强制缺口后，热量与时间线严格一致
const normalLose2 = ctx.generatePlan({}, planBody2, { goalType: "lose", targetWeight: 68, weeks: 12, mealsPerDay: 3 });
check("正常 2kg/12周 每周变化≈-0.1667（无 300 kcal 强制缺口）", Math.abs(normalLose2.weeklyChange + 2 / 12) < 1e-9, normalLose2.weeklyChange);
check("正常 2kg/12周 热量可由每周变化反算",
  Math.abs(normalLose2.targetCalories - (normalLose2.tdee + normalLose2.weeklyChange * 7700 / 7)) < 1e-9,
  `${normalLose2.targetCalories} vs ${normalLose2.tdee + normalLose2.weeklyChange * 7700 / 7}`);
check("正常 2kg/12周 时间线终点=目标体重 68kg",
  Math.abs(normalLose2.timeline.flatMap(m => m.weeks).slice(-1)[0].expectedWeight - 68) < 1e-6,
  normalLose2.timeline.flatMap(m => m.weeks).slice(-1)[0].expectedWeight);
check("正常 2kg/12周 不误报 warning", !normalLose2.warning, normalLose2.warning);

// D) 1200 kcal 下限：用最终热量反算实际速率，时间线与之一致
const lowBody = { sex: "female", age: 40, height: 150, weight: 45, activity: 1.2 };
const lowPlan = ctx.generatePlan({}, lowBody, { goalType: "lose", targetWeight: 40, weeks: 4, mealsPerDay: 3 });
check("1200 下限场景 targetCalories=1200", Math.abs(lowPlan.targetCalories - 1200) < 1e-9, lowPlan.targetCalories);
check("1200 下限场景 weeklyChange 由最终热量反算",
  Math.abs(lowPlan.weeklyChange - (1200 - lowPlan.tdee) * 7 / 7700) < 1e-9,
  `${lowPlan.weeklyChange} vs ${(1200 - lowPlan.tdee) * 7 / 7700}`);
check("1200 下限场景 时间线与反算速率一致",
  lowPlan.timeline.flatMap(m => m.weeks).every(w => Math.abs(w.expectedWeight - (lowBody.weight + lowPlan.weeklyChange * w.weekIndex)) < 1e-9),
  JSON.stringify(lowPlan.timeline.flatMap(m => m.weeks).map(w => w.expectedWeight)));
check("1200 下限场景 warning 说明实际速率调整", lowPlan.warnings.some(w => w.includes("实际每周变化")), lowPlan.warning);

/* ---------- 13. task-5 回归：品牌产品 / 包装净含量 / 烟盒参照 / AI 错误中文提示 ---------- */
const gebbenFoods = ctx.brandFoods("哥本");
check("品牌「哥本」返回 ≥4 个产品", gebbenFoods.length >= 4, gebbenFoods.map(f => f.name).join("|"));
check("品牌「简爱」返回多个产品", ctx.brandFoods("简爱").length >= 2, ctx.brandFoods("简爱").length);
check("品牌匹配命中哥本", ctx.matchedBrands("哥本").includes("哥本"), JSON.stringify(ctx.matchedBrands("哥本")));

const redBean = gebbenFoods.find(f => f.name === "红豆满满乳酪包");
check("红豆满满乳酪包带「70g/袋」净含量",
  !!(redBean && redBean.package && redBean.package.grams === 70 && redBean.package.label === "袋"),
  redBean && JSON.stringify(redBean.package));
check("净含量文案为 70g/袋", redBean && ctx.packageText(redBean) === "70g/袋", redBean && ctx.packageText(redBean));
const redBeanUnits = ctx.unitOptionsFor(redBean);
check("记录单位包含「袋（70g）」",
  redBeanUnits.some(o => o.value === "package" && o.label.includes("袋") && o.label.includes("70")),
  JSON.stringify(redBeanUnits));
const redBeanPack = ctx.calcNutrition(redBean, 1, "package");
check("按 1 袋（70g）正确换算热量", redBeanPack && Math.abs(redBeanPack.grams - 70) < 1e-9 && Math.abs(redBeanPack.calories - 196) < 0.01,
  redBeanPack && JSON.stringify(redBeanPack));
check("哥本产品注明净含量以实物包装为准", gebbenFoods.every(f => (f.note || "").includes("以实物包装为准")));
check("安慕希补上 205g/瓶 package",
  (() => { const f = ctx.searchFoods("安慕希")[0]; return !!(f && f.package && f.package.grams === 205); })(),
  JSON.stringify(ctx.searchFoods("安慕希")[0].package));
check("东方树叶补上 500ml/瓶 package",
  (() => { const f = ctx.searchFoods("东方树叶 乌龙茶")[0]; return !!(f && f.package && f.package.grams === 500); })());

// 品牌产品面板与本地缩略图（不联网）
const brandPanelHtml = ctx.renderBrandProductsPanel("哥本");
check("品牌产品面板渲染出多个产品卡片", (brandPanelHtml.match(/class="brand-card"/g) || []).length >= 4);
check("品牌产品面板含净含量与真实商品图",
  brandPanelHtml.includes("净含量 70g/袋") && brandPanelHtml.includes("assets/products/"));
const thumb = ctx.foodThumb({ brand: "哥本", name: "测试" });
check("无 image 字段时 foodThumb 生成内联 SVG data URI", thumb.startsWith("data:image/svg+xml"), thumb.slice(0, 30));
check("food.image 字段优先于 SVG（便于以后替换真图）",
  ctx.foodThumb({ brand: "哥本", name: "测试", image: "https://example.com/a.png" }) === "https://example.com/a.png");

// 烟盒参照物
const refObjects = ctx.refOptions("object");
check("参照物包含烟盒（约 88×58mm）",
  !!(refObjects.cigarette && refObjects.cigarette.label.includes("烟盒") && refObjects.cigarette.area === 51),
  JSON.stringify(refObjects.cigarette));

// AI 错误 → 中文提示
const netErrMsg = ctx.friendlyAiError(new TypeError("Failed to fetch"));
check("网络错误映射为中文「无法连接 AI 后端」提示",
  netErrMsg.includes("无法连接 AI 后端") && netErrMsg.includes("start-server.cmd"), netErrMsg);
const busyErr = Object.assign(new Error("账号并发限制为 1，请稍后重试"), { status: 429, retryAfterSec: 7 });
const busyErrMsg = ctx.friendlyAiError(busyErr);
check("429 提示包含服务端 message 与 retryAfterSec",
  busyErrMsg.includes("429") && busyErrMsg.includes("账号并发限制为 1") && busyErrMsg.includes("7"), busyErrMsg);

// AI 食品结果 packageGrams 契约映射
const aiFood = ctx.aiItemToFood({
  name: "测试欧包", brand: "哥本", category: "主食",
  per100: { kcal: 250, protein: 9, carbs: 40, fat: 4 },
  packageGrams: 85
});
check("AI 结果 packageGrams 映射为 package:{label:'袋',grams}",
  !!(aiFood.package && aiFood.package.label === "袋" && aiFood.package.grams === 85), JSON.stringify(aiFood.package));
const aiFoodNoPack = ctx.aiItemToFood({
  name: "测试散装", brand: "", category: "其他",
  per100: { kcal: 100, protein: 1, carbs: 1, fat: 1 },
  packageGrams: null
});
check("AI 结果 packageGrams 为 null 时 package=null（不编造规格）",
  aiFoodNoPack.package === null && aiFoodNoPack.spec === "", JSON.stringify(aiFoodNoPack.package));

// 搜索结果 UI：品牌产品面板渲染在结果上方（用 DOM 桩验证 HTML 输出）
const doc = globalThis.document;
doc.querySelector("#foodNameInput").value = "哥本";
ctx.renderTrackerResults();
const trackerSearchHtml = doc.querySelector("#trackerSearchResults").innerHTML;
check("摄入记录搜索「哥本」渲染品牌产品面板",
  trackerSearchHtml.includes("brand-products") && (trackerSearchHtml.match(/class="brand-card"/g) || []).length >= 4);
check("品牌面板含净含量与本地 SVG 缩略图",
  trackerSearchHtml.includes("净含量 70g/袋") && trackerSearchHtml.includes("data:image/svg+xml"));
doc.querySelector("#foodSearchInput").value = "哥本";
ctx.renderFoodSearchResults();
const foodsSearchHtml = doc.querySelector("#foodSearchResults").innerHTML;
check("食品查询搜索「哥本」渲染品牌产品面板", foodsSearchHtml.includes("brand-products") && foodsSearchHtml.includes("哥本"));
const anmuxiFood = ctx.searchFoods("安慕希")[0];
ctx.renderFoodDetail(anmuxiFood);
const detailHtml = doc.querySelector("#foodDetail").innerHTML;
check("食品详情显示净含量 205g/瓶", detailHtml.includes("净含量 205g/瓶"), detailHtml.slice(0, 200));
check("同规格 serving/package 单位去重（安慕希只有 1 个「瓶」选项）",
  ctx.unitOptionsFor(anmuxiFood).filter(o => o.label.includes("瓶")).length === 1,
  JSON.stringify(ctx.unitOptionsFor(anmuxiFood)));

/* ---------- 品牌产品目录 + 真实商品图 ---------- */
const catalog = globalThis.CATALOG_FOODS;
check("品牌产品目录已加载", Array.isArray(catalog) && catalog.length >= 60, catalog && catalog.length);
const wlSmall = ctx.foodById("cat_weilong-xiaomianjin");
check("卫龙小面筋已收录且带 65g 包装", !!wlSmall && wlSmall.brand === "卫龙" && wlSmall.package && wlSmall.package.grams === 65, JSON.stringify(wlSmall && wlSmall.package));
check("卫龙小面筋可被品牌搜索召回", ctx.searchFoods("卫龙").some(f => f.id === "cat_weilong-xiaomianjin"));
check("卫龙品牌下至少有 大面筋/小面筋 等 4 款", ctx.brandFoods("卫龙").length >= 4 && ctx.brandFoods("卫龙").some(f => f.name.includes("小面筋")), ctx.brandFoods("卫龙").length);
check("品牌目录商品带真实图片路径", !!wlSmall && /^assets\/products\/.+\.jpg$/.test(wlSmall.image || ""), wlSmall && wlSmall.image);
check("现有包装食品图片映射生效（卫龙大面筋）", (() => {
  const f = ctx.searchFoods("大面筋").find(x => x.brand === "卫龙");
  return !!f && /^assets\/products\//.test(f.image || "");
})(), JSON.stringify(ctx.searchFoods("大面筋").map(f => [f.name, f.image])));
check("品牌目录图片覆盖数量充足", catalog.filter(f => /^assets\/products\//.test(f.image || "")).length >= 50, catalog.filter(f => /^assets\/products\//.test(f.image || "")).length);
check("低卡/健康品牌已纳入（薄荷健康/ffit8/王饱饱/OATLY）", ["薄荷健康", "ffit8", "王饱饱", "OATLY"].every(b => ctx.brandFoods(b).length > 0), ["薄荷健康", "ffit8", "王饱饱", "OATLY"].map(b => ctx.brandFoods(b).length));
check("新增 SKU 均带净含量", catalog.every(f => f.package && f.package.grams > 0), catalog.filter(f => !(f.package && f.package.grams > 0)).length);
check("包装换算：1 袋卫龙小面筋 = 65g", !!wlSmall && ctx.gramsFor(wlSmall, 1, "package") === 65, wlSmall && ctx.gramsFor(wlSmall, 1, "package"));

/* ---------- PWA 静态资产 ---------- */
check("PWA manifest 合法且可安装", (() => {
  try {
    const m = JSON.parse(fs.readFileSync("manifest.webmanifest", "utf8"));
    return m.name && m.display === "standalone" && m.start_url === "/" &&
      Array.isArray(m.icons) && m.icons.some(i => i.sizes === "192x192") && m.icons.some(i => i.sizes === "512x512") &&
      m.icons.some(i => i.purpose === "maskable");
  } catch (e) { return false; }
})());
check("PWA Service Worker 存在且包含缓存与离线回退", (() => {
  if (!fs.existsSync("sw.js")) return false;
  const src = fs.readFileSync("sw.js", "utf8");
  return src.includes("CACHE_NAME") && src.includes("fetch") && src.includes('"/index.html"') && src.includes("navigate");
})());
check("PWA 图标文件齐全", ["assets/icons/icon-192.png", "assets/icons/icon-512.png", "assets/icons/maskable-512.png", "assets/icons/apple-touch-icon-180.png"]
  .every(p => fs.existsSync(p)));

console.log(`\n结果: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
