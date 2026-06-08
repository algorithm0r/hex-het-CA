var gameEngine = new GameEngine();
var ASSET_MANAGER = new AssetManager();

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
