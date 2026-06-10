var PARAMETERS = {
    asyncUpdate: false,    // if true, cells process in random order and update immediately
    historyRules: false,   // if true, prevColor is part of the condition key (takes effect on reset)
    coherenceBonus: 0,     // energy per neighbor making the same prevColor→newColor transition
    updatesPerDraw: 50,

    // Canvas
    canvasWidth: 1800,
    canvasHeight: 960,

    // Grid
    gridCols: 100,
    gridRows: 60,
    cellSize: 8,

    // CA rules
    n: 3,           // number of colors (3–6; takes effect on reset)
    k: 0.1,         // threshold scaling: threshold = k * genomeSize (k < 1 scales down)

    // Death
    pDeath: 0.001,  // random death probability per tick per cell

    // Stats / graphs
    reportingPeriod: 1000, // ticks between data samples
    graphWidth: 560,
    graphHeight: 130,
    numGenomeBuckets: 20,  // histogram y-axis buckets (genome size 0–252)

    // Mutation
    mutationRate: 0.01,    // per-condition probability of reassignment on reproduction
    localAtrophyRate: 0.02,  // deletion rate for rules unfired locally but active globally
    globalAtrophyRate: 0.1,  // deletion rate for rules unfired locally and absent globally
    positiveRate: 0.02,    // creation probability for absent rules that caused deaths last tick

    // Initial population
    initialDensity: 0.2,   // fraction of cells initially alive
    genomeP: 0.05,         // floor probability for rules at n_dead=0; rises to 100% at n_dead=6
};

function loadParameters() {
    PARAMETERS.n             = parseInt(document.getElementById('n').value);
    PARAMETERS.k             = parseFloat(document.getElementById('k').value);
    PARAMETERS.pDeath        = parseFloat(document.getElementById('pDeath').value);
    PARAMETERS.initialDensity = parseFloat(document.getElementById('initialDensity').value);
    PARAMETERS.genomeP       = parseFloat(document.getElementById('genomeP').value);
    PARAMETERS.mutationRate  = parseFloat(document.getElementById('mutationRate').value);
    PARAMETERS.localAtrophyRate  = parseFloat(document.getElementById('localAtrophyRate').value);
    PARAMETERS.globalAtrophyRate = parseFloat(document.getElementById('globalAtrophyRate').value);
    PARAMETERS.positiveRate  = parseFloat(document.getElementById('positiveRate').value);
    PARAMETERS.asyncUpdate    = document.getElementById('asyncUpdate').checked;
    PARAMETERS.historyRules   = document.getElementById('historyRules').checked;
    PARAMETERS.coherenceBonus = parseFloat(document.getElementById('coherenceBonus').value);
    PARAMETERS.updatesPerDraw = parseInt(document.getElementById('updatesPerDraw').value);
    PARAMETERS.cellSize      = parseInt(document.getElementById('cellSize').value);
}
