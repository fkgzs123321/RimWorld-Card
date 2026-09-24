/* * ==========================================================================
 * [环世界] 遗址探索 (Ruins Expedition) v1
 * 远行队到达遗址后的探索界面：
 *   - 遗址类型：古代废墟（物资/机械族残骸）/ 坠毁飞船（船体块/稀有件）/ 远古危险（虫茧/含毒陷阱）/ 巢穴
 *   - 探索推进：逐房间推进（每房间 E3 判定：搜刮/开锁/拆除）
 *   - 战利品表按类型，危险触发（虫群袭击/毒雾/敌对免疫者）进事件调度
 *   - 全程走守恒流水账
 * 全局 API：Rimworld.ruins.open()
 * ========================================================================== */
(function () {
    'use strict';

    var HOST = (function () { var w = window; try { while (w.parent && w.parent !== w) w = w.parent; } catch (e) {} return w; })();
    var RW = HOST.Rimworld = HOST.Rimworld || {};
    var document = HOST.document;
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    var style = document.createElement('style');
    style.id = 'rw-ruin-style';
    style.textContent = `
#rw-rn { position: fixed; inset: 0; background: rgba(8,10,14,.8); z-index: 100004; display: none; align-items: center; justify-content: center; }
#rw-rn.open { display: flex; }
.rw-rn2 { width: 820px; max-width: calc(100vw - 40px); height: 620px; max-height: calc(100vh - 50px);
  background: var(--rw-bg2, #1c232d); border: 2px solid #8a7a9a; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; }
.rw-rn2-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--rw-bg, #151a21); border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-rn2-head h2 { font-size: 15px; color: #b4a4d4; }
.rw-rn2-body { flex: 1; overflow-y: auto; padding: 16px; }
.rn-type-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 14px; }
.rn-type { background: var(--rw-panel, #202936); border: 2px solid var(--rw-border, #33404f); border-radius: 9px; padding: 12px; cursor: pointer; transition: border-color .2s; }
.rn-type:hover { border-color: #8a7a9a; }
.rn-type.sel { border-color: #b4a4d4; }
.rn-type h4 { font-size: 13px; color: #b4a4d4; }
.rn-type p { font-size: 10px; color: var(--rw-dim, #8496a8); margin-top: 4px; line-height: 1.6; }
.rn-room-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--rw-border, #33404f);
  border-radius: 7px; margin: 5px 0; font-size: 12px; }
.rn-room-row.done { opacity: .5; }
.rn-room-row .rm-name { flex: 1; }
.rn-log { background: var(--rw-bg, #151a21); border-radius: 8px; padding: 10px; margin-top: 12px; max-height: 180px; overflow-y: auto; font-size: 11px; line-height: 1.7; }
.rn-log div { padding: 2px 0; }
.rw-btn { padding: 6px 16px; border: 1px solid var(--rw-accent, #e8a33d); border-radius: 6px; background: transparent; color: var(--rw-accent, #e8a33d); cursor: pointer; font-size: 12px; }
.rw-btn.primary { background: var(--rw-accent, #e8a33d); color: var(--rw-bg, #151a21); font-weight: 700; }
.rw-btn:disabled { opacity: .35; cursor: not-allowed; }
`;
    document.head.appendChild(style);

    var RUIN_TYPES = {
        古代废墟: { 房间: 5, 危险率: 0.2, 战利品: [['白银', 120, 400], ['组件机件', 2, 6], ['零部件', 2, 8], ['高级医药', 1, 4]], 描述: '文明崩溃前的居所，货架可能还有存货，也可能住进了别的东西' },
        坠毁飞船: { 房间: 4, 危险率: 0.3, 战利品: [['船体块', 4, 10], ['零部件', 3, 9], ['白银', 200, 500], ['组件机件', 3, 7]], 描述: '坠毁的大型舰体，切割船体块需要时间，燃料管路可能泄漏' },
        远古危险: { 房间: 6, 危险率: 0.55, 战利品: [['白银', 300, 800], ['高级医药', 2, 6], ['archotech 神经增强体', 0, 1]], 描述: '封存着不该被唤醒的东西。高风险高回报，蜂蜜罐里可能是虫群' },
        虫群巢穴: { 房间: 4, 危险率: 0.7, 战利品: [['昆虫胶质', 20, 50], ['虫壳', 8, 20], ['白银', 100, 300]], 描述: '昆虫胶质是优质饲料与食物来源，但巢穴主人不同意' },
    };
    var EXP = { 类型: null, 房间索引: 0, 已开: [] };
    RW.ruins = EXP;

    function readState() {
        var m = (window.Mvu || HOST.Mvu);
        try {
            if (m && typeof m.getMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) return r.stat_data;
            }
        } catch (e) {}
        return null;
    }
    function writeState(mutator, reason) {
        var m = (window.Mvu || HOST.Mvu);
        try {
            if (m && typeof m.getMvuData === 'function' && typeof m.replaceMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) { mutator(r.stat_data); m.replaceMvuData(r, reason || '遗址探索'); return true; }
            }
        } catch (e) {}
        return false;
    }

    function ensurePanel() {
        var p = document.getElementById('rw-rn');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'rw-rn';
        p.innerHTML = '<div class="rw-rn2">' +
            '<div class="rw-rn2-head"><h2>🏚 遗址探索</h2><span style="font-size:10px;color:var(--rw-dim,#8496a8)">远行队到达遗址后使用；判定走环引擎 E3</span>' +
            '<span style="flex:1"></span><button class="rw-btn" id="rn-close">✕</button></div>' +
            '<div class="rw-rn2-body" id="rn-body"></div></div>';
        document.body.appendChild(p);
        /* 点遮罩关闭 */
        (function () { var el0 = document.getElementById('rw-rn'); if (el0) el0.addEventListener('click', function (e) { if (e.target === el0) el0.classList.remove('open'); }); })();
        p.querySelector('#rn-close').onclick = function () { p.classList.remove('open'); };
        p.addEventListener('click', function (e) { if (e.target === p) p.classList.remove('open'); });
        return p;
    }

    function render() {
        var box = document.getElementById('rn-body');
        if (!box) return;
        var st = readState() || {};
        var html = '';
        if (!EXP.类型) {
            html += '<div style="font-size:11px;color:var(--rw-dim,#8496a8);margin-bottom:10px">选择遗址类型（由远行队目的地与远见决定，随机事件也可能直接给）</div><div class="rn-type-grid">';
            for (var k in RUIN_TYPES) {
                var t = RUIN_TYPES[k];
                html += '<div class="rn-type" data-rt="' + k + '"><h4>🏚 ' + k + '（' + t.房间 + ' 房间）</h4><p>' + t.描述 + '<br><b style="color:var(--rw-warn,#e5c15f)">危险率 ' + Math.round(t.危险率 * 100) + '%</b></p></div>';
            }
            html += '</div>';
        } else {
            var def = RUIN_TYPES[EXP.类型];
            html += '<h3 style="font-size:14px;color:#b4a4d4">🏚 ' + EXP.类型 + '（已推进 ' + EXP.房间索引 + '/' + def.房间 + ' 房间）</h3>' +
                '<div style="font-size:11px;color:var(--rw-dim,#8496a8);margin-bottom:10px">' + def.描述 + ' · 探索者默认为小队全员（技能取平均，v2 接指派）</div>';
            if (EXP.房间索引 < def.房间) {
                html += '<div class="rn-room-row"><span class="rm-name">第 ' + (EXP.房间索引 + 1) + ' 间房间——未知</span>' +
                    '<button class="rw-btn primary" id="rn-explore">🔦 探索此房间（E3）</button></div>' +
                    '<button class="rw-btn" id="rn-retreat" style="margin-top:8px">🏃 见好就收（带战利品撤退）</button>';
            } else {
                html += '<div class="rn-room-row done"><span class="rm-name">全部房间已探索完毕</span></div>' +
                    '<button class="rw-btn" id="rn-retreat" style="margin-top:8px">🏃 撤退</button>';
            }
            html += '<div class="rn-log" id="rn-log">' + EXP.已开.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div>';
        }
        box.innerHTML = html;
        var types = box.querySelectorAll('[data-rt]');
        for (var i = 0; i < types.length; i++) {
            types[i].onclick = function () { EXP.类型 = this.getAttribute('data-rt'); EXP.房间索引 = 0; EXP.已开 = []; render(); };
        }
        var ex = box.querySelector('#rn-explore');
        if (ex) ex.onclick = function () { exploreRoom(st, def); };
        var rt = box.querySelector('#rn-retreat');
        if (rt) rt.onclick = function () {
            writeState(function (s) {
                if (!s.事件记录) s.事件记录 = [];
                s.事件记录.push('【遗址】从 ' + EXP.类型 + ' 撤退，共推进 ' + EXP.房间索引 + ' 间房间');
            }, '遗址撤退');
            EXP.类型 = null; EXP.房间索引 = 0; EXP.已开 = [];
            if (RW.toast) RW.toast('已撤退', 'good');
            render();
        };
    }

    function exploreRoom(st, def) {
        // E3 判定（真算走环引擎）
        var roll, tier;
        try {
            var eng = RW.engine;
            var avgSkill = avgExploreSkill(st);
            if (eng && typeof eng.判定 === 'function') {
                var r = eng.判定(st, { P: 40 + avgSkill * 3, R: 55, E: 0 });
                roll = r.S; tier = r.档位;
            } else {
                roll = 40 + avgSkill * 3; tier = roll >= 55 ? '成功' : '失败';
            }
        } catch (e) { roll = 50; tier = '成功'; }
        var logLines = ['【掷 ' + Math.round(roll) + ' · ' + tier + '】'];
        // 结算
        writeState(function (s) {
            var inv = s.库存 = s.库存 || { 物资: {}, 弹药: {}, 食物: {}, 药品: {} };
            var mult = tier === '大成功' ? 1.5 : tier === '成功' ? 1 : tier === '勉强' ? 0.6 : 0;
            if (mult > 0) {
                var loot = def.战利品[Math.floor(Math.random() * def.战利品.length)];
                var amount = Math.round((loot[1] + Math.random() * (loot[2] - loot[1])) * mult);
                if (amount > 0) {
                    var cat = loot[0] === '白银' ? '物资' : loot[0] === '高级医药' ? '药品' : '物资';
                    inv[cat] = inv[cat] || {};
                    inv[cat][loot[0]] = (inv[cat][loot[0]] || 0) + amount;
                    logLines.push('💰 搜获 ' + loot[0] + '×' + amount);
                    if (!s.$流水账) s.$流水账 = [];
                    s.$流水账.push({ 物品: loot[0], 数量: amount, 方向: '增', 事由: '遗址搜刮·' + EXP.类型, 楼层: '最新' });
                } else logLines.push('灰尘与空箱子，一无所获');
            } else logLines.push('翻箱倒柜半天，只找到废纸');
            // 危险触发
            if (Math.random() < def.危险率) {
                var dangers = { 古代废墟: ['塌方：一名探索者被埋（健康部位受损）', '机械族残骸激活！'], 坠毁飞船: ['燃料管路泄漏起火（火灾模拟 v2 接入）', '自动防御炮塔上线！'], 远古危险: ['虫茧破裂——虫群涌出！', '毒气室触发：全员中毒风险'], 虫群巢穴: ['巢穴主人回来了！巨型昆虫袭击！', '虫群倾巢而出！'] };
                var d = dangers[EXP.类型][Math.floor(Math.random() * 2)];
                logLines.push('⚠ 危险触发：' + d);
                if (!s.事件记录) s.事件记录 = [];
                s.事件记录.push('【遗址危险·' + EXP.类型 + '】' + d + '（进入事件调度权重池，威胁等级提高）');
            }
            if (!s.事件记录) s.事件记录 = [];
            s.事件记录.push('【遗址探索】' + EXP.类型 + ' 第 ' + (EXP.房间索引 + 1) + ' 间：' + logLines.join(' '));
        }, '遗址探索');
        EXP.房间索引++;
        EXP.已开 = EXP.已开.concat(logLines);
        render();
        if (RW.toast) RW.toast('房间探索完成', tier === '失败' ? 'bad' : 'good');
    }

    function avgExploreSkill(st) {
        var sum = 0, n = 0;
        var cols = ['薇卡', '凯奥', '小满'];
        for (var i = 0; i < cols.length; i++) {
            var p = st[cols[i]];
            if (p && p.技能) {
                var s = p.技能.采矿 || p.技能.研究 || { 等级: 5 };
                sum += typeof s === 'number' ? s : s.等级 || 5;
                n++;
            }
        }
        return n ? sum / n : 5;
    }

    EXP.open = function () {
        if (!readState()) { alert('[环世界] 状态未就绪：请先发送一条任意消息让系统初始化变量，再打开本面板。'); return; }
                try { if (HOST.Rimworld && HOST.Rimworld.closeAllPanels) HOST.Rimworld.closeAllPanels("rw-rn"); } catch (e) {}        ensurePanel().classList.add('open');
        render();
    };
    try { console.log('%c[环遗址] ✅ 已注册', 'color:#b4a4d4'); } catch (e) {}
})();
