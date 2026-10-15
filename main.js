var gameEngine = new GameEngine();
var ASSET_MANAGER = new AssetManager();
var currentStats = null;

function reset() {
    loadParameters();
    gameEngine.entities = [];
    const hexca = new HexCA();
    gameEngine.addEntity(hexca);
    currentStats = new Stats(hexca);
    currentStats.rs.setOrderMode(PARAMETERS.rasterOrder);
    gameEngine.addEntity(currentStats);
}

// ─── View controls ────────────────────────────────────────────────────────────

const ORDER_MODES = ['ndead', 'enum', 'freq', 'cluster'];

function setStatsPage(i) {
    PARAMETERS.statsPage = i;
    const el = document.getElementById('statsPage');
    if (el) el.value = String(i);
}

function setRasterOrder(mode) {
    PARAMETERS.rasterOrder = mode;
    if (currentStats) currentStats.rs.setOrderMode(mode);
    const el = document.getElementById('rasterOrder');
    if (el) el.value = mode;
}

function toggleGenotypeView() {
    PARAMETERS.drawMode = PARAMETERS.drawMode === 'state' ? 'genotype' : 'state';
    const el = document.getElementById('genotypeView');
    if (el) el.checked = PARAMETERS.drawMode === 'genotype';
}

function markReference() {
    if (currentStats) currentStats.rs.markReference();
}

function exportRuleSpace() {
    if (currentStats) currentStats.rs.exportJSON();
}

window.addEventListener('keydown', (e) => {
    const t = e.target.tagName;
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '4') setStatsPage(parseInt(k) - 1);
    else if (k === 'g') toggleGenotypeView();
    else if (k === 'o') setRasterOrder(ORDER_MODES[(ORDER_MODES.indexOf(PARAMETERS.rasterOrder) + 1) % ORDER_MODES.length]);
    else if (k === 'm') markReference();
    else if (k === 'e') exportRuleSpace();
});

ASSET_MANAGER.downloadAll(function () {
    var canvas = document.getElementById('gameWorld');
    var ctx = canvas.getContext('2d');
    gameEngine.init(ctx);
    reset();
    gameEngine.start();
});
