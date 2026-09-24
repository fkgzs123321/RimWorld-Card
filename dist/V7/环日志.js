/* * ==========================================================================
 * [环世界] 日志中心 (Log Center) v1
 * 四流统一：物质流水账 / 事件记录 / 战斗摘要 / 结算报告
 * 功能：分类过滤 + 全文搜索 + 时间轴视图 + 统计面板 + 导出
 * 全局 API：Rimworld.logCenter.open(流名)
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
    style.id = 'rw-logc-style';
    style.textContent = `
#rw-logc { position: fixed; inset: 0; background: rgba(8,10,14,.75); z-index: 100003; display: none; align-items: center; justify-content: center; }
#rw-logc.open { display: flex; }
.rw-lc { width: 900px; max-width: calc(100vw - 40px); height: 640px; max-height: calc(100vh - 50px);
  background: var(--rw-bg2, #1c232d); border: 2px solid var(--rw-accent, #e8a33d); border-radius: 12px;
  display: flex; flex-direction: column; overflow: hidden; }
.rw-lc-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--rw-bg, #151a21); border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-lc-head h2 { font-size: 15px; color: var(--rw-accent, #e8a33d); }
.rw-lc-tabs { display: flex; gap: 2px; padding: 6px 12px 0; background: var(--rw-bg, #151a21); }
.rw-lc-tab { padding: 7px 16px; border-radius: 7px 7px 0 0; cursor: pointer; font-size: 12px; color: var(--rw-dim, #8496a8); background: var(--rw-bg3, #242e3b); }
.rw-lc-tab.active { color: var(--rw-accent, #e8a33d); background: var(--rw-bg2, #1c232d); font-weight: 600; }
.rw-lc-tools { display: flex; gap: 8px; padding: 8px 14px; background: var(--rw-bg2, #1c232d); border-bottom: 1px solid var(--rw-border, #33404f); align-items: center; }
.rw-lc-tools input, .rw-lc-tools select { background: var(--rw-bg, #151a21); color: var(--rw-text, #d8e2ec); border: 1px solid var(--rw-border, #33404f); border-radius: 5px; padding: 5px 10px; font-size: 12px; }
.rw-lc-tools input { flex: 1; }
.rw-lc-body { flex: 1; overflow-y: auto; padding: 10px 14px; }
.rw-lc-body::-webkit-scrollbar { width: 8px; }
.rw-lc-body::-webkit-scrollbar-thumb { background: var(--rw-border, #33404f); border-radius: 4px; }
.lc-line { display: flex; gap: 10px; padding: 5px 8px; border-radius: 5px; font-size: 12px; margin-bottom: 2px; align-items: baseline; }
.lc-line:hover { background: var(--rw-bg3, #242e3b); }
.lc-line .lc-floor { min-width: 44px; text-align: right; color: var(--rw-dim, #8496a8); font-size: 10px; }
.lc-line .lc-body { flex: 1; }
.lc-line.gain .lc-body b { color: var(--rw-good, #6fbf5f); }
.lc-line.loss .lc-body b { color: var(--rw-bad, #e05f5f); }
.lc-line.ev-threat .lc-body { color: #f0b0b0; }
.lc-line.ev-good .lc-body { color: #b0e0b0; }
.lc-line.ev-neutral .lc-body { color: var(--rw-dim, #8496a8); }
.lc-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-bottom: 10px; }
.lc-stat { background: var(--rw-panel, #202936); border: 1px solid var(--rw-border, #33404f); border-radius: 7px; padding: 9px; text-align: center; }
.lc-stat .st-num { font-size: 20px; font-weight: 800; color: var(--rw-accent, #e8a33d); }
.lc-stat .st-label { font-size: 10px; color: var(--rw-dim, #8496a8); margin-top: 2px; }
.lc-timeline { position: relative; padding-left: 18px; }
.lc-timeline::before { content: ''; position: absolute; left: 5px; top: 4px; bottom: 4px; width: 2px; background: var(--rw-border, #33404f); }
.lc-tl-item { position: relative; padding: 4px 0 4px 6px; font-size: 12px; }
.lc-tl-item::before { content: ''; position: absolute; left: -17px; top: 9px; width: 8px; height: 8px; border-radius: 50%; background: var(--rw-accent, #e8a33d); border: 2px solid var(--rw-bg2, #1c232d); }
.lc-tl-item.t-threat::before { background: var(--rw-bad, #e05f5f); }
.lc-tl-item.t-good::before { background: var(--rw-good, #6fbf5f); }
`;
    document.head.appendChild(style);

    /* ═══════════ 数据归集 ═══════════ */

    var currentStream = '物质';
    var viewMode = '列表'; // 列表 | 时间轴
    var searchKw = '';

    function readState() {
        var m = (window.Mvu || HOST.Mvu);
        try {
            if (m && typeof m.getMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) return r.stat_data;
            }
        } catch (e) {}
        return {};
    }

    function streamData(st, stream) {
        if (stream === '物质') return (st.$流水账 || []).map(function (L, i) {
            var src = typeof L === 'string' ? { 事由: L } : L;
            return { 楼层: src.楼层 || '?', cls: src.方向 === '减' ? 'loss' : 'gain', text: '<b>' + (src.方向 === '减' ? '-' : '+') + esc(src.数量) + '</b> ' + esc(src.物品) + ' <small style="color:var(--rw-dim,#8496a8)">[' + esc(src.事由 || '?') + ']</small>', raw: JSON.stringify(L) };
        });
        if (stream === '事件') {
            return (st.事件记录 || []).map(function (E, i) {
                var threat = E.indexOf('袭击') >= 0 || E.indexOf('狂暴') >= 0 || E.indexOf('崩溃') >= 0;
                var good = E.indexOf('加入') >= 0 || E.indexOf('到访') >= 0 || E.indexOf('坠毁') >= 0 || E.indexOf('灵感') >= 0;
                return { 楼层: '#' + (i + 1), cls: threat ? 'ev-threat' : good ? 'ev-good' : 'ev-neutral', text: esc(E), raw: E };
            });
        }
        if (stream === '战斗') {
            var s = st.$战斗摘要;
            return s ? [{ 楼层: '最新', cls: 'ev-threat', text: esc(s), raw: s }] : [];
        }
        if (stream === '统计') return [];
        return [];
    }

    /* ═══════════ 渲染 ═══════════ */

    function ensurePanel() {
        var p = document.getElementById('rw-logc');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'rw-logc';
        p.innerHTML =
            '<div class="rw-lc">' +
            '<div class="rw-lc-head"><h2>📜 日志中心</h2><span style="flex:1"></span>' +
            '<button class="rw-btn" id="lc-export">⧉ 导出</button><button class="rw-btn" id="lc-close">✕</button></div>' +
            '<div class="rw-lc-tabs" id="lc-tabs"></div>' +
            '<div class="rw-lc-tools"><input id="lc-search" placeholder="搜索…">' +
            '<select id="lc-view"><option>列表</option><option>时间轴</option></select></div>' +
            '<div class="rw-lc-body" id="lc-body"></div></div>';
        document.body.appendChild(p);
        /* 点遮罩关闭 */
        (function () { var el0 = document.getElementById('rw-logc'); if (el0) el0.addEventListener('click', function (e) { if (e.target === el0) el0.classList.remove('open'); }); })();
        p.querySelector('#lc-close').onclick = function () { p.classList.remove('open'); };
        p.querySelector('#lc-search').addEventListener('input', function () { searchKw = this.value; renderBody(); });
        p.querySelector('#lc-view').addEventListener('change', function () { viewMode = this.value; renderBody(); });
        p.querySelector('#lc-export').onclick = exportLog;
        p.addEventListener('click', function (e) {
            if (e.target === p) p.classList.remove('open');
            var tb = e.target.closest('.rw-lc-tab');
            if (tb) { currentStream = tb.getAttribute('data-s'); renderTabs(); renderBody(); }
        });
        return p;
    }

    function renderTabs() {
        var tabs = document.getElementById('lc-tabs');
        if (!tabs) return;
        var streams = [['物质', '📦'], ['事件', '🎲'], ['战斗', '⚔️'], ['统计', '📊']];
        tabs.innerHTML = streams.map(function (s) {
            return '<div class="rw-lc-tab ' + (currentStream === s[0] ? 'active' : '') + '" data-s="' + s[0] + '">' + s[1] + ' ' + s[0] + '</div>';
        }).join('');
    }

    function renderBody() {
        var box = document.getElementById('lc-body');
        if (!box) return;
        var st = readState();
        if (currentStream === '统计') { box.innerHTML = renderStats(st); return; }
        var rows = streamData(st, currentStream).filter(function (r) { return !searchKw || r.raw.indexOf(searchKw) >= 0 || r.text.indexOf(searchKw) >= 0; });
        if (!rows.length) { box.innerHTML = '<div class="rw-empty">该流暂无记录或不匹配搜索</div>'; return; }
        var html = '<div style="font-size:10px;color:var(--rw-dim,#8496a8);margin-bottom:6px">共 ' + rows.length + ' 条（新在上）</div>';
        if (viewMode === '时间轴') {
            html += '<div class="lc-timeline">';
            for (var i = rows.length - 1; i >= 0; i--) html += '<div class="lc-tl-item ' + rows[i].cls + '">' + rows[i].text + ' <small style="color:var(--rw-dim,#8496a8)">' + rows[i].楼层 + '</small></div>';
            html += '</div>';
        } else {
            for (var j = rows.length - 1; j >= 0; j--) html += '<div class="lc-line ' + rows[j].cls + '"><span class="lc-floor">' + rows[j].楼层 + '</span><span class="lc-body">' + rows[j].text + '</span></div>';
        }
        box.innerHTML = html;
    }

    function renderStats(st) {
        var logs = st.$流水账 || [];
        var items = {}, gains = 0, losses = 0;
        for (var i = 0; i < logs.length; i++) {
            var L = logs[i];
            if (typeof L !== 'object') continue;
            items[L.物品] = (items[L.物品] || 0) + (L.方向 === '减' ? -1 : 1) * (Number(L.数量) || 0);
            if (L.方向 === '减') losses++; else gains++;
        }
        var top = Object.keys(items).sort(function (a, b) { return Math.abs(items[b]) - Math.abs(items[a]); }).slice(0, 10);
        var evCount = (st.事件记录 || []).length;
        var threats = (st.事件记录 || []).filter(function (E) { return E.indexOf('袭击') >= 0; }).length;
        var html = '<div class="lc-stats">' +
            '<div class="lc-stat"><div class="st-num">' + logs.length + '</div><div class="st-label">物质流水总笔数</div></div>' +
            '<div class="lc-stat"><div class="st-num">' + gains + '</div><div class="st-label">增加笔数</div></div>' +
            '<div class="lc-stat"><div class="st-num">' + losses + '</div><div class="st-label">减少笔数</div></div>' +
            '<div class="lc-stat"><div class="st-num">' + evCount + '</div><div class="st-label">事件总数</div></div>' +
            '<div class="lc-stat"><div class="st-num" style="color:var(--rw-bad,#e05f5f)">' + threats + '</div><div class="st-label">袭击事件</div></div>' +
            '</div>';
        html += '<div class="cx-card"><h4>📈 物质净变动 Top 10（增减相抵）</h4>';
        for (var k = 0; k < top.length; k++) {
            var v = items[top[k]];
            html += '<div class="lc-line ' + (v >= 0 ? 'gain' : 'loss') + '"><span class="lc-floor">#' + (k + 1) + '</span><span class="lc-body">' + esc(top[k]) + ' <b>' + (v >= 0 ? '+' : '') + v + '</b></span></div>';
        }
        html += '</div>';
        html += '<div class="cx-card"><h4>🧾 守恒声明</h4><div style="font-size:11px;color:var(--rw-dim,#8496a8);line-height:1.7">以上每笔变动都有事由与楼层记录。任何「无来源增加」都是缺陷——环经济.守恒报告() 每半天自动校验一次。</div></div>';
        return html;
    }

    function exportLog() {
        var st = readState();
        var out = ['=== 环世界存档日志导出 ===', '导出时间：' + new Date().toLocaleString(), ''];
        out.push('── 物质流水账 ──');
        (st.$流水账 || []).forEach(function (L) { out.push(typeof L === 'string' ? L : JSON.stringify(L)); });
        out.push('', '── 事件记录 ──');
        (st.事件记录 || []).forEach(function (E) { out.push(E); });
        out.push('', '── 战斗摘要 ──', st.$战斗摘要 || '（无）');
        var text = out.join('\n');
        try {
            HOST.navigator.clipboard.writeText(text).then(function () {
                if (RW.toast) RW.toast('日志已复制到剪贴板（' + text.length + ' 字符）', 'good');
            }, function () {
                if (RW.openModal) RW.openModal('日志导出', '<div style="font-size:11px;white-space:pre-wrap">' + esc(text) + '</div>');
            });
        } catch (e) {
            if (RW.openModal) RW.openModal('日志导出', '<div style="font-size:11px;white-space:pre-wrap;max-height:400px;overflow-y:auto">' + esc(text) + '</div>');
        }
    }

    RW.logCenter = { open: function (s) { try { if (HOST.Rimworld && HOST.Rimworld.closeAllPanels) HOST.Rimworld.closeAllPanels('rw-logc'); } catch (e) {} ensurePanel().classList.add('open'); if (s) currentStream = s; renderTabs(); renderBody(); } };
    try { console.log('%c[环日志中心] ✅ 已注册', 'color:#e8a33d'); } catch (e) {}
})();
