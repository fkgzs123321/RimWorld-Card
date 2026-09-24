/* * ==========================================================================
 * [环世界] 社交关系网 (Social Graph) v1
 * Canvas 力导向图：殖民者 × <user> × 派系 节点网
 *   - 节点：三人（大小=心情）＋<user>（金色）＋5 派系（方节点）
 *   - 边：关系值（正绿负红，粗细=强度，标签=阶段）
 *   - 力模拟：库仑斥力 + 弹簧 + 中心引力，每帧收敛
 *   - 节点拖拽 + 点击详情（关系阶段/想法/派系 opinion 明细）
 * 全局 API：Rimworld.social.open()
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
    style.id = 'rw-social-style';
    style.textContent = `
#rw-social { position: fixed; inset: 0; background: rgba(8,10,14,.78); z-index: 100003; display: none; align-items: center; justify-content: center; }
#rw-social.open { display: flex; }
.rw-so { width: 860px; max-width: calc(100vw - 40px); height: 640px; max-height: calc(100vh - 50px);
  background: var(--rw-bg2, #1c232d); border: 2px solid var(--rw-accent2, #5fb4e5); border-radius: 12px;
  display: flex; flex-direction: column; overflow: hidden; }
.rw-so-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--rw-bg, #151a21); border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-so-head h2 { font-size: 15px; color: var(--rw-accent2, #5fb4e5); }
.rw-so-body { flex: 1; display: flex; min-height: 0; }
.rw-so-canvas-wrap { flex: 1.4; position: relative; }
#so-canvas { width: 100%; height: 100%; display: block; cursor: grab; }
.rw-so-side { width: 300px; border-left: 1px solid var(--rw-border, #33404f); padding: 14px; overflow-y: auto; }
.rw-so-side::-webkit-scrollbar { width: 8px; }
.rw-so-side::-webkit-scrollbar-thumb { background: var(--rw-border, #33404f); border-radius: 4px; }
.so-detail h3 { color: var(--rw-accent2, #5fb4e5); font-size: 14px; margin-bottom: 8px; }
.so-op-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 12px; }
.so-op-row .op-name { width: 90px; }
.so-op-bar { flex: 1; height: 12px; background: rgba(0,0,0,.3); border-radius: 6px; overflow: hidden; position: relative; }
.so-op-bar i { display: block; height: 100%; }
.so-stage { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 11px; border: 1px solid var(--rw-accent, #e8a33d); color: var(--rw-accent, #e8a33d); margin-left: 6px; }
`;
    document.head.appendChild(style);

    /* ═══════════ 图数据 ═══════════ */

    var FACTIONS = ['近距部落', '远距部落', '氏族', '邦联', '机械教团'];
    var SIM = { nodes: [], edges: [], dragging: null, anim: null };

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

    function buildGraph() {
        var st = readState();
        var W = 480, H = 460;
        var nodes = [
            { id: 'user', label: '<user>', type: 'user', x: W / 2, y: H / 2, r: 22, fixed: true, 心情: null, 阶段: null },
        ];
        var colonists = [['薇卡', '👩‍⚕️', ['观察对象', '参照标准', '唯一变量']], ['凯奥', '👨‍🌾', ['礼貌协作', '兄弟', '无条件托付']], ['祝小满', '🔧', ['讨原型', '信任', '黏人占有欲']]];
        for (var i = 0; i < colonists.length; i++) {
            var n = colonists[i][0];
            var p = st[n] || {};
            nodes.push({
                id: n, label: colonists[i][1] + n, type: 'colonist',
                x: W / 2 + Math.cos(i * 2.1) * 130, y: H / 2 + Math.sin(i * 2.1) * 110,
                r: 16 + Math.round(((p.心情 != null ? p.心情 : 50) / 100) * 8),
                心情: p.心情 != null ? p.心情 : null,
                阶段: p.关系阶段 || colonists[i][2][0],
                阶段池: colonists[i][2],
                关系: p.关系 || {},
                想法: p.想法堆栈 || [],
            });
        }
        for (var f = 0; f < FACTIONS.length; f++) {
            var fac = FACTIONS[f];
            var val = st.派系 && typeof st.派系[fac] === 'number' ? st.派系[fac] : 0;
            nodes.push({
                id: fac, label: fac, type: 'faction', 方: val,
                x: W / 2 + Math.cos(f * 1.26 + 0.7) * 200, y: H / 2 + Math.sin(f * 1.26 + 0.7) * 170, r: 13,
            });
        }
        // 边：user—colonist（阶段）、user—faction（关系值）、colonist—colonist（互有关）
        var edges = [];
        var relMap = { '薇卡': st.薇卡 && st.薇卡.关系, '凯奥': st.凯奥 && st.凯奥.关系, '祝小满': st.祝小满 && st.祝小满.关系 };
        for (var c = 0; c < colonists.length; c++) {
            var cn = colonists[c][0];
            edges.push({ a: 'user', b: cn, type: 'stage' });
            // colonist 之间的关系（关系对象里的其他殖民者键）
            var rel = relMap[cn] || {};
            for (var rk in rel) {
                if (typeof rel[rk] === 'number' && nodes.some(function (x) { return x.id === rk; })) {
                    edges.push({ a: cn, b: rk, type: 'peer', 值: rel[rk] });
                }
            }
        }
        for (var e = 0; e < FACTIONS.length; e++) edges.push({ a: 'user', b: FACTIONS[e], type: 'faction', 值: (st.派系 && st.派系[FACTIONS[e]]) || 0 });
        SIM.nodes = nodes; SIM.edges = edges;
    }

    /* ═══════════ 力模拟 + 渲染 ═══════════ */

    function step() {
        var nodes = SIM.nodes, edges = SIM.edges;
        // 斥力
        for (var i = 0; i < nodes.length; i++) for (var j = i + 1; j < nodes.length; j++) {
            var a = nodes[i], b = nodes[j];
            var dx = b.x - a.x, dy = b.y - a.y;
            var d2 = dx * dx + dy * dy + 0.01;
            var f = 2600 / d2;
            var d = Math.sqrt(d2);
            a.x -= dx / d * f * 0.02; a.y -= dy / d * f * 0.02;
            b.x += dx / d * f * 0.02; b.y += dy / d * f * 0.02;
        }
        // 弹簧
        for (var e = 0; e < edges.length; e++) {
            var ed = edges[e];
            var na = findNode(ed.a), nb = findNode(ed.b);
            if (!na || !nb) continue;
            var rest = ed.type === 'faction' ? 160 : 120;
            var dx2 = nb.x - na.x, dy2 = nb.y - na.y;
            var d3 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 0.01;
            var f2 = (d3 - rest) * 0.012;
            na.x += dx2 / d3 * f2; na.y += dy2 / d3 * f2;
            nb.x -= dx2 / d3 * f2; nb.y -= dy2 / d3 * f2;
        }
        // 中心引力 + 速度限幅 + 边界
        for (var k = 0; k < nodes.length; k++) {
            var n2 = nodes[k];
            if (n2.fixed || n2 === SIM.dragging) continue;
            n2.x += (240 - n2.x) * 0.008;
            n2.y += (230 - n2.y) * 0.008;
            n2.x = Math.max(30, Math.min(450, n2.x));
            n2.y = Math.max(30, Math.min(430, n2.y));
        }
    }
    function findNode(id) {
        for (var i = 0; i < SIM.nodes.length; i++) if (SIM.nodes[i].id === id) return SIM.nodes[i];
        return null;
    }

    function render() {
        var canvas = document.getElementById('so-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        if (canvas.width !== canvas.clientWidth) canvas.width = canvas.clientWidth;
        if (canvas.height !== canvas.clientHeight) canvas.height = canvas.clientHeight;
        var css = getComputedStyle(document.documentElement);
        function cv(name, fb) { var v = css.getPropertyValue('--rw-' + name).trim(); return v || fb; }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        step();
        // 边
        for (var e = 0; e < SIM.edges.length; e++) {
            var ed = SIM.edges[e];
            var na = findNode(ed.a), nb = findNode(ed.b);
            if (!na || !nb) continue;
            if (ed.type === 'faction') {
                var v = ed.值 || 0;
                ctx.strokeStyle = v >= 0 ? 'rgba(111,191,95,' + Math.min(0.8, 0.2 + Math.abs(v) / 150) + ')' : 'rgba(224,95,95,' + Math.min(0.8, 0.2 + Math.abs(v) / 150) + ')';
                ctx.lineWidth = 1 + Math.abs(v) / 30;
            } else if (ed.type === 'peer') {
                ctx.strokeStyle = 'rgba(180,143,232,.5)';
                ctx.lineWidth = 1.5;
            } else {
                ctx.strokeStyle = 'rgba(232,163,61,.55)';
                ctx.lineWidth = 2;
            }
            ctx.beginPath();
            ctx.moveTo(na.x, na.y);
            ctx.lineTo(nb.x, nb.y);
            ctx.stroke();
            // 边标签
            if (ed.type === 'stage' && nb.阶段) {
                ctx.fillStyle = 'rgba(232,163,61,.85)';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(nb.阶段, (na.x + nb.x) / 2, (na.y + nb.y) / 2 - 5);
            }
        }
        // 节点
        for (var i = 0; i < SIM.nodes.length; i++) {
            var n = SIM.nodes[i];
            if (n.type === 'faction') {
                ctx.fillStyle = (n.方 || 0) >= 0 ? 'rgba(111,191,95,.75)' : 'rgba(224,95,95,.75)';
                ctx.fillRect(n.x - n.r * 0.75, n.y - n.r * 0.75, n.r * 1.5, n.r * 1.5);
                ctx.strokeStyle = 'rgba(255,255,255,.3)';
                ctx.strokeRect(n.x - n.r * 0.75, n.y - n.r * 0.75, n.r * 1.5, n.r * 1.5);
            } else {
                ctx.beginPath();
                ctx.arc(n.x, n.y, n.r, 0, 7);
                ctx.fillStyle = n.type === 'user' ? 'rgba(232,163,61,.9)' : 'rgba(95,180,229,.75)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,.6)';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            ctx.fillStyle = 'rgba(255,255,255,.92)';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(n.label.replace('<user>', '你'), n.x, n.y - n.r - 5);
            if (n.心情 != null) {
                ctx.fillStyle = n.心情 >= 60 ? '#9fd67f' : n.心情 >= 30 ? '#e5c15f' : '#f09f9f';
                ctx.fillText('心情 ' + n.心情, n.x, n.y + n.r + 12);
            }
        }
    }

    function startAnim() {
        if (SIM.anim) return;
        (function loop() {
            var canvas = document.getElementById('so-canvas');
            if (!canvas || !document.getElementById('rw-social').classList.contains('open')) { SIM.anim = null; return; }
            render();
            SIM.anim = requestAnimationFrame(loop);
        })();
    }

    /* ═══════════ 详情侧栏 ═══════════ */

    function showDetail(id) {
        var side = document.getElementById('so-detail');
        if (!side) return;
        var st = readState();
        var html = '';
        if (id === 'user') {
            html = '<div class="so-detail"><h3>👤 你（玩家角色）</h3>' +
                '<div style="font-size:11px;color:var(--rw-dim,#8496a8);line-height:1.7">三人小队成员之一。所有关系线的中心节点。</div></div>';
        } else if (st[id]) {
            var p = st[id];
            var stage = p.关系阶段 || '';
            html = '<div class="so-detail"><h3>' + esc(id) + (stage ? '<span class="so-stage">' + esc(stage) + '</span>' : '') + '</h3>';
            if (p.心情 != null) html += '<div style="font-size:12px;margin-bottom:8px">心情：<b>' + p.心情 + '</b></div>';
            var rel = p.关系 || {};
            var rk = Object.keys(rel);
            if (rk.length) {
                html += '<div style="font-size:11px;color:var(--rw-dim,#8496a8);margin:8px 0 4px">对他人 opinion</div>';
                for (var i = 0; i < rk.length; i++) {
                    var v = typeof rel[rk[i]] === 'number' ? rel[rk[i]] : 0;
                    html += '<div class="so-op-row"><span class="op-name">' + esc(rk[i]) + '</span>' +
                        '<div class="so-op-bar"><i style="width:' + Math.abs(v) / 2 + '%;background:' + (v >= 0 ? 'var(--rw-good,#6fbf5f)' : 'var(--rw-bad,#e05f5f)') + '"></i></div><span>' + v + '</span></div>';
                }
            }
            var th = p.想法堆栈 || [];
            if (th.length) {
                html += '<div style="font-size:11px;color:var(--rw-dim,#8496a8);margin:8px 0 4px">想法堆栈</div>';
                for (var t = 0; t < th.length; t++) html += '<div style="font-size:11px;margin:3px 0">· ' + esc(th[t].标签) + ' <b style="color:' + ((th[t].修正 || 0) >= 0 ? '#9fd67f' : '#f09f9f') + '">' + (th[t].修正 >= 0 ? '+' : '') + th[t].修正 + '</b> <small style="color:var(--rw-dim,#8496a8)">余' + th[t].剩余 + '半天</small></div>';
            }
            html += '</div>';
        } else if (FACTIONS.indexOf(id) >= 0) {
            var v2 = st.派系 && st.派系[id] || 0;
            var stage2 = v2 >= 75 ? '同盟' : v2 >= 40 ? '友好' : v2 >= 0 ? '中立' : v2 >= -40 ? '敌对' : '死敌';
            html = '<div class="so-detail"><h3>🏴 ' + esc(id) + '</h3>' +
                '<div style="font-size:12px">关系值：<b style="color:' + (v2 >= 0 ? '#9fd67f' : '#f09f9f') + '">' + v2 + '</b> → <span class="so-stage">' + stage2 + '</span></div>' +
                '<div style="font-size:11px;color:var(--rw-dim,#8496a8);margin-top:8px;line-height:1.7">' +
                (v2 >= 40 ? '会派旅队贸易，可能援助。' : v2 >= 0 ? '互不侵犯，可交易。' : '袭击来源。改善关系需要赠礼与援救。') + '</div></div>';
        }
        side.innerHTML = html;
    }

    /* ═══════════ 交互 ═══════════ */

    function bind() {
        var canvas = document.getElementById('so-canvas');
        var dragging = null;
        canvas.addEventListener('mousedown', function (e) {
            var r = canvas.getBoundingClientRect();
            var mx = e.clientX - r.left, my = e.clientY - r.top;
            for (var i = SIM.nodes.length - 1; i >= 0; i--) {
                var n = SIM.nodes[i];
                if (Math.hypot(mx - n.x, my - n.y) < n.r + 6) { dragging = n; break; }
            }
        });
        canvas.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            var r = canvas.getBoundingClientRect();
            dragging.x = e.clientX - r.left; dragging.y = e.clientY - r.top;
        });
        canvas.addEventListener('mouseup', function () { dragging = null; });
        canvas.addEventListener('click', function (e) {
            var r = canvas.getBoundingClientRect();
            var mx = e.clientX - r.left, my = e.clientY - r.top;
            for (var i = SIM.nodes.length - 1; i >= 0; i--) {
                var n = SIM.nodes[i];
                if (Math.hypot(mx - n.x, my - n.y) < n.r + 6) { showDetail(n.id); return; }
            }
        });
    }

    /* ═══════════ API ═══════════ */

    RW.social = {
        open: function () {
            var p = document.getElementById('rw-social');
            if (!p) {
                p = document.createElement('div');
                p.id = 'rw-social';
                p.innerHTML = '<div class="rw-so">' +
                    '<div class="rw-so-head"><h2>🕸 社交关系网</h2><span style="font-size:10px;color:var(--rw-dim,#8496a8)">拖拽节点 · 点击看详情</span><span style="flex:1"></span><button class="rw-btn" id="so-close">✕</button></div>' +
                    '<div class="rw-so-body"><div class="rw-so-canvas-wrap"><canvas id="so-canvas"></canvas></div>' +
                    '<div class="rw-so-side"><div class="so-detail" id="so-detail"><div class="so-detail"><h3>点节点看详情</h3></div></div></div></div></div>';
                document.body.appendChild(p);
        /* 点遮罩关闭 */
        (function () { var el0 = document.getElementById('rw-social'); if (el0) el0.addEventListener('click', function (e) { if (e.target === el0) el0.classList.remove('open'); }); })();
                p.querySelector('#so-close').onclick = function () { p.classList.remove('open'); };
                p.addEventListener('click', function (e) { if (e.target === p) p.classList.remove('open'); });
                bind();
            }
            buildGraph();
                        try { if (HOST.Rimworld && HOST.Rimworld.closeAllPanels) HOST.Rimworld.closeAllPanels("rw-social"); } catch (e) {}            p.classList.add('open');
            startAnim();
            showDetail('user');
        },
    };
    try { console.log('%c[环社交] ✅ 关系网已注册', 'color:#5fb4e5'); } catch (e) {}
})();
