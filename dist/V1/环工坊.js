/* * ==========================================================================
 * [环世界] 工坊工具 (Workshop / GM Panel) v1
 * 对标轮回战场「数据编辑模式」，三功能：
 *   1. 数值编辑器：树状浏览 stat_data → 行内编辑 → Mvu.replaceMvuData 回写
 *   2. 事件触发器：手动注入事件（测试/剧情推进），走统一事件记录
 *   3. 时间控制：跳半天/跳天/直接设定日期与时段
 * 安全：GM 开关默认关，开启后才允许写操作（防误触污染存档）
 * 全局 API：Rimworld.workshop.open()
 * ========================================================================== */
(function () {
    'use strict';

    var HOST = (function () {
        try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (e) {}
        return window;
    })();
    var RW = HOST.Rimworld = HOST.Rimworld || {};
    var document = HOST.document;
    function log(tag, msg) { try { console.log('%c[环工坊] ' + tag, 'color:#b48fe8;font-weight:bold', msg); } catch (e) {} }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    var style = document.createElement('style');
    style.id = 'rw-workshop-style';
    style.textContent = `
#rw-workshop { position: fixed; inset: 0; background: rgba(8,10,14,.75); z-index: 100004; display: none; align-items: center; justify-content: center; }
#rw-workshop.open { display: flex; }
.rw-ws { width: 780px; max-width: calc(100vw - 40px); height: 620px; max-height: calc(100vh - 50px);
  background: var(--rw-bg2, #1c232d); border: 2px solid #b48fe8; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; }
.rw-ws-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--rw-bg, #151a21); border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-ws-head h2 { font-size: 15px; color: #b48fe8; letter-spacing: 1px; }
.rw-ws-gm { font-size: 11px; padding: 3px 10px; border-radius: 10px; border: 1px solid var(--rw-border, #33404f); color: var(--rw-dim, #8496a8); cursor: pointer; }
.rw-ws-gm.on { border-color: #b48fe8; color: #b48fe8; }
.rw-ws-tabs { display: flex; gap: 2px; padding: 6px 12px 0; background: var(--rw-bg, #151a21); }
.rw-ws-tab { padding: 7px 16px; border-radius: 7px 7px 0 0; cursor: pointer; font-size: 12px; color: var(--rw-dim, #8496a8); background: var(--rw-bg3, #242e3b); }
.rw-ws-tab.active { color: #b48fe8; background: var(--rw-bg2, #1c232d); font-weight: 600; }
.rw-ws-body { flex: 1; overflow-y: auto; padding: 14px; }
.rw-ws-body::-webkit-scrollbar { width: 8px; }
.rw-ws-body::-webkit-scrollbar-thumb { background: var(--rw-border, #33404f); border-radius: 4px; }
.ws-tree-item { margin-left: 0; padding: 3px 6px; border-radius: 4px; font-size: 12px; display: flex; align-items: center; gap: 6px; }
.ws-tree-item:hover { background: var(--rw-bg3, #242e3b); }
.ws-tree-item .tw-key { color: var(--rw-accent2, #5fb4e5); cursor: pointer; min-width: 90px; }
.ws-tree-item .tw-val { color: var(--rw-text, #d8e2ec); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-tree-item .tw-edit { font-size: 10px; border: 1px solid var(--rw-border, #33404f); background: transparent; color: var(--rw-dim, #8496a8); border-radius: 3px; padding: 1px 6px; cursor: pointer; }
.ws-tree-item .tw-edit:hover { color: #b48fe8; border-color: #b48fe8; }
.ws-tree-item.locked { opacity: .4; }
.ws-edit-inline { display: flex; gap: 6px; align-items: center; }
.ws-edit-inline input { flex: 1; background: var(--rw-bg, #151a21); color: var(--rw-text, #d8e2ec); border: 1px solid #b48fe8; border-radius: 4px; padding: 3px 8px; font-size: 11px; }
.ws-ev-card { background: var(--rw-panel, #202936); border: 1px solid var(--rw-border, #33404f); border-radius: 8px; padding: 10px; margin-bottom: 8px; display: flex; align-items: center; gap: 10px; font-size: 12px; }
.ws-ev-card .ev-name { flex: 1; }
.ws-ev-card .ev-meta { font-size: 10px; color: var(--rw-dim, #8496a8); }
.ws-time-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 12px; }
.ws-time-row input, .ws-time-row select { background: var(--rw-bg, #151a21); color: var(--rw-text, #d8e2ec); border: 1px solid var(--rw-border, #33404f); border-radius: 4px; padding: 4px 8px; font-size: 12px; }
`;
    document.head.appendChild(style);

    /* ═══════════ 状态 ═══════════ */

    var WS = { gm: false, tab: '数值编辑器', editPath: null };
    RW.workshop = WS;

    function readState() {
        var m = HOST.Mvu;
        try {
            if (m && typeof m.getMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) return r.stat_data;
            }
        } catch (e) {}
        return null;
    }
    function writeState(mutator, reason) {
        if (!WS.gm) return false;
        var m = HOST.Mvu;
        try {
            if (m && typeof m.getMvuData === 'function' && typeof m.replaceMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) { mutator(r.stat_data); m.replaceMvuData(r, reason || '工坊修改'); return true; }
            }
        } catch (e) { log('写回失败', e.message); }
        return false;
    }

    /* ═══════════ Tab 1：数值编辑器（树状浏览） ═══════════ */

    function renderEditor() {
        var st = readState();
        if (!st) return '<div class="rw-empty">状态未就绪</div>';
        var html = '<div style="font-size:11px;color:var(--rw-dim,#8496a8);margin-bottom:8px">点击键名展开/折叠，点「改」行内编辑（GM 开关开启时生效）。隐藏变量 $ 开头的同样可编辑。</div>' +
            '<div id="ws-tree">' + renderNode(st, '', 0) + '</div>';
        return html;
    }

    function renderNode(obj, path, depth) {
        if (depth > 4) return '';
        var html = '';
        var keys = Object.keys(obj || {});
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = obj[k];
            var childPath = path ? path + '.' + k : k;
            var isOpen = WS.editPath === childPath;
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                html += '<div class="ws-tree-item"><span class="tw-key" onclick="Rimworld.workshop.toggle(\'' + esc(childPath).replace(/'/g, "\\'") + '\')">▸ ' + esc(k) + '</span><span class="tw-val">{对象: ' + Object.keys(v).length + ' 键}</span></div>';
                if (isOpen !== false && depth < 2) html += '<div style="margin-left:22px;border-left:1px dashed var(--rw-border,#33404f)">' + renderNode(v, childPath, depth + 1) + '</div>';
            } else if (Array.isArray(v)) {
                html += '<div class="ws-tree-item"><span class="tw-key">▸ ' + esc(k) + '</span><span class="tw-val">[数组: ' + v.length + ' 项]</span></div>';
            } else {
                var editable = WS.gm;
                html += '<div class="ws-tree-item ' + (editable ? '' : 'locked') + '"><span class="tw-key">' + esc(k) + '</span>' +
                    '<span class="tw-val" id="twv-' + btoa(unescape(encodeURIComponent(childPath))).replace(/=/g, '') + '">' + esc(String(v)) + '</span>' +
                    (editable ? '<button class="tw-edit" onclick="Rimworld.workshop.edit(\'' + esc(childPath).replace(/'/g, "\\'") + '\')">改</button>' : '') + '</div>';
            }
        }
        return html;
    }

    WS.toggle = function (path) {
        // 简易折叠：再次渲染时跳过（v1 用展开为主，折叠留 v2）
        var box = document.getElementById('ws-tree');
        if (box) box.innerHTML = renderNode(readState() || {}, '', 0);
    };

    WS.edit = function (path) {
        var st = readState();
        var segs = path.split('.');
        var node = st;
        for (var i = 0; i < segs.length; i++) node = node ? node[segs[i]] : null;
        var el = document.querySelector('[onclick*="' + path.replace(/'/g, "\\'") + '"]');
        // 行内编辑：找到对应树项替换为输入框
        var items = document.querySelectorAll('.ws-tree-item');
        for (var j = 0; j < items.length; j++) {
            var keyEl = items[j].querySelector('.tw-key');
            if (keyEl && keyEl.textContent.trim() === segs[segs.length - 1]) {
                var valEl = items[j].querySelector('.tw-val');
                if (!valEl) continue;
                var old = valEl.textContent;
                valEl.innerHTML = '<span class="ws-edit-inline"><input id="ws-inline-input" value="' + esc(old) + '">' +
                    '<button class="tw-edit" id="ws-inline-ok">✔</button><button class="tw-edit" id="ws-inline-no">✖</button></span>';
                var input = document.getElementById('ws-inline-input');
                input.focus();
                document.getElementById('ws-inline-ok').onclick = function () {
                    var nv = input.value;
                    var parsed = nv === 'true' ? true : nv === 'false' ? false : (nv !== '' && !isNaN(Number(nv)) ? Number(nv) : nv);
                    var ok = writeState(function (s) {
                        var node2 = s;
                        for (var q = 0; q < segs.length - 1; q++) node2 = node2[segs[q]];
                        node2[segs[segs.length - 1]] = parsed;
                    }, '工坊编辑 ' + path);
                    if (HOST.Rimworld.toast) HOST.Rimworld.toast(ok ? path + ' → ' + nv : '写回失败（GM 未开启？）', ok ? 'good' : 'bad');
                    refreshEditor();
                };
                document.getElementById('ws-inline-no').onclick = function () { refreshEditor(); };
                break;
            }
        }
    };

    function refreshEditor() {
        var box = document.getElementById('ws-tree');
        if (box) box.innerHTML = renderNode(readState() || {}, '', 0);
    }

    /* ═══════════ Tab 2：事件触发器 ═══════════ */

    var TRIGGERABLE = [
        ['袭击（散兵 3 人）', '威胁', function (st) { return st.$战斗摘要 = '【事件注入】散兵袭击：3 名袭击者从地图边缘接近（手动触发）。请打开 CE 战斗面板应对。'; }],
        ['袭击（正规军 5 人）', '威胁', function (st) { return st.$战斗摘要 = '【事件注入】正规军袭击：5 人混编，含栓动步枪与冲锋枪（手动触发）。'; }],
        ['旅队到访', '中立', function (st) { if (!st.事件记录) st.事件记录 = []; return '旅队到访：一支 ' + [' ближ', '氏族', '邦联'][Math.floor(Math.random() * 3)] + ' 商队抵达，带来弹药物资与流浪者'; }],
        ['流浪者加入', '中立', function (st) { return '流浪者申请加入殖民地（按生成殖民者模板叙事到场）'; }],
        ['运输舱坠毁', '幸运', function (st) { return '运输舱坠毁在营地' + (Math.random() < 0.3 ? '附近，但救生舱信号异常——可能是陷阱' : '旁，内有物资'); }],
        ['疾病爆发', '威胁', function (st) {
            var cols = ['薇卡', '凯奥', '祝小满'].filter(function (n) { return st[n]; });
            var who = cols[Math.floor(Math.random() * cols.length)];
            if (who && st[who]) st[who].疾病 = { 名称: '瘟疫', 严重度: 20, 免疫: 0, 增速: 0.35 };
            return who + ' 感染了瘟疫（免疫-严重度竞速开始：休息好、营养足、医疗趋势正才能追上）';
        }],
        ['灵感触发', '幸运', function (st) {
            var cols = ['薇卡', '凯奥', '祝小满'].filter(function (n) { return st[n]; });
            var who = cols[Math.floor(Math.random() * cols.length)];
            if (who && st[who]) { if (!st[who].想法堆栈) st[who].想法堆栈 = []; st[who].想法堆栈.push({ 标签: '灵感：狂热创作', 修正: 12, 剩余: 6, 时长: 6 }); }
            return who + ' 获得灵感：狂热创作（心情 +12，持续 3 天）';
        }],
        ['寒潮', '环境', function (st) { st.世界.天气 = '雪'; return '寒潮来袭：温度骤降，注意低温伤害与作物冻死（环结算已按季节调整腐败与需求衰减）'; }],
        ['热浪', '环境', function (st) { st.世界.天气 = '晴'; return '热浪：食物腐败加速（腐败系数上调），户外活动风险上升'; }],
        ['短路风暴', '环境', function (st) { return '短路风暴接近：电池与电器有起火风险（火灾模拟 v2 批次接入）'; }],
    ];

    function renderEvents() {
        var html = '<div style="font-size:11px;color:var(--rw-dim,#8496a8);margin-bottom:8px">手动注入事件（测试/剧情推进）。注入后写进事件记录与对应变量，AI 下一楼即知。</div>';
        for (var i = 0; i < TRIGGERABLE.length; i++) {
            var ev = TRIGGERABLE[i];
            var cls = ev[1] === '威胁' ? 'danger' : ev[1] === '幸运' ? 'safe' : 'elite';
            html += '<div class="ws-ev-card"><span class="ev-name">' + esc(ev[0]) + ' <span class="ev-meta">[' + esc(ev[1]) + ']</span></span>' +
                '<button class="rw-btn" data-ev="' + i + '">注入</button></div>';
        }
        return html;
    }

    function bindEvents(box) {
        var btns = box.querySelectorAll('[data-ev]');
        for (var i = 0; i < btns.length; i++) {
            btns[i].onclick = function () {
                var idx = parseInt(this.getAttribute('data-ev'));
                var ev = TRIGGERABLE[idx];
                var ok = writeState(function (st) {
                    var msg = ev[2](st);
                    if (!st.事件记录) st.事件记录 = [];
                    st.事件记录.push('【事件注入·' + ev[0] + '】' + msg);
                }, '工坊注入事件 ' + ev[0]);
                if (HOST.Rimworld.toast) HOST.Rimworld.toast(ok ? '事件已注入：' + ev[0] : 'GM 未开启', ok ? 'warn' : 'bad');
            };
        }
    }

    /* ═══════════ Tab 3：时间控制 ═══════════ */

    function renderTime() {
        var st = readState() || {};
        var t = (st.世界 && (st.世界.时间 || st.世界)) || {};
        var html = '<div style="font-size:11px;color:var(--rw-dim,#8496a8);margin-bottom:8px">直接操作时间轴（GM 开关开启时生效）</div>' +
            '<div class="ws-time-row"><button class="rw-btn" id="ws-t-half">⏩ 跳半天</button><button class="rw-btn" id="ws-t-day">⏩⏩ 跳一整天</button></div>' +
            '<div class="ws-time-row"><label>年</label><input id="ws-y" type="number" value="' + (t.年 || 1) + '" style="width:56px">' +
            '<label>季</label><select id="ws-s">' + ['春', '夏', '秋', '冬'].map(function (s) { return '<option' + (t.季节 === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
            '<label>日</label><input id="ws-d" type="number" value="' + (t.日 || 1) + '" style="width:56px" min="1" max="15">' +
            '<label>时段</label><select id="ws-p"><option' + (t.时段 === '上午' ? ' selected' : '') + '>上午</option><option' + (t.时段 === '下午' ? ' selected' : '') + '>下午</option></select>' +
            '<button class="rw-btn" id="ws-t-set">设定</button></div>' +
            '<div style="font-size:10px;color:var(--rw-dim,#8496a8)">60 天 = 4 季 × 15 天；时间只由系统与面板推进，AI 无权改时间。</div>';
        return html;
    }

    function bindTime(box) {
        var half = box.querySelector('#ws-t-half');
        if (half) half.onclick = function () {
            var ok = writeState(function (st) {
                var eng = RW.engine;
                var t = st.世界;
                if (eng && typeof eng.推进半天 === 'function') { var nt = eng.推进半天(t); Object.assign(st.世界, nt); }
                else if (t.时段 === '上午') t.时段 = '下午';
                else { t.时段 = '上午'; t.日 = (t.日 || 1) + 1; }
            }, '工坊跳半天');
            if (HOST.Rimworld.toast) HOST.Rimworld.toast(ok ? '时间 +半天' : 'GM 未开启', ok ? 'good' : 'bad');
        };
        var day = box.querySelector('#ws-t-day');
        if (day) day.onclick = function () {
            var ok = writeState(function (st) {
                var t = st.世界;
                for (var i = 0; i < 2; i++) {
                    if (t.时段 === '上午') t.时段 = '下午';
                    else { t.时段 = '上午'; t.日 = (t.日 || 1) + 1; if (t.日 > 15) { t.日 = 1; t.季节 = { 春: '夏', 夏: '秋', 秋: '冬', 冬: '春' }[t.季节] || '春'; if (t.季节 === '春') t.年 = (t.年 || 1) + 1; } }
                }
            }, '工坊跳一天');
            if (HOST.Rimworld.toast) HOST.Rimworld.toast(ok ? '时间 +1 天' : 'GM 未开启', ok ? 'good' : 'bad');
        };
        var set = box.querySelector('#ws-t-set');
        if (set) set.onclick = function () {
            var y = parseInt((box.querySelector('#ws-y') || {}).value || 1);
            var s = (box.querySelector('#ws-s') || {}).value || '春';
            var d = Math.max(1, Math.min(15, parseInt((box.querySelector('#ws-d') || {}).value || 1)));
            var p = (box.querySelector('#ws-p') || {}).value || '上午';
            var ok = writeState(function (st) {
                st.世界.年 = y; st.世界.季节 = s; st.世界.日 = d; st.世界.时段 = p;
                st.世界.日计数 = ((y - 1) * 60) + ({ 春: 0, 夏: 15, 秋: 30, 冬: 45 }[s] || 0) + d;
            }, '工坊设定时间');
            if (HOST.Rimworld.toast) HOST.Rimworld.toast(ok ? '时间已设定：第' + y + '年' + s + '季' + d + '日·' + p : 'GM 未开启', ok ? 'good' : 'bad');
        };
    }

    /* ═══════════ 面板框架 ═══════════ */

    function ensurePanel() {
        var p = document.getElementById('rw-workshop');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'rw-workshop';
        p.innerHTML =
            '<div class="rw-ws">' +
            '<div class="rw-ws-head"><h2>🔧 环工坊</h2><span class="rw-ws-gm" id="ws-gm-switch">🔒 GM 关</span>' +
            '<span style="flex:1"></span><button class="rw-btn" id="ws-close">✕</button></div>' +
            '<div class="rw-ws-tabs" id="ws-tabs"></div><div class="rw-ws-body" id="ws-body"></div></div>';
        document.body.appendChild(p);
        p.querySelector('#ws-close').onclick = function () { p.classList.remove('open'); };
        p.querySelector('#ws-gm-switch').onclick = function () {
            WS.gm = !WS.gm;
            this.textContent = WS.gm ? '🔓 GM 开' : '🔒 GM 关';
            this.classList.toggle('on', WS.gm);
            if (HOST.Rimworld.toast) HOST.Rimworld.toast(WS.gm ? 'GM 模式开启：写操作解锁' : 'GM 模式关闭', WS.gm ? 'warn' : 'good');
            renderBody();
        };
        p.addEventListener('click', function (e) {
            if (e.target === p) p.classList.remove('open');
            var tb = e.target.closest('.rw-ws-tab');
            if (tb) { WS.tab = tb.getAttribute('data-tab'); renderBody(); }
        });
        return p;
    }

    function renderBody() {
        var box = document.getElementById('ws-body');
        var tabs = document.getElementById('ws-tabs');
        if (!box || !tabs) return;
        var tabNames = ['数值编辑器', '事件触发器', '时间控制', '模组设置'];
        tabs.innerHTML = tabNames.map(function (t) { return '<div class="rw-ws-tab ' + (WS.tab === t ? 'active' : '') + '" data-tab="' + t + '">' + t + '</div>'; }).join('');
        if (WS.tab === '数值编辑器') { box.innerHTML = renderEditor(); }
        else if (WS.tab === '事件触发器') { box.innerHTML = renderEvents(); bindEvents(box); }
        else if (WS.tab === '时间控制') { box.innerHTML = renderTime(); bindTime(box); }
        else if (WS.tab === '模组设置') { box.innerHTML = renderModSettings(); bindModSettings(box); }
    }

    /* ═══════════ Tab 4：模组设置（Mod Settings，同构 RimWorld 模组设置页） ═══════════ */

    var MOD_SETTINGS = [
        { 组: '难度乘数', 项: [
            { key: '难度.袭击点数乘数', label: '袭击点数', min: 0.1, max: 5, step: 0.1, dft: 1, 说明: '财富→袭击规模的换算倍率' },
            { key: '难度.敌人数量乘数', label: '敌人数量', min: 0.2, max: 4, step: 0.1, dft: 1, 说明: '同一波袭击的人数倍率' },
            { key: '难度.疾病间隔乘数', label: '疾病间隔', min: 0.2, max: 4, step: 0.1, dft: 1, 说明: '越小病越频繁' },
            { key: '难度.食物中毒乘数', label: '食物中毒', min: 0, max: 4, step: 0.1, dft: 1, 说明: '进食中毒概率倍率' },
            { key: '难度.野兽袭击乘数', label: '野兽袭击', min: 0, max: 4, step: 0.1, dft: 1, 说明: '狂暴动物事件权重' },
            { key: '难度.好感衰减乘数', label: '好感衰减', min: 0, max: 3, step: 0.1, dft: 1, 说明: '派系关系随时间自然下降速度' },
        ]},
        { 组: '讲述者参数', 项: [
            { key: '讲述者.节奏', label: '事件节奏', min: 0.3, max: 3, step: 0.1, dft: 1, 说明: '事件权重池的掷骰频率修正' },
            { key: '讲述者.随机性', label: '随机性', min: 0, max: 2, step: 0.1, dft: 1, 说明: '卡桑德拉有峰谷/兰迪纯随机，滑条再微调' },
        ]},
        { 组: '异象包（Anomaly）', 项: [
            { key: '模组.设置.异象.激活延迟', label: '激活延迟', min: 0, max: 15, step: 1, dft: 5, 说明: '开局第几天异象开始（天）' },
            { key: '模组.设置.异象.威胁循环频率', label: '威胁循环', min: 0.2, max: 3, step: 0.1, dft: 1, 说明: '实体事件出现频率' },
            { key: '模组.设置.异象.实体密度', label: '实体密度', min: 0.2, max: 3, step: 0.1, dft: 1, 说明: '单次实体事件数量' },
            { key: '模组.设置.异象.收容难度', label: '收容难度', min: 0.5, max: 3, step: 0.1, dft: 1, 说明: '收容期间逃逸概率倍率' },
        ]},,
        { 组: 'RJW 包', 项: [
            { key: '模组.设置.RJW.物种边界', label: '物种边界', min: 0, max: 1, step: 1, dft: 0, 说明: '0=关（默认）：动物只存在驯养关系；1=开：限成年人与已驯化大型动物，争议想法-8，未成年永久硬隔离不受此开关影响' },
        ]},
        { 组: '工坊包参数', 项: [
            { key: '模组.设置.工坊_装备强化.垫子保底阈值', label: '垫子保底', min: 3, max: 15, step: 1, dft: 10, 说明: '强化失败 N 次必成（四段式保底）' },
            { key: '模组.设置.工坊_炼金扩展.炸炉风险倍率', label: '炸炉风险', min: 0, max: 3, step: 0.1, dft: 1, 说明: '炼金小游戏炸炉概率倍率' },
            { key: '模组.设置.工坊_文风母猪.烈度', label: '文风烈度（母猪）', min: 1, max: 3, step: 1, dft: 2, 说明: '1=轻度 2=标准 3=极限（影响叙述指引措辞档）' },
        ]},
    ];

    function renderModSettings() {
        var st = readState() || {};
        var html = '<div style="font-size:11px;color:var(--rw-dim,#8496a8);margin-bottom:8px">每个已装模组/DLC 的设置段（同构 RimWorld Mod Settings），写入 模组.设置.<id>.*，事件调度器与公式实时读取。GM 开关开启时可写。</div>';
        for (var g = 0; g < MOD_SETTINGS.length; g++) {
            var grp = MOD_SETTINGS[g];
            html += '<div class="cx-card" style="margin-bottom:10px"><h4>⚙️ ' + esc(grp.组) + '</h4>';
            for (var i = 0; i < grp.项.length; i++) {
                var item = grp.项[i];
                var cur = getPathValue(st, item.key);
                var val = cur != null ? cur : item.dft;
                var pct = Math.round((val - item.min) / (item.max - item.min) * 100);
                html += '<div style="display:flex;align-items:center;gap:8px;margin:7px 0;font-size:11px">' +
                    '<span style="width:92px;color:var(--rw-dim,#8496a8)">' + esc(item.label) + '</span>' +
                    '<input type="range" min="' + item.min + '" max="' + item.max + '" step="' + item.step + '" value="' + val + '" data-key="' + esc(item.key) + '" style="flex:1;accent-color:#b48fe8' + '">' +
                    '<b style="width:44px;text-align:right" id="msv-' + i + '-' + g + '">' + val + '</b></div>' +
                    '<div style="font-size:10px;color:var(--rw-dim,#8496a8);margin-left:100px;margin-top:-4px">' + esc(item.说明) + '</div>';
            }
            html += '</div>';
        }
        html += '<div style="font-size:10px;color:var(--rw-dim,#8496a8)">拖动即写入（GM 开）或预览（GM 关）。所有滑条值经 Mvu.replaceMvuData 落库。</div>';
        return html;
    }
    function getPathValue(obj, path) {
        var segs = path.split('.');
        var cur = obj;
        for (var i = 0; i < segs.length; i++) { if (cur == null) return null; cur = cur[segs[i]]; }
        return cur;
    }
    function bindModSettings(box) {
        var sliders = box.querySelectorAll('input[type=range][data-key]');
        for (var i = 0; i < sliders.length; i++) {
            sliders[i].addEventListener('input', function () {
                var key = this.getAttribute('data-key');
                var val = parseFloat(this.value);
                // 更新显示
                var lbl = this.parentNode.querySelector('b');
                if (lbl) lbl.textContent = val;
                // 拖动结束才写（change 事件）
            });
            sliders[i].addEventListener('change', function () {
                var key = this.getAttribute('data-key');
                var val = parseFloat(this.value);
                var segs = key.split('.');
                var ok = writeState(function (s) {
                    var node = s;
                    for (var q = 0; q < segs.length - 1; q++) {
                        if (typeof node[segs[q]] !== 'object' || node[segs[q]] == null) node[segs[q]] = {};
                        node = node[segs[q]];
                    }
                    node[segs[segs.length - 1]] = val;
                }, '模组设置 ' + key + '=' + val);
                if (HOST.Rimworld.toast) HOST.Rimworld.toast(ok ? key + ' = ' + val : 'GM 未开启（只预览）', ok ? 'good' : 'warn');
            });
        }
    }

    WS.open = function () {
        ensurePanel().classList.add('open');
        renderBody();
    };
    log('✅', '工坊工具已注册（数值编辑器/事件触发器/时间控制，GM 开关防护）');
})();
