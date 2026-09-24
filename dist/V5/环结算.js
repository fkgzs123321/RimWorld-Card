/* * ==========================================================================
 * [环世界] 结算管线 (Settlement Pipeline) v1
 * 对标轮回战场「世界推进系统」，差异：机制数值全部 JS 真算，AI 只拿摘要（比 LLM 推演硬核）
 * 架构：
 *   - 引擎桥：把环引擎/环战斗/环经济挂到 HOST.Rimworld 命名空间
 *   - E2 状态机：需求衰减/心情结算/健康恢复/食物腐败（每楼层半天一次）
 *   - 事件调度：接环引擎.调度tick（LCG 权重池＋冷却表＋讲述者/难度修正）
 *   - 守恒报告：接环经济.守恒报告（无来源增加=缺陷报警）
 *   - 空间快照：方位词+格数+地标 三要素写入 $空间快照（AI 唯一空间认知来源）
 *   - token 遥测：结算摘要体量估算
 * ========================================================================== */
(function () {
    'use strict';

    var HOST = (function () {
        try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (e) {}
        return window;
    })();
    var RW = HOST.Rimworld = HOST.Rimworld || {};
    function log(tag, msg) { try { console.log('%c[环结算] ' + tag, 'color:#5fb4e5;font-weight:bold', msg); } catch (e) {} }
    log('⚡', '结算管线 v1 接入中...');

    /* ── 0. 引擎桥：环引擎/环战斗/环经济 → Rimworld.engine/battle/economy ── */
    function bridge() {
        // 脚本库各脚本运行在独立 iframe：模块先挂在各自 globalThis，
        // 这里把找到的模块反向挂载到 HOST.Rimworld（父窗口），实现跨脚本共享（轮回战场 Samsara 同款）
        var g = window;
        try { g = HOST.globalThis || HOST; } catch (e) {}
        var found = {};
        var names = [['环引擎', 'engine'], ['环战斗', 'battle'], ['环经济', 'economy']];
        for (var i = 0; i < names.length; i++) {
            var cn = names[i][0], key = names[i][1];
            var mod = RW[key] || g[cn] || window[cn] || null;
            if (mod) { RW[key] = mod; found[key] = true; }
        }
        log('桥接', JSON.stringify(found));
        return found;
    }

    /* ── MVU 桥（与环终端同款，独立防环依赖） ── */
    function getMvu() {
        try { if (typeof window.Mvu !== 'undefined') return window.Mvu; } catch (e) {}
        try { if (typeof (window.Mvu || HOST.Mvu) !== 'undefined') return (window.Mvu || HOST.Mvu); } catch (e) {}
        return null;
    }
    function readState() {
        var m = getMvu();
        try {
            if (m && typeof m.getMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) return r.stat_data;
                if (r) return r;
            }
        } catch (e) { log('读态异常', e.message); }
        return null;
    }
    function writeState(mutator, reason) {
        var m = getMvu();
        try {
            if (m && typeof m.getMvuData === 'function' && typeof m.replaceMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) { mutator(r.stat_data); m.replaceMvuData(r, reason || '环结算'); return true; }
            }
        } catch (e) { log('写态异常', e.message); }
        return false;
    }

    /* ═══════════════════ 1. E2 状态机：每半天结算 ═══════════════════ */

    var NEEDS = ['饥饿', '休息', '娱乐', '户外', '舒适', '美观'];
    var NEED_DECAY = { 饥饿: 4.2, 休息: 3.8, 娱乐: 2.5, 户外: 1.8, 舒适: 1.5, 美观: 1.0 };

    // 人群名单：命名殖民者 + 生成殖民者（从状态读）
    function listColonists(st) {
        var out = [];
        var named = ['薇卡', '凯奥', '小满'];
        for (var i = 0; i < named.length; i++) if (st[named[i]]) out.push({ 名: named[i], 数据: st[named[i]], 私密: false });
        var extra = st.殖民者 || {};
        for (var k in extra) if (extra[k] && typeof extra[k] === 'object') out.push({ 名: k, 数据: extra[k], 私密: true });
        return out;
    }

    // 单个殖民者的半天状态推进（E2）
    function settleColonist(名, 数据, ctx) {
        var report = { 名: 名, 变化: [] };
        // 需求衰减
        if (!数据.需求) 数据.需求 = {};
        for (var n in NEED_DECAY) {
            var old = 数据.需求[n] != null ? 数据.需求[n] : 80;
            var now = Math.max(0, Math.round((old - NEED_DECAY[n] * ctx.衰减系数) * 10) / 10);
            if (Math.abs(now - old) >= 0.1) report.变化.push(n + ' ' + old + '→' + now);
            数据.需求[n] = now;
        }
        // 想法堆栈（E2 核心：带时长的心情修正逐条衰减，过期移除，同名不叠加）
        if (!数据.想法堆栈) 数据.想法堆栈 = [];
        var stack = 数据.想法堆栈;
        for (var s = stack.length - 1; s >= 0; s--) {
            var th = stack[s];
            th.剩余 = (th.剩余 || th.时长 || 6) - 1;
            if (th.剩余 <= 0) stack.splice(s, 1);
        }
        // 心情 = 基线 + 想法堆栈求和 + 需求惩罚（原版式叠加）
        var moodFromThoughts = 0;
        for (var t2 = 0; t2 < stack.length; t2++) moodFromThoughts += stack[t2].修正 || 0;
        var moodFromNeeds = 0;
        if (数据.需求.饥饿 < 15) moodFromNeeds -= 8;
        if (数据.需求.休息 < 15) moodFromNeeds -= 6;
        if (数据.需求.娱乐 < 10) moodFromNeeds -= 4;
        if (数据.需求.户外 < 10) moodFromNeeds -= 3;
        var moodBase = 数据.心情基线 != null ? 数据.心情基线 : 55;
        var moodNew = Math.max(0, Math.min(100, Math.round(moodBase + moodFromThoughts + moodFromNeeds)));
        if (moodNew !== 数据.心情) report.变化.push('心情 ' + 数据.心情 + '→' + moodNew);
        数据.心情 = moodNew;
        // 精神崩溃阈值（三档，原版式）
        if (数据.心情 < 15 && !数据.崩溃中) {
            数据.崩溃中 = true;
            var rollB = Math.random();
            var kind = rollB < 0.5 ? '轻度：原地发呆' : rollB < 0.8 ? '中度：暴食/酗酒' : '重度：攻击性狂暴';
            report.变化.push('精神崩溃！' + kind);
            pushThought(数据, '精神崩溃了', -8, 8);
        } else if (数据.心情 > 35 && 数据.崩溃中) {
            数据.崩溃中 = false;
            report.变化.push('从崩溃中恢复');
        }
        // 健康恢复：未损部位 HP 缓慢回满，受损部位按医疗趋势
        if (数据.健康) {
            for (var part in 数据.健康) {
                var bp = 数据.健康[part];
                if (bp && typeof bp === 'object' && bp.HP != null && bp.HP > 0 && bp.HP < (bp.上限 || 40)) {
                    var heal = Math.min((bp.上限 || 40) - bp.HP, ctx.医疗系数);
                    bp.HP = Math.round((bp.HP + heal) * 10) / 10;
                    report.变化.push(part + ' +他' + heal);
                }
            }
        }
        // 疾病竞速（免疫-严重度模型：immunity 追 severity，追上=痊愈，severity 过线=倒下）
        if (数据.疾病 && 数据.疾病.名称) {
            var dis = 数据.疾病;
            var immoSpeed = 0.27 * (1 + (ctx.医疗系数 - 2) * 0.15) * (数据.需求 && 数据.需求.休息 > 40 ? 1.1 : 0.8);
            dis.免疫 = Math.min(100, (dis.免疫 || 0) + immoSpeed);
            dis.严重度 = (dis.严重度 || 0) + (dis.增速 || 0.35);
            report.变化.push(dis.名称 + ' 严重度 ' + Math.round(dis.严重度) + ' / 免疫 ' + Math.round(dis.免疫));
            if (dis.免疫 >= 100) { report.变化.push(dis.名称 + ' 痊愈'); 数据.疾病 = null; pushThought(数据, '痊愈了', 6, 12); }
            else if (dis.严重度 >= 100) { report.变化.push(dis.名称 + ' 恶化倒下！'); 数据.倒下 = true; }
            else if (dis.严重度 >= 80) pushThought(数据, '病得很重', -6, 4);
        }
        return report;
    }
    function pushThought(数据, 标签, 修正, 时长) {
        if (!数据.想法堆栈) 数据.想法堆栈 = [];
        for (var i = 0; i < 数据.想法堆栈.length; i++) if (数据.想法堆栈[i].标签 === 标签) return;
        数据.想法堆栈.push({ 标签: 标签, 修正: 修正, 剩余: 时长, 时长: 时长 });
    }
    RW.pushThought = pushThought;

    // 动物生态自平衡 tick（原版 wildlife 自调节：过度猎杀→动物迁徙）
    function animalEcoTick(st) {
        if (!st.生态) st.生态 = { 动物密度: 1.0 };
        var logs = st.$流水账 || [];
        var hunt = 0;
        for (var i = Math.max(0, logs.length - 20); i < logs.length; i++) {
            var L = logs[i];
            if (L && typeof L === 'object' && (L.事由 || '').indexOf('狩猎') >= 0) hunt++;
        }
        var eco = st.生态;
        eco.动物密度 = Math.max(0.3, Math.min(1.5, eco.动物密度 + (hunt > 2 ? -0.05 : 0.02)));
        if (hunt > 3) return '警告：近期狩猎 ' + hunt + ' 次，动物密度降至 ' + Math.round(eco.动物密度 * 100) + '%（原版自平衡：过度猎杀→动物迁徙）';
        return null;
    }
    RW.animalEcoTick = animalEcoTick;

    // 食物腐败：库存.食物 每半天按温度衰减（守恒：腐败是去向不是漏洞）
    function settleRot(st, ctx) {
        var food = st.库存 && st.库存.食物;
        if (!food) return [];
        var rotten = [];
        var rate = ctx.腐败系数; // 温带基准 1/3 每天→半天 0.166，向上取整按批次
        for (var k in food) {
            if (typeof food[k] !== 'number' || food[k] <= 0) continue;
            if (k.indexOf('罐头') >= 0 || k.indexOf('腌') >= 0) continue; // 耐藏品免疫
            var loss = Math.min(food[k], Math.ceil(food[k] * rate));
            if (loss > 0) {
                food[k] -= loss;
                if (food[k] <= 0) delete food[k];
                rotten.push(k + ' 腐败 -' + loss);
            }
        }
        return rotten;
    }

    /* ═══════════════════ 2. 事件调度 tick（接环引擎） ═══════════════════ */

    function runEventTick(st, eng) {
        if (!eng || typeof eng.调度tick !== 'function') return { 摘要: '（环引擎未挂载，事件跳过）' };
        try {
            var ev = eng.调度tick(st, st.世界 && st.世界.设置 || {});
            return ev || { 摘要: '平静无事' };
        } catch (e) { log('事件调度异常', e.message); return { 摘要: '（调度异常：' + e.message + '）' }; }
    }

    /* ═══════════════════ 3. 守恒报告（接环经济） ═══════════════════ */

    function conservationCheck(eco) {
        if (!eco || typeof eco.守恒报告 !== 'function') return { OK: true, 说明: '（环经济未挂载，跳过）' };
        try {
            var rep = eco.守恒报告();
            return { OK: !rep || !rep.无来源增加 || rep.无来源增加.length === 0, 明细: rep };
        } catch (e) { return { OK: true, 说明: '守恒检查异常：' + e.message }; }
    }

    /* ═══════════════════ 4. token 遥测 ═══════════════════ */

    function estimateTokens(str) {
        var eastAsian = 0, ascii = 0, other = 0;
        for (var i = 0; i < str.length; i++) {
            var cp = str.codePointAt(i);
            if ((cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff)) eastAsian++;
            else if (cp <= 0x7f) ascii++;
            else other++;
        }
        return Math.max(1, Math.ceil(eastAsian * 1.08 + other + ascii / 3.8));
    }

    /* ═══════════════════ 5. 主结算：每楼层半天一次 ═══════════════════ */

    var lastSettledFloor = null;
    function settleOnce(force) {
        var st = readState();
        if (!st || !st.世界) return { OK: false, 说明: '状态未就绪' };
        var eng = bridge();
        var floorId = null;
        try { floorId = HOST.SillyTavern && HOST.SillyTavern.getContext && HOST.SillyTavern.getContext().chat?.length || null; } catch (e) {}
        if (!force && floorId != null && floorId === lastSettledFloor) return { OK: true, 说明: '本楼层已结算' };
        lastSettledFloor = floorId;

        // 环境系数（温度→腐败、医疗趋势简化版）
        var ctx = {
            衰减系数: 1, 医疗系数: 2, 腐败系数: 0.17,
            biome: (st.世界.设置 && st.世界.设置.biome) || '温带森林',
            季节: st.世界.季节 || '春',
        };
        if (ctx.biome === '热带雨林') ctx.腐败系数 = 0.5;
        if (ctx.biome === '冻原' || ctx.biome === '极地') { ctx.腐败系数 = 0.02; ctx.医疗系数 = 1.5; }
        if (ctx.季节 === '冬') ctx.衰减系数 = 1.15;

        var reports = [];
        var cols = listColonists(st);
        for (var i = 0; i < cols.length; i++) reports.push(settleColonist(cols[i].名, cols[i].数据, ctx));
        var rotten = settleRot(st, ctx);

        // 事件调度（在结算内触发一次，结果写事件记录）
        var ev = runEventTick(st, RW.engine);
        if (!st.事件记录) st.事件记录 = [];
        var 记录行 = '【' + (st.世界.季节 || '春') + st.世界.日 + '日·' + (st.世界.时段 || '上午') + '】' + (ev.摘要 || JSON.stringify(ev));
        st.事件记录.push(记录行);
        if (st.事件记录.length > 60) st.事件记录 = st.事件记录.slice(-60);

        // 研究推进（每半天：智识最高者×研究台×0.5 天）
        var RD = (st.研究 = st.研究 || { 已完成: '', 当前项目: '待选择', 进度: 0 });
        if (RD.当前项目 && RD.当前项目 !== '待选择') {
            var bestInt = 0;
            for (var cn in st) {
                var cd = st[cn];
                if (cd && typeof cd === 'object' && cd.技能 && cd.技能.智识) bestInt = Math.max(bestInt, cd.技能.智识.等级 || 0);
            }
            // 研究点/半天 = 0.8×(1+智识×5%)×0.5 天；进度按项目成本换算百分比（3000 点微电子确实比 300 点切石慢 10 倍）
            var ecoTab = (RW.economy && RW.economy.研究表) || null;
            var cost = (ecoTab && ecoTab[RD.当前项目] && ecoTab[RD.当前项目].成本) || 800;
            var speed = bestInt * 1.2 * 0.5; // 研究点/半天（智识12→7.2点，切石300点≈21游戏日，对齐原版节奏）
            RD.进度 = Math.min(100, (RD.进度 || 0) + speed / cost * 100);
            // 完成判定：进度按项目成本换算——简化：进度 100 即完成（成本差异体现在速度×难度系数，环经济.完成研究 校验前置）
            if (RD.进度 >= 100) {
                var eco = (HOST.Rimworld && HOST.Rimworld.economy) || HOST.环经济 || null;
                var doneList = (RD.已完成 || '').split('、').filter(Boolean);
                if (eco && typeof eco.完成研究 === 'function') {
                    var rr = eco.完成研究(doneList.join('、'), RD.当前项目, floorId || '?');
                    if (rr && rr.成功) {
                        var doneName = RD.当前项目;
                        RD.已完成 = rr.已完成研究;
                        RD.当前项目 = '待选择'; RD.进度 = 0;
                        if (st.事件记录) st.事件记录.push('【研究突破】' + doneName + ' 完成');
                        reports.push({ 名: '研究', 变化: ['研究突破：' + doneName + '，解锁：' + (rr.解锁 || []).join('、')] });
                    } else { RD.当前项目 = '待选择'; RD.进度 = 0; }
                } else {
                    doneList.push(RD.当前项目); RD.已完成 = doneList.join('、');
                    RD.当前项目 = '待选择'; RD.进度 = 0;
                }
            }
        }
        // ═══ 工单结算（地图派工：采矿/采集，每半天一结算，产出走环经济守恒流水账） ═══
        try {
            if (RW.economy && st.状态 && typeof st.状态.工单 === 'string' && st.状态.工单) {
                var orders = st.状态.工单.split('、').filter(function (s2) { return s2; });
                var remaining2 = [];
                for (var oi = 0; oi < orders.length; oi++) {
                    var pp = orders[oi].split('|');
                    if (pp.length < 5) continue;
                    var wType = pp[0], wPos = pp[1], wRes = pp[2], wProd = pp[3], wWho = pp[4];
                    var wPawn = st[wWho];
                    var wSkill = 0;
                    if (wPawn && wPawn.技能 && wPawn.技能[wType === '采矿' ? '采矿' : '种植']) wSkill = wPawn.技能[wType === '采矿' ? '采矿' : '种植'].等级 || 0;
                    // 产出（环经济真算+守恒流水账）
                    if (wType === '采矿') RW.economy.采矿(st.库存, wRes, wSkill, floorId || '?');
                    else RW.economy.采集(st.库存, wRes === '药草' ? '药草' : '浆果', wSkill, floorId || '?');
                    // 地图储量扣减（矿脉有限：守恒）
                    var depleted = false;
                    try {
                        var wxy = wPos.split(',');
                        var mt = RW.map && RW.map.tiles;
                        var cell = mt && mt[wxy[1]] && mt[wxy[1]][wxy[0]];
                        if (cell && cell.储量 != null) {
                            cell.储量 -= 1;
                            if (cell.储量 <= 0) { depleted = true; cell.矿脉 = null; cell.植物 = null; }
                        }
                    } catch (e2) {}
                    if (!depleted) remaining2.push(orders[oi]);
                    else if (st.事件记录) st.事件记录.push('【开采完成】' + wWho + ' 采完了 (' + wPos + ') 的' + wRes + '，' + wProd + ' 已全部入库');
                    reports.push({ 名: '工单', 变化: [wType + '·' + wWho + ' 在 (' + wPos + ') 采集' + wRes + ' → ' + wProd + ' 入库' + (depleted ? '（矿脉已枯竭，工单结束）' : '')] });
                }
                st.状态.工单 = remaining2.join('、');
            }
        } catch (eOrder) { try { console.error('[环结算] 工单结算异常:', eOrder && eOrder.message); } catch (e3) {} }
        // 守恒
        var cons = conservationCheck(RW.economy);
        if (!cons.OK && st.$流水账) st.$流水账.push({ 物品: '守恒警告', 数量: cons.明细.无来源增加.length, 方向: '减', 事由: '无来源增加缺陷', 楼层: floorId || '?' });

        // 动物生态自平衡
        var ecoWarn = animalEcoTick(st);
        if (ecoWarn) { st.事件记录.push('【生态】' + ecoWarn); }

        // 空间快照（给 AI 的语义摘要）
        var snap = '';
        try { snap = RW.map ? RW.map.snapshot() : ''; } catch (e) {}
        if (snap) st.$空间快照 = snap;

        // 摘要（给 toast / 日志）
        var lines = ['殖民者×' + cols.length + ' 状态已推进'];
        for (var r = 0; r < Math.min(reports.length, 3); r++) if (reports[r].变化.length) lines.push(reports[r].名 + ': ' + reports[r].变化.slice(0, 2).join('，'));
        if (rotten.length) lines.push('腐败: ' + rotten.slice(0, 2).join('，'));
        lines.push('事件: ' + 记录行.replace(/^【[^】]+】/, ''));
        lines.push('守恒: ' + (cons.OK ? '通过' : '缺陷!'));
        if (snap) lines.push('快照 ≈' + estimateTokens(snap) + ' tk');

        writeState(function () {}, '环结算·半天推进'); // mutator 已在原地改 st（同一引用），此处触发落库
        log('✅ 结算完成', lines.join(' | '));
        return { OK: true, 摘要: lines, 报告: reports, 事件: ev, 守恒: cons };
    }
    RW.settle = settleOnce;

    /* ═══════════════════ 6. 事件监听：变量更新结束→自动结算 ═══════════════════ */

    function bindEvents() {
        var eventOn = null;
        try { eventOn = window.eventOn || HOST.eventOn; } catch (e) {}
        if (typeof eventOn !== 'function') { log('事件接口不可用', '自动结算降级为手动'); return; }
        try {
            eventOn('variable_update_ended', function () {
                setTimeout(function () { var r = settleOnce(false); if (r.OK && HOST.Rimworld.terminal) { /* 终端自动刷新由 terminal 自理 */ } }, 800);
            });
            log('✅', '已监听 variable_update_ended（自动结算）');
        } catch (e) { log('监听失败', e.message); }
    }

    /* ═══════════════════ 7. 启动 ═══════════════════ */

    function boot() {
        bridge();
        bindEvents();
        // 对外 API 摘要
        RW.settleOnce = settleOnce;
        log('✅', '结算管线就绪（E2 状态机 + 事件调度 + 守恒检查 + 空间快照 + token 遥测）');
    }
    boot();
})();
