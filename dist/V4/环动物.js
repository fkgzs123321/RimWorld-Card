/* * ==========================================================================
 * [环世界] 动物驯养 (Animal Husbandry) v1
 * 从地图动物区读取动物 → 驯服判定（E3：驯服基础×动物难度 vs 动物技能）
 *   → 驯服后登记（名字/分工：陪伴·驮运·护卫·产奶·产蛋）
 *   → 管理：喂养（消耗饲料）/屠宰（接环经济.屠宰）/放生
 * 全局 API：Rimworld.husbandry.open()
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
    style.id = 'rw-hus-style';
    style.textContent = `
#rw-hus { position: fixed; inset: 0; background: rgba(8,10,14,.78); z-index: 100004; display: none; align-items: center; justify-content: center; }
#rw-hus.open { display: flex; }
.rw-hus2 { width: 880px; max-width: calc(100vw - 40px); height: 640px; max-height: calc(100vh - 50px);
  background: var(--rw-bg2, #1c232d); border: 2px solid var(--rw-good, #6fbf5f); border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; }
.rw-hus2-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--rw-bg, #151a21); border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-hus2-head h2 { font-size: 15px; color: var(--rw-good, #6fbf5f); }
.rw-hus2-body { flex: 1; display: flex; min-height: 0; }
.hus-col { flex: 1; padding: 12px; overflow-y: auto; border-right: 1px solid var(--rw-border, #33404f); }
.hus-col:last-child { border-right: none; }
.hus-col h3 { font-size: 13px; color: var(--rw-good, #6fbf5f); margin-bottom: 8px; }
.hus-animal { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid var(--rw-border, #33404f);
  border-radius: 7px; margin: 5px 0; font-size: 12px; }
.hus-animal .an-name { flex: 1; }
.hus-animal .an-risk { font-size: 10px; }
.hus-pet { background: var(--rw-panel, #202936); border: 1px solid var(--rw-border, #33404f); border-radius: 8px; padding: 10px; margin: 6px 0; font-size: 12px; }
.hus-pet .pt-name { font-weight: 700; }
.hus-pet .pt-role { font-size: 10px; padding: 1px 8px; border-radius: 8px; border: 1px solid var(--rw-accent2, #5fb4e5); color: var(--rw-accent2, #5fb4e5); margin-left: 6px; }
.rw-btn { padding: 5px 12px; border: 1px solid var(--rw-accent, #e8a33d); border-radius: 6px; background: transparent; color: var(--rw-accent, #e8a33d); cursor: pointer; font-size: 11px; }
.rw-btn.primary { background: var(--rw-accent, #e8a33d); color: var(--rw-bg, #151a21); font-weight: 700; }
.rw-btn:disabled { opacity: .35; cursor: not-allowed; }
`;
    document.head.appendChild(style);

    // 驯服数据（原版 wiki 锚定 41 种）：基础驯服率 × 驯服难度；危险等级=捕食性/领地性；肉量按体型（S/M/L/XL）
    var TAMABLE = {
        // ── 家畜（起点动物，部落可交易获得）──
        母鸡: { 基础: 0.95, 产出: '鸡蛋（日产）', 角色: ['产蛋'], 体型: 'S', 肉量: 8, 危险: 0, biome: ['通用'] },
        奶牛: { 基础: 0.9, 产出: '牛奶（日产）+大量肉', 角色: ['产奶', '肉源'], 体型: 'L', 肉量: 160, 危险: 0, biome: ['通用'] },
        绵羊: { 基础: 0.9, 产出: '羊毛（剪毛）+肉', 角色: ['产毛', '肉源'], 体型: 'M', 肉量: 45, 危险: 0, biome: ['温带森林', '干草原'] },
        山羊: { 基础: 0.9, 产出: '奶+肉（耐粗饲）', 角色: ['产奶', '肉源'], 体型: 'M', 肉量: 40, 危险: 0, biome: ['灌木丛', '干草原'] },
        家猪: { 基础: 0.9, 产出: '大量肉（杂食可喂馊水）', 角色: ['肉源'], 体型: 'M', 肉量: 70, 危险: 0, biome: ['通用'] },
        驴: { 基础: 0.85, 产出: '驮运（负重高）', 角色: ['驮运'], 体型: 'M', 肉量: 85, 危险: 0, biome: ['通用'] },
        马: { 基础: 0.85, 产出: '骑乘+驮运（移速最高）', 角色: ['骑乘', '驮运'], 体型: 'L', 肉量: 110, 危险: 0, biome: ['干草原', '温带森林'] },
        // ── 温带森林/干草原 ──
        火鸡: { 基础: 0.85, 产出: '火鸡蛋', 角色: ['产蛋', '陪伴'], 体型: 'S', 肉量: 12, 危险: 0, biome: ['温带森林', '干草原'] },
        野兔: { 基础: 0.8, 产出: '少量肉+皮', 角色: ['陪伴'], 体型: 'S', 肉量: 5, 危险: 0, biome: ['温带森林', '灌木丛', '干草原'] },
        野猪: { 基础: 0.6, 产出: '猪肉（屠宰）', 角色: ['陪伴', '驮运'], 体型: 'M', 肉量: 55, 危险: 1, biome: ['温带森林', '灌木丛'] },
        鹿: { 基础: 0.5, 产出: '肉+鹿皮', 角色: ['肉源'], 体型: 'M', 肉量: 60, 危险: 0, biome: ['温带森林', '灌木丛'] },
        驼鹿: { 基础: 0.45, 产出: '大量肉+皮', 角色: ['肉源', '驮运'], 体型: 'L', 肉量: 130, 危险: 1, biome: ['温带森林', '冻原'] },
        狼: { 基础: 0.4, 产出: '护卫', 角色: ['护卫'], 体型: 'M', 肉量: 40, 危险: 2, 捕食: true, biome: ['温带森林', '冻原', '干草原'] },
        狐狸: { 基础: 0.5, 产出: '皮毛佳', 角色: ['陪伴'], 体型: 'S', 肉量: 8, 危险: 0, biome: ['温带森林', '冻原'] },
        浣熊: { 基础: 0.6, 产出: '肉少皮好', 角色: ['陪伴'], 体型: 'S', 肉量: 7, 危险: 0, biome: ['温带森林'] },
        鸸鹋: { 基础: 0.55, 产出: '大蛋+肉', 角色: ['产蛋', '护卫'], 体型: 'M', 肉量: 45, 危险: 1, biome: ['灌木丛', '干草原'] },
        野山羊: { 基础: 0.65, 产出: '奶+肉', 角色: ['产奶'], 体型: 'M', 肉量: 42, 危险: 0, biome: ['灌木丛', '干草原'] },
        // ── 沙漠 ──
        骆驼: { 基础: 0.55, 产出: '驮运+耐渴', 角色: ['驮运'], 体型: 'L', 肉量: 120, 危险: 0, biome: ['沙漠', '干草原'] },
        瞪羚: { 基础: 0.5, 产出: '肉（速度快难追）', 角色: [], 体型: 'M', 肉量: 35, 危险: 0, 胆小: true, biome: ['沙漠', '干草原'] },
        鬣蜥: { 基础: 0.7, 产出: '少量蛋+肉', 角色: ['产蛋'], 体型: 'S', 肉量: 9, 危险: 0, biome: ['沙漠', '灌木丛'] },
        巨蝎: { 基础: 0.3, 产出: '毒尾（药材）', 角色: ['护卫'], 体型: 'M', 肉量: 25, 危险: 3, 捕食: true, 毒性: true, biome: ['沙漠', '热带雨林'] },
        土狼: { 基础: 0.45, 产出: '群体护卫', 角色: ['护卫'], 体型: 'M', 肉量: 30, 危险: 2, 捕食: true, 成群: true, biome: ['沙漠', '灌木丛', '干草原'] },
        // ── 冻原/极地 ──
        北极熊: { 基础: 0.2, 产出: '极地重护卫+厚皮', 角色: ['护卫'], 体型: 'XL', 肉量: 200, 危险: 4, 捕食: true, biome: ['冻原', '极地'] },
        驯鹿: { 基础: 0.6, 产出: '驮运+奶+皮（寒地主力）', 角色: ['驮运', '产奶'], 体型: 'L', 肉量: 95, 危险: 0, biome: ['冻原', '极地'] },
        麝牛: { 基础: 0.5, 产出: '大量肉+绒毛（极寒毛）', 角色: ['肉源', '产毛'], 体型: 'XL', 肉量: 180, 危险: 1, 群护: true, biome: ['冻原', '极地'] },
        雪狐: { 基础: 0.55, 产出: '极品白皮', 角色: ['陪伴'], 体型: 'S', 肉量: 6, 危险: 0, biome: ['冻原', '极地'] },
        北极野兔: { 基础: 0.8, 产出: '少量肉', 角色: ['陪伴'], 体型: 'S', 肉量: 5, 危险: 0, biome: ['极地'] },
        海豹: { 基础: 0.5, 产出: '大量肉+厚脂（极地油脂源）', 角色: ['肉源'], 体型: 'L', 肉量: 140, 危险: 1, biome: ['极地', '海洋'] },
        狼獾: { 基础: 0.35, 产出: '凶悍护卫', 角色: ['护卫'], 体型: 'M', 肉量: 28, 危险: 3, 捕食: true, 凶悍: true, biome: ['冻原'] },
        // ── 热带雨林 ──
        吼猴: { 基础: 0.7, 产出: '陪伴（吵）', 角色: ['陪伴'], 体型: 'S', 肉量: 10, 危险: 0, biome: ['热带雨林'] },
        巨嘴鸟: { 基础: 0.75, 产出: '艳羽（贸易品）', 角色: ['产羽'], 体型: 'S', 肉量: 6, 危险: 0, biome: ['热带雨林'] },
        水豚: { 基础: 0.8, 产出: '肉多性格好', 角色: ['肉源', '陪伴'], 体型: 'M', 肉量: 50, 危险: 0, 温顺: true, biome: ['热带雨林'] },
        食蚁兽: { 基础: 0.6, 产出: '吃虫（营地除虫）', 角色: ['除虫'], 体型: 'M', 肉量: 33, 危险: 0, biome: ['热带雨林'] },
        黑豹: { 基础: 0.3, 产出: '顶级护卫（隐匿）', 角色: ['护卫'], 体型: 'L', 肉量: 70, 危险: 4, 捕食: true, 隐匿: true, biome: ['热带雨林'] },
        巨蟒: { 基础: 0.35, 产出: '蛇皮（大张）', 角色: ['护卫'], 体型: 'L', 肉量: 60, 危险: 4, 捕食: true, 缠绕: true, biome: ['热带雨林'] },
        鹦鹉: { 基础: 0.85, 产出: '学舌（报信玩梗）', 角色: ['报信', '陪伴'], 体型: 'S', 肉量: 3, 危险: 0, biome: ['热带雨林'] },
        // ── 特殊/大型 ──
        巨树懒: { 基础: 0.4, 产出: '超厚皮+大量肉', 角色: ['驮运', '肉源'], 体型: 'XL', 肉量: 220, 危险: 2, biome: ['温带森林', '灌木丛'] },
        神秘巨兽: { 基础: 0.15, 产出: '传说级：独角（天价）+神兽皮+巨量肉', 角色: ['重护卫'], 体型: 'XL', 肉量: 350, 危险: 5, 捕食: false, 神兽: true, 稀有: true, biome: ['任意'] },
        机械蜈蚣: { 基础: 0, 产出: '不可驯（机械族核心）', 角色: [], 体型: 'XL', 肉量: 0, 危险: 5, 机械: true, 敌对: true, biome: ['任意'] },
        机械蝎蝽: { 基础: 0, 产出: '不可驯（拆件研究素材）', 角色: [], 体型: 'M', 肉量: 0, 危险: 4, 机械: true, 敌对: true, biome: ['任意'] },
    };

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
                if (r && r.stat_data) { mutator(r.stat_data); m.replaceMvuData(r, reason || '动物驯养'); return true; }
            }
        } catch (e) {}
        return false;
    }
    function mapAnimals() {
        return (RW.map && RW.map.animals) || [];
    }
    function tamerSkill(st) {
        // 三人取最高动物技能
        var best = 0;
        var cols = ['薇卡', '凯奥', '祝小满'];
        for (var i = 0; i < cols.length; i++) {
            var p = st[cols[i]];
            if (p && p.技能 && p.技能.动物) {
                var lv = typeof p.技能.动物 === 'number' ? p.技能.动物 : p.技能.动物.等级 || 0;
                if (lv > best) best = lv;
            }
        }
        return best;
    }

    function ensurePanel() {
        var p = document.getElementById('rw-hus');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'rw-hus';
        p.innerHTML = '<div class="rw-hus2">' +
            '<div class="rw-hus2-head"><h2>🐾 动物驯养</h2><span style="font-size:10px;color:var(--rw-dim,#8496a8)">驯服率 = 基础 × (0.5 + 动物技能×2.5%)；危险动物驯服可能反被攻击</span>' +
            '<span style="flex:1"></span><button class="rw-btn" id="hus-close">✕</button></div>' +
            '<div class="rw-hus2-body"><div class="hus-col" id="hus-wild"></div><div class="hus-col" id="hus-pets"></div></div></div>';
        document.body.appendChild(p);
        /* 点遮罩关闭 */
        (function () { var el0 = document.getElementById('rw-hus'); if (el0) el0.addEventListener('click', function (e) { if (e.target === el0) el0.classList.remove('open'); }); })();
        p.querySelector('#hus-close').onclick = function () { p.classList.remove('open'); };
        p.addEventListener('click', function (e) { if (e.target === p) p.classList.remove('open'); });
        return p;
    }

    function render() {
        var st = readState() || {};
        var wildBox = document.getElementById('hus-wild');
        var petBox = document.getElementById('hus-pets');
        if (!wildBox) return;
        // 野生动物（从地图）
        var animals = mapAnimals();
        var grouped = {};
        for (var i = 0; i < animals.length; i++) {
            var a = animals[i];
            if (grouped[a.种]) grouped[a.种].count++;
            else grouped[a.种] = { count: 1, 危险: a.危险, 色: a.色 };
        }
        var skill = tamerSkill(st);
        var html = '<h3>🔍 野外动物（驯服技能 ' + skill + '）</h3>';
        var anyWild = false;
        for (var k in grouped) {
            var g = grouped[k];
            var tam = TAMABLE[k];
            anyWild = true;
            var rate = tam ? Math.min(0.95, tam.基础 * (0.5 + skill * 0.025)) : null;
            html += '<div class="hus-animal"><span class="an-name">' + esc(k) + ' ×' + g.count +
                (rate != null ? ' <small style="color:var(--rw-dim,#8496a8)">驯服率 ' + Math.round(rate * 100) + '%</small>' : ' <small style="color:var(--rw-dim,#8496a8)">不可驯</small>') + '</span>' +
                (g.危险 ? '<span class="an-risk" style="color:var(--rw-bad,#e05f5f)">危险</span>' : '<span class="an-risk" style="color:var(--rw-good,#6fbf5f)">温顺</span>') +
                (rate != null ? '<button class="rw-btn" data-tame="' + esc(k) + '">🪢 驯服</button>' : '') + '</div>';
        }
        if (!anyWild) html += '<div class="rw-empty">地图未生成或没有动物（打开地图 Tab 生成）</div>';
        wildBox.innerHTML = html;
        // 已驯养
        var pets = st.驯养 || [];
        var html2 = '<h3>🐾 已驯养（' + pets.length + '）</h3>';
        if (!pets.length) html2 += '<div class="rw-empty">还没有驯养的动物</div>';
        for (var p = 0; p < pets.length; p++) {
            var pet = pets[p];
            html2 += '<div class="hus-pet"><span class="pt-name">' + esc(pet.名字) + '</span><span>' + esc(pet.种) + '</span>' +
                '<span class="pt-role">' + esc(pet.角色 || '陪伴') + '</span>' +
                '<div style="margin-top:6px">' +
                '<button class="rw-btn" data-feed="' + p + '">🥕 喂养（消耗饲料×1）</button> ' +
                '<button class="rw-btn" data-slaughter="' + p + '">🔪 屠宰</button> ' +
                '<button class="rw-btn" data-release="' + p + '">🕊 放生</button></div></div>';
        }
        petBox.innerHTML = html2;
        // 绑定驯服
        var tames = wildBox.querySelectorAll('[data-tame]');
        for (var t = 0; t < tames.length; t++) {
            tames[t].onclick = function () { tame(st, this.getAttribute('data-tame'), skill); };
        }
        var feeds = petBox.querySelectorAll('[data-feed]');
        for (var f = 0; f < feeds.length; f++) feeds[f].onclick = function () { feed(st, parseInt(this.getAttribute('data-feed'))); };
        var slaughters = petBox.querySelectorAll('[data-slaughter]');
        for (var s = 0; s < slaughters.length; s++) slaughters[s].onclick = function () { slaughter(st, parseInt(this.getAttribute('data-slaughter'))); };
        var releases = petBox.querySelectorAll('[data-release]');
        for (var r = 0; r < releases.length; r++) releases[r].onclick = function () { release(st, parseInt(this.getAttribute('data-release'))); };
    }

    function tame(st, 种, skill) {
        var tam = TAMABLE[种];
        if (!tam) return;
        var rate = Math.min(0.95, tam.基础 * (0.5 + skill * 0.025));
        var success = Math.random() < rate;
        var msg;
        if (success) {
            writeState(function (s) {
                if (!s.驯养) s.驯养 = [];
                var names = ['豆豆', '毛毛', '大壮', '雪球', '阿黄', '黑炭', '汤圆', '碎骨'];
                s.驯养.push({ 种: 种, 名字: names[Math.floor(Math.random() * names.length)] + (s.驯养.length + 1), 角色: tam.角色[0], 饱食: 80 });
                if (!s.$流水账) s.$流水账 = [];
                s.$流水账.push({ 物品: '饲料', 数量: 2, 方向: '减', 事由: '驯服·' + 种, 楼层: '最新' });
                var inv = s.库存 = s.库存 || { 物资: {}, 弹药: {}, 食物: {}, 药品: {} };
                inv.食物 = inv.食物 || {};
                inv.食物['饲料'] = Math.max(0, (inv.食物['饲料'] || 0) - 2);
                if (!s.事件记录) s.事件记录 = [];
                s.事件记录.push('【驯服】成功驯服一只' + 种 + '（驯服率 ' + Math.round(rate * 100) + '%）');
            }, '驯服成功');
            msg = '驯服成功！' + 种 + ' 加入殖民地';
        } else {
            writeState(function (s) {
                if (!s.事件记录) s.事件记录 = [];
                s.事件记录.push('【驯服失败】' + 种 + ' 挣脱逃跑' + (TAMABLE[种] && (种 === '狼' || 种 === '灰熊' || 种 === '北极熊') ? '，并有反咬倾向' : ''));
            }, '驯服失败');
            msg = '驯服失败：' + 种 + ' 挣脱逃跑';
        }
        if (RW.toast) RW.toast(msg, success ? 'good' : 'warn');
        render();
    }

    function feed(st, idx) {
        writeState(function (s) {
            var inv = s.库存 = s.库存 || { 物资: {}, 弹药: {}, 食物: {}, 药品: {} };
            inv.食物 = inv.食物 || {};
            var feedStock = (inv.食物['饲料'] || 0) + (inv.食物['稻米'] || 0);
            if (feedStock < 1) { s.__husFail = '没有饲料或粮食可喂'; return; }
            var useKey = (inv.食物['饲料'] || 0) > 0 ? '饲料' : '稻米';
            inv.食物[useKey]--;
            if (inv.食物[useKey] <= 0) delete inv.食物[useKey];
            s.驯养[idx].饱食 = 100;
            if (!s.$流水账) s.$流水账 = [];
            s.$流水账.push({ 物品: useKey, 数量: 1, 方向: '减', 事由: '喂养·' + s.驯养[idx].名字, 楼层: '最新' });
            s.__husFail = null;
        }, '喂养动物');
        var fail = st.__husFail;
        st.__husFail = null;
        if (RW.toast) RW.toast(fail || '已喂养', fail ? 'bad' : 'good');
        render();
    }

    function slaughter(st, idx) {
        writeState(function (s) {
            var pet = s.驯养[idx];
            var eco = RW.economy;
            if (eco && typeof eco.屠宰 === 'function') {
                try { eco.屠宰(s.库存 || {}, '中型', 8, RW.engine && RW.engine.判定, s); } catch (e) {}
            }
            var inv = s.库存 = s.库存 || { 物资: {}, 弹药: {}, 食物: {}, 药品: {} };
            inv.食物 = inv.食物 || {};
            var meat = 40 + Math.floor(Math.random() * 20);
            inv.食物['肉'] = (inv.食物['肉'] || 0) + meat;
            if (!s.$流水账) s.$流水账 = [];
            s.$流水账.push({ 物品: '肉', 数量: meat, 方向: '增', 事由: '屠宰·' + pet.名字, 楼层: '最新' });
            if (!s.事件记录) s.事件记录 = [];
            s.事件记录.push('【屠宰】' + pet.名字 + '（' + pet.种 + '）→ 肉×' + meat);
            s.驯养.splice(idx, 1);
        }, '屠宰动物');
        if (RW.toast) RW.toast('屠宰完成（肉已入库）', 'warn');
        render();
    }

    function release(st, idx) {
        writeState(function (s) {
            var pet = s.驯养[idx];
            if (!s.事件记录) s.事件记录 = [];
            s.事件记录.push('【放生】' + pet.名字 + '（' + pet.种 + '）回归野外');
            s.驯养.splice(idx, 1);
        }, '放生动物');
        if (RW.toast) RW.toast('已放生', 'good');
        render();
    }

    RW.husbandry = { open: function () { if (!readState()) { if (RW.toast) RW.toast('状态未就绪', 'bad'); return; } try { if (HOST.Rimworld && HOST.Rimworld.closeAllPanels) HOST.Rimworld.closeAllPanels('rw-hus'); } catch (e) {} ensurePanel().classList.add('open'); render(); }, TAMABLE: TAMABLE };
    try { console.log('%c[环驯养] ✅ 已注册', 'color:#6fbf5f'); } catch (e) {}
})();
