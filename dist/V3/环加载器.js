/**
 * 环加载器 — 机制脚本统一 CDN 入口（jsDelivr / testingcf 国内可达镜像）
 * 顺序 import 保证依赖序；更新脚本 = push GitHub dist/V2 后把下方 V1 改 V2
 */
(async function () {
    var BASE = 'https://testingcf.jsdelivr.net/gh/fkgzs123321/RimWorld-Card@main/dist/V2/';
    var MODS = ["环引擎","环特质","环经济","环战斗","环亲密","环结算","环地图","环数据","环动物","环社交","环日志","环温度","环贸易","环遗址","环通讯","环制造","环远行队","环种植","环战斗面板","环工坊","环开场","环终端"];
    var loaded = [];
    for (var i = 0; i < MODS.length; i++) {
        try {
            await import(BASE + encodeURIComponent(MODS[i]) + '.js');
            loaded.push(MODS[i]);
        } catch (e) {
            console.error('[环加载器] ' + MODS[i] + ' 加载失败:', e && e.message);
        }
    }
    try { console.log('[环加载器] 已加载 ' + loaded.length + '/' + MODS.length + ' 个模块'); } catch (e) {}
})();