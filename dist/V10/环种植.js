/* * ==========================================================================
 * [环世界] 种植系统 (Farming) v1
 * 种植规划：地块（地图草地/肥沃草地）→ 作物选择（生长周期/营养/温度窗口）
 *   → 指派种植者（种植技能→生长速度修正）→ 生长度模拟（光照×肥力×温度 累计）
 *   → 成熟收获（接环经济.收获，产量=基准×(1+技能×3%)）
 * 全局 API：Rimworld.farm.open()
 * ========================================================================== */
(function () {
    'use strict';

    var HOST = (function () { var w = window; try { while (w.parent && w.parent !== w) w = w.parent; } catch (e) {} return w; })();
    var RW = HOST.Rimworld = HOST.Rimworld || {};
    var document = HOST.document;
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    var style = document.createElement('style');
    style.id = 'rw-farm-style';
    style.textContent = `
#rw-farm { position: fixed; inset: 0; background: rgba(8,10,14,.78); z-index: 100004; display: none; align-items: center; justify-content: center; }
#rw-farm.open { display: flex; }
.rw-fm { width: 900px; max-width: calc(100vw - 40px); height: 640px; max-height: calc(100vh - 50px);
  background: var(--rw-bg2, #1c232d); border: 2px solid var(--rw-good, #6fbf5f); border-radius: 12px;
  display: flex; flex-direction: column; overflow: hidden; }
.rw-fm-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--rw-bg, #151a21); border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-fm-head h2 { font-size: 15px; color: var(--rw-good, #6fbf5f); }
.rw-fm-body { flex: 1; display: flex; min-height: 0; }
.fm-left { width: 320px; border-right: 1px solid var(--rw-border, #33404f); overflow-y: auto; padding: 12px; }
.fm-right { flex: 1; overflow-y: auto; padding: 14px; }
.fm-plot { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid var(--rw-border, #33404f);
  border-radius: 7px; margin: 5px 0; font-size: 12px; cursor: pointer; }
.fm-plot:hover { border-color: var(--rw-good, #6fbf5f); }
.fm-plot.sel { border-color: var(--rw-good, #6fbf5f); background: rgba(111,191,95,.07); }
.fm-plot .pl-pos { font-weight: 700; min-width: 52px; }
.fm-plot .pl-soil { color: var(--rw-dim, #8496a8); font-size: 10px; }
.fm-plot .pl-growth { margin-left: auto; }
.fm-crop-card { background: var(--rw-panel, #202936); border: 1px solid var(--rw-border, #33404f); border-radius: 8px;
  padding: 10px; margin: 6px 0; cursor: pointer; font-size: 12px; }
.fm-crop-card:hover { border-color: var(--rw-good, #6fbf5f); }
.fm-crop-card.sel { border-color: var(--rw-good, #6fbf5f); background: rgba(111,191,95,.07); }
.fm-crop-card .cr-name { font-weight: 700; }
.fm-crop-card .cr-meta { font-size: 10px; color: var(--rw-dim, #8496a8); margin-top: 3px; line-height: 1.6; }
.fm-growth-bar { height: 14px; background: rgba(0,0,0,.3); border-radius: 7px; overflow: hidden; position: relative; margin-top: 4px; }
.fm-growth-bar i { display: block; height: 100%; background: linear-gradient(90deg, #6fbf5f, #a8d45f); }
.fm-growth-bar span { position: absolute; inset: 0; font-size: 9px; text-align: center; line-height: 14px; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.7); }
.rw-btn { padding: 6px 16px; border: 1px solid var(--rw-accent, #e8a33d); border-radius: 6px; background: transparent; color: var(--rw-accent, #e8a33d); cursor: pointer; font-size: 12px; }
.rw-btn.primary { background: var(--rw-accent, #e8a33d); color: var(--rw-bg, #151a21); font-weight: 700; }
.rw-btn:disabled { opacity: .35; cursor: not-allowed; }
`;
    document.head.appendChild(style);

    /* ═══════════ 作物表（原版锚定） ═══════════ */

    var CROPS = {
        水稻: { 生长周期: 3, 营养: 0.05, 收获: '稻米×6', 温度窗: [10, 42], 肥力需求: '中', 说明: '生长最快的主粮，肥沃草地首选' },
        土豆: { 生长周期: 5.5, 营养: 0.09, 收获: '土豆×11', 温度窗: [4, 35], 肥力需求: '低', 说明: '耐瘠耐寒，低肥力地块最稳' },
        玉米: { 生长周期: 11.3, 营养: 0.21, 收获: '玉米×22', 温度窗: [10, 42], 肥力需求: '中', 说明: '单位劳动营养最高，但生长期长——生长季短的 biome 别种' },
        药草: { 生长周期: 8, 营养: 0, 收获: '草药医药×8', 温度窗: [0, 45], 肥力需求: '低', 说明: '医疗线根基，早期必种' },
        棉花: { 生长周期: 7.3, 营养: 0, 收获: '布×6', 温度窗: [10, 42], 肥力需求: '中', 说明: '服装线原料（布艺研究后可制衣）' },
        烟叶: { 生长周期: 8.1, 营养: 0, 收获: '烟叶×10', 温度窗: [10, 42], 肥力需求: '中', 说明: '卷烟原料（药物实验台配方），心情品' },
    };

    var farmState = { selPlot: null, selCrop: null, worker: null };
    RW.farm = farmState;

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
                if (r && r.stat_data) { mutator(r.stat_data); m.replaceMvuData(r, reason || '种植结算'); return true; }
            }
        } catch (e) {}
        return false;
    }

    function plots(st) {
        // 田块：状态里存 种植.地块 数组，空则从地图草地推荐
        if (st.种植 && st.种植.地块 && st.种植.地块.length) return st.种植.地块;
        var out = [];
        var map = RW.map;
        if (map && map.tiles) {
            var n = 0;
            for (var y = 0; y < map.H && n < 6; y++) for (var x = 0; x < map.W && n < 6; x++) {
                var t = map.tiles[y][x];
                if ((t.地形 === '肥沃草地' || t.地形 === '草地') && !t.建筑 && !t.矿脉) {
                    var dist = Math.hypot(x - (map.baseX || map.W / 2), y - (map.baseY || map.H / 2));
                    if (dist < 12) {
                        out.push({ x: x, y: y, 肥力: t.地形 === '肥沃草地' ? 1.1 : 0.8, 作物: null, 生长度: 0, pos: '(' + x + ',' + y + ')' });
                        n++;
                    }
                }
            }
        }
        if (!out.length) {
            for (var i = 0; i < 4; i++) out.push({ x: i, y: 0, 肥力: 0.9, 作物: null, 生长度: 0, pos: '地块' + (i + 1) });
        }
        return out;
    }

    /* ═══════════ 面板 ═══════════ */

    function ensurePanel() {
        var p = document.getElementById('rw-farm');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'rw-farm';
        p.innerHTML = '<div class="rw-fm">' +
            '<div class="rw-fm-head"><h2>🌾 种植规划</h2><span style="font-size:10px;color:var(--rw-dim,#8496a8)">生长度 = 光照×肥力×温度窗口，每半天结算</span>' +
            '<span style="flex:1"></span><button class="rw-btn" id="fm-close">✕</button></div>' +
            '<div class="rw-fm-body"><div class="fm-left" id="fm-plots"></div><div class="fm-right" id="fm-detail"></div></div></div>';
        document.body.appendChild(p);
        /* 点遮罩关闭 */
        (function () { var el0 = document.getElementById('rw-farm'); if (el0) el0.addEventListener('click', function (e) { if (e.target === el0) el0.classList.remove('open'); }); })();
        p.querySelector('#fm-close').onclick = function () { p.classList.remove('open'); };
        p.addEventListener('click', function (e) { if (e.target === p) p.classList.remove('open'); });
        return p;
    }

    function renderAll() {
        var st = readState() || {};
        renderPlots(st);
        renderDetail(st);
    }

    function renderPlots(st) {
        var box = document.getElementById('fm-plots');
        if (!box) return;
        var ps = plots(st);
        var html = '<h3 style="font-size:13px;color:var(--rw-good,#6fbf5f)">🟩 田块（点击选中）</h3>';
        for (var i = 0; i < ps.length; i++) {
            var pl = ps[i];
            var pct = Math.round((pl.生长度 || 0) * 100);
            html += '<div class="fm-plot ' + (farmState.selPlot === i ? 'sel' : '') + '" data-plot="' + i + '">' +
                '<span class="pl-pos">' + esc(pl.pos) + '</span>' +
                '<span class="pl-soil">' + esc(pl.作物 || '荒地') + ' · 肥力' + Math.round(pl.肥力 * 100) + '%</span>' +
                '<span class="pl-growth">' + (pl.作物 ? pct + '%' : '') + '</span></div>';
        }
        html += '<div style="margin-top:10px"><button class="rw-btn primary" id="fm-tick">🌱 生长半天</button> ' +
            '<button class="rw-btn" id="fm-harvest">🧺 收获成熟</button></div>';
        box.innerHTML = html;
        var els = box.querySelectorAll('[data-plot]');
        for (var e = 0; e < els.length; e++) {
            els[e].onclick = function () { farmState.selPlot = parseInt(this.getAttribute('data-plot')); farmState.selCrop = null; renderAll(); };
        }
        box.querySelector('#fm-tick').onclick = function () { growTick(st); };
        box.querySelector('#fm-harvest').onclick = function () { harvestAll(st); };
    }

    function renderDetail(st) {
        var box = document.getElementById('fm-detail');
        if (!box) return;
        var ps = plots(st);
        var pl = ps[farmState.selPlot];
        if (!pl) { box.innerHTML = '<div class="rw-empty">← 选一个田块</div>'; return; }
        var html = '<h3 style="font-size:13px;color:var(--rw-good,#6fbf5f)">🌱 田块 ' + esc(pl.pos) + '（肥力 ' + Math.round(pl.肥力 * 100) + '%）</h3>';
        // 作物选择
        html += '<div style="font-size:11px;color:var(--rw-dim,#8496a8);margin:6px 0">选择作物：</div>';
        for (var k in CROPS) {
            var cr = CROPS[k];
            html += '<div class="fm-crop-card ' + (pl.作物 === k ? 'sel' : '') + '" data-crop="' + k + '"><div class="cr-name">' + k + '</div>' +
                '<div class="cr-meta">周期 ' + cr.生长周期 + ' 天 · ' + cr.收获 + ' · 温度窗 ' + cr.温度窗[0] + '~' + cr.温度窗[1] + '°<br>' + cr.说明 + '</div></div>';
        }
        // 当前种植状态
        if (pl.作物) {
            var pct = Math.round((pl.生长度 || 0) * 100);
            html += '<div style="margin-top:10px"><b>' + esc(pl.作物) + '</b> 生长进度</div>' +
                '<div class="fm-growth-bar"><i style="width:' + pct + '%"></i><span>' + pct + '%（成熟 100%）</span></div>';
        }
        box.innerHTML = html;
        var crops = box.querySelectorAll('[data-crop]');
        for (var c = 0; c < crops.length; c++) {
            crops[c].onclick = function () {
                var name = this.getAttribute('data-crop');
                writeState(function (s) {
                    if (!s.种植) s.种植 = { 地块: [] };
                    if (!s.种植.地块.length) s.种植.地块 = plots(s);
                    var target = s.种植.地块[farmState.selPlot];
                    if (target) { target.作物 = name; target.生长度 = 0; }
                }, '种植 ' + name);
                if (RW.toast) RW.toast('已种植：' + name, 'good');
                renderAll();
            };
        }
    }

    function growTick(st) {
        var ok = writeState(function (s) {
            if (!s.种植) s.种植 = { 地块: [] };
            var ps = s.种植.地块;
            var season = (s.世界 && s.世界.季节) || '春';
            var biome = (s.世界 && s.世界.设置 && s.世界.设置.biome) || '温带森林';
            for (var i = 0; i < ps.length; i++) {
                var pl = ps[i];
                if (!pl.作物 || pl.生长度 >= 1) continue;
                var cr = CROPS[pl.作物];
                if (!cr) continue;
                // 温度窗口外不生长（冬季地表作物全停）
                var temp = seasonTemp(season, biome);
                var inWindow = temp >= cr.温度窗[0] && temp <= cr.温度窗[1];
                var rate = inWindow ? (0.5 / cr.生长周期) * pl.肥力 : 0;
                if (season === '冬') rate = 0;
                pl.生长度 = Math.min(1, Math.round(((pl.生长度 || 0) + rate) * 1000) / 1000);
            }
        }, '种植生长半天');
        if (RW.toast) RW.toast(ok ? '作物生长推进（生长度=光照×肥力×温度）' : '写回失败', ok ? 'good' : 'bad');
        renderAll();
    }

    function seasonTemp(season, biome) {
        var base = { 温带森林: [12, 22, 9, -1], 沙漠: [22, 34, 20, 8], 冻原: [-6, 6, -4, -18], 热带雨林: [28, 30, 28, 26], 极地: [-20, -8, -22, -35], 灌木丛: [14, 24, 12, 0], 干草原: [12, 24, 10, -4], 海洋: [14, 24, 16, 6] }[biome] || [12, 22, 9, -1];
        return { 春: base[0], 夏: base[1], 秋: base[2], 冬: base[3] }[season] || 12;
    }
    RW.farmSeasonTemp = seasonTemp;

    function harvestAll(st) {
        var yieldLines = [];
        var ok = writeState(function (s) {
            if (!s.种植) s.种植 = { 地块: [] };
            var ps = s.种植.地块;
            var eco = RW.economy;
            for (var i = 0; i < ps.length; i++) {
                var pl = ps[i];
                if (!pl.作物 || pl.生长度 < 1) continue;
                var cr = CROPS[pl.作物];
                var mult = Math.round((1 + (st && 8) * 0.03) * 10) / 10; // 种植技能 8 假设，v2 接统一求值器
                if (eco && typeof eco.收获 === 'function') {
                    try { eco.收获(s.库存 || (s.库存 = { 物资: {}, 弹药: {}, 食物: {}, 药品: {} }), pl.作物, 8, RW.engine && RW.engine.判定, s); } catch (e) {}
                }
                // 直写收获物（与环经济.收获并行保险）
                var inv = s.库存 = s.库存 || { 物资: {}, 弹药: {}, 食物: {}, 药品: {} };
                var product = (cr.收获.split('×')[0]);
                var amount = Math.round(parseInt(cr.收获.split('×')[1]) * mult);
                inv.食物 = inv.食物 || {};
                var cat = product === '草药医药' ? '药品' : product === '布' ? '物资' : '食物';
                inv[cat] = inv[cat] || {};
                inv[cat][product] = (inv[cat][product] || 0) + amount;
                yieldLines.push(pl.pos + ' ' + pl.作物 + ' → ' + product + '×' + amount);
                if (!s.$流水账) s.$流水账 = [];
                s.$流水账.push({ 物品: product, 数量: amount, 方向: '增', 事由: '收获·' + pl.作物, 楼层: '最新' });
                pl.生长度 = 0;
            }
        }, '收获');
        if (RW.toast) RW.toast(ok && yieldLines.length ? '收获：' + yieldLines.join('，') : '没有成熟作物', yieldLines.length ? 'good' : 'warn');
        renderAll();
    }

    farmState.open = function () {
        if (!readState()) { alert('[环世界] 状态未就绪：请先发送一条任意消息让系统初始化变量，再打开本面板。'); return; }
                try { if (HOST.Rimworld && HOST.Rimworld.closeAllPanels) HOST.Rimworld.closeAllPanels("rw-farm"); } catch (e) {}        ensurePanel().classList.add('open');
        renderAll();
    };
    try { console.log('%c[环种植] ✅ 已注册', 'color:#6fbf5f'); } catch (e) {}
})();
