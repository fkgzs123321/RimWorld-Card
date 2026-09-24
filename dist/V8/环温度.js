/* * ==========================================================================
 * [环世界] 温度系统 (Thermal) v1
 * 温度场可视化与预警：
 *   - 当前温度 = biome 季节基线 × 天气修正 ＋ 室内保温修正
 *   - 舒适区间（10~30°）外：低温/高温伤害预警（工作惩罚/冻伤/中暑）
 *   - 冷库计算：食物腐败系数按当前温度档实时显示
 *   - 设施建议：环境温度 <0° 或 >35° 时给取暖/制冷提示
 * 全局 API：Rimworld.thermal.open()
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
    style.id = 'rw-thermal-style';
    style.textContent = `
#rw-th { position: fixed; inset: 0; background: rgba(8,10,14,.78); z-index: 100004; display: none; align-items: center; justify-content: center; }
#rw-th.open { display: flex; }
.rw-thm { width: 760px; max-width: calc(100vw - 40px); height: 600px; max-height: calc(100vh - 50px);
  background: var(--rw-bg2, #1c232d); border: 2px solid var(--rw-accent2, #5fb4e5); border-radius: 12px;
  display: flex; flex-direction: column; overflow: hidden; }
.rw-thm-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--rw-bg, #151a21); border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-thm-head h2 { font-size: 15px; color: var(--rw-accent2, #5fb4e5); }
.rw-thm-body { flex: 1; overflow-y: auto; padding: 16px; }
.th-big { text-align: center; margin-bottom: 16px; }
.th-big .th-num { font-size: 52px; font-weight: 900; font-family: monospace; }
.th-big .th-sub { font-size: 12px; color: var(--rw-dim, #8496a8); margin-top: 4px; }
.th-zone { display: flex; height: 34px; border-radius: 8px; overflow: hidden; margin: 12px 0; border: 1px solid var(--rw-border, #33404f); }
.th-zone div { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 10px; color: rgba(255,255,255,.85); text-shadow: 0 1px 2px rgba(0,0,0,.6); }
.th-card { background: var(--rw-panel, #202936); border: 1px solid var(--rw-border, #33404f); border-radius: 8px; padding: 12px; margin-bottom: 10px; font-size: 12px; }
.th-card h4 { color: var(--rw-accent2, #5fb4e5); font-size: 12px; margin-bottom: 6px; }
.th-warn { border-color: var(--rw-bad, #e05f5f); }
.th-warn h4 { color: var(--rw-bad, #e05f5f); }
.th-ok h4 { color: var(--rw-good, #6fbf5f); }
.th-line { margin: 4px 0; color: var(--rw-dim, #8496a8); }
.th-line b { color: var(--rw-text, #d8e2ec); }
.rw-btn { padding: 6px 16px; border: 1px solid var(--rw-accent, #e8a33d); border-radius: 6px; background: transparent; color: var(--rw-accent, #e8a33d); cursor: pointer; font-size: 12px; }
`;
    document.head.appendChild(style);

    var SEASON_BASE = {
        温带森林: { 春: 12, 夏: 22, 秋: 9, 冬: -1 },
        沙漠: { 春: 22, 夏: 34, 秋: 20, 冬: 8 },
        冻原: { 春: -6, 夏: 6, 秋: -4, 冬: -18 },
        热带雨林: { 春: 28, 夏: 30, 秋: 28, 冬: 26 },
        极地: { 春: -20, 夏: -8, 秋: -22, 冬: -35 },
        灌木丛: { 春: 14, 夏: 24, 秋: 12, 冬: 0 },
        干草原: { 春: 12, 夏: 24, 秋: 10, 冬: -4 },
        海洋: { 春: 14, 夏: 24, 秋: 16, 冬: 6 },
    };
    var WEATHER_DELTA = { 晴: 0, 雨: -3, 雪: -6, 雾: -1, 沙暴: 4, 暴风雨: -4, 冰雹: -8 };

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
    function writeState(mutator, reason) {
        var m = (window.Mvu || HOST.Mvu);
        try {
            if (m && typeof m.getMvuData === 'function' && typeof m.replaceMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) { mutator(r.stat_data); m.replaceMvuData(r, reason || '温度结算'); return true; }
            }
        } catch (e) {}
        return false;
    }

    function currentTemp(st) {
        var w = st.世界 || {};
        var biome = (w.设置 && w.设置.biome) || '温带森林';
        var season = w.季节 || '春';
        var weather = w.天气 || '晴';
        var base = (SEASON_BASE[biome] || SEASON_BASE.温带森林)[season];
        var delta = WEATHER_DELTA[weather] || 0;
        // 室内保温：有营地建筑时朝 15° 收敛 40%
        var indoor = false;
        var map = RW.map;
        if (map && map.tiles && map.selected) {
            var t = map.tiles[map.selected.y] && map.tiles[map.selected.y][map.selected.x];
            indoor = !!(t && t.建筑);
        }
        var env = base + delta;
        var temp = indoor ? env + (15 - env) * 0.4 : env;
        return { 环境温度: Math.round(env), 当前温度: Math.round(temp), 室内: indoor, biome: biome, 季节: season, 天气: weather };
    }

    function render() {
        var box = document.getElementById('th-body');
        if (!box) return;
        var st = readState();
        var c = currentTemp(st);
        var t = c.当前温度;
        var color = t < 0 ? '#5fb4e5' : t < 10 ? '#8fb4d4' : t <= 30 ? '#6fbf5f' : t <= 38 ? '#e5c15f' : '#e05f5f';
        var zone = t < -10 ? '致命低温' : t < 0 ? '严寒' : t < 10 ? '低温' : t <= 30 ? '舒适' : t <= 38 ? '高温' : '致命高温';
        var html = '<div class="th-big"><div class="th-num" style="color:' + color + '">' + t + '°C</div>' +
            '<div class="th-sub">' + esc(c.biome) + ' · ' + esc(c.季节) + '季 · ' + esc(c.天气) + ' · 环境温度 ' + c.环境温度 + '°' + (c.室内 ? ' · 室内保温中' : ' · 室外') + '</div></div>';
        // 温度带
        html += '<div class="th-zone">' +
            '<div style="background:#2a4a6a" title="致命低温">&lt;-10</div>' +
            '<div style="background:#3a5a7a">严寒</div>' +
            '<div style="background:#4a6a8a">低温</div>' +
            '<div style="background:#3f7a3f">舒适 10~30°</div>' +
            '<div style="background:#8a7a3a">高温</div>' +
            '<div style="background:#8a3a3a">致命高温</div></div>';
        // 舒适区状态卡
        if (t >= 10 && t <= 30) {
            html += '<div class="th-card th-ok"><h4>✅ 当前处于舒适区</h4><div class="th-line">无温度伤害风险；作物生长窗口内（按作物各自的温度窗判定）。</div></div>';
        } else {
            var warns = [];
            if (t < 10) {
                warns.push('室外工作速度惩罚：' + (t < 0 ? '-40%' : '-20%'));
                if (t < 0) warns.push('低温伤害风险：未着保暖衣物（御寒服/驼毛服）的殖民者每半天累积体温损失，肢体末端（手/脚/耳）先受冻伤');
                if (t < -10) warns.push('暴露超过半天将直接倒下——室外活动务必穿御寒（防寒服需 80 布/锻造台）');
            }
            if (t > 30) {
                warns.push('室外工作速度惩罚：' + (t > 38 ? '-40%' : '-20%'));
                if (t > 38) warns.push('中暑风险：水分流失加速，长时间户外作业会倒下');
            }
            html += '<div class="th-card th-warn"><h4>⚠ 温度预警（' + zone + '）</h4>';
            for (var i = 0; i < warns.length; i++) html += '<div class="th-line">• ' + esc(warns[i]) + '</div>';
            html += '</div>';
        }
        // 冷库计算
        var rotDays = t <= 0 ? '∞（冷冻）' : t <= 5 ? '~12 天' : t <= 12 ? '~6 天' : t <= 22 ? '~3 天' : t <= 30 ? '~1.5 天' : '~1 天';
        html += '<div class="th-card"><h4>🧊 食物保鲜（腐败速率按当前温度）</h4>' +
            '<div class="th-line">当前温度下食材可保存约：<b>' + rotDays + '</b></div>' +
            '<div class="th-line">' + (t > 5 ? '建议：建冷库（空调制冷到 0° 以下，需电力+空调研究 500 点）；早期可先挖山洞（石岩地形天然保温）。' : '当前温度可直接当冷库用，腐败趋近于零。') + '</div></div>';
        // 设施建议
        var facilities = [];
        if (t < 10) facilities.push('营火（早期）：每座提升周边约 8°；木柴消耗按楼层计');
        if (t < 0) facilities.push('电暖气（电力+空调研究）：室内恒温 20°');
        if (t > 30) facilities.push('空调（电力+空调研究 500 点）：双向制冷，高温季生命线');
        if (t < 0 || t > 30) facilities.push('衣物：防寒服/防尘罩（裁缝台）提供体温防护层');
        html += '<div class="th-card"><h4>🔧 设施建议</h4>';
        if (!facilities.length) html += '<div class="th-line">当前温度无需额外设施。</div>';
        else for (var f = 0; f < facilities.length; f++) html += '<div class="th-line">• ' + esc(facilities[f]) + '</div>';
        html += '</div>';
        // 写入变量（温度场快照给 AI）
        writeState(function (s) {
            s.环境 = s.环境 || {};
            s.环境.当前温度 = t;
            s.环境.温度区间 = zone;
        }, '温度场快照');
        box.innerHTML = html;
    }

    RW.thermal = {
        open: function () {
            var p = document.getElementById('rw-th');
            if (!p) {
                p = document.createElement('div');
                p.id = 'rw-th';
                p.innerHTML = '<div class="rw-thm">' +
                    '<div class="rw-thm-head"><h2>🌡 温度场</h2><span style="flex:1"></span><button class="rw-btn" id="th-close">✕</button></div>' +
                    '<div class="rw-thm-body" id="th-body"></div></div>';
                document.body.appendChild(p);
        /* 点遮罩关闭 */
        (function () { var el0 = document.getElementById('rw-th'); if (el0) el0.addEventListener('click', function (e) { if (e.target === el0) el0.classList.remove('open'); }); })();
                p.querySelector('#th-close').onclick = function () { p.classList.remove('open'); };
                p.addEventListener('click', function (e) { if (e.target === p) p.classList.remove('open'); });
            }
                        try { if (HOST.Rimworld && HOST.Rimworld.closeAllPanels) HOST.Rimworld.closeAllPanels("rw-th"); } catch (e) {}            p.classList.add('open');
            render();
        },
        currentTemp: currentTemp,
    };
    try { console.log('%c[环温度] ✅ 已注册', 'color:#5fb4e5'); } catch (e) {}
})();
