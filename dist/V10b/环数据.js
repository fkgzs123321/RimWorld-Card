/* * ==========================================================================
 * [环世界] 百科图鉴 (Codex) v1
 * 五大图鉴 + 搜索：配方 / 物品来源去向 / 动物 / 事件 / 研究树连线图
 * 数据源：环经济.js 暴露的 工作台表/研究表/配方表（原版锚定）+ 本文件静态图鉴表
 * 全局 API：Rimworld.codex.open(类型, 搜索词)
 * UI：自建大面板（独立于环终端 Tab，z-index 更高），左分类右内容＋搜索
 * ========================================================================== */
(function () {
    'use strict';

    var HOST = (function () { var w = window; try { while (w.parent && w.parent !== w) w = w.parent; } catch (e) {} return w; })();
    var RW = HOST.Rimworld = HOST.Rimworld || {};
    var document = HOST.document;
    function log(tag, msg) { try { console.log('%c[环百科] ' + tag, 'color:#c9a05f;font-weight:bold', msg); } catch (e) {} }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    /* ═══════════ 样式 ═══════════ */
    var style = document.createElement('style');
    style.id = 'rw-codex-style';
    style.textContent = `
#rw-codex { position: fixed; inset: 0; background: rgba(8,10,14,.78); z-index: 100003; display: none; align-items: center; justify-content: center; }
#rw-codex.open { display: flex; }
.rw-cx { width: 980px; max-width: calc(100vw - 40px); height: 680px; max-height: calc(100vh - 50px);
  background: var(--rw-bg2, #1c232d); border: 2px solid var(--rw-accent2, #5fb4e5); border-radius: 12px;
  display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 14px 80px rgba(0,0,0,.8); }
.rw-cx-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--rw-bg, #151a21); border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-cx-head h2 { font-size: 15px; color: var(--rw-accent2, #5fb4e5); letter-spacing: 1px; }
.rw-cx-head input { flex: 1; max-width: 300px; margin-left: auto; background: var(--rw-bg, #151a21); color: var(--rw-text, #d8e2ec);
  border: 1px solid var(--rw-border, #33404f); border-radius: 6px; padding: 5px 10px; font-size: 12px; }
.rw-cx-body { flex: 1; display: flex; min-height: 0; }
.rw-cx-nav { width: 120px; background: var(--rw-bg, #151a21); border-right: 1px solid var(--rw-border, #33404f); padding: 6px 0; }
.rw-cx-nav-btn { padding: 9px 16px; cursor: pointer; color: var(--rw-dim, #8496a8); font-size: 13px; border-left: 3px solid transparent; }
.rw-cx-nav-btn:hover { color: var(--rw-text, #d8e2ec); background: var(--rw-bg3, #242e3b); }
.rw-cx-nav-btn.active { color: var(--rw-accent2, #5fb4e5); border-left-color: var(--rw-accent2, #5fb4e5); font-weight: 600; }
.rw-cx-content { flex: 1; overflow-y: auto; padding: 14px; }
.rw-cx-content::-webkit-scrollbar { width: 8px; }
.rw-cx-content::-webkit-scrollbar-thumb { background: var(--rw-border, #33404f); border-radius: 4px; }
.cx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.cx-card { background: var(--rw-panel, #202936); border: 1px solid var(--rw-border, #33404f); border-radius: 8px; padding: 10px; font-size: 12px; }
.cx-card h4 { color: var(--rw-accent, #e8a33d); font-size: 12px; margin-bottom: 6px; }
.cx-card .cx-line { margin: 3px 0; color: var(--rw-dim, #8496a8); font-size: 11px; }
.cx-card .cx-line b { color: var(--rw-text, #d8e2ec); font-weight: 600; }
.cx-card .cx-chain { font-size: 10px; line-height: 1.7; margin-top: 5px; padding-top: 5px; border-top: 1px dashed var(--rw-border, #33404f); }
.cx-diff { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; margin-left: 4px; }
.cx-diff.safe { background: rgba(111,191,95,.15); color: #9fd67f; }
.cx-diff.danger { background: rgba(224,95,95,.15); color: #f09f9f; }
.cx-diff.elite { background: rgba(255,159,67,.18); color: #ffb867; }
`;
    document.head.appendChild(style);

    /* ═══════════ 图鉴数据 ═══════════ */

    // 动物图鉴：单一事实来源 = 环动物.js TAMABLE（40 种），本表降级兜底
    var ANIMAL_CODEX = (function () {
        var T = (RW.husbandry && RW.husbandry.TAMABLE) || null;
        if (!T) return null;
        var out = [];
        for (var k in T) {
            var a = T[k];
            out.push({
                名: k, biome: (a.biome || ['任意']).join('/'), 危险: a.危险 || 0,
                产物: a.产出 + (a.肉量 ? ('（肉' + a.肉量 + '）') : ''),
                驯服: a.基础 > 0 ? ('可驯 基础' + Math.round(a.基础 * 100) + '%') : '不可驯',
                备注: (a.捕食 ? '捕食性；' : '') + (a.毒性 ? '带毒；' : '') + (a.成群 ? '成群；' : '') + (a.机械 ? '机械体；' : '') + (a.神兽 ? '传说级；' : '') + (a.胆小 ? '易惊跑；' : '') || '温顺'
            });
        }
        return out;
    })() || [

        // 温带/通用
        { 名: '鹿', biome: '温带森林/灌木丛', 危险: 0, 产物: '鹿肉×38·鹿皮', 驯服: '不可驯（反刍群居）', 备注: '逃跑型，猎杀零风险，是最稳的早期肉源' },
        { 名: '野兔', biome: '温带森林/干草原', 危险: 0, 产物: '兔肉×8·兔皮', 驯服: '不可驯', 备注: '体型小数量多，练射击的好靶子' },
        { 名: '火鸡', biome: '温带森林', 危险: 0, 产物: '火鸡肉×22·羽毛', 驯服: '可驯（杂食）', 备注: '驯服后可产蛋繁殖，早期蛋白库' },
        { 名: '野猪', biome: '温带森林/灌木丛', 危险: 1, 产物: '猪肉×46·猪皮', 驯服: '可驯（杂食）', 备注: '受伤后会反击，驯服后什么都吃包括尸体' },
        { 名: '狼', biome: '温带森林/冻原', 危险: 1, 产物: '狼肉×54·狼皮', 驯服: '可驯（肉食）', 备注: '群体行动，冬季袭营记录在案；驯服后是最好的护卫犬' },
        { 名: '灰熊', biome: '温带森林', 危险: 2, 产物: '熊肉×132·熊皮', 驯服: '可驯（肉食·危险）', 备注: '领地意识极强，一掌拍碎木墙；驯服后是移动堡垒' },
        { 名: '驼鹿', biome: '冻原/温带森林', 危险: 1, 产物: '鹿肉×168·鹿皮', 驯服: '不可驯', 备注: '大型肉源，被打伤后反击凶猛，狩猎需重武器' },
        { 名: '雪鼬', biome: '冻原/极地', 危险: 0, 产物: '肉×6·毛皮', 驯服: '可驯（肉食）', 备注: '极地少数小型猎物' },
        { 名: '北极熊', biome: '极地', 危险: 2, 产物: '熊肉×160·白熊皮', 驯服: '可驯（危险）', 备注: '极地霸主，比灰熊更凶' },
        { 名: '巨蝎', biome: '热带雨林', 危险: 2, 产物: '肉×60·几丁质', 驯服: '不可驯', 备注: '伏击型，毒素致痛；雨林夜行注意' },
        { 名: '沙羚', biome: '沙漠/干草原', 危险: 0, 产物: '羚羊肉×40', 驯服: '不可驯', 备注: '沙漠少见的稳定肉源，速度快' },
        { 名: '响尾蛇', biome: '沙漠', 危险: 1, 产物: '肉×9', 驯服: '不可驯', 备注: '毒素，被咬需医疗' },
        { 名: '骆驼', biome: '沙漠/干草原', 危险: 0, 产物: '驼肉×90·驼毛', 驯服: '可驯', 备注: '沙漠远行队的最好驮兽，耐渴' },
        // DLC：生物科技
        { 名: '机械蜘蛛（Biotech）', biome: '机械族集群', 危险: 2, 产物: '信号组件·金属', 驯服: '机械师可控制', 备注: '小型机械体，成群出现' },
        { 名: '半人马（Biotech）', biome: '机械族集群', 危险: 2, 产物: '信号组件·钢单位', 驯服: '机械师可控制', 备注: '重火力机械体，EMP 弹头对其特效' },
        // DLC：奥德赛
        { 名: '重力水母（Odyssey）', biome: '轨道/辉光森林', 危险: 1, 产物: '生物钢前体', 驯服: '不可驯', 备注: '漂浮生物，击落可获取稀有材料' },
        { 名: '熔岩蟹（Odyssey）', biome: '熔岩原', 危险: 2, 产物: '耐火壳', 驯服: '不可驯', 备注: '熔岩原特有，接近会被灼烧' },
    ];

    var EVENT_CODEX = [
        // 威胁类
        { 名: '袭击（随机派系）', 类: '威胁', 机制: '财富×难度乘数→袭击点数→敌人数量与装备', 应对: 'CE 战斗面板；防御工事按口径设计', 冷却: '基线 3-6 天' },
        { 名: '袭击（围城）', 类: '威胁', 机制: '敌人带迫击炮远程轰炸，不冲锋', 应对: '出城强袭或反炮兵', 冷却: '中期解锁' },
        { 名: '袭击（工兵）', 类: '威胁', 机制: '带爆破物破墙，无视工事', 应对: '纵深防御', 冷却: '中期解锁' },
        { 名: '空投袭击', 类: '威胁', 机制: '敌人直接空投进基地内部', 应对: '室内布防', 冷却: '中期解锁' },
        { 名: '机械族集群（Biotech）', 类: '威胁', 机制: '机械体波次，EMP 弹头特效', 应对: 'EMP 弹药储备', 冷却: '机械师激活后' },
        { 名: '异象实体（Anomaly）', 类: '威胁', 机制: '按模组设置的实体密度/威胁循环频率触发', 应对: '收容协议', 冷却: '激活延迟后' },
        { 名: '狂暴动物', 类: '威胁', 机制: '生态密度高的 biome 概率上升', 应对: '避入室内', 冷却: '随机' },
        { 名: '毒雾（有毒废气管线）', 类: '威胁', 机制: '全图室外毒雾，遮蔽+中毒', 应对: '室内待满全程', 冷却: '工业 pollution 线' },
        // 中立类
        { 名: '旅队到访', 类: '中立', 机制: '携带商品与来访者（访客系统）', 应对: '接待/贸易', 冷却: '随机' },
        { 名: '轨道商人', 类: '中立', 机制: '通讯台呼叫，买卖弹药物资', 应对: '囤积时采购', 冷却: '按呼叫' },
        { 名: '流浪者加入', 类: '中立', 机制: '生成殖民者模板→新队员', 应对: '分配工作', 冷却: '随机' },
        // 幸运类
        { 名: '运输舱坠毁', 类: '幸运', 机制: '随机物资/幸存者/袭击者伪装', 应对: '小心接近（可能是陷阱）', 冷却: '随机' },
        { 名: '灵感触发', 类: '幸运', 机制: '随机殖民者获得灵感：狂热创作/灵感突袭/受启发贸易', 应对: '立即安排对应工作', 冷却: '心情高时概率上升' },
    ];

    // 物品来源-去向（对齐《物质与配方总账》）
    var ITEM_CHAINS = {
        钢材: { 来源: '采矿（铁矿石）→燃料冶炼炉 冶炼（10矿→5钢）；贸易；缴获', 去向: '建造/武器/弹药制造/机械加工台建材', 警告: '弹药链核心原料，袭击季前务必囤积' },
        组件机件: { 来源: '采矿（簇状矿脉）；机械族拆解；贸易', 去向: '机械加工台/药物实验台/高级研究台建材、精密配件', 警告: '最稀缺的工业原料，矿脉有限储量' },
        中性胺: { 来源: '只能进口（轨道商人/旅队）', 去向: '工业药品/Go-juice/Wake-up 合成', 警告: '本地无矿，制药线卡脖子项' },
        食材: { 来源: '种植收获/狩猎屠宰/采集浆果/贸易', 去向: '烹饪/生食/腐败', 警告: '按温度腐败：热带 1 日/温带 3 日/冷冻无限——冷库是第一优先建筑' },
        草药医药: { 来源: '种植 healroot 或采集', 去向: '医疗（0.6x 效果）', 警告: '早期唯一药品，别拿去卖' },
        工业药品: { 来源: '药物实验台（中性胺×2+草药）', 去向: '医疗（1.0x）', 警告: '需要药品生产研究+实验室房间' },
        高级医药: { 来源: '贸易/远行队', 去向: '医疗（1.6x）/手术', 警告: '不可制造，手术前必备' },
        生物燃料: { 来源: '生物燃料精炼器（木材×35→35）', 去向: '发电机/燃料冶炼炉燃料', 警告: '电力研究后解锁' },
        弹药: { 来源: '机械加工台制造（弹药制造研究）；贸易；缴获', 去向: '射击/战斗消耗', 警告: '弹药库存计入财富→囤弹即囤袭击强度' },
        动物尸体: { 来源: '狩猎/动物死亡', 去向: '屠宰桌屠宰（肉/皮按体型）→自然腐败', 警告: '尽快屠宰，尸体腐败速率翻倍' },
    };

    /* ═══════════ 面板 ═══════════ */

    var currentCat = '配方';

    function ensurePanel() {
        var p = document.getElementById('rw-codex');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'rw-codex';
        p.innerHTML =
            '<div class="rw-cx">' +
            '<div class="rw-cx-head"><h2>📖 环世界百科</h2>' +
            '<input id="cx-search" placeholder="搜索…（配方/物品/动物/事件名）">' +
            '<button class="rw-btn" id="cx-close">✕</button></div>' +
            '<div class="rw-cx-body"><div class="rw-cx-nav" id="cx-nav"></div><div class="rw-cx-content" id="cx-content"></div></div>' +
            '</div>';
        document.body.appendChild(p);
        /* 点遮罩关闭 */
        (function () { var el0 = document.getElementById('rw-codex'); if (el0) el0.addEventListener('click', function (e) { if (e.target === el0) el0.classList.remove('open'); }); })();
        p.addEventListener('click', function (e) {
            if (e.target === p) p.classList.remove('open');
            var nb = e.target.closest('.rw-cx-nav-btn');
            if (nb) { currentCat = nb.getAttribute('data-cat'); renderNav(); renderContent(); }
        });
        p.querySelector('#cx-close').onclick = function () { p.classList.remove('open'); };
        p.querySelector('#cx-search').addEventListener('input', function () { renderContent(); });
        return p;
    }

    function renderNav() {
        var nav = document.getElementById('cx-nav');
        if (!nav) return;
        var cats = [['配方', '⚗️'], ['物品链', '📦'], ['动物', '🐾'], ['事件', '🎲'], ['研究树', '🔬']];
        nav.innerHTML = cats.map(function (c) {
            return '<div class="rw-cx-nav-btn ' + (currentCat === c[0] ? 'active' : '') + '" data-cat="' + c[0] + '">' + c[1] + ' ' + c[0] + '</div>';
        }).join('');
    }

    function match(text, kw) { return !kw || String(text).indexOf(kw) >= 0; }

    function renderContent() {
        var box = document.getElementById('cx-content');
        if (!box) return;
        var kw = (document.getElementById('cx-search') || {}).value || '';
        var eco = RW.economy;
        var html = '';

        if (currentCat === '配方') {
            var recipes = (eco && eco.配方表) || {};
            var keys = Object.keys(recipes).filter(function (k) { return match(k, kw); });
            if (!keys.length) html = '<div class="rw-empty">无匹配配方</div>';
            for (var i = 0; i < keys.length; i++) {
                var r = recipes[keys[i]];
                var ing = r.原料 || {};
                var ingStr = Object.keys(ing).map(function (m) { return m + '×' + ing[m]; }).join(' + ');
                var prod = r.产出 || {};
                var prodStr = Object.keys(prod).map(function (m) { return m + '×' + prod[m]; }).join(' + ');
                html += '<div class="cx-card"><h4>⚗️ ' + esc(keys[i]) + '</h4>' +
                    '<div class="cx-line">原料：<b>' + esc(ingStr) + '</b></div>' +
                    '<div class="cx-line">产出：<b>' + esc(prodStr) + '</b>' + (r.工时 ? '（工时 ' + esc(r.工时) + '）' : '') + '</div>' +
                    '<div class="cx-line">工作台：<b>' + esc(r.台 || '—') + '</b>' + (r.研 ? ' · 前置研究：<b>' + esc(r.研) + '</b>' : ' · 无需研究') + '</div>' +
                    (r.基准 ? '<div class="cx-line">判定基准值：' + esc(r.基准) + '（E3 判定，档位倍率：大成功×1.5/勉强×0.6）</div>' : '') +
                    '</div>';
            }
        }
        else if (currentCat === '物品链') {
            var ik = Object.keys(ITEM_CHAINS).filter(function (k) { return match(k, kw); });
            for (var j = 0; j < ik.length; j++) {
                var it = ITEM_CHAINS[ik[j]];
                html += '<div class="cx-card"><h4>📦 ' + esc(ik[j]) + '</h4>' +
                    '<div class="cx-chain"><b style="color:#9fd67f">来源：</b>' + esc(it.来源) + '<br>' +
                    '<b style="color:#f09f9f">去向：</b>' + esc(it.去向) + '<br>' +
                    '<b style="color:var(--rw-warn,#e5c15f)">⚠ ' + esc(it.警告) + '</b></div></div>';
            }
            if (!ik.length) html = '<div class="rw-empty">无匹配物品</div>';
        }
        else if (currentCat === '动物') {
            var az = ANIMAL_CODEX.filter(function (a) { return match(a.名, kw) || match(a.biome, kw); });
            if (!az.length) html = '<div class="rw-empty">无匹配动物</div>';
            for (var a = 0; a < az.length; a++) {
                var an = az[a];
                var diffCls = an.危险 === 0 ? 'safe' : an.危险 === 1 ? 'danger' : 'elite';
                var diffTxt = an.危险 === 0 ? '温顺' : an.危险 === 1 ? '危险' : '致命';
                html += '<div class="cx-card"><h4>🐾 ' + esc(an.名) + '<span class="cx-diff ' + diffCls + '">' + diffTxt + '</span></h4>' +
                    '<div class="cx-line">biome：' + esc(an.biome) + '</div>' +
                    '<div class="cx-line">产物：<b>' + esc(an.产物) + '</b></div>' +
                    '<div class="cx-line">驯服：' + esc(an.驯服) + '</div>' +
                    '<div class="cx-line">' + esc(an.备注) + '</div></div>';
            }
        }
        else if (currentCat === '事件') {
            var evs = EVENT_CODEX.filter(function (e) { return match(e.名, kw) || match(e.类, kw); });
            if (!evs.length) html = '<div class="rw-empty">无匹配事件</div>';
            for (var e2 = 0; e2 < evs.length; e2++) {
                var ev = evs[e2];
                var cls2 = ev.类 === '威胁' ? 'danger' : ev.类 === '幸运' ? 'safe' : 'elite';
                html += '<div class="cx-card"><h4>🎲 ' + esc(ev.名) + '<span class="cx-diff ' + cls2 + '">' + esc(ev.类) + '</span></h4>' +
                    '<div class="cx-line">机制：<b>' + esc(ev.机制) + '</b></div>' +
                    '<div class="cx-line">应对：' + esc(ev.应对) + '</div>' +
                    '<div class="cx-line">冷却：' + esc(ev.冷却) + '</div></div>';
            }
        }
        else if (currentCat === '研究树') {
            html = '<div class="cx-card" style="grid-column:1/-1"><h4>🔬 研究树连线图（Canvas 渲染）</h4>' +
                '<canvas id="cx-research-canvas" width="900" height="460" style="max-width:100%;border:1px solid var(--rw-border,#33404f);border-radius:6px;background:var(--rw-bg,#151a21)"></canvas>' +
                '<div style="font-size:10px;color:var(--rw-dim,#8496a8);margin-top:6px">绿=已完成 蓝=可研究 灰=锁定；连线=前置关系。部落开局全部成本×2</div></div>';
            box.innerHTML = html;
            drawResearchTree(kw);
            return;
        }
        box.innerHTML = html || '<div class="rw-empty">无匹配</div>';
    }

    /* ── 研究树 Canvas 连线图 ── */
    function drawResearchTree(kw) {
        var canvas = document.getElementById('cx-research-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var eco = RW.economy;
        var done = [];
        try {
            var m = (window.Mvu || HOST.Mvu);
            if (m && typeof m.getMvuData === 'function') {
                var r = m.getMvuData({ type: 'message', message_id: 'latest' });
                done = (((r && r.stat_data && r.stat_data.研究) || {}).已完成 || '').split('、').filter(Boolean);
            }
        } catch (e) {}
        var tree = (eco && eco.研究表) || {};
        var names = Object.keys(tree).filter(function (n) { return match(n, kw); });
        // 布局：按深度分列
        var depth = {}, maxDepth = 0;
        function getDepth(n, seen) {
            if (depth[n] != null) return depth[n];
            if (seen.indexOf(n) >= 0) return 0;
            seen.push(n);
            var pre = (tree[n] && tree[n].前置) || [];
            var d = 0;
            for (var i = 0; i < pre.length; i++) d = Math.max(d, getDepth(pre[i], seen) + 1);
            depth[n] = d;
            maxDepth = Math.max(maxDepth, d);
            return d;
        }
        names.forEach(function (n) { getDepth(n, []); });
        var colCount = maxDepth + 1;
        var colW = 860 / Math.max(1, colCount), colY = {};
        for (var d2 = 0; d2 < colCount; d2++) colY[d2] = 30;
        var nodes = {};
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // 连线
        ctx.strokeStyle = 'rgba(95,180,229,.4)';
        ctx.lineWidth = 1.5;
        for (var ni = 0; ni < names.length; ni++) {
            var n2 = names[ni];
            var pre2 = (tree[n2] && tree[n2].前置) || [];
            for (var pi = 0; pi < pre2.length; pi++) {
                if (!tree[pre2[pi]] || !match(pre2[pi], kw)) continue;
                if (!nodes[pre2[pi]]) nodes[pre2[pi]] = place(pre2[pi]);
                if (!nodes[n2]) nodes[n2] = place(n2);
                ctx.beginPath();
                ctx.moveTo(nodes[pre2[pi]].x + 78, nodes[pre2[pi]].y + 13);
                ctx.lineTo(nodes[n2].x, nodes[n2].y + 13);
                ctx.stroke();
            }
        }
        function place(n) {
            var dep = depth[n] != null ? depth[n] : 0;
            var x = 14 + dep * colW;
            var y = colY[dep];
            colY[dep] += 44;
            return { x: x, y: y };
        }
        // 节点
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        for (var n3 = 0; n3 < names.length; n3++) {
            var nm = names[n3];
            if (!nodes[nm]) nodes[nm] = place(nm);
            var pos = nodes[nm];
            var isDone = done.indexOf(nm) >= 0;
            var pre3 = (tree[nm] && tree[nm].前置) || [];
            var preOk = pre3.every(function (p) { return done.indexOf(p) >= 0; });
            ctx.fillStyle = isDone ? 'rgba(111,191,95,.25)' : preOk ? 'rgba(95,180,229,.22)' : 'rgba(120,130,145,.15)';
            ctx.strokeStyle = isDone ? '#6fbf5f' : preOk ? '#5fb4e5' : '#5a6472';
            ctx.lineWidth = 1.5;
            var w = Math.max(88, nm.length * 13 + 18);
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(pos.x, pos.y, w, 26, 6); else ctx.rect(pos.x, pos.y, w, 26);
            ctx.fill(); ctx.stroke();
            ctx.fillStyle = isDone ? '#9fd67f' : preOk ? '#9fd0f0' : '#8496a8';
            ctx.fillText(nm, pos.x + w / 2, pos.y + 17);
            ctx.fillStyle = 'rgba(132,150,168,.75)';
            ctx.font = '9px sans-serif';
            ctx.fillText((tree[nm] && tree[nm].成本 || '?') + 'tk', pos.x + w / 2, pos.y + 38);
            ctx.font = '11px sans-serif';
        }
    }

    /* ═══════════ 对外 API ═══════════ */

    RW.codex = {
        open: function (cat, kw) {
            var p = ensurePanel();
                        try { if (HOST.Rimworld && HOST.Rimworld.closeAllPanels) HOST.Rimworld.closeAllPanels("rw-codex"); } catch (e) {}            p.classList.add('open');
            if (cat) currentCat = cat;
            renderNav();
            if (kw != null) { var si = document.getElementById('cx-search'); if (si) si.value = kw; }
            renderContent();
        },
        close: function () { var p = document.getElementById('rw-codex'); if (p) p.classList.remove('open'); },
    };
    log('✅', '百科图鉴已注册（配方/物品链/动物/事件/研究树连线图）');
})();
