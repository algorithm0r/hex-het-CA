var gameEngine = new GameEngine();
var ASSET_MANAGER = new AssetManager();

function toggleGenotypeView() {
    PARAMETERS.drawGenotype = !PARAMETERS.drawGenotype;
    const button = document.getElementById('genotypeViewButton');
    if (button) button.textContent = PARAMETERS.drawGenotype
        ? 'Show cell colors (G)' : 'Show genome colors (G)';
}

document.addEventListener('keydown', function (event) {
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    if (event.key.toLowerCase() === 'g') toggleGenotypeView();
});

function reset() {
    loadParameters();
    gameEngine.entities = [];
    const hexca = new HexCA();
    gameEngine.addEntity(hexca);
    gameEngine.addEntity(new Stats(hexca));
}

ASSET_MANAGER.downloadAll(function () {
    var canvas = document.getElementById('gameWorld');
    var ctx = canvas.getContext('2d');
    gameEngine.init(ctx);
    reset();
    gameEngine.start();
});
