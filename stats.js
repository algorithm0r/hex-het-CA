class Stats {
    constructor(hexca) {
        this.hexca = hexca;
        const n    = hexca.n;
        const ncond = hexca.ncond;

        // Time series
        this.popSeries       = [];
        this.colorSeries     = Array.from({length: n}, () => []);
        this.genomeSeries    = [];
        this.birthSeries     = [];
        this.ruleDeathSeries = [];
        this.genomeDist      = [];
        this.clusterSeries   = [];
        this.turnoverSeries  = [];
        this.meanAgeSeries   = [];  // normalized 0-1 (meanAge / tick)
        this.ageDist         = [];

        // Accumulators
        this._birthAccum       = 0;
        this._ruleDeathAccum   = 0;
        this._randomDeathAccum = 0;
        this._periodTicks      = 0;

        // Graph layout
        const gx  = 1215;
        const gw  = PARAMETERS.graphWidth;
        const gh  = PARAMETERS.graphHeight;
        const gap = 20;
        let gy = 5;

        const seriesColors = getCellColors(n);

        this.graphs = [];

        this.graphs.push(new Graph(gx, gy, [this.popSeries],
            'Population (fraction alive)', 0, 1, ['#ffffff'], false));
        gy += gh + gap;

        this.graphs.push(new Graph(gx, gy, this.colorSeries,
            'Color fractions', 0, 1, seriesColors, false));
        gy += gh + gap;

        this.graphs.push(new Graph(gx, gy, [this.birthSeries, this.ruleDeathSeries],
            'Births (teal) & rule deaths (orange) per tick', 0, 1,
            ['#1abc9c', '#e67e22'], true));
        gy += gh + gap;

        const histH = 250;
        this.histogram = new Histogram(gx, gy, gw, histH,
            this.genomeDist, 'Genome size distribution & mean (white) over time',
            PARAMETERS.numGenomeBuckets, 0, ncond, this.genomeSeries);
        gy += histH + gap;

        this.graphs.push(new Graph(gx, gy, [this.clusterSeries, this.turnoverSeries, this.meanAgeSeries],
            'Cluster coeff (white) / turnover (orange) / norm age (teal)', 0, 1,
            ['#ffffff', '#e67e22', '#1abc9c'], true));
        gy += gh + gap;

        const ageHistH = 80;
        this.ageHistogram = new Histogram(gx, gy, gw, ageHistH,
            this.ageDist, 'Age distribution & mean (white) over time',
            PARAMETERS.numGenomeBuckets, 0, 1, this.meanAgeSeries);
    }

    update() {
        const hexca = this.hexca;
        const s     = hexca.currentStats;
        const n     = hexca.n;

        this._birthAccum       += s.births;
        this._ruleDeathAccum   += s.ruleDeaths;
        this._randomDeathAccum += s.randomDeaths;
        this._periodTicks++;

        if (hexca.tick % PARAMETERS.reportingPeriod !== 0) return;

        const period  = this._periodTicks;
        const alive   = s.liveCount;
        const living  = alive || 1;

        this.popSeries.push(alive / hexca.N);

        for (let c = 0; c < n; c++) {
            this.colorSeries[c].push(s.colorCounts[c] / living);
        }

        this.genomeSeries.push(alive > 0 ? s.genomeSizeSum / alive : 0);
        this.birthSeries.push(this._birthAccum / period);
        this.ruleDeathSeries.push(this._ruleDeathAccum / period);
        this.genomeDist.push([...s.genomeSizeBuckets]);

        this.clusterSeries.push(s.clusterCoeff);
        const turnover = (this._birthAccum + this._ruleDeathAccum + this._randomDeathAccum) / (period * hexca.N);
        this.turnoverSeries.push(Math.min(1, turnover));
        const normAge = hexca.tick > 0 ? s.meanAge / hexca.tick : 0;
        this.meanAgeSeries.push(normAge);
        this.ageDist.push([...s.ageBuckets]);

        this._birthAccum       = 0;
        this._ruleDeathAccum   = 0;
        this._randomDeathAccum = 0;
        this._periodTicks      = 0;
    }

    draw(ctx) {
        for (const g of this.graphs) g.draw(ctx);
        this.histogram.draw(ctx);
        this.ageHistogram.draw(ctx);
    }
}
