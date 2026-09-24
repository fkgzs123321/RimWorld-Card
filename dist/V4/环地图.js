/* * ==========================================================================
 * [环世界] 地图引擎完整版 (Map Engine Full) v2
 * 取代环终端.js 内的简版 MapEngine（同名挂载自动覆盖）
 * 七层渲染栈 + 动画循环：
 *   L1 地形（离屏缓存层，只在生成时画一次）
 *   L2 资源（矿脉/植物/浆果摇摆动画）
 *   L3 建筑（营地/墙面/储物区/床铺/营火）
 *   L4 动态（殖民者 Pawn 呼吸动画 / 动物游荡 AI / 敌对pawn）
 *   L5 战斗叠加（射界扇形/警报脉冲圈/弹道线）
 *   L6 环境光照（昼夜色温滤镜：上午清亮/下午暖金/黄昏橙红/夜晚深蓝+人工光源）
 *   L7 天气粒子（晴/雨/雪/雾/沙暴 各自粒子系统）
 *   L8 UI（悬停高亮/选中框/路径预览/区域标注）
 * 交互：滚轮缩放/右键拖拽平移/点击情报/双击设为营地
 * 语义输出：snapshot() 三要素快照（AI 唯一空间认知来源）
 * ========================================================================== */
(function () {
    'use strict';

    var HOST = (function () {
        try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (e) {}
        return window;
    })();
    var document = HOST.document; // 父窗口重定向（面板可见性）
    var RW = HOST.Rimworld = HOST.Rimworld || {};
    function log(tag, msg) { try { console.log('%c[环地图] ' + tag, 'color:#7fc94f;font-weight:bold', msg); } catch (e) {} }

    /* ═══════════ 常量与数据表 ═══════════ */

    var TILE = 24;
    var TERRAIN_COLORS = {
        草地: ['#3f5237', '#465c3d', '#4a6142'],
        肥沃草地: ['#4a6340', '#516b46', '#57734b'],
        沙地: ['#6a5c3e', '#726444', '#786a49'],
        石岩: ['#3a3f45', '#41464d', '#484e55'],
        河水: ['#2a4a66', '#2e5070', '#335878'],
        雪地: ['#9aa8b2', '#a2b0ba', '#aab8c2'],
        泥地: ['#54483a', '#5a4e3f', '#605444'],
        灰烬: ['#3a3430', '#403a36', '#46403c'],
    };
    var MINE_COLOR = { 钢材: '#b8bcc4', 组件机件: '#d4b45a', 金: '#e8c840', 铀: '#6fe86f', 零部件: '#c4c8d4' };
    var ANIMALS = [
        { 名: '鹿', 色: '#a8814f', 速度: 0.3, 危险: 0 }, { 名: '野兔', 色: '#c4b8a8', 速度: 0.5, 危险: 0 },
        { 名: '狼', 色: '#707880', 速度: 0.45, 危险: 1 }, { 名: '野猪', 色: '#5f4a3a', 速度: 0.35, 危险: 1 },
        { 名: '灰熊', 色: '#4a3a2a', 速度: 0.28, 危险: 2 }, { 名: '火鸡', 色: '#8a5a5a', 速度: 0.4, 危险: 0 },
        { 名: '驼鹿', 色: '#6a5340', 速度: 0.3, 危险: 1 }, { 名: '蛇', 色: '#7a9a5a', 速度: 0.4, 危险: 1 },
    ];
    var WEATHER_PARTICLES = {
        晴: null,
        雨: { n: 90, 色: 'rgba(120,170,220,.45)', 长度: 10, 风速: -2, 落速: 14, 形状: '线' },
        雪: { n: 60, 色: 'rgba(240,245,250,.8)', 长度: 2.4, 风速: 0.6, 落速: 1.6, 形状: '点' },
        雾: { n: 26, 色: 'rgba(190,200,205,.10)', 长度: 60, 风速: 0.4, 落速: 0.2, 形状: '团' },
        沙暴: { n: 110, 色: 'rgba(200,170,110,.4)', 长度: 14, 风速: -6, 落速: 3, 形状: '线' },
        暴风雨: { n: 150, 色: 'rgba(100,150,200,.5)', 长度: 13, 风速: -4, 落速: 18, 形状: '线' },
        冰雹: { n: 70, 色: 'rgba(220,235,245,.9)', 长度: 3.2, 风速: -1, 落速: 11, 形状: '点' },
    };
    // 时段 → 光照滤镜（色 + 强度）
    var LIGHT_FILTERS = {
        上午: null,
        下午: { 色: 'rgba(255,205,120,.07)', 人工光: 0.3 },
        黄昏: { 色: 'rgba(255,140,60,.16)', 人工光: 0.6 },
        夜晚: { 色: 'rgba(20,35,70,.45)', 人工光: 1.0 },
    };

    /* ═══════════ 引擎主体 ═══════════ */

    var MapEngine = {
        canvas: null, ctx: null, terrainCache: null,
        W: 40, H: 30, TILE: TILE,
        camX: 0, camY: 0, zoom: 1,
        hover: null, selected: null, pathPreview: null,
        tiles: null, seed: null,
        animals: [], particles: [], fireParticles: [],
        weather: '晴', 时段: '上午',
        animFrame: 0, running: false,
        combatOverlay: null, raids: [],
        baseX: null, baseY: null,
        layers: { 地形: true, 资源: true, 建筑: true, 动态: true, 战斗: true, 光照: true, 天气: true, 雾: true, UI: true },

        /* ── WorldGen：值噪声地形 + 河流 + 矿脉 + 植物 + 营地 + 动物初始分布 ── */
        generate: function (seed) {
            var s = (seed || 20260923) >>> 0;
            function rnd() { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }
            var W = this.W, H = this.H;
            var wavesA = [], wavesB = [], wavesC = [];
            for (var i = 0; i < 14; i++) wavesA.push({ x: rnd() * W, y: rnd() * H, r: 3 + rnd() * 7, v: rnd() });
            for (var i2 = 0; i2 < 9; i2++) wavesB.push({ x: rnd() * W, y: rnd() * H, r: 8 + rnd() * 12, v: rnd() });
            for (var i3 = 0; i3 < 5; i3++) wavesC.push({ x: rnd() * W, y: rnd() * H, r: 16 + rnd() * 18, v: rnd() });
            function field(x, y, ws) {
                var acc = 0, wsum = 0;
                for (var k = 0; k < ws.length; k++) {
                    var w = ws[k], dx = x - w.x, dy = y - w.y, d2 = dx * dx + dy * dy;
                    if (d2 < w.r * w.r) { var f = 1 - d2 / (w.r * w.r); acc += w.v * f; wsum += f; }
                }
                return wsum ? acc / wsum : 0.4;
            }
            var riverX = 6 + rnd() * (W - 12), river = [];
            for (var ry = 0; ry < H; ry++) {
                riverX += (rnd() - 0.5) * 2.4;
                riverX = Math.max(3, Math.min(W - 4, riverX));
                river.push(riverX);
            }
            var tiles = [];
            for (var y = 0; y < H; y++) {
                var row = [];
                for (var x = 0; x < W; x++) {
                    var e = field(x, y, wavesA) * 0.5 + field(x, y, wavesB) * 0.3 + field(x, y, wavesC) * 0.2;
                    var t = '草地';
                    if (e < 0.28) t = '沙地';
                    else if (e < 0.33) t = '泥地';
                    else if (e > 0.78) t = '石岩';
                    else if (e > 0.62) t = '肥沃草地';
                    var dRiv = Math.abs(x - river[y]);
                    if (dRiv < 0.7) t = '河水';
                    else if (dRiv < 1.6 && rnd() < 0.5) t = rnd() < 0.5 ? '河水' : '泥地';
                    row.push({ 地形: t, 海拔: Math.round(e * 100), 已探索: false });
                }
                tiles.push(row);
            }
            // 矿脉（簇状：主矿点 + 邻接扩散）
            var veinDefs = [['钢材', 7, 5], ['组件机件', 4, 3], ['金', 2, 2], ['铀', 1, 2], ['零部件', 3, 3]];
            for (var v = 0; v < veinDefs.length; v++) {
                var vName = veinDefs[v][0], clusters = veinDefs[v][1], spread = veinDefs[v][2];
                for (var c = 0; c < clusters; c++) {
                    var mx = Math.floor(rnd() * W), my = Math.floor(rnd() * H);
                    for (var sp = 0; sp < spread; sp++) {
                        var tx = Math.max(0, Math.min(W - 1, mx + Math.floor(rnd() * 3) - 1));
                        var ty = Math.max(0, Math.min(H - 1, my + Math.floor(rnd() * 3) - 1));
                        if (tiles[ty][tx].地形 === '河水') continue;
                        tiles[ty][tx].矿脉 = vName;
                        tiles[ty][tx].储量 = 30 + Math.floor(rnd() * 80);
                    }
                }
            }
            // 植物
            for (var p = 0; p < 34; p++) {
                var px = Math.floor(rnd() * W), py = Math.floor(rnd() * H);
                if ((tiles[py][px].地形 === '草地' || tiles[py][px].地形 === '肥沃草地') && !tiles[py][px].矿脉) {
                    tiles[py][px].植物 = rnd() < 0.55 ? '浆果丛' : '野药草';
                }
            }
            // 营地（中央 5x4：木墙一圈 + 营火 + 床铺×2 + 储物区）
            var bx = Math.floor(W / 2) - 2, by = Math.floor(H / 2) - 2;
            for (var byy = by; byy < by + 4; byy++) for (var bxx = bx; bxx < bx + 5; bxx++) {
                var edge = (byy === by || byy === by + 3 || bxx === bx || bxx === bx + 4);
                tiles[byy][bxx].建筑 = edge ? '木墙' : '地板';
            }
            tiles[by][bx + 1].建筑 = '营火';
            tiles[by + 1][bx + 1].建筑 = '床铺';
            tiles[by + 1][bx + 2].建筑 = '床铺';
            tiles[by + 2][bx + 1].建筑 = '储物区';
            tiles[by + 2][bx + 2].建筑 = '工作台';
            this.baseX = bx + 2; this.baseY = by + 2;
            // 营地周边已探索（视野半径 9）
            for (var ey = Math.max(0, by - 9); ey < Math.min(H, by + 13); ey++)
                for (var ex = Math.max(0, bx - 9); ex < Math.min(W, bx + 14); ex++) tiles[ey][ex].已探索 = true;
            // 动物初始分布（危险等级按离营地距离过滤：营地 6 格内无危险动物）
            this.animals = [];
            for (var a = 0; a < 14; a++) {
                var def = ANIMALS[Math.floor(rnd() * ANIMALS.length)];
                var ax = Math.floor(rnd() * W), ay = Math.floor(rnd() * H);
                if (tiles[ay][ax].地形 === '河水') continue;
                var dist = Math.hypot(ax - this.baseX, ay - this.baseY);
                if (def.危险 > 0 && dist < 7) continue;
                this.animals.push({
                    种: def.名, 色: def.色, 速度: def.速度, 危险: def.危险,
                    x: ax, y: ay, 目标: null, 相位: rnd() * Math.PI * 2,
                });
            }
            this.tiles = tiles;
            this.seed = seed;
            this.particles = [];
            this.buildTerrainCache();
            return tiles;
        },

        /* ── L1 地形离屏缓存（性能：静态层只画一次） ── */
        buildTerrainCache: function () {
            var cv = document.createElement('canvas');
            cv.width = this.W * TILE; cv.height = this.H * TILE;
            var c = cv.getContext('2d');
            var css = getComputedStyle(this.hostDocument().documentElement);
            function cv2(name, fb) { var v = css.getPropertyValue('--rw-' + name).trim(); return v || fb; }
            var land = cv2('mapland', '#3f5237'), water = cv2('mapwater', '#2a4a66'),
                sand = cv2('mapsand', '#6a5c3e'), snowc = cv2('mapsnow', '#9aa8b2'),
                fogc = cv2('mapfog', '#0d1014'), buildc = cv2('mapbuild', '#6b5d45');
            for (var y = 0; y < this.H; y++) for (var x = 0; x < this.W; x++) {
                var t = this.tiles[y][x];
                var base = TERRAIN_COLORS[t.地形] || TERRAIN_COLORS[t.地形 === '河水' ? '河水' : '草地'];
                var pick = base[(x * 7 + y * 13) % 3];
                c.fillStyle = pick || land;
                c.fillRect(x * TILE, y * TILE, TILE - 1, TILE - 1);
                // 石岩纹理 / 河岸线
                if (t.地形 === '石岩' && ((x * 31 + y * 17) % 5 === 0)) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(x * TILE + 4, y * TILE + 6, TILE - 12, 3); }
                if (t.地形 === '河水' && ((x + y) % 4 === 0)) { c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(x * TILE + 3, y * TILE + TILE * 0.55, TILE - 9, 2); }
            }
            this._terrainPalette = { land: land, water: water, sand: sand, snow: snowc, fog: fogc, build: buildc };
            this.terrainCache = cv;
        },
        hostDocument: function () { return HOST.document; },

        /* ── 天气粒子系统 ── */
        setWeather: function (w) {
            this.weather = w || '晴';
            this.particles = [];
            var def = WEATHER_PARTICLES[this.weather];
            if (def && this.canvas) {
                for (var i = 0; i < def.n; i++) {
                    this.particles.push({
                        x: Math.random() * this.canvas.width, y: Math.random() * this.canvas.height,
                        vx: def.风速, vy: def.落速, 相位: Math.random() * 6.28,
                    });
                }
            }
        },
        set时段: function (t) { this.时段 = t || '上午'; },

        /* ── 动物游荡 AI tick ── */
        animalTick: function () {
            for (var i = 0; i < this.animals.length; i++) {
                var a = this.animals[i];
                a.相位 += 0.1;
                if (!a.目标 || (Math.abs(a.x - a.目标.x) < 0.1 && Math.abs(a.y - a.目标.y) < 0.1)) {
                    // 选新目标：危险动物远离营地，温顺动物随意
                    for (var tries = 0; tries < 4; tries++) {
                        var nx = Math.max(0, Math.min(this.W - 1, a.x + Math.floor(Math.random() * 7) - 3));
                        var ny = Math.max(0, Math.min(this.H - 1, a.y + Math.floor(Math.random() * 7) - 3));
                        var dist = Math.hypot(nx - this.baseX, ny - this.baseY);
                        if (this.tiles[ny] && this.tiles[ny][nx] && this.tiles[ny][nx].地形 !== '河水' &&
                            !(a.危险 > 0 && dist < 8)) { a.目标 = { x: nx, y: ny }; break; }
                    }
                }
                if (a.目标) {
                    var dx = a.目标.x - a.x, dy = a.目标.y - a.y;
                    var d = Math.hypot(dx, dy);
                    if (d > 0.05) { a.x += dx / d * a.速度 * 0.06; a.y += dy / d * a.速度 * 0.06; }
                }
            }
        },

        /* ── 主渲染（每帧） ── */
        render: function () {
            if (!this.canvas || !this.tiles) return;
            var ctx = this.ctx, T = TILE * this.zoom;
            this.animFrame++;
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.save();
            ctx.translate(-this.camX, -this.camY);

            // L1 地形缓存
            if (this.layers.地形 && this.terrainCache) {
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(this.terrainCache, 0, 0, this.terrainCache.width, this.terrainCache.height, 0, 0, this.W * T, this.H * T);
                ctx.imageSmoothingEnabled = true;
            }
            // L2 资源（浆果摇摆）
            if (this.layers.资源) {
                ctx.textAlign = 'center';
                for (var y = 0; y < this.H; y++) for (var x = 0; x < this.W; x++) {
                    var t = this.tiles[y][x];
                    if (t.矿脉) {
                        ctx.fillStyle = MINE_COLOR[t.矿脉] || '#b8bcc4';
                        ctx.font = 'bold ' + (T * 0.5) + 'px sans-serif';
                        ctx.fillText('⛏', x * T + T / 2, y * T + T * 0.72);
                        if (this.zoom >= 1.2) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = (T * 0.22) + 'px sans-serif'; ctx.fillText(t.储量 + '', x * T + T / 2, y * T + T * 0.95); }
                    } else if (t.植物) {
                        var sway = Math.sin(this.animFrame * 0.05 + x * 1.7 + y * 2.3) * (T * 0.06);
                        ctx.fillStyle = t.植物 === '浆果丛' ? '#e07a9a' : '#e8d46f';
                        ctx.font = (T * 0.48) + 'px sans-serif';
                        ctx.fillText(t.植物 === '浆果丛' ? '❥' : '✿', x * T + T / 2 + sway, y * T + T * 0.7);
                    }
                }
            }
            // L3 建筑 + 营火粒子源
            var fireX = null, fireY = null;
            if (this.layers.建筑) {
                for (var y3 = 0; y3 < this.H; y3++) for (var x3 = 0; x3 < this.W; x3++) {
                    var t3 = this.tiles[y3][x3];
                    if (!t3.建筑) continue;
                    var col = this._terrainPalette.build;
                    if (t3.建筑 === '木墙') col = '#7a6448';
                    else if (t3.建筑 === '地板') col = 'rgba(122,100,72,.35)';
                    else if (t3.建筑 === '床铺') col = '#8a6a8a';
                    else if (t3.建筑 === '储物区') col = '#6a7a5a';
                    else if (t3.建筑 === '工作台') col = '#5a6a7a';
                    ctx.fillStyle = col;
                    ctx.fillRect(x3 * T, y3 * T, T - 1, T - 1);
                    if (t3.建筑 === '营火') {
                        fireX = x3; fireY = y3;
                        var flick = 0.75 + Math.sin(this.animFrame * 0.21) * 0.25;
                        ctx.fillStyle = '#ff8c3a';
                        ctx.beginPath(); ctx.arc(x3 * T + T / 2, y3 * T + T / 2, T * 0.2 * flick, 0, 7); ctx.fill();
                        ctx.fillStyle = '#ffd070';
                        ctx.beginPath(); ctx.arc(x3 * T + T / 2, y3 * T + T / 2, T * 0.1 * flick, 0, 7); ctx.fill();
                    }
                }
            }
            // L4 动态：动物 + Pawn
            if (this.layers.动态) {
                for (var a2 = 0; a2 < this.animals.length; a2++) {
                    var an = this.animals[a2];
                    var bob = Math.sin(an.相位) * T * 0.05;
                    ctx.fillStyle = an.色;
                    ctx.beginPath();
                    ctx.ellipse(an.x * T + T / 2, an.y * T + T / 2 + bob, T * 0.26, T * 0.18, 0, 0, 7);
                    ctx.fill();
                    if (an.危险 > 0 && this.zoom >= 1) {
                        ctx.fillStyle = 'rgba(224,95,95,.9)';
                        ctx.font = (T * 0.3) + 'px sans-serif';
                        ctx.fillText('!', an.x * T + T / 2, an.y * T - 2);
                    }
                }
                var pawns = this.getPawns();
                for (var p = 0; p < pawns.length; p++) {
                    var pn = pawns[p];
                    var breathe = Math.sin(this.animFrame * 0.08 + p * 2) * T * 0.03;
                    ctx.beginPath();
                    ctx.arc(pn.x * T + T / 2, pn.y * T + T / 2 + breathe, T * 0.28, 0, 7);
                    ctx.fillStyle = pn.边 === '敌方' ? '#e05f5f' : (pn.色 || '#e8a33d');
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5; ctx.stroke();
                    if (pn.名 && this.zoom >= 0.9) {
                        ctx.fillStyle = 'rgba(255,255,255,.9)';
                        ctx.font = 'bold ' + (T * 0.3) + 'px sans-serif';
                        ctx.fillText(pn.名, pn.x * T + T / 2, pn.y * T - T * 0.18);
                    }
                }
            }
            // 营火粒子（在建筑层之上）
            if (fireX != null && this.layers.动态) {
                if (this.fireParticles.length < 24 && Math.random() < 0.7) {
                    this.fireParticles.push({
                        x: fireX * T + T / 2 + (Math.random() - 0.5) * T * 0.3,
                        y: fireY * T + T / 2, vy: -(0.4 + Math.random() * 0.7), vx: (Math.random() - 0.5) * 0.3,
                        life: 1, r: T * (0.05 + Math.random() * 0.06),
                    });
                }
                for (var f = this.fireParticles.length - 1; f >= 0; f--) {
                    var fp = this.fireParticles[f];
                    fp.x += fp.vx; fp.y += fp.vy; fp.life -= 0.025;
                    if (fp.life <= 0) { this.fireParticles.splice(f, 1); continue; }
                    ctx.fillStyle = 'rgba(255,' + Math.floor(140 + 100 * fp.life) + ',60,' + fp.life * 0.8 + ')';
                    ctx.beginPath(); ctx.arc(fp.x, fp.y, fp.r * fp.life, 0, 7); ctx.fill();
                }
            }
            // L5 战斗叠加（警报脉冲 + 射界扇形 + 弹道）
            if (this.layers.战斗 && this.combatOverlay) {
                var co = this.combatOverlay;
                var pulse = 0.5 + Math.sin(this.animFrame * 0.1) * 0.5;
                ctx.strokeStyle = 'rgba(224,95,95,' + (0.3 + pulse * 0.4) + ')';
                ctx.setLineDash([5, 4]); ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(co.x * T + T / 2, co.y * T + T / 2, co.range * T, 0, 7); ctx.stroke();
                ctx.setLineDash([]);
                if (co.facing != null) {
                    ctx.fillStyle = 'rgba(224,95,95,.14)';
                    ctx.beginPath();
                    ctx.moveTo(co.x * T + T / 2, co.y * T + T / 2);
                    ctx.arc(co.x * T + T / 2, co.y * T + T / 2, co.range * T, co.facing - 0.5, co.facing + 0.5);
                    ctx.closePath(); ctx.fill();
                }
            }
            for (var r2 = 0; r2 < this.raids.length; r2++) {
                var rd = this.raids[r2];
                var pulse2 = 0.4 + Math.sin(this.animFrame * 0.14 + r2) * 0.3;
                ctx.strokeStyle = 'rgba(224,95,95,' + pulse2 + ')';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(rd.x * T + T / 2, rd.y * T + T / 2, (10 + this.animFrame % 20) * this.zoom * 0.6, 0, 7); ctx.stroke();
                ctx.fillStyle = 'rgba(224,95,95,.95)';
                ctx.font = 'bold ' + (T * 0.34) + 'px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('⚔' + rd.名, rd.x * T + T / 2, rd.y * T - T * 0.4);
            }
            // 路径预览
            if (this.pathPreview && this.pathPreview.length > 1) {
                ctx.strokeStyle = 'rgba(232,163,61,.7)';
                ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
                ctx.beginPath();
                for (var pp = 0; pp < this.pathPreview.length; pp++) {
                    var pt = this.pathPreview[pp];
                    if (pp === 0) ctx.moveTo(pt.x * T + T / 2, pt.y * T + T / 2);
                    else ctx.lineTo(pt.x * T + T / 2, pt.y * T + T / 2);
                }
                ctx.stroke(); ctx.setLineDash([]);
            }
            // L6 环境光照（色温滤镜 + 夜晚人工光源圈）
            if (this.layers.光照) {
                var lf = LIGHT_FILTERS[this.时段];
                if (lf) {
                    ctx.fillStyle = lf.色;
                    ctx.fillRect(0, 0, this.W * T, this.H * T);
                    if (lf.人工光 > 0 && fireX != null) {
                        var grad = ctx.createRadialGradient(fireX * T + T / 2, fireY * T + T / 2, T * 0.3, fireX * T + T / 2, fireY * T + T / 2, T * 6);
                        grad.addColorStop(0, 'rgba(255,180,90,' + (0.22 * lf.人工光) + ')');
                        grad.addColorStop(1, 'rgba(255,180,90,0)');
                        ctx.fillStyle = grad;
                        ctx.fillRect((fireX - 6) * T, (fireY - 6) * T, 13 * T, 13 * T);
                    }
                }
            }
            // L7 天气粒子
            if (this.layers.天气 && WEATHER_PARTICLES[this.weather]) {
                var def2 = WEATHER_PARTICLES[this.weather];
                for (var pi = 0; pi < this.particles.length; pi++) {
                    var pt2 = this.particles[pi];
                    pt2.x += pt2.vx + Math.sin(this.animFrame * 0.03 + pt2.相位) * 0.3;
                    pt2.y += pt2.vy;
                    if (pt2.y > this.canvas.height) { pt2.y = -8; pt2.x = Math.random() * this.canvas.width; }
                    if (pt2.x < -8) pt2.x = this.canvas.width + 8;
                    if (pt2.x > this.canvas.width + 8) pt2.x = -8;
                    ctx.fillStyle = def2.色;
                    if (def2.形状 === '线') { ctx.fillRect(pt2.x, pt2.y, 1.2, def2.长度); }
                    else if (def2.形状 === '点') { ctx.beginPath(); ctx.arc(pt2.x, pt2.y, def2.长度, 0, 7); ctx.fill(); }
                    else { ctx.beginPath(); ctx.arc(pt2.x, pt2.y, def2.长度, 0, 7); ctx.fill(); }
                }
            }
            // L8' 雾（基于已探索标记）
            if (this.layers.雾) {
                ctx.fillStyle = 'rgba(8,10,14,.62)';
                for (var fy = 0; fy < this.H; fy++) for (var fx = 0; fx < this.W; fx++) {
                    if (!this.tiles[fy][fx].已探索) ctx.fillRect(fx * T, fy * T, T - 1, T - 1);
                }
            }
            // L8 UI：悬停 + 选中 + 区域标注
            if (this.hover) {
                ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.5;
                ctx.strokeRect(this.hover.x * T, this.hover.y * T, T, T);
            }
            if (this.selected) {
                ctx.strokeStyle = 'rgba(232,163,61,.95)'; ctx.lineWidth = 2;
                ctx.strokeRect(this.selected.x * T + 1, this.selected.y * T + 1, T - 2, T - 2);
                var sel = this.tiles[this.selected.y] && this.tiles[this.selected.y][this.selected.x];
                if (sel && sel.矿脉) {
                    ctx.fillStyle = 'rgba(232,163,61,.92)';
                    ctx.font = 'bold ' + (T * 0.3) + 'px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(sel.矿脉 + '×' + sel.储量, this.selected.x * T + T / 2, this.selected.y * T - 4);
                }
            }
            ctx.restore();
        },

        getPawns: function () {
            var out = [];
            var names = ['薇卡', '凯奥', '祝小满'], colors = { '薇卡': '#e8a33d', '凯奥': '#7fc94f', '祝小满': '#5fb4e5' };
            for (var i = 0; i < names.length; i++) {
                var key = names[i] === '祝小满' ? '祝小满' : names[i];
                out.push({ 名: names[i], 边: '我方', 色: colors[names[i]], x: (this.baseX || this.W / 2) - 1 + i, y: (this.baseY || this.H / 2) + 2 });
            }
            for (var r = 0; r < this.raids.length; r++) {
                var rd = this.raids[r];
                for (var u = 0; u < (rd.人数 || 3); u++) {
                    out.push({ 名: '', 边: '敌方', x: rd.x + (u % 3) - 1, y: rd.y + Math.floor(u / 3) });
                }
            }
            return out;
        },

        /* ── 探索：以点为中心揭开雾 ── */
        reveal: function (cx, cy, radius) {
            var r = radius || 8;
            for (var y = Math.max(0, cy - r); y <= Math.min(this.H - 1, cy + r); y++)
                for (var x = Math.max(0, cx - r); x <= Math.min(this.W - 1, cx + r); x++)
                    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) this.tiles[y][x].已探索 = true;
        },

        tileInfo: function (x, y) {
            if (!this.tiles || !this.tiles[y] || !this.tiles[y][x]) return null;
            var t = this.tiles[y][x];
            var dx = x - (this.baseX || this.W / 2), dy = y - (this.baseY || this.H / 2);
            var dir = (dy < -2 ? '北' : dy > 2 ? '南' : '') + (dx > 2 ? '东' : dx < -2 ? '西' : '') || '营地内';
            var dist = Math.round(Math.hypot(dx, dy));
            var lines = ['地形：' + t.地形 + '（海拔 ' + t.海拔 + '）', '方位：' + dir + '，距营地约 ' + dist + ' 格'];
            if (t.矿脉) lines.push('矿脉：' + t.矿脉 + ' × ' + t.储量 + '（开采后走环经济流水账）');
            if (t.植物) lines.push('植物：' + t.植物 + '（采集走生产判定）');
            if (t.建筑) lines.push('建筑：' + t.建筑);
            var here = this.animals.filter(function (a) { return Math.abs(a.x - x) < 2 && Math.abs(a.y - y) < 2; });
            if (here.length) lines.push('附近动物：' + here.map(function (a) { return a.种 + (a.危险 ? '（危险）' : ''); }).join('、'));
            return lines;
        },

        /* ── 派工情报卡：资源详情 + 殖民者技能匹配 + 预计产出 + 派人按钮 ── */
        ORE: { 钢材: { 产物: '铁矿石', 基准: 20, 技能: '采矿' }, 组件机件: { 产物: '组件', 基准: 4, 技能: '采矿' }, 金: { 产物: '金', 基准: 8, 技能: '采矿' }, 铀: { 产物: '铀', 基准: 6, 技能: '采矿' }, 零部件: { 产物: '零部件', 基准: 10, 技能: '采矿' } },
        PLANT: { 浆果丛: { 产物: '食材', 基准: 10, 技能: '种植', 类型: '浆果' }, 草药: { 产物: '草药医药', 基准: 3, 技能: '种植', 类型: '药草' } },
        buildInfoCard: function (x, y) {
            if (!this.tiles || !this.tiles[y] || !this.tiles[y][x]) return '';
            var t = this.tiles[y][x];
            var base = this.tileInfo(x, y) || [];
            var esc = function (s) { return String(s).replace(/</g, '&lt;'); };
            var h = base.map(function (l) { return '<div>• ' + esc(l) + '</div>'; }).join('');
            h += '<div style="margin-top:6px"><button class="rw-btn" onclick="Rimworld.map.pathTo(' + x + ',' + y + ')">📍 设为远行目的地</button></div>';

            // 资源类型 → 派工
            var res = t.矿脉 ? this.ORE[t.矿脉] : (t.植物 ? this.PLANT[t.植物] : null);
            if (res) {
                var resName = t.矿脉 || t.植物;
                h += '<div style="margin-top:8px;padding-top:6px;border-top:1px dashed #33404f"><b style="color:#e8a33d">⛏ 可派工：' + esc(resName) + '</b>（产出 ' + esc(res.产物) + ' · 需 ' + esc(res.技能) + ' 技能，无门槛、越高越快）</div>';
                // 读殖民者技能
                var crew = [];
                try {
                    var Mvu = (window.Mvu || HOST.Mvu);
                    var sd = Mvu && Mvu.getMvuData && Mvu.getMvuData();
                    sd = sd && sd.stat_data;
                    if (sd) {
                        var names = ['薇卡', '凯奥', '小满'];
                        for (var ci = 0; ci < names.length; ci++) {
                            var p = sd[names[ci]];
                            var lv = p && p.技能 && p.技能[res.技能] && p.技能[res.技能].等级 != null ? p.技能[res.技能].等级 : null;
                            if (lv != null) crew.push({ 名: names[ci], 等级: lv });
                        }
                    }
                } catch (e) {}
                if (!crew.length) {
                    h += '<div style="color:#8496a8;font-size:11px">（读取殖民者技能失败：请先发送一条消息让系统初始化）</div>';
                } else {
                    crew.sort(function (a, b) { return b.等级 - a.等级; });
                    for (var di = 0; di < crew.length; di++) {
                        var out = Math.max(1, Math.round(res.基准 * (1 + crew[di].等级 * 0.03)));
                        var c0 = crew[di].等级 >= 8 ? '#6fbf5f' : crew[di].等级 >= 4 ? '#e8a33d' : '#8496a8';
                        h += '<div style="display:flex;align-items:center;gap:6px;margin-top:4px;font-size:12px">' +
                            '<span style="flex:1"><b>' + esc(crew[di].名) + '</b> · ' + esc(res.技能) + ' <span style="color:' + c0 + '">' + crew[di].等级 + ' 级</span>' +
                            ' → 约 <b>' + out + '</b> ' + esc(res.产物) + '/半天</span>' +
                            '<button class="rw-btn" style="padding:2px 8px;font-size:11px" onclick="Rimworld.map.dispatch(' + x + ',' + y + ',\'' + esc(resName) + '\',\'' + esc(res.产物) + '\',\'' + esc(crew[di].名) + '\')">派人</button></div>';
                    }
                }
                // 该格进行中工单
                try {
                    var Mvu2 = (window.Mvu || HOST.Mvu);
                    var sd2 = Mvu2 && Mvu2.getMvuData && Mvu2.getMvuData();
                    sd2 = sd2 && sd2.stat_data;
                    var orders = sd2 && sd2.状态 && sd2.状态.工单 ? sd2.状态.工单.split('、').filter(function (s) { return s; }) : [];
                    var here = orders.filter(function (s) { return s.indexOf('|' + x + ',' + y + '|') >= 0; });
                    if (here.length) h += '<div style="margin-top:4px;color:#5fb4e5;font-size:11px">⚙ 进行中：' + esc(here.map(function (s) { var pp = s.split('|'); return pp[4] + '（' + pp[0] + '）'; }).join('、')) + '</div>';
                } catch (e) {}
            }
            return h;
        },

        /* ── 派人：写工单（守恒铁律：产出走环经济流水账） ── */
        dispatch: function (x, y, resName, product, who) {
            var 类型 = this.ORE[resName] ? '采矿' : '采集';
            var order = 类型 + '|' + x + ',' + y + '|' + resName + '|' + product + '|' + who;
            var done = false;
            try {
                var Mvu = (window.Mvu || HOST.Mvu);
                if (Mvu && Mvu.getMvuData && Mvu.replaceMvuData) {
                    var r = Mvu.getMvuData();
                    if (r && r.stat_data) {
                        if (!r.stat_data.状态) r.stat_data.状态 = { 工单: '' };
                        var list = (r.stat_data.状态.工单 || '').split('、').filter(function (s) { return s; });
                        // 防重复：同格同人
                        for (var i = 0; i < list.length; i++) if (list[i] === order) { if (RW.toast) RW.toast(who + ' 已在这格干活了', 'warn'); return; }
                        list.push(order);
                        r.stat_data.状态.工单 = list.join('、');
                        Mvu.replaceMvuData(r, '派工·' + resName);
                        done = true;
                    }
                }
            } catch (e) {}
            if (done) {
                if (RW.toast) RW.toast('已派 ' + who + ' 前往 ' + resName + '（' + x + ',' + y + '）· 每推进半天自动结算入库', 'good');
                // 刷新情报卡显示"进行中"
                if (this.selected && this.selected.x === x) {
                    var box = HOST.document.getElementById('rw-map-info');
                    if (box) box.innerHTML = this.buildInfoCard(x, y);
                }
            } else {
                if (RW.toast) RW.toast('派工失败：MVU 未就绪，请先发送一条消息', 'bad');
            }
        },

        /* ── 语义快照（AI 空间认知唯一来源） ── */
        snapshot: function () {
            if (!this.tiles) return '（地图未生成）';
            var out = [], veins = {}, plants = {}, animalCount = {}, riverSides = [];
            var W = this.W, H = this.H;
            for (var y = 0; y < H; y++) {
                var hasRiver = false;
                for (var x = 0; x < W; x++) {
                    var t = this.tiles[y][x];
                    var dx = x - (this.baseX || W / 2), dy = y - (this.baseY || H / 2);
                    var dir = (dy < -3 ? '北' : dy > 3 ? '南' : '') + (dx > 3 ? '东' : dx < -3 ? '西' : '') || '营地附近';
                    var dist = Math.round(Math.hypot(dx, dy));
                    if (t.矿脉) { (veins[t.矿脉] = veins[t.矿脉] || []).push(dir + '约' + dist + '格·储量' + t.储量); }
                    if (t.植物) { (plants[t.植物] = plants[t.植物] || []).push(dir + '约' + dist + '格'); }
                    if (t.地形 === '河水') hasRiver = true;
                }
                if (hasRiver) riverSides.push('第' + y + '行');
            }
            for (var i = 0; i < this.animals.length; i++) {
                var a = this.animals[i];
                animalCount[a.种] = (animalCount[a.种] || 0) + 1;
            }
            for (var v in veins) out.push(v + '矿脉：' + veins[v].slice(0, 3).join('、') + (veins[v].length > 3 ? ' 等 ' + veins[v].length + ' 处' : '') + '，已探明');
            for (var p in plants) out.push(p + '：' + plants[p].slice(0, 2).join('、') + (plants[p].length > 2 ? ' 等 ' + plants[p].length + ' 处' : ''));
            var anStr = [];
            for (var ak in animalCount) anStr.push(ak + '×' + animalCount[ak]);
            out.push('动物活动：' + (anStr.join('、') || '未见'));
            out.push('一条河蜿蜒穿过图幅' + (riverSides.length ? '（纵贯地图）' : ''));
            out.push('营地位于地图中部，有木墙围护、营火、两张床、储物区与工作台');
            return '【空间快照·每半天更新】' + out.join('；') + '。';
        },
    };

    /* ═══════════ 动画循环与交互绑定 ═══════════ */

    function attach(canvas) {
        MapEngine.canvas = canvas;
        MapEngine.ctx = canvas.getContext('2d');
        if (!MapEngine.tiles) MapEngine.generate(20260923);
        // 滚轮缩放
        canvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            var old = MapEngine.zoom;
            MapEngine.zoom = Math.max(0.5, Math.min(3, MapEngine.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
            var ratio = MapEngine.zoom / old;
            var r = canvas.getBoundingClientRect();
            var mx = e.clientX - r.left + MapEngine.camX, my = e.clientY - r.top + MapEngine.camY;
            MapEngine.camX = mx - mx * ratio; MapEngine.camY = my - my * ratio;
        }, { passive: false });
        // 右键/中键拖拽平移
        var panning = false, sx = 0, sy = 0;
        canvas.addEventListener('mousedown', function (e) { if (e.button === 2 || e.button === 1) { panning = true; sx = e.clientX; sy = e.clientY; e.preventDefault(); } });
        HOST.addEventListener('mousemove', function (e) {
            if (panning) { MapEngine.camX -= e.clientX - sx; MapEngine.camY -= e.clientY - sy; sx = e.clientX; sy = e.clientY; }
        });
        HOST.addEventListener('mouseup', function () { panning = false; });
        canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        // 左键悬停/点击情报
        canvas.addEventListener('mousemove', function (e) {
            if (panning) return;
            var r = canvas.getBoundingClientRect();
            var T = TILE * MapEngine.zoom;
            MapEngine.hover = { x: Math.floor((e.clientX - r.left + MapEngine.camX) / T), y: Math.floor((e.clientY - r.top + MapEngine.camY) / T) };
        });
        canvas.addEventListener('mouseleave', function () { MapEngine.hover = null; });
        canvas.addEventListener('click', function (e) {
            var r = canvas.getBoundingClientRect();
            var T = TILE * MapEngine.zoom;
            var x = Math.floor((e.clientX - r.left + MapEngine.camX) / T), y = Math.floor((e.clientY - r.top + MapEngine.camY) / T);
            MapEngine.selected = { x: x, y: y };
            MapEngine.reveal(x, y, 3);
            var box = HOST.document.getElementById('rw-map-info');
            if (box) box.innerHTML = MapEngine.buildInfoCard(x, y);
        });
        // 双击：揭雾（侦察）
        canvas.addEventListener('dblclick', function (e) {
            var r = canvas.getBoundingClientRect();
            var T = TILE * MapEngine.zoom;
            var x = Math.floor((e.clientX - r.left + MapEngine.camX) / T), y = Math.floor((e.clientY - r.top + MapEngine.camY) / T);
            MapEngine.reveal(x, y, 5);
            if (HOST.Rimworld.toast) HOST.Rimworld.toast('侦察队揭开了周边迷雾', 'good');
        });
        // 动画循环
        if (!MapEngine.running) {
            MapEngine.running = true;
            (function loop() {
                if (!MapEngine.canvas || !HOST.document.getElementById('rw-map-canvas')) { MapEngine.running = false; return; }
                MapEngine.animalTick();
                MapEngine.render();
                requestAnimationFrame(loop);
            })();
        }
        log('✅', '地图引擎已挂载（动画循环开启）');
    }
    MapEngine.attach = attach;
    MapEngine.pathTo = function (x, y) {
        // 直线路径预览（A* 简化版后续批次：绕开河水与石岩）
        var path = [], steps = 12;
        var fx = MapEngine.baseX, fy = MapEngine.baseY;
        for (var i = 0; i <= steps; i++) {
            path.push({ x: Math.round(fx + (x - fx) * i / steps), y: Math.round(fy + (y - fy) * i / steps) });
        }
        MapEngine.pathPreview = path;
        if (HOST.Rimworld.toast) HOST.Rimworld.toast('远行路线已标记（A* 寻路 v2 批次接入地形成本）', 'good');
    };

    RW.map = MapEngine;
    log('✅', '完整版地图引擎已注册（覆盖简版）');
})();
