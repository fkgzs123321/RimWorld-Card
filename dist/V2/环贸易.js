/* * ==========================================================================
 * [环世界] 贸易系统 (Trade) v1
 * 交易台：派系选择（好感→价格修正）→ 商品清单（买/卖）→ 白银结算 → 流水账
 * 渠道：旅队到访（随机事件）与轨道商人（需通讯台+微电子基础研究）
 * 价格模型：基准价 × (1 - 好感加成) ；买入价 ×1.4 卖出价 ×0.6（原版价差）
 * 全局 API：Rimworld.trade.open()
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
    style.id = 'rw-trade-style';
    style.textContent = `
#rw-td { position: fixed; inset: 0; background: rgba(8,10,14,.78); z-index: 100004; display: none; align-items: center; justify-content: center; }
#rw-td.open { display: flex; }
.rw-tdn { width: 880px; max-width: calc(100vw - 40px); height: 640px; max-height: calc(100vh - 50px);
  background: var(--rw-bg2, #1c232d); border: 2px solid #d4b45a; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; }
.rw-tdn-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--rw-bg, #151a21); border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-tdn-head h2 { font-size: 15px; color: #d4b45a; }
.td-body { flex: 1; display: flex; min-height: 0; }
.td-col { flex: 1; padding: 12px; overflow-y: auto; border-right: 1px solid var(--rw-border, #33404f); }
.td-col:last-child { border-right: none; }
.td-col h3 { font-size: 13px; margin-bottom: 8px; }
.td-col h3.buy { color: #9fd67f; }
.td-col h3.sell { color: #e5c15f; }
.td-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; margin: 3px 0; font-size: 11px; background: var(--rw-panel, #202936); }
.td-row .td-name { flex: 1; }
.td-row .td-price { color: var(--rw-dim, #8496a8); width: 70px; text-align: right; }
.td-row input { width: 56px; background: var(--rw-bg, #151a21); color: var(--rw-text, #d8e2ec); border: 1px solid var(--rw-border, #33404f); border-radius: 4px; padding: 2px 5px; }
.td-silver { font-size: 13px; padding: 8px 10px; border-radius: 7px; background: var(--rw-bg, #151a21); margin-bottom: 10px; }
.td-silver b { color: #d4b45a; font-size: 16px; }
.rw-btn { padding: 6px 16px; border: 1px solid var(--rw-accent, #e8a33d); border-radius: 6px; background: transparent; color: var(--rw-accent, #e8a33d); cursor: pointer; font-size: 12px; }
.rw-btn.gold { border-color: #d4b45a; color: #d4b45a; }
.rw-btn.primary { background: #d4b45a; color: #151a21; font-weight: 700; }
.rw-btn:disabled { opacity: .35; cursor: not-allowed; }
select.td-sel { background: var(--rw-bg, #151a21); color: var(--rw-text, #d8e2ec); border: 1px solid var(--rw-border, #33404f); border-radius: 5px; padding: 4px 8px; font-size: 12px; }
`;
    document.head.appendChild(style);

    // 商品表（基准价·原版锚定近似）
    var BUY_LIST = [
        { 名: '钢材', 价: 3, 库存类: '物资', 说明: '弹药链核心原料' },
        { 名: '组件机件', 价: 55, 库存类: '物资', 说明: '最稀缺工业原料' },
        { 名: '中性胺', 价: 26, 库存类: '药品', 说明: '制药线卡脖子项，只能进口' },
        { 名: '高级医药', 价: 45, 库存类: '药品', 说明: '手术必备，不可制造' },
        { 名: '手枪弹', 价: 1.2, 库存类: '弹药', 说明: '应急弹药补给' },
        { 名: '突击步枪弹', 价: 1.6, 库存类: '弹药', 说明: '' },
    ];
    var SELL_LIST = [
        { 名: '兽皮', 价: 4.5, 库存类: '物资' },
        { 名: '布', 价: 3.2, 库存类: '物资' },
        { 名: '雕塑', 价: 180, 库存类: '物资', 说明: '艺术技能产出，高附加值' },
        { 名: '草药医药', 价: 6, 库存类: '药品', 说明: '过剩时卖，留足自用' },
        { 名: '烟叶', 价: 7, 库存类: '物资' },
        { 名: '罐装咖啡', 价: 14, 库存类: '食物' },
    ];
    var TD = { 派系: '氏族', 买: {}, 卖: {} };
    RW.trade = TD;

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
                if (r && r.stat_data) { mutator(r.stat_data); m.replaceMvuData(r, reason || '贸易'); return true; }
            }
        } catch (e) {}
        return false;
    }
    function favor(st) {
        var f = st.派系 || {};
        return typeof f[TD.派系] === 'number' ? f[TD.派系] : 0;
    }
    function silver(st) {
        return (st.库存 && st.库存.物资 && st.库存.物资.白银) || 0;
    }

    function ensurePanel() {
        var p = document.getElementById('rw-td');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'rw-td';
        p.innerHTML = '<div class="rw-tdn">' +
            '<div class="rw-tdn-head"><h2>💰 贸易台</h2>' +
            '<span>交易对象 <select class="td-sel" id="td-faction"></select></span>' +
            '<span style="flex:1"></span><button class="rw-btn" id="td-close">✕</button></div>' +
            '<div class="td-body"><div class="td-col" id="td-buy"></div><div class="td-col" id="td-sell"></div></div></div>';
        document.body.appendChild(p);
        /* 点遮罩关闭 */
        (function () { var el0 = document.getElementById('rw-td'); if (el0) el0.addEventListener('click', function (e) { if (e.target === el0) el0.classList.remove('open'); }); })();
        p.querySelector('#td-close').onclick = function () { p.classList.remove('open'); };
        p.addEventListener('click', function (e) { if (e.target === p) p.classList.remove('open'); });
        p.querySelector('#td-faction').addEventListener('change', function () { TD.派系 = this.value; renderAll(); });
        return p;
    }

    function renderAll() {
        var st = readState() || {};
        // 派系下拉
        var sel = document.getElementById('td-faction');
        var facs = st.派系 ? Object.keys(st.派系).filter(function (k) { return k !== '机械教团'; }) : ['氏族', '邦联'];
        sel.innerHTML = facs.map(function (f) { return '<option' + (TD.派系 === f ? ' selected' : '') + '>' + f + '</option>'; }).join('');
        var fv = favor(st);
        // 好感价格修正：友好买价降/卖价升
        var buyMod = 1.4 - Math.max(-0.2, Math.min(0.2, fv / 500));
        var sellMod = 0.6 + Math.max(-0.15, Math.min(0.15, fv / 700));
        var silver = (st.库存 && st.库存.物资 && st.库存.物资.白银) || 0;
        // 买
        var buyBox = document.getElementById('td-buy');
        var h = '<h3 class="buy">🛒 买入（白银 ' + silver + '）</h3>' +
            '<div style="font-size:10px;color:var(--rw-dim,#8496a8);margin-bottom:6px">好感 ' + fv + ' → 买入价 ×' + buyMod.toFixed(2) + '</div>';
        for (var i = 0; i < BUY_LIST.length; i++) {
            var g = BUY_LIST[i];
            var price = Math.round(g.价 * buyMod * 10) / 10;
            h += '<div class="td-row"><span class="td-name">' + esc(g.名) + (g.说明 ? ' <small style="color:var(--rw-dim,#8496a8)">' + esc(g.说明) + '</small>' : '') + '</span>' +
                '<span class="td-price">' + price + '银/个</span>' +
                '<input type="number" min="0" data-buy="' + esc(g.名) + '" data-price="' + price + '" data-cat="' + g.库存类 + '" value="' + (TD.买[g.名] || 0) + '"></div>';
        }
        h += '<div style="margin-top:10px"><button class="rw-btn gold" id="td-do-buy">💸 按单买入</button> <small style="color:var(--rw-dim,#8496a8)">渠道：旅队到访/轨道商人（通讯台+微电子）</small></div>';
        buyBox.innerHTML = h;
        // 卖
        var sellBox = document.getElementById('td-sell');
        var h2 = '<h3 class="sell">🏷 卖出（好感 → 卖价 ×' + sellMod.toFixed(2) + '）</h3>';
        for (var j = 0; j < SELL_LIST.length; j++) {
            var s2 = SELL_LIST[j];
            var have = (st.库存 && st.库存[s2.库存类] && st.库存[s2.库存类][s2.名]) || 0;
            var price2 = Math.round(s2.价 * sellMod * 10) / 10;
            h2 += '<div class="td-row"><span class="td-name">' + esc(s2.名) + ' <small style="color:var(--rw-dim,#8496a8)">(有 ' + have + ')</small></span>' +
                '<span class="td-price">' + price2 + '银/个</span>' +
                '<input type="number" min="0" max="' + have + '" data-sell="' + esc(s2.名) + '" data-price="' + price2 + '" data-cat="' + s2.库存类 + '" value="' + (TD.卖[s2.名] || 0) + '"></div>';
        }
        h2 += '<div style="margin-top:10px"><button class="rw-btn gold" id="td-do-sell">💱 按单卖出</button></div>';
        sellBox.innerHTML = h2;
        // 绑定
        bindRows(buyBox, TD.买); bindRows(sellBox, TD.卖);
        buyBox.querySelector('#td-do-buy').onclick = function () { doTrade(st, 'buy'); };
        sellBox.querySelector('#td-do-sell').onclick = function () { doTrade(st, 'sell'); };
    }
    function bindRows(box, store) {
        var inputs = box.querySelectorAll('input[data-buy],input[data-sell]');
        for (var i = 0; i < inputs.length; i++) {
            inputs[i].addEventListener('change', function () {
                var key = this.getAttribute('data-buy') || this.getAttribute('data-sell');
                store[key] = Math.max(0, parseInt(this.value) || 0);
            });
        }
    }

    function doTrade(st, mode) {
        var list = mode === 'buy' ? BUY_LIST : SELL_LIST;
        var orders = mode === 'buy' ? TD.买 : TD.卖;
        var mod = mode === 'buy' ? (1.4 - Math.max(-0.2, Math.min(0.2, favor(st) / 500))) : (0.6 + Math.max(-0.15, Math.min(0.15, favor(st) / 700)));
        var total = 0, lines = [];
        for (var i = 0; i < list.length; i++) {
            var g = list[i];
            var n = orders[g.名] || 0;
            if (n <= 0) continue;
            var price = Math.round(g.价 * mod * 10) / 10;
            total += price * n;
            lines.push((mode === 'buy' ? '购入 ' : '售出 ') + g.名 + '×' + n + ' @' + price);
        }
        if (!lines.length) { if (RW.toast) RW.toast('没有挂单', 'warn'); return; }
        var cost = Math.round(total);
        var ok = writeState(function (s) {
            var inv = s.库存 = s.库存 || { 物资: {}, 弹药: {}, 食物: {}, 药品: {} };
            inv.物资 = inv.物资 || {};
            // 白银守恒
            var bal = inv.物资.白银 || 0;
            if (mode === 'buy') {
                if (cost > bal) { s.__tradeFail = '白银不足（需 ' + cost + ' 有 ' + bal + '）'; return; }
                inv.物资.白银 = bal - cost;
                for (var i2 = 0; i2 < list.length; i2++) {
                    var g2 = list[i2], n2 = orders[g2.名] || 0;
                    if (n2 > 0) { inv[g2.库存类] = inv[g2.库存类] || {}; inv[g2.库存类][g2.名] = (inv[g2.库存类][g2.名] || 0) + n2; }
                }
            } else {
                inv.物资.白银 = bal + cost;
                for (var j2 = 0; j2 < list.length; j2++) {
                    var s3 = list[j2], n3 = orders[s3.名] || 0;
                    if (n3 > 0) {
                        var cat = inv[s3.库存类] || {};
                        cat[s3.名] = Math.max(0, (cat[s3.名] || 0) - n3);
                        if (cat[s3.名] <= 0) delete cat[s3.名];
                    }
                }
            }
            if (!s.$流水账) s.$流水账 = [];
            s.$流水账.push({ 物品: '白银', 数量: cost, 方向: mode === 'buy' ? '减' : '增', 事由: '贸易·' + TD.派系 + (mode === 'buy' ? '·买入' : '·卖出'), 楼层: '最新' });
            if (!s.事件记录) s.事件记录 = [];
            s.事件记录.push('【贸易】与 ' + TD.派系 + ' 交易：' + lines.join('；') + '，合计 ' + (mode === 'buy' ? '-' : '+') + cost + ' 白银');
            s.__tradeFail = null;
        }, '贸易 ' + mode);
        var fail = st.__tradeFail;
        st.__tradeFail = null;
        if (RW.toast) RW.toast(fail || (ok ? '成交：' + (mode === 'buy' ? '-' : '+') + cost + ' 白银' : '写回失败'), fail ? 'bad' : 'good');
        TD.买 = {}; TD.卖 = {};
        renderAll();
    }

    TD.open = function () {
        if (!readState()) { if (RW.toast) RW.toast('状态未就绪', 'bad'); return; }
                try { if (HOST.Rimworld && HOST.Rimworld.closeAllPanels) HOST.Rimworld.closeAllPanels("rw-td"); } catch (e) {}        ensurePanel().classList.add('open');
        renderAll();
    };
    try { console.log('%c[环贸易] ✅ 已注册', 'color:#d4b45a'); } catch (e) {}
})();
