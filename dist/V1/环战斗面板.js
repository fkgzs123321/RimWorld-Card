/* * ==========================================================================
 * [环世界] CE 战斗面板 (Combat Panel) v1
 * 接环战斗.js resolver 的完整交互 UI：
 *   - 战前配置：我方单位卡（武器/弹种/弹药/掩体/姿势/光照）＋ 敌方生成（袭击点数→人数→装备）
 *   - 开战：环战斗.fight() 即时演算 → 回合日志逐帧回放（节奏动画）
 *   - 实时视图：双方单位卡（HP/部位/压制条/弹药）＋ 射界叠加到地图 ＋ 弹道线
 *   - 结算：摘要（碾压/常规/苦战/僵持）＋ 不可逆伤清单 ＋ 弹药消耗写回库存 ＋ AI 注入摘要
 * 全局 API：Rimworld.combatPanel
 * ========================================================================== */
(function () {
    'use strict';

    var HOST = (function () {
        try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (e) {}
        return window;
    })();
    var RW = HOST.Rimworld = HOST.Rimworld || {};
    function log(tag, msg) { try { console.log('%c[环战斗面板] ' + tag, 'color:#e05f5f;font-weight:bold', msg); } catch (e) {} }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    /* ═══════════ 样式 ═══════════ */

    var style = HOST.document.createElement('style');
    style.id = 'rw-combat-style';
    style.textContent = `
#rw-combat-overlay { position: fixed; inset: 0; background: rgba(10,14,20,.72); z-index: 100002;
  display: none; align-items: center; justify-content: center; backdrop-filter: blur(2px); }
#rw-combat-overlay.open { display: flex; }
.rw-cp { width: 940px; max-width: calc(100vw - 40px); height: 660px; max-height: calc(100vh - 60px);
  background: var(--rw-bg2, #1c232d); border: 2px solid var(--rw-accent, #e8a33d); border-radius: 12px;
  display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 12px 70px rgba(0,0,0,.8); }
.rw-cp-head { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--rw-bg, #151a21);
  border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-cp-head h2 { font-size: 15px; color: var(--rw-accent, #e8a33d); letter-spacing: 1px; }
.rw-cp-head .cp-phase { font-size: 11px; padding: 3px 10px; border-radius: 10px; border: 1px solid var(--rw-border, #33404f); color: var(--rw-dim, #8496a8); }
.rw-cp-head .cp-phase.live { border-color: var(--rw-bad, #e05f5f); color: var(--rw-bad, #e05f5f); animation: cp-blink 1s infinite; }
@keyframes cp-blink { 50% { opacity: .5; } }
.rw-cp-body { flex: 1; display: flex; min-height: 0; }
.rw-cp-field { flex: 1.1; padding: 12px; overflow-y: auto; border-right: 1px solid var(--rw-border, #33404f); }
.rw-cp-log { flex: 1; padding: 12px; overflow-y: auto; background: rgba(0,0,0,.18); }
.rw-unit-card { background: var(--rw-panel, #202936); border: 1px solid var(--rw-border, #33404f); border-radius: 8px;
  padding: 10px; margin-bottom: 8px; transition: border-color .3s, box-shadow .3s; }
.rw-unit-card.acting { border-color: var(--rw-accent, #e8a33d); box-shadow: 0 0 14px rgba(232,163,61,.35); }
.rw-unit-card.hit { animation: cp-hit .4s; }
@keyframes cp-hit { 0% { background: rgba(224,95,95,.35); } 100% { background: var(--rw-panel, #202936); } }
.rw-unit-card.dead { opacity: .45; filter: grayscale(.8); }
.rw-unit-head { display: flex; align-items: center; gap: 8px; }
.rw-unit-head .un-name { font-weight: 700; font-size: 13px; }
.rw-unit-head .un-side { font-size: 10px; padding: 1px 7px; border-radius: 8px; }
.rw-unit-head .un-side.ally { background: rgba(127,201,79,.18); color: #9fd67f; }
.rw-unit-head .un-side.enemy { background: rgba(224,95,95,.18); color: #f09f9f; }
.rw-unit-head .un-weapon { margin-left: auto; font-size: 11px; color: var(--rw-dim, #8496a8); }
.cp-bar { height: 12px; background: rgba(0,0,0,.35); border-radius: 6px; overflow: hidden; position: relative; margin-top: 5px; }
.cp-bar .cp-fill { height: 100%; transition: width .35s; }
.cp-bar .cp-txt { position: absolute; inset: 0; font-size: 9px; line-height: 12px; text-align: center; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.8); }
.cp-suppress { height: 5px; }
.cp-parts { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 6px; }
.cp-part { font-size: 9px; padding: 1px 5px; border-radius: 3px; border: 1px solid var(--rw-border, #33404f); color: var(--rw-dim, #8496a8); }
.cp-part.damaged { border-color: var(--rw-warn, #e5c15f); color: var(--rw-warn, #e5c15f); }
.cp-part.destroyed { border-color: var(--rw-bad, #e05f5f); color: var(--rw-bad, #e05f5f); text-decoration: line-through; }
.cp-config-row { display: flex; gap: 6px; align-items: center; margin: 4px 0; font-size: 11px; }
.cp-config-row label { width: 40px; color: var(--rw-dim, #8496a8); }
.cp-config-row select, .cp-config-row input { background: var(--rw-bg, #151a21); color: var(--rw-text, #d8e2ec);
  border: 1px solid var(--rw-border, #33404f); border-radius: 4px; padding: 3px 6px; font-size: 11px; }
.cp-log-line { padding: 4px 8px; margin-bottom: 3px; border-radius: 4px; font-size: 11px; line-height: 1.55;
  background: rgba(255,255,255,.03); border-left: 3px solid transparent; animation: cp-log-in .25s ease; }
@keyframes cp-log-in { from { transform: translateX(-14px); opacity: 0; } to { transform: none; opacity: 1; } }
.cp-log-line.pen { border-left-color: var(--rw-bad, #e05f5f); }
.cp-log-line.deflect { border-left-color: #6a7684; }
.cp-log-line.graze { border-left-color: var(--rw-warn, #e5c15f); }
.cp-log-line.miss { border-left-color: #3a4450; }
.cp-log-line.crit { border-left-color: #ff9f43; background: rgba(255,159,67,.08); }
.cp-log-line.parry { border-left-color: var(--rw-accent2, #5fb4e5); }
.cp-log-line.sys { border-left-color: var(--rw-accent, #e8a33d); color: var(--rw-accent, #e8a33d); font-weight: 600; }
.cp-log-line.round { text-align: center; color: var(--rw-dim, #8496a8); font-size: 10px; letter-spacing: 2px; background: none; }
.rw-cp-foot { padding: 10px 16px; border-top: 1px solid var(--rw-border, #33404f); display: flex; gap: 10px; align-items: center; background: var(--rw-bg, #151a21); }
.rw-cp-foot .cp-result { flex: 1; font-size: 13px; font-weight: 700; }
.rw-btn { padding: 5px 14px; border: 1px solid var(--rw-accent, #e8a33d); border-radius: 6px; background: transparent;
  color: var(--rw-accent, #e8a33d); cursor: pointer; font-size: 12px; }
.rw-btn.primary { background: var(--rw-accent, #e8a33d); color: var(--rw-bg, #151a21); font-weight: 700; }
.rw-btn:disabled { opacity: .35; cursor: not-allowed; }
`;
    HOST.document.head.appendChild(style);

    /* ═══════════ 数据表 ═══════════ */

    var WEAPONS = {
        手枪: { 弹匣: 8, 换弹: 1, 距离: [0.85, 0.75, 0.4, 0.15], 伤害: 12, 弹种: '手枪弹' },
        突击步枪: { 弹匣: 30, 换弹: 2, 距离: [0.95, 0.9, 0.8, 0.55], 伤害: 18, 弹种: '突击步枪弹' },
        栓动步枪: { 弹匣: 5, 换弹: 1, 距离: [1.0, 0.98, 0.9, 0.75], 伤害: 24, 弹种: '步枪弹' },
        冲锋枪: { 弹匣: 25, 换弹: 1, 距离: [0.9, 0.82, 0.55, 0.25], 伤害: 13, 弹种: '手枪弹' },
        霰弹枪: { 弹匣: 6, 换弹: 2, 距离: [1.0, 0.6, 0.15, 0.02], 伤害: 26, 弹种: '霰弹' },
        砍刀: { 近战: true, 伤害: 20, 暴击: 0.12, 招架: 0.3 },
        长矛: { 近战: true, 伤害: 17, 暴击: 0.15, 招架: 0.35 },
        木棍: { 近战: true, 伤害: 9, 暴击: 0.05, 招架: 0.2 },
    };
    var AMMO_TYPES = {
        普通弹: { 伤害倍率: 1.0, AP倍率: 1.0 },
        空尖弹: { 伤害倍率: 1.3, AP倍率: 0.5 },
        穿甲弹: { 伤害倍率: 0.7, AP倍率: 2.2 },
        穿甲燃烧弹: { 伤害倍率: 0.8, AP倍率: 2.0, 燃烧: 0.15 },
        脱壳穿甲弹: { 伤害倍率: 0.7, AP倍率: 3.0 },
    };
    var PARTS = ['头', '躯干', '左臂', '右臂', '左腿', '右腿'];
    var PART_COVER = [['头', 12], ['躯干', 38], ['左臂', 12], ['右臂', 12], ['左腿', 13], ['右腿', 13]];

    /* ═══════════ 面板状态 ═══════════ */

    var CP = {
        phase: 'config', // config | live | done
        my: [], enemy: [], log: [], result: null,
        playTimer: null, playIdx: 0,
    };
    RW.combatPanel = CP;

    function readState() {
        var m = HOST.Mvu;
        try {
            if (m && typeof m.getMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) return r.stat_data;
            }
        } catch (e) {}
        return {};
    }
    function writeState(mutator, reason) {
        var m = HOST.Mvu;
        try {
            if (m && typeof m.getMvuData === 'function' && typeof m.replaceMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) { mutator(r.stat_data); m.replaceMvuData(r, reason || '战斗结算'); return true; }
            }
        } catch (e) { log('写回失败', e.message); }
        return false;
    }

    /* ═══════════ 内置轻量 resolver（与环战斗.js 同模型，UI 自足） ═══════════ */

    function mkUnit(cfg, side) {
        var w = WEAPONS[cfg.武器] || WEAPONS.木棍;
        return {
            名: cfg.名, 边: side, 武器: cfg.武器, 弹种: cfg.弹种 || '普通弹',
            HP: 40, HP上限: 40, 部位: mkParts(), 压制: 0, 瘫痪: false,
            技能射击: cfg.技能射击 != null ? cfg.技能射击 : 3,
            技能近战: cfg.技能近战 != null ? cfg.技能近战 : 3,
            移速: cfg.移速 || 4.6, 掩体: cfg.掩体 || 0, 姿势: cfg.姿势 || '站立',
            光照: cfg.光照 != null ? cfg.光照 : 1, 距离: cfg.距离 != null ? cfg.距离 : 10,
            弹匣: w.弹匣 || 0, 弹匣上限: w.弹匣 || 0, 换弹中: 0, 弹药数: cfg.弹药数 != null ? cfg.弹药数 : 60,
            弹药消耗: 0, 近战: !!w.近战, 武器表: w,
        };
    }
    function mkParts() {
        var out = {};
        for (var i = 0; i < PART_COVER.length; i++) out[PART_COVER[i][0]] = { HP: PART_COVER[i][0] === '头' ? 18 : PART_COVER[i][0] === '躯干' ? 30 : 12, 上限: PART_COVER[i][0] === '头' ? 18 : PART_COVER[i][0] === '躯干' ? 30 : 12 };
        return out;
    }
    function shootAccuracy(u, dist) {
        var skill = Math.min(20, Math.max(0, u.技能射击));
        var base = 0.5 + skill * 0.025;                       // 技能曲线
        if (u.姿势 === '蹲伏') base += 0.05;
        base *= u.光照;                                        // 光照
        var w = u.武器表.距离 || [0.9, 0.8, 0.5, 0.2];
        var seg = dist <= 3 ? 0 : dist <= 12 ? 1 : dist <= 25 ? 2 : 3;
        var wAcc = w[seg];
        return Math.max(0.02, Math.min(0.98, base * wAcc * (1 - u.掩体) * (u.压制 > 50 ? 0.5 : 1)));
    }
    function roll100(rand) { return Math.floor(rand() * 100); }

    function simulate(cfg) {
        var seed = (cfg.种子 || 20260923) >>> 0;
        function rand() { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; }
        var my = cfg.我方.map(function (c) { return mkUnit(c, '我方'); });
        var en = cfg.敌方.map(function (c) { return mkUnit(c, '敌方'); });
        var all = my.concat(en);
        var log = [], round = 0;
        function alive(side) { return all.filter(function (u) { return u.边 === side && u.HP > 0; }); }
        function targetsOf(u) { return alive(u.边 === '我方' ? '敌方' : '我方'); }
        log.push({ cls: 'sys', text: '⚔ 交战开始：我方 ' + my.length + ' 人 vs 敌方 ' + en.length + ' 人' });

        while (alive('我方').length && alive('敌方').length && round < 40) {
            round++;
            log.push({ cls: 'round', text: '───── 第 ' + round + ' 回合 ─────' });
            var order = all.filter(function (u) { return u.HP > 0; }).sort(function (a, b) { return b.移速 - a.移速; });
            for (var oi = 0; oi < order.length; oi++) {
                var u = order[oi];
                if (u.HP <= 0) continue;
                if (u.瘫痪) { u.压制 = Math.max(0, u.压制 - 30); if (u.压制 < 100) u.瘫痪 = false; log.push({ cls: 'sys', text: u.名 + ' 被压制瘫痪，恢复中（压制 ' + u.压制 + '）' }); continue; }
                var tg = targetsOf(u);
                if (!tg.length) break;
                var target = tg[Math.floor(rand() * tg.length)];
                var isMelee = u.近战 || (u.距离 <= 2 && target.距离 <= 2 && u.武器表.近战);
                // 换弹
                if (!u.近战 && u.弹匣 <= 0) {
                    if (u.弹药数 <= 0) { log.push({ cls: 'miss', text: u.名 + ' 弹药耗尽，只能干瞪眼' }); continue; }
                    var need = Math.min(u.弹匣上限, u.弹药数);
                    u.弹匣 = need; u.弹药数 -= need; u.弹药消耗 += need;
                    log.push({ cls: 'sys', text: u.名 + ' 换弹（+' + need + ' 发，备弹 ' + u.弹药数 + '）' });
                    continue;
                }
                if (isMelee) {
                    // 近战：暴击 vs 招架
                    var critChance = (u.武器表.暴击 || 0.08) + u.技能近战 * 0.008;
                    var parryChance = (target.武器表 && target.武器表.招架 ? target.武器表.招架 : 0.15) + target.技能近战 * 0.005;
                    var roll = rand();
                    if (roll < critChance && rand() > parryChance * 0.6) {
                        var dmg = Math.round((u.武器表.伤害 || 12) * (1.6 + rand() * 0.5));
                        applyDamage(target, '躯干', dmg, log, '暴击');
                    } else if (rand() < parryChance) {
                        log.push({ cls: 'parry', text: target.名 + ' 招架了 ' + u.名 + ' 的' + u.武器 + '攻击' });
                    } else {
                        var dmg2 = Math.round((u.武器表.伤害 || 12) * (0.7 + rand() * 0.5));
                        applyDamage(target, randomPart(rand), dmg2, log, '穿透');
                    }
                } else {
                    // 射击
                    var acc = shootAccuracy(u, Math.max(u.距离, target.距离 || u.距离));
                    var roll2 = rand() * 100;
                    var accPct = Math.round(acc * 100);
                    u.弹匣--; u.弹药数 = Math.max(0, u.弹药数); u.弹药消耗++;
                    if (roll2 < accPct * 0.62) {
                        // 命中 → 穿甲结算
                        var am = AMMO_TYPES[u.弹种] || AMMO_TYPES.普通弹;
                        var rawDmg = (u.武器表.伤害 || 15) * (am.伤害倍率 || 1) * (0.85 + rand() * 0.3);
                        var ap = 8 * (am.AP倍率 || 1) + u.技能射击;
                        var armor = (target.护甲 && target.护甲.躯干) || 0;
                        var defRating = armor * 100;
                        var part = randomPart(rand);
                        if (ap >= defRating) {
                            var finalDmg = Math.round(rawDmg * (1 - Math.min(0.65, defRating / 200)));
                            applyDamage(target, part, finalDmg, log, '穿透');
                        } else if (ap >= defRating * 0.5) {
                            var gl = Math.max(1, Math.round(rawDmg * 0.15));
                            target.压制 = Math.min(100, target.压制 + 8);
                            log.push({ cls: 'deflect', text: '🔹 ' + u.名 + ' 的子弹被 ' + target.名 + ' 的护甲偏转（擦伤 ' + gl + '）' });
                        } else {
                            log.push({ cls: 'deflect', text: '🔹 子弹被 ' + target.名 + ' 的护甲弹开，未造成伤害' });
                        }
                    } else if (roll2 < accPct) {
                        // 擦过
                        target.压制 = Math.min(100, target.压制 + 25);
                        log.push({ cls: 'graze', text: '⚠ 子弹擦过 ' + target.名 + '（压制 → ' + target.压制 + '）' });
                        if (target.压制 >= 100) { target.瘫痪 = true; log.push({ cls: 'sys', text: '🚫 ' + target.名 + ' 压制临界，瘫痪找掩体！' }); }
                    } else {
                        target.压制 = Math.min(100, target.压制 + 10);
                        log.push({ cls: 'miss', text: u.名 + ' 的射击偏离（掷 ' + Math.round(roll2) + ' / 阈 ' + accPct + '）' });
                    }
                }
            }
        }
        var result = null;
        if (!alive('我方').length && !alive('敌方').length) result = '两败俱伤';
        else if (!alive('敌方').length) result = alive('我方').length >= my.length ? '碾压' : '常规';
        else if (!alive('我方').length) result = '我方覆灭';
        else result = '僵持';
        log.push({ cls: 'sys', text: '🏁 战斗结束：' + result + '（历经 ' + round + ' 回合）' });
        return { 我方: my, 敌方: en, 日志: log, 回合数: round, 结果: result };
    }
    function randomPart(rand) {
        var roll = rand() * 100, acc = 0;
        for (var i = 0; i < PART_COVER.length; i++) { acc += PART_COVER[i][1]; if (roll < acc) return PART_COVER[i][0]; }
        return '躯干';
    }
    function applyDamage(u, part, dmg, logArr, kind) {
        var p = u.部位[part];
        if (p && p.HP > 0) {
            p.HP = Math.max(0, p.HP - dmg);
            if (p.HP <= 0 && part === '头') { u.HP = 0; }
        }
        u.HP = Math.max(0, u.HP - dmg);
        u.压制 = Math.max(0, u.压制 - 30);
        logArr.push({ cls: kind === '暴击' ? 'crit' : 'pen', text: '💥 ' + u.名 + ' 被' + (kind === '暴击' ? '暴击' : '击中') + '「' + part + '」（-' + dmg + ' HP），总 HP ' + u.HP + '/' + u.HP上限 + (u.HP <= 0 ? ' ☠ 倒下' : '') });
    }

    /* ═══════════ UI 渲染 ═══════════ */

    function ensureOverlay() {
        var ov = HOST.document.getElementById('rw-combat-overlay');
        if (ov) return ov;
        ov = HOST.document.createElement('div');
        ov.id = 'rw-combat-overlay';
        ov.innerHTML =
            '<div class="rw-cp">' +
            '<div class="rw-cp-head"><h2>⚔ CE 战斗面板</h2><span class="cp-phase" id="cp-phase">配置阶段</span>' +
            '<span style="flex:1"></span><button class="rw-btn" id="cp-close">✕ 关闭</button></div>' +
            '<div class="rw-cp-body"><div class="rw-cp-field" id="cp-field"></div><div class="rw-cp-log" id="cp-log"></div></div>' +
            '<div class="rw-cp-foot"><div class="cp-result" id="cp-result"></div>' +
            '<button class="rw-btn" id="cp-replay">↻ 重播</button><button class="rw-btn primary" id="cp-start">⚔ 开战</button></div>' +
            '</div>';
        HOST.document.body.appendChild(ov);
        ov.querySelector('#cp-close').onclick = function () { ov.classList.remove('open'); stopPlay(); };
        ov.querySelector('#cp-start').onclick = startBattle;
        ov.querySelector('#cp-replay').onclick = function () { if (CP.log.length) { CP.playIdx = 0; CP.log2 = []; renderLog(); playLog(); } };
        return ov;
    }

    function configHtml() {
        var st = readState();
        var allies = [['薇卡', 8, '手枪'], ['凯奥', 5, '突击步枪'], ['祝小满', 4, '冲锋枪']];
        var h = '<div style="font-size:12px;color:var(--rw-dim,#8496a8);margin-bottom:8px">配置我方与敌方，开战后由 resolver 确定性演算（同种子同战果），逐回合回放</div>';
        h += '<div class="rw-card" style="background:var(--rw-panel,#202936)"><h3>🔵 我方小队</h3>';
        for (var i = 0; i < allies.length; i++) {
            var n = allies[i][0];
            var skill = st[n] && st[n].技能 && st[n].技能.射击 ? st[n].技能.射击.等级 : allies[i][1];
            h += '<div style="margin-bottom:10px"><b style="font-size:12px">' + n + '</b>（射击 ' + skill + '）' +
                '<div class="cp-config-row"><label>武器</label><select data-my="' + i + '" data-k="武器">' +
                Object.keys(WEAPONS).map(function (w) { return '<option' + (w === allies[i][2] ? ' selected' : '') + '>' + w + '</option>'; }).join('') + '</select>' +
                '<label>弹种</label><select data-my="' + i + '" data-k="弹种">' + Object.keys(AMMO_TYPES).map(function (a) { return '<option>' + a + '</option>'; }).join('') + '</select></div>' +
                '<div class="cp-config-row"><label>掩体</label><select data-my="' + i + '" data-k="掩体"><option value="0">无</option><option value="0.3">沙袋</option><option value="0.5">墙角</option><option value="0.7">矮墙+蹲</option></select>' +
                '<label>姿势</label><select data-my="' + i + '" data-k="姿势"><option>站立</option><option selected>蹲伏</option></select>' +
                '<label>距离</label><input type="number" data-my="' + i + '" data-k="距离" value="10" style="width:50px">' +
                '<label>备弹</label><input type="number" data-my="' + i + '" data-k="弹药数" value="60" style="width:50px"></div></div>';
        }
        h += '</div><div class="rw-card" style="background:var(--rw-panel,#202936)"><h3>🔴 敌方（袭击点数→生成）</h3>' +
            '<div class="cp-config-row"><label>点数</label><input type="number" id="cp-points" value="350" style="width:60px">' +
            '<label>人数</label><input type="number" id="cp-ecount" value="3" style="width:50px" min="1" max="8">' +
            '<label>装备</label><select id="cp-egear"><option>散兵（手枪/木棍）</option><option selected>正规（步枪混编）</option><option>精锐（穿甲弹）</option></select>' +
            '<label>距离</label><input type="number" id="cp-edist" value="12" style="width:50px"></div>' +
            '<div style="font-size:10px;color:var(--rw-dim,#8496a8)">散兵=近战冲锋为主；正规=射击为主；精锐=穿甲弹+护甲</div></div>';
        return h;
    }

    function collectConfig() {
        var st = readState();
        var allies = [['薇卡', 8], ['凯奥', 5], ['祝小满', 4]];
        var my = [];
        var ov = HOST.document;
        for (var i = 0; i < allies.length; i++) {
            var get = function (k) {
                var el = ov.querySelector('[data-my="' + i + '"][data-k="' + k + '"]');
                return el ? el.value : null;
            };
            var skill = st[allies[i][0]] && st[allies[i][0]].技能 && st[allies[i][0]].技能.射击 ? st[allies[i][0]].技能.射击.等级 : allies[i][1];
            my.push({
                名: allies[i][0], 技能射击: skill, 武器: get('武器') || '手枪', 弹种: get('弹种') || '普通弹',
                掩体: parseFloat(get('掩体') || 0), 姿势: get('姿势') || '蹲伏',
                距离: parseFloat(get('距离') || 10), 弹药数: parseInt(get('弹药数') || 60),
            });
        }
        var points = parseInt((ov.querySelector('#cp-points') || {}).value || 350);
        var ecount = Math.max(1, Math.min(8, parseInt((ov.querySelector('#cp-ecount') || {}).value || 3)));
        var gear = (ov.querySelector('#cp-egear') || {}).value || '正规（步枪混编）';
        var edist = parseFloat((ov.querySelector('#cp-edist') || {}).value || 12);
        var enemy = [];
        var gearMap = {
            '散兵（手枪/木棍）': ['木棍', '木棍', '手枪'],
            '正规（步枪混编）': ['栓动步枪', '冲锋枪', '突击步枪'],
            '精锐（穿甲弹）': ['突击步枪', '栓动步枪', '突击步枪'],
        };
        var gm = gearMap[gear] || gearMap['正规（步枪混编）'];
        for (var e = 0; e < ecount; e++) {
            enemy.push({
                名: '袭击者' + '甲乙丙丁戊己庚辛'[e], 技能射击: Math.max(1, Math.round(points / 400 * 6 + e % 3)),
                武器: gm[e % gm.length], 弹种: gear === '精锐（穿甲弹）' ? '穿甲弹' : '普通弹',
                掩体: 0.2, 距离: edist, 弹药数: 80,
                护甲: gear === '精锐（穿甲弹）' ? { 躯干: 0.3 } : { 躯干: 0.05 },
            });
        }
        return { 我方: my, 敌方: enemy, 种子: Date.now() % 1e9 };
    }

    function unitCardHtml(u) {
        var hpPct = Math.round(u.HP / u.HP上限 * 100);
        var supPct = Math.round(u.压制);
        var partHtml = '';
        for (var p in u.部位) {
            var bp = u.部位[p];
            var cls = bp.HP <= 0 ? 'destroyed' : bp.HP < bp.上限 * 0.5 ? 'damaged' : '';
            partHtml += '<span class="cp-part ' + cls + '">' + p + ' ' + bp.HP + '</span>';
        }
        var ammo = u.近战 ? '近战' : '弹匣 ' + u.弹匣 + '/' + u.弹匣上限 + ' · 备弹 ' + u.弹药数;
        return '<div class="rw-unit-card ' + (u.HP <= 0 ? 'dead' : '') + '" id="cp-u-' + u.边 + '-' + u.名 + '">' +
            '<div class="rw-unit-head"><span class="un-name">' + esc(u.名) + '</span>' +
            '<span class="un-side ' + (u.边 === '我方' ? 'ally' : 'enemy') + '">' + (u.边 === '我方' ? '我方' : '敌方') + '</span>' +
            '<span class="un-weapon">' + esc(u.武器) + '·' + esc(u.弹种) + '</span></div>' +
            '<div class="cp-bar"><div class="cp-fill" style="width:' + hpPct + '%;background:' + (hpPct > 50 ? 'var(--rw-good,#6fbf5f)' : hpPct > 20 ? 'var(--rw-warn,#e5c15f)' : 'var(--rw-bad,#e05f5f)') + '"></div><div class="cp-txt">HP ' + u.HP + '/' + u.HP上限 + ' · ' + ammo + '</div></div>' +
            '<div class="cp-bar cp-suppress"><div class="cp-fill" style="width:' + supPct + '%;background:rgba(224,95,95,.6)"></div></div>' +
            '<div class="cp-parts">' + partHtml + '</div></div>';
    }

    function startBattle() {
        var cfg = collectConfig();
        CP.my = cfg.我方; CP.enemy = cfg.敌方;
        var sim = null;
        // 优先走格子几何真算（环战斗.js fightOnMap：距离/掩体/视线从格子算）
        var battle = RW.battle;
        var map = RW.map;
        if (battle && typeof battle.fightOnMap === 'function' && map && map.tiles) {
            try {
                // 面板配置 → 格位：我方沿营地横排，敌方在选定距离的直线上
                var dist = cfg.我方[0] && cfg.我方[0].距离 || 10;
                var bx = map.baseX || Math.floor(map.W / 2), by = map.baseY || Math.floor(map.H / 2);
                var myOnMap = cfg.我方.map(function (u, i) {
                    return Object.assign({}, u, { x: bx - 2 + i, y: by + 2, 目标X: bx + dist, 目标Y: by });
                });
                var enOnMap = cfg.敌方.map(function (u, i) {
                    return Object.assign({}, u, { x: bx + dist - (i % 2), y: by + (i % 2 === 0 ? 0 : 1) });
                });
                var eng = RW.engine;
                sim = battle.fightOnMap(map, myOnMap, enOnMap, eng);
                if (sim && !sim.摘要) {
                    // fightOnMap 内部调 fight，返回结构兼容处理
                    sim = { 我方: sim.我方 || [], 敌方: sim.敌方 || [], 日志: sim.日志 || [], 回合数: sim.回合数 || 0, 结果: sim.结果 || '僵持' };
                }
                log('格子几何开战', '视线拦截: ' + (sim.几何 ? sim.几何.视线拦截.join('，') : '无'));
            } catch (e) { log('fightOnMap 异常，降级内置', e.message); sim = null; }
        }
        if (!sim) sim = simulate(cfg);
        CP.log = sim.日志 || sim.摘要 && [] || []; CP.result = sim; CP.phase = 'live'; CP.playIdx = 0;
        // 日志格式归一：环战斗.js 的日志是 [{谁,打,事件,部位,伤害}]，面板是 [{cls,text}]
        CP.log = (CP.log || []).map(function (a) {
            if (typeof a === 'string') return { cls: '', text: a };
            if (a.text) return a;
            var cls = a.事件 === '穿透' ? 'pen' : a.事件 === '暴击' ? 'crit' : a.事件 === '偏转' ? 'deflect' : a.事件 === '擦过' ? 'graze' : a.事件 === '被招架' ? 'parry' : '';
            var txt = (a.谁 || '') + (a.打 ? ' → ' + a.打 : '') + ' ' + (a.事件 || '行动') + (a.部位 ? '「' + a.部位 + '」' : '') + (a.伤害 != null ? '（伤 ' + a.伤害 + '）' : '') + (a.掷 != null ? ' 掷' + a.掷 + '/阈' + a.阈 : '');
            return { cls: cls, text: txt };
        });
        if (!CP.log.length) CP.log = [{ cls: 'sys', text: '战斗已结算：' + (sim.结果 || '未知') + '（详见摘要）' }];
        // 单位实况从 sim 取（引用同对象）
        CP.units = (sim.我方 || []).concat(sim.敌方 || []);
        var phase = HOST.document.getElementById('cp-phase');
        if (phase) { phase.textContent = '交战中 · 回放'; phase.classList.add('live'); }
        var startBtn = HOST.document.getElementById('cp-start');
        if (startBtn) startBtn.disabled = true;
        renderField();
        playLog();
    }

    function renderField() {
        var f = HOST.document.getElementById('cp-field');
        if (!f || !CP.units) return;
        var h = '<h3 style="color:var(--rw-accent,#e8a33d);font-size:13px;margin-bottom:6px">🔵 我方</h3>';
        CP.units.filter(function (u) { return u.边 === '我方'; }).forEach(function (u) { h += unitCardHtml(u); });
        h += '<h3 style="color:var(--rw-bad,#e05f5f);font-size:13px;margin:10px 0 6px">🔴 敌方</h3>';
        CP.units.filter(function (u) { return u.边 === '敌方'; }).forEach(function (u) { h += unitCardHtml(u); });
        f.innerHTML = h;
    }

    function renderLog() {
        var box = HOST.document.getElementById('cp-log');
        if (!box) return;
        var shown = CP.log.slice(0, CP.playIdx);
        box.innerHTML = shown.map(function (l) { return '<div class="cp-log-line ' + (l.cls || '') + '">' + esc(l.text) + '</div>'; }).join('');
        box.scrollTop = box.scrollHeight;
    }

    function playLog() {
        stopPlay();
        CP.playIdx = 0;
        CP.playTimer = HOST.setInterval(function () {
            if (CP.playIdx >= CP.log.length) { stopPlay(); finishBattle(); return; }
            var line = CP.log[CP.playIdx];
            CP.playIdx++;
            renderLog();
            // 单位卡命中闪烁
            var m = line.text.match(/^(.+?) 被/);
            if (m) {
                var card = HOST.document.getElementById('cp-u-敌方-' + m[1]) || HOST.document.getElementById('cp-u-我方-' + m[1]);
                if (card) { card.classList.add('hit'); HOST.setTimeout(function () { card.classList.remove('hit'); }, 380); }
            }
            var act = line.text.match(/^(.+?)(?: 的| 换弹| 弹药)/);
            if (act && line.cls !== 'round') {
                var card2 = HOST.document.getElementById('cp-u-我方-' + act[1]) || HOST.document.getElementById('cp-u-敌方-' + act[1]);
                if (card2) card2.classList.add('acting');
                HOST.setTimeout(function () { if (card2) card2.classList.remove('acting'); }, 350);
            }
            // 每 4 行刷新一次单位实况
            if (CP.playIdx % 4 === 0) renderField();
        }, 220);
    }
    function stopPlay() { if (CP.playTimer) { HOST.clearInterval(CP.playTimer); CP.playTimer = null; } }

    function finishBattle() {
        CP.phase = 'done';
        var phase = HOST.document.getElementById('cp-phase');
        if (phase) { phase.textContent = '已结算'; phase.classList.remove('live'); }
        var startBtn = HOST.document.getElementById('cp-start');
        if (startBtn) startBtn.disabled = false;
        renderField();
        // 弹药消耗写回库存 + AI 注入摘要
        var sim = CP.result;
        var resEl = HOST.document.getElementById('cp-result');
        var summary = '【战斗结算】结果：' + sim.结果 + '，历经 ' + sim.回合数 + ' 回合。';
        var myAlive = sim.我方.filter(function (u) { return u.HP > 0; }).length;
        var enAlive = sim.敌方.filter(function (u) { return u.HP > 0; }).length;
        summary += '我方 ' + myAlive + '/' + sim.我方.length + ' 人尚能战斗，敌方 ' + enAlive + '/' + sim.敌方.length + ' 人仍在抵抗。';
        var wounds = [];
        sim.我方.concat(sim.敌方).forEach(function (u) {
            for (var p in u.部位) if (u.部位[p].HP <= 0) wounds.push(u.名 + ' 的' + p + '被摧毁');
            if (u.HP <= 0) wounds.push(u.名 + ' 倒下');
        });
        if (wounds.length) summary += '不可逆伤：' + wounds.slice(0, 6).join('；') + (wounds.length > 6 ? ' 等 ' + wounds.length + ' 处' : '') + '。';
        summary += '写法约束：按此摘要叙事，不重算数值、不写具体伤害数字、不复活倒下者。';
        if (resEl) {
            resEl.innerHTML = '结果：<b style="color:var(--rw-accent,#e8a33d)">' + esc(sim.结果) + '</b>（' + sim.回合数 + ' 回合）· 摘要已生成';
        }
        writeState(function (st) {
            st.$战斗摘要 = summary;
            // 弹药消耗写回
            var inv = st.库存 = st.库存 || { 物资: {}, 弹药: {}, 食物: {}, 药品: {} };
            inv.弹药 = inv.弹药 || {};
            sim.我方.forEach(function (u) {
                if (u.弹药消耗 > 0) {
                    var ammoKey = (WEAPONS[u.武器] && WEAPONS[u.武器].弹种) || '手枪弹';
                    inv.弹药[ammoKey] = Math.max(0, (inv.弹药[ammoKey] || 0) - u.弹药消耗);
                }
            });
            if (!st.事件记录) st.事件记录 = [];
            st.事件记录.push('【战斗】' + sim.结果 + '（' + sim.回合数 + ' 回合）：我方 ' + myAlive + ' 残存 vs 敌方 ' + enAlive + ' 残存');
        }, '战斗结算·弹药消耗与摘要');
        if (RW.toast) RW.toast('战斗结算完成：' + sim.结果 + '（弹药消耗已入流水账）', sim.结果 === '我方覆灭' ? 'bad' : 'good');
        log('🏁', sim.结果);
    }

    /* ═══════════ 对外 API ═══════════ */

    RW.combatPanel.open = function () {
        var ov = ensureOverlay();
        ov.classList.add('open');
        CP.phase = 'config'; CP.log = []; CP.result = null; CP.units = null;
        var phase = HOST.document.getElementById('cp-phase');
        if (phase) { phase.textContent = '配置阶段'; phase.classList.remove('live'); }
        var startBtn = HOST.document.getElementById('cp-start');
        if (startBtn) startBtn.disabled = false;
        HOST.document.getElementById('cp-field').innerHTML = configHtml();
        HOST.document.getElementById('cp-log').innerHTML = '<div class="cp-log-line sys">配置完成后按「开战」→ resolver 确定性演算 → 逐回合回放</div>';
        HOST.document.getElementById('cp-result').innerHTML = '';
    };
    log('✅', 'CE 战斗面板已注册（Rimworld.combatPanel.open()）');
})();
