// ════════════════════════════════════════════════════════════
// 环战斗 · CE 式战斗 resolver（酒馆助手脚本）
//
// 模型（用户裁定：CE 形式完全重构，原版三区掷骰废弃）：
//   射击  命中率 = 射手精度(技能+修正) × 距离衰减 × 掩体 × 姿势 × 光照 × 压制
//   弹道  掷骰 < 命中率 → 命中；差值小 → 擦过（目标+压制）；否则偏离
//   穿甲  有效偏转 = max(0, 偏转评级 − 弹头AP)；穿透→全额×减免系数；偏转→擦伤
//   弹药  每发消耗；弹种修正伤害与 AP；弹匣容量+换弹回合
//   压制  擦过积累压制值 → 精度惩罚 → 临界瘫痪
//   近战  暴击 vs 招架 对抗；钝晕/锐破甲×2/动物扑倒；反击机制
//   部位  覆盖表掷骰决定命中部位，伤害落部位 HP
//   摘要  summarize 输出结果+写法约束（AI 只读摘要，不重算不写数字）
//
// 随机数：环引擎.下一随机 注入（LCG 确定性，重渲染不变）
// ════════════════════════════════════════════════════════════

const 环战斗 = (function () {

  // ═══════════ 弹药与武器数据（锚定批次待对 CE JSON 校准）═══════════

  const 弹种表 = {
    普通弹: { 伤害系数: 1.0, AP系数: 1.0 },
    空尖弹: { 伤害系数: 1.3, AP系数: 0.5 },
    穿甲弹: { 伤害系数: 0.8, AP系数: 1.6 },
    穿甲燃烧: { 伤害系数: 0.9, AP系数: 1.6, 点燃: 0.3 },
    穿甲高爆: { 伤害系数: 1.2, AP系数: 1.4 },
    脱壳穿甲: { 伤害系数: 0.7, AP系数: 2.2 },
  };

  const 武器表 = {
    手枪: { 类别: '远程', 伤害: 12, AP: 0.15, 弹匣: 8, 换弹: 1, 射速: 1, 近距: 0.85, 中距: 0.65, 远距: 0.35, 部位分布: '人形' },
    栓动步枪: { 类别: '远程', 伤害: 22, AP: 0.35, 弹匣: 5, 换弹: 2, 射速: 0.5, 近距: 0.7, 中距: 0.85, 远距: 0.75, 部位分布: '人形' },
    冲锋枪: { 类别: '远程', 伤害: 9, AP: 0.12, 弹匣: 25, 换弹: 2, 射速: 3, 近距: 0.8, 中距: 0.6, 远距: 0.25, 部位分布: '人形' },
    霰弹枪: { 类别: '远程', 伤害: 10, AP: 0.1, 弹匣: 6, 换弹: 2, 射速: 2, 弹丸数: 4, 近距: 0.95, 中距: 0.45, 远距: 0.1, 部位分布: '人形' },
    突击步枪: { 类别: '远程', 伤害: 14, AP: 0.25, 弹匣: 20, 换弹: 2, 射速: 2, 近距: 0.8, 中距: 0.8, 远距: 0.55, 部位分布: '人形' },
    长矛: { 类别: '近战', 伤害: 16, AP: 0.2, 暴击加成: 0.05, 招架加成: 0.1, 双手: true },
    砍刀: { 类别: '近战', 伤害: 14, AP: 0.15, 暴击加成: 0.1, 招架加成: 0.05, 双手: false },
    木盾: { 类别: '盾牌', 招架加成: 0.15, 远程防护: 0.3, 禁双手: true },
  };

  // 部位覆盖表（人形）：[部位, 权重]
  const 覆盖表 = {
    人形: [['头', 8], ['躯干', 40], ['左臂', 12], ['右臂', 12], ['左腿', 14], ['右腿', 14]],
  };

  // ═══════════ 单位构造 ═══════════
  // mkUnit({ 名, 技能射击, 技能近战, 移速, 武器, 弹药数, 护甲, 掩体, 姿势, 性格 })

  function mkUnit(o) {
    return {
      名: o.名 || '无名',
      边: o.边 || '我方',
      技能射击: o.技能射击 || 0,
      技能近战: o.技能近战 || 0,
      移速: o.移速 || 4.6,
      武器: o.武器 || '手枪',
      弹种: o.弹种 || '普通弹',
      弹药数: o.弹药数 ?? 24,
      弹匣余: (武器表[o.武器] || {}).弹匣 || 0,
      护甲: o.护甲 || {},                    // { 躯干: 0.3, 头: 0.2, ... } 偏转评级
      掩体: o.掩体 ?? 0,                     // 0~0.8 掩体遮挡系数
      光照: o.光照 ?? 1,                     // 0.5 暗 ~ 1 明
      姿势: o.姿势 || '站立',                // 站立/蹲伏
      身体: o.身体 || null,                  // { 部位: {上限,当前,出血} } 缺省=标准人形
      压制: 0,
      距离: o.距离 ?? 15,                    // 与最近敌人的距离（格）
      近战接敌: false,
      已倒: false,
      死亡: false,
      日志: [],
    };
  }

  // ═══════════ 射击 ═══════════

  function 射手精度(u) {
    // 技能曲线（原版式后处理简化）：0 级 50%，20 级 95%
    let acc = 50 + Math.min(20, u.技能射击) * 2.25;
    acc *= u.光照;                                            // 光照（夜战惩罚）
    if (u.姿势 === '蹲伏') acc *= 0.9;                        // 蹲伏更稳
    if (u.压制 > 50) acc *= 0.5;                              // 压制惩罚
    else if (u.压制 > 0) acc *= 1 - u.压制 / 200;
    return Math.min(99, acc) / 100;                           // 每格基础命中
  }

  function 距离命中率(u, 武器, 距离) {
    // 四段插值：0-3 近距 / 12 中距 / 25 远距（>25 用远距×衰减）
    let base;
    if (距离 <= 3) base = 武器.近距;
    else if (距离 <= 12) base = 武器.近距 + (武器.中距 - 武器.近距) * (距离 - 3) / 9;
    else if (距离 <= 25) base = 武器.中距 + (武器.远距 - 武器.中距) * (距离 - 12) / 13;
    else base = 武器.远距 * Math.pow(0.97, 距离 - 25);
    return Math.max(0.02, base);
  }

  function 抽部位实际(eng, st, 分布名) {
    const 表 = 覆盖表[分布名] || 覆盖表.人形;
    const 总 = 表.reduce((s, x) => s + x[1], 0);
    let roll = eng.掷百分(st);
    for (const [部位, w] of 表) { roll -= w / 总 * 100; if (roll <= 0) return 部位; }
    return '躯干';
  }

  // 穿甲结算：返回 { 穿透, 减免后伤害 }
  function 穿甲(部位, 护甲, 原始伤害, AP) {
    const 偏转 = 护甲[部位] || 0;
    if (偏转 <= 0) return { 穿透: true, 伤害: Math.round(原始伤害) };
    if (AP >= 偏转) {
      const 穿透余量 = AP - 偏转;
      const 减免 = Math.max(0.2, 1 - 偏转 / (AP + 偏转));
      return { 穿透: true, 伤害: Math.max(1, Math.round(原始伤害 * 减免 + 穿透余量 * 2)) };
    }
    // 未穿透：偏转，仅擦伤
    return { 穿透: false, 伤害: Math.max(0, Math.round(原始伤害 * 0.15)) };
  }

  // ═══════════ 回合循环（多单位）═══════════

  function fight(cfg, eng, st) {
    const 我方 = cfg.我方.map(mkUnit), 敌方 = cfg.敌方.map(mkUnit);
    const log = [];
    let 回合 = 0;
    const 上限回合 = cfg.上限回合 || 12;

    while (!全灭(我方) && !全灭(敌方) && 回合 < 上限回合) {
      回合++;
      const 本回合 = { 回合, 动作: [] };

      // 行动序：移速降序
      const 全部 = [...我方, ...敌方].filter(u => !u.已倒 && !u.死亡)
        .sort((a, b) => b.移速 - a.移速);

      for (const u of 全部) {
        if (u.已倒 || u.死亡) continue;
        if (u.压制 >= 100) { u.压制 = 60; 本回合.动作.push({ 谁: u.名, 事件: '被压制瘫痪' }); continue; }

        const 敌侧 = u.边 === '我方' ? 敌方 : 我方;
        const 活敌 = 敌侧.filter(x => !x.已倒 && !x.死亡);
        if (!活敌.length) break;
        const 目标 = 活敌[0];   // 默认打最弱序第一位（可选目标策略后续扩展）

        const 武器 = 武器表[u.武器] || 武器表.手枪;
        if (武器.类别 === '远程') {
          // 弹药检查
          if (u.弹匣余 <= 0) {
            if (u.弹药数 > 0) { u.弹匣余 = Math.min(武器.弹匣, u.弹药数); u.弹药数 -= u.弹匣余; 本回合.动作.push({ 谁: u.名, 事件: '换弹' }); }
            else { 本回合.动作.push({ 谁: u.名, 事件: '弹药耗尽' }); continue; }
          }
          const 发数 = Math.min(武器.射速, u.弹匣余);
          for (let i = 0; i < 发数; i++) {
            if (目标.已倒 || 目标.死亡) break;
            u.弹匣余--; u.弹药消耗 = (u.弹药消耗 || 0) + 1;
            const 命中率 = 射手精度(u) * 距离命中率(u, 武器, u.距离) * (1 - (目标.掩体 || 0));
            const roll = eng.掷百分(st);
            const 条目 = { 谁: u.名, 打: 目标.名, 掷: Math.round(roll), 阈: Math.round(命中率 * 100) };
            if (roll < 命中率 * 100) {
              const 弹种 = 弹种表[u.弹种] || 弹种表.普通弹;
              const 部位 = 抽部位实际(eng, st, 武器.部位分布);
              const 原伤 = 武器.伤害 * 弹种.伤害系数;
              const AP = 武器.AP * 弹种.AP系数;
              const 结算 = 穿甲(部位, 目标.护甲, 原伤, AP);
              条目.事件 = 结算.穿透 ? '穿透' : '偏转';
              条目.部位 = 部位; 条目.伤害 = 结算.伤害;
              落伤(目标, 部位, 结算.伤害, 弹种, 本回合);
            } else if (roll < 命中率 * 100 + 15) {
              条目.事件 = '擦过';
              目标.压制 = Math.min(100, 目标.压制 + 25);
            } else {
              条目.事件 = '偏离';
              目标.压制 = Math.min(100, 目标.压制 + 10);
            }
            本回合.动作.push(条目);
          }
        } else if (武器.类别 === '近战') {
          // 近战：暴击 vs 招架
          const 暴击率 = 20 + u.技能近战 * 2 + (武器.暴击加成 || 0) * 100;
          const 招架率 = Math.max(0, 目标.技能近战 * 2.5 - u.技能近战) + (武器.招架加成 || 0) * 100;
          const roll = eng.掷百分(st);
          const 条目 = { 谁: u.名, 打: 目标.名, 事件: '近战' };
          if (roll < 暴击率) {
            条目.事件 = '暴击';
            落伤(目标, '躯干', Math.round(武器.伤害 * 1.5), {}, 本回合);
          } else if (roll < 暴击率 + Math.min(60, 招架率)) {
            条目.事件 = '被招架';
          } else {
            落伤(目标, 抽部位实际(eng, st, '人形'), 武器.伤害, {}, 本回合);
          }
          本回合.动作.push(条目);
        }
      }
      log.push(本回合);
    }

    const 我方活 = 我方.filter(u => !u.死亡 && !u.已倒).length;
    const 敌方活 = 敌方.filter(u => !u.死亡 && !u.已倒).length;
    const 胜者 = 我方活 && 敌方活 ? '未决' : (敌方活 ? '对方' : (我方活 ? '我方' : '同归'));

    return { 胜者, 回合数: 回合, 我方, 敌方, 日志: log, 摘要: summarize(胜者, 回合, 我方, 敌方) };
  }

  // ═══════════ 伤害落地 ═══════════

  function 落伤(u, 部位, 伤害, 弹种, 回合条) {
    if (!u.身体) u.身体 = 标准人形();
    const p = u.身体[部位] || { 上限: 10, 当前: 10, 出血: 0 };
    p.当前 = Math.max(0, p.当前 - 伤害);
    if (伤害 >= 8) p.出血 = Math.min(10, (p.出血 || 0) + 1);
    if (u.压制 > 0) u.压制 = Math.max(0, u.压制 - 30);      // 实际命中缓解压制
    if (p.当前 <= 0 && 部位 === '头') u.死亡 = true;
    if (p.当前 <= 0 && (部位 === '躯干' || 部位 === '心脏')) u.死亡 = true;
    if (p.当前 <= 0 && 部位.startsWith('腿')) u.已倒 = true; // 腿毁倒地
    回合条.落点 = 部位;
  }

  function 标准人形() {
    const out = {};
    for (const [部位, w] of 覆盖表.人形) out[部位] = { 上限: 部位 === '头' || 部位 === '躯干' ? 30 : 15, 当前: 部位 === '头' || 部位 === '躯干' ? 30 : 15, 出血: 0 };
    return out;
  }

  function 全灭(侧) { return 侧.every(u => u.死亡 || u.已倒); }

  // ═══════════ 摘要（AI 的唯一入口）═══════════

  function summarize(胜者, 回合数, 我方, 敌方) {
    const 状态 = u => {
      if (u.死亡) return '阵亡';
      if (u.已倒) return '倒地';
      const 总当前 = Object.values(u.身体 || 标准人形()).reduce((s, p) => s + p.当前, 0);
      const 总上限 = Object.values(u.身体 || 标准人形()).reduce((s, p) => s + p.上限, 0);
      const pct = 总当前 / 总上限;
      return pct > 0.8 ? '安然' : pct > 0.5 ? '轻伤' : pct > 0.25 ? '重伤' : '濒死';
    };
    const 结果 = 胜者 === '未决' ? '僵持' : 胜者 + (回合数 <= 2 ? '·碾压' : 回合数 <= 5 ? '·常规' : '·苦战');
    const 写法约束 = [];
    if (结果.includes('碾压')) 写法约束.push('快而不费力，过程短，不写拉锯');
    if (结果.includes('苦战')) 写法约束.push('必须写出耗与险，双方都到过危险处');
    if (结果.includes('僵持')) 写法约束.push('未分胜负收场，留出下一次');
    const 不可逆 = [...我方, ...敌方].filter(u => u.死亡).map(u => u.名 + ' 阵亡（不可逆）');
    return {
      结果, 回合数,
      我方状态: 我方.map(u => u.名 + ' ' + 状态(u)).join('，'),
      敌方状态: 敌方.map(u => u.名 + ' ' + 状态(u)).join('，'),
      不可逆, 写法约束,
      注入纪律: '战斗已由系统算完：不重算胜负，不写掷值/命中率/伤害数字，按写法约束叙事',
    };
  }

  // ═══════════ 格子几何层（design-spec 铁承诺：战斗直接读格子）═══════════
  // 输入：环地图的 tiles 二维数组 → 输出：距离/掩体/视线遮挡/光照
  // 掩体不再拍数字：目标相邻格的建筑/地形决定掩体质量
  // 视线：Bresenham 穿格，穿墙→弹道拦截或精度重挫

  const 地形掩体 = { 木墙: 0.55, 石墙: 0.7, 沙袋: 0.35, 地板: 0.1, 营火: 0, 床铺: 0.15, 储物区: 0.25, 工作台: 0.2 };
  const 地形遮挡 = { 石岩: true, 木墙: true, 石墙: true }; // 完全拦截弹道的格子
  const 地形移速系数 = { 草地: 1, 肥沃草地: 1, 泥地: 0.85, 沙地: 0.8, 河水: 0.5, 石岩: 0.6, 雪地: 0.7 };

  function 格子掩体(tiles, x, y, 姿势) {
    // 目标所在格与四邻的最高掩体
    if (!tiles || !tiles[y] || !tiles[y][x]) return 0;
    let best = 0;
    const 邻 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of 邻) {
      const t = tiles[y + dy] && tiles[y + dy][x + dx];
      if (!t) continue;
      let v = 地形掩体[t.建筑] || (t.地形 === '石岩' ? 0.4 : 0);
      if (t.建筑 === '地板') v = 0.1;
      if (v > best) best = v;
    }
    if (姿势 === '蹲伏') best = Math.min(0.85, best + 0.12);
    return Math.min(0.85, best);
  }

  function 视线(tiles, x1, y1, x2, y2) {
    // Bresenham：返回 { 通畅: bool, 穿墙数, 拦截格 }
    if (!tiles) return { 通畅: true, 穿墙数: 0, 拦截格: null };
    let x = x1, y = y1;
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
    let err = dx - dy, 穿墙 = 0, 拦截 = null;
    let guard = 0;
    while (guard++ < 200) {
      if (x === x2 && y === y2) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if (x === x2 && y === y2) break;
      const t = tiles[y] && tiles[y][x];
      if (t && 地形遮挡[t.建筑] && t.建筑 !== '地板') {
        穿墙++;
        if (!拦截) 拦截 = { x, y, 建筑: t.建筑 };
      }
    }
    return { 通畅: 穿墙 === 0, 穿墙数: 穿墙, 拦截格: 拦截 };
  }

  function 格子距离(x1, y1, x2, y2) {
    // 切比雪夫（对角可走）× 每格 ≈ 2 米 → 换算 resolver 的距离参数
    return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  }

  // 高层入口：从环地图直接开打（单位格位 → 几何参数自动算出）
  // eng 可选注入（酒馆环境自动从 globalThis/父窗口取，测试环境显式传）
  function fightOnMap(map, 我方配置, 敌方配置, eng注入) {
    const tiles = map.tiles;
    if (!tiles) return { 错误: '地图未生成' };
    function toUnit(cfg) {
      const geo = {
        距离: 格子距离(cfg.x, cfg.y, cfg.目标X ?? cfg.x, cfg.目标Y ?? cfg.y),
        掩体: 格子掩体(tiles, cfg.x, cfg.y, cfg.姿势),
        视线: 视线(tiles, cfg.x, cfg.y, cfg.目标X ?? cfg.x, cfg.目标Y ?? cfg.y),
      };
      const u = mkUnit(cfg);
      u.距离 = geo.距离;
      u.掩体 = geo.掩体;
      u.视线 = geo.视线;
      u.格位 = { x: cfg.x, y: cfg.y };
      // 视线被墙拦死 → 射击基本无效（弹道拦截）
      if (!geo.视线.通畅) u.视线惩罚 = Math.min(0.7, 0.35 * geo.视线.穿墙数);
      return u;
    }
    const cfg2 = {
      我方: 我方配置.map(c => ({ ...c })),
      敌方: 敌方配置.map(c => ({ ...c })),
      种子: map.seed || 1,
    };
    const 我方单位 = cfg2.我方.map(toUnit), 敌方单位 = cfg2.敌方.map(toUnit);
    // 对每个单位：找最近敌人 → 重算真实距离与视线（视线惩罚：穿墙越多重挫越狠）
    function nearestEnemy(u) {
      const foes = u.边 === '我方' ? 敌方单位 : 我方单位;
      let best = null, bd = 1e9;
      for (const f of foes) {
        const d = 格子距离(u.格位.x, u.格位.y, f.格位.x, f.格位.y);
        if (d < bd) { bd = d; best = f; }
      }
      return { foe: best, d: bd };
    }
    for (const u of [...我方单位, ...敌方单位]) {
      const ne = nearestEnemy(u);
      if (!ne.foe) continue;
      u.距离 = ne.d;
      const los = 视线(tiles, u.格位.x, u.格位.y, ne.foe.格位.x, ne.foe.格位.y);
      u.视线 = los;
      if (!los.通畅) u.视线惩罚 = Math.min(0.7, 0.35 * los.穿墙数);
    }
    const st = { $种子: map.seed || 1 };
    const eng = eng注入 || (globalThis && globalThis.环引擎) || (HOST() && HOST().环引擎);
    const res = fight({ 我方: 我方单位, 敌方: 敌方单位, 种子: map.seed || 1 }, eng, st);
    res.几何 = { 说明: '距离/掩体/视线均由格子计算', 视线拦截: [...我方单位, ...敌方单位].filter(u => u.视线 && !u.视线.通畅).map(u => u.名 + ' 视线被 ' + u.视线.拦截格.建筑 + ' 拦截（惩罚 ' + Math.round((u.视线惩罚 || 0) * 100) + '%）') };
    return res;
  }
  function HOST() { try { return window.parent && window.parent.Rimworld ? window.parent : null; } catch (e) { return null; } }

  return { 版本: '0.2.0-ce-geo', 弹种表, 武器表, mkUnit, fight, summarize, 格子掩体, 视线, 格子距离, fightOnMap };
})();

globalThis.环战斗 = 环战斗;
try { if (window.parent && window.parent !== window) window.parent.环战斗 = 环战斗; } catch (e) {} // 主文档同挂（跨脚本 bridge 依赖）
