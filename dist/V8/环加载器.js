/**
 * 环加载器 — 机制脚本统一 CDN 入口（jsDelivr / testingcf 国内可达镜像）
 * 顺序 import 保证依赖序；更新脚本 = 推 GitHub dist/V{N+1} 后把下方 V3 改 V4
 * 加载进度实时挂主文档 Rimworld.LOADED / Rimworld.LOAD_TOTAL，供状态栏显示
 */
(async function () {
    var BASE = 'https://testingcf.jsdelivr.net/gh/fkgzs123321/RimWorld-Card@main/dist/V8/';
    var MODS = ["环引擎","环特质","环经济","环战斗","环亲密","环结算","环地图","环数据","环动物","环社交","环日志","环温度","环贸易","环遗址","环通讯","环制造","环远行队","环种植","环战斗面板","环工坊","环开场","环终端"];
    var H = (function () { try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (e) {} return window; })();
    var RW = H.Rimworld = H.Rimworld || {};
    RW.LOAD_TOTAL = MODS.length;
    RW.LOADED = [];
    RW.FAILED = [];
    function announce() {
        try { RW.onLoadProgress && RW.onLoadProgress(RW.LOADED.length, RW.LOAD_TOTAL, RW.FAILED); } catch (e) {}
        try { H.dispatchEvent(new H.Event('rimworld-load-progress')); } catch (e) {}
    }
    for (var i = 0; i < MODS.length; i++) {
        try {
            await import(BASE + encodeURIComponent(MODS[i]) + '.js');
            RW.LOADED.push(MODS[i]);
        } catch (e) {
            RW.FAILED.push(MODS[i] + ': ' + (e && e.message || '未知错误'));
            try { console.error('[环加载器] ' + MODS[i] + ' 加载失败:', e && e.message); } catch (e2) {}
        }
        announce();
    }
    try { console.log('[环加载器] 已加载 ' + RW.LOADED.length + '/' + MODS.length + ' 个模块' + (RW.FAILED.length ? '，失败: ' + RW.FAILED.join('；') : '')); } catch (e) {}
    try { RW.onLoadProgress && RW.onLoadProgress(RW.LOADED.length, RW.LOAD_TOTAL, RW.FAILED); } catch (e) {}
})();
