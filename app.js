/**
 * 每日营养管家 - 主逻辑 v2
 * 纯前端，数据保存在 localStorage；无后端依赖。
 *
 * 数据模型统一：食品以「每 100g / 100ml」为营养基准，
 * 份/包装等单位只有在已知重量时才自动换算。
 */

/* ================= 基础常量 ================= */
const STATE_KEY = "nutritionTrackerState";
const CATEGORIES = ["主食", "肉蛋", "乳制品", "豆制品", "蔬菜", "水果", "坚果", "零食", "饮料", "速食", "其他"];
const RELIABILITY_LABEL = { reference: "参考值", label: "包装标签", user: "用户自定义", pending: "待确认", ai: "AI 估算" };
const RELIABILITY_CLASS = { reference: "ref", label: "label", user: "user", pending: "pending", ai: "ai" };

/* ================= 食品数据库 ================= */
let __foodSeq = 0;
function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * 统一的食品记录结构
 * nutrition 一律为每 100g/100ml；serving/package 记录已知份量。
 */
function F(name, brand, category, cal, pro, carb, fat, opts = {}) {
  __foodSeq++;
  const unit = opts.unit || (opts.ml ? "ml" : "g");
  return {
    id: opts.id || ("f_" + hashId(name + "|" + (brand || "")) + "_" + __foodSeq),
    name,
    brand: brand || "",
    category,
    aliases: opts.aliases || [],
    keywords: opts.keywords || [],
    barcode: opts.barcode || "",
    unit,
    nutrition: { calories: cal, protein: pro, carbs: carb, fat: fat, fiber: opts.fiber ?? null, sodium: opts.sodium ?? null },
    serving: opts.serving || null,
    package: opts.package || null,
    spec: opts.spec || "",
    note: opts.note || "",
    image: opts.image || "",
    source: opts.source || "reference",
    reliability: opts.reliability || "reference",
    tags: opts.tags || [category],
    gl: opts.gl || ""
  };
}

const FOOD_DB = [
  /* ---------- 谷物及主食 ---------- */
  F("米饭", "", "主食", 116, 2.6, 25.9, 0.3, { aliases: ["白米饭", "大米饭"], serving: { label: "碗", grams: 150 }, gl: "高" }),
  F("糙米饭", "", "主食", 112, 2.7, 24, 0.9, { serving: { label: "碗", grams: 150 }, gl: "中" }),
  F("燕麦片（生）", "", "主食", 389, 16.9, 66.3, 6.9, { aliases: ["燕麦", "燕麦米"], serving: { label: "份", grams: 40 }, gl: "中", keywords: ["全谷物", "早餐"] }),
  F("即食燕麦片", "", "主食", 367, 12, 60, 7, { aliases: ["快熟燕麦"], serving: { label: "份", grams: 40 }, gl: "中", keywords: ["早餐"] }),
  F("全麦面包", "", "主食", 247, 13, 41, 3.4, { aliases: ["全麦吐司"], serving: { label: "片", grams: 40 }, gl: "中", keywords: ["早餐", "低GL"] }),
  F("白吐司", "", "主食", 265, 9, 49, 3.2, { aliases: ["白面包", "吐司"], serving: { label: "片", grams: 35 }, gl: "高" }),
  F("法棍", "", "主食", 274, 9, 57, 1.5, { gl: "高" }),
  F("贝果", "", "主食", 257, 10, 49, 1.7, { serving: { label: "个", grams: 100 }, gl: "中" }),
  F("馒头", "", "主食", 223, 7, 47, 1.1, { serving: { label: "个", grams: 100 }, gl: "高" }),
  F("花卷", "", "主食", 214, 6.4, 44, 1.6, { serving: { label: "个", grams: 90 }, gl: "高" }),
  F("猪肉包子", "", "主食", 220, 7, 32, 7, { aliases: ["肉包"], serving: { label: "个", grams: 90 }, gl: "高" }),
  F("韭菜鸡蛋包子", "", "主食", 196, 6, 30, 6, { serving: { label: "个", grams: 90 }, gl: "中" }),
  F("猪肉白菜饺子", "", "主食", 200, 8, 25, 8, { aliases: ["饺子"], serving: { label: "个", grams: 20 }, gl: "中" }),
  F("面条（煮）", "", "主食", 110, 4, 22, 1, { aliases: ["汤面", "阳春面"], serving: { label: "碗", grams: 250 }, gl: "高" }),
  F("挂面（干）", "", "主食", 348, 11, 75, 0.8, { gl: "高" }),
  F("意大利面（煮）", "", "主食", 131, 5, 25, 1.1, { aliases: ["意面", "pasta"], gl: "中" }),
  F("米粉（煮）", "", "主食", 97, 1.8, 22, 0.2, { aliases: ["米线"], serving: { label: "碗", grams: 250 }, gl: "高" }),
  F("红薯", "", "主食", 86, 1.6, 20.1, 0.1, { aliases: ["地瓜", "番薯"], gl: "中" }),
  F("紫薯", "", "主食", 82, 1.3, 18, 0.2, { gl: "中" }),
  F("玉米（煮）", "", "主食", 86, 3.2, 19, 1.2, { aliases: ["甜玉米", "玉米棒"], serving: { label: "根", grams: 200 }, gl: "中" }),
  F("土豆（蒸）", "", "主食", 77, 2, 17, 0.1, { aliases: ["马铃薯", "土豆"], gl: "中" }),
  F("山药", "", "主食", 57, 1.9, 12.4, 0.2, { gl: "中" }),
  F("小米粥", "", "主食", 46, 1.4, 9.3, 0.3, { serving: { label: "碗", grams: 300 }, gl: "中" }),
  F("白粥", "", "主食", 30, 0.6, 6.6, 0.1, { serving: { label: "碗", grams: 300 }, gl: "高" }),
  F("八宝粥", "", "主食", 75, 1.8, 16, 0.3, { serving: { label: "罐", grams: 360 }, gl: "高" }),
  F("油条", "", "主食", 388, 6.9, 51, 17, { serving: { label: "根", grams: 60 }, gl: "高" }),
  F("煎饼果子", "", "主食", 240, 8, 32, 9, { serving: { label: "个", grams: 200 }, gl: "高" }),
  F("火腿三明治", "", "主食", 220, 9, 28, 8, { aliases: ["三明治"], serving: { label: "个", grams: 120 }, gl: "高" }),
  F("饭团", "", "主食", 180, 4, 38, 1.5, { serving: { label: "个", grams: 120 }, gl: "高" }),
  F("寿司卷", "", "主食", 150, 5, 28, 2, { serving: { label: "个", grams: 200 }, gl: "中" }),
  F("汉堡包", "", "主食", 295, 17, 30, 12, { aliases: ["汉堡"], serving: { label: "个", grams: 220 }, gl: "高" }),
  F("披萨", "", "主食", 266, 11, 33, 10, { serving: { label: "块", grams: 100 }, gl: "高" }),
  F("方便面（油炸）", "", "速食", 463, 9, 62, 21, { aliases: ["泡面", "方便面"], serving: { label: "包", grams: 100 }, gl: "高", keywords: ["速食"] }),
  F("牛肉拉面", "", "主食", 120, 5, 20, 3, { serving: { label: "碗", grams: 500 }, gl: "高" }),

  /* ---------- 肉蛋 ---------- */
  F("鸡胸肉", "", "肉蛋", 165, 31, 0, 3.6, { aliases: ["鸡胸"], keywords: ["高蛋白", "低脂"] }),
  F("鸡腿肉（去皮）", "", "肉蛋", 146, 26, 0, 4.5, { aliases: ["鸡腿"] }),
  F("鸡翅", "", "肉蛋", 202, 18, 0, 14, { serving: { label: "个", grams: 50 } }),
  F("瘦牛肉", "", "肉蛋", 250, 26, 0, 15, { aliases: ["牛肉", "牛里脊"], keywords: ["高蛋白"] }),
  F("牛腩", "", "肉蛋", 283, 18, 0, 23, {}),
  F("猪里脊", "", "肉蛋", 143, 20, 0, 6.2, { aliases: ["猪瘦肉", "里脊"] }),
  F("五花肉", "", "肉蛋", 518, 9, 0, 53, {}),
  F("排骨", "", "肉蛋", 278, 17, 0, 23, {}),
  F("羊肉（瘦）", "", "肉蛋", 203, 20, 0, 13, { aliases: ["羊肉"] }),
  F("三文鱼", "", "肉蛋", 208, 20, 0, 13, { aliases: ["鲑鱼"], keywords: ["Omega-3"] }),
  F("鳕鱼", "", "肉蛋", 88, 18, 0, 0.7, {}),
  F("虾仁", "", "肉蛋", 99, 24, 0, 0.3, { aliases: ["虾"] }),
  F("金枪鱼罐头（水浸）", "", "肉蛋", 116, 26, 0, 1, { aliases: ["吞拿鱼罐头"] }),
  F("鸡蛋（煮）", "", "肉蛋", 155, 13, 1.1, 11, { aliases: ["水煮蛋", "鸡蛋"], serving: { label: "个", grams: 50 }, keywords: ["早餐", "高蛋白"] }),
  F("煎蛋", "", "肉蛋", 196, 14, 1.5, 15, { serving: { label: "个", grams: 55 } }),
  F("鹌鹑蛋", "", "肉蛋", 160, 13, 0.1, 11, { serving: { label: "个", grams: 10 } }),
  F("火腿", "", "肉蛋", 196, 12, 5, 14, { serving: { label: "片", grams: 20 } }),
  F("培根", "", "肉蛋", 541, 37, 1.4, 42, { serving: { label: "片", grams: 15 } }),
  F("香肠", "", "肉蛋", 346, 12, 3, 32, { serving: { label: "根", grams: 50 } }),
  F("午餐肉", "", "肉蛋", 229, 12, 6, 18, { serving: { label: "片", grams: 30 } }),

  /* ---------- 乳制品（细分） ---------- */
  F("全脂牛奶", "", "乳制品", 64, 3.3, 4.9, 3.6, { aliases: ["纯牛奶", "牛奶"], unit: "ml", ml: true, serving: { label: "盒", grams: 250 }, keywords: ["早餐", "补钙"] }),
  F("脱脂牛奶", "", "乳制品", 34, 3.4, 5, 0.2, { aliases: ["零脂牛奶"], unit: "ml", ml: true, serving: { label: "盒", grams: 250 }, keywords: ["低脂"] }),
  F("无糖酸奶", "", "乳制品", 72, 3.8, 4.5, 3.5, { aliases: ["0蔗糖酸奶", "原味酸奶"], serving: { label: "杯", grams: 135 }, keywords: ["无糖", "低GI"], gl: "低" }),
  F("希腊酸奶（原味）", "", "乳制品", 97, 9, 4, 5, { aliases: ["无糖希腊酸奶", "原味希腊酸奶"], serving: { label: "杯", grams: 135 }, keywords: ["高蛋白", "低糖"], gl: "低" }),
  F("高蛋白酸奶", "", "乳制品", 74, 10, 5, 1.5, { aliases: ["蛋白酸奶"], serving: { label: "杯", grams: 150 }, keywords: ["高蛋白"], gl: "低" }),
  F("低脂酸奶", "", "乳制品", 56, 3.5, 7, 1, { aliases: ["轻脂酸奶"], serving: { label: "杯", grams: 150 }, keywords: ["低脂"], gl: "低" }),
  F("风味酸奶（草莓）", "", "乳制品", 95, 2.8, 15, 2.5, { aliases: ["草莓酸奶", "果味酸奶"], serving: { label: "杯", grams: 125 }, gl: "中" }),
  F("舒化奶（无乳糖）", "", "乳制品", 60, 3.2, 5, 3.3, { aliases: ["无乳糖牛奶"], unit: "ml", ml: true, serving: { label: "盒", grams: 250 } }),
  F("奶酪（切达）", "", "乳制品", 402, 25, 1.3, 33, { aliases: ["芝士", "奶酪"], serving: { label: "片", grams: 20 } }),
  F("奶油奶酪", "", "乳制品", 342, 6, 4, 34, { aliases: ["cream cheese"] }),

  /* ---------- 豆制品 ---------- */
  F("北豆腐", "", "豆制品", 116, 12, 3, 7, { aliases: ["老豆腐", "豆腐"] }),
  F("南豆腐", "", "豆制品", 76, 8, 1.9, 4.8, { aliases: ["嫩豆腐"] }),
  F("豆干", "", "豆制品", 140, 16, 4, 7, { aliases: ["香干"] }),
  F("腐竹（干）", "", "豆制品", 461, 44, 22, 22, {}),
  F("毛豆", "", "豆制品", 131, 13, 10, 5, {}),
  F("鹰嘴豆（煮）", "", "豆制品", 164, 8.9, 27, 2.6, { aliases: ["鹰嘴豆"] }),
  F("豆浆（无糖）", "", "豆制品", 31, 3, 1.2, 1.6, { unit: "ml", ml: true, serving: { label: "杯", grams: 250 }, keywords: ["早餐"] }),
  F("豆浆（甜）", "", "豆制品", 45, 2.8, 5, 1.4, { unit: "ml", ml: true, serving: { label: "杯", grams: 250 } }),

  /* ---------- 蔬菜 ---------- */
  F("西兰花", "", "蔬菜", 34, 2.8, 7, 0.4, { aliases: ["绿花菜"], keywords: ["高纤维"] }),
  F("菠菜", "", "蔬菜", 23, 2.9, 3.6, 0.4, {}),
  F("生菜", "", "蔬菜", 15, 1.4, 2.9, 0.2, {}),
  F("番茄", "", "蔬菜", 18, 0.9, 3.9, 0.2, { aliases: ["西红柿"] }),
  F("黄瓜", "", "蔬菜", 15, 0.7, 3.6, 0.1, {}),
  F("胡萝卜", "", "蔬菜", 41, 0.9, 9.6, 0.2, {}),
  F("南瓜", "", "蔬菜", 26, 1, 6.5, 0.1, {}),
  F("蘑菇", "", "蔬菜", 22, 3.1, 3.3, 0.3, { aliases: ["口蘑", "香菇"] }),
  F("洋葱", "", "蔬菜", 40, 1.1, 9.3, 0.1, {}),
  F("青椒", "", "蔬菜", 22, 1, 5.4, 0.2, { aliases: ["甜椒"] }),
  F("大白菜", "", "蔬菜", 17, 1.5, 3.2, 0.1, { aliases: ["白菜"] }),
  F("芹菜", "", "蔬菜", 16, 0.7, 3, 0.2, {}),
  F("芦笋", "", "蔬菜", 20, 2.2, 3.9, 0.1, {}),
  F("茄子", "", "蔬菜", 25, 1, 5.9, 0.2, {}),

  /* ---------- 水果 ---------- */
  F("苹果", "", "水果", 52, 0.3, 14, 0.2, { serving: { label: "个", grams: 200 }, gl: "低" }),
  F("香蕉", "", "水果", 89, 1.1, 22.8, 0.3, { serving: { label: "根", grams: 120 }, gl: "中" }),
  F("橙子", "", "水果", 47, 0.9, 11.8, 0.1, { aliases: ["橙"], serving: { label: "个", grams: 200 }, gl: "低" }),
  F("葡萄", "", "水果", 69, 0.7, 18, 0.2, { gl: "中" }),
  F("蓝莓", "", "水果", 57, 0.7, 14, 0.3, { gl: "低" }),
  F("草莓", "", "水果", 32, 0.7, 7.7, 0.3, { gl: "低" }),
  F("西瓜", "", "水果", 30, 0.6, 7.6, 0.2, { gl: "高" }),
  F("猕猴桃", "", "水果", 61, 1.1, 14.7, 0.5, { aliases: ["奇异果"], serving: { label: "个", grams: 80 }, gl: "低" }),
  F("牛油果", "", "水果", 160, 2, 8.5, 15, { aliases: ["鳄梨"], serving: { label: "个", grams: 150 }, gl: "低" }),
  F("梨", "", "水果", 51, 0.4, 13.1, 0.1, { serving: { label: "个", grams: 220 }, gl: "低" }),

  /* ---------- 坚果 ---------- */
  F("混合坚果", "", "坚果", 607, 20, 21, 54, { serving: { label: "小包", grams: 25 }, keywords: ["健康脂肪"] }),
  F("杏仁", "", "坚果", 579, 21, 22, 50, { aliases: ["巴旦木"] }),
  F("核桃", "", "坚果", 654, 15, 14, 65, {}),
  F("腰果", "", "坚果", 553, 18, 30, 44, {}),
  F("花生", "", "坚果", 567, 26, 16, 50, { aliases: ["花生米"] }),
  F("瓜子", "", "坚果", 615, 24, 16, 53, { aliases: ["葵花籽"] }),
  F("葡萄干", "", "坚果", 299, 3.1, 79, 0.5, {}),

  /* ---------- 零食 ---------- */
  F("薯片（原味）", "", "零食", 536, 7, 53, 35, { aliases: ["薯片"], serving: { label: "袋", grams: 70 }, gl: "高" }),
  F("饼干（原味）", "", "零食", 502, 7, 64, 25, { aliases: ["饼干"], serving: { label: "包", grams: 100 }, gl: "高" }),
  F("牛奶巧克力", "", "零食", 546, 4.9, 61, 31, { aliases: ["巧克力"], serving: { label: "排", grams: 43 }, gl: "中" }),
  F("黑巧克力（70%）", "", "零食", 598, 7.8, 46, 43, { serving: { label: "排", grams: 40 }, gl: "低" }),
  F("士力架", "", "零食", 480, 8.6, 62, 22, { aliases: ["花生夹心巧克力"], serving: { label: "条", grams: 51 }, gl: "高" }),
  F("蛋白棒", "", "零食", 380, 30, 40, 12, { serving: { label: "根", grams: 60 }, keywords: ["高蛋白"] }),
  F("辣条", "", "零食", 420, 9, 45, 22, { aliases: ["大面筋"], serving: { label: "包", grams: 106 }, gl: "高" }),
  F("海苔", "", "零食", 35, 5.8, 5.1, 0.3, { serving: { label: "包", grams: 4 } }),
  F("爆米花", "", "零食", 387, 12, 78, 4, { serving: { label: "桶", grams: 90 }, gl: "高" }),
  F("冰淇淋", "", "零食", 207, 3.5, 24, 11, { serving: { label: "球", grams: 60 }, gl: "高" }),
  F("奶油蛋糕", "", "零食", 371, 3.5, 53, 15, { aliases: ["蛋糕"], serving: { label: "块", grams: 100 }, gl: "高" }),
  F("蛋黄派", "", "零食", 420, 5, 45, 25, { serving: { label: "个", grams: 25 }, gl: "高" }),
  F("沙琪玛", "", "零食", 470, 6, 60, 23, { serving: { label: "个", grams: 30 }, gl: "高" }),
  F("果冻", "", "零食", 70, 0, 17, 0, { serving: { label: "个", grams: 25 }, gl: "高" }),

  /* ---------- 饮料 ---------- */
  F("可乐", "", "饮料", 42, 0, 10.6, 0, { unit: "ml", ml: true, serving: { label: "罐", grams: 330 }, gl: "高" }),
  F("零度可乐", "", "饮料", 0, 0, 0, 0, { aliases: ["零糖可乐", "无糖可乐"], unit: "ml", ml: true, serving: { label: "罐", grams: 330 }, gl: "低" }),
  F("雪碧", "", "饮料", 41, 0, 10.5, 0, { unit: "ml", ml: true, serving: { label: "罐", grams: 330 }, gl: "高" }),
  F("东方树叶（无糖茶）", "", "饮料", 0, 0, 0, 0, { aliases: ["无糖茶", "东方树叶"], unit: "ml", ml: true, serving: { label: "瓶", grams: 500 }, gl: "低" }),
  F("元气森林气泡水（白桃）", "", "饮料", 0, 0, 0, 0, { aliases: ["气泡水"], unit: "ml", ml: true, serving: { label: "瓶", grams: 480 }, gl: "低" }),
  F("美式咖啡（无糖）", "", "饮料", 2, 0.3, 0, 0, { aliases: ["美式", "黑咖啡"], unit: "ml", ml: true, serving: { label: "杯", grams: 250 }, gl: "低" }),
  F("拿铁（全脂）", "", "饮料", 55, 3, 5, 2.5, { aliases: ["拿铁"], unit: "ml", ml: true, serving: { label: "杯", grams: 350 }, gl: "低" }),
  F("珍珠奶茶", "", "饮料", 80, 1.2, 14, 2.5, { aliases: ["奶茶"], unit: "ml", ml: true, serving: { label: "杯", grams: 500 }, gl: "高" }),
  F("橙汁", "", "饮料", 45, 0.7, 10.4, 0.2, { unit: "ml", ml: true, serving: { label: "杯", grams: 250 }, gl: "中" }),
  F("运动饮料", "", "饮料", 26, 0, 6.5, 0, { unit: "ml", ml: true, serving: { label: "瓶", grams: 500 }, gl: "高" }),
  F("啤酒", "", "饮料", 43, 0.5, 3.6, 0, { unit: "ml", ml: true, serving: { label: "罐", grams: 330 }, gl: "高" }),
  F("红酒", "", "饮料", 85, 0.1, 2.6, 0, { unit: "ml", ml: true, serving: { label: "杯", grams: 150 }, gl: "低" }),

  /* ---------- 品牌包装食品（参考值，需以包装为准） ---------- */
  F("红烧牛肉面", "康师傅", "速食", 473, 9.5, 61, 21, { aliases: ["康师傅红烧牛肉面"], spec: "103g/包", package: { label: "包", grams: 103 }, keywords: ["方便面"], source: "reference", reliability: "reference", gl: "高" }),
  F("老坛酸菜牛肉面", "统一", "速食", 460, 8.5, 60, 20, { aliases: ["老坛酸菜面"], spec: "121g/包", package: { label: "包", grams: 121 }, keywords: ["方便面"], gl: "高" }),
  F("原味夹心饼干", "奥利奥", "零食", 484, 4.5, 69, 21, { aliases: ["奥利奥"], spec: "116g/包", package: { label: "包", grams: 116 }, gl: "高" }),
  F("薯片 原味", "乐事", "零食", 542, 6.6, 52, 34, { aliases: ["乐事薯片"], spec: "70g/袋", package: { label: "袋", grams: 70 }, gl: "高" }),
  F("牛奶巧克力", "德芙", "零食", 546, 6.5, 58, 32, { aliases: ["德芙巧克力"], spec: "43g/排", serving: { label: "排", grams: 43 }, gl: "中" }),
  F("花生夹心巧克力", "士力架", "零食", 480, 8.6, 62, 22, { aliases: ["士力架"], spec: "51g/条", serving: { label: "条", grams: 51 }, gl: "高" }),
  F("纯牛奶", "蒙牛", "乳制品", 64, 3.3, 4.9, 3.6, { aliases: ["蒙牛纯牛奶"], unit: "ml", ml: true, spec: "250ml/盒", serving: { label: "盒", grams: 250 }, package: { label: "盒", grams: 250 } }),
  F("安慕希 原味酸奶", "伊利", "乳制品", 105, 3.1, 13, 4.3, { aliases: ["安慕希"], spec: "205g/瓶", serving: { label: "瓶", grams: 205 }, package: { label: "瓶", grams: 205 }, gl: "中" }),
  F("原味无糖酸奶", "简爱", "乳制品", 97, 9, 4, 5, { aliases: ["简爱无糖酸奶", "简爱"], spec: "135g/杯", serving: { label: "杯", grams: 135 }, keywords: ["无糖", "高蛋白"], gl: "低" }),
  F("三三三倍希腊酸奶", "乐纯", "乳制品", 120, 11, 6, 5.5, { aliases: ["乐纯希腊酸奶", "乐纯"], spec: "135g/杯", serving: { label: "杯", grams: 135 }, keywords: ["希腊酸奶", "高蛋白"], gl: "低" }),
  F("如实 无糖酸奶", "光明", "乳制品", 78, 3.5, 6, 4, { aliases: ["光明如实"], spec: "135g/杯", serving: { label: "杯", grams: 135 }, keywords: ["无糖"], gl: "低" }),
  F("高蛋白酸奶", "简爱", "乳制品", 74, 10, 5, 1.5, { aliases: ["简爱高蛋白"], spec: "150g/杯", serving: { label: "杯", grams: 150 }, keywords: ["高蛋白"], gl: "低" }),
  F("东方树叶 乌龙茶", "农夫山泉", "饮料", 0, 0, 0, 0, { aliases: ["东方树叶"], unit: "ml", ml: true, spec: "500ml/瓶", serving: { label: "瓶", grams: 500 }, package: { label: "瓶", grams: 500 }, gl: "低" }),
  F("白桃味气泡水", "元气森林", "饮料", 0, 0, 0, 0, { aliases: ["元气森林"], unit: "ml", ml: true, spec: "480ml/瓶", serving: { label: "瓶", grams: 480 }, package: { label: "瓶", grams: 480 }, gl: "低" }),
  F("每日坚果", "三只松鼠", "坚果", 600, 20, 20, 54, { aliases: ["三只松鼠坚果"], spec: "25g/包", package: { label: "包", grams: 25 } }),
  F("猪肉脯", "良品铺子", "零食", 400, 35, 20, 20, { aliases: ["良品铺子猪肉脯"], spec: "50g/包", package: { label: "包", grams: 50 } }),
  F("大面筋", "卫龙", "零食", 420, 9, 45, 22, { aliases: ["卫龙辣条"], spec: "106g/包", package: { label: "包", grams: 106 }, gl: "高" }),
  F("好丽友派", "好丽友", "零食", 420, 5, 45, 25, { aliases: ["派"], spec: "34g/个", serving: { label: "个", grams: 34 }, gl: "高" }),
  F("蛋黄派", "达利园", "零食", 420, 5, 45, 25, { aliases: ["达利园蛋黄派"], spec: "25g/个", serving: { label: "个", grams: 25 }, gl: "高" }),
  F("雪饼", "旺旺", "零食", 480, 6, 70, 20, { aliases: ["旺旺雪饼"], spec: "84g/包", package: { label: "包", grams: 84 }, gl: "高" }),
  F("沙琪玛", "徐福记", "零食", 470, 6, 60, 23, { aliases: ["徐福记沙琪玛"], spec: "30g/个", serving: { label: "个", grams: 30 }, gl: "高" }),
  F("冰红茶", "康师傅", "饮料", 38, 0, 9.2, 0, { aliases: ["康师傅冰红茶"], unit: "ml", ml: true, spec: "500ml/瓶", serving: { label: "瓶", grams: 500 }, gl: "高" }),
  F("凉茶", "王老吉", "饮料", 38, 0, 9.5, 0, { aliases: ["王老吉"], unit: "ml", ml: true, spec: "310ml/罐", serving: { label: "罐", grams: 310 }, gl: "高" }),
  F("维生素功能饮料", "红牛", "饮料", 46, 0, 11, 0, { aliases: ["红牛"], unit: "ml", ml: true, spec: "250ml/罐", serving: { label: "罐", grams: 250 }, gl: "高" }),
  F("拿铁（中杯）", "星巴克", "饮料", 50, 3, 5, 2.4, { aliases: ["星巴克拿铁"], unit: "ml", ml: true, spec: "355ml/杯", serving: { label: "杯", grams: 355 } }),
  F("三合一速溶咖啡", "雀巢", "饮料", 450, 5, 70, 18, { aliases: ["雀巢咖啡"], spec: "15g/条", package: { label: "条", grams: 15 }, gl: "高" }),

  /* ---------- 哥本（基准参考值，净含量为常见包装规格，以实物包装为准） ---------- */
  F("红豆满满乳酪包", "哥本", "主食", 280, 8.5, 45, 8, {
    aliases: ["哥本红豆乳酪包", "红豆乳酪包", "哥本红豆满满乳酪包"],
    keywords: ["哥本", "乳酪包", "代餐", "早餐"],
    spec: "70g/袋", package: { label: "袋", grams: 70 },
    note: "净含量为常见包装规格（约 70g/袋），以实物包装为准。",
    source: "reference", reliability: "reference", gl: "中"
  }),
  F("香辣碱水结", "哥本", "主食", 260, 9, 45, 3, {
    aliases: ["哥本碱水结", "哥本香辣碱水结", "碱水结"],
    keywords: ["哥本", "碱水结", "全麦", "早餐"],
    spec: "90g/袋", package: { label: "袋", grams: 90 },
    note: "净含量为常见包装规格（约 90g/袋），以实物包装为准。",
    source: "reference", reliability: "reference", gl: "中"
  }),
  F("全麦魔芋五黑欧包", "哥本", "主食", 235, 9, 40, 4, {
    aliases: ["哥本五黑欧包", "哥本全麦欧包", "五黑欧包"],
    keywords: ["哥本", "欧包", "全麦", "魔芋"],
    spec: "85g/袋", package: { label: "袋", grams: 85 },
    note: "净含量为常见包装规格（约 85g/袋），以实物包装为准。",
    source: "reference", reliability: "reference", gl: "中"
  }),
  F("半熟巴斯克蛋糕（抹茶味）", "哥本", "主食", 330, 5, 30, 20, {
    aliases: ["哥本巴斯克蛋糕", "半熟巴斯克", "抹茶巴斯克"],
    keywords: ["哥本", "巴斯克", "蛋糕", "抹茶"],
    spec: "130g/盒", package: { label: "盒", grams: 130 },
    note: "净含量为常见包装规格（约 130g/盒），以实物包装为准。",
    source: "reference", reliability: "reference", gl: "中"
  })
];

/* 给带有明确包装规格（spec 形如 "250ml/盒"）的品牌食品自动补 package，避免手工漏项；
   已有 package 的保持原样，spec 不明确的（如"约"）不自动生成，避免编造规格。 */
FOOD_DB.forEach(f => {
  if (f.package || !f.spec) return;
  const m = String(f.spec).match(/^([\d.]+)(g|ml)\/(\S+)$/);
  if (!m) return;
  const grams = parseFloat(m[1]);
  if (!(grams > 0)) return;
  f.package = { label: m[3], grams };
});

/* 配料成分库：仅用于识别与展示配料，不用于推算精确营养 */
const INGREDIENT_NAMES = [
  "小麦粉", "面粉", "白砂糖", "蔗糖", "果葡糖浆", "植物油", "棕榈油", "氢化植物油", "黄油", "奶油",
  "全脂乳粉", "脱脂乳粉", "乳清蛋白", "可可粉", "可可液块", "鸡蛋", "蛋黄", "蛋白", "全蛋液",
  "食用盐", "盐", "水", "芝士", "奶酪", "奶粉", "蜂蜜", "麦芽糖浆", "玉米淀粉", "木薯淀粉",
  "马铃薯", "土豆", "红薯", "紫薯", "红豆", "绿豆", "豌豆", "芝麻", "花生", "核桃", "杏仁",
  "葡萄干", "蔓越莓干", "椰蓉", "椰浆", "巧克力", "代可可脂", "肉松", "海苔", "紫菜", "虾皮",
  "酵母", "泡打粉", "小苏打", "香辛料", "香精", "色素", "防腐剂", "增稠剂", "明胶", "果胶",
  "生牛乳", "乳酸菌", "嗜热链球菌", "保加利亚乳杆菌", "乳双歧杆菌", "燕麦", "谷物", "坚果"
];

/* ================= 画像标签（多选） ================= */
const PROFILE_GROUPS = [
  {
    key: "identity", title: "身份及生活场景",
    options: [
      { id: "student", label: "学生党", mods: { proteinAdd: 0.1, mealDelta: [0.02, 0, -0.02, 0], notes: ["学生党：早餐吃饱、午餐能量足，晚餐不过量"] } },
      { id: "office", label: "上班族", mods: { breakfastCarbFactor: 0.72, mealDelta: [-0.06, 0.04, 0.01, 0.01], lowGL: true, notes: ["上班族：早餐降低碳水并优先低 GL，减少上午犯困"] } },
      { id: "freelance", label: "自由职业者", mods: { notes: ["自由职业：作息弹性，建议固定进餐时间"] } },
      { id: "home", label: "居家人群", mods: { notes: ["居家：可自行安排备餐与加餐"] } },
      { id: "shift", label: "轮班/夜班", mods: { mealShift: "late", notes: ["轮班/夜班：主餐放在上班前，睡前 2 小时避免大量进食"] } }
    ]
  },
  {
    key: "activity", title: "活动和运动习惯",
    options: [
      { id: "strength", label: "力量训练", mods: { proteinAdd: 0.35, notes: ["力量训练：蛋白质上调，训练后 1-2 小时补一餐"] } },
      { id: "endurance", label: "耐力运动", mods: { proteinAdd: 0.15, fatAdd: -0.15, carbFloor: 4.5, notes: ["耐力运动：优先保证碳水，脂肪适当下调"] } },
      { id: "ball", label: "球类运动", mods: { proteinAdd: 0.15, mealDelta: [0.02, 0, 0, -0.02], notes: ["球类运动：比赛/训练日增加一餐碳水"] } },
      { id: "light", label: "轻度活动", mods: {} },
      { id: "sedentary", label: "久坐", mods: { proteinAdd: -0.1, notes: ["久坐：每小时起身活动，避免久坐加餐"] } }
    ]
  },
  {
    key: "diet", title: "饮食场景",
    options: [
      { id: "eatout", label: "经常外食", mods: { fatAdd: 0.15, notes: ["外食：油盐偏高，优先蒸煮/少油，酱汁少放"] } },
      { id: "cook", label: "自行烹饪", mods: { fatAdd: -0.05, notes: ["自炊：可精确控制油盐与份量"] } },
      { id: "mealprep", label: "经常备餐", mods: { notes: ["备餐：按餐分装，冷藏 3 天内吃完"] } },
      { id: "takeout", label: "经常点外卖", mods: { fatAdd: 0.15, proteinAdd: 0.1, notes: ["外卖：优先高蛋白+蔬菜，酱汁另放"] } }
    ]
  },
  {
    key: "lifeStage", title: "年龄或生活阶段",
    options: [
      { id: "teen", label: "青少年", mods: { proteinAdd: 0.1, fatAdd: 0.05, notes: ["青少年：保证能量、蛋白质与钙摄入"] } },
      { id: "adult", label: "成年人", mods: {} },
      { id: "senior", label: "中老年", mods: { proteinAdd: 0.1, fatAdd: -0.1, notes: ["中老年：优质蛋白 + 控制饱和脂肪"] } }
    ]
  }
];

const PROFILE_LABEL = {};
PROFILE_GROUPS.forEach(g => g.options.forEach(o => { PROFILE_LABEL[o.id] = o.label; }));

/* AI 参照物 */
const REF_OBJECTS = {
  card: { label: "标准银行卡（85.6×54mm）", area: 46.2, note: "用空白卡或同尺寸卡片，避免拍摄卡面个人信息" },
  a4: { label: "A4 纸（210×297mm）", area: 623.7, note: "整张 A4 纸作参照，食物放在纸上" },
  coin: { label: "一元硬币（直径 25mm）", area: 4.9, note: "适合小份食物或酱料" },
  can: { label: "易拉罐顶面（直径约 66mm）", area: 34.2, note: "常见的饮料罐顶部" },
  phone: { label: "手机（约 6.1 寸，147×72mm）", area: 105.8, note: "用手机背面朝上，避免屏幕反光" },
  cigarette: { label: "烟盒（约 88×58mm）", area: 51, note: "常见软包烟盒正面约 8.8×5.8cm，适合作为桌面/快餐参照" }
};
const BODY_REFS = {
  fist: { label: "拳头（约 180ml 体积）", vol: 180, note: "一个拳头约等于一小碗熟米饭；手部尺寸个体差异大" },
  palm: { label: "手掌（掌心，约 9×8cm）", area: 72, note: "掌心大小约等于一副扑克牌，适合估肉量" },
  thumb: { label: "拇指（约 6×2cm）", area: 12, note: "拇指大小适合估油脂、酱料" }
};
const DENSITY = { 主食: 0.85, 肉蛋: 1.0, 乳制品: 1.03, 豆制品: 1.0, 蔬菜: 0.55, 水果: 0.7, 坚果: 0.6, 零食: 0.5, 饮料: 1.0, 速食: 0.7, 其他: 0.8 };
const THICKNESS = { thin: 1.0, medium: 2.0, thick: 3.5 };
const COOK_FACTOR = {
  raw: { cal: 1.0, fat: 1.0, note: "生食/凉拌，按原料估算" },
  steam: { cal: 1.02, fat: 1.0, note: "蒸煮，几乎不额外加油" },
  lowoil: { cal: 1.08, fat: 1.15, note: "少油烹饪，按每 100g 约 2-3g 油估算" },
  highoil: { cal: 1.28, fat: 1.8, note: "多油煎炒，油脂明显增加" },
  fried: { cal: 1.5, fat: 2.4, note: "油炸，吸油量高，估算误差大" }
};

/* ================= 工具函数 ================= */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
/**
 * 本地日期 YYYY-MM-DD。
 * 不能用 toISOString 截取日期：它按 UTC 计算，在 UTC+8 的凌晨 0-8 点会算成前一天。
 * 支持传入 Date 便于测试；不传时取当前本地时间。
 */
function todayStr(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const fmt = (n, d = 1) => (n === undefined || n === null || n === "" || isNaN(n)) ? "--" : Number(n).toFixed(d);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* 全角转半角、去空白与常见标点，用于搜索匹配 */
function norm(s) {
  return String(s ?? "")
    .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, " ")
    .toLowerCase()
    .replace(/[\s\-_/\\()（）【】\[\]·,，.。:：;；'"]/g, "");
}

/* ================= 状态与迁移 ================= */
function emptyTags() {
  return { identity: [], activity: [], diet: [], lifeStage: [] };
}

function defaultState() {
  return {
    version: 2,
    profileTags: emptyTags(),
    mealsPerDay: 3,
    body: { sex: "male", age: 25, height: 170, weight: 65, waist: "", neck: "", hip: "", activity: 1.55 },
    plan: { goalType: "lose", targetWeight: 60, weeks: 12 },
    entries: [],
    customFoods: [],
    settings: { defaultTags: emptyTags(), defaultMeals: 3 }
  };
}

function sanitizeTags(tags) {
  const out = emptyTags();
  if (!tags || typeof tags !== "object") return out;
  PROFILE_GROUPS.forEach(g => {
    const valid = new Set(g.options.map(o => o.id));
    const arr = Array.isArray(tags[g.key]) ? tags[g.key] : [];
    out[g.key] = [...new Set(arr.filter(id => valid.has(id)))];
  });
  return out;
}

function tagsFromLegacy(profile) {
  const t = emptyTags();
  if (profile === "office") t.identity.push("office");
  else if (profile === "student") t.identity.push("student");
  else if (profile === "athlete") t.activity.push("strength");
  else if (profile === "elderly") t.lifeStage.push("senior");
  return t;
}

function migrateState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== "object") return base;
  const s = { ...base, ...raw };
  s.version = 2;
  s.body = { ...base.body, ...(raw.body || {}) };
  s.plan = { ...base.plan, ...(raw.plan || {}) };
  s.profileTags = raw.profileTags ? sanitizeTags(raw.profileTags) : tagsFromLegacy(raw.profile);
  s.settings = { ...base.settings, ...(raw.settings || {}) };
  s.settings.defaultTags = raw.settings && raw.settings.defaultTags
    ? sanitizeTags(raw.settings.defaultTags)
    : JSON.parse(JSON.stringify(s.profileTags));
  s.customFoods = Array.isArray(raw.customFoods) ? raw.customFoods.filter(f => f && f.name).map(f => ({
    ...f,
    aliases: f.aliases || [],
    keywords: f.keywords || [],
    unit: f.unit || "g",
    nutrition: f.nutrition || { calories: f.calories || 0, protein: f.protein || 0, carbs: f.carbs || 0, fat: f.fat || 0 },
    reliability: f.reliability || "user",
    source: f.source || "user"
  })) : [];
  s.entries = Array.isArray(raw.entries) ? raw.entries.map(e => ({
    brand: "",
    status: "complete",
    ...e
  })) : [];
  s.entries.forEach(e => { if (!["complete", "pending"].includes(e.status)) e.status = "complete"; });
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return defaultState();
    return migrateState(JSON.parse(raw));
  } catch (err) {
    console.warn("读取本地数据失败，使用默认状态", err);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("保存失败（可能存储空间不足）", err);
    alert("保存失败：浏览器存储空间可能已满，请导出数据后清理。");
  }
}

function setProfileTags(tags) {
  state.profileTags = sanitizeTags(tags);
  saveState();
}

let state = loadState();

/* ================= 主题切换 ================= */
const THEME_KEY = "nutritionTheme";

function applyTheme(theme, persist = true) {
  const t = theme === "dark" ? "dark" : "light";
  if (document.documentElement && document.documentElement.dataset) {
    document.documentElement.dataset.theme = t;
  }
  if (persist) {
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ }
  }
  const btn = $("#themeToggle");
  if (btn) {
    btn.textContent = t === "dark" ? "☀️" : "🌙";
    btn.title = t === "dark" ? "切换到浅色" : "切换到深色";
  }
}

function toggleTheme() {
  const cur = document.documentElement && document.documentElement.dataset
    ? document.documentElement.dataset.theme : "light";
  applyTheme(cur === "dark" ? "light" : "dark");
}

/* ================= AI 服务（仅同源 /api，密钥不进入前端） ================= */
const apiState = { ready: false, health: null };
let lastApiEstimate = null;

const AI_OFFLINE_MSG = "无法连接 AI 后端（服务可能未启动或已停止）：请运行项目根目录 start-server.cmd 或 node server.js，然后刷新页面重试";
const AI_SHORT_OFFLINE_MSG = "AI 后端未连接：请运行 start-server.cmd（或 node server.js）后重试。";

function apiUrl(path) {
  const base = (typeof window !== "undefined" && window.location) ? window.location.href : "http://localhost/";
  return new URL("api/" + path, base).toString();
}

/**
 * 把底层异常翻译成中文可操作提示（纯函数，便于测试）。
 * - 网络层失败（浏览器 "Failed to fetch" / TypeError）→ 提示启动后端；
 * - 429（账号并发/频率限制）→ 带上服务端 message 与 retryAfterSec；
 * - 超时 → 中文超时提示。
 */
function friendlyAiError(err) {
  if (!err) return "AI 请求失败，请稍后重试";
  if (err.name === "AbortError") return "AI 请求超时，请稍后重试";
  const msg = String(err.message || err || "").trim();
  if (num(err.status) === 429) {
    const retry = err.retryAfterSec ? `，请约 ${err.retryAfterSec} 秒后重试` : "，请稍后重试";
    return `AI 服务繁忙（429 账号并发/频率限制${retry}）：${msg || "服务端未返回详细信息"}`;
  }
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed|fetch failed|network request failed|ERR_NETWORK/i.test(msg)) {
    return AI_OFFLINE_MSG;
  }
  if (!msg) return "AI 请求失败，请稍后重试";
  return msg;
}

async function fetchJson(url, options = {}, timeout = 130000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    if (typeof fetch !== "function") {
      const err = new Error("当前环境不支持联网请求（fetch 不可用）");
      err.code = "NO_FETCH";
      throw err;
    }
    const res = await fetch(url, { cache: "no-store", signal: controller.signal, ...options });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-json */ }
    if (!res.ok || !data || data.ok === false) {
      const err = new Error((data && data.message) || `AI 服务错误（${res.status}）`);
      err.status = res.status;
      // 透出服务端业务码（LOGIN_REQUIRED / QUOTA_EXCEEDED / NOT_LOGGED_IN），供前端门禁分支使用
      if (data && data.code != null) err.code = data.code;
      if (data && data.retryAfterSec != null) err.retryAfterSec = data.retryAfterSec;
      throw err;
    }
    return data;
  } catch (err) {
    // 统一转成中文提示后再抛给 UI，避免用户看到 "Failed to fetch"
    throw new Error(friendlyAiError(err));
  } finally {
    clearTimeout(timer);
  }
}

/** 根据 AI 可用状态显示/禁用「AI 搜索」按钮（失败时可重试，不直接消失） */
function updateApiButtons(ready) {
  ["#trackerAiBtn", "#foodsAiBtn"].forEach(sel => {
    const btn = $(sel);
    if (btn) { btn.hidden = false; btn.disabled = !ready; }
  });
}

function setApiStatus(ok, msg) {
  const el = $("#apiStatus");
  if (el) { el.textContent = msg; el.style.color = ok ? "var(--primary-dark)" : "var(--warning)"; }
  const be = $("#backendStatus");
  if (be) be.textContent = msg;
  updateApiButtons(ok);
}

async function checkApi() {
  if (typeof fetch !== "function") {
    apiState.ready = false;
    setApiStatus(false, "当前环境不支持联网请求，AI 功能不可用。");
    return false;
  }
  try {
    const h = await fetchJson(apiUrl("health"), { method: "GET" }, 8000);
    apiState.ready = true;
    apiState.health = h;
    setApiStatus(true, `AI 已连接：文本 ${h.textModel} / 视觉 ${h.visionModel} · 约 ${h.rpm} 次/分钟`);
    // 并行刷新登录态（不阻塞健康检查返回；失败按游客处理）
    loadAuthMe();
    return true;
  } catch (e) {
    apiState.ready = false;
    apiState.health = null;
    setApiStatus(false, AI_SHORT_OFFLINE_MSG);
    return false;
  }
}

/** 每次 AI 调用前确保后端可用：未连接先自动 checkApi，仍失败则提示并禁用按钮 */
async function ensureApiReady(box) {
  if (apiState.ready) return true;
  setApiStatus(false, "AI 未连接，正在尝试自动重连…");
  await checkApi();
  if (apiState.ready) return true;
  if (box) {
    box.innerHTML = `<p class="error-text">${esc(AI_OFFLINE_MSG)}</p><p class="hint">本地食品库、记录、计划等功能不受影响。</p>`;
  }
  setApiStatus(false, AI_SHORT_OFFLINE_MSG);
  return false;
}

/** 窗口重新获得焦点 / 切回页面时自动重连 AI 后端（避免进程被回收后一直显示失败） */
function bindApiReconnect() {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  const retry = () => { if (!apiState.ready) checkApi(); };
  window.addEventListener("focus", retry);
  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") retry();
    });
  }
}

async function aiFoodSearch(query) {
  return fetchJson(apiUrl("food-search"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
}

async function aiEstimatePhoto(payload) {
  return fetchJson(apiUrl("estimate-photo"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function aiScanLabel(image) {
  return fetchJson(apiUrl("scan-label"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image })
  });
}

/* ================= v3.6 账号 / AI 门禁（配合后端 /api/auth/*） ================= */

// 登录态：user=null 表示游客；quota 来自后端 user.quota
const authState = { checked: false, user: null };

/**
 * 规范化邮箱并校验格式（纯函数，便于测试）。
 * 返回 { ok, email, message }；email 为 trim + 转小写后的值。
 */
function normalizeEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) return { ok: false, email: "", message: "请输入邮箱地址" };
  // 宽松校验：本地部分@域名.顶级域，避免误伤合法地址
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, email, message: "邮箱格式不正确，请检查后重试" };
  }
  return { ok: true, email, message: "" };
}

/**
 * 把 fetchJson 抛出的错误分类为账号门禁类型（纯函数，便于测试）。
 * 返回 "login_required" | "quota_exceeded" | "not_logged_in" | "other"。
 * 优先用 err.code，缺失时按 status 兜底。
 */
function classifyAuthError(err) {
  if (!err) return "other";
  const code = err.code;
  if (code === "LOGIN_REQUIRED") return "login_required";
  if (code === "QUOTA_EXCEEDED") return "quota_exceeded";
  if (code === "NOT_LOGGED_IN") return "not_logged_in";
  const st = num(err.status);
  if (st === 401) return "login_required";
  if (st === 429) return "quota_exceeded";
  return "other";
}

/** 取邮箱「@」前的前缀用于顶栏展示（纯函数）；无 @ 时回退整串。 */
function emailPrefix(email) {
  const s = String(email ?? "").trim();
  if (!s) return "";
  const at = s.indexOf("@");
  return at > 0 ? s.slice(0, at) : s;
}

/**
 * 把服务端 quota 对象格式化为中文文案（纯函数）。
 * 兼容 remaining/total/usedToday；缺字段时用合理默认，绝不显示 undefined。
 */
function formatQuotaText(quota) {
  const q = quota || {};
  const total = Number.isFinite(num(q.total)) && num(q.total) > 0 ? num(q.total) : 5;
  let remaining = num(q.remaining);
  if (!Number.isFinite(q.remaining) || q.remaining == null) remaining = total - num(q.usedToday);
  remaining = Math.max(0, Math.min(total, remaining));
  return `今日剩余 ${remaining}/${total}`;
}

/**
 * 把 retryAfterSec 换算成人类可读的恢复时间（纯函数）。
 * <60s → 「约 N 秒后」；否则分钟；再大加小时。非法值返回空串。
 */
function formatRetryAfter(sec) {
  const n = Math.max(0, Math.round(num(sec)));
  if (!n) return "";
  if (n < 60) return `约 ${n} 秒后`;
  if (n < 3600) {
    const m = Math.ceil(n / 60);
    return `约 ${m} 分钟后`;
  }
  const h = Math.floor(n / 3600);
  const m = Math.ceil((n % 3600) / 60);
  return m > 0 ? `约 ${h} 小时 ${m} 分钟后` : `约 ${h} 小时后`;
}

/**
 * 从后端响应解析登录用户对象（纯函数，容错）。
 * 期望 data.user:{email,quota}；无 email 视为未登录返回 null。
 */
function parseAuthUser(data) {
  if (!data || !data.ok || !data.user) return null;
  const email = String(data.user.email ?? "").trim();
  if (!email) return null;
  return { email, quota: data.user.quota || null };
}

/** 应用登录态并刷新顶栏（body 类供弹窗滚动锁定用）。 */
function applyAuthUser(user) {
  authState.checked = true;
  authState.user = user || null;
  renderAccountEntry();
  if (typeof document !== "undefined" && document.body && document.body.classList) {
    document.body.classList.toggle("auth-modal-open", !!$("#authModal") && !$("#authModal").hidden);
  }
}

async function loadAuthMe() {
  try {
    const data = await fetchJson(apiUrl("auth/me"), { method: "GET" }, 8000);
    applyAuthUser(parseAuthUser(data));
  } catch (e) {
    // 未登录 / 网络失败都按游客处理，不影响任何本地功能
    applyAuthUser(null);
  }
  return authState.user;
}

async function doLogout() {
  try { await fetchJson(apiUrl("auth/logout"), { method: "POST" }); } catch (e) { /* 忽略：本地一律清除登录态 */ }
  applyAuthUser(null);
}

/* ---------- AI 门禁：结果区提示（纯 UI，读取已分类的错误） ---------- */

/** 生成「需要登录」提示 HTML（esc 转义），并打开登录弹窗。 */
function gateLoginHtml(msg) {
  return `<p class="error-text">${esc(msg || "AI 功能需注册登录（每天赠送 5 次额度）")}</p><p class="hint">本地记录、搜索、计划等功能不受影响。</p>`;
}

/** 生成「额度用尽」提示 HTML：服务端 message + retryAfterSec 换算的恢复时间。 */
function gateQuotaHtml(err) {
  const when = formatRetryAfter(err && err.retryAfterSec);
  const serverMsg = (err && err.message) ? String(err.message) : "今日 AI 额度已用完";
  const tail = when ? `（${when}可再次使用）` : "";
  return `<p class="error-text">${esc(serverMsg)}${esc(tail)}</p><p class="hint">额度按邮箱账号计算，明天会自动重置；也可切换其他账号。</p>`;
}

/** 结果区成功后的剩余次数徽标行（有 user 才显示）。 */
function quotaBadgeHtml() {
  if (!authState.user) return "";
  return `<p class="hint quota-remaining">🎯 ${esc(formatQuotaText(authState.user.quota))}</p>`;
}

/**
 * AI 调用成功后同步剩余额度：若响应体带 quota 直接采纳，否则异步拉 /auth/me。
 * （后端最终是否在 AI 响应里回传 quota 尚未定，两种都兼容。）
 */
async function adoptQuota(data) {
  if (data && data.quota && authState.user) {
    applyAuthUser({ email: authState.user.email, quota: data.quota });
    return;
  }
  if (authState.user) loadAuthMe();
}

/**
 * 统一处理一次 AI 调用抛出的异常：命中门禁则渲染对应提示并返回 true（已处理）。
 * box 为结果容器；返回 false 表示非门禁错误，交给调用方原有兜底逻辑。
 */
function handleAiGateError(box, err) {
  const kind = classifyAuthError(err);
  if (kind === "login_required" || kind === "not_logged_in") {
    if (box) box.innerHTML = gateLoginHtml();
    applyAuthUser(null);
    openAuthModal("AI 功能需注册登录（送每天 5 次），登录后即可使用。");
    return true;
  }
  if (kind === "quota_exceeded") {
    if (box) box.innerHTML = gateQuotaHtml(err);
    return true;
  }
  return false;
}

/* ---------- 顶栏账户入口（未登录「登录」/已登录邮箱前缀 + 下拉菜单） ---------- */

let accountMenuOpen = false;

/** 根据 authState 渲染顶栏账户按钮与下拉菜单内容。 */
function renderAccountEntry() {
  const btn = $("#accountBtn");
  if (!btn) return;
  const user = authState.user;
  const label = $("#accountLabel");
  const menu = $("#accountMenu");
  if (user) {
    btn.classList.add("logged-in");
    if (label) label.textContent = emailPrefix(user.email);
    btn.setAttribute("aria-label", `已登录：${user.email}`);
    if (menu) {
      menu.innerHTML = `
        <div class="account-menu-head">
          <span class="account-email">${esc(user.email)}</span>
          <span class="account-quota">${esc(formatQuotaText(user.quota))}</span>
        </div>
        <button type="button" class="account-menu-item" id="accountLogoutBtn">退出登录</button>`;
      const lo = $("#accountLogoutBtn");
      if (lo && typeof lo.addEventListener === "function") lo.addEventListener("click", () => { closeAccountMenu(); doLogout(); });
    }
  } else {
    btn.classList.remove("logged-in");
    if (label) label.textContent = "登录";
    btn.setAttribute("aria-label", "登录 / 注册");
    if (menu) menu.innerHTML = "";
    closeAccountMenu();
  }
}

function openAccountMenu() {
  const wrap = $("#accountWrap");
  const btn = $("#accountBtn");
  if (!wrap || !authState.user) return;
  accountMenuOpen = true;
  wrap.classList.add("open");
  if (btn) btn.setAttribute("aria-expanded", "true");
}

function closeAccountMenu() {
  const wrap = $("#accountWrap");
  const btn = $("#accountBtn");
  accountMenuOpen = false;
  if (wrap) wrap.classList.remove("open");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function toggleAccountMenu() {
  if (accountMenuOpen) closeAccountMenu(); else openAccountMenu();
}

function bindAccountEntry() {
  const btn = $("#accountBtn");
  if (!btn || typeof btn.addEventListener !== "function") return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (authState.user) toggleAccountMenu();
    else openAuthModal("");
  });
  // 点击页面其它处关闭下拉
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("click", (e) => {
      if (!accountMenuOpen) return;
      const wrap = $("#accountWrap");
      if (wrap && e.target && typeof e.target.closest === "function" && e.target.closest("#accountWrap")) return;
      closeAccountMenu();
    });
  }
  renderAccountEntry();
}

/* ---------- 登录弹窗（手写 modal：邮箱 → 验证码倒计时 → 验证成功自动关闭） ---------- */

let codeTimer = null;
let lastFocusedBeforeModal = null;

function setCodeCountdown(btn, secs) {
  if (!btn) return;
  if (secs > 0) {
    btn.disabled = true;
    btn.classList.add("counting");
    btn.textContent = `重新获取 ${secs}s`;
  } else {
    btn.disabled = false;
    btn.classList.remove("counting");
    btn.textContent = "获取验证码";
  }
}

function stopCodeCountdown() {
  if (codeTimer) { clearInterval(codeTimer); codeTimer = null; }
}

function startCodeCountdown(btn, total) {
  stopCodeCountdown();
  let secs = num(total) > 0 ? Math.round(num(total)) : 60;
  setCodeCountdown(btn, secs);
  codeTimer = setInterval(() => {
    secs--;
    if (secs <= 0) { stopCodeCountdown(); setCodeCountdown(btn, 0); }
    else setCodeCountdown(btn, secs);
  }, 1000);
}

function setAuthError(msg) {
  const el = $("#authError");
  if (!el) return;
  if (msg) { el.textContent = msg; el.hidden = false; }
  else { el.textContent = ""; el.hidden = true; }
}

function setAuthNotice(msg) {
  const el = $("#authNotice");
  if (!el) return;
  if (msg) { el.textContent = msg; el.hidden = false; }
  else { el.textContent = ""; el.hidden = true; }
}

function openAuthModal(intro) {
  const modal = $("#authModal");
  if (!modal) return;
  lastFocusedBeforeModal = (typeof document !== "undefined" && document.activeElement) ? document.activeElement : null;
  modal.hidden = false;
  if (typeof document !== "undefined" && document.body && document.body.classList) document.body.classList.add("auth-modal-open");
  setAuthError("");
  setAuthNotice(intro || "");
  const emailEl = $("#authEmail");
  const codeEl = $("#authCode");
  if (codeEl) codeEl.value = "";
  if (emailEl && typeof emailEl.focus === "function") setTimeout(() => { try { emailEl.focus(); } catch (e) {} }, 30);
}

function closeAuthModal() {
  const modal = $("#authModal");
  if (!modal) return;
  modal.hidden = true;
  if (typeof document !== "undefined" && document.body && document.body.classList) document.body.classList.remove("auth-modal-open");
  stopCodeCountdown();
  setAuthError("");
  setAuthNotice("");
  if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === "function") {
    try { lastFocusedBeforeModal.focus(); } catch (e) {}
  }
  lastFocusedBeforeModal = null;
}

async function requestLoginCode() {
  const emailEl = $("#authEmail");
  const btn = $("#authSendCodeBtn");
  const raw = emailEl ? emailEl.value : "";
  const norm = normalizeEmail(raw);
  if (!norm.ok) { setAuthError(norm.message); return; }
  if (emailEl) emailEl.value = norm.email;
  setAuthError("");
  setBusy(btn, true, "发送中…");
  try {
    const data = await fetchJson(apiUrl("auth/request-code"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: norm.email })
    });
    setAuthNotice(`验证码已发送到 ${norm.email}，${Math.round(num(data.expiresInSec) / 60 || 10)} 分钟内有效，请查收`);
    const codeEl = $("#authCode");
    if (codeEl && typeof codeEl.focus === "function") codeEl.focus();
    startCodeCountdown(btn, data.expiresInSec && num(data.expiresInSec) < 120 ? data.expiresInSec : 60);
  } catch (e) {
    setAuthError(e.message || "验证码发送失败，请稍后重试");
  } finally {
    // 成功时 startCodeCountdown 已接管按钮文案/禁用态；仅在未进入倒计时时恢复可点
    if (!codeTimer) setBusy(btn, false);
  }
}

async function submitLoginVerify() {
  const emailEl = $("#authEmail");
  const codeEl = $("#authCode");
  const btn = $("#authVerifyBtn");
  const norm = normalizeEmail(emailEl ? emailEl.value : "");
  if (!norm.ok) { setAuthError(norm.message); return; }
  const code = String(codeEl ? codeEl.value : "").trim();
  if (!/^\d{6}$/.test(code)) { setAuthError("请输入 6 位数字验证码"); return; }
  setAuthError("");
  setBusy(btn, true, "验证中…");
  try {
    const data = await fetchJson(apiUrl("auth/verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: norm.email, code })
    });
    const user = parseAuthUser(data);
    applyAuthUser(user);
    closeAuthModal();
  } catch (e) {
    const kind = classifyAuthError(e);
    if (kind === "not_logged_in") setAuthError("验证码不正确或已过期，请重新获取");
    else setAuthError(e.message || "验证失败，请检查邮箱与验证码后重试");
  } finally {
    setBusy(btn, false);
  }
}

function bindAuthModal() {
  const modal = $("#authModal");
  if (!modal) return;
  const sendBtn = $("#authSendCodeBtn");
  const verifyBtn = $("#authVerifyBtn");
  const closeBtn = $("#authCloseBtn");
  if (sendBtn && typeof sendBtn.addEventListener === "function") sendBtn.addEventListener("click", requestLoginCode);
  if (verifyBtn && typeof verifyBtn.addEventListener === "function") verifyBtn.addEventListener("click", submitLoginVerify);
  if (closeBtn && typeof closeBtn.addEventListener === "function") closeBtn.addEventListener("click", closeAuthModal);
  // 遮罩点击关闭
  modal.addEventListener("click", (e) => { if (e.target === modal) closeAuthModal(); });
  // Esc 关闭 + 焦点陷阱（Tab 在弹窗内循环）
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("keydown", (e) => {
      if (modal.hidden) return;
      if (e.key === "Escape") { closeAuthModal(); return; }
      if (e.key === "Tab") {
        const focusables = $$focusable(modal);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !modal.contains(active))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (active === last || !modal.contains(active))) { e.preventDefault(); first.focus(); }
      }
    });
  }
}

/** 收集弹窗内可聚焦元素（用于焦点陷阱）。 */
function $$focusable(root) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  return Array.prototype.slice.call(root.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.hidden);
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.classList.add("loading");
    btn.innerHTML = '<span class="spinner"></span>' + esc(label || "AI 思考中…");
  } else {
    btn.disabled = false;
    btn.classList.remove("loading");
    btn.textContent = btn.dataset.label || btn.textContent;
  }
}

function aiItemToFood(item) {
  const servingGrams = num(item.servingGrams);
  // 服务端 /api/food-search 的 items[].packageGrams（number|null）→ 前端 package；
  // 契约未就绪或为 null 时按 null 处理，不编造包装规格。
  const packageGrams = num(item.packageGrams);
  return {
    id: "ai_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    name: item.name,
    brand: item.brand || "",
    category: CATEGORIES.includes(item.category) ? item.category : "其他",
    unit: "g",
    aliases: [], keywords: [], barcode: "",
    nutrition: {
      calories: item.per100.kcal,
      protein: item.per100.protein,
      carbs: item.per100.carbs,
      fat: item.per100.fat,
      fiber: null,
      sodium: null
    },
    serving: servingGrams > 0 ? { label: "份", grams: servingGrams } : null,
    package: packageGrams > 0 ? { label: "袋", grams: packageGrams } : null,
    spec: packageGrams > 0 ? `${packageGrams}g/袋` : (servingGrams > 0 ? `${servingGrams}g/份` : ""),
    source: "ai",
    reliability: "ai",
    tags: ["AI估算"],
    gl: ""
  };
}

function renderAiFoodResults(container, data, onUse) {
  if (!container) return;
  container.innerHTML = `
    <p class="hint">AI 估算结果（${esc(data.model || "kimi")}${data.cached ? " · 缓存" : ""}）—— 点击任意一条会加入食品库并选中：</p>
    ${data.items.map((it, i) => `
      <div class="result-item" data-i="${i}">
        <div>
          <div class="name">${esc(it.name)}${it.brand ? " · " + esc(it.brand) : ""} <span class="badge ai">AI 估算</span></div>
          <div class="macros">${esc(it.category)}${it.note ? " · " + esc(it.note) : ""}${it.packageGrams ? " · 净含量 " + fmt(it.packageGrams, 0) + "g/袋" : ""}</div>
        </div>
        <div class="macros" style="text-align:right;">
          ${fmt(it.per100.kcal, 0)} kcal /100g<br>
          蛋${fmt(it.per100.protein, 1)} 碳${fmt(it.per100.carbs, 1)} 脂${fmt(it.per100.fat, 1)}
        </div>
      </div>
    `).join("")}
  `;
  container.querySelectorAll(".result-item").forEach((el) => {
    el.addEventListener("click", () => onUse(data.items[Number(el.dataset.i)]));
  });
}

async function runTrackerAiSearch() {
  const q = $("#foodNameInput").value.trim();
  if (!q) return alert("请先输入要查询的食品名称");
  const btn = $("#trackerAiBtn");
  const box = $("#trackerAiResults");
  setBusy(btn, true, "AI 搜索中…");
  box.innerHTML = '<p class="hint">正在检查 AI 后端连接…</p>';
  try {
    if (!(await ensureApiReady(box))) return;
    box.innerHTML = '<p class="hint">AI 正在查询，受每分钟请求限制，可能需要等待…</p>';
    const data = await aiFoodSearch(q);
    adoptQuota(data);
    renderAiFoodResults(box, data, (item) => {
      const food = aiItemToFood(item);
      state.customFoods.push(food);
      saveState();
      selectFood(food);
      box.innerHTML = `<p class="hint">已加入食品库并选中「${esc(foodTitle(food))}」，输入食用量即可添加。</p>` + quotaBadgeHtml();
    });
  } catch (e) {
    if (!handleAiGateError(box, e)) {
      box.innerHTML = `<p class="error-text">${esc(e.message)}</p><p class="hint">可继续使用本地食品库，或稍后重试。</p>`;
    }
  } finally {
    setBusy(btn, false);
    updateApiButtons(apiState.ready);
  }
}

async function runFoodsAiSearch() {
  const q = $("#foodSearchInput").value.trim();
  if (!q) return alert("请先输入要查询的食品名称");
  const btn = $("#foodsAiBtn");
  const box = $("#foodsAiResults");
  setBusy(btn, true, "AI 搜索中…");
  box.innerHTML = '<p class="hint">正在检查 AI 后端连接…</p>';
  try {
    if (!(await ensureApiReady(box))) return;
    box.innerHTML = '<p class="hint">AI 正在查询，受每分钟请求限制，可能需要等待…</p>';
    const data = await aiFoodSearch(q);
    adoptQuota(data);
    renderAiFoodResults(box, data, (item) => {
      const food = aiItemToFood(item);
      state.customFoods.push(food);
      saveState();
      renderFoodDetail(food);
      box.innerHTML = `<p class="hint">已加入食品库：「${esc(foodTitle(food))}」。</p>` + quotaBadgeHtml();
    });
  } catch (e) {
    if (!handleAiGateError(box, e)) {
      box.innerHTML = `<p class="error-text">${esc(e.message)}</p>`;
    }
  } finally {
    setBusy(btn, false);
    updateApiButtons(apiState.ready);
  }
}

function fileToCompressedDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1280;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片读取失败，请换一张")); };
    img.src = url;
  });
}

function currentReferenceLabel() {
  const mode = (document.querySelector('input[name="refMode"]:checked') || {}).value || "object";
  if (mode === "body") {
    const ref = BODY_REFS[$("#refObject").value];
    return ref ? ref.label : "人体部位参照";
  }
  if (mode === "none") return "无参照物";
  const ref = REF_OBJECTS[$("#refObject").value];
  return ref ? ref.label : "物品参照";
}

async function runApiEstimate() {
  if (!aiFile) return alert("请先添加食物照片（上传、拖拽或粘贴）");
  const btn = $("#aiApiEstimateBtn");
  const box = $("#aiResult");
  setBusy(btn, true, "AI 识别中…");
  box.className = "ai-result";
  box.innerHTML = '<div class="placeholder">正在检查 AI 后端连接…</div>';
  try {
    if (!(await ensureApiReady(box))) return;
    box.innerHTML = '<div class="placeholder">AI 正在识别图片并估算，通常需要 10–20 秒…</div>';
    const image = await fileToCompressedDataUrl(aiFile);
    const hints = collectAiRows()
      .map((r) => foodById(r.foodId))
      .filter(Boolean)
      .map((f) => f.name)
      .slice(0, 8);
    const data = await aiEstimatePhoto({
      image,
      reference: currentReferenceLabel(),
      description: $("#aiDescription").value.trim(),
      cookMethod: $("#cookMethod").value,
      hints
    });
    lastApiEstimate = data;
    adoptQuota(data);
    renderApiEstimateResult(data);
  } catch (e) {
    if (!handleAiGateError(box, e)) {
      box.innerHTML = `<p class="error-text">${esc(e.message)}</p><p class="hint">可补全「补充描述」后重试，或使用本地几何估算。</p>`;
    }
  } finally {
    setBusy(btn, false);
    updateApiButtons(apiState.ready);
  }
}

function renderApiEstimateResult(data) {
  const box = $("#aiResult");
  if (!box) return;
  const rows = data.items.map((it, i) => `
    <tr>
      <td><input type="text" class="api-name" data-i="${i}" value="${esc(it.name)}"></td>
      <td><input type="number" class="grams-input api-grams" data-i="${i}" value="${it.gramsMid}" min="5"></td>
      <td>${it.kcalLow}–${it.kcalHigh} kcal</td>
      <td>${it.protein}g</td>
      <td>${it.carbs}g</td>
      <td>${it.fat}g</td>
    </tr>
  `).join("");
  const totalMid = data.items.reduce((s, it) => s + it.kcalMid, 0);
  const totalLow = data.items.reduce((s, it) => s + it.kcalLow, 0);
  const totalHigh = data.items.reduce((s, it) => s + it.kcalHigh, 0);
  box.innerHTML = `
    <h4>AI 估算结果 <span class="badge ai">${esc(data.model || "kimi")}</span></h4>
    <table class="estimate-table">
      <thead><tr><th>食物</th><th>重量 (g)</th><th>能量区间</th><th>蛋白质</th><th>碳水</th><th>脂肪</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hint">合计约 <strong>${totalLow}–${totalHigh} kcal</strong>（中值 ${totalMid}）· 可修改名称与克数，确认时按修改后的重量折算。</p>
    ${data.uncertainty && data.uncertainty.length ? `<ul class="warning-list">${data.uncertainty.map(u => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}
    <div class="confirm-row">
      <label>餐次</label>
      <select id="apiConfirmMeal">${Array.from({ length: state.mealsPerDay || 3 }, (_, i) => `<option value="${i}">${mealName(i)}</option>`).join("")}</select>
      <label class="check-row"><input type="checkbox" id="apiConfirmCheck"> 我已核对，确认加入今日摄入</label>
      <button class="btn primary" id="apiConfirmBtn">加入今日摄入</button>
    </div>
  `;
  $("#apiConfirmBtn").addEventListener("click", () => {
    if (!$("#apiConfirmCheck").checked) return alert("请先勾选确认，再加入今日摄入");
    const mealIndex = +$("#apiConfirmMeal").value;
    const gramsInputs = [...document.querySelectorAll(".api-grams")];
    const nameInputs = [...document.querySelectorAll(".api-name")];
    let added = 0;
    data.items.forEach((it, i) => {
      const grams = num(gramsInputs[i] && gramsInputs[i].value);
      if (!grams || !it.gramsMid) return;
      const factor = grams / it.gramsMid;
      const nm = (nameInputs[i] && nameInputs[i].value.trim()) || it.name;
      state.entries.push({
        id: Date.now() + Math.random(),
        date: todayStr(),
        mealIndex,
        foodId: null,
        name: nm,
        brand: "",
        amount: grams,
        unit: "g",
        unitLabel: "g",
        grams,
        calories: it.kcalMid * factor,
        protein: it.protein * factor,
        carbs: it.carbs * factor,
        fat: it.fat * factor,
        status: "complete",
        source: "ai",
        createdAt: new Date().toISOString()
      });
      added++;
    });
    if (!added) return alert("没有可加入的记录");
    saveState();
    renderDashboard();
    renderTracker();
    alert(`已加入 ${added} 条 AI 估算记录到${mealName(mealIndex)}。`);
  });
}

/* ================= 食品访问与计算 ================= */
function getFoods() {
  const catalog = (typeof CATALOG_FOODS !== "undefined" && Array.isArray(CATALOG_FOODS)) ? CATALOG_FOODS : [];
  const imageMap = (typeof FOOD_IMAGE_MAP !== "undefined" && FOOD_IMAGE_MAP) ? FOOD_IMAGE_MAP : null;
  const all = FOOD_DB.concat(catalog, state.customFoods || []);
  if (imageMap) {
    for (const f of all) {
      if (!f.image) {
        const img = imageMap[(f.brand || "") + "|" + f.name];
        if (img) f.image = img;
      }
    }
  }
  return all;
}

function foodById(id) {
  return getFoods().find(f => f.id === id) || null;
}

function per100(food) {
  const n = food && food.nutrition ? food.nutrition : (food || {});
  return {
    calories: num(n.calories),
    protein: num(n.protein),
    carbs: num(n.carbs),
    fat: num(n.fat)
  };
}

function foodTitle(f) {
  return f.brand ? `${f.brand} ${f.name}` : f.name;
}

function foodBadge(f) {
  const key = f.reliability || "reference";
  return `<span class="badge ${RELIABILITY_CLASS[key] || "ref"}">${RELIABILITY_LABEL[key] || "参考值"}</span>`;
}

function unitOptionsFor(food) {
  const opts = [];
  const unitText = food.unit === "ml" ? "ml" : "g";
  opts.push({ value: unitText, label: unitText === "ml" ? "毫升 (ml)" : "克 (g)" });
  const servingSameAsPackage = food.serving && food.package &&
    food.serving.label === food.package.label &&
    num(food.serving.grams) === num(food.package.grams);
  if (food.serving && food.serving.grams && !(servingSameAsPackage && food.package)) {
    opts.push({ value: "serving", label: `${food.serving.label}（约 ${food.serving.grams}${unitText}）` });
  }
  if (food.package && food.package.grams) {
    opts.push({ value: "package", label: `${food.package.label}（${food.package.grams}${unitText}）` });
  }
  return opts;
}

/* ================= 包装净含量与品牌产品缩略图 ================= */
/** 返回「70g/袋」「500ml/瓶」这类净含量文案；没有 package 时返回空串 */
function packageText(food) {
  const p = food && food.package;
  if (!p || !(num(p.grams) > 0)) return "";
  const unitText = food.unit === "ml" ? "ml" : "g";
  return `${fmt(p.grams, 0)}${unitText}/${p.label || "份"}`;
}

const CATEGORY_EMOJI = {
  主食: "🍞", 肉蛋: "🍗", 乳制品: "🥛", 豆制品: "🫘", 蔬菜: "🥦",
  水果: "🍎", 坚果: "🥜", 零食: "🍪", 饮料: "🥤", 速食: "🍜", 其他: "🍽️"
};

const BRAND_COLORS = {
  哥本: "#8d6748", 简爱: "#f5a623", 乐纯: "#5b8def", 伊利: "#1f6fd0", 蒙牛: "#2b7de9",
  农夫山泉: "#c0392b", 元气森林: "#2ecc71", 乐事: "#e74c3c", 奥利奥: "#2c3e50",
  德芙: "#6d3b1e", 士力架: "#8b4513", 康师傅: "#c0392b", 统一: "#9b59b6",
  三只松鼠: "#e67e22", 良品铺子: "#e84393", 卫龙: "#d63031", 好丽友: "#e17055",
  达利园: "#e67e22", 旺旺: "#d4a017", 徐福记: "#c8961e", 光明: "#3498db",
  星巴克: "#00704a", 雀巢: "#b33939", 王老吉: "#c0392b", 红牛: "#b8860b"
};

/** 品牌色：已知品牌用固定色，未知品牌按名称哈希出稳定的 HSL 颜色 */
function brandColor(brand) {
  const key = norm(brand || "");
  if (BRAND_COLORS[key]) return BRAND_COLORS[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return `hsl(${h}, 52%, 46%)`;
}

/**
 * 本地生成缩略图（不联网）：品牌色块 + 类别 emoji + 品牌首字。
 * 返回内联 SVG data URI；food.image 有 http/data 图片时优先使用（便于以后替换真图）。
 */
function thumbSvg(food) {
  const foodObj = food || {};
  const brand = String(foodObj.brand || "");
  const name = String(foodObj.name || "");
  const color = brandColor(brand);
  const emoji = CATEGORY_EMOJI[foodObj.category] || CATEGORY_EMOJI["其他"];
  const initial = esc((brand || name || "食").slice(0, 1));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" role="img">`
    + `<rect width="120" height="120" rx="18" fill="${color}"/>`
    + `<text x="60" y="52" font-size="34" text-anchor="middle" dominant-baseline="middle">${emoji}</text>`
    + `<text x="60" y="94" font-size="20" font-family="system-ui,-apple-system,sans-serif" font-weight="700" fill="#ffffff" text-anchor="middle">${initial}</text>`
    + `</svg>`;
}

function foodThumb(food) {
  const img = food && typeof food.image === "string" ? food.image.trim() : "";
  if (img && !/^javascript:/i.test(img)) return img;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(thumbSvg(food));
}

/** 完整 <img> 标签：food.image 加载失败时回退到本地 SVG 缩略图 */
function thumbHtml(food, extraClass = "") {
  const svgUri = ("data:image/svg+xml;charset=utf-8," + encodeURIComponent(thumbSvg(food))).replace(/'/g, "%27");
  const img = food && typeof food.image === "string" ? food.image.trim() : "";
  const src = img && !/^javascript:/i.test(img) ? esc(img) : svgUri;
  return `<img class="food-thumb${extraClass ? " " + extraClass : ""}" src="${src}" alt="${esc(foodTitle(food))}" loading="lazy" data-fallback="${svgUri}" onerror="this.onerror=null;this.src=this.dataset.fallback;">`;
}

/**
 * 品牌匹配：规范化搜索词等于品牌名，或搜索词 ≥2 字且品牌以它开头/包含它。
 * 返回匹配到的品牌名数组（保持去重后的原始顺序）。
 */
function matchedBrands(q) {
  const qn = norm(q);
  if (!qn) return [];
  const out = [];
  const seen = new Set();
  for (const f of getFoods()) {
    const brand = f.brand || "";
    const bn = norm(brand);
    if (!bn || seen.has(bn)) continue;
    const hit = bn === qn || (qn.length >= 2 && (bn.startsWith(qn) || bn.includes(qn)));
    if (hit) { seen.add(bn); out.push(brand); }
  }
  return out;
}

/** 某搜索词命中的品牌下的全部产品（用于品牌产品面板） */
function brandFoods(q) {
  const brands = matchedBrands(q);
  if (!brands.length) return [];
  const set = new Set(brands.map(norm));
  return getFoods().filter(f => f.brand && set.has(norm(f.brand)));
}

/** 品牌产品面板 HTML（搜索结果上方）；无匹配品牌时返回空串 */
function renderBrandProductsPanel(q) {
  const brands = matchedBrands(q);
  if (!brands.length) return "";
  const foods = brandFoods(q);
  if (!foods.length) return "";
  const unitText = f => (f.unit === "ml" ? "ml" : "g");
  return `
    <div class="brand-products">
      <div class="brand-products-head">
        <strong class="brand-products-title">品牌产品 · ${brands.map(esc).join(" / ")}</strong>
        <span class="brand-products-count">共 ${foods.length} 款 · 点击卡片直接选择</span>
      </div>
      <div class="brand-grid">
        ${foods.map(f => {
          const n = per100(f);
          const pkg = packageText(f);
          return `<button type="button" class="brand-card" data-food-id="${esc(f.id)}">
            ${thumbHtml(f, "brand-card-thumb")}
            <span class="brand-card-name">${esc(f.name)}</span>
            ${pkg ? `<span class="brand-card-pack">净含量 ${esc(pkg)}</span>` : `<span class="brand-card-pack">参考值</span>`}
            <span class="brand-card-kcal">${fmt(n.calories, 0)} kcal / 100${unitText(f)}</span>
            <span class="brand-card-macros">蛋 ${fmt(n.protein, 1)} · 碳 ${fmt(n.carbs, 1)} · 脂 ${fmt(n.fat, 1)}</span>
          </button>`;
        }).join("")}
      </div>
      <p class="hint brand-products-note">净含量为常见包装规格，营养为参考值，请以实物包装为准。</p>
    </div>`;
}

/** 给面板内品牌卡片绑定点击（浏览器环境有效；测试桩中为空实现） */
function bindBrandCards(root, onPick) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll(".brand-card").forEach(card => {
    card.addEventListener("click", () => {
      const food = foodById(card.dataset.foodId);
      if (food) onPick(food);
    });
  });
}

function gramsFor(food, amount, unit) {
  const a = num(amount);
  if (!food || a <= 0) return null;
  if (unit === "g" || unit === "ml") return a;
  if (unit === "serving") return food.serving && food.serving.grams ? a * food.serving.grams : null;
  if (unit === "package") return food.package && food.package.grams ? a * food.package.grams : null;
  return null;
}

function calcNutritionFrom(food, grams) {
  const n = per100(food);
  const r = num(grams) / 100;
  return { calories: n.calories * r, protein: n.protein * r, carbs: n.carbs * r, fat: n.fat * r, grams: num(grams) };
}

/** 计算某食品在给定数量与单位下的营养；无法换算时返回 null */
function calcNutrition(food, amount, unit) {
  const grams = gramsFor(food, amount, unit);
  if (grams === null) return null;
  return calcNutritionFrom(food, grams);
}

function sumEntries(entries) {
  const acc = { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0, pendingCount: 0 };
  for (const e of entries || []) {
    if (e.status === "pending") { acc.pendingCount++; continue; }
    acc.count++;
    acc.calories += num(e.calories);
    acc.protein += num(e.protein);
    acc.carbs += num(e.carbs);
    acc.fat += num(e.fat);
  }
  return acc;
}

function makeEntry({ food, amount, unit, mealIndex, pending }) {
  const grams = gramsFor(food, amount, unit);
  if (grams === null) return null;
  const n = calcNutritionFrom(food, grams);
  return {
    id: Date.now() + Math.random(),
    date: todayStr(),
    mealIndex,
    foodId: food.id,
    name: food.name,
    brand: food.brand || "",
    amount: num(amount),
    unit,
    unitLabel: unit === "g" ? "g" : unit === "ml" ? "ml" : unit === "serving" ? (food.serving ? food.serving.label : "份") : (food.package ? food.package.label : "份"),
    grams,
    calories: n.calories,
    protein: n.protein,
    carbs: n.carbs,
    fat: n.fat,
    status: pending ? "pending" : "complete",
    source: food.reliability || "reference",
    createdAt: new Date().toISOString()
  };
}

/**
 * 把一个「待补充」记录补全为 complete。
 * @param {object} entry 记录对象（原地修改并返回；传入非法对象返回 null）
 * @param {object} per100Nutri 每 100g/100ml 的四项营养 {calories, protein, carbs, fat}
 * @param {number} gramsOverride 可选：本次食用克数；entry.grams 为空时用它补上
 * @returns {object|null} 补全后的 entry；数据不足/非法返回 null
 *
 * 纯函数，便于测试：不读写 DOM、不依赖 state。
 */
function completePendingEntry(entry, per100Nutri, gramsOverride) {
  if (!entry || typeof entry !== "object") return null;
  const n = per100Nutri || {};
  const cal = num(n.calories), pro = num(n.protein), carb = num(n.carbs), fat = num(n.fat);
  if (![cal, pro, carb, fat].some(v => v > 0)) return null; // 至少填一项有效营养
  if ([cal, pro, carb, fat].some(v => v < 0)) return null;

  const grams = num(gramsOverride) > 0 ? num(gramsOverride) : num(entry.grams);
  if (!(grams > 0)) return null; // 没有克数无法折算

  const factor = grams / 100;
  entry.grams = grams;
  entry.amount = grams;
  entry.unit = "g";
  entry.unitLabel = "g";
  entry.calories = cal * factor;
  entry.protein = pro * factor;
  entry.carbs = carb * factor;
  entry.fat = fat * factor;
  entry.status = "complete";
  entry.source = "user";
  return entry;
}

/** 搜索：名称、品牌、别名、关键词、类别、条形码；多词查询按词分别匹配 */
function scoreFood(f, qNorm, tokens) {
  if (!qNorm) return 0;
  const name = norm(f.name);
  const brand = norm(f.brand);
  const combined = norm((f.brand || "") + (f.name || ""));
  const aliases = (f.aliases || []).map(norm);
  const keywords = (f.keywords || []).map(norm);
  const category = norm(f.category);

  const single = (q) => {
    if (f.barcode && norm(f.barcode).startsWith(q)) return 95;
    if (name === q) return 100;
    if (brand && brand === q) return 80;
    if (aliases.some(a => a === q)) return 78;
    if (name.startsWith(q)) return 82;
    if (combined.includes(q)) return 65;
    if (name.includes(q)) return 70;
    if (aliases.some(a => a.includes(q))) return 55;
    if (brand.includes(q)) return 50;
    if (keywords.some(k => k.includes(q))) return 40;
    if (category.includes(q)) return 25;
    return 0;
  };

  if (tokens.length > 1) {
    const scores = tokens.map(t => single(t));
    if (scores.some(s => s === 0)) return 0;
    return Math.min(...scores) + 5 * (tokens.length - 1);
  }
  return single(qNorm);
}

function searchFoods(q, limit = 20) {
  const query = String(q || "").trim();
  if (!query) return [];
  const tokens = query.split(/\s+/).filter(Boolean).map(norm).filter(Boolean);
  const qNorm = norm(query);
  const scored = [];
  const seen = new Set();
  for (const f of getFoods()) {
    if (seen.has(f.id)) continue;
    const s = scoreFood(f, qNorm, tokens);
    if (s > 0) { seen.add(f.id); scored.push({ food: f, score: s }); }
  }
  scored.sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length);
  return scored.slice(0, limit).map(x => x.food);
}

/* ================= 身体指标（保持原逻辑） ================= */
function calcBMI(w, h) { return w / Math.pow(h / 100, 2); }
function bmiCategory(bmi) {
  if (bmi < 18.5) return { label: "偏瘦", color: "#3498db" };
  if (bmi < 24) return { label: "正常", color: "#2ecc71" };
  if (bmi < 28) return { label: "超重", color: "#f39c12" };
  return { label: "肥胖", color: "#e74c3c" };
}
function calcBMR(sex, w, h, age) {
  const s = sex === "male" ? 5 : -161;
  return 10 * w + 6.25 * h - 5 * age + s;
}
/**
 * 美国海军公式估算体脂率（公制版本）。
 * 男性需要 waist/neck/height；女性需要 waist/hip/neck/height。
 * 数据缺失、单位非法（如腰围 ≤ 颈围）或结果超出合理范围时返回 null，
 * 由调用方显示「需补充颈围/臀围」提示，绝不再用硬编码 35/95 或输出 NaN。
 *
 * 注意：常见的 86.010/163.205 系数是按英寸推导的，直接代入厘米会整体偏高
 * （女性会得到 50%+ 的荒谬值）。这里使用等价的公制常数（男性 +30.30，
 * 女性 -104.912），结果与「先换算英寸再套公式」一致。
 */
function calcBodyFat(sex, waist, neck, height, hip = 0) {
  const w = num(waist), n = num(neck), h = num(height), hp = num(hip);
  if (!(h > 50) || !(n > 0) || !(w > 0)) return null;
  if (n > 100 || w > 300 || h > 260) return null;

  let pct = null;
  if (sex === "male") {
    const waistNeck = w - n;
    if (!(waistNeck > 0)) return null;
    pct = 86.010 * Math.log10(waistNeck) - 70.041 * Math.log10(h) + 30.30;
  } else if (sex === "female") {
    if (!(hp > 0)) return null;
    const sum = hp + w - n;
    if (!(sum > 0)) return null;
    pct = 163.205 * Math.log10(sum) - 97.684 * Math.log10(h) - 104.912;
  } else {
    return null;
  }

  if (!Number.isFinite(pct) || pct < 2 || pct > 75) return null;
  return pct;
}
function calcTDEE(bmr, activity) { return bmr * activity; }
function idealWeight(height, sex) { return sex === "male" ? height - 105 : height - 107; }

/* ================= 画像合成与计划 ================= */
function allSelectedTagIds(tags) {
  const out = [];
  PROFILE_GROUPS.forEach(g => (tags[g.key] || []).forEach(id => out.push(id)));
  return out;
}

function tagMods(tags) {
  const mods = [];
  PROFILE_GROUPS.forEach(g => g.options.forEach(o => {
    if ((tags[g.key] || []).includes(o.id)) mods.push({ id: o.id, label: o.label, ...o.mods });
  }));
  return mods;
}

/** 把多选画像合成为计划参数 */
function combineModifiers(tags) {
  const mods = tagMods(tags);
  const labels = mods.map(m => m.label);
  let proteinAdd = 0, fatAdd = 0, breakfastCarbFactor = 1, lowGL = false, carbFloor = 0, mealShift = null;
  const mealDelta = [0, 0, 0, 0];
  mods.forEach(m => {
    proteinAdd += m.proteinAdd || 0;
    fatAdd += m.fatAdd || 0;
    if (m.breakfastCarbFactor) breakfastCarbFactor *= m.breakfastCarbFactor;
    if (m.lowGL) lowGL = true;
    if (m.carbFloor) carbFloor = Math.max(carbFloor, m.carbFloor);
    if (m.mealShift) mealShift = m.mealShift;
    if (m.mealDelta) m.mealDelta.forEach((v, i) => { mealDelta[i] += v; });
  });
  let ratios = mealShift === "late" ? [0.15, 0.35, 0.35, 0.15] : [0.30, 0.40, 0.25, 0.05];
  ratios = ratios.map((r, i) => Math.max(0.02, r + mealDelta[i]));
  const sum = ratios.reduce((a, b) => a + b, 0);
  ratios = ratios.map(r => r / sum);
  return {
    mods, labels, proteinAdd, fatAdd,
    breakfastCarbFactor: clamp(breakfastCarbFactor, 0.5, 1),
    lowGL, carbFloor, mealShift, mealRatios: ratios,
    notes: mods.flatMap(m => m.notes || [])
  };
}

/**
 * 生成计划
 * 兼容旧调用：generatePlan("office", body, input)
 */
function generatePlan(tagsOrLegacy, body, planInput) {
  const tags = typeof tagsOrLegacy === "string"
    ? (tagsOrLegacy === "general" ? emptyTags() : tagsFromLegacy(tagsOrLegacy))
    : sanitizeTags(tagsOrLegacy);
  const cm = combineModifiers(tags);
  const { sex, age, height, weight, activity } = body;
  const bmr = calcBMR(sex, weight, height, age);
  const tdee = calcTDEE(bmr, activity || 1.55);

  const requestedGoal = planInput.goalType;
  const currentWeight = num(weight);
  const targetWeight = num(planInput.targetWeight) || currentWeight;
  const diffKg = targetWeight - currentWeight;
  const weeks = Math.max(1, planInput.weeks || 12);
  const MAX_LOSE_PER_WEEK = 1;
  const MAX_GAIN_PER_WEEK = 0.5;
  const warnings = [];
  const rawWeeklyChange = diffKg / weeks;
  let goalType = requestedGoal;
  let weeklyChange = rawWeeklyChange;

  // 目标方向校验：目标与 goalType 矛盾时按「保持当前体重」处理，
  // 避免热量方向与时间线方向相反（如减脂目标却比当前体重还高）。
  if (requestedGoal === "maintain") {
    goalType = "maintain";
    weeklyChange = 0;
  } else if (requestedGoal === "lose") {
    if (diffKg >= 0) {
      goalType = "maintain";
      weeklyChange = 0;
      warnings.push(
        `减脂目标体重（${fmt(targetWeight, 1)}kg）不低于当前体重（${fmt(currentWeight, 1)}kg），无法形成热量缺口，已按保持当前体重生成计划。`
      );
    } else {
      // 安全速率钳制：减脂每周最多 -1kg。
      weeklyChange = Math.max(-MAX_LOSE_PER_WEEK, rawWeeklyChange);
      if (weeklyChange !== rawWeeklyChange) {
        warnings.push(
          `目标 ${fmt(Math.abs(diffKg), 1)}kg / ${weeks} 周（约每周 ${fmt(Math.abs(rawWeeklyChange), 2)}kg）超过安全减脂速度（≤${MAX_LOSE_PER_WEEK}kg/周），已按每周 -${MAX_LOSE_PER_WEEK}kg 调整。`
        );
      }
    }
  } else if (requestedGoal === "gain") {
    if (diffKg <= 0) {
      goalType = "maintain";
      weeklyChange = 0;
      warnings.push(
        `增肌目标体重（${fmt(targetWeight, 1)}kg）不高于当前体重（${fmt(currentWeight, 1)}kg），无法形成热量盈余，已按保持当前体重生成计划。`
      );
    } else {
      // 安全速率钳制：增肌每周最多 +0.5kg。
      weeklyChange = Math.min(MAX_GAIN_PER_WEEK, rawWeeklyChange);
      if (weeklyChange !== rawWeeklyChange) {
        warnings.push(
          `目标 ${fmt(Math.abs(diffKg), 1)}kg / ${weeks} 周（约每周 +${fmt(rawWeeklyChange, 2)}kg）超过安全增肌速度（≤${MAX_GAIN_PER_WEEK}kg/周），已按每周 +${MAX_GAIN_PER_WEEK}kg 调整。`
        );
      }
    }
  } else {
    goalType = "maintain";
    weeklyChange = 0;
    warnings.push("未知的目标类型，已按保持当前体重生成计划。");
  }

  if (requestedGoal === "maintain" && Math.abs(diffKg) > 0.01) {
    warnings.push(
      `保持模式不改变体重：目标体重（${fmt(targetWeight, 1)}kg）与当前体重（${fmt(currentWeight, 1)}kg）不一致，已按保持当前体重生成计划。`
    );
  }

  // 热量：直接按安全速率折算，去掉 tdee-300 / tdee+200 的强制缺口/盈余；
  // 减脂保留 1200 kcal 下限。
  const plannedWeeklyChange = weeklyChange;
  let targetCalories = tdee + weeklyChange * 7700 / 7;
  if (goalType === "lose") {
    const floored = Math.max(1200, targetCalories);
    if (floored > targetCalories + 0.5) {
      warnings.push("按安全速率计算出的热量低于 1200 kcal 下限，已按 1200 kcal 执行；时间线将按实际热量对应的速率绘制。");
    }
    targetCalories = floored;
  }
  if (goalType === "maintain") targetCalories = tdee;

  // 用最终热量反算实际每周变化：时间线、「每周变化」与热量完全一致。
  weeklyChange = (targetCalories - tdee) * 7 / 7700;
  if (goalType !== "maintain" && Math.abs(weeklyChange - plannedWeeklyChange) > 0.005) {
    warnings.push(
      `受最低热量等约束，实际每周变化约 ${weeklyChange > 0 ? "+" : ""}${fmt(weeklyChange, 2)}kg（原计划 ${plannedWeeklyChange > 0 ? "+" : ""}${fmt(plannedWeeklyChange, 2)}kg），时间线已按实际速率绘制。`
    );
  }

  const baseProtein = goalType === "lose" ? 1.6 : goalType === "gain" ? 1.8 : 1.4;
  const proteinPerKg = clamp(baseProtein + cm.proteinAdd, 1.0, 2.4);
  let fatPerKg = clamp(0.9 + cm.fatAdd, 0.6, 1.3);
  let proteinG = proteinPerKg * weight;
  let fatG = fatPerKg * weight;
  let carbsG = Math.max(0, (targetCalories - proteinG * 4 - fatG * 9) / 4);

  // 耐力运动：保证最低碳水，必要时下调脂肪
  if (cm.carbFloor && carbsG < cm.carbFloor * weight) {
    const needKcal = (cm.carbFloor * weight - carbsG) * 4;
    fatPerKg = Math.max(0.6, fatPerKg - needKcal / 9 / weight);
    fatG = fatPerKg * weight;
    carbsG = Math.max(0, (targetCalories - proteinG * 4 - fatG * 9) / 4);
  }

  const meals = clamp(planInput.mealsPerDay || 3, 2, 8);
  let ratios = cm.mealRatios.slice(0, meals);
  while (ratios.length < meals) ratios.push(0.05);
  const sumR = ratios.reduce((a, b) => a + b, 0);
  const normRatios = ratios.map(r => r / sumR);

  const mealPlan = normRatios.map((ratio, i) => {
    const name = i === 0 ? "早餐" : i === 1 ? "午餐" : i === 2 ? "晚餐" : `加餐${i - 2}`;
    let carbFactor = 1;
    if (i === 0) carbFactor = cm.breakfastCarbFactor;
    let note = "";
    if (i === 0 && cm.lowGL) note = "优先低 GL：燕麦、全麦、鸡蛋、无糖酸奶、坚果";
    if (i === 0 && cm.breakfastCarbFactor < 1) note += (note ? "；" : "") + "早餐碳水已下调";
    return {
      name, ratio,
      calories: targetCalories * ratio,
      protein: proteinG * ratio,
      carbs: carbsG * ratio * carbFactor,
      fat: fatG * ratio,
      note
    };
  });

  const months = Math.ceil(weeks / 4);
  const timeline = [];
  for (let m = 0; m < months; m++) {
    const monthWeeks = [];
    for (let w = 0; w < 4 && m * 4 + w < weeks; w++) {
      const weekIndex = m * 4 + w + 1;
      // 统一使用钳制后的 weeklyChange，保证时间线与热量/宏量营养素一致；
      // 兜底不允许出现负体重。
      const expectedWeight = Math.max(0, weight + weeklyChange * weekIndex);
      let phase = "稳定期";
      if (goalType === "lose") phase = weekIndex <= 2 ? "适应期" : weekIndex <= weeks * 0.6 ? "减脂期" : "巩固期";
      if (goalType === "gain") phase = weekIndex <= 2 ? "适应期" : weekIndex <= weeks * 0.6 ? "增肌期" : "维持期";
      monthWeeks.push({ weekIndex, expectedWeight, phase });
    }
    timeline.push({ monthIndex: m + 1, weeks: monthWeeks });
  }

  return {
    tags, labels: cm.labels, notes: cm.notes, lowGL: cm.lowGL,
    bmr, tdee, targetCalories,
    proteinG, fatG, carbsG,
    proteinPerKg, fatPerKg,
    weeklyChange, rawWeeklyChange, plannedWeeklyChange, warnings,
    warning: warnings.join("；"),
    meals, mealPlan, timeline,
    goalType, requestedGoalType: requestedGoal
  };
}

/* ================= 包装文本解析 ================= */
const BRAND_LIST = [
  "康师傅", "统一", "奥利奥", "乐事", "德芙", "士力架", "蒙牛", "伊利", "安慕希", "纯甄",
  "简爱", "乐纯", "光明", "君乐宝", "农夫山泉", "元气森林", "三只松鼠", "良品铺子", "百草味",
  "卫龙", "好丽友", "达利园", "旺旺", "徐福记", "王老吉", "红牛", "星巴克", "雀巢", "香飘飘",
  "维他", "娃哈哈", "百事", "可口可乐", "雪碧", "芬达", "脉动", "尖叫", "东鹏", "喜之郎"
];

function detectCategory(text) {
  const s = String(text || "");
  if (/酸奶|牛奶|乳|芝士|奶酪/.test(s)) return "乳制品";
  if (/薯片|饼干|巧克力|糖果|辣条|果冻|派|蛋糕|冰淇淋|雪饼|沙琪玛/.test(s)) return "零食";
  if (/茶|咖啡|果汁|饮料|可乐|雪碧|气泡水|凉茶|啤酒|红酒/.test(s)) return "饮料";
  if (/坚果|花生|核桃|杏仁|腰果|瓜子/.test(s)) return "坚果";
  if (/豆腐|豆浆|豆干|腐竹|毛豆/.test(s)) return "豆制品";
  if (/鸡|牛|猪|羊|鱼|虾|蛋|肉/.test(s)) return "肉蛋";
  if (/面|米饭|面包|馒头|饺子|包子|粥|粉|燕麦|红薯|玉米/.test(s)) return "主食";
  return "其他";
}

function parseNumber(text, labelRe) {
  const m = String(text || "").match(labelRe);
  return m ? { value: parseFloat(m[1]), unit: (m[2] || "").toLowerCase() } : null;
}

/**
 * 解析粘贴的商品文本
 * 返回 { ok, data, warnings, ingredientOnly }
 * 仅有配料表时 nutrition 为 null，不推算精确数值。
 */
function parseProductText(text) {
  const raw = String(text || "").trim();
  if (!raw) return { ok: false, error: "没有可解析的文本" };

  const warnings = [];
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const head = lines.slice(0, 3).join(" ");

  // 品牌
  let brand = "";
  for (const b of BRAND_LIST) {
    if (head.includes(b)) { brand = b; break; }
  }

  // 名称
  let name = "";
  const nameMatch = raw.match(/(?:商品名称|产品名称|品名)\s*[：:]\s*([^\n]+)/);
  if (nameMatch) name = nameMatch[1].trim();
  if (!name) {
    for (const line of lines.slice(0, 4)) {
      if (/配料|营养|净含量|能量|蛋白质|脂肪|碳水|钠\s*[：:]/.test(line)) continue;
      if (line.length >= 2 && line.length <= 40) { name = line; break; }
    }
  }
  if (brand && name.includes(brand)) name = name.replace(brand, "").trim();
  name = name.replace(/^[·\-—\s]+/, "").trim();
  if (!name) warnings.push("未识别到商品名称，请手动填写");

  // 配料
  let ingredients = [];
  const ingMatch = raw.match(/配料(?:表)?\s*[：:]\s*([^\n]+)/);
  if (ingMatch) ingredients = ingMatch[1].split(/[,，、;；]/).map(s => s.trim()).filter(Boolean);

  // 营养成分
  const energy = parseNumber(raw, /能量\s*[：:]?\s*([\d.]+)\s*(kJ|千焦|kcal|千卡|大卡)/i);
  const protein = parseNumber(raw, /蛋白质\s*[：:]?\s*([\d.]+)\s*(g|克)/i);
  const fat = parseNumber(raw, /脂肪\s*[：:]?\s*([\d.]+)\s*(g|克)/i);
  const carbs = parseNumber(raw, /碳水化合物\s*[：:]?\s*([\d.]+)\s*(g|克)/i)
    || parseNumber(raw, /(?:^|\s)碳水(?:化合物)?\s*[：:]?\s*([\d.]+)\s*(g|克)/i);
  const sodium = parseNumber(raw, /钠\s*[：:]?\s*([\d.]+)\s*(mg|毫克)/i);

  // 基准：每 100g / 每份
  let basis = "100g";
  let servingGrams = null;
  const basisMatch = raw.match(/每\s*(100\s*(?:g|克|ml|毫升)|份|包|袋|杯|根|片|条|罐|瓶)/i);
  if (basisMatch) {
    const b = basisMatch[1];
    if (/100/.test(b)) {
      basis = /100\s*(ml|毫升)/i.test(b) ? "100ml" : "100g";
    } else {
      basis = "serving";
      const sg = raw.match(/每\s*(?:份|包|袋|杯|根|片|条|罐|瓶)\s*[（(]?\s*([\d.]+)\s*(?:g|克|ml|毫升)/i);
      if (sg) servingGrams = parseFloat(sg[1]);
      else warnings.push("营养成分按「每份」标注，但未识别出每份重量，暂无法换算为每 100g");
    }
  }

  // 净含量
  let netGrams = null;
  const net = raw.match(/净含量\s*[：:]?\s*([\d.]+)\s*(g|克|ml|毫升)/i);
  if (net) netGrams = parseFloat(net[1]);

  // 条形码
  const barcodeMatch = raw.match(/(?:条形码|商品条码|条码)\s*[：:]?\s*(\d{8,14})/);
  const barcode = barcodeMatch ? barcodeMatch[1] : "";

  const hasNutrition = energy || protein || fat || carbs;
  if (!hasNutrition) {
    warnings.push("未识别到营养成分表：仅有配料表时无法生成精确营养数据，请手动填写或补充营养表");
    return {
      ok: true,
      ingredientOnly: true,
      warnings,
      data: {
        name, brand,
        category: detectCategory(name || raw),
        unit: /ml|毫升/.test(raw) ? "ml" : "g",
        basis: "100g",
        netGrams,
        servingLabel: "",
        barcode,
        nutrition: null,
        ingredients
      }
    };
  }

  // 单位换算：kJ -> kcal
  let calories = null;
  if (energy) {
    const u = energy.unit;
    calories = (u === "kj" || u === "千焦") ? energy.value / 4.184 : energy.value;
  }

  let proteinV = protein ? protein.value : null;
  let fatV = fat ? fat.value : null;
  let carbsV = carbs ? carbs.value : null;
  if (proteinV === null) { proteinV = 0; warnings.push("未识别到蛋白质，按 0 计，请核对"); }
  if (fatV === null) { fatV = 0; warnings.push("未识别到脂肪，按 0 计，请核对"); }
  if (carbsV === null) { carbsV = 0; warnings.push("未识别到碳水化合物，按 0 计，请核对"); }

  if (calories === null) {
    calories = proteinV * 4 + carbsV * 4 + fatV * 9;
    warnings.push("未标注能量，已按 4/9/4 折算出约 " + Math.round(calories) + " kcal，请核对");
  }

  // 每份 -> 每 100g
  if (basis === "serving") {
    if (!servingGrams && netGrams) servingGrams = netGrams;
    if (servingGrams) {
      const factor = 100 / servingGrams;
      calories *= factor; proteinV *= factor; fatV *= factor; carbsV *= factor;
      warnings.push(`已将「每份 ${servingGrams}g」的营养换算为每 100g`);
      basis = "100g";
    }
  }

  const nutrition = {
    calories: Math.round(calories * 10) / 10,
    protein: Math.round(proteinV * 10) / 10,
    carbs: Math.round(carbsV * 10) / 10,
    fat: Math.round(fatV * 10) / 10,
    sodium: sodium ? sodium.value : null
  };

  return {
    ok: true,
    ingredientOnly: false,
    warnings,
    data: {
      name, brand,
      category: detectCategory(name || raw),
      unit: basis === "100ml" ? "ml" : (/ml|毫升/.test(raw) && !/每\s*100\s*g/i.test(raw) ? "ml" : "g"),
      basis,
      netGrams,
      servingLabel: "",
      barcode,
      nutrition,
      ingredients
    }
  };
}

/* ================= AI 分量估算 ================= */
function estimateAI(params) {
  const { refMode = "object", refObject = "card", bodyRef = "fist", rows = [], cookMethod = "lowoil" } = params || {};
  if (!rows.length) return { ok: false, error: "请至少添加一种食物" };
  const cook = COOK_FACTOR[cookMethod] || COOK_FACTOR.lowoil;
  const items = [];
  const uncertainty = [];

  rows.forEach(row => {
    const food = foodById(row.foodId) || FOOD_DB[0];
    const n = per100(food);
    const density = DENSITY[food.category] || 0.8;
    const coverage = clamp(num(row.size) || 1, 0.25, 3);
    const thickness = THICKNESS[row.thickness] || 2;
    let grams;
    if (refMode === "body") {
      const ref = BODY_REFS[bodyRef] || BODY_REFS.fist;
      if (ref.vol) grams = ref.vol * coverage * density;
      else grams = (ref.area || 60) * coverage * thickness * density;
    } else if (refMode === "none") {
      grams = 150 * coverage * density;
      uncertainty.push("未使用参照物，重量误差较大");
    } else {
      const ref = REF_OBJECTS[refObject] || REF_OBJECTS.card;
      grams = ref.area * coverage * thickness * density;
    }
    grams = clamp(grams, 10, 1500);
    const calMid = n.calories * grams / 100 * cook.cal;
    const proMid = n.protein * grams / 100;
    const carbMid = n.carbs * grams / 100;
    const fatMid = n.fat * grams / 100 * cook.fat;
    items.push({
      foodId: food.id,
      name: food.name,
      brand: food.brand || "",
      gramsLow: Math.round(grams * 0.75),
      gramsMid: Math.round(grams),
      gramsHigh: Math.round(grams * 1.3),
      caloriesLow: Math.round(calMid * 0.75),
      caloriesMid: Math.round(calMid),
      caloriesHigh: Math.round(calMid * 1.3),
      protein: Math.round(proMid * 10) / 10,
      carbs: Math.round(carbMid * 10) / 10,
      fat: Math.round(fatMid * 10) / 10
    });
  });

  if (refMode === "object" && !REF_OBJECTS[refObject]) uncertainty.push("参照物尺寸未知");
  if (refMode === "object") uncertainty.push("参照物与食物不共面时，透视会造成面积高估");
  if (refMode === "body") uncertainty.push("人体部位尺寸个体差异大，只能作近似估算");
  uncertainty.push(`烹饪方式：${cook.note}`);
  if (rows.length > 1) uncertainty.push("多种食物混放时，遮挡会影响各自面积判断");

  const totals = items.reduce((acc, it) => {
    acc.low += it.caloriesLow; acc.mid += it.caloriesMid; acc.high += it.caloriesHigh;
    acc.protein += it.protein; acc.carbs += it.carbs; acc.fat += it.fat;
    return acc;
  }, { low: 0, mid: 0, high: 0, protein: 0, carbs: 0, fat: 0 });

  return { ok: true, items, totals, uncertainty };
}

/* ================= 页面状态 ================= */
let selectedFoodId = null; // 摄入记录当前选中的食品
let aiFile = null;
let aiObjectUrl = null;
let lastEstimate = null;
let settingsDraft = emptyTags();

/* ================= 通用 UI ================= */
const DEFAULT_PREVIEW_HTML = '<div class="dropzone-icon">📷</div><p>点击上传 · 拖拽图片到此处 · 或按 <kbd>Ctrl</kbd>+<kbd>V</kbd> 粘贴</p><p class="hint">支持截图直接粘贴；剪贴板没有图片时会给出提示</p>';

function mealName(idx) {
  if (idx === 0) return "早餐";
  if (idx === 1) return "午餐";
  if (idx === 2) return "晚餐";
  return `加餐${idx - 2}`;
}

function currentPlan() {
  return generatePlan(state.profileTags, state.body, {
    goalType: state.plan.goalType || "maintain",
    targetWeight: num(state.plan.targetWeight) || num(state.body.weight),
    weeks: num(state.plan.weeks) || 12,
    mealsPerDay: state.mealsPerDay || 3
  });
}

function renderMealOptions() {
  const sel = $("#mealSelect");
  if (!sel) return;
  sel.innerHTML = "";
  const meals = state.mealsPerDay || 3;
  for (let i = 0; i < meals; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = mealName(i);
    sel.appendChild(opt);
  }
}

/* ================= 今日总览 ================= */
function renderDashboard() {
  const plan = currentPlan();
  const today = state.entries.filter(e => e.date === todayStr());
  const sums = sumEntries(today);

  $("#sumCalories").textContent = fmt(sums.calories, 0);
  $("#sumProtein").textContent = fmt(sums.protein, 1);
  $("#sumCarbs").textContent = fmt(sums.carbs, 1);
  $("#sumFat").textContent = fmt(sums.fat, 1);
  $("#targetCalories").textContent = fmt(plan.targetCalories, 0);
  $("#targetProtein").textContent = fmt(plan.proteinG, 1);
  $("#targetCarbs").textContent = fmt(plan.carbsG, 1);
  $("#targetFat").textContent = fmt(plan.fatG, 1);

  setProgress("#calProgress", sums.calories, plan.targetCalories);
  setProgress("#proProgress", sums.protein, plan.proteinG);
  setProgress("#carbProgress", sums.carbs, plan.carbsG);
  setProgress("#fatProgress", sums.fat, plan.fatG);

  $("#pendingNote").textContent = sums.pendingCount
    ? `另有 ${sums.pendingCount} 条「待补充」记录未计入统计。`
    : "";

  renderMealCards(plan, today);
  renderRecentList(today);
}

function setProgress(sel, val, max) {
  const pct = max ? Math.min(100, (val / max) * 100) : 0;
  const el = $(sel);
  if (el) el.style.width = pct + "%";
}

function renderMealCards(plan, todayEntries) {
  const container = $("#mealCards");
  if (!container) return;
  container.innerHTML = "";
  plan.mealPlan.forEach((m, i) => {
    const mealEntries = todayEntries.filter(e => e.mealIndex === i && e.status !== "pending");
    const mealSum = sumEntries(mealEntries);
    const div = document.createElement("div");
    div.className = "meal-card";
    div.innerHTML = `
      <h4>${m.name}</h4>
      <p>${fmt(mealSum.calories, 0)} / ${fmt(m.calories, 0)} kcal</p>
      <p>碳水 ${fmt(mealSum.carbs, 1)} / ${fmt(m.carbs, 1)}g</p>
      ${m.note ? `<p style="color:var(--primary-dark);font-size:11px;">💡 ${esc(m.note)}</p>` : ""}
    `;
    container.appendChild(div);
  });
}

function renderRecentList(todayEntries) {
  const list = $("#recentList");
  if (!list) return;
  list.innerHTML = "";
  const recent = todayEntries.slice(-10).reverse();
  if (!recent.length) {
    list.innerHTML = '<li class="placeholder" style="padding:10px 0;">今天还没有记录</li>';
    return;
  }
  recent.forEach(e => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <span class="food-name">${esc(e.brand ? e.brand + " " + e.name : e.name)}</span>
        <span class="food-meta">${mealName(e.mealIndex)} · ${fmt(e.amount, 0)}${esc(e.unitLabel || e.unit)}</span>
        ${e.status === "pending" ? '<span class="badge pending">待补充</span>' : ""}
      </div>
      <span class="food-meta">${e.status === "pending" ? "—" : fmt(e.calories, 0) + " kcal"}</span>
    `;
    list.appendChild(li);
  });
}

/* ================= 摄入记录 ================= */
function selectFood(food) {
  selectedFoodId = food.id;
  $("#foodNameInput").value = foodTitle(food);
  $("#trackerSearchResults").innerHTML = "";
  renderSelectedFood();
  updateUnitOptions();
  updatePreview();
}

function clearSelectedFood() {
  selectedFoodId = null;
  $("#selectedFoodCard").hidden = true;
  $("#foodNameInput").value = "";
  $("#previewText").textContent = "";
  $("#amountHint").textContent = "";
  const unitSel = $("#amountUnit");
  if (unitSel) unitSel.innerHTML = '<option value="g">克 (g)</option>';
}

function renderSelectedFood() {
  const food = selectedFoodId ? foodById(selectedFoodId) : null;
  const card = $("#selectedFoodCard");
  if (!card) return;
  if (!food) { card.hidden = true; return; }
  card.hidden = false;
  $("#selectedFoodName").textContent = foodTitle(food);
  $("#selectedFoodMeta").innerHTML = `${foodBadge(food)}${esc(food.category)}${food.spec ? " · " + esc(food.spec) : ""}${food.package ? " · 净含量 " + esc(packageText(food)) : ""}`;
  const n = per100(food);
  $("#selectedFoodNutrition").textContent = food.nutrition
    ? `每 100${food.unit === "ml" ? "ml" : "g"}：${fmt(n.calories, 0)} kcal · 蛋白 ${fmt(n.protein, 1)}g · 碳水 ${fmt(n.carbs, 1)}g · 脂肪 ${fmt(n.fat, 1)}g`
    : "该食品缺少营养数据（待补充），无法自动计算热量";
}

function updateUnitOptions() {
  const sel = $("#amountUnit");
  if (!sel) return;
  const food = selectedFoodId ? foodById(selectedFoodId) : null;
  sel.innerHTML = "";
  const opts = food ? unitOptionsFor(food) : [{ value: "g", label: "克 (g)" }];
  opts.forEach(o => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  });
  $("#amountHint").textContent = food && food.unit === "ml"
    ? "该食品以毫升标注，按密度约 1g/ml 换算。"
    : "";
}

function updatePreview() {
  const box = $("#previewText");
  if (!box) return;
  const food = selectedFoodId ? foodById(selectedFoodId) : null;
  if (!food) { box.textContent = ""; return; }
  const amount = num($("#foodAmount").value);
  const unit = $("#amountUnit").value;
  const n = calcNutrition(food, amount, unit);
  if (!n) {
    box.textContent = "⚠️ 该单位缺少已知重量，无法精确换算。请改用克，或在食品信息中补充每份重量。";
    return;
  }
  box.innerHTML = `预计：<strong>${fmt(n.calories, 0)} kcal</strong> · 蛋白 ${fmt(n.protein, 1)}g · 碳水 ${fmt(n.carbs, 1)}g · 脂肪 ${fmt(n.fat, 1)}g <span class="food-meta">（约 ${fmt(n.grams, 0)}g）</span>`;
}

function renderTrackerResults() {
  const q = $("#foodNameInput").value.trim();
  const box = $("#trackerSearchResults");
  if (!box) return;
  if (!q) { box.innerHTML = ""; return; }
  const brandPanel = renderBrandProductsPanel(q);
  const hits = searchFoods(q, 8);
  let hitsHtml = "";
  if (!hits.length) {
    hitsHtml = '<div class="placeholder" style="padding:12px 0;">未找到匹配食品。<br><button type="button" class="link-btn go-custom">＋ 新增自定义食品</button> 或到食品查询页粘贴包装信息。</div>';
  } else {
    hitsHtml = '<div class="result-list">' + hits.map(food => {
      const pkg = packageText(food);
      return `<div class="result-item" data-food-id="${esc(food.id)}">
        <div class="result-main">
          ${thumbHtml(food, "food-thumb-sm")}
          <div>
            <div class="name">${esc(foodTitle(food))}</div>
            <div class="macros">${esc(food.category)} · ${fmt(per100(food).calories, 0)} kcal/100${food.unit === "ml" ? "ml" : "g"}${pkg ? " · 净含量 " + esc(pkg) : ""}</div>
          </div>
        </div>
        <span class="food-meta">选择 →</span>
      </div>`;
    }).join("") + "</div>";
  }
  box.innerHTML = brandPanel + hitsHtml;
  bindBrandCards(box, (food) => selectFood(food));
  box.querySelectorAll(".result-item[data-food-id]").forEach(el => {
    el.addEventListener("click", () => {
      const food = foodById(el.dataset.foodId);
      if (food) selectFood(food);
    });
  });
}

function bindTracker() {
  renderMealOptions();
  $("#addFoodBtn").addEventListener("click", addFoodFromTracker);
  $("#trackerAiBtn").addEventListener("click", runTrackerAiSearch);
  $("#foodNameInput").addEventListener("input", () => {
    if (selectedFoodId) {
      const f = foodById(selectedFoodId);
      if (!f || $("#foodNameInput").value.trim() !== foodTitle(f)) {
        selectedFoodId = null;
        $("#selectedFoodCard").hidden = true;
        $("#amountUnit").innerHTML = '<option value="g">克 (g)</option>';
        $("#previewText").textContent = "";
      }
    }
    renderTrackerResults();
  });
  $("#clearFoodBtn").addEventListener("click", clearSelectedFood);
  $("#foodAmount").addEventListener("input", updatePreview);
  $("#amountUnit").addEventListener("change", updatePreview);

  $("#addCustomFoodBtn").addEventListener("click", () => {
    const form = $("#customFoodForm");
    form.hidden = !form.hidden;
    if (!form.hidden) {
      const sel = $("#cfCategory");
      sel.innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
    }
  });
  $("#cancelCustomBtn").addEventListener("click", () => { $("#customFoodForm").hidden = true; });
  $("#saveCustomFoodBtn").addEventListener("click", saveCustomFood);
  updateUnitOptions();
}

function addFoodFromTracker() {
  const mealIndex = +$("#mealSelect").value;
  const pending = $("#pendingCheck").checked;
  const amount = num($("#foodAmount").value);
  const unit = $("#amountUnit").value;
  const nameInput = $("#foodNameInput").value.trim();
  const food = selectedFoodId ? foodById(selectedFoodId) : null;

  if (!food) {
    const cal = num($("#inCalories").value);
    const pro = num($("#inProtein").value);
    const carb = num($("#inCarbs").value);
    const fat = num($("#inFat").value);
    if (!nameInput) return alert("请输入食品名称，或从搜索结果中选择食品");
    if (!pending && !cal && !pro && !carb && !fat) {
      return alert("未选择食品库中的食品时，请至少填写一项营养数据，或勾选「暂存待补充」。");
    }
    const manualFood = {
      id: "manual_" + Date.now(),
      name: nameInput,
      brand: "",
      category: "其他",
      unit: "g",
      nutrition: { calories: cal, protein: pro, carbs: carb, fat: fat },
      reliability: "user",
      source: "user",
      aliases: [], keywords: []
    };
    if (pending) {
      state.entries.push({
        id: Date.now() + Math.random(), date: todayStr(), mealIndex,
        foodId: manualFood.id, name: nameInput, brand: "",
        amount: amount || 0, unit: "g", unitLabel: "g", grams: amount || null,
        calories: null, protein: null, carbs: null, fat: null,
        status: "pending", source: "user", createdAt: new Date().toISOString()
      });
    } else {
      const grams = amount || 100;
      const entry = makeEntry({ food: manualFood, amount: grams, unit: "g", mealIndex, pending: false });
      entry.name = nameInput;
      entry.amount = grams;
      if (!entry) return alert("无法计算，请检查输入");
      state.entries.push(entry);
    }
  } else {
    if (!food.nutrition && !pending) {
      return alert("该食品缺少营养数据（待确认），请先补全营养，或勾选「暂存待补充」。");
    }
    if (!amount || amount <= 0) return alert("请输入有效的食用量");
    const entry = makeEntry({ food, amount, unit, mealIndex, pending });
    if (!entry) {
      return alert("该食品未提供每份/每包装重量，无法自动换算。请改用克，或补充包装重量后再试。");
    }
    state.entries.push(entry);
  }

  saveState();
  renderTracker();
  renderDashboard();
  $("#pendingCheck").checked = false;
  $("#inCalories").value = "";
  $("#inProtein").value = "";
  $("#inCarbs").value = "";
  $("#inFat").value = "";
  clearSelectedFood();
}

function saveCustomFood() {
  const name = $("#cfName").value.trim();
  if (!name) return alert("请输入食品名称");
  const brand = $("#cfBrand").value.trim();
  const category = $("#cfCategory").value;
  const unit = $("#cfUnit").value;
  const cal = num($("#cfCal").value);
  const pro = num($("#cfPro").value);
  const carb = num($("#cfCarb").value);
  const fat = num($("#cfFat").value);
  if (!cal && !pro && !carb && !fat) return alert("请至少填写一项每 100g 营养数据");
  const servingGrams = num($("#cfServingGrams").value);
  const servingLabel = $("#cfServingLabel").value.trim() || "份";
  const aliases = ($("#cfAliases").value || "").split(/[,，、;；]/).map(s => s.trim()).filter(Boolean);
  const barcode = ($("#cfBarcode").value || "").trim();
  if (barcode && !/^\d{8,14}$/.test(barcode)) return alert("条形码应为 8-14 位数字，请核对");
  const food = {
    id: "c_" + Date.now(),
    name, brand, category, unit,
    aliases, keywords: aliases, barcode,
    nutrition: { calories: cal, protein: pro, carbs: carb, fat: fat, fiber: null, sodium: null },
    serving: servingGrams > 0 ? { label: servingLabel, grams: servingGrams } : null,
    package: null,
    spec: servingGrams > 0 ? `${servingGrams}${unit}/${servingLabel}` : "",
    source: "user",
    reliability: "user",
    tags: [category],
    gl: ""
  };
  state.customFoods.push(food);
  saveState();
  $("#customFoodForm").hidden = true;
  $("#cfName").value = "";
  $("#cfBrand").value = "";
  $("#cfAliases").value = "";
  $("#cfBarcode").value = "";
  $("#cfCal").value = ""; $("#cfPro").value = ""; $("#cfCarb").value = ""; $("#cfFat").value = "";
  $("#cfServingGrams").value = ""; $("#cfServingLabel").value = "";
  selectFood(food);
  alert(`已保存「${name}」，并已选中，可直接输入食用量。`);
}

const LABEL_GRAIN_RE = /麦片|燕麦|小麦|全麦|谷物|面包|馒头|包子|面条|米粉|米线|粥|饼|饭/;

/** 标签识别结果（/api/scan-label）→ renderParsedForm 兼容的 parsed 结构 */
const LABEL_WARN_SKIP = /^(图片中)?看不清或缺失的信息?$/;
function labelToParsed(label) {
  const p = label.per100 || {};
  const warnings = [];
  if (label.basis === "serving") warnings.push("营养成分表按「每份」标注，已暂按每 100g 填入，请核对后手动换算。");
  for (const k of ["kcal", "protein", "carbs", "fat"]) {
    if (p[k] === null || p[k] === undefined) warnings.push(`未识别到${{ kcal: "能量(kcal)", protein: "蛋白质", carbs: "碳水化合物", fat: "脂肪" }[k]}，请对照包装补填。`);
  }
  (Array.isArray(label.warnings) ? label.warnings : []).forEach(w => { if (w && !LABEL_WARN_SKIP.test(String(w).trim())) warnings.push(String(w)); });
  const textForCat = (label.productName || "") + "|" + (label.ingredients || []).join(",");
  return {
    ok: true,
    ingredientOnly: false,
    aiSource: true,
    warnings,
    data: {
      name: label.productName || "",
      brand: label.brand || "",
      category: LABEL_GRAIN_RE.test(textForCat) ? "主食" : detectCategory(textForCat),
      basis: label.basis === "100ml" ? "100ml" : "100g",
      netGrams: label.netContentGrams || null,
      servingLabel: "",
      barcode: "",
      nutrition: { calories: p.kcal ?? null, protein: p.protein ?? null, carbs: p.carbs ?? null, fat: p.fat ?? null, sodium: p.sodiumMg ?? null },
      ingredients: label.ingredients || []
    }
  };
}

/* ---------- 拍照识标签：上传 → AI 识别 → 预填核对表单（保存仍由用户确认） ---------- */
async function runTrackerLabelScan(file) {
  const box = $("#trackerPanel");
  if (!box) return;
  if (!(await ensureApiReady(box))) return;
  setBusy($("#trackerScanBtn"), true, "AI 识别中…");
  box.innerHTML = '<p class="hint">正在识别包装上的营养成分表，通常需要 5~15 秒…</p>';
  try {
    const image = await fileToCompressedDataUrl(file);
    const data = await aiScanLabel(image);
    adoptQuota(data);
    box.innerHTML = "";
    renderParsedForm(labelToParsed(data));
  } catch (e) {
    if (!handleAiGateError(box, e)) {
      box.innerHTML = `<p class="error-text">${esc(e.message)}</p><p class="hint">请对准「营养成分表」拍清晰些再试，或改用粘贴文本。</p>`;
    }
  } finally {
    setBusy($("#trackerScanBtn"), false);
  }
}

function bindTrackerPanel() {
  const dz = $("#trackerDropzone");
  const input = $("#trackerLabelInput");
  if (!dz || !input) return;
  const pick = () => input.click();
  dz.addEventListener("click", (e) => { if (e.target !== input) pick(); });
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
  ["dragenter", "dragover"].forEach(evt => dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(evt => dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.remove("dragover"); }));
  dz.addEventListener("drop", (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) runTrackerLabelScan(file);
  });
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (file) runTrackerLabelScan(file);
  });
  const scanBtn = $("#trackerScanBtn");
  if (scanBtn) scanBtn.addEventListener("click", pick);
}

function renderTracker() {
  const container = $("#trackerEntries");
  const totalBox = $("#trackerTotal");
  if (!container) return;
  container.innerHTML = "";
  const today = state.entries.filter(e => e.date === todayStr());
  if (!today.length) {
    container.innerHTML = '<div class="placeholder">今天还没有记录</div>';
    totalBox.innerHTML = "";
    return;
  }
  const meals = state.mealsPerDay || 3;
  for (let i = 0; i < meals; i++) {
    const mealEntries = today.filter(e => e.mealIndex === i);
    if (!mealEntries.length) continue;
    const sum = sumEntries(mealEntries);
    const section = document.createElement("div");
    section.className = "meal-section";
    section.innerHTML = `<h4>${mealName(i)} · ${fmt(sum.calories, 0)} kcal</h4>`;
    const ul = document.createElement("ul");
    ul.className = "food-list";
    mealEntries.forEach(e => {
      const li = document.createElement("li");
      const title = e.brand ? `${e.brand} ${e.name}` : e.name;
      const isPending = e.status === "pending";
      const unitText = e.unit === "ml" ? "ml" : "g";
      li.innerHTML = `
        <div>
          <span class="food-name">${esc(title)}</span>
          ${isPending ? '<span class="badge pending">待补充</span>' : ""}
          <span class="food-meta">${fmt(e.amount, 0)}${esc(e.unitLabel || e.unit)}${e.grams ? " ≈ " + fmt(e.grams, 0) + "g" : ""}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span class="food-meta">${isPending ? "营养待补充" : `蛋${fmt(e.protein, 1)} 碳${fmt(e.carbs, 1)} 脂${fmt(e.fat, 1)}`}</span>
          ${isPending ? '<button type="button" class="link-btn complete-btn">补全</button>' : ""}
          <button class="delete-btn" data-id="${e.id}">×</button>
        </div>
        ${isPending ? `
        <div class="pending-form" hidden style="width:100%;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);">
          <p class="hint" style="margin-bottom:8px;">按每 100${unitText} 填写营养（可只填已知项），保存后按实际克数折算并计入今日统计。</p>
          <div class="macros-inputs">
            <input type="number" class="pc-cal" min="0" step="0.1" placeholder="kcal">
            <input type="number" class="pc-pro" min="0" step="0.1" placeholder="蛋白 g">
            <input type="number" class="pc-carb" min="0" step="0.1" placeholder="碳水 g">
            <input type="number" class="pc-fat" min="0" step="0.1" placeholder="脂肪 g">
          </div>
          <div class="form-row" style="margin-top:8px;">
            <label>本次食用克数 (g)${e.grams ? `（留空默认 ${fmt(e.grams, 0)}g）` : "（必填）"}</label>
            <input type="number" class="pc-grams" min="1" step="1" value="${e.grams ? fmt(e.grams, 0) : ""}" placeholder="例如 150">
          </div>
          <div class="btn-row">
            <button type="button" class="btn primary pc-save">保存补全</button>
            <button type="button" class="btn secondary pc-cancel">取消</button>
          </div>
        </div>` : ""}
      `;
      ul.appendChild(li);

      if (isPending) {
        li.style.flexWrap = "wrap";
        const form = li.querySelector(".pending-form");
        const openBtn = li.querySelector(".complete-btn");
        const closeForm = () => { form.hidden = true; if (openBtn) openBtn.textContent = "补全"; };
        if (openBtn) openBtn.addEventListener("click", () => {
          form.hidden = !form.hidden;
          openBtn.textContent = form.hidden ? "补全" : "收起";
        });
        const cancelBtn = li.querySelector(".pc-cancel");
        if (cancelBtn) cancelBtn.addEventListener("click", closeForm);
        const saveBtn = li.querySelector(".pc-save");
        if (saveBtn) saveBtn.addEventListener("click", () => {
          const nutrients = {
            calories: num(li.querySelector(".pc-cal").value),
            protein: num(li.querySelector(".pc-pro").value),
            carbs: num(li.querySelector(".pc-carb").value),
            fat: num(li.querySelector(".pc-fat").value)
          };
          const gramsInput = li.querySelector(".pc-grams");
          const gramsOverride = gramsInput ? num(gramsInput.value) : 0;
          const target = state.entries.find(x => String(x.id) === String(e.id));
          if (!target) return renderTracker();
          if (!completePendingEntry(target, nutrients, gramsOverride)) {
            return alert("补全失败：请至少填写一项每 100g 营养，并确认食用克数大于 0。");
          }
          saveState();
          renderTracker();
          renderDashboard();
        });
      }
    });
    section.appendChild(ul);
    container.appendChild(section);
  }

  container.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.entries = state.entries.filter(e => String(e.id) !== String(btn.dataset.id));
      saveState();
      renderTracker();
      renderDashboard();
    });
  });

  const total = sumEntries(today);
  totalBox.innerHTML = `
    <strong>今日合计：</strong>
    ${fmt(total.calories, 0)} kcal · 蛋白质 ${fmt(total.protein, 1)}g · 碳水 ${fmt(total.carbs, 1)}g · 脂肪 ${fmt(total.fat, 1)}g
    ${total.pendingCount ? `<span class="food-meta">（另有 ${total.pendingCount} 条待补充未计入）</span>` : ""}
  `;
}

/* ================= 食品查询 ================= */
function renderFoodDetail(food) {
  const box = $("#foodDetail");
  if (!box) return;
  box.hidden = false;
  const n = per100(food);
  const alias = (food.aliases || []).join("、");
  box.innerHTML = `
    <div class="food-detail-card">
      <div class="food-detail-head">
        ${thumbHtml(food, "food-thumb-lg")}
        <div>
          <h4>${esc(foodTitle(food))} ${foodBadge(food)}</h4>
          <p class="food-meta">${esc(food.category)}${food.spec ? " · " + esc(food.spec) : ""}${alias ? " · 别名：" + esc(alias) : ""}</p>
          ${food.package ? `<p class="hint">净含量 ${esc(packageText(food))}，记录时可把单位切换为「${esc(food.package.label)}」自动换算。</p>` : ""}
        </div>
      </div>
      <div class="metric-grid" style="margin:10px 0;">
        <div class="metric-item"><div class="metric-label">热量</div><div class="metric-value">${fmt(n.calories, 0)}</div><div class="metric-desc">kcal / 100${food.unit === "ml" ? "ml" : "g"}</div></div>
        <div class="metric-item"><div class="metric-label">蛋白质</div><div class="metric-value">${fmt(n.protein, 1)}g</div></div>
        <div class="metric-item"><div class="metric-label">碳水</div><div class="metric-value">${fmt(n.carbs, 1)}g</div></div>
        <div class="metric-item"><div class="metric-label">脂肪</div><div class="metric-value">${fmt(n.fat, 1)}g</div></div>
      </div>
      ${food.serving ? `<p class="hint">每${esc(food.serving.label)}约 ${food.serving.grams}g</p>` : ""}
      ${food.note ? `<p class="hint">${esc(food.note)}</p>` : ""}
      <button class="btn primary" id="detailTrackBtn" data-id="${food.id}">去记录今日摄入</button>
    </div>
  `;
  const btn = $("#detailTrackBtn");
  if (btn) btn.addEventListener("click", () => {
    const target = foodById(btn.dataset.id);
    if (!target) return;
    showTab("tracker");
    selectFood(target);
    updatePreview();
  });
}

function showTab(name) {
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab-panel").forEach(p => p.classList.toggle("active", p.id === name));
  if (name === "dashboard") renderDashboard();
  if (name === "tracker") { renderMealOptions(); renderTracker(); }
}

function renderParsedForm(parsed) {
  const box = $("#parsedPanel");
  if (!box) return;
  const d = parsed.data;
  const n = d.nutrition || {};
  const catOptions = CATEGORIES.map(c => `<option value="${c}" ${c === d.category ? "selected" : ""}>${c}</option>`).join("");
  const warnHtml = parsed.warnings.length
    ? `<ul class="warning-list">${parsed.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>`
    : "";
  box.innerHTML = `
    <div class="parsed-form">
      <h4>识别结果（请核对后再保存）</h4>
      ${warnHtml}
      <div class="parsed-grid">
        <div class="form-row"><label>食品名称 *</label><input type="text" id="ppName" value="${esc(d.name)}"></div>
        <div class="form-row"><label>品牌</label><input type="text" id="ppBrand" value="${esc(d.brand)}"></div>
        <div class="form-row"><label>类别</label><select id="ppCategory">${catOptions}</select></div>
        <div class="form-row"><label>营养基准</label>
          <select id="ppUnit"><option value="100g" ${d.basis !== "100ml" ? "selected" : ""}>每 100g</option><option value="100ml" ${d.basis === "100ml" ? "selected" : ""}>每 100ml</option></select>
        </div>
        <div class="form-row"><label>净含量 (g/ml)</label><input type="number" id="ppNet" value="${d.netGrams || ""}" placeholder="可选"></div>
        <div class="form-row"><label>每份单位名</label><input type="text" id="ppServingLabel" value="${esc(d.servingLabel || "")}" placeholder="如 杯/袋（可选）"></div>
        <div class="form-row"><label>条形码（可选）</label><input type="text" id="ppBarcode" value="${esc(d.barcode || "")}" placeholder="8-14 位数字"></div>
        <div class="form-row"><label>别名 / 关键词（逗号分隔）</label><input type="text" id="ppAliases" value="" placeholder="可选"></div>
      </div>
      <div class="form-row"><label>每 100g / 100ml 营养（未识别到请手动补齐）</label>
        <div class="macros-inputs">
          <input type="number" id="ppCal" value="${n.calories ?? ""}" placeholder="kcal">
          <input type="number" id="ppPro" value="${n.protein ?? ""}" placeholder="蛋白 g">
          <input type="number" id="ppCarb" value="${n.carbs ?? ""}" placeholder="碳水 g">
          <input type="number" id="ppFat" value="${n.fat ?? ""}" placeholder="脂肪 g">
        </div>
      </div>
      <div class="form-row"><label>配料表（识别内容，仅供核对）</label>
        <textarea id="ppIngredients" rows="2">${esc((d.ingredients || []).join("、"))}</textarea>
      </div>
      <p class="hint">${parsed.ingredientOnly ? "仅有配料表：不会自动生成营养数值，请手动填写或保留为待确认。" : parsed.aiSource ? "数值来自 AI 对包装照片的识别，可能有误差，请逐项核对后再保存（可直接修改）。" : "数值来自你粘贴的营养成分表，请以包装为准。"}</p>
      <div class="btn-row">
        <button class="btn primary" id="saveParsedBtn">保存为自定义食品</button>
        <button class="btn secondary" id="cancelParsedBtn">取消</button>
      </div>
    </div>
  `;

  $("#cancelParsedBtn").addEventListener("click", () => { box.innerHTML = ""; });
  $("#saveParsedBtn").addEventListener("click", () => saveParsedFood(parsed));
}

function saveParsedFood(parsed) {
  const name = $("#ppName").value.trim();
  if (!name) return alert("请填写食品名称");
  const brand = $("#ppBrand").value.trim();
  const category = $("#ppCategory").value;
  const basis = $("#ppUnit").value;
  const unit = basis === "100ml" ? "ml" : "g";
  const net = num($("#ppNet").value);
  const servingLabel = $("#ppServingLabel").value.trim();
  const barcode = ($("#ppBarcode").value || "").trim();
  if (barcode && !/^\d{8,14}$/.test(barcode)) return alert("条形码应为 8-14 位数字，请核对");
  const aliases = ($("#ppAliases").value || "").split(/[,，、;；]/).map(s => s.trim()).filter(Boolean);
  const calRaw = $("#ppCal").value, proRaw = $("#ppPro").value, carbRaw = $("#ppCarb").value, fatRaw = $("#ppFat").value;
  const hasAny = [calRaw, proRaw, carbRaw, fatRaw].some(v => String(v).trim() !== "");

  if (!hasAny && !parsed.ingredientOnly) return alert("请至少填写一项营养数据");

  const exists = getFoods().find(f => norm(f.name) === norm(name) && norm(f.brand || "") === norm(brand));
  if (exists && !confirm(`已存在同名食品「${foodTitle(exists)}」。不会覆盖原记录，是否仍保存为新条目？`)) return;

  const nutrition = hasAny ? {
    calories: num(calRaw),
    protein: num(proRaw),
    carbs: num(carbRaw),
    fat: num(fatRaw),
    sodium: parsed.data.nutrition ? parsed.data.nutrition.sodium : null
  } : null;

  const food = {
    id: "p_" + Date.now(),
    name, brand, category, unit,
    aliases, keywords: aliases, barcode,
    nutrition,
    serving: null,
    package: net > 0 ? { label: "包装", grams: net } : null,
    spec: net > 0 ? `${net}${unit}/包装` : "",
    source: hasAny ? "label" : "user",
    reliability: hasAny ? (parsed.ingredientOnly ? "user" : "label") : "pending",
    tags: [category],
    gl: ""
  };
  if (net > 0 && servingLabel) food.serving = { label: servingLabel, grams: net };

  state.customFoods.push(food);
  saveState();
  $("#parsedPanel").innerHTML = `<div class="hint" style="color:var(--primary-dark);">已保存「${esc(name)}」。${hasAny ? "可到摄入记录中选择它。" : "当前为待确认状态，补全营养后才能精确计算。"}</div>`;
  renderFoodSearchResults();
}

function renderFoodSearchResults() {
  const q = $("#foodSearchInput").value.trim();
  const box = $("#foodSearchResults");
  if (!box) return;
  if (!q) { box.innerHTML = ""; return; }
  const brandPanel = renderBrandProductsPanel(q);
  const hits = searchFoods(q, 20);
  let hitsHtml = "";
  if (!hits.length) {
    hitsHtml = '<div class="placeholder">未找到匹配食品。<br><button type="button" class="link-btn go-custom">＋ 新增自定义食品</button>，或粘贴包装信息新增。</div>';
  } else {
    hitsHtml = '<div class="result-list">' + hits.map(food => {
      const pkg = packageText(food);
      return `<div class="result-item" data-food-id="${esc(food.id)}">
        <div class="result-main">
          ${thumbHtml(food, "food-thumb-sm")}
          <div>
            <div class="name">${esc(foodTitle(food))} ${foodBadge(food)}</div>
            <div class="macros">${esc(food.category)}${food.spec ? " · " + esc(food.spec) : ""}${pkg ? " · 净含量 " + esc(pkg) : ""}</div>
          </div>
        </div>
        <div class="macros" style="text-align:right;">
          ${fmt(per100(food).calories, 0)} kcal<br>蛋${fmt(per100(food).protein, 1)} 碳${fmt(per100(food).carbs, 1)} 脂${fmt(per100(food).fat, 1)}
        </div>
      </div>`;
    }).join("") + "</div>";
  }
  box.innerHTML = brandPanel + hitsHtml;
  bindBrandCards(box, (food) => renderFoodDetail(food));
  box.querySelectorAll(".result-item[data-food-id]").forEach(el => {
    el.addEventListener("click", () => {
      const food = foodById(el.dataset.foodId);
      if (food) renderFoodDetail(food);
    });
  });
}

function bindFoods() {
  $("#foodSearchInput").addEventListener("input", renderFoodSearchResults);
  $("#parseProductBtn").addEventListener("click", () => {
    const text = $("#productText").value;
    const parsed = parseProductText(text);
    if (!parsed.ok) return alert(parsed.error || "无法解析，请检查文本");
    renderParsedForm(parsed);
  });
  $("#pasteClipboardBtn").addEventListener("click", async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error("unsupported");
      const text = await navigator.clipboard.readText();
      if (!text) return alert("剪贴板为空，或没有可粘贴的文本。");
      $("#productText").value = text;
      $("#productText").focus();
    } catch (e) {
      alert("浏览器未授权读取剪贴板。请点击文本框后按 Ctrl+V（Mac 为 Cmd+V）粘贴。");
    }
  });
  $("#foodsAiBtn").addEventListener("click", runFoodsAiSearch);
}

/* ================= 身体数据（保持原逻辑） ================= */
function bindBody() {
  $("#sex").value = state.body.sex;
  $("#age").value = state.body.age;
  $("#height").value = state.body.height;
  $("#weight").value = state.body.weight;
  $("#waist").value = state.body.waist || "";
  $("#neck").value = state.body.neck || "";
  $("#hip").value = state.body.hip || "";
  $("#activity").value = state.body.activity;

  $("#calcBodyBtn").addEventListener("click", () => {
    state.body = {
      sex: $("#sex").value,
      age: +$("#age").value,
      height: +$("#height").value,
      weight: +$("#weight").value,
      waist: +$("#waist").value || "",
      neck: +$("#neck").value || "",
      hip: +$("#hip").value || "",
      activity: +$("#activity").value
    };
    saveState();

    const { sex, age, height, weight, waist, neck, hip, activity } = state.body;
    const bmi = calcBMI(weight, height);
    const bmiCat = bmiCategory(bmi);
    const bmr = calcBMR(sex, weight, height, age);
    const tdee = calcTDEE(bmr, activity);
    const bodyFat = calcBodyFat(sex, waist, neck, height, hip);
    const ideal = idealWeight(height, sex);
    // BAI 体型指数 = 腰围 / 身高^1.5 - 18（腰围、身高单位：米）；与体脂率不是同一指标
    const bai = waist && height ? (waist / Math.pow(height / 100, 1.5)) - 18 : null;

    // 体脂率只在公式所需围度齐全且合法时展示；缺失时给出补录提示，绝不显示 NaN / --%
    let bodyFatCell;
    if (bodyFat !== null) {
      bodyFatCell = `<div class="metric-item"><div class="metric-label">估算体脂率</div><div class="metric-value">${fmt(bodyFat, 1)}%</div><div class="metric-desc">美国海军公式（按实测围度）</div></div>`;
    } else {
      const missing = [];
      if (!waist) missing.push("腰围");
      if (!neck) missing.push("颈围");
      if (sex === "female" && !hip) missing.push("臀围");
      const tip = missing.length ? `需补充${missing.join("/")}` : "围度数据不合理，无法估算";
      bodyFatCell = `<div class="metric-item"><div class="metric-label">估算体脂率</div><div class="metric-value" style="font-size:13px;color:var(--text-light);">${esc(tip)}</div><div class="metric-desc">需腰围 + 颈围${sex === "female" ? " + 臀围" : ""}，且腰围大于颈围</div></div>`;
    }

    const grid = $("#bodyMetrics");
    grid.innerHTML = `
      <div class="metric-item"><div class="metric-label">BMI</div><div class="metric-value" style="color:${bmiCat.color}">${fmt(bmi, 1)}</div><div class="metric-desc">${bmiCat.label}</div></div>
      <div class="metric-item"><div class="metric-label">BMR 基础代谢</div><div class="metric-value">${fmt(bmr, 0)}</div><div class="metric-desc">kcal/天</div></div>
      <div class="metric-item"><div class="metric-label">TDEE 每日总消耗</div><div class="metric-value">${fmt(tdee, 0)}</div><div class="metric-desc">kcal/天</div></div>
      <div class="metric-item"><div class="metric-label">标准体重</div><div class="metric-value">${fmt(ideal, 1)}</div><div class="metric-desc">kg（Broca 公式）</div></div>
      ${bodyFatCell}
      ${bai !== null ? `<div class="metric-item"><div class="metric-label">BAI 体型指数</div><div class="metric-value">${fmt(bai, 1)}</div><div class="metric-desc">腰高相关，与体脂率不是同一指标</div></div>` : ""}
    `;
    renderDashboard();
  });
}

/* ================= 画像多选 ================= */
function renderProfileChips(container, tags, onChange) {
  if (!container) return;
  container.innerHTML = PROFILE_GROUPS.map(g => `
    <div class="chip-group">
      <div class="chip-group-title">${esc(g.title)}</div>
      <div class="chips">
        ${g.options.map(o => `
          <button type="button" class="chip ${(tags[g.key] || []).includes(o.id) ? "active" : ""}" data-group="${g.key}" data-id="${o.id}">${esc(o.label)}</button>
        `).join("")}
      </div>
    </div>
  `).join("");
  container.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const group = chip.dataset.group;
      const id = chip.dataset.id;
      const arr = tags[group] || (tags[group] = []);
      const idx = arr.indexOf(id);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(id);
      onChange(tags);
    });
  });
}

function renderSelectedTags() {
  const box = $("#selectedTagsSummary");
  if (!box) return;
  const ids = allSelectedTagIds(state.profileTags);
  box.innerHTML = ids.length
    ? ids.map(id => `<span class="tag-pill">${esc(PROFILE_LABEL[id] || id)}</span>`).join("")
    : '<span class="hint">未选择画像，将按通用方案生成。</span>';
}

function renderPlanChips() {
  renderProfileChips($("#planProfileChips"), state.profileTags, (tags) => {
    setProfileTags(tags);
    renderSelectedTags();
    renderPlanChips();
    renderDashboard();
  });
}

function renderSettingsChips() {
  renderProfileChips($("#settingsProfileChips"), settingsDraft, () => {
    renderSettingsChips();
  });
}

/* ================= 目标计划 ================= */
function bindPlan() {
  renderPlanChips();

  $("#generatePlanBtn").addEventListener("click", () => {
    const planInput = {
      goalType: $("#goalType").value,
      targetWeight: num($("#targetWeight").value),
      weeks: clamp(num($("#planWeeks").value) || 12, 1, 104),
      mealsPerDay: clamp(num($("#mealsPerDay").value) || 3, 2, 8)
    };
    if (!planInput.targetWeight) return alert("请输入目标体重");
    state.plan = { ...state.plan, ...planInput };
    state.mealsPerDay = planInput.mealsPerDay;
    saveState();
    renderMealOptions();

    const plan = generatePlan(state.profileTags, state.body, planInput);
    renderPlanOverview(plan);
    renderPlanTimeline(plan);
    renderDashboard();
  });
}

function renderPlanOverview(plan) {
  const container = $("#planOverview");
  if (!container) return;
  container.className = "";
  const labels = plan.labels.length ? plan.labels : ["通用（未选择画像）"];
  const notes = plan.notes.length
    ? `<ul class="warning-list" style="color:var(--text-light);">${plan.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>`
    : "";
  const warnList = plan.warnings || (plan.warning ? [plan.warning] : []);
  const warningHtml = warnList.length
    ? `<div class="plan-warning" role="alert" style="margin:12px 0;padding:10px 12px;border-left:4px solid var(--danger);background:rgba(231,76,60,0.08);color:var(--danger);border-radius:6px;font-size:13px;line-height:1.6;">
        ⚠️ ${warnList.map(w => esc(w)).join("<br>")}
      </div>`
    : "";
  container.innerHTML = `
    <div class="plan-overview">
      <div class="overview-box"><div class="label">BMR</div><div class="value">${fmt(plan.bmr, 0)}</div></div>
      <div class="overview-box"><div class="label">TDEE</div><div class="value">${fmt(plan.tdee, 0)}</div></div>
      <div class="overview-box"><div class="label">目标热量</div><div class="value">${fmt(plan.targetCalories, 0)}</div></div>
      <div class="overview-box"><div class="label">每周变化</div><div class="value">${plan.weeklyChange > 0 ? "+" : ""}${fmt(plan.weeklyChange, 2)} kg</div></div>
    </div>
    ${warningHtml}
    <div class="metric-grid" style="margin:14px 0;">
      <div class="metric-item"><div class="metric-label">蛋白质</div><div class="metric-value">${fmt(plan.proteinG, 1)}g</div></div>
      <div class="metric-item"><div class="metric-label">碳水</div><div class="metric-value">${fmt(plan.carbsG, 1)}g</div></div>
      <div class="metric-item"><div class="metric-label">脂肪</div><div class="metric-value">${fmt(plan.fatG, 1)}g</div></div>
      <div class="metric-item"><div class="metric-label">餐数</div><div class="metric-value">${plan.meals}</div></div>
    </div>
    <p class="hint">画像：${labels.map(l => `<span class="tag-pill">${esc(l)}</span>`).join("")}</p>
    ${notes}
    <h4 style="margin-top:16px;">每餐营养素分配</h4>
    <table class="meal-ratio-table">
      <thead><tr><th>餐次</th><th>热量</th><th>蛋白质</th><th>碳水</th><th>脂肪</th><th>备注</th></tr></thead>
      <tbody>
        ${plan.mealPlan.map(m => `
          <tr>
            <td>${m.name} (${fmt(m.ratio * 100, 0)}%)</td>
            <td>${fmt(m.calories, 0)} kcal</td>
            <td>${fmt(m.protein, 1)}g</td>
            <td>${fmt(m.carbs, 1)}g</td>
            <td>${fmt(m.fat, 1)}g</td>
            <td>${m.note || "—"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderPlanTimeline(plan) {
  const timeline = $("#planTimeline");
  if (!timeline) return;
  timeline.style.display = "block";
  $("#timelineContent").innerHTML = plan.timeline.map(m => `
    <div class="timeline-month">
      <h4>第 ${m.monthIndex} 个月</h4>
      <div class="weeks">
        ${m.weeks.map(w => `
          <div class="week-card">
            <h5>第 ${w.weekIndex} 周 · ${w.phase}</h5>
            <p>预计体重：${fmt(w.expectedWeight, 1)} kg</p>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");
}

/* ================= AI 拍照 ================= */
function refOptions(mode) {
  return mode === "body" ? BODY_REFS : REF_OBJECTS;
}

function renderRefSelect(mode) {
  const sel = $("#refObject");
  if (!sel) return;
  const opts = refOptions(mode);
  sel.innerHTML = Object.entries(opts).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("");
  sel.disabled = mode === "none";
  $("#refObjectLabel").textContent = mode === "body" ? "人体部位" : "参照物";
  updateRefGuide();
}

function updateRefGuide() {
  const mode = (document.querySelector('input[name="refMode"]:checked') || {}).value || "object";
  const guide = $("#refGuide");
  if (!guide) return;
  let html = "";
  if (mode === "object") {
    const key = $("#refObject").value || "card";
    const ref = REF_OBJECTS[key] || REF_OBJECTS.card;
    html = `拍摄时把参照物与食物放在<b>同一平面</b>，并让两者都完整入镜。${esc(ref.note)}。参照物只用于估算面积，不要求拍摄卡面信息。`;
  } else if (mode === "body") {
    const key = $("#refObject").value || "fist";
    const ref = BODY_REFS[key] || BODY_REFS.fist;
    html = `把手与食物放在同一张照片里，手掌或拳头尽量贴近食物。${esc(ref.note)}。此为近似估算，不应当作精确测量。`;
  } else {
    html = "没有参照物时只能按常见份量粗估，误差明显增大；建议尽量使用物品或人体参照。";
  }
  guide.innerHTML = `💡 ${html}`;
}

function flashAi(msg, isError) {
  let el = $("#aiStatus");
  if (!el) {
    el = document.createElement("p");
    el.id = "aiStatus";
    el.className = "hint";
    const dz = $("#aiDropzone");
    if (dz) dz.appendChild(el);
  }
  el.textContent = msg;
  el.style.color = isError ? "var(--danger)" : "var(--primary-dark)";
}

function setAiImage(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith("image/")) {
    flashAi("这不是图片文件，请选择或粘贴图片。", true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    flashAi("图片超过 10MB，请压缩后再试。", true);
    return;
  }
  if (aiObjectUrl) URL.revokeObjectURL(aiObjectUrl);
  aiFile = file;
  aiObjectUrl = URL.createObjectURL(file);
  $("#aiPreview").innerHTML = `<img src="${aiObjectUrl}" alt="食物照片预览">`;
  $("#aiPhotoActions").hidden = false;
  flashAi(`已添加照片：${file.name || "剪贴板图片"}`);
}

function clearAiImage() {
  if (aiObjectUrl) URL.revokeObjectURL(aiObjectUrl);
  aiFile = null;
  aiObjectUrl = null;
  $("#aiPreview").innerHTML = DEFAULT_PREVIEW_HTML;
  $("#aiPhotoActions").hidden = true;
  const st = $("#aiStatus");
  if (st) st.remove();
}

function addAiRow(foodId) {
  const container = $("#aiRows");
  if (!container) return;
  const foods = getFoods();
  const options = foods.map(f => `<option value="${f.id}" ${foodId === f.id ? "selected" : ""}>${esc(foodTitle(f))}</option>`).join("");
  const row = document.createElement("div");
  row.className = "ai-row";
  row.innerHTML = `
    <div class="form-row"><label>食物</label><select class="ai-food">${options}</select></div>
    <div class="form-row"><label>相对大小</label>
      <select class="ai-size">
        <option value="0.5">约 0.5 倍</option>
        <option value="1" selected>约 1 倍</option>
        <option value="1.5">约 1.5 倍</option>
        <option value="2">约 2 倍</option>
      </select>
    </div>
    <div class="form-row"><label>厚度</label>
      <select class="ai-thickness">
        <option value="thin">薄</option>
        <option value="medium" selected>中</option>
        <option value="thick">厚</option>
      </select>
    </div>
    <button type="button" class="remove-row" title="删除这一行">×</button>
  `;
  row.querySelector(".remove-row").addEventListener("click", () => {
    if (container.children.length <= 1) return alert("至少保留一种食物");
    row.remove();
  });
  container.appendChild(row);
}

function collectAiRows() {
  return [...document.querySelectorAll("#aiRows .ai-row")].map(row => ({
    foodId: row.querySelector(".ai-food").value,
    size: row.querySelector(".ai-size").value,
    thickness: row.querySelector(".ai-thickness").value
  }));
}

function renderAiResult(est) {
  const box = $("#aiResult");
  if (!box) return;
  box.className = "ai-result";
  const rowsHtml = est.items.map((it, i) => `
    <tr>
      <td><input type="text" class="ai-name" data-i="${i}" value="${esc(it.brand ? it.brand + " " + it.name : it.name)}"></td>
      <td><input type="number" class="grams-input ai-grams" data-i="${i}" value="${it.gramsMid}" min="1"></td>
      <td>${it.caloriesLow}–${it.caloriesHigh} kcal</td>
      <td>${it.protein}g</td>
      <td>${it.carbs}g</td>
      <td>${it.fat}g</td>
    </tr>
  `).join("");
  box.innerHTML = `
    <h4>估算结果（区间）</h4>
    <table class="estimate-table">
      <thead><tr><th>食物</th><th>重量 (g)</th><th>能量</th><th>蛋白质</th><th>碳水</th><th>脂肪</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <p class="hint">合计约 <strong>${est.totals.low}–${est.totals.high} kcal</strong>（中值 ${est.totals.mid}）· 蛋白 ${fmt(est.totals.protein, 1)}g · 碳水 ${fmt(est.totals.carbs, 1)}g · 脂肪 ${fmt(est.totals.fat, 1)}g</p>
    <p class="hint">可修改名称或重量；确认时会按修改后的重量重新计算。</p>
    <ul class="warning-list">${est.uncertainty.map(u => `<li>${esc(u)}</li>`).join("")}</ul>
    <div class="confirm-row">
      <label>餐次</label>
      <select id="aiConfirmMeal">${Array.from({ length: state.mealsPerDay || 3 }, (_, i) => `<option value="${i}">${mealName(i)}</option>`).join("")}</select>
      <label class="check-row"><input type="checkbox" id="aiConfirmCheck"> 我已核对，确认加入今日摄入</label>
      <button class="btn primary" id="aiConfirmBtn">加入今日摄入</button>
    </div>
  `;

  $("#aiConfirmBtn").addEventListener("click", () => {
    if (!$("#aiConfirmCheck").checked) return alert("请先勾选确认，再加入今日摄入");
    const mealIndex = +$("#aiConfirmMeal").value;
    const gramsInputs = [...document.querySelectorAll(".ai-grams")];
    const nameInputs = [...document.querySelectorAll(".ai-name")];
    const cook = COOK_FACTOR[$("#cookMethod").value] || COOK_FACTOR.lowoil;
    let added = 0;
    est.items.forEach((it, i) => {
      const food = foodById(it.foodId);
      if (!food) return;
      const grams = num(gramsInputs[i] && gramsInputs[i].value);
      if (!grams) return;
      const n = per100(food);
      const kcal = n.calories * grams / 100 * cook.cal;
      state.entries.push({
        id: Date.now() + Math.random(),
        date: todayStr(),
        mealIndex,
        foodId: food.id,
        name: (nameInputs[i] && nameInputs[i].value.trim()) || food.name,
        brand: "",
        amount: grams,
        unit: "g",
        unitLabel: "g",
        grams,
        calories: kcal,
        protein: n.protein * grams / 100,
        carbs: n.carbs * grams / 100,
        fat: n.fat * grams / 100 * cook.fat,
        status: "complete",
        source: "ai",
        createdAt: new Date().toISOString()
      });
      added++;
    });
    if (!added) return alert("没有可加入的记录");
    saveState();
    renderDashboard();
    renderTracker();
    alert(`已加入 ${added} 条记录到${mealName(mealIndex)}。`);
  });
}

function bindAI() {
  const dz = $("#aiDropzone");
  const input = $("#aiPhotoInput");
  if (!dz || !input) return;

  dz.addEventListener("click", (e) => {
    if (e.target === input) return; // 避免 input.click() 冒泡回来造成递归
    input.click();
  });
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (file) setAiImage(file);
    input.value = "";
  });
  $("#aiRemoveBtn").addEventListener("click", clearAiImage);
  $("#aiReplaceBtn").addEventListener("click", () => input.click());

  ["dragenter", "dragover"].forEach(evt => dz.addEventListener(evt, (e) => {
    e.preventDefault();
    dz.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach(evt => dz.addEventListener(evt, (e) => {
    e.preventDefault();
    dz.classList.remove("dragover");
  }));
  dz.addEventListener("drop", (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) setAiImage(file);
  });

  document.addEventListener("paste", (e) => {
    const panel = $("#ai");
    if (!panel || !panel.classList.contains("active")) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (items) {
      for (const item of items) {
        if (item.type && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            setAiImage(file);
            flashAi("已从剪贴板粘贴图片。");
            return;
          }
        }
      }
    }
    const text = e.clipboardData && e.clipboardData.getData("text/plain");
    const isEditable = e.target && typeof e.target.closest === "function" && e.target.closest("input, textarea");
    if (text && !isEditable) {
      flashAi("剪贴板里是文本，不是图片；请复制图片或截图后再粘贴。", true);
    }
  });

  $("#refModeRow").addEventListener("change", () => {
    const mode = (document.querySelector('input[name="refMode"]:checked') || {}).value || "object";
    renderRefSelect(mode);
  });
  $("#refObject").addEventListener("change", updateRefGuide);

  $("#aiAddRowBtn").addEventListener("click", () => addAiRow());
  addAiRow();

  $("#aiEstimateBtn").addEventListener("click", () => {
    if (!aiFile) return alert("请先添加食物照片（上传、拖拽或粘贴）");
    const rows = collectAiRows();
    if (!rows.length) return alert("请至少添加一种食物");
    const mode = (document.querySelector('input[name="refMode"]:checked') || {}).value || "object";
    const est = estimateAI({
      refMode: mode,
      refObject: $("#refObject").value,
      rows,
      cookMethod: $("#cookMethod").value
    });
    if (!est.ok) return alert(est.error || "估算失败");
    lastEstimate = est;
    renderAiResult(est);
  });

  $("#aiApiEstimateBtn").addEventListener("click", runApiEstimate);

  renderRefSelect("object");
}

/* ================= 设置 ================= */
function bindSettings() {
  settingsDraft = JSON.parse(JSON.stringify(state.profileTags || emptyTags()));
  renderSettingsChips();

  $("#saveSettingsBtn").addEventListener("click", () => {
    const meals = clamp(num($("#defaultMeals").value) || 3, 2, 8);
    state.settings.defaultTags = sanitizeTags(settingsDraft);
    state.settings.defaultMeals = meals;
    state.profileTags = sanitizeTags(settingsDraft);
    state.mealsPerDay = meals;
    saveState();
    renderMealOptions();
    renderPlanChips();
    renderSelectedTags();
    renderSettingsChips();
    renderDashboard();
    alert("设置已保存");
  });

  $("#exportDataBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nutrition-backup-${todayStr()}.json`;
    a.click();
  });

  $("#importDataBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        state = migrateState(JSON.parse(ev.target.result));
        saveState();
        loadSettingsToUI();
        renderDashboard();
        renderTracker();
        renderSelectedTags();
        alert("数据已导入");
      } catch (err) {
        alert("导入失败：文件格式不正确");
      }
    };
    reader.readAsText(file);
  });

  $("#clearDataBtn").addEventListener("click", () => {
    if (!confirm("确定清空所有本地数据？此操作不可恢复。")) return;
    localStorage.removeItem(STATE_KEY);
    state = defaultState();
    selectedFoodId = null;
    loadSettingsToUI();
    renderDashboard();
    renderTracker();
    $("#bodyMetrics").innerHTML = '<div class="metric-item placeholder">点击左侧“计算指标”查看结果</div>';
    $("#planOverview").innerHTML = '<div class="placeholder">点击“生成计划”查看你的专属方案</div>';
    $("#planTimeline").style.display = "none";
    $("#parsedPanel").innerHTML = "";
    $("#foodDetail").hidden = true;
    alert("数据已清空");
  });
}

function loadSettingsToUI() {
  $("#defaultMeals").value = state.settings.defaultMeals || state.mealsPerDay;
  $("#mealsPerDay").value = state.mealsPerDay;
  $("#goalType").value = state.plan.goalType || "lose";
  $("#targetWeight").value = state.plan.targetWeight || state.body.weight;
  $("#planWeeks").value = state.plan.weeks || 12;
  $("#sex").value = state.body.sex;
  $("#age").value = state.body.age;
  $("#height").value = state.body.height;
  $("#weight").value = state.body.weight;
  $("#activity").value = state.body.activity;
  $("#waist").value = state.body.waist || "";
  $("#neck").value = state.body.neck || "";
  $("#hip").value = state.body.hip || "";
  settingsDraft = JSON.parse(JSON.stringify(state.profileTags || state.settings.defaultTags || emptyTags()));
  renderPlanChips();
  renderSettingsChips();
  renderSelectedTags();
}

/* ================= 导航 ================= */
function openCustomFoodForm() {
  showTab("tracker");
  const sel = $("#cfCategory");
  if (sel) sel.innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
  const form = $("#customFoodForm");
  if (form) form.hidden = false;
  const name = $("#cfName");
  if (name && typeof name.focus === "function") name.focus();
}

function bindNav() {
  $$(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });
  document.addEventListener("click", (e) => {
    const btn = e.target && typeof e.target.closest === "function" ? e.target.closest(".go-custom") : null;
    if (btn) { e.preventDefault(); openCustomFoodForm(); }
  });
}

/* ================= PWA 安装提示 ================= */
let deferredInstallPrompt = null;

function bindInstallPrompt() {
  const btn = $("#installAppBtn");
  if (!btn) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    btn.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    btn.hidden = true;
  });
  btn.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try { await deferredInstallPrompt.userChoice; } catch (e) { /* 用户取消 */ }
      deferredInstallPrompt = null;
      btn.hidden = true;
      return;
    }
    const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    alert(ios
      ? "iOS 安装：用 Safari 打开本页 → 点底部「分享」→「添加到主屏幕」，之后从桌面图标启动。"
      : "请用浏览器菜单里的「安装应用 / 添加到主屏幕」；Android Chrome 地址栏右侧也会出现安装图标。");
  });
}

/* ================= 启动 ================= */
function init() {
  bindNav();
  bindTracker();
  bindTrackerPanel();
  bindFoods();
  bindBody();
  bindPlan();
  bindAI();
  bindSettings();
  loadSettingsToUI();
  renderMealOptions();
  renderDashboard();
  renderTracker();
  const dateEl = $("#todayDate");
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString("zh-CN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const themeBtn = $("#themeToggle");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
  const initialTheme = document.documentElement && document.documentElement.dataset
    ? document.documentElement.dataset.theme : "light";
  applyTheme(initialTheme, false);
  bindApiReconnect();
  bindInstallPrompt();
  bindAccountEntry();
  bindAuthModal();
  checkApi();
}

init();
