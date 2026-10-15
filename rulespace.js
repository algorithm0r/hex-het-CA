// ─── Rule-space statistics ────────────────────────────────────────────────────
// Everything here is a projection of one object: the population rule-frequency
// matrix P[c][o] = fraction of LIVING cells whose rule at condition c outputs o,
// with o = 0 meaning "no rule" and o = k+1 meaning "outputs colour k".
//
// Genomes are dense arrays in a shared coordinate system, so there is no
// alignment problem — population genetics applies directly.

const MAX_SAMPLES = 2000;   // raster history cap
const MAX_PCA     = 600;    // PCA trajectory cap

class RuleSpaceStats {
    constructor(hexca) {
        this.hexca = hexca;
        const ncond = this.ncond = hexca.ncond;
        const n     = this.n     = hexca.n;
        const nOut  = this.nOut  = n + 1;        // absent + n colours

        this.P     = new Float32Array(ncond * nOut);
        this.Pprev = new Float32Array(ncond * nOut);
        this.Pref  = null;                        // set by "mark reference"
        this.hasPrev = false;

        // ── Tier 1 scalar series ──
        this.velocitySeries = [];   // ||P(t) - P(t-1)||_TV  — transition detector
        this.piSeries       = [];   // mean pairwise genome distance / ncond
        this.entropySeries  = [];   // mean per-condition entropy / log(nOut)
        this.fixedSeries    = [];   // fraction of conditions >95% one output
        this.refDistSeries  = [];   // distance from marked reference
        this.selfLoopSeries = [];   // fraction of present rules with output == self
        this.mtfDepthSeries = [];   // mean energy earned per transition

        // ── Raster history ──
        this.domOut   = [];   // Uint8Array(ncond): dominant PRESENT output, 255 = none
        this.presFreq = [];   // Float32Array(ncond): fraction possessing a rule
        this.encFreq  = [];   // Float32Array(ncond): encounters per cell-tick

        // ── Colour transition matrix history ──
        this.transMat = [];   // Float32Array(n*n): fraction of present rules self->out

        // ── PCA trajectory ──
        this.pcaSamples = [];          // Float32Array copies of P
        this.gram   = [];              // gram[i][j] = dot(P_i, P_j), lower triangle full
        this.pcaXY  = null;            // [ [x,y], ... ] once computed
        this.pcaDirty = true;

        // ── Ordering ──
        this.orderMode = 'ndead';
        this.order = null;
        this._buildStaticOrders();

        // ── Post-hoc export buffer ──
        this.genomeSnapshots = [];     // {tick, genomes: [[condIdx, out], ...]}
        this._snapCountdown = 0;
    }

    // ── Condition metadata & static orderings ────────────────────────────────

    _buildStaticOrders() {
        const {ncond, n, hexca} = this;
        const offset = hexca.useHistory ? 2 : 1;
        this.nDead = new Int8Array(ncond);
        this.selfCol = new Int8Array(ncond);
        for (let c = 0; c < ncond; c++) {
            const cond = hexca.conditions[c];
            let live = 0;
            for (let k = 0; k < n; k++) live += cond[offset + k];
            this.nDead[c] = 6 - live;
            this.selfCol[c] = cond[0];
        }

        this.orderEnum = new Int32Array(ncond);
        for (let c = 0; c < ncond; c++) this.orderEnum[c] = c;

        // n_dead ascending, then original enumeration order (self, then lexicographic counts)
        this.orderNDead = Int32Array.from(this.orderEnum).sort((a, b) =>
            (this.nDead[a] - this.nDead[b]) || (a - b));

        this.order = this.orderNDead;
    }

    setOrderMode(mode) {
        this.orderMode = mode;
        if (mode === 'enum')  this.order = this.orderEnum;
        else if (mode === 'ndead') this.order = this.orderNDead;
        else if (mode === 'freq')  this.order = this._orderByFreq();
        else if (mode === 'cluster') this.order = this._orderByCovariation();
    }

    _orderByFreq() {
        const pres = this.presFreq.length ? this.presFreq[this.presFreq.length - 1] : null;
        if (!pres) return this.orderNDead;
        return Int32Array.from(this.orderEnum).sort((a, b) => pres[b] - pres[a]);
    }

    // Spectral seriation on the correlation of per-condition presence over time.
    // Never materialises the ncond x ncond correlation matrix: with Z the z-scored
    // (ncond x S) series, C v = Z (Z^T v) / S, so power iteration is O(ncond*S).
    // Conditions are then sorted by angle in the (PC1, PC2) plane, which lays
    // co-varying modules out as contiguous arcs.
    _orderByCovariation() {
        const {ncond} = this;
        const hist = this.presFreq;
        if (hist.length < 8) return this.orderNDead;

        const S = Math.min(hist.length, ncond > 1500 ? 200 : 400);
        const start = hist.length - S;

        // z-score each condition's series
        const Z = new Float32Array(ncond * S);
        for (let c = 0; c < ncond; c++) {
            let m = 0;
            for (let t = 0; t < S; t++) m += hist[start + t][c];
            m /= S;
            let v = 0;
            for (let t = 0; t < S; t++) { const d = hist[start + t][c] - m; v += d * d; }
            const sd = Math.sqrt(v / S) || 1e-9;
            for (let t = 0; t < S; t++) Z[c * S + t] = (hist[start + t][c] - m) / sd;
        }

        const mulC = (v, out) => {                       // out = Z (Z^T v) / S
            const w = new Float32Array(S);
            for (let c = 0; c < ncond; c++) {
                const vc = v[c];
                if (vc === 0) continue;
                const base = c * S;
                for (let t = 0; t < S; t++) w[t] += Z[base + t] * vc;
            }
            out.fill(0);
            for (let c = 0; c < ncond; c++) {
                const base = c * S;
                let acc = 0;
                for (let t = 0; t < S; t++) acc += Z[base + t] * w[t];
                out[c] = acc / S;
            }
        };

        const norm = (v) => {
            let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
            s = Math.sqrt(s) || 1e-12;
            for (let i = 0; i < v.length; i++) v[i] /= s;
            return s;
        };

        const power = (deflate) => {
            let v = new Float32Array(ncond);
            for (let i = 0; i < ncond; i++) v[i] = Math.random() - 0.5;
            norm(v);
            const out = new Float32Array(ncond);
            for (let it = 0; it < 24; it++) {
                mulC(v, out);
                if (deflate) {                            // remove component along deflate
                    let d = 0;
                    for (let i = 0; i < ncond; i++) d += out[i] * deflate[i];
                    for (let i = 0; i < ncond; i++) out[i] -= d * deflate[i];
                }
                v.set(out); norm(v);
            }
            return v;
        };

        const pc1 = power(null);
        const pc2 = power(pc1);

        return Int32Array.from(this.orderEnum).sort((a, b) =>
            Math.atan2(pc2[a], pc1[a]) - Math.atan2(pc2[b], pc1[b]));
    }

    // ── Sampling ─────────────────────────────────────────────────────────────

    sample() {
        const hexca = this.hexca;
        const {ncond, nOut, n} = this;
        const {N, color, genomes} = hexca;

        // ── Build P ──
        const P = this.P;
        P.fill(0);
        let alive = 0;
        for (let i = 0; i < N; i++) {
            if (color[i] === -1) continue;
            alive++;
            const base = i * ncond;
            for (let c = 0; c < ncond; c++) P[c * nOut + genomes[base + c] + 1]++;
        }
        if (alive === 0) { this._pushEmpty(); return; }
        const inv = 1 / alive;
        for (let q = 0; q < P.length; q++) P[q] *= inv;

        // ── Velocity: mean per-condition total-variation distance from last sample ──
        let vel = 0;
        if (this.hasPrev) {
            const Pp = this.Pprev;
            for (let c = 0; c < ncond; c++) {
                let d = 0;
                for (let o = 0; o < nOut; o++) d += Math.abs(P[c * nOut + o] - Pp[c * nOut + o]);
                vel += 0.5 * d;
            }
            vel /= ncond;
        }
        this.velocitySeries.push(vel);

        // ── pi (mean pairwise genome distance) and entropy, both from P alone ──
        // E[Hamming] = sum_c (1 - sum_o p^2). Exact, no O(alive^2) pass needed.
        let piSum = 0, entSum = 0, fixed = 0;
        const logOut = Math.log(nOut);
        for (let c = 0; c < ncond; c++) {
            let sq = 0, h = 0, mx = 0;
            for (let o = 0; o < nOut; o++) {
                const p = P[c * nOut + o];
                sq += p * p;
                if (p > 0) h -= p * Math.log(p);
                if (p > mx) mx = p;
            }
            piSum += 1 - sq;
            entSum += h / logOut;
            if (mx > 0.95) fixed++;
        }
        this.piSeries.push(piSum / ncond);
        this.entropySeries.push(entSum / ncond);
        this.fixedSeries.push(fixed / ncond);

        // ── Distance from marked reference ──
        this.refDistSeries.push(this.Pref ? this._tv(P, this.Pref) : 0);

        // ── Possessed raster + self-loops + transition matrix ──
        const dom  = new Uint8Array(ncond);
        const pres = new Float32Array(ncond);
        const T    = new Float32Array(n * n);
        let presentTotal = 0, selfLoop = 0;
        for (let c = 0; c < ncond; c++) {
            const off = c * nOut;
            const present = 1 - P[off];
            pres[c] = present;
            presentTotal += present;
            let best = -1, bestV = 0;
            for (let o = 0; o < n; o++) {
                const p = P[off + o + 1];
                if (p > bestV) { bestV = p; best = o; }
                T[this.selfCol[c] * n + o] += p;
            }
            dom[c] = best < 0 ? 255 : best;
            selfLoop += P[off + this.selfCol[c] + 1];
        }
        this.domOut.push(dom);
        this.presFreq.push(pres);
        this.selfLoopSeries.push(presentTotal > 0 ? selfLoop / presentTotal : 0);
        if (presentTotal > 0) for (let q = 0; q < T.length; q++) T[q] /= presentTotal;
        this.transMat.push(T);

        // ── Encountered raster (realised niche) ──
        const enc = new Float32Array(ncond);
        const tot = hexca.encounterCellTicks || 1;
        for (let c = 0; c < ncond; c++) enc[c] = hexca.encounterCount[c] / tot;
        this.encFreq.push(enc);
        hexca.encounterCount.fill(0);
        hexca.encounterCellTicks = 0;
        hexca.encounterTicks = 0;

        // ── PCA trajectory ──
        this._addPca(P);

        // ── Book-keeping ──
        this.Pprev.set(P);
        this.hasPrev = true;
        if (this.orderMode === 'freq' || this.orderMode === 'cluster') this.setOrderMode(this.orderMode);
        this._trim();
        this._maybeSnapshot(alive);
    }

    _pushEmpty() {
        this.velocitySeries.push(0); this.piSeries.push(0); this.entropySeries.push(0);
        this.fixedSeries.push(0); this.refDistSeries.push(0); this.selfLoopSeries.push(0);
        this.domOut.push(new Uint8Array(this.ncond).fill(255));
        this.presFreq.push(new Float32Array(this.ncond));
        this.encFreq.push(new Float32Array(this.ncond));
        this.transMat.push(new Float32Array(this.n * this.n));
        this._trim();
    }

    pushMtfDepth(sum, count) { this.mtfDepthSeries.push(count > 0 ? sum / count : 0); }

    markReference() {
        this.Pref = Float32Array.from(this.P);
        this.refTick = this.hexca.tick;
    }

    _tv(A, B) {
        const {ncond, nOut} = this;
        let d = 0;
        for (let c = 0; c < ncond; c++) {
            let s = 0;
            for (let o = 0; o < nOut; o++) s += Math.abs(A[c * nOut + o] - B[c * nOut + o]);
            d += 0.5 * s;
        }
        return d / ncond;
    }

    _trim() {
        const arrs = [this.domOut, this.presFreq, this.encFreq, this.transMat];
        for (const a of arrs) while (a.length > MAX_SAMPLES) a.shift();
        const series = [this.velocitySeries, this.piSeries, this.entropySeries,
                        this.fixedSeries, this.refDistSeries, this.selfLoopSeries,
                        this.mtfDepthSeries];
        for (const s of series) while (s.length > MAX_SAMPLES) s.shift();
    }

    // ── Incremental PCA over the P-trajectory ────────────────────────────────
    // Dual (Gram) PCA: samples << dims, so eigendecompose the S x S Gram matrix.
    // The Gram grows one row per sample at O(S*d); dropping the oldest sample is
    // an O(S^2) shift. Double-centring the Gram is equivalent to centring P.

    _addPca(P) {
        const copy = Float32Array.from(P);
        const row = new Float64Array(this.pcaSamples.length + 1);
        for (let j = 0; j < this.pcaSamples.length; j++) {
            const o = this.pcaSamples[j];
            let acc = 0;
            for (let q = 0; q < copy.length; q++) acc += copy[q] * o[q];
            row[j] = acc;
        }
        let self = 0;
        for (let q = 0; q < copy.length; q++) self += copy[q] * copy[q];
        row[row.length - 1] = self;

        this.gram.push(row);
        this.pcaSamples.push(copy);

        // Drop the oldest in a batch rather than one per sample: trimming the Gram
        // reallocates every row, so doing it each sample once at cap is pure waste.
        if (this.pcaSamples.length > MAX_PCA) {
            const k = Math.max(1, Math.floor(MAX_PCA / 5));
            this.pcaSamples.splice(0, k);
            this.gram.splice(0, k);
            for (let j = 0; j < this.gram.length; j++) this.gram[j] = this.gram[j].slice(k);
        }
        this.pcaDirty = true;
    }

    computePca() {
        const S = this.pcaSamples.length;
        if (S < 4) { this.pcaXY = null; return; }

        // Symmetric full Gram from the stored lower triangle
        const G = new Float64Array(S * S);
        for (let i = 0; i < S; i++)
            for (let j = 0; j <= i; j++) { const v = this.gram[i][j]; G[i * S + j] = v; G[j * S + i] = v; }

        // Double-centre
        const rm = new Float64Array(S);
        let gm = 0;
        for (let i = 0; i < S; i++) { let s = 0; for (let j = 0; j < S; j++) s += G[i * S + j]; rm[i] = s / S; gm += s; }
        gm /= S * S;
        for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) G[i * S + j] += gm - rm[i] - rm[j];

        const mul = (v) => {
            const o = new Float64Array(S);
            for (let i = 0; i < S; i++) { let s = 0; const b = i * S; for (let j = 0; j < S; j++) s += G[b + j] * v[j]; o[i] = s; }
            return o;
        };
        const norm = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1e-12; for (let i = 0; i < v.length; i++) v[i] /= s; return s; };

        const eig = (deflate) => {
            let v = new Float64Array(S);
            for (let i = 0; i < S; i++) v[i] = Math.random() - 0.5;
            norm(v);
            let lam = 0;
            for (let it = 0; it < 40; it++) {
                let o = mul(v);
                if (deflate) { let d = 0; for (let i = 0; i < S; i++) d += o[i] * deflate[i]; for (let i = 0; i < S; i++) o[i] -= d * deflate[i]; }
                lam = norm(o);
                v = o;
            }
            return {v, lam};
        };

        const e1 = eig(null);
        const e2 = eig(e1.v);
        const s1 = Math.sqrt(Math.max(e1.lam, 0)), s2 = Math.sqrt(Math.max(e2.lam, 0));
        this.pcaXY = [];
        for (let i = 0; i < S; i++) this.pcaXY.push([e1.v[i] * s1, e2.v[i] * s2]);
        this.pcaDirty = false;
    }

    // ── Post-hoc export ──────────────────────────────────────────────────────

    _maybeSnapshot(alive) {
        if (this._snapCountdown-- > 0) return;
        this._snapCountdown = PARAMETERS.genomeSampleEvery - 1;
        const {ncond, hexca} = this;
        const want = Math.min(PARAMETERS.genomeSampleSize, alive);
        if (want <= 0) return;
        const live = [];
        for (let i = 0; i < hexca.N; i++) if (hexca.color[i] !== -1) live.push(i);
        shuffle(live);
        const sample = [];
        for (let s = 0; s < want; s++) {
            const i = live[s];
            const base = i * ncond;
            const sparse = [];
            for (let c = 0; c < ncond; c++) { const g = hexca.genomes[base + c]; if (g !== -1) sparse.push(c, g); }
            sample.push({state: hexca.color[i], age: hexca.tick - hexca.birthTick[i], rules: sparse});
        }
        this.genomeSnapshots.push({tick: hexca.tick, cells: sample});
        while (this.genomeSnapshots.length > 400) this.genomeSnapshots.shift();
    }

    exportJSON() {
        const q = (arr) => Array.from(arr, v => Math.round(v * 1e5) / 1e5);
        const payload = {
            meta: {
                exportedAt: new Date().toISOString(),
                tick: this.hexca.tick,
                ncond: this.ncond, n: this.n,
                reportingPeriod: PARAMETERS.reportingPeriod,
                params: Object.assign({}, PARAMETERS),
            },
            conditions: this.hexca.conditions,
            series: {
                velocity: q(this.velocitySeries), pi: q(this.piSeries),
                entropy: q(this.entropySeries), fixedFraction: q(this.fixedSeries),
                refDistance: q(this.refDistSeries), selfLoopFraction: q(this.selfLoopSeries),
                meanMtfDepth: q(this.mtfDepthSeries),
            },
            presenceFreq: this.presFreq.map(q),
            encounterFreq: this.encFreq.map(q),
            transitionMatrix: this.transMat.map(q),
            genomeSnapshots: this.genomeSnapshots,
        };
        const blob = new Blob([JSON.stringify(payload)], {type: 'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'hexca-rulespace-t' + this.hexca.tick + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
    }
}
