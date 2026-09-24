/* * ==========================================================================
 * [环世界] 通讯台 (Comms Console) v1
 * 前置：微电子基础研究（3000 点）＋通讯台建造
 * 功能：
 *   - 轨道商人呼叫：讨价还价 E3（社交技能）→ 价格修正加成
 *   - 派系求援（Call for aid）：消耗好感 -10，触发援军事件（盟友派兵协防）
 *   - 派系赠礼：送礼提升好感（好感→贸易价格/援助意愿）
 *   - 军火商特殊渠道：紧急弹药快递（溢价 2x，24 小时达）
 * 全局 API：Rimworld.comms.open()
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
    style.id = 'rw-comms-style';
    style.textContent = `
#rw-cmm { position: fixed; inset: 0; background: rgba(8,10,14,.78); z-index: 100004; display: none; align-items: center; justify-content: center; }
#rw-cmm.open { display: flex; }
.rw-cmm2 { width: 760px; max-width: calc(100vw - 40px); height: 580px; max-height: calc(100vh - 50px);
  background: var(--rw-bg2, #1c232d); border: 2px solid #5fd4b4; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; }
.rw-cmm2-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--rw-bg, #151a21); border-bottom: 1px solid var(--rw-border, #33404f); }
.rw-cmm2-head h2 { font-size: 15px; color: #5fd4b4; }
.rw-cmm2-body { flex: 1; overflow-y: auto; padding: 16px; }
.cmm-card { background: var(--rw-panel, #202936); border: 1px solid var(--rw-border, #33404f); border-radius: 9px; padding: 13px; margin-bottom: 12px; }
.cmm-card h4 { font-size: 13px; color: #5fd4b4; margin-bottom: 6px; }
.cmm-card p { font-size: 11px; color: var(--rw-dim, #8496a8); line-height: 1.7; }
.cmm-card.locked { opacity: .5; }
.cmm-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 12px; }
.cmm-row select, .cmm-row input { background: var(--rw-bg, #151a21); color: var(--rw-text, #d8e2ec); border: 1px solid var(--rw-border, #33404f); border-radius: 5px; padding: 4px 8px; font-size: 12px; }
.rw-btn { padding: 6px 16px; border: 1px solid var(--rw-accent, #e8a33d); border-radius: 6px; background: transparent; color: var(--rw-accent, #e8a33d); cursor: pointer; font-size: 12px; }
.rw-btn.teal { border-color: #5fd4b4; color: #5fd4b4; }
.rw-btn.primary { background: #5fd4b4; color: #151a21; font-weight: 700; }
.rw-btn:disabled { opacity: .35; cursor: not-allowed; }
`;
    document.head.appendChild(style);

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
                if (r && r.stat_data) { mutator(r.stat_data); m.replaceMvuData(r, reason || '通讯台'); return true; }
            }
        } catch (e) {}
        return false;
    }
    function hasComms(st) {
        var done = (st.研究 && st.研究.已完成 || '').split('、');
        return done.indexOf('微电子基础') >= 0;
    }

    function ensurePanel() {
        var p = document.getElementById('rw-cmm');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'rw-cmm';
        p.innerHTML = '<div class="rw-cmm2">' +
            '<div class="rw-cmm2-head"><h2>📡 通讯台</h2><span style="font-size:10px;color:var(--rw-dim,#8496a8)">前置：微电子基础研究（3000 点）</span>' +
            '<span style="flex:1"></span><button class="rw-btn" id="cmm-close">✕</button></div>' +
            '<div class="rw-cmm2-body" id="cmm-body"></div></div>';
        document.body.appendChild(p);
        /* 点遮罩关闭 */
        (function () { var el0 = document.getElementById('rw-cmm'); if (el0) el0.addEventListener('click', function (e) { if (e.target === el0) el0.classList.remove('open'); }); })();
        p.querySelector('#cmm-close').onclick = function () { p.classList.remove('open'); };
        p.addEventListener('click', function (e) { if (e.target === p) p.classList.remove('open'); });
        return p;
    }

    function render() {
        var box = document.getElementById('cmm-body');
        if (!box) return;
        var st = readState() || {};
        var unlocked = hasComms(st);
        var facs = st.派系 ? Object.keys(st.派系).filter(function (k) { return k !== '机械教团'; }) : ['氏族', '邦联'];
        var html = '';
        if (!unlocked) {
            html = '<div class="cmm-card locked"><h4>🔒 通讯台未启用</h4><p>需要：①完成【微电子基础】研究（3000 点）②建造通讯台（钢×90 + 组件×3，机械加工台侧设施）。<br>当前研究进度：' + esc((st.研究 && st.研究.已完成) || '无') + '</p></div>';
            box.innerHTML = html;
            return;
        }
        var negSkill = (st['凯奥'] && st['凯奥'].技能 && st['凯奥'].技能.社交) ? (typeof st['凯奥'].技能.社交 === 'number' ? st['凯奥'].技能.社交 : st['凯奥'].技能.社交.等级) : 5;
        html += '<div class="cmm-card"><h4>🛰 呼叫轨道商人（讨价还价）</h4>' +
            '<p>社交技能 ' + negSkill + ' → 讨价还价 E3：成功=本次交易买价 ×0.95 / 失败=无修正。轨道商人 24 小时内到达，停留半天。</p>' +
            '<div class="cmm-row"><button class="rw-btn teal" id="cmm-haggle">🎙 讨价还价（E3）</button><span id="cmm-haggle-r" style="font-size:11px"></span></div>' +
            '<div class="cmm-row"><button class="rw-btn primary" id="cmm-call">📡 呼叫商人（免费，冷却 3 天）</button></div></div>';
        html += '<div class="cmm-card"><h4>🆘 派系求援（Call for Aid）</h4>' +
            '<p>消耗 -10 好感，触发援军事件：盟友派遣协防小队（战力=好感×难度系数）。好感低于 0 的派系不会响应。</p>' +
            '<div class="cmm-row">派系 <select id="cmm-fac">' + facs.map(function (f) { return '<option>' + f + '</option>'; }).join('') + '</select>' +
            '<button class="rw-btn teal" id="cmm-aid">🆘 发出求援</button><span id="cmm-aid-r" style="font-size:11px"></span></div></div>';
        html += '<div class="cmm-card"><h4>🎁 派系赠礼</h4>' +
            '<p>赠送白银提升好感：每 100 白银 +3 好感（贸易价格与援助意愿随之改善）。</p>' +
            '<div class="cmm-row">派系 <select id="cmm-gfac">' + facs.map(function (f) { return '<option>' + f + '</option>'; }).join('') + '</select>' +
            '<input type="number" id="cmm-gift-amt" value="100" min="100" step="100" style="width:70px"> 白银' +
            '<button class="rw-btn teal" id="cmm-gift">🎁 赠送</button><span id="cmm-gift-r" style="font-size:11px"></span></div></div>';
        html += '<div class="cmm-card"><h4>🎖 军火商紧急快递</h4>' +
            '<p>紧急弹药补给：任意弹种 ×100，溢价 2 倍，24 小时内空投送达。救命用，钱包哭。</p>' +
            '<div class="cmm-row"><select id="cmm-ammo"><option>手枪弹</option><option>突击步枪弹</option><option>步枪弹</option><option>霰弹</option></select>' +
            '<button class="rw-btn teal" id="cmm-ammo-buy">🚀 空投下单（约 240 白银）</button></div></div>';
        box.innerHTML = html;
        // 绑定
        box.querySelector('#cmm-haggle').onclick = function () {
            var roll = 40 + negSkill * 3 - 20 + Math.random() * 40;
            var success = roll >= 55;
            box.querySelector('#cmm-haggle-r').innerHTML = success
                ? '<b style="color:var(--rw-good,#6fbf5f)">成功！本次交易价格 ×0.95</b>'
                : '<b style="color:var(--rw-bad,#e05f5f)">失败（掷 ' + Math.round(roll) + '）商人不让步</b>';
        };
        box.querySelector('#cmm-call').onclick = function () {
            writeState(function (s) {
                if (!s.事件记录) s.事件记录 = [];
                s.事件记录.push('【通讯台】已呼叫轨道商人（24 小时内到达，停留半天）');
            }, '呼叫轨道商人');
            if (RW.toast) RW.toast('轨道商人应答：正在接近', 'good');
        };
        box.querySelector('#cmm-aid').onclick = function () {
            var fac = box.querySelector('#cmm-fac').value;
            var fv = (st.派系 || {})[fac] || 0;
            if (fv < 0) { box.querySelector('#cmm-aid-r').innerHTML = '<b style="color:var(--rw-bad,#e05f5f)">' + fac + ' 好感 ' + fv + '，拒绝响应</b>'; return; }
            writeState(function (s) {
                s.派系[fac] = fv - 10;
                if (!s.事件记录) s.事件记录 = [];
                s.事件记录.push('【求援】向 ' + fac + ' 发出求援（好感 -10）：协防小队正在赶来（战力 ≈ ' + Math.max(2, Math.round(fv / 20)) + ' 人）');
            }, '派系求援');
            box.querySelector('#cmm-aid-r').innerHTML = '<b style="color:var(--rw-good,#6fbf5f)">已发出：协防小队赶来（好感 -10）</b>';
        };
        box.querySelector('#cmm-gift').onclick = function () {
            var fac = box.querySelector('#cmm-gfac').value;
            var amt = Math.max(100, parseInt(box.querySelector('#cmm-gift-amt').value) || 100);
            var bal = (st.库存 && st.库存.物资 && st.库存.物资.白银) || 0;
            if (amt > bal) { box.querySelector('#cmm-gift-r').innerHTML = '<b style="color:var(--rw-bad,#e05f5f)">白银不足（有 ' + bal + '）</b>'; return; }
            var gain = Math.round(amt / 100 * 3);
            writeState(function (s) {
                s.库存.物资.白银 -= amt;
                s.派系[fac] = (s.派系[fac] || 0) + gain;
                if (!s.$流水账) s.$流水账 = [];
                s.$流水账.push({ 物品: '白银', 数量: amt, 方向: '减', 事由: '赠礼·' + fac, 楼层: '最新' });
                if (!s.事件记录) s.事件记录 = [];
                s.事件记录.push('【赠礼】向 ' + fac + ' 赠送 ' + amt + ' 白银（好感 +' + gain + '）');
            }, '派系赠礼');
            box.querySelector('#cmm-gift-r').innerHTML = '<b style="color:var(--rw-good,#6fbf5f)">' + fac + ' 好感 +' + gain + '</b>';
        };
        box.querySelector('#cmm-ammo-buy').onclick = function () {
            var ammo = box.querySelector('#cmm-ammo').value;
            writeState(function (s) {
                var bal = (s.库存 && s.库存.物资 && s.库存.物资.白银) || 0;
                var cost = 240;
                if (bal < cost) { s.__cmmFail = '白银不足（需 240 有 ' + bal + '）'; return; }
                s.库存.物资.白银 -= cost;
                s.库存.弹药 = s.库存.弹药 || {};
                s.库存.弹药[ammo] = (s.库存.弹药[ammo] || 0) + 100;
                if (!s.$流水账) s.$流水账 = [];
                s.$流水账.push({ 物品: '白银', 数量: cost, 方向: '减', 事由: '军火商快递', 楼层: '最新' });
                s.$流水账.push({ 物品: ammo, 数量: 100, 方向: '增', 事由: '军火商快递', 楼层: '最新' });
                s.__cmmFail = null;
            }, '军火商快递');
            var fail = st.__cmmFail;
            st.__cmmFail = null;
            if (RW.toast) RW.toast(fail || ammo + '×100 空投下单成功', fail ? 'bad' : 'good');
        };
    }

    RW.comms = { open: function () { if (!readState()) { alert('[环世界] 状态未就绪：请先发送一条任意消息让系统初始化变量，再打开本面板。'); return; } try { if (HOST.Rimworld && HOST.Rimworld.closeAllPanels) HOST.Rimworld.closeAllPanels('rw-cmm'); } catch (e) {} ensurePanel().classList.add('open'); render(); } };
    try { console.log('%c[环通讯台] ✅ 已注册', 'color:#5fd4b4'); } catch (e) {}
})();
