/* * ==========================================================================
 * [环世界] 远行队系统 (Caravan System) v1
 * 对应原版「组建远行队」：
 *   - 组队：多选殖民者（在途者不参与本地工作）
 *   - 装载：物资与数量，负重上限 = Σ(50 + 载重修正×3)，超重不可出发
 *   - 路线：目的地取自地图选中瓦片（接环地图），路程 = 格数 × 地形系数
 *   - 出发/在途/到达：写进 状态.远行队，到达触发探索事件（采掘/遗址/遭遇）
 * 全局 API：Rimworld.caravan.open()
 * ========================================================================== */
(function () {
    'use strict';

    var HOST = (function () {
        try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (e) {}
        return window;
    })();
    var RW = HOST.Rimworld = HOST.Rimworld || {};
    var document = HOST.document;
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    var style = document.createElement('style');
    style.id = 'rw-caravan-style';
    style.textContent = `
#rw-cv { position: fixed; inset: 0; background: rgba(8,10,14,.78); z-index: 100004; display: none; align-items: center; justify-content: center; }
#rw-cv.open { display: flex; }
.rw-cvn { width: 860px; max-width: calc(100vw - 40px); height: 640px; max-height: calc(100vh - 50px);
  background: var(--rw-bg2, #1c232d); border: 2px solid var(--rw-accent2, #5fb4e5); border-radius: 12px;
  display: flex; flex-direction: column; overflow: hidden; }
.rw-cvn-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--rw-bg, #151a21); border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-cvn-head h2 { font-size: 15px; color: var(--rw-accent2, #5fb4e5); }
.rw-cvn-body { flex: 1; display: flex; min-height: 0; }
.cv-col { flex: 1; padding: 14px; overflow-y: auto; border-right: 1px solid var(--rw-border, #33404f); }
.cv-col:last-child { border-right: none; }
.cv-col h3 { color: var(--rw-accent2, #5fb4e5); font-size: 13px; margin-bottom: 8px; }
.cv-member { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid var(--rw-border, #33404f);
  border-radius: 7px; margin: 5px 0; cursor: pointer; font-size: 12px; }
.cv-member.sel { border-color: var(--rw-accent, #e8a33d); background: rgba(232,163,61,.06); }
.cv-member .mv-skills { margin-left: auto; font-size: 10px; color: var(--rw-dim, #8496a8); }
.cv-load-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; font-size: 11px; }
.cv-load-row input { width: 62px; background: var(--rw-bg, #151a21); color: var(--rw-text, #d8e2ec); border: 1px solid var(--rw-border, #33404f); border-radius: 4px; padding: 3px 6px; }
.cv-load-row .ld-name { flex: 1; }
.cv-weight { font-size: 12px; padding: 8px 10px; border-radius: 7px; background: var(--rw-bg, #151a21); margin-top: 8px; }
.cv-weight.over { color: var(--rw-bad, #e05f5f); font-weight: 700; }
.rw-btn { padding: 6px 16px; border: 1px solid var(--rw-accent, #e8a33d); border-radius: 6px; background: transparent; color: var(--rw-accent, #e8a33d); cursor: pointer; font-size: 12px; }
.rw-btn.primary { background: var(--rw-accent, #e8a33d); color: var(--rw-bg, #151a21); font-weight: 700; }
.rw-btn:disabled { opacity: .35; cursor: not-allowed; }
.cv-dest { font-size: 12px; padding: 10px; border: 1px dashed var(--rw-border, #33404f); border-radius: 7px; margin-top: 8px; }
.cv-active { background: var(--rw-panel, #202936); border: 1px solid var(--rw-accent2, #5fb4e5); border-radius: 8px; padding: 10px; margin-top: 8px; font-size: 12px; }
`;
    document.head.appendChild(style);

    var CV = { 成员: [], 装载: {}, 目的地: null };
    RW.caravan = CV;

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
        var m = HOST.Mvu;
        try {
            if (m && typeof m.getMvuData === 'function' && typeof m.replaceMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) { mutator(r.stat_data); m.replaceMvuData(r, reason || '远行队'); return true; }
            }
        } catch (e) {}
        return false;
    }

    var TERRAIN_COST = { 草地: 1, 肥沃草地: 1, 泥地: 1.3, 沙地: 1.4, 石岩: 1.8, 河水: 2.5, 雪地: 1.6, 灰烬: 1.2 };

    function weight(st) {
        var w = 0;
        for (var k in CV.装载) w += (Number(CV.装载[k]) || 0);
        for (var m = 0; m < CV.成员.length; m++) {
            var p = st[CV.成员[m]];
            if (p && p.健康 && p.健康.躯干) w += 20; // 人本身负重计入简单模型
        }
        return Math.round(w);
    }
    function capacity(st) {
        var cap = 0;
        for (var m = 0; m < CV.成员.length; m++) {
            var p = st[CV.成员[m]];
            var lv = p && p.技能 && p.技能.采矿 ? (typeof p.技能.采矿 === 'number' ? p.技能.采矿 : p.技能.采矿.等级 || 0) : 5;
            cap += 50 + lv * 2;
        }
        return cap;
    }
    function routeCost() {
        if (!CV.目的地 || !RW.map || !RW.map.tiles) return null;
        var t = RW.map.tiles[CV.目的地.y] && RW.map.tiles[CV.目的地.y][CV.目的地.x];
        if (!t) return null;
        var base = Math.round(Math.hypot(CV.目的地.x - (RW.map.baseX || RW.map.W / 2), CV.目的地.y - (RW.map.baseY || RW.map.H / 2)));
        var cost = TERRAIN_COST[t.地形] || 1;
        var days = Math.max(0.5, Math.round(base * cost / 12 * 2) / 2);
        return { 距离: base, 地形系数: cost, 预计天数: days, 目的地地形: t.地形 };
    }

    function ensurePanel() {
        var p = document.getElementById('rw-cv');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'rw-cv';
        p.innerHTML = '<div class="rw-cvn">' +
            '<div class="rw-cvn-head"><h2>🐴 远行队</h2><span style="font-size:10px;color:var(--rw-dim,#8496a8)">在途者不参与本地工作；到达触发探索事件</span>' +
            '<span style="flex:1"></span><button class="rw-btn" id="cv-close">✕</button></div>' +
            '<div class="rw-cvn-body"><div class="cv-col" id="cv-members"></div>' +
            '<div class="cv-col" id="cv-load"></div>' +
            '<div class="cv-col" id="cv-route"></div></div></div>';
        document.body.appendChild(p);
        /* 点遮罩关闭 */
        (function () { var el0 = document.getElementById('rw-cv'); if (el0) el0.addEventListener('click', function (e) { if (e.target === el0) el0.classList.remove('open'); }); })();
        p.querySelector('#cv-close').onclick = function () { p.classList.remove('open'); };
        p.addEventListener('click', function (e) { if (e.target === p) p.classList.remove('open'); });
        return p;
    }

    function renderAll() {
        var st = readState() || {};
        renderMembers(st);
        renderLoad(st);
        renderRoute(st);
    }

    function renderMembers(st) {
        var box = document.getElementById('cv-members');
        if (!box) return;
        var html = '<h3>👥 成员（点击选/撤）</h3>';
        var cols = ['薇卡', '凯奥', '祝小满'];
        for (var i = 0; i < cols.length; i++) {
            var p = st[cols[i]];
            var sel = CV.成员.indexOf(cols[i]) >= 0;
            var sk = p && p.技能 || {};
            function lv(name) { var s = sk[name]; return s ? (typeof s === 'number' ? s : s.等级 || 0) : 0; }
            html += '<div class="cv-member ' + (sel ? 'sel' : '') + '" data-m="' + cols[i] + '">' +
                '<b>' + cols[i] + '</b><span class="mv-skills">射击 ' + lv('射击') + ' · 采矿 ' + lv('采矿') + ' · 种植 ' + lv('种植') + '</span></div>';
        }
        box.innerHTML = html;
        var els = box.querySelectorAll('[data-m]');
        for (var e = 0; e < els.length; e++) {
            els[e].onclick = function () {
                var n = this.getAttribute('data-m');
                var idx = CV.成员.indexOf(n);
                if (idx >= 0) CV.成员.splice(idx, 1); else CV.成员.push(n);
                renderAll();
            };
        }
    }

    function renderLoad(st) {
        var box = document.getElementById('cv-load');
        if (!box) return;
        var inv = st.库存 || {};
        var html = '<h3>📦 装载</h3>';
        var cats = ['物资', '食物', '弹药', '药品'];
        var anyItem = false;
        for (var c = 0; c < cats.length; c++) {
            var items = inv[cats[c]] || {};
            for (var k in items) {
                anyItem = true;
                var loaded = CV.装载[k] || 0;
                html += '<div class="cv-load-row"><span class="ld-name">' + esc(k) + ' <small style="color:var(--rw-dim,#8496a8)">(库存 ' + items[k] + ')</small></span>' +
                    '<input type="number" min="0" max="' + items[k] + '" value="' + loaded + '" data-item="' + esc(k) + '"></div>';
            }
        }
        if (!anyItem) html += '<div class="rw-empty">库存为空（守恒：装走的都从库里扣）</div>';
        var w = weight(st), cap = capacity(st);
        html += '<div class="cv-weight ' + (w > cap ? 'over' : '') + '">负重 ' + w + ' / ' + cap + '（载重 = Σ(50 + 采矿等级×2) 简化模型，v2 接统一求值器）</div>';
        box.innerHTML = html;
        var inputs = box.querySelectorAll('[data-item]');
        for (var i = 0; i < inputs.length; i++) {
            inputs[i].addEventListener('change', function () {
                var v = Math.max(0, parseInt(this.value) || 0);
                var k = this.getAttribute('data-item');
                if (v > 0) CV.装载[k] = v; else delete CV.装载[k];
                renderAll();
            });
        }
    }

    function renderRoute(st) {
        var box = document.getElementById('cv-route');
        if (!box) return;
        var html = '<h3>🗺 目的地与出发</h3>' +
            '<div style="font-size:11px;color:var(--rw-dim,#8496a8)">先在终端「地图」Tab 点击目标格子选中，再回这里出发。</div>' +
            '<div class="cv-dest" id="cv-dest-info"></div>';
        if (st.远行队 && st.远行队.在途) {
            var cv2 = st.远行队;
            html += '<div class="cv-active"><b>🚚 远行队在途</b><br>成员：' + esc((cv2.成员 || []).join('、')) + '<br>' +
                '目的地方位：' + esc(cv2.目的地方位 || '?') + ' · 预计 ' + esc(cv2.剩余 || '?') + ' 天<br>' +
                '<button class="rw-btn" id="cv-arrive">模拟到达</button></div>';
        }
        box.innerHTML = html;
        // 目的地信息
        var dest = CV.目的地 || (RW.map && RW.map.selected);
        var info = box.querySelector('#cv-dest-info');
        if (dest) {
            CV.目的地 = dest;
            var rc = routeCost();
            info.innerHTML = rc ? '目的地：' + esc(dest.x + ',' + dest.y) + '（' + esc(rc.目的地地形) + '）<br>距离 ' + rc.距离 + ' 格 · 地形系数 ×' + rc.地形系数 + ' · <b>预计往返 ' + rc.预计天数 + ' 天</b>' : '地图未生成';
        } else {
            info.innerHTML = '尚未选择目的地（去地图 Tab 点一个格子）';
        }
        // 出发按钮
        var goBtn = document.createElement('button');
        goBtn.className = 'rw-btn primary';
        goBtn.style.marginTop = '10px';
        goBtn.textContent = '🚀 出发';
        goBtn.disabled = !(CV.成员.length && dest && weight(st) <= capacity(st) && !(st.远行队 && st.远行队.在途));
        goBtn.onclick = function () { depart(st); };
        box.appendChild(goBtn);
        var arriveBtn = box.querySelector('#cv-arrive');
        if (arriveBtn) arriveBtn.onclick = function () { arrive(st); };
    }

    function depart(st) {
        var rc = routeCost();
        if (!rc) return;
        // 守恒：装载从库存扣除
        var ok = writeState(function (s) {
            var inv = s.库存 || {};
            for (var k in CV.装载) {
                for (var c in inv) if (inv[c][k] != null) {
                    inv[c][k] = Math.max(0, (inv[c][k] || 0) - CV.装载[k]);
                    if (inv[c][k] <= 0) delete inv[c][k];
                }
            }
            var dx = CV.目的地.x - (RW.map.baseX || RW.map.W / 2), dy = CV.目的地.y - (RW.map.baseY || RW.map.H / 2);
            s.远行队 = {
                在途: true, 成员: CV.成员.slice(), 装载: JSON.parse(JSON.stringify(CV.装载)),
                目的地: { x: CV.目的地.x, y: CV.目的地.y },
                目的地方位: (dy < -2 ? '北' : dy > 2 ? '南' : '') + (dx > 2 ? '东' : dx < -2 ? '西' : '') || '营地附近',
                剩余: rc.预计天数, 地形: rc.目的地地形,
            };
            if (!s.事件记录) s.事件记录 = [];
            s.事件记录.push('【远行队出发】' + CV.成员.join('、') + ' 携 ' + Object.keys(CV.装载).length + ' 种物资前往' + s.远行队.目的地方位 + '（约 ' + rc.预计天数 + ' 天）');
        }, '远行队出发');
        if (RW.toast) RW.toast(ok ? '远行队已出发' : '写回失败', ok ? 'good' : 'bad');
        renderAll();
    }

    function arrive(st) {
        var ok = writeState(function (s) {
            var cv2 = s.远行队 || {};
            // 到达事件：地形决定探索结果
            var finds = [];
            var terrain = cv2.地形 || '草地';
            if (terrain === '石岩') finds.push('发现裸露矿脉（钢×40 已探明）');
            else if (terrain === '草地' || terrain === '肥沃草地') finds.push('采集了浆果×18、草药×6');
            else if (terrain === '沙地') finds.push('发现古代废墟入口（遗址事件 v2 接入）');
            else finds.push('周边侦察完成，无特殊发现');
            // 装载的采集收获回队（回程）
            if (!s.远行队.收获) s.远行队.收获 = [];
            s.远行队.收获 = s.远行队.收获.concat(finds);
            s.远行队.在途 = false;
            s.远行队.到达 = true;
            if (!s.事件记录) s.事件记录 = [];
            s.事件记录.push('【远行队到达】' + (cv2.成员 || []).join('、') + ' 抵达目的地：' + finds.join('；'));
        }, '远行队到达');
        if (RW.toast) RW.toast(ok ? '远行队到达！' : '写回失败', ok ? 'good' : 'bad');
        renderAll();
    }

    CV.open = function () {
        if (!readState()) { if (RW.toast) RW.toast('状态未就绪', 'bad'); return; }
                try { if (HOST.Rimworld && HOST.Rimworld.closeAllPanels) HOST.Rimworld.closeAllPanels("rw-cv"); } catch (e) {}        ensurePanel().classList.add('open');
        renderAll();
    };
    try { console.log('%c[环远行队] ✅ 已注册', 'color:#5fb4e5'); } catch (e) {}
})();
