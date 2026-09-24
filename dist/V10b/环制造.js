/* * ==========================================================================
 * [环世界] 制造交互台 (Crafting Bench) v1
 * 接环经济.js 真算：配方表 → 原料检查（库存对照缺料红字）→ 指派殖民者（技能→判定基准预览）
 *   → 开造（E3 判定动画：掷骰滚动）→ 产出与原料扣减（走环经济.craft）→ 流水账留痕
 * 全局 API：Rimworld.craftBench.open()
 * ========================================================================== */
(function () {
    'use strict';

    var HOST = (function () { var w = window; try { while (w.parent && w.parent !== w) w = w.parent; } catch (e) {} return w; })();
    var RW = HOST.Rimworld = HOST.Rimworld || {};
    var document = HOST.document;
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    var style = document.createElement('style');
    style.id = 'rw-craft-style';
    style.textContent = `
#rw-craft { position: fixed; inset: 0; background: rgba(8,10,14,.78); z-index: 100004; display: none; align-items: center; justify-content: center; }
#rw-craft.open { display: flex; }
.rw-cf { width: 920px; max-width: calc(100vw - 40px); height: 660px; max-height: calc(100vh - 50px);
  background: var(--rw-bg2, #1c232d); border: 2px solid var(--rw-accent, #e8a33d); border-radius: 12px;
  display: flex; flex-direction: column; overflow: hidden; }
.rw-cf-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--rw-bg, #151a21); border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-cf-head h2 { font-size: 15px; color: var(--rw-accent, #e8a33d); }
.rw-cf-body { flex: 1; display: flex; min-height: 0; }
.rw-cf-list { width: 280px; border-right: 1px solid var(--rw-border, #33404f); overflow-y: auto; padding: 10px; }
.rw-cf-main { flex: 1; overflow-y: auto; padding: 14px; }
.cf-recipe { background: var(--rw-panel, #202936); border: 1px solid var(--rw-border, #33404f); border-radius: 7px;
  padding: 9px 11px; margin-bottom: 6px; cursor: pointer; font-size: 12px; transition: border-color .15s; }
.cf-recipe:hover { border-color: var(--rw-accent2, #5fb4e5); }
.cf-recipe.sel { border-color: var(--rw-accent, #e8a33d); background: rgba(232,163,61,.06); }
.cf-recipe.blocked { opacity: .45; }
.cf-recipe .rc-name { font-weight: 700; }
.cf-recipe .rc-meta { font-size: 10px; color: var(--rw-dim, #8496a8); margin-top: 3px; }
.cf-detail h3 { color: var(--rw-accent, #e8a33d); font-size: 14px; margin-bottom: 10px; }
.cf-ing-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; font-size: 12px; }
.cf-ing-row .ig-name { width: 110px; }
.cf-ing-row .ig-need { width: 60px; text-align: right; }
.cf-ing-row .ig-have { width: 70px; text-align: right; }
.cf-ing-row.lack .ig-have { color: var(--rw-bad, #e05f5f); font-weight: 700; }
.cf-worker-card { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--rw-border, #33404f);
  border-radius: 7px; margin: 5px 0; cursor: pointer; font-size: 12px; }
.cf-worker-card.sel { border-color: var(--rw-accent, #e8a33d); background: rgba(232,163,61,.06); }
.cf-roll-box { text-align: center; padding: 14px; background: var(--rw-bg, #151a21); border-radius: 8px; margin: 10px 0; display: none; }
.cf-roll-box.show { display: block; }
.cf-roll-num { font-size: 42px; font-weight: 900; color: var(--rw-accent, #e8a33d); font-family: monospace; }
.cf-roll-tier { font-size: 14px; font-weight: 700; margin-top: 4px; }
.cf-result-line { padding: 6px 10px; margin: 4px 0; border-radius: 6px; font-size: 12px; background: var(--rw-panel, #202936); }
.cf-btn-bar { display: flex; gap: 10px; margin-top: 12px; }
.rw-btn { padding: 6px 16px; border: 1px solid var(--rw-accent, #e8a33d); border-radius: 6px; background: transparent; color: var(--rw-accent, #e8a33d); cursor: pointer; font-size: 12px; }
.rw-btn.primary { background: var(--rw-accent, #e8a33d); color: var(--rw-bg, #151a21); font-weight: 700; }
.rw-btn:disabled { opacity: .35; cursor: not-allowed; }
`;
    document.head.appendChild(style);

    /* ═══════════ 状态 ═══════════ */

    var CB = { sel: null, worker: null, rolling: false };
    RW.craftBench = CB;

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
                if (r && r.stat_data) { mutator(r.stat_data); m.replaceMvuData(r, reason || '制造结算'); return true; }
            }
        } catch (e) {}
        return false;
    }
    function eco() { return RW.economy || null; }
    function eng() { return RW.engine || null; }

    function getInv(st, cat, item) {
        var inv = st.库存 || {};
        return (inv[cat] || {})[item] || 0;
    }
    // 原料名 → 库存分类猜测（物资优先，弹药/药品/食物兜底）
    function findInInv(st, item) {
        var cats = ['物资', '弹药', '食物', '药品'];
        for (var c = 0; c < cats.length; c++) {
            var v = getInv(st, cats[c], item);
            if (v > 0) return { 分类: cats[c], 数量: v };
        }
        return { 分类: '物资', 数量: 0 };
    }
    // 配方主技能（用于指派预览）：从配方键猜
    function recipeSkill(recipeName) {
        if (recipeName.indexOf('弹') >= 0) return { 技能: '制造', 台: '机械加工' };
        if (recipeName.indexOf('钢') >= 0 || recipeName.indexOf('冶炼') >= 0) return { 技能: '采矿', 台: '冶炼' };
        if (recipeName.indexOf('药') >= 0) return { 技能: '智识', 台: '实验' };
        if (recipeName.indexOf('餐') >= 0 || recipeName.indexOf('烹饪') >= 0) return { 技能: '烹饪', 台: '厨房' };
        return { 技能: '手工', 台: '手工' };
    }
    function colonistSkill(st, name, skill) {
        var p = st[name];
        if (!p || !p.技能 || !p.技能[skill]) return null;
        var s = p.技能[skill];
        return { 等级: typeof s === 'number' ? s : (s.等级 || 0), 热情: s.热情 || '无' };
    }

    /* ═══════════ 渲染 ═══════════ */

    function ensurePanel() {
        var p = document.getElementById('rw-craft');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'rw-craft';
        p.innerHTML = '<div class="rw-cf">' +
            '<div class="rw-cf-head"><h2>⚗️ 制造交互台</h2><span style="font-size:10px;color:var(--rw-dim,#8496a8)">真算走环经济.craft（守恒铁律）</span>' +
            '<span style="flex:1"></span><button class="rw-btn" id="cf-close">✕</button></div>' +
            '<div class="rw-cf-body"><div class="rw-cf-list" id="cf-list"></div><div class="rw-cf-main" id="cf-main"></div></div></div>';
        document.body.appendChild(p);
        /* 点遮罩关闭 */
        (function () { var el0 = document.getElementById('rw-craft'); if (el0) el0.addEventListener('click', function (e) { if (e.target === el0) el0.classList.remove('open'); }); })();
        p.querySelector('#cf-close').onclick = function () { p.classList.remove('open'); };
        p.addEventListener('click', function (e) { if (e.target === p) p.classList.remove('open'); });
        return p;
    }

    function renderList(st) {
        var box = document.getElementById('cf-list');
        var recipes = (eco() && eco().配方表) || {};
        var keys = Object.keys(recipes);
        var html = '<input id="cf-search" placeholder="搜索配方…" style="width:100%;background:var(--rw-bg,#151a21);color:var(--rw-text,#d8e2ec);border:1px solid var(--rw-border,#33404f);border-radius:5px;padding:5px 9px;font-size:11px;margin-bottom:8px">';
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i], r = recipes[k];
            var locked = r.研 && !(st.研究 && (st.研究.已完成 || '').split('、').indexOf(r.研) >= 0);
            html += '<div class="cf-recipe ' + (CB.sel === k ? 'sel' : '') + (locked ? ' blocked' : '') + '" data-rc="' + esc(k) + '">' +
                '<div class="rc-name">' + esc(k) + (locked ? ' 🔒' : '') + '</div>' +
                '<div class="rc-meta">' + esc(r.台 || '手工') + (r.研 ? ' · 需【' + esc(r.研) + '】' : ' · 无需研究') + '</div></div>';
        }
        box.innerHTML = html;
        var si = box.querySelector('#cf-search');
        if (si) si.addEventListener('input', function () {
            var kw = this.value;
            var items = box.querySelectorAll('.cf-recipe');
            for (var j = 0; j < items.length; j++) items[j].style.display = items[j].getAttribute('data-rc').indexOf(kw) >= 0 ? '' : 'none';
        });
        var recs = box.querySelectorAll('[data-rc]');
        for (var q = 0; q < recs.length; q++) {
            recs[q].onclick = function () {
                if (this.classList.contains('blocked')) { if (RW.toast) RW.toast('前置研究未完成', 'bad'); return; }
                CB.sel = this.getAttribute('data-rc');
                CB.worker = null;
                renderList(readState());
                renderDetail(readState());
            };
        }
    }

    function renderDetail(st) {
        var box = document.getElementById('cf-main');
        var recipes = (eco() && eco().配方表) || {};
        var r = recipes[CB.sel];
        if (!r) { box.innerHTML = '<div class="rw-empty">← 从左侧选择配方</div>'; return; }
        var html = '<div class="cf-detail"><h3>⚗️ ' + esc(CB.sel) + '</h3>';
        // 原料对照
        var ing = r.原料 || {};
        var ik = Object.keys(ing);
        var allOk = true;
        html += '<h4 style="font-size:12px;color:var(--rw-accent2,#5fb4e5)">原料对照（守恒：缺料不许造）</h4>';
        for (var i = 0; i < ik.length; i++) {
            var have = findInInv(st, ik[i]);
            var need = ing[ik[i]];
            var lack = have.数量 < need;
            if (lack) allOk = false;
            html += '<div class="cf-ing-row ' + (lack ? 'lack' : '') + '"><span class="ig-name">' + esc(ik[i]) + '</span>' +
                '<span class="ig-need">需 ' + need + '</span><span class="ig-have">有 ' + have.数量 + '</span>' +
                (lack ? '<span style="color:var(--rw-bad,#e05f5f);font-size:11px">缺 ' + (need - have.数量) + '</span>' : '<span style="color:var(--rw-good,#6fbf5f);font-size:11px">✓</span>') + '</div>';
        }
        // 产出预览
        var prod = r.产出 || {};
        var pk = Object.keys(prod);
        html += '<div style="font-size:12px;margin:10px 0">产出：<b style="color:var(--rw-good,#6fbf5f)">' + pk.map(function (m) { return m + '×' + prod[m]; }).join('、') + '</b>' +
            (r.基准 ? ' · 判定基准 ' + r.基准 : '') + ' · 工时 ' + (r.工时 || 1) + '</div>';
        // 指派殖民者
        var skillGuess = recipeSkill(CB.sel);
        var cols = ['薇卡', '凯奥', '小满'];
        html += '<h4 style="font-size:12px;color:var(--rw-accent2,#5fb4e5)">指派殖民者（主技能：' + esc(skillGuess.技能) + '）</h4>';
        for (var c = 0; c < cols.length; c++) {
            var sk = colonistSkill(st, cols[c], skillGuess.技能);
            var lv = sk ? sk.等级 : null;
            var bonus = lv != null ? (lv * 3) : -20;
            var base = r.基准 || 50;
            var S = Math.max(5, Math.min(95, 50 + (base - 50) + bonus));
            html += '<div class="cf-worker-card ' + (CB.worker === cols[c] ? 'sel' : '') + '" data-worker="' + cols[c] + '">' +
                '<b>' + esc(cols[c]) + '</b><span style="color:var(--rw-dim,#8496a8)">' + esc(skillGuess.技能) + ' ' + (lv != null ? lv : '（无该技能数据）') + '</span>' +
                '<span style="margin-left:auto">预估成功档 ' + Math.round(S) + '</span></div>';
        }
        // 掷骰动画框
        html += '<div class="cf-roll-box" id="cf-roll"><div style="font-size:11px;color:var(--rw-dim,#8496a8)">E3 判定：D = P - R + E</div>' +
            '<div class="cf-roll-num" id="cf-roll-num">--</div><div class="cf-roll-tier" id="cf-roll-tier"></div></div>' +
            '<div id="cf-result"></div>';
        // 按钮
        html += '<div class="cf-btn-bar"><button class="rw-btn primary" id="cf-go" ' + (allOk && CB.worker && !CB.rolling ? '' : 'disabled') + '>🔨 开造</button>' +
            '<span style="font-size:10px;color:var(--rw-dim,#8496a8);align-self:center">' + (!allOk ? '原料不足' : !CB.worker ? '请先指派殖民者' : '守恒校验在结算时自动执行') + '</span></div>';
        box.innerHTML = html;
        // 绑定
        var workers = box.querySelectorAll('[data-worker]');
        for (var w = 0; w < workers.length; w++) {
            workers[w].onclick = function () { CB.worker = this.getAttribute('data-worker'); renderDetail(readState()); };
        }
        var go = box.querySelector('#cf-go');
        if (go) go.onclick = function () { doCraft(st, r); };
    }

    function doCraft(st, r) {
        if (CB.rolling) return;
        CB.rolling = true;
        var rollBox = document.getElementById('cf-roll');
        var numEl = document.getElementById('cf-roll-num');
        var tierEl = document.getElementById('cf-roll-tier');
        rollBox.classList.add('show');
        // 掷骰滚动动画（1.2s）
        var ticks = 0, finalRoll = null;
        var timer = HOST.setInterval(function () {
            ticks++;
            var v = Math.floor(Math.random() * 100);
            numEl.textContent = v;
            if (ticks >= 14) {
                HOST.clearInterval(timer);
                // 真判定：调环引擎.判定（真算，动画只是演出）
                var engm = eng();
                var skillGuess = recipeSkill(CB.sel);
                var sk = colonistSkill(st, CB.worker, skillGuess.技能);
                var P = (r.基准 || 50) + (sk ? sk.等级 * 3 : -20);
                var R = r.难度 || 50;
                var roll, tier, extra = 0;
                if (engm && typeof engm.判定 === 'function') {
                    var rr = engm.判定(st, { P: P, R: R, E: 0 });
                    roll = rr.S;
                    tier = rr.档位;
                    extra = rr;
                } else {
                    roll = Math.max(5, Math.min(95, P));
                    tier = roll >= 90 ? '大成功' : roll >= R ? '成功' : roll >= R - 20 ? '勉强' : '失败';
                }
                numEl.textContent = Math.round(roll);
                tierEl.textContent = tier + (extra && extra.成败 != null ? '（' + (extra.成败 ? '成功' : '失败') + '）' : '');
                tierEl.style.color = tier === '大成功' ? '#ffd700' : tier === '失败' ? 'var(--rw-bad,#e05f5f)' : 'var(--rw-good,#6fbf5f)';
                settleCraft(st, r, tier, roll);
                CB.rolling = false;
            }
        }, 80);
    }

    function settleCraft(st, r, tier, roll) {
        // 真算走环经济.craft（原料扣减/产出/流水全在库里），UI 只演出
        var ecoM = eco();
        var outLines = [];
        var ok = false;
        if (ecoM && typeof ecoM.craft === 'function') {
            try {
                var res = ecoM.craft(st.库存 || { 物资: {}, 弹药: {}, 食物: {}, 药品: {} }, CB.sel, (colonistSkill(st, CB.worker, recipeSkill(CB.sel).技能) || {}).等级 || 0, eng() && eng().判定 ? eng().判定 : null, st, { 设施: st.设施 || ['手工点'], 已完成研究: (st.研究 && st.研究.已完成) || '' });
                ok = !!res.成功;
                outLines.push(res.成功 ? '✅ ' + JSON.stringify(res.产出 || {}) : '❌ ' + (res.说明 || '失败'));
                if (res.判定) outLines.push('判定档位：' + res.判定.档位);
            } catch (e) { outLines.push('结算异常：' + e.message); }
        } else {
            // 降级：直接按档位产出
            ok = tier !== '失败';
            var mult = tier === '大成功' ? 1.5 : tier === '勉强' ? 0.6 : 1;
            var prod = r.产出 || {};
            var pk = Object.keys(prod);
            outLines.push(ok ? '✅ 产出 ' + pk.map(function (m) { return m + '×' + Math.max(1, Math.round(prod[m] * mult)); }).join('、') : '❌ 原料损耗');
        }
        writeState(function (s) {
            if (!s.事件记录) s.事件记录 = [];
            s.事件记录.push('【制造】' + CB.worker + ' 造 ' + CB.sel + ' → ' + tier + '（掷 ' + Math.round(roll) + '）');
        }, '制造记录');
        var box = document.getElementById('cf-result');
        if (box) box.innerHTML = outLines.map(function (l) { return '<div class="cf-result-line">' + esc(l) + '</div>'; }).join('');
        if (RW.toast) RW.toast('制造完成：' + tier, ok ? 'good' : 'bad');
        // 刷新原料对照
        var st2 = readState();
        renderList(st2);
        var detail = document.getElementById('cf-main');
        if (detail) renderDetail(st2);
    }

    CB.open = function () {
        var st = readState();
        if (!st) { alert('[环世界] 状态未就绪：请先发送一条任意消息让系统初始化变量，再打开本面板。'); return; }
                try { if (HOST.Rimworld && HOST.Rimworld.closeAllPanels) HOST.Rimworld.closeAllPanels("rw-craft"); } catch (e) {}        ensurePanel().classList.add('open');
        CB.sel = null; CB.worker = null;
        renderList(st);
        renderDetail(st);
    };
    try { console.log('%c[环制造台] ✅ 已注册（真算接环经济.craft）', 'color:#e8a33d'); } catch (e) {}
})();
