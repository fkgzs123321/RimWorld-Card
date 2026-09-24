/* * ==========================================================================
 * [环世界] 开局设置向导 (New Game Wizard) v1
 * 对应原版「创建世界页」+ 派系/难度/讲述者设置 + 开局选择
 * 三组参数：世界（种子/降雨/温度/人口密度/派系）· 规则（难度/讲述者/科技上限）· 开局（biome/小队/身份）
 * 流派预设：命名预设一键写入整组参数（可再微调）
 * 全部写入 世界.设置 → WorldGen / 事件调度器 / 公式层实时读取
 * 全局 API：Rimworld.wizard.open()
 * ========================================================================== */
(function () {
    'use strict';

    /* ═══════════ 队员编辑数据（原版式：背景/特质/技能可重掷）═══════════ */
    var 特质池 = ['乐观', '悲观', '夜猫子', '晨型人', '贪吃', '工作狂', '懒惰', '神经质', '钢铁意志', '温柔', '刺头', '羞涩', '话痨', '独行侠', '太聪明', '好记性', '快速学习', '绿拇指', '稳健射手', '乱枪打鸟', '斗殴者', '美丽', '温室人'];
    var 背景池 = {
        '轨道站邦联': ['环形居住区水培舱里长大的「庭院儿童」', '轮机见习，耳朵会听轴承的哭声', '医护学徒，签了六年服务期'],
        '热带农业殖民地': ['六岁下田十岁嫁接，旱灾那年看父亲把水让给秧苗', '果品经纪人，会看人像看瓜', '疫病防治员，救过整片果园'],
        '边缘拆解场': ['七岁拆旧家电换糖，师傅说每个螺丝都有脾气', '在报废飞船里玩捉迷藏，有个孩子再没出来', '黑市零件贩，什么价钱都懂'],
        '舰队遗族': ['在战舰走廊出生，制服大两号，军歌当摇篮曲', '通讯兵，听过太多最后的呼叫', '宪兵，规则刻进骨头'],
        '荒野游牧': ['跟着兽群走，五岁摔断手臂学会的第一件事是忍', '驯兽师，能跟灰狼讨价还价', '向导，从不走回头路'],
        '工业城邦': ['在流水线轰鸣里睡着过，图书馆废弃层是秘密基地', '车床工，双手稳得能穿针', '工会协调员，会算罢工成本'],
    };
    var CREW = [
        { 名: '薇卡·奥斯特洛娃', 圈: '轨道站邦联', 固有: '夜猫子、太聪明、温室人' },
        { 名: '凯奥·里贝罗', 圈: '热带农业殖民地', 固有: '绿拇指、温柔、勤勉' },
        { 名: '祝小满', 圈: '边缘拆解场', 固有: '话痨、贪吃、夜猫子' },
        { 名: '你（<user>）', 圈: '任选', 固有: '', 玩家: true },
    ];
    function 抽背景(圈) {
        var keys = 圈 === '任选' ? Object.keys(背景池) : [圈];
        var k = keys[Math.floor(Math.random() * keys.length)];
        var arr = 背景池[k];
        return '【' + k + '】' + arr[Math.floor(Math.random() * arr.length)];
    }
    function 抽特质() {
        var a = 特质池.slice(), out = [];
        for (var i = 0; i < 3; i++) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
        return out.join('、');
    }
    function 技能倾向() {
        var s = ['射击', '格斗', '建造', '采矿', '烹饪', '种植', '畜牧', '手工', '艺术', '医疗', '社交', '智识'];
        return s[Math.floor(Math.random() * s.length)] + '、' + s[Math.floor(Math.random() * s.length)];
    }
    for (var ci = 0; ci < CREW.length; ci++) {
        CREW[ci].背景 = 抽背景(CREW[ci].圈);
        CREW[ci].特质 = CREW[ci].固有 || 抽特质();
        CREW[ci].技能 = 技能倾向();
    }

    var HOST = (function () {
        try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (e) {}
        return window;
    })();
    var RW = HOST.Rimworld = HOST.Rimworld || {};
    var document = HOST.document;
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    var style = document.createElement('style');
    style.id = 'rw-wizard-style';
    style.textContent = `
#rw-wizard { position: fixed; inset: 0; background: rgba(8,10,14,.82); z-index: 100005; display: none; align-items: center; justify-content: center; }
#rw-wizard.open { display: flex; }
.rw-wz { width: 920px; max-width: calc(100vw - 40px); height: 680px; max-height: calc(100vh - 40px);
  background: var(--rw-bg2, #1c232d); border: 2px solid var(--rw-accent, #e8a33d); border-radius: 14px;
  display: flex; flex-direction: column; overflow: hidden; }
.rw-wz-head { padding: 16px 22px 12px; background: var(--rw-bg, #151a21); border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-wz-head h2 { font-size: 18px; color: var(--rw-accent, #e8a33d); letter-spacing: 2px; }
.rw-wz-head p { font-size: 11px; color: var(--rw-dim, #8496a8); margin-top: 4px; }
.rw-wz-body { flex: 1; overflow-y: auto; padding: 16px 22px; }
.rw-wz-body::-webkit-scrollbar { width: 8px; }
.rw-wz-body::-webkit-scrollbar-thumb { background: var(--rw-border, #33404f); border-radius: 4px; }
.wz-preset-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; margin-bottom: 14px; }
.wz-preset { background: var(--rw-panel, #202936); border: 1px solid var(--rw-border, #33404f); border-radius: 8px; padding: 10px; cursor: pointer; transition: border-color .2s; }
.wz-preset:hover { border-color: var(--rw-accent, #e8a33d); }
.wz-preset h4 { font-size: 12px; color: var(--rw-accent, #e8a33d); }
.wz-preset p { font-size: 10px; color: var(--rw-dim, #8496a8); margin-top: 4px; line-height: 1.6; }
.wz-sec { margin-bottom: 16px; }
.wz-sec > h3 { font-size: 13px; color: var(--rw-accent2, #5fb4e5); margin-bottom: 8px; padding-bottom: 5px; border-bottom: 1px dashed var(--rw-border, #33404f); }
.wz-row { display: flex; align-items: center; gap: 10px; margin: 8px 0; font-size: 12px; }
.wz-row label { width: 90px; color: var(--rw-dim, #8496a8); }
.wz-row select, .wz-row input { background: var(--rw-bg, #151a21); color: var(--rw-text, #d8e2ec); border: 1px solid var(--rw-border, #33404f); border-radius: 5px; padding: 5px 10px; font-size: 12px; }
.wz-row .wz-desc { font-size: 10px; color: var(--rw-dim, #8496a8); flex: 1; }
.wz-biome-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.wz-biome { background: var(--rw-panel, #202936); border: 2px solid var(--rw-border, #33404f); border-radius: 8px; padding: 10px; cursor: pointer; text-align: center; transition: all .2s; }
.wz-biome:hover { border-color: var(--rw-accent2, #5fb4e5); }
.wz-biome.sel { border-color: var(--rw-accent, #e8a33d); background: rgba(232,163,61,.08); }
.wz-biome .bm-icon { font-size: 22px; }
.wz-biome .bm-name { font-size: 12px; font-weight: 700; margin-top: 4px; }
.wz-biome .bm-diff { font-size: 10px; color: var(--rw-dim, #8496a8); margin-top: 3px; }
.wz-diff-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.wz-diff { background: var(--rw-panel, #202936); border: 2px solid var(--rw-border, #33404f); border-radius: 7px; padding: 7px 4px; cursor: pointer; text-align: center; }
.wz-diff.sel { border-color: var(--rw-bad, #e05f5f); }
.wz-diff .df-name { font-size: 11px; font-weight: 600; }
.wz-diff .df-desc { font-size: 9px; color: var(--rw-dim, #8496a8); margin-top: 2px; }
.rw-wz-foot { padding: 12px 22px; border-top: 1px solid var(--rw-border, #33404f); display: flex; gap: 10px; background: var(--rw-bg, #151a21); }
.rw-btn { padding: 6px 16px; border: 1px solid var(--rw-accent, #e8a33d); border-radius: 6px; background: transparent; color: var(--rw-accent, #e8a33d); cursor: pointer; font-size: 12px; }
.rw-btn.primary { background: var(--rw-accent, #e8a33d); color: var(--rw-bg, #151a21); font-weight: 700; }
`;
    document.head.appendChild(style);

    /* ═══════════ 数据 ═══════════ */

    var BIOMES = [
        { id: '温带森林', icon: '🌲', diff: '★☆☆☆☆ 新手推荐', desc: '四季均衡，木石齐备' },
        { id: '沙漠', icon: '🏜', diff: '★★★☆☆', desc: '缺水，昼夜温差大' },
        { id: '冻原', icon: '❄️', diff: '★★★★☆', desc: '极寒短生长季' },
        { id: '热带雨林', icon: '🌴', diff: '★★★★☆', desc: '湿热疾病猛兽' },
        { id: '极地', icon: '🏔', diff: '★★★★★', desc: '最严酷冰原遗迹' },
        { id: '灌木丛', icon: '🌿', diff: '★★★☆☆', desc: '干雷暴火灾温床' },
        { id: '干草原', icon: '🌾', diff: '★★☆☆☆', desc: '开阔利于作战' },
        { id: '海洋', icon: '🌊', diff: '★★★☆☆', desc: '岛屿地形，海岸资源' },
    ];
    var DIFFS = [
        { name: '和平观察者', desc: '无袭击，纯经营', 袭击: 0 },
        { name: '社区建造者', desc: '轻松生存', 袭击: 0.4 },
        { name: '冒险故事', desc: '标准体验', 袭击: 1 },
        { name: '血与灰烬', desc: '硬核挑战', 袭击: 1.8 },
        { name: '输即是乐', desc: '无情模拟', 袭击: 2.6 },
    ];
    var NARRATORS = [
        { id: '卡桑德拉', desc: '经典曲线：平静期与危机交替' },
        { id: '兰迪', desc: '纯随机，随时可能天降' },
        { id: '菲比', desc: '温和：给足喘息时间' },
    ];
    var TECHS = ['原始', '中世纪', '工业', '高科技', '太空'];
    var PRESETS = [
        { name: '原版平衡', desc: '冒险故事难度＋卡桑德拉＋温带森林＋太空科技。标准环世界体验。', set: { biome: '温带森林', 难度: '冒险故事', 讲述者: '卡桑德拉', 科技上限: '太空', 派系数: 6 } },
        { name: '中世纪生存', desc: '科技上限=中世纪：工业/太空研究物理裁掉，枪械从掉落池剔除，冷兵器+城堡。', set: { biome: '温带森林', 难度: '冒险故事', 讲述者: '卡桑德拉', 科技上限: '中世纪', 派系数: 6 } },
        { name: '闪耀文明暴打中世纪', desc: '我方上限=中世纪＋敌方=太空级：不对称科技，敌人高偏转+能量武器，被迫游击。', set: { biome: '干草原', 难度: '血与灰烬', 讲述者: '卡桑德拉', 科技上限: '中世纪', 敌方科技: '太空', 派系数: 8 } },
        { name: '兰迪地狱', desc: '兰迪讲述者＋输即是乐＋极地。灾难连轴转，翻车即故事。', set: { biome: '极地', 难度: '输即是乐', 讲述者: '兰迪', 科技上限: '太空', 派系数: 8 } },
        { name: '热带病域', desc: '热带雨林＋血与灰烬：佩诺西林是刚需，疾病与猛兽的考验。', set: { biome: '热带雨林', 难度: '血与灰烬', 讲述者: '菲比', 科技上限: '工业', 派系数: 6 } },
    ];
    var SEL = {
        biome: '温带森林', 难度: '冒险故事', 讲述者: '卡桑德拉', 科技上限: '太空', 敌方科技: '同我方',
        种子: '', 降雨: 0.5, 温度: 0.5, 人口密度: 0.5, 派系数: 6, 小队规模: '三人小队', 玩家身份: '自定义幸存者',
    };

    /* ═══════════ 面板 ═══════════ */

    function ensurePanel() {
        var p = document.getElementById('rw-wizard');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'rw-wizard';
        p.innerHTML =
            '<div class="rw-wz">' +
            '<div class="rw-wz-head"><h2>🌍 创建世界</h2><p>边缘世界有各种文明圈的聚居地。参数写入 世界.设置 后由 WorldGen 与事件调度器读取，开局确定后不可变。</p></div>' +
            '<div class="rw-wz-body" id="wz-body"></div>' +
            '<div class="rw-wz-foot"><button class="rw-btn primary" id="wz-start">🚀 生成世界并着陆</button>' +
            '<button class="rw-btn" id="wz-random">🎲 全随机</button>' +
            '<span style="flex:1"></span><button class="rw-btn" id="wz-close">✕</button></div></div>';
        document.body.appendChild(p);
        /* 点遮罩关闭 */
        (function () { var el0 = document.getElementById('rw-wizard'); if (el0) el0.addEventListener('click', function (e) { if (e.target === el0) el0.classList.remove('open'); }); })();
        p.querySelector('#wz-close').onclick = function () { p.classList.remove('open'); };
        p.querySelector('#wz-start').onclick = startWorld;
        p.querySelector('#wz-random').onclick = function () {
            SEL.biome = BIOMES[Math.floor(Math.random() * BIOMES.length)].id;
            SEL.难度 = DIFFS[Math.floor(Math.random() * DIFFS.length)].name;
            SEL.讲述者 = NARRATORS[Math.floor(Math.random() * NARRATORS.length)].id;
            SEL.科技上限 = TECHS[Math.floor(Math.random() * TECHS.length)];
            SEL.种子 = String(Math.floor(Math.random() * 1e9));
            SEL.降雨 = Math.random(); SEL.温度 = Math.random(); SEL.人口密度 = Math.random();
            renderBody();
            if (RW.toast) RW.toast('已全随机', 'warn');
        };
        // 队员重掷（事件委托）
        p.addEventListener('click', function (e) {
            var btn = e.target.closest('.wz-reroll');
            if (!btn) return;
            var c = CREW[parseInt(btn.getAttribute('data-crew'), 10)];
            if (!c) return;
            c.背景 = 抽背景(c.圈);
            c.特质 = c.固有 || 抽特质();
            c.技能 = 技能倾向();
            renderBody();
            if (RW.toast) RW.toast(c.名 + ' 已重掷', 'good');
        });
        return p;
    }

    function renderBody() {
        var box = document.getElementById('wz-body');
        if (!box) return;
        var html = '';
        // 流派预设
        html += '<div class="wz-sec"><h3>⚡ 流派预设（一键写入整组参数，可再微调）</h3><div class="wz-preset-row">';
        for (var i = 0; i < PRESETS.length; i++) {
            var pr = PRESETS[i];
            html += '<div class="wz-preset" data-preset="' + i + '"><h4>' + esc(pr.name) + '</h4><p>' + esc(pr.desc) + '</p></div>';
        }
        html += '</div></div>';
        // 世界参数
        html += '<div class="wz-sec"><h3>🌍 世界参数</h3>' +
            '<div class="wz-row"><label>种子</label><input id="wz-seed" value="' + esc(SEL.种子) + '" placeholder="留空=随机" style="width:140px"><span class="wz-desc">LCG 确定性：同种子同星球，可复现可分享</span></div>' +
            '<div class="wz-row"><label>降雨</label><input type="range" id="wz-rain" min="0" max="1" step="0.05" value="' + SEL.降雨 + '" style="flex:1;accent-color:var(--rw-accent2,#5fb4e5)"><span id="wz-rain-l">' + rainLabel(SEL.降雨) + '</span></div>' +
            '<div class="wz-row"><label>温度</label><input type="range" id="wz-temp" min="0" max="1" step="0.05" value="' + SEL.温度 + '" style="flex:1;accent-color:var(--rw-bad,#e05f5f)"><span id="wz-temp-l">' + tempLabel(SEL.温度) + '</span></div>' +
            '<div class="wz-row"><label>人口密度</label><input type="range" id="wz-pop" min="0" max="1" step="0.05" value="' + SEL.人口密度 + '" style="flex:1;accent-color:var(--rw-good,#6fbf5f)"><span id="wz-pop-l">' + popLabel(SEL.人口密度) + '</span></div>' +
            '<div class="wz-row"><label>派系数</label><input type="number" id="wz-fac" min="2" max="12" value="' + SEL.派系数 + '" style="width:60px"><span class="wz-desc">按敌对比例分配（近距部落/远距部落/氏族/邦联/机械族）</span></div></div>';
        // biome
        html += '<div class="wz-sec"><h3>🗺 着陆 biome（8 选 1，各配专属开场白与事件平衡）</h3><div class="wz-biome-grid">';
        for (var b = 0; b < BIOMES.length; b++) {
            var bm = BIOMES[b];
            html += '<div class="wz-biome ' + (SEL.biome === bm.id ? 'sel' : '') + '" data-biome="' + bm.id + '"><div class="bm-icon">' + bm.icon + '</div><div class="bm-name">' + bm.id + '</div><div class="bm-diff">' + bm.diff + '<br>' + bm.desc + '</div></div>';
        }
        html += '</div></div>';
        // 难度
        html += '<div class="wz-sec"><h3>⚔ 难度（乘数参数包）</h3><div class="wz-diff-grid">';
        for (var d = 0; d < DIFFS.length; d++) {
            var df = DIFFS[d];
            html += '<div class="wz-diff ' + (SEL.难度 === df.name ? 'sel' : '') + '" data-diff="' + df.name + '"><div class="df-name">' + df.name + '</div><div class="df-desc">' + df.desc + '</div></div>';
        }
        html += '</div></div>';
        // 队员编辑（原版式：背景/特质/技能可重掷）
        html += '<div class="wz-sec"><h3>👥 殖民队（3 名队员＋你，🎲 重掷至满意）</h3>';
        for (var ci2 = 0; ci2 < CREW.length; ci2++) {
            var c = CREW[ci2];
            html += '<div style="border:1px solid var(--rw-border,#33404f);border-radius:8px;padding:10px;margin-bottom:8px">' +
                '<div style="display:flex;justify-content:space-between;align-items:center"><b>' + (c.玩家 ? '👤 ' : '') + c.名 + '</b>' +
                '<button class="rw-btn wz-reroll" data-crew="' + ci2 + '" style="font-size:11px;padding:3px 10px">🎲 重掷</button></div>' +
                '<div style="font-size:12px;margin-top:6px">背景：' + c.背景 + '</div>' +
                '<div style="font-size:12px">特质：<b>' + c.特质 + '</b></div>' +
                '<div style="font-size:12px">技能倾向：' + c.技能 + '</div>' +
                '</div>';
        }
        html += '</div>';
        // 讲述者+科技
        html += '<div class="wz-sec"><h3>🎭 讲述者与科技</h3>' +
            '<div class="wz-row"><label>讲述者</label><select id="wz-nar">' + NARRATORS.map(function (n) { return '<option' + (SEL.讲述者 === n.id ? ' selected' : '') + '>' + n.id + '</option>'; }).join('') + '</select><span class="wz-desc" id="wz-nar-d">' + esc(narratorDesc()) + '</span></div>' +
            '<div class="wz-row"><label>我方科技上限</label><select id="wz-tech">' + TECHS.map(function (t) { return '<option' + (SEL.科技上限 === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select><span class="wz-desc">研究树按上限物理裁剪，模组可挂新分支</span></div>' +
            '<div class="wz-row"><label>敌方科技</label><select id="wz-etech"><option' + (SEL.敌方科技 === '同我方' ? ' selected' : '') + '>同我方</option>' + TECHS.map(function (t) { return '<option' + (SEL.敌方科技 === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select><span class="wz-desc">与上限分离＝不对称科技（CE 表自然生效：敌人高偏转+能量武器）</span></div></div>';
        box.innerHTML = html;
        bindBody(box);
    }

    function rainLabel(v) { return v < 0.25 ? '干燥' : v < 0.45 ? '半干旱' : v < 0.6 ? '季节性' : v < 0.8 ? '湿润' : '多雨'; }
    function tempLabel(v) { return v < 0.2 ? '极寒' : v < 0.4 ? '寒冷' : v < 0.6 ? '温和' : v < 0.8 ? '炎热' : '灼热'; }
    function popLabel(v) { return v < 0.3 ? '稀少' : v < 0.6 ? '正常' : v < 0.85 ? '稠密' : '蜂拥'; }
    function narratorDesc() {
        for (var i = 0; i < NARRATORS.length; i++) if (NARRATORS[i].id === SEL.讲述者) return NARRATORS[i].desc;
        return '';
    }

    function bindBody(box) {
        // 预设
        var presets = box.querySelectorAll('[data-preset]');
        for (var i = 0; i < presets.length; i++) {
            presets[i].onclick = function () {
                var pr = PRESETS[parseInt(this.getAttribute('data-preset'))];
                for (var k in pr.set) SEL[k] = pr.set[k];
                renderBody();
                if (RW.toast) RW.toast('已应用预设：' + pr.name, 'good');
            };
        }
        // biome
        var bms = box.querySelectorAll('[data-biome]');
        for (var b = 0; b < bms.length; b++) {
            bms[b].onclick = function () { SEL.biome = this.getAttribute('data-biome'); renderBody(); };
        }
        // 难度
        var dfs = box.querySelectorAll('[data-diff]');
        for (var d = 0; d < dfs.length; d++) {
            dfs[d].onclick = function () { SEL.难度 = this.getAttribute('data-diff'); renderBody(); };
        }
        // 滑条
        var rain = box.querySelector('#wz-rain');
        if (rain) rain.addEventListener('input', function () { SEL.降雨 = parseFloat(this.value); box.querySelector('#wz-rain-l').textContent = rainLabel(SEL.降雨); });
        var temp = box.querySelector('#wz-temp');
        if (temp) temp.addEventListener('input', function () { SEL.温度 = parseFloat(this.value); box.querySelector('#wz-temp-l').textContent = tempLabel(SEL.温度); });
        var pop = box.querySelector('#wz-pop');
        if (pop) pop.addEventListener('input', function () { SEL.人口密度 = parseFloat(this.value); box.querySelector('#wz-pop-l').textContent = popLabel(SEL.人口密度); });
        var seed = box.querySelector('#wz-seed');
        if (seed) seed.addEventListener('change', function () { SEL.种子 = this.value; });
        var fac = box.querySelector('#wz-fac');
        if (fac) fac.addEventListener('change', function () { SEL.派系数 = Math.max(2, Math.min(12, parseInt(this.value) || 6)); });
        var nar = box.querySelector('#wz-nar');
        if (nar) nar.addEventListener('change', function () { SEL.讲述者 = this.value; box.querySelector('#wz-nar-d').textContent = narratorDesc(); });
        var tech = box.querySelector('#wz-tech');
        if (tech) tech.addEventListener('change', function () { SEL.科技上限 = this.value; });
        var etech = box.querySelector('#wz-etech');
        if (etech) etech.addEventListener('change', function () { SEL.敌方科技 = this.value; });
    }

    function startWorld() {
        var st = readState();
        if (!st || !st.世界) {
            if (RW.toast) RW.toast('状态未就绪（先进入聊天，MVU 初始化后再开）', 'bad');
            return;
        }
        var seedNum = SEL.种子 ? hashStr(SEL.种子) : Math.floor(Math.random() * 1e9);
        var ok = writeState(function (s) {
            s.世界.设置 = s.世界.设置 || {};
            var set = s.世界.设置;
            set.biome = SEL.biome;
            set.难度 = SEL.难度;
            set.难度乘数 = SEL.难度 === '和平观察者' ? 0 : SEL.难度 === '社区建造者' ? 0.4 : SEL.难度 === '冒险故事' ? 1 : SEL.难度 === '血与灰烬' ? 1.8 : 2.6;
            set.讲述者 = SEL.讲述者;
            set.科技上限 = SEL.科技上限;
            set.敌方科技上限 = SEL.敌方科技;
            set.种子 = seedNum;
            set.降雨 = SEL.降雨;
            set.温度 = SEL.温度;
            set.人口密度 = SEL.人口密度;
            set.派系数量 = SEL.派系数;
            set.小队规模 = SEL.小队规模;
            set.玩家身份 = SEL.玩家身份;
            set.已初始化 = 1;
            s['$种子'] = seedNum; // 引擎隐藏变量同步
            s.玩家 = s.玩家 || {};
            s.玩家.身份 = SEL.玩家身份;
            var pw = CREW[3] || {};
            s.玩家.背景 = pw.背景 || ''; s.玩家.特质 = pw.特质 || ''; s.玩家.技能倾向 = pw.技能 || '';
            var crewMap = { '薇卡·奥斯特洛娃': '薇卡', '凯奥·里贝罗': '凯奥', '祝小满': '小满' };
            for (var ck in crewMap) {
                for (var ci3 = 0; ci3 < 3; ci3++) {
                    if (CREW[ci3].名 === ck && s[crewMap[ck]]) {
                        s[crewMap[ck]].背景 = CREW[ci3].背景; // 背景写入独立字段，不覆盖职业身份
                        s[crewMap[ck]].特质 = CREW[ci3].特质;
                    }
                }
            }
        }, '开局设置写入');
        // WorldGen 用种子重生成
        if (ok && RW.map) { RW.map.generate(seedNum); }
        if (ok && RW.toast) RW.toast('世界已生成：' + SEL.biome + ' · 种子 ' + seedNum + '（地图引擎已重掷）', 'good');
        if (ok) document.getElementById('rw-wizard').classList.remove('open');
        else if (RW.toast) RW.toast('写回失败', 'bad');
    }
    function hashStr(s) {
        var h = 0;
        for (var i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
        return h;
    }
    function writeState(mutator, reason) {
        var m = (window.Mvu || HOST.Mvu);
        try {
            if (m && typeof m.getMvuData === 'function' && typeof m.replaceMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                if (r && r.stat_data) { mutator(r.stat_data); m.replaceMvuData(r, reason || '开局设置'); return true; }
            }
        } catch (e) {}
        return false;
    }

    RW.wizard = {
        open: function () {
            try {
                if (HOST.Rimworld && HOST.Rimworld.closeAllPanels) HOST.Rimworld.closeAllPanels('rw-wizard');
                ensurePanel().classList.add('open');
                renderBody();
            } catch (eOpen) {
                try { console.error('[环开场] open 异常:', eOpen); } catch (e2) {}
                alert('[环世界] 开局设置面板异常：' + (eOpen && eOpen.message) + '\n（请截图此弹窗与 Console 报错发给作者）');
            }
        },
        SEL: SEL,
    };
    try { console.log('%c[环开场] ✅ 开局向导已注册（三组参数+5 流派预设+8 biome）', 'color:#e8a33d'); } catch (e) {}
})();
