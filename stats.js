class Stats {
    constructor(hexca) {
        this.hexca = hexca;
        const n    = hexca.n;
        const ncond = hexca.ncond;

        this.rs = new RuleSpaceStats(hexca);
        hexca.ruleStats = this.rs;

        // Time series
        this.popSeries       = [];
        this.colorSeries     = Array.from({length: n}, () => []);
        this.genomeSeries    = [];
        this.birthSeries     = [];
        this.ruleDeathSeries = [];
        this.genomeDist      = [];
        this.clusterSeries   = [];
        this.meanAgeSeries   = [];
        this.ageDist         = [];

        // Accumulators
        this._birthAccum       = 0;
        this._ruleDeathAccum   = 0;
        this._randomDeathAccum = 0;
        this._periodTicks      = 0;
        this._ageAccum         = 0;
        this._mtfSumAccum      = 0;
        this._transAccum       = 0;

        // Graph layout
        const gx  = 1215;
        const gw  = PARAMETERS.graphWidth;
        const gh  = PARAMETERS.graphHeight;
        const gap = 20;

        const seriesColors = getCellColors(n);

        // ── Page 0: population (phenotype) ────────────────────────────────────
        const p0 = [];
        let gy = 5;

        p0.push(new Graph(gx, gy, [this.popSeries],
            'Population (fraction alive)', 0, 1, ['#ffffff'], false));
        gy += gh + gap;

        p0.push(new Graph(gx, gy, this.colorSeries,
            'Color fractions', 0, 1, seriesColors, false));
        gy += gh + gap;

        p0.push(new Graph(gx, gy, [this.birthSeries, this.ruleDeathSeries],
            'Births (teal) & rule deaths (orange) per tick', 0, 1,
            ['#1abc9c', '#e67e22'], true));
        gy += gh + gap;

        const histH = 200;
        p0.push(new Histogram(gx, gy, gw, histH,
            this.genomeDist, 'Genome size distribution & mean (white) over time',
            PARAMETERS.numGenomeBuckets, 0, ncond, this.genomeSeries));
        gy += histH + gap;

        p0.push(new Graph(gx, gy, [this.clusterSeries],
            'Clustering coefficient (same-color neighbor fraction)', 0, 1,
            ['#ffffff'], false));
        gy += gh + gap;

        const ageHistH = 130;
        this.ageHistogram = new Histogram(gx, gy, gw, ageHistH,
            this.ageDist, 'Age distribution & mean (white) — ticks',
            PARAMETERS.numGenomeBuckets, 0, 1, this.meanAgeSeries);
        p0.push(this.ageHistogram);

        // ── Page 1: rule space (genotype scalars) ─────────────────────────────
        const rs = this.rs;
        const p1 = [];
        gy = 5;

        p1.push(new Graph(gx, gy, [rs.velocitySeries],
            'Rule-space velocity — ||P(t) − P(t−1)||  (spikes = phase transitions)',
            0, 1, ['#f1c40f'], true));
        gy += gh + gap;

        p1.push(new Graph(gx, gy,
            [rs.piSeries, rs.entropySeries, rs.fixedSeries, rs.selfLoopSeries],
            'π pairwise dist (red) · entropy (green) · fixed frac (blue) · self-loops (yellow)',
            0, 1, ['#e74c3c', '#2ecc71', '#3498db', '#f1c40f'], true));
        gy += gh + gap;

        p1.push(new Graph(gx, gy, [rs.refDistSeries],
            'Distance from marked reference  (press M to mark)', 0, 1, ['#ffffff'], true));
        gy += gh + gap;

        p1.push(new Graph(gx, gy, [rs.mtfDepthSeries],
            'Mean energy earned per transition (MTF depth)', 0, 1, ['#9b59b6'], true));
        gy += gh + gap;

        p1.push(new MatrixView(gx, gy, gw, 330, rs,
            'Colour transition matrix: self → output, current (top) and over time (bottom)'));

        // ── Page 2: rasters ───────────────────────────────────────────────────
        const p2 = [];
        gy = 5;
        p2.push(new Raster(gx, gy, gw, 440, rs, 'possessed',
            'POSSESSED — rule present per condition × time (hue = dominant output)'));
        gy += 440 + 25;
        p2.push(new Raster(gx, gy, gw, 440, rs, 'encounter',
            'ENCOUNTERED — how often the population actually meets each condition'));

        // ── Page 3: trajectory ────────────────────────────────────────────────
        const p3 = [];
        gy = 5;
        p3.push(new Scatter(gx, gy, gw, 560, rs,
            'Rule-space trajectory (PCA of P over time)'));
        gy += 560 + 25;
        p3.push(new Graph(gx, gy, [rs.velocitySeries],
            'Rule-space velocity (for reference)', 0, 1, ['#f1c40f'], true));

        this.pages = [p0, p1, p2, p3];
        this.pageNames = ['1 Population', '2 Rule space', '3 Rasters', '4 Trajectory'];
    }

    update() {
        const hexca = this.hexca;
        const s     = hexca.currentStats;
        const n     = hexca.n;

        this._birthAccum       += s.births;
        this._ruleDeathAccum   += s.ruleDeaths;
        this._randomDeathAccum += s.randomDeaths;
        this._mtfSumAccum      += s.mtfDepthSum;
        this._transAccum       += s.transitions;
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
        this.meanAgeSeries.push(s.meanAge);
        this.ageHistogram.bucketMax = s.maxAge;
        this.ageDist.push([...s.ageBuckets]);

        // Rule-space sample (reads the genomes directly; see rulespace.js)
        this.rs.pushMtfDepth(this._mtfSumAccum, this._transAccum);
        this.rs.sample();

        this._birthAccum       = 0;
        this._ruleDeathAccum   = 0;
        this._randomDeathAccum = 0;
        this._periodTicks      = 0;
        this._ageAccum         = 0;
        this._mtfSumAccum      = 0;
        this._transAccum       = 0;
    }

    draw(ctx) {
        const page = this.pages[PARAMETERS.statsPage] || this.pages[0];
        for (const d of page) d.draw(ctx);

        // Page indicator
        const c = gameEngine.ctx;
        c.font = '11px Arial';
        c.textAlign = 'left';
        let x = 1215;
        for (let i = 0; i < this.pageNames.length; i++) {
            const active = i === PARAMETERS.statsPage;
            c.fillStyle = active ? '#ffffff' : '#555';
            c.fillText(this.pageNames[i], x, 985);
            x += c.measureText(this.pageNames[i]).width + 14;
        }
    }
}
