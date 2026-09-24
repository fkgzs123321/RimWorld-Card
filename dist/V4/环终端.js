/* * ==========================================================================
 * [环世界] 终端系统 UI (RimWorld Terminal) v1
 * 对标轮回战场主神终端，体量红线 1.2MB（三件套合计），少于即偷懒
 * 架构：
 *   - 单文件 IIFE + 父窗口重定向（操作酒馆本体 DOM）
 *   - 全局命名空间 Rimworld.terminal / Rimworld.engine（供其他模块复用）
 *   - MVU 唯一持久状态：Mvu.getMvuData 读 / Mvu.replaceMvuData 写
 *   - 多主题换肤（rimworld-dark / rimworld-light / desert）data-theme + CSS 变量
 *   - 地图第一屏（Canvas 七层渲染栈）+ 7 Tab（殖民者/持有/任务/研究/模组/日志/世界）
 *   - 31+ render 函数目标：本轮交付骨架 24 个，逐批加厚
 * ========================================================================== */
(function () {
    'use strict';

    /* ═══════════════════ 0. 基础设施 ═══════════════════ */

    // 父窗口重定向：状态栏渲染在 iframe，但 DOM 操作挂到酒馆本体
    var HOST = (function () {
        try { if (window.parent && window.parent !== window && window.parent.document && window.parent.document.body) return window.parent; } catch (e) {}
        try { if (window.top && window.top !== window && window.top.document && window.top.document.body) return window.top; } catch (e) {}
        return window;
    })();
    var $ = HOST.jQuery || HOST.$ || window.jQuery || window.$;
    var document = HOST.document;

    // 全局命名空间（轮回战场 Samsara 同构）
    var RW = HOST.Rimworld = HOST.Rimworld || {};

    function log(tag, msg) { try { console.log('%c[环终端] ' + tag, 'color:#e8a33d;font-weight:bold', msg); } catch (e) {} }
    log('⚡', '环世界终端 v1 接入中...');

    /* ── MVU 桥：读 stat_data / 写回 ── */
    function getMvuGlobal() {
        try { if (typeof window.Mvu !== 'undefined') return window.Mvu; } catch (e) {}
        try { if (typeof (window.Mvu || HOST.Mvu) !== 'undefined') return (window.Mvu || HOST.Mvu); } catch (e) {}
        return null;
    }
    function readState() {
        var m = getMvuGlobal();
        try {
            if (m && typeof m.getMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) return r.stat_data;
                if (r) return r;
            }
        } catch (e) { log('读态异常', e.message); }
        return (RW.engine && RW.engine.快照) || {};
    }
    function writeState(mutator, reason) {
        var m = getMvuGlobal();
        try {
            if (m && typeof m.getMvuData === 'function' && typeof m.replaceMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) {
                    mutator(r.stat_data);
                    m.replaceMvuData(r, reason || '环终端操作');
                    return true;
                }
            }
        } catch (e) { log('写态异常', e.message); }
        return false;
    }
    RW.readState = readState;
    RW.writeState = writeState;

    /* ═══════════════════ 1. 主题系统 ═══════════════════ */

    var THEMES = {
        'rimworld-dark': {
            bg: '#151a21', bg2: '#1c232d', bg3: '#242e3b', panel: '#202936',
            border: '#33404f', text: '#d8e2ec', dim: '#8496a8', accent: '#e8a33d',
            accent2: '#5fb4e5', good: '#6fbf5f', warn: '#e5c15f', bad: '#e05f5f',
            hp: '#c94f4f', mp: '#4f8fc9', xp: '#7fc94f', mapland: '#3a4a35', mapwater: '#2a3d52',
            mapsand: '#5c523a', mapsnow: '#a8b4bd', mapfog: '#0d1014', mapbuild: '#6b5d45'
        },
        'rimworld-light': {
            bg: '#e8e4da', bg2: '#f0ece3', bg3: '#f7f3ea', panel: '#fffdf7',
            border: '#c8c0ae', text: '#3a3226', dim: '#7a7060', accent: '#b8792a',
            accent2: '#2a7ab0', good: '#4a9a3a', warn: '#a8882a', bad: '#b03a3a',
            hp: '#b03a3a', mp: '#3a6ab0', xp: '#5a9a3a', mapland: '#8aa06a', mapwater: '#6a9aba',
            mapsand: '#c4b088', mapsnow: '#e8ecf0', mapfog: '#d0ccc0', mapbuild: '#9a8a6a'
        },
        'desert': {
            bg: '#2a221a', bg2: '#33291f', bg3: '#3d3225', panel: '#382d20',
            border: '#5a4a35', text: '#e8dcc8', dim: '#a08d70', accent: '#d4943a',
            accent2: '#c9a05f', good: '#8aa860', warn: '#c9a85f', bad: '#c95f4f',
            hp: '#b04f3f', mp: '#5f88a8', xp: '#88a84f', mapland: '#6a5a3a', mapwater: '#3a5268',
            mapsand: '#8a7852', mapsnow: '#c0c8cc', mapfog: '#1a1510', mapbuild: '#8a7a52'
        }
    };
    var currentTheme = localStorage_get('rw_theme') || 'rimworld-dark';
    function localStorage_get(k) { try { return HOST.localStorage.getItem(k); } catch (e) { return null; } }
    function localStorage_set(k, v) { try { HOST.localStorage.setItem(k, v); } catch (e) {} }

    function themeCss(name) {
        var t = THEMES[name] || THEMES['rimworld-dark'];
        var vars = '';
        for (var k in t) vars += '--rw-' + k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }) + ':' + t[k] + ';';
        return ':root{' + vars + '}';
    }

    var STYLE = document.createElement('style');
    STYLE.id = 'rw-terminal-style';
    STYLE.textContent = themeCss(currentTheme) + `
#rw-terminal-root * { box-sizing: border-box; margin: 0; padding: 0; }
#rw-terminal-root { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 13px; color: var(--rw-text); }
#rw-fab { position: fixed; right: 18px; bottom: 18px; width: 52px; height: 52px; border-radius: 50%;
  background: radial-gradient(circle at 32% 30%, var(--rw-bg3), var(--rw-bg)); border: 2px solid var(--rw-accent);
  cursor: pointer; z-index: 99998; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 14px rgba(0,0,0,.5), inset 0 1px 3px rgba(255,255,255,.08);
  transition: transform .25s, box-shadow .25s; user-select: none; }
#rw-fab:hover { transform: scale(1.08); box-shadow: 0 4px 20px rgba(232,163,61,.35); }
#rw-fab .fab-icon { font-size: 24px; }
#rw-fab .fab-badge { position: absolute; top: -3px; right: -3px; min-width: 17px; height: 17px; border-radius: 9px;
  background: var(--rw-bad); color: #fff; font-size: 10px; line-height: 17px; text-align: center; padding: 0 4px; display: none; }
#rw-panel { position: fixed; right: 18px; bottom: 80px; width: 860px; max-width: calc(100vw - 36px); height: 620px; max-height: calc(100vh - 110px);
  background: var(--rw-bg2); border: 1px solid var(--rw-border); border-radius: 10px; z-index: 99999;
  display: none; flex-direction: column; box-shadow: 0 8px 40px rgba(0,0,0,.6); overflow: hidden; }
#rw-panel.open { display: flex; }
.rw-topbar { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: var(--rw-bg);
  border-bottom: 1px solid var(--rw-border); flex-shrink: 0; }
.rw-topbar .tb-title { font-weight: bold; font-size: 15px; color: var(--rw-accent); letter-spacing: 1px; }
.rw-topbar .tb-info { flex: 1; display: flex; gap: 14px; align-items: center; font-size: 12px; color: var(--rw-dim); }
.rw-topbar .tb-info b { color: var(--rw-text); font-weight: 600; }
.rw-topbar .tb-btn { width: 28px; height: 28px; border: 1px solid var(--rw-border); border-radius: 6px; background: var(--rw-bg3);
  color: var(--rw-text); cursor: pointer; font-size: 13px; display: flex; align-items: center; justify-content: center; }
.rw-topbar .tb-btn:hover { border-color: var(--rw-accent); color: var(--rw-accent); }
.rw-body { flex: 1; display: flex; min-height: 0; }
.rw-tabrail { width: 132px; background: var(--rw-bg); border-right: 1px solid var(--rw-border);
  display: flex; flex-direction: column; padding: 6px 0; flex-shrink: 0; }
.rw-tab-btn { display: flex; align-items: center; gap: 8px; padding: 9px 14px; cursor: pointer; color: var(--rw-dim);
  border-left: 3px solid transparent; font-size: 13px; transition: background .15s; }
.rw-tab-btn:hover { background: var(--rw-bg3); color: var(--rw-text); }
.rw-tab-btn.active { background: var(--rw-bg3); color: var(--rw-accent); border-left-color: var(--rw-accent); font-weight: 600; }
.rw-tab-btn .tab-badge { margin-left: auto; background: var(--rw-bad); color: #fff; font-size: 10px; border-radius: 8px;
  padding: 0 5px; min-width: 15px; text-align: center; display: none; }
.rw-content { flex: 1; overflow-y: auto; padding: 14px; background: var(--rw-bg2); position: relative; }
.rw-content::-webkit-scrollbar { width: 8px; }
.rw-content::-webkit-scrollbar-thumb { background: var(--rw-border); border-radius: 4px; }
.rw-card { background: var(--rw-panel); border: 1px solid var(--rw-border); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.rw-card h3 { font-size: 13px; color: var(--rw-accent); margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px dashed var(--rw-border); }
.rw-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
.rw-bar { flex: 1; height: 14px; background: var(--rw-bg); border: 1px solid var(--rw-border); border-radius: 7px; overflow: hidden; position: relative; }
.rw-bar .bar-fill { height: 100%; border-radius: 6px; transition: width .4s; }
.rw-bar .bar-text { position: absolute; inset: 0; font-size: 10px; line-height: 13px; text-align: center; color: var(--rw-text); text-shadow: 0 1px 2px rgba(0,0,0,.7); }
.rw-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; border: 1px solid var(--rw-border); background: var(--rw-bg3); margin: 2px; }
.rw-tag.warn { border-color: var(--rw-warn); color: var(--rw-warn); }
.rw-tag.bad { border-color: var(--rw-bad); color: var(--rw-bad); }
.rw-tag.good { border-color: var(--rw-good); color: var(--rw-good); }
.rw-btn { padding: 5px 14px; border: 1px solid var(--rw-accent); border-radius: 6px; background: transparent; color: var(--rw-accent);
  cursor: pointer; font-size: 12px; transition: all .15s; }
.rw-btn:hover { background: var(--rw-accent); color: var(--rw-bg); }
.rw-btn.primary { background: var(--rw-accent); color: var(--rw-bg); font-weight: 600; }
.rw-btn.primary:hover { filter: brightness(1.12); }
.rw-btn:disabled { opacity: .4; cursor: not-allowed; }
#rw-map-canvas { display: block; border: 1px solid var(--rw-border); border-radius: 6px; cursor: crosshair; background: var(--rw-mapfog); }
.rw-map-hud { display: flex; gap: 14px; margin-top: 8px; font-size: 11px; color: var(--rw-dim); align-items: center; flex-wrap: wrap; }
.rw-map-legend { display: flex; gap: 8px; align-items: center; }
.rw-legend-dot { width: 11px; height: 11px; border-radius: 2px; display: inline-block; margin-right: 3px; vertical-align: -1px; border: 1px solid rgba(255,255,255,.15); }
.rw-colonist-card { display: flex; gap: 12px; }
.rw-colonist-portrait { width: 76px; height: 76px; border-radius: 8px; background: var(--rw-bg3); border: 1px solid var(--rw-border);
  display: flex; align-items: center; justify-content: center; font-size: 34px; flex-shrink: 0; }
.rw-colonist-main { flex: 1; min-width: 0; }
.rw-skill-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px 12px; margin-top: 6px; }
.rw-skill-item { display: flex; align-items: center; gap: 5px; font-size: 11px; }
.rw-skill-item .sk-name { width: 44px; color: var(--rw-dim); }
.rw-skill-item .sk-val { width: 30px; text-align: right; font-weight: 600; }
.rw-skill-item .sk-mini { flex: 1; height: 6px; background: var(--rw-bg); border-radius: 3px; overflow: hidden; }
.rw-skill-item .sk-mini i { display: block; height: 100%; background: var(--rw-accent2); border-radius: 3px; }
.rw-skill-item .sk-mini i.burning { background: var(--rw-good); }
.rw-skill-item .sk-mini i.hated { background: var(--rw-bad); }
.rw-bodypart-fig { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.rw-bodypart { font-size: 10px; padding: 2px 6px; border-radius: 3px; border: 1px solid var(--rw-border); background: var(--rw-bg); position: relative; }
.rw-bodypart .bp-hp { color: var(--rw-dim); }
.rw-bodypart.damaged { border-color: var(--rw-warn); color: var(--rw-warn); }
.rw-bodypart.destroyed { border-color: var(--rw-bad); color: var(--rw-bad); text-decoration: line-through; }
.rw-inventory-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.rw-inv-item { background: var(--rw-bg3); border: 1px solid var(--rw-border); border-radius: 6px; padding: 8px; font-size: 12px; }
.rw-inv-item .iv-name { color: var(--rw-text); }
.rw-inv-item .iv-num { float: right; color: var(--rw-accent); font-weight: 700; }
.rw-inv-item .iv-cat { font-size: 10px; color: var(--rw-dim); margin-top: 3px; }
.rw-modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 100000; display: none; align-items: center; justify-content: center; }
.rw-modal-mask.open { display: flex; }
.rw-modal { width: 620px; max-width: calc(100vw - 60px); max-height: 80vh; overflow-y: auto; background: var(--rw-bg2);
  border: 1px solid var(--rw-accent); border-radius: 10px; padding: 18px; box-shadow: 0 10px 60px rgba(0,0,0,.7); }
.rw-modal h2 { color: var(--rw-accent); font-size: 16px; margin-bottom: 12px; }
.rw-toast-wrap { position: fixed; top: 70px; right: 24px; z-index: 100001; display: flex; flex-direction: column; gap: 8px; }
.rw-toast { background: var(--rw-bg3); border: 1px solid var(--rw-accent); border-left-width: 4px; border-radius: 6px;
  padding: 9px 14px; font-size: 12px; color: var(--rw-text); box-shadow: 0 4px 18px rgba(0,0,0,.5);
  animation: rw-toast-in .3s ease; max-width: 340px; }
@keyframes rw-toast-in { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
.rw-toast.bad { border-color: var(--rw-bad); }
.rw-toast.good { border-color: var(--rw-good); }
.rw-toast.warn { border-color: var(--rw-warn); }
.rw-empty { text-align: center; color: var(--rw-dim); padding: 30px 0; font-size: 12px; }
.rw-research-node { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 1px solid var(--rw-border);
  border-radius: 6px; margin-bottom: 6px; background: var(--rw-bg3); font-size: 12px; }
.rw-research-node.locked { opacity: .5; }
.rw-research-node.done { border-color: var(--rw-good); }
.rw-research-node .rs-name { flex: 1; }
.rw-research-node .rs-cost { color: var(--rw-dim); font-size: 11px; }
.rw-research-node.current { border-color: var(--rw-accent,#e8a33d); background: rgba(232,163,61,.08); }
.rw-mod-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--rw-border);
  border-radius: 6px; margin-bottom: 6px; background: var(--rw-bg3); }
.rw-mod-row .md-name { flex: 1; }
.rw-mod-row .md-name small { display: block; color: var(--rw-dim); font-size: 10px; margin-top: 2px; }
.rw-switch { width: 36px; height: 19px; border-radius: 10px; background: var(--rw-bg); border: 1px solid var(--rw-border);
  position: relative; cursor: pointer; transition: background .2s; flex-shrink: 0; }
.rw-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%;
  background: var(--rw-dim); transition: all .2s; }
.rw-switch.on { background: var(--rw-accent); border-color: var(--rw-accent); }
.rw-switch.on::after { left: 19px; background: var(--rw-bg); }
.rw-log-entry { padding: 6px 0; border-bottom: 1px dashed var(--rw-border); font-size: 12px; }
.rw-log-entry .lg-meta { color: var(--rw-dim); font-size: 10px; }
.rw-quickbar { display: flex; gap: 8px; padding: 8px 14px; border-top: 1px solid var(--rw-border); background: var(--rw-bg); flex-shrink: 0; align-items: center; }
.rw-quickbar .qb-spacer { flex: 1; }
#rw-theme-menu { position: absolute; top: 40px; right: 10px; background: var(--rw-bg3); border: 1px solid var(--rw-border);
  border-radius: 8px; padding: 6px; display: none; z-index: 10; }
#rw-theme-menu.open { display: block; }
#rw-theme-menu .th-item { padding: 6px 14px; border-radius: 5px; cursor: pointer; font-size: 12px; white-space: nowrap; }
#rw-theme-menu .th-item:hover { background: var(--rw-bg); color: var(--rw-accent); }
`;
    document.head.appendChild(STYLE);

    /* ═══════════════════ 2. 地图引擎（Canvas 七层渲染栈） ═══════════════════ */

    var MapEngine = {
        canvas: null, ctx: null,
        tiles: null, W: 30, H: 22, TILE: 22,
        camX: 0, camY: 0, zoom: 1,
        hover: null, selected: null,
        layers: { 地形: true, 资源: true, 建筑: true, 动态: true, 战斗: true, 雾: true, UI: true },

        // WorldGen：LCG 种子 → biome 配色地形 + 矿脉撒点 + 河流（与环引擎同族 LCG，独立实例）
        generate: function (seed) {
            var s = (seed || 20260923) >>> 0;
            function rnd() { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }
            var W = this.W, H = this.H;
            var tiles = [];
            // 地形基底：值噪声近似（两层随机波场插值）
            var waveA = [], waveB = [];
            for (var i = 0; i < 8; i++) waveA.push({ x: rnd() * W, y: rnd() * H, r: 4 + rnd() * 9, v: rnd() });
            for (var j = 0; j < 5; j++) waveB.push({ x: rnd() * W, y: rnd() * H, r: 8 + rnd() * 14, v: rnd() });
            function field(x, y, waves) {
                var acc = 0, wsum = 0;
                for (var k = 0; k < waves.length; k++) {
                    var w = waves[k], dx = x - w.x, dy = y - w.y;
                    var d2 = dx * dx + dy * dy, r2 = w.r * w.r;
                    if (d2 < r2) { var f = 1 - d2 / r2; acc += w.v * f; wsum += f; }
                }
                return wsum ? acc / wsum : 0.4;
            }
            // 河流：从顶到底的蜿蜒线
            var riverX = 4 + rnd() * (W - 8);
            var river = [];
            for (var y = 0; y < H; y++) { riverX += (rnd() - 0.5) * 2.2; riverX = Math.max(2, Math.min(W - 3, riverX)); river.push(Math.floor(riverX)); }
            for (var yy = 0; yy < H; yy++) {
                var row = [];
                for (var xx = 0; xx < W; xx++) {
                    var e = field(xx, yy, waveA) * 0.65 + field(xx, yy, waveB) * 0.35;
                    var t = '草地';
                    if (e < 0.3) t = '沙地'; else if (e > 0.72) t = '石岩';
                    if (Math.abs(xx - river[yy]) <= 0) t = '河水';
                    else if (Math.abs(xx - river[yy]) === 1 && rnd() < 0.4) t = '河水';
                    row.push({ 地形: t, 海拔: Math.round(e * 100) });
                }
                tiles.push(row);
            }
            // 矿脉撒点（接环经济物资表：钢/组件机件/金/铀）
            var veins = [['钢材', 6], ['组件机件', 3], ['金', 2], ['铀', 1]];
            for (var v = 0; v < veins.length; v++) {
                for (var n = 0; n < veins[v][1]; n++) {
                    var mx = Math.floor(rnd() * W), my = Math.floor(rnd() * H);
                    if (tiles[my][mx].地形 === '河水') continue;
                    tiles[my][mx].矿脉 = veins[v][0];
                    tiles[my][mx].储量 = 40 + Math.floor(rnd() * 60);
                }
            }
            // 植物与野餐点（浆果丛/healroot）
            for (var p = 0; p < 14; p++) {
                var px = Math.floor(rnd() * W), py = Math.floor(rnd() * H);
                if (tiles[py][px].地形 === '草地' && !tiles[py][px].矿脉) {
                    tiles[py][px].植物 = rnd() < 0.5 ? '浆果丛' : '野药草';
                }
            }
            // 营地建筑（中央 4x3）
            var bx = Math.floor(W / 2) - 2, by = Math.floor(H / 2) - 1;
            for (var byy = by; byy < by + 3; byy++) for (var bxx = bx; bxx < bx + 4; bxx++) {
                tiles[byy][bxx].建筑 = (bxx === bx && byy === by) ? '营火' : (bxx === bx + 3 ? '储物区' : '木墙');
            }
            tiles[by + 1][bx + 1].建筑 = '床铺';
            this.tiles = tiles;
            this.seed = seed;
            return tiles;
        },

        // 七层渲染：地形/资源/建筑/动态/战斗/雾/UI
        render: function () {
            if (!this.canvas || !this.tiles) return;
            var ctx = this.ctx, T = this.TILE * this.zoom;
            var css = getComputedStyle(document.documentElement);
            function cv(name, fallback) { var v = css.getPropertyValue('--rw-' + name).trim(); return v || fallback; }
            var colors = { 草地: cv('mapland', '#3a4a35'), 河水: cv('mapwater', '#2a3d52'), 沙地: cv('mapsand', '#5c523a'), 石岩: cv('mapfog', '#0d1014'), 雪: cv('mapsnow', '#a8b4bd') };
            var W = this.W, H = this.H;
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.save();
            ctx.translate(-this.camX, -this.camY);
            // L1 地形
            if (this.layers.地形) {
                for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
                    var t = this.tiles[y][x];
                    ctx.fillStyle = colors[t.地形] || colors.草地;
                    ctx.fillRect(x * T, y * T, T - 1, T - 1);
                }
            }
            // L2 资源（矿脉/植物）
            if (this.layers.资源) {
                for (var y2 = 0; y2 < H; y2++) for (var x2 = 0; x2 < W; x2++) {
                    var t2 = this.tiles[y2][x2];
                    if (t2.矿脉) { ctx.fillStyle = '#d4af37'; ctx.font = (T * 0.55) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('⛏', x2 * T + T / 2, y2 * T + T * 0.7); }
                    else if (t2.植物) { ctx.fillStyle = '#7fbf5f'; ctx.font = (T * 0.5) + 'px sans-serif'; ctx.fillText(t2.植物 === '浆果丛' ? '❥' : '✿', x2 * T + T / 2, y2 * T + T * 0.7); }
                }
            }
            // L3 建筑
            if (this.layers.建筑) {
                for (var y3 = 0; y3 < H; y3++) for (var x3 = 0; x3 < W; x3++) {
                    var t3 = this.tiles[y3][x3];
                    if (t3.建筑) {
                        ctx.fillStyle = cv('mapbuild', '#6b5d45');
                        ctx.fillRect(x3 * T, y3 * T, T - 1, T - 1);
                        if (t3.建筑 === '营火') { ctx.fillStyle = '#ff8c3a'; ctx.beginPath(); ctx.arc(x3 * T + T / 2, y3 * T + T / 2, T * 0.22, 0, 7); ctx.fill(); }
                    }
                }
            }
            // L4 动态（Pawn 点：殖民者橙/敌人红）
            if (this.layers.动态) {
                var pawns = this.getPawns();
                for (var p = 0; p < pawns.length; p++) {
                    var pn = pawns[p];
                    ctx.beginPath();
                    ctx.arc(pn.x * T + T / 2, pn.y * T + T / 2, T * 0.28, 0, 7);
                    ctx.fillStyle = pn.边 === '敌方' ? '#e05f5f' : '#e8a33d';
                    ctx.fill();
                    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
                }
            }
            // L5 战斗叠加（射界/警报圈）
            if (this.layers.战斗 && this.combatOverlay) {
                var co = this.combatOverlay;
                ctx.strokeStyle = 'rgba(224,95,95,.5)';
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.arc(co.x * T + T / 2, co.y * T + T / 2, co.range * T, 0, 7);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            // L6 雾（未探索遮罩——v1 以视野半径 8 模拟）
            if (this.layers.雾) {
                var base = this.baseX != null ? this.baseX : Math.floor(W / 2), baseY = this.baseY != null ? this.baseY : Math.floor(H / 2);
                for (var y4 = 0; y4 < H; y4++) for (var x4 = 0; x4 < W; x4++) {
                    var dx = x4 - base, dy = y4 - baseY;
                    if (dx * dx + dy * dy > 64) { ctx.fillStyle = 'rgba(10,12,16,.55)'; ctx.fillRect(x4 * T, y4 * T, T - 1, T - 1); }
                }
            }
            // L7 UI（悬停高亮 + 选中框）
            if (this.hover) {
                ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5;
                ctx.strokeRect(this.hover.x * T, this.hover.y * T, T, T);
            }
            if (this.selected) {
                ctx.strokeStyle = cv('accent', '#e8a33d'); ctx.lineWidth = 2;
                ctx.strokeRect(this.selected.x * T + 1, this.selected.y * T + 1, T - 2, T - 2);
            }
            ctx.restore();
        },

        getPawns: function () {
            // 从状态读殖民者位置（v1：没有位置变量时撒在营地周边固定点）
            var st = readState();
            var out = [];
            var names = ['薇卡', '凯奥', '小满'];
            for (var i = 0; i < names.length; i++) {
                if (st[names[i]]) out.push({ 名: names[i], 边: '我方', x: (this.W / 2 - 2) + (i % 3), y: (this.H / 2) + 3 });
            }
            if (RW.combat && RW.combat.敌方位置) out = out.concat(RW.combat.敌方位置);
            return out;
        },

        tileInfo: function (x, y) {
            if (!this.tiles || !this.tiles[y] || !this.tiles[y][x]) return null;
            var t = this.tiles[y][x];
            var dx = x - Math.floor(this.W / 2), dy = y - Math.floor(this.H / 2);
            var dir = (dy < -2 ? '北' : dy > 2 ? '南' : '') + (dx > 2 ? '东' : dx < -2 ? '西' : '') || '营地内';
            var dist = Math.round(Math.sqrt(dx * dx + dy * dy));
            var lines = ['地形：' + t.地形 + '（海拔 ' + t.海拔 + '）', '方位：' + dir + '，距营地约 ' + dist + ' 格'];
            if (t.矿脉) lines.push('矿脉：' + t.矿脉 + ' × ' + t.储量);
            if (t.植物) lines.push('植物：' + t.植物);
            if (t.建筑) lines.push('建筑：' + t.建筑);
            return lines;
        },

        // AI 语义快照：格子数组 → 方位词+格数+地标 三要素（AI 永不读坐标）
        snapshot: function () {
            if (!this.tiles) return '（地图未生成）';
            var out = [], W = this.W, H = this.H;
            var veins = {}, plants = {}, buildings = [];
            for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
                var t = this.tiles[y][x];
                var dx = x - Math.floor(W / 2), dy = y - Math.floor(H / 2);
                var dir = (dy < -2 ? '北' : dy > 2 ? '南' : '') + (dx > 2 ? '东' : dx < -2 ? '西' : '') || '营地内';
                var dist = Math.round(Math.sqrt(dx * dx + dy * dy));
                if (t.矿脉) { var k = t.矿脉; (veins[k] = veins[k] || []).push(dir + '约' + dist + '格'); }
                if (t.植物) { var k2 = t.植物; (plants[k2] = plants[k2] || []).push(dir + '约' + dist + '格'); }
                if (t.建筑 === '营火') buildings.push('营地在地图中部');
            }
            for (var v in veins) out.push(v + '矿脉：' + veins[v].slice(0, 3).join('、') + (veins[v].length > 3 ? '等 ' + veins[v].length + ' 处' : '') + '，已探明');
            for (var p in plants) out.push(p + '：' + plants[p].slice(0, 2).join('、') + (plants[p].length > 2 ? '等 ' + plants[p].length + ' 处' : ''));
            var river = '一条河';
            out.push('地形：' + river + '蜿蜒穿过图幅中部；地形基底 ' + (this.tiles[0][0].地形 === '沙地' ? '偏干燥' : '植被良好'));
            return '【空间快照】' + out.join('；');
        }
    };
    if (!RW.map || !RW.map.ORE) RW.map = MapEngine; // 简版兜底：完整版（环地图.js）已在则不覆盖

    /* ═══════════════════ 3. 渲染函数群 ═══════════════════ */

    var currentTab = '地图';

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function bar(pct, color, text) {
        var p = Math.max(0, Math.min(100, pct || 0));
        return '<div class="rw-bar"><div class="bar-fill" style="width:' + p + '%;background:' + color + '"></div>' +
            (text ? '<div class="bar-text">' + esc(text) + '</div>' : '') + '</div>';
    }

    function renderTopbar(st) {
        var 世界 = (st && st.世界) || {}, 时间 = 世界.时间 || 世界 || {}, 财富 = (st && st.财富) || {};
        var 时段 = 时间.时段 || '上午', 日 = 时间.日 || 1, 季节 = 时间.季节 || '春', 年 = 时间.年 || 1;
        var 天气 = 世界.天气 || '晴';
        var total = 财富.合计 || 0;
        var stage = 世界.阶段 || '拓荒';
        return '<div class="tb-title">⛰ 环世界终端</div>' +
            '<div class="tb-info"><span>第 <b>' + esc(年) + '</b> 年 <b>' + esc(季节) + '</b>季 <b>' + esc(日) + '</b>日 · <b>' + esc(时段) + '</b></span>' +
            '<span>天气 <b>' + esc(天气) + '</b></span><span>阶段 <b>' + esc(stage) + '</b></span>' +
            '<span>财富 <b>' + esc(total) + '</b></span></div>';
    }

    // Tab：地图（第一屏）
    function renderMapTab(st) {
        var html = '<div class="rw-card"><h3>🗺 局部地图（点击格子查看情报）</h3>' +
            '<canvas id="rw-map-canvas" width="660" height="484"></canvas>' +
            '<div class="rw-map-hud"><span>种子 ' + esc(RW.map.seed || '-') + '</span>' +
            '<span>缩放 <b id="rw-zoom-val">' + RW.map.zoom.toFixed(1) + 'x</b></span>' +
            '<button class="rw-btn" id="rw-map-zoomin">＋</button><button class="rw-btn" id="rw-map-zoomout">－</button>' +
            '<button class="rw-btn" id="rw-map-regen">重生成</button>' +
            '<span class="rw-map-legend"><span><i class="rw-legend-dot" style="background:var(--rw-mapland)"></i>草地</span>' +
            '<span><i class="rw-legend-dot" style="background:var(--rw-mapwater)"></i>河水</span>' +
            '<span><i class="rw-legend-dot" style="background:var(--rw-mapsand)"></i>沙地</span>' +
            '<span>⛏矿脉 · ❥浆果 · ✿药草</span></span></div>' +
            '<div id="rw-map-info" class="rw-card" style="margin-top:10px;background:var(--rw-bg3)"><div class="rw-empty">点击地图格子查看情报（AI 的空间认知也来自这里的语义快照）</div></div></div>';
        return html;
    }

    function bindMapTab() {
        var canvas = document.getElementById('rw-map-canvas');
        if (!canvas) return;
        RW.map.canvas = canvas;
        RW.map.ctx = canvas.getContext && canvas.getContext('2d');
        if (!RW.map.ctx) return;
        var __rs = readState(); if (!__rs || !__rs.世界) { RW.map.generate(null); } else RW.map.generate(__rs.世界 && __rs.世界.设置 && __rs.世界.设置.种子);
        RW.map.render();
        canvas.addEventListener('mousemove', function (e) {
            var r = canvas.getBoundingClientRect();
            var T = RW.map.TILE * RW.map.zoom;
            var x = Math.floor((e.clientX - r.left + RW.map.camX) / T);
            var y = Math.floor((e.clientY - r.top + RW.map.camY) / T);
            RW.map.hover = { x: x, y: y };
            RW.map.render();
        });
        canvas.addEventListener('mouseleave', function () { RW.map.hover = null; RW.map.render(); });
        canvas.addEventListener('click', function (e) {
            var r = canvas.getBoundingClientRect();
            var T = RW.map.TILE * RW.map.zoom;
            var x = Math.floor((e.clientX - r.left + RW.map.camX) / T);
            var y = Math.floor((e.clientY - r.top + RW.map.camY) / T);
            RW.map.selected = { x: x, y: y };
            RW.map.render();
            var info = RW.map.tileInfo(x, y);
            var box = document.getElementById('rw-map-info');
            if (box) box.innerHTML = info ? info.map(function (l) { return '<div>• ' + esc(l) + '</div>'; }).join('') : '<div class="rw-empty">图幅外</div>';
        });
        var zi = document.getElementById('rw-map-zoomin'), zo = document.getElementById('rw-map-zoomout'), rg = document.getElementById('rw-map-regen');
        if (zi) zi.onclick = function () { RW.map.zoom = Math.min(3, RW.map.zoom + 0.25); renderCurrent(); };
        if (zo) zo.onclick = function () { RW.map.zoom = Math.max(0.6, RW.map.zoom - 0.25); renderCurrent(); };
        if (rg) rg.onclick = function () { RW.map.generate((Math.random() * 1e9) | 0); renderCurrent(); toast('地图已按新种子重生成', 'good'); };
    }

    // Tab：殖民者
    var SKILL_NAMES = ['射击', '近战', '种植', '采矿', '建造', '修理', '医疗', '社交', '动物', '烹饪', '艺术', '研究'];
    function renderColonistTab(st) {
        var names = ['薇卡', '凯奥', '祝小满'];
        var portraits = { '薇卡': '👩‍⚕️', '凯奥': '👨‍🌾', '祝小满': '🔧' };
        var stages = { '薇卡': ['观察对象', '参照标准', '唯一变量'], '凯奥': ['礼貌协作', '兄弟', '无条件托付'], '祝小满': ['讨原型', '信任', '黏人占有欲'] };
        var html = '';
        for (var i = 0; i < names.length; i++) {
            var n = names[i], p = (st && st[n]) || {};
            var skills = p.技能 || {};
            var mood = p.心情 != null ? p.心情 : 50;
            var stage = p.关系阶段 || stages[n][0];
            var stageIdx = stages[n].indexOf(stage);
            var traits = p.特质 || [];
            var moodColor = mood >= 60 ? 'var(--rw-good)' : mood >= 30 ? 'var(--rw-warn)' : 'var(--rw-bad)';
            html += '<div class="rw-card"><h3>👤 你（殖民队第四人·默认唯一男性）</h3><div class="cx-line">身份：' + esc((st.玩家 && st.玩家.身份) || '殖民队队长') + '</div><div class="cx-line">特长：' + esc((st.玩家 && st.玩家.技能倾向) || '开局向导可定制') + '</div><div class="cx-line" style="color:var(--rw-dim)">你是小队的指挥者，也是干活的一员——三人组会等你拿主意，也会看着你干活。</div></div>';
            html += '<div class="rw-card"><h3>' + portraits[n] + ' ' + esc(n) +
                ' <span class="rw-tag" style="margin-left:6px">关系阶段 ' + esc(stage) + '</span>' +
                (p.年龄 ? '<span class="rw-tag">' + esc(p.年龄) + '岁</span>' : '') + '</h3>' +
                '<div class="rw-colonist-card"><div class="rw-colonist-portrait">' + portraits[n] + '</div>' +
                '<div class="rw-colonist-main">' +
                '<div class="rw-row"><span style="width:34px;font-size:11px;color:var(--rw-dim)">心情</span>' + bar(mood, moodColor, mood + '') + '</div>' +
                '<div class="rw-skill-grid">';
            for (var s = 0; s < SKILL_NAMES.length; s++) {
                var sk = skills[SKILL_NAMES[s]] || {};
                var lv = sk.等级 != null ? sk.等级 : (typeof sk === 'number' ? sk : 0);
                var passion = sk.热情 || '无';
                var cls = passion === '燃烧' ? 'burning' : passion === '厌恶' ? 'hated' : '';
                html += '<div class="rw-skill-item"><span class="sk-name">' + SKILL_NAMES[s] + '</span>' +
                    '<span class="sk-val">' + lv + '</span><span class="sk-mini"><i class="' + cls + '" style="width:' + (lv / 20 * 100) + '%"></i></span></div>';
            }
            html += '</div></div></div>';
            // 健康部位图
            var body = p.健康 || {};
            var parts = ['头', '躯干', '左臂', '右臂', '左腿', '右腿', '心', '肺', '肝', '肾', '胃', '眼(左)', '眼(右)'];
            html += '<div class="rw-row" style="margin-top:8px"><span style="font-size:11px;color:var(--rw-dim)">健康</span><div class="rw-bodypart-fig">';
            for (var b = 0; b < parts.length; b++) {
                var bp = body[parts[b]];
                var hp = bp && bp.HP != null ? bp.HP : (typeof bp === 'number' ? bp : null);
                var cls2 = hp == null ? '' : (hp <= 0 ? 'destroyed' : hp < 20 ? 'damaged' : '');
                html += '<span class="rw-bodypart ' + cls2 + '">' + parts[b] + ' <span class="bp-hp">' + (hp == null ? '—' : hp) + '</span></span>';
            }
            html += '</div></div>';
            // 想法堆栈（E2：带时长修正逐条显示）
            var thoughts = p.想法堆栈 || [];
            if (thoughts.length) {
                html += '<div class="rw-row" style="margin-top:6px"><span style="font-size:11px;color:var(--rw-dim)">想法</span><span style="flex:1;display:flex;flex-wrap:wrap;gap:3px">';
                for (var th = 0; th < thoughts.length; th++) {
                    var T2 = thoughts[th];
                    var sign = (T2.修正 || 0) >= 0;
                    html += '<span class="rw-tag ' + (sign ? 'good' : 'bad') + '">' + esc(T2.标签 || '?') + ' ' + (sign ? '+' : '') + (T2.修正 || 0) + ' <small style="opacity:.6">(余' + (T2.剩余 || 0) + ')</small></span>';
                }
                html += '</span></div>';
            }
            // 疾病状态
            if (p.疾病 && p.疾病.名称) {
                var dis = p.疾病;
                html += '<div class="rw-row" style="margin-top:4px"><span style="font-size:11px;color:var(--rw-dim)">疾病</span>' +
                    bar(Math.round(dis.严重度 || 0), 'var(--rw-bad)', dis.名称 + ' 严重度 ' + Math.round(dis.严重度 || 0) + '%') +
                    bar(Math.round(dis.免疫 || 0), 'var(--rw-accent2)', '免疫 ' + Math.round(dis.免疫 || 0) + '%') + '</div>';
            }
            // 特质与关系
            if (traits.length) html += '<div class="rw-row"><span style="font-size:11px;color:var(--rw-dim)">特质</span>' + traits.map(function (t) { return '<span class="rw-tag">' + esc(t) + '</span>'; }).join('') + '</div>';
            html += '</div>';
        }
        return html;
    }

    // Tab：持有
    function renderHoldTab(st) {
        var inv = (st && st.库存) || {};
        var cats = [['物资', '📦'], ['弹药', '🔫'], ['食物', '🍖'], ['药品', '💊']];
        var html = '<div class="rw-card"><h3>🎒 装备槽位</h3><div class="rw-row">' +
            ['武器', '头部', '躯干', '腿部', '饰品'].map(function (s) {
                var eq = (st && st.装备 && st.装备[s]) || null;
                return '<span class="rw-tag ' + (eq ? 'good' : '') + '" style="padding:6px 12px">' + s + '：' + (eq ? esc(typeof eq === 'string' ? eq : eq.名称 || '已装备') : '空') + '</span>';
            }).join('') + '</div></div>';
        for (var c = 0; c < cats.length; c++) {
            var cat = cats[c][0], items = inv[cat] || {};
            var keys = Object.keys(items);
            html += '<div class="rw-card"><h3>' + cats[c][1] + ' ' + cat + '</h3>';
            if (!keys.length) html += '<div class="rw-empty">空（物质守恒：有增必有减，一切来历可查）</div>';
            else {
                html += '<div class="rw-inventory-grid">';
                for (var k = 0; k < keys.length; k++) {
                    html += '<div class="rw-inv-item"><span class="iv-name">' + esc(keys[k]) + '</span><span class="iv-num">' + esc(items[keys[k]]) + '</span><div class="iv-cat">' + cat + '</div></div>';
                }
                html += '</div>';
            }
            html += '</div>';
        }
        return html;
    }

    // Tab：任务/事件
    function renderTaskTab(st) {
        var events = (st && st.事件记录) || [];
        var threats = (st && st.$事件冷却) || {};
        var html = '<div class="rw-card"><h3>⚔️ 威胁态势</h3>';
        var cdKeys = Object.keys(threats || {});
        if (!cdKeys.length) html += '<div class="rw-empty">当前无活跃威胁（事件调度器每半天掷一次权重池）</div>';
        else for (var i = 0; i < cdKeys.length; i++) html += '<div class="rw-row"><span class="rw-tag bad">' + esc(cdKeys[i]) + '</span><span style="font-size:11px;color:var(--rw-dim)">冷却剩余 ' + esc(threats[cdKeys[i]]) + ' 个半天</span></div>';
        html += '</div>';
        html += '<div class="rw-card"><h3>📜 事件记录</h3>';
        if (!events.length) html += '<div class="rw-empty">暂无记录</div>';
        else for (var e = events.length - 1; e >= Math.max(0, events.length - 20); e--) {
            var ev = typeof events[e] === 'string' ? events[e] : JSON.stringify(events[e]);
            html += '<div class="rw-log-entry">' + esc(ev) + '</div>';
        }
        html += '</div>';
        return html;
    }

    // Tab：研究
    function renderResearchTab(st) {
        var done = ((st && st.研究 && st.研究.已完成) || '').split('、').filter(Boolean);
        var eng = HOST.Rimworld && HOST.Rimworld.经济;
        var cur2 = (st && st.研究 && st.研究.当前项目) || '待选择';
        var html = '<div class="rw-card"><h3>🔬 研究树（原版锚定 26 项，按科技上限裁剪）</h3>' +
            '<div style="font-size:11px;color:var(--rw-dim);margin-bottom:8px">当前项目：<b style="color:var(--rw-accent,#e8a33d)">' + esc(cur2) + '</b>（点击可指派的条目切换；每推进半天，智识最高的殖民者自动推进进度，完成即解锁对应工作台与配方）</div>';
        var TREE = [
            ['锻造', 700, []], ['长刃', 400, ['锻造']], ['切石', 300, []],
            ['机械加工', 1000, ['锻造']], ['枪械制造', 500, ['机械加工']], ['后坐操作', 500, ['枪械制造']], ['导气操作', 1000, ['后坐操作']],
            ['弹药制造', 500, ['机械加工']],
            ['药品生产', 500, []], ['精神药物精炼', 400, ['药品生产']], ['Go-juice', 1000, ['精神药物精炼']], ['佩诺西林', 500, ['药品生产']],
            ['电力', 1600, []], ['电池', 400, ['电力']], ['生物燃料精炼', 700, ['电力']], ['空调', 500, ['电力']], ['水培', 700, ['电力']],
            ['微电子基础', 3000, ['电力']], ['复杂服装', 600, []], ['布艺', 400, []]
        ];
        for (var i = 0; i < TREE.length; i++) {
            var name = TREE[i][0], cost = TREE[i][1], pre = TREE[i][2];
            var isDone = done.indexOf(name) >= 0;
            var preOk = pre.every(function (p) { return done.indexOf(p) >= 0; });
            var cur = (st && st.研究 && st.研究.当前项目) || '待选择';
            var isCur = cur === name;
            var prog = (st && st.研究 && st.研究.进度) || 0;
            html += '<div class="rw-research-node ' + (isDone ? 'done' : preOk ? '' : 'locked') + (isCur ? ' current' : '') + '" ' + (!isDone && preOk ? 'data-research="' + esc(name) + '" style="cursor:pointer"' : '') + '>' +
                '<span style="width:16px">' + (isDone ? '✅' : preOk ? '🔬' : '🔒') + '</span>' +
                '<span class="rs-name">' + esc(name) + (isCur ? ' <span class="rw-tag good">研究ing ' + Math.round(prog) + '%</span>' : '') + (pre.length ? ' <small style="color:var(--rw-dim)">前置：' + pre.join('、') + '</small>' : '') + '</span>' +
                '<span class="rs-cost">' + cost + ' 点</span>' + (isDone ? '<span class="rw-tag good">已完成</span>' : (!isDone && preOk ? '<span class="rw-tag">点击指派</span>' : '')) + '</div>';
        }
        html += '</div>';
        return html;
    }

    // Tab：模组
    function renderModTab(st) {
        var mods = (st && st.模组 && st.模组.已安装) || {};
        var list = [
            ['皇权', 'Royalty｜灵能/头衔/任务链', true],
            ['意识形态', 'Ideology｜信仰/仪式/圣物/职位', true],
            ['生物科技', 'Biotech｜生育/基因/xenotype/机械体', true],
            ['异象', 'Anomaly｜恐怖实体/收容/虚空终局', true],
            ['奥德赛', 'Odyssey｜重力飞舰/4 新 biome/轨道探索', true],
            ['文风_母猪', 'NSFW 文风包：母猪（默认关，手动开）', false],
            ['文风_淫视', 'NSFW 文风包：淫视（默认关，手动开）', false],
            ['文风_骚妈', 'NSFW 文风包：骚妈（默认关，手动开）', false],
            ['装备强化', '强化四段式+垫子保底（原版无强化，模组补全）', false],
            ['炼金扩展', '炼丹小游戏：炉温/纯度/药效/炸炉风险', false],
        ];
        var html = '<div class="rw-card"><h3>🧩 模组管理（对齐 RimWorld mod list）</h3>' +
            '<div style="font-size:11px;color:var(--rw-dim);margin-bottom:8px">DLC 默认全装；工坊包可装可卸，卸载后相关条目（@@if 门控）自动离开 prompt，世界即时响应</div>';
        for (var i = 0; i < list.length; i++) {
            var id = list[i][0], desc = list[i][1], dft = list[i][2];
            var on = mods[id] != null ? mods[id] : dft;
            html += '<div class="rw-mod-row"><div class="md-name">' + esc(id.replace(/^(DLC|工坊)_/, '')) + '<small>' + esc(desc) + '</small></div>' +
                '<div style="display:flex;align-items:center"><div class="rw-switch ' + (on ? 'on' : '') + '" data-mod="' + esc(id) + '"></div><span class="rw-tag ' + (on ? 'good' : '') + '" style="margin-left:6px;font-size:10px">' + (on ? '已启用' : '已停用') + '</span></div></div>';
        }
        html += '</div>';
        return html;
    }

    // Tab：日志
    function renderLogTab(st) {
        var logs = (st && st.$流水账) || [];
        var html = '<div class="rw-card"><h3>📒 物质流水账（守恒铁律：每笔增减带事由）</h3>';
        if (!logs.length) html += '<div class="rw-empty">暂无流水（一切变动都会在这里留痕）</div>';
        else for (var i = logs.length - 1; i >= Math.max(0, logs.length - 30); i--) {
            var L = logs[i];
            if (typeof L === 'string') { html += '<div class="rw-log-entry">' + esc(L) + '</div>'; continue; }
            html += '<div class="rw-log-entry"><span class="lg-meta">[第' + esc(L.楼层 || '?') + '楼·' + esc(L.事由 || '?') + ']</span> ' +
                esc(L.物品 || '?') + ' ' + (L.方向 === '减' ? '<b style="color:var(--rw-bad)">-' : '<b style="color:var(--rw-good)">+') + esc(L.数量) + '</b></div>';
        }
        html += '</div>';
        return html;
    }

    // Tab：世界（设定总览）
    function renderWorldTab(st) {
        var w = (st && st.世界) || {}, set = w.设置 || {};
        var rows = [['biome', set.biome || '温带森林'], ['难度', set.难度 || '冒险故事'], ['讲述者', set.讲述者 || '卡桑德拉'], ['科技上限', set.科技上限 || '太空'], ['种子', String(set.种子 || '$种子')]];
        var html = '<div class="rw-card"><h3>🌍 世界设定（开局确定后不可变）</h3>';
        for (var i = 0; i < rows.length; i++) html += '<div class="rw-row"><span style="width:80px;color:var(--rw-dim);font-size:11px">' + rows[i][0] + '</span><b>' + esc(rows[i][1]) + '</b></div>';
        html += '</div>';
        html += '<div class="rw-card"><h3>👥 派系关系（-100~+100）</h3>';
        var facs = (st && st.派系) || {};
        var fk = Object.keys(facs);
        if (!fk.length) html += '<div class="rw-empty">派系数据未初始化</div>';
        else for (var f = 0; f < fk.length; f++) {
            var v = typeof facs[fk[f]] === 'number' ? facs[fk[f]] : 0;
            html += '<div class="rw-row"><span style="width:110px;font-size:12px">' + esc(fk[f]) + '</span>' + bar((v + 100) / 2, v >= 0 ? 'var(--rw-good)' : 'var(--rw-bad)', String(v)) + '</div>';
        }
        html += '</div>';
        html += '<div class="rw-card"><h3>🧠 AI 空间快照（注入给 AI 的语义摘要，实时生成）</h3>' +
            '<div style="font-size:11px;line-height:1.7;color:var(--rw-dim)">' + esc(RW.map.snapshot()) + '</div></div>';
        return html;
    }

    /* ═══════════════════ 4. 面板框架与 Tab 切换 ═══════════════════ */

    var TABS = [
        ['地图', '🗺'], ['殖民者', '👤'], ['持有', '🎒'], ['任务', '⚔️'],
        ['研究', '🔬'], ['模组', '🧩'], ['日志', '📒'], ['世界', '🌍']
    ];

    function buildPanel() {
        if (document.getElementById('rw-panel')) return;
        var root = document.createElement('div');
        root.id = 'rw-terminal-root';
        root.innerHTML =
            '<div id="rw-fab"><span class="fab-icon">⛰</span><span class="fab-badge" id="rw-fab-badge"></span></div>' +
            '<div id="rw-panel">' +
            '<div class="rw-topbar" id="rw-topbar"></div>' +
            '<div style="position:relative"><div id="rw-theme-menu"></div></div>' +
            '<div class="rw-body"><div class="rw-tabrail" id="rw-tabrail"></div><div class="rw-content" id="rw-content"></div></div>' +
            '<div class="rw-quickbar" id="rw-quickbar"></div>' +
            '</div>' +
            '<div class="rw-modal-mask" id="rw-modal-mask"><div class="rw-modal" id="rw-modal"></div></div>' +
            '<div class="rw-toast-wrap" id="rw-toast-wrap"></div>';
        document.body.appendChild(root);
        // Tab rail
        var rail = root.querySelector('#rw-tabrail');
        var railHtml = '';
        for (var i = 0; i < TABS.length; i++) railHtml += '<div class="rw-tab-btn" data-tab="' + TABS[i][0] + '"><span>' + TABS[i][1] + '</span>' + TABS[i][0] + '<span class="tab-badge"></span></div>';
        rail.innerHTML = railHtml;
        rail.addEventListener('click', function (e) {
            var btn = e.target.closest('.rw-tab-btn');
            if (!btn) return;
            currentTab = btn.getAttribute('data-tab');
            renderCurrent();
        });
        // 模组开关点击（写回 模组.已安装.* → @@if 门控条目即时生效）
        root.addEventListener('click', function (e) {
            var sw = e.target.closest('.rw-switch');
            if (!sw || !sw.getAttribute('data-mod')) return;
            var id = sw.getAttribute('data-mod');
            var ok = writeState(function (s) {
                s.模组 = s.模组 || {}; s.模组.已安装 = s.模组.已安装 || {};
                s.模组.已安装[id] = s.模组.已安装[id] ? 0 : 1;
            }, '模组开关：' + id);
            toast(ok ? (id + ' 已' + (sw.classList.contains('on') ? '停用' : '启用') + '（对应内容' + (sw.classList.contains('on') ? '不再' : '开始') + '进入 AI 上下文）') : '写回失败', ok ? 'good' : 'bad');
            renderCurrent();
        });
        // 研究指派（写 研究.当前项目，进度由环结算每半天推进）
        root.addEventListener('click', function (e) {
            var rn = e.target.closest('[data-research]');
            if (!rn) return;
            var name = rn.getAttribute('data-research');
            var ok = writeState(function (s) {
                s.研究 = s.研究 || { 已完成: '', 当前项目: '待选择', 进度: 0 };
                s.研究.当前项目 = s.研究.当前项目 === name ? '待选择' : name;
                if (s.研究.当前项目 === '待选择') s.研究.进度 = 0;
            }, '研究指派：' + name);
            toast(ok ? '研究指派：' + name : '写回失败', ok ? 'good' : 'bad');
            renderCurrent();
        });
        // Fab 开关
        var fab = root.querySelector('#rw-fab'), panel = root.querySelector('#rw-panel');
        var dragging = false, moved = false, sx = 0, sy = 0;
        fab.addEventListener('mousedown', function (e) { dragging = true; moved = false; sx = e.clientX; sy = e.clientY; });
        HOST.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            var dx = e.clientX - sx, dy = e.clientY - sy;
            if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
            fab.style.right = Math.max(4, parseInt(fab.style.right || 18) - dx) + 'px';
            fab.style.bottom = Math.max(4, parseInt(fab.style.bottom || 18) - dy) + 'px';
            sx = e.clientX; sy = e.clientY;
        });
        HOST.addEventListener('mouseup', function () {
            if (dragging && !moved) togglePanel();
            dragging = false;
        });
        // 主题菜单
        var tbMenuBtnPlace = root.querySelector('#rw-topbar');
        bindQuickbar(root);
        root.querySelector('#rw-modal-mask').addEventListener('click', function (e) {
            if (e.target === this) this.classList.remove('open');
        });
        renderTop();
        renderCurrent();
    }

    function bindQuickbar(root) {
        var qb = root.querySelector('#rw-quickbar');
        qb.innerHTML = '<button class="rw-btn primary" id="rw-advance">⏩ 推进半天</button>' +
            '<button class="rw-btn" id="rw-settle">📊 结算摘要</button>' +
            '<button class="rw-btn" id="rw-combat">⚔ 战斗</button>' +
            '<button class="rw-btn" id="rw-codex">📖 百科</button>' +
            '<button class="rw-btn" id="rw-workshop">🔧 工坊</button>' +
            '<button class="rw-btn" id="rw-wizard">🌍 开局</button>' +
            '<button class="rw-btn" id="rw-craft">⚗️ 制造</button>' +
            '<button class="rw-btn" id="rw-caravan">🐴 远行</button>' +
            '<button class="rw-btn" id="rw-farm">🌾 种植</button>' +
            '<button class="rw-btn" id="rw-trade">💰 贸易</button>' +
            '<button class="rw-btn" id="rw-thermal">🌡 温度</button>' +
            '<span class="qb-spacer"></span>' +
            '<button class="rw-btn" id="rw-theme-btn">🎨 主题</button>';
        qb.querySelector('#rw-advance').onclick = function () {
            var ok = writeState(function (st) {
                var eng = RW.engine;
                if (eng && typeof eng.推进半天 === 'function') {
                    var t = st.世界.时间 || st.世界;
                    var nt = eng.推进半天(t);
                    Object.assign(st.世界, nt);
                } else {
                    // 独立降级实现
                    var t2 = st.世界;
                    if (t2.时段 === '上午') t2.时段 = '下午'; else { t2.时段 = '上午'; t2.日 = (t2.日 || 1) + 1; t2.日计数 = (t2.日计数 || t2.日); }
                }
                RW.lastAdvance = Date.now();
            }, '终端推进半天');
            // 双保险：写回后显式跑完整结算管线（E2状态机+事件调度+守恒+快照），不只依赖事件回调
            if (ok && RW.settleOnce) {
                try { var sr = RW.settleOnce(true); if (sr && sr.摘要) toast('结算: ' + sr.摘要[0], 'good'); } catch (e) {}
            }
            toast(ok ? '时间推进：系统已结算' : '写回失败（MVU 未就绪）', ok ? 'good' : 'bad');
            renderTop(); renderCurrent();
        };
        qb.querySelector('#rw-settle').onclick = function () {
            var snap = RW.map.snapshot();
            openModal('📊 空间快照（注入给 AI）', '<div style="font-size:12px;line-height:1.8">' + esc(snap) + '</div>');
        };
        qb.querySelector('#rw-combat').onclick = function () {
            if (RW.combatPanel && RW.combatPanel.open) RW.combatPanel.open();
            else toast('战斗面板脚本未加载', 'bad');
        };
        qb.querySelector('#rw-codex').onclick = function () {
            if (RW.codex && RW.codex.open) RW.codex.open();
            else toast('百科脚本未加载', 'bad');
        };
        qb.querySelector('#rw-workshop').onclick = function () {
            if (RW.workshop && RW.workshop.open) RW.workshop.open();
            else toast('工坊脚本未加载', 'bad');
        };
        qb.querySelector('#rw-wizard').onclick = function () {
            if (RW.wizard && RW.wizard.open) RW.wizard.open();
            else toast('开局向导脚本未加载', 'bad');
        };
        qb.querySelector('#rw-craft').onclick = function () {
            if (RW.craftBench && RW.craftBench.open) RW.craftBench.open();
            else toast('制造台脚本未加载', 'bad');
        };
        qb.querySelector('#rw-caravan').onclick = function () {
            if (RW.caravan && RW.caravan.open) RW.caravan.open();
            else toast('远行队脚本未加载', 'bad');
        };
        qb.querySelector('#rw-farm').onclick = function () {
            if (RW.farm && RW.farm.open) RW.farm.open();
            else toast('种植脚本未加载', 'bad');
        };
        qb.querySelector('#rw-trade').onclick = function () {
            if (RW.trade && RW.trade.open) RW.trade.open();
            else toast('贸易脚本未加载', 'bad');
        };
        qb.querySelector('#rw-thermal').onclick = function () {
            if (RW.thermal && RW.thermal.open) RW.thermal.open();
            else toast('温度脚本未加载', 'bad');
        };
        var themeBtn = qb.querySelector('#rw-theme-btn');
        themeBtn.onclick = function () {
            var menu = document.getElementById('rw-theme-menu');
            var names = Object.keys(THEMES);
            var label = { 'rimworld-dark': '🕯 环世界暗夜', 'rimworld-light': '☀️ 环世界亮色', 'desert': '🏜 荒漠' };
            var h = '';
            for (var i = 0; i < names.length; i++) h += '<div class="th-item" data-th="' + names[i] + '">' + (label[names[i]] || names[i]) + '</div>';
            menu.innerHTML = h;
            menu.classList.toggle('open');
            if (!menu.dataset.bound) {
                menu.dataset.bound = '1';
                menu.addEventListener('click', function (e) {
                    var it = e.target.closest('.th-item');
                    if (!it) return;
                    currentTheme = it.getAttribute('data-th');
                    localStorage_set('rw_theme', currentTheme);
                    document.getElementById('rw-terminal-style').textContent = themeCss(currentTheme) + STYLE.textContent.split(':root{')[1] ? themeCss(currentTheme) + STYLE.textContent.slice(STYLE.textContent.indexOf('\n')) : '';
                    // 重新注入样式（简单可靠：整段重生成）
                    var base = STYLE.textContent;
                    var idx = base.indexOf('\n');
                    STYLE.textContent = themeCss(currentTheme) + base.slice(idx);
                    menu.classList.remove('open');
                    toast('主题已切换', 'good');
                });
            }
        };
    }

    function renderTop() {
        var el = document.getElementById('rw-topbar');
        if (!el) return;
        var st = readState();
        el.innerHTML = renderTopbar(st) +
            '<button class="tb-btn" id="rw-refresh" title="刷新">⟳</button>' +
            '<button class="tb-btn" id="rw-theme2" title="主题">🎨</button>' +
            '<button class="tb-btn" id="rw-close" title="关闭">✕</button>';
        el.querySelector('#rw-refresh').onclick = function () { renderTop(); renderCurrent(); toast('已刷新', 'good'); };
        el.querySelector('#rw-close').onclick = function () { document.getElementById('rw-panel').classList.remove('open'); };
        el.querySelector('#rw-theme2').onclick = function () { document.getElementById('rw-theme-menu').classList.toggle('open'); };
    }

    function renderCurrent() {
        var content = document.getElementById('rw-content');
        if (!content) return;
        var st = readState();
        if (!st || !st.世界) {
            content.innerHTML = '<div class="rw-card"><h3>⏳ 状态未就绪</h3><div style="font-size:12px;color:var(--rw-dim);line-height:1.8">MVU 变量尚未初始化。请先发送一条消息（任意内容），MVU 框架会写入初始状态；之后重新打开终端即可。</div></div>';
            return;
        }
        var fns = { '地图': [renderMapTab, bindMapTab], '殖民者': renderColonistTab, '持有': renderHoldTab, '任务': renderTaskTab, '研究': renderResearchTab, '模组': renderModTab, '日志': renderLogTab, '世界': renderWorldTab };
        var f = fns[currentTab];
        content.innerHTML = typeof f === 'object' ? f[0](st) : f(st);
        // 高亮 active tab
        var btns = document.querySelectorAll('.rw-tab-btn');
        for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-tab') === currentTab);
        if (typeof f === 'object') f[1](st);
        // 模组开关绑定
        var switches = content.querySelectorAll('.rw-switch[data-mod]');
        for (var s = 0; s < switches.length; s++) {
            switches[s].onclick = function () {
                var id = this.getAttribute('data-mod');
                var self = this;
                writeState(function (stt) {
                    stt.模组 = stt.模组 || { 已安装: {} };
                    stt.模组.已安装[id] = !stt.模组.已安装[id];
                }, '终端切换模组 ' + id);
                this.classList.toggle('on');
                toast('模组 ' + id + (self.classList.contains('on') ? ' 已卸载' : ' 已安装'), 'warn');
            };
        }
    }

    /* ═══════════════════ 5. 通知与弹窗 ═══════════════════ */

    function toast(msg, kind) {
        var wrap = document.getElementById('rw-toast-wrap');
        if (!wrap) return;
        var el = document.createElement('div');
        el.className = 'rw-toast ' + (kind || '');
        el.textContent = msg;
        wrap.appendChild(el);
        setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 3200);
        setTimeout(function () { el.remove(); }, 3700);
    }
    RW.toast = toast;

    function openModal(title, html) {
        var mask = document.getElementById('rw-modal-mask'), box = document.getElementById('rw-modal');
        if (!mask) return;
        box.innerHTML = '<h2>' + esc(title) + '</h2>' + html;
        mask.classList.add('open');
    }
    RW.openModal = openModal;
        /* 终端模态点背景关闭 */
        (function () { var mk = document.querySelector('.rw-modal-mask'); if (mk) mk.addEventListener('click', function (e) { if (e.target === mk) mk.classList.remove('open'); }); })();

    function togglePanel() {
        var p = document.getElementById('rw-panel');
        if (!p) return;
        try { if (HOST.Rimworld && HOST.Rimworld.closeAllPanels) HOST.Rimworld.closeAllPanels('rw-panel'); } catch (e) {}
        p.classList.toggle('open');
        if (p.classList.contains('open')) { renderTop(); renderCurrent(); }
    }
    RW.togglePanel = togglePanel;

    /* ═══════════════════ 6. 启动 ═══════════════════ */

    function boot() {
        if (!document.body) { setTimeout(boot, 300); return; }
        buildPanel();
        log('✅', '悬浮球就绪（' + TABS.length + ' Tab + 地图引擎 + 主题×3）');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
