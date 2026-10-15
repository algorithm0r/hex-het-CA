// ─── Neighbor offsets ─────────────────────────────────────────────────────────
// Flat-top hexagons, even-q offset (odd columns shifted DOWN by half a cell height).
const EVEN_NEIGHBORS = [
    {dc:  0, dr: -1}, // N
    {dc: +1, dr: -1}, // NE
    {dc: +1, dr:  0}, // SE
    {dc:  0, dr: +1}, // S
    {dc: -1, dr:  0}, // SW
    {dc: -1, dr: -1}, // NW
];
const ODD_NEIGHBORS = [
    {dc:  0, dr: -1}, // N
    {dc: +1, dr:  0}, // NE
    {dc: +1, dr: +1}, // SE
    {dc:  0, dr: +1}, // S
    {dc: -1, dr: +1}, // SW
    {dc: -1, dr:  0}, // NW
];

// ─── Display colors ───────────────────────────────────────────────────────────
const DEAD_COLOR = '#111122';
const ALL_CELL_COLORS = null; // replaced by getCellColors(n)

// Precomputed hex vertex offsets (flat-top, unit size — scaled at draw time)
const HEX_VERTS = [];
for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 3 * i;
    HEX_VERTS.push({x: Math.cos(angle), y: Math.sin(angle)});
}

// ─── HexCA ────────────────────────────────────────────────────────────────────
class HexCA {
    constructor() {
        this.cols = PARAMETERS.gridCols;
        this.rows = PARAMETERS.gridRows;
        this.N    = this.cols * this.rows;
        this.n    = PARAMETERS.n;
        this.tick = 0;

        // Build condition table and lookup for this n
        this._buildConditions();

        // Flat typed arrays for performance
        this.color      = new Int8Array(this.N).fill(-1);
        this.nextColor  = new Int8Array(this.N).fill(-1);
        this.prevColor  = new Int8Array(this.N).fill(-1);
        this.birthTick  = new Int32Array(this.N);
        this.genomes    = new Int8Array(this.N * this.ncond).fill(-1);
        this.counter    = new Int32Array(this.N);
        this.genomeSize = new Int16Array(this.N);

        // Reusable neighbor count buffer (avoids allocation in inner loop)
        this._counts = new Int32Array(this.n);

        // Move-to-front color history per cell (length n per cell)
        this.mtf = new Int8Array(this.N * this.n);

        // Two-generation firing flags per condition per cell
        this.firedSelf   = new Uint8Array(this.N * this.ncond);
        this.firedParent = new Uint8Array(this.N * this.ncond);

        // Cell processing order buffer (shuffled each tick in async mode)
        this._cellOrder = new Int32Array(this.N);

        // Reusable flat buffers for BFS (eliminates all per-call allocation)
        this._bfsVisited     = new Uint8Array(this.N);
        this._bfsVisitedList = new Int32Array(this.N);
        this._bfsFrontierA   = new Int32Array(this.N);
        this._bfsFrontierB   = new Int32Array(this.N);
        this._bfsEmpty       = new Int32Array(this.N);

        // Flat reproduction list buffer: [col, row, i, depth] per entry
        this._reprodBuf   = new Int32Array(this.N * 4);
        this._reprodCount = 0;

        // Conditions encountered by any living cell last tick (matched OR unmatched).
        // NOTE: despite the historical name/label, this is ALL encountered conditions,
        // not only fatal ones. positiveRate reads this.
        this.globalEncountered = new Uint8Array(this.ncond);

        // Cumulative per-condition encounter counts (reset each reporting period by Stats)
        this.encounterCount = new Int32Array(this.ncond);
        this.encounterTicks = 0;
        this.encounterCellTicks = 0;

        // Genotype->RGB random projection table (stable across resets for a given n)
        this._buildGenotypeProjection();

        // Stats exposed each tick for Stats entity
        this.currentStats = {
            liveCount: 0,
            colorCounts: new Array(this.n).fill(0),
            genomeSizeSum: 0,
            births: 0,
            ruleDeaths: 0,
            randomDeaths: 0,
            genomeSizeBuckets: new Array(PARAMETERS.numGenomeBuckets).fill(0),
            clusterCoeff: 0,
            meanAge: 0,
            maxAge: 1,
            ageBuckets: new Array(PARAMETERS.numGenomeBuckets).fill(0),
            mtfDepthSum: 0,
            transitions: 0,
        };

        this._initPopulation();
    }

    // ── Condition table ───────────────────────────────────────────────────────
    // Enumerate all (selfColor, counts[0..n-1]) where sum(counts) <= 6.
    // condLookup: key → condition index, where key uses Horner base-7 encoding.

    _buildConditions() {
        const n = this.n;
        const useHistory = PARAMETERS.historyRules;
        this.useHistory = useHistory;

        // Enumerate count tuples (without selfColor)
        const tuples = [];
        const buf = new Array(n).fill(0);
        function fill(depth, remaining) {
            if (depth === n) { tuples.push(buf.slice()); return; }
            for (let c = 0; c <= remaining; c++) {
                buf[depth] = c;
                fill(depth + 1, remaining - c);
            }
        }
        fill(0, 6);

        // Build conditions: [selfColor, (prevColor if useHistory), ...counts]
        this.conditions = [];
        if (useHistory) {
            for (let s = 0; s < n; s++)
                for (let p = 0; p < n; p++)
                    for (const t of tuples) this.conditions.push([s, p, ...t]);
        } else {
            for (let s = 0; s < n; s++)
                for (const t of tuples) this.conditions.push([s, ...t]);
        }
        this.ncond = this.conditions.length;

        // Build lookup array
        const maxKey = useHistory ? n * n * Math.pow(7, n) : n * Math.pow(7, n);
        this.condLookup = new Int16Array(maxKey).fill(-1);
        for (let i = 0; i < this.conditions.length; i++) {
            const cond = this.conditions[i];
            let key = useHistory ? cond[0] * n + cond[1] : cond[0];
            const offset = useHistory ? 2 : 1;
            for (let c = 0; c < n; c++) key = key * 7 + cond[offset + c];
            this.condLookup[key] = i;
        }
    }

    // ── Genotype colouring ────────────────────────────────────────────────────
    // Random projection of the one-hot genome into 3 dims -> RGB.
    // Johnson-Lindenstrauss: similar genomes land on similar colours, so clonal
    // domains read as uniform patches and lineage boundaries become visible.
    // Seeded so the mapping is stable across resets (runs stay comparable).

    _buildGenotypeProjection() {
        const {ncond, n} = this;
        const nOut = n + 1;                       // slot value -1..n-1  ->  index 0..n
        this.projTable = new Float32Array(3 * ncond * nOut);

        // mulberry32 — deterministic, so colours mean the same thing run to run
        let seed = 0x9e3779b9 ^ (ncond * 2654435761) ^ n;
        const rand = () => {
            seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        // Box-Muller
        const gauss = () => {
            let u = 0, v = 0;
            while (u === 0) u = rand();
            while (v === 0) v = rand();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        };

        const scale = 1 / Math.sqrt(ncond);        // sum of ncond iid N(0,1) -> N(0,1)
        for (let t = 0; t < this.projTable.length; t++) this.projTable[t] = gauss() * scale;

        // EMA-smoothed normalisation so the palette adapts without flickering
        this._projMean = [0, 0, 0];
        this._projStd  = [1, 1, 1];
        this._projInit = false;
    }

    // Project one cell's genome to 3 raw coordinates into out[]
    _projectGenome(i, out) {
        const {ncond, n, genomes, projTable} = this;
        const nOut = n + 1;
        const base = i * ncond;
        let a = 0, b = 0, c = 0;
        for (let q = 0; q < ncond; q++) {
            const slot = genomes[base + q] + 1;    // -1 -> 0 (absent), colour k -> k+1
            const off = (q * nOut + slot) * 3;
            a += projTable[off];
            b += projTable[off + 1];
            c += projTable[off + 2];
        }
        out[0] = a; out[1] = b; out[2] = c;
    }

    // Refresh the EMA colour normalisation from the current living population
    _updateProjNorm() {
        const N = this.N, color = this.color;
        const tmp = this._projTmp || (this._projTmp = new Float32Array(3));
        let cnt = 0;
        const sum = [0, 0, 0], sumSq = [0, 0, 0];
        // Sample at most 400 cells — enough for mean/std, cheap every frame
        const stride = Math.max(1, Math.floor(N / 400));
        for (let i = 0; i < N; i += stride) {
            if (color[i] === -1) continue;
            this._projectGenome(i, tmp);
            for (let k = 0; k < 3; k++) { sum[k] += tmp[k]; sumSq[k] += tmp[k] * tmp[k]; }
            cnt++;
        }
        if (cnt < 2) return;
        const alpha = this._projInit ? 0.08 : 1.0;
        for (let k = 0; k < 3; k++) {
            const mean = sum[k] / cnt;
            const varr = Math.max(0, sumSq[k] / cnt - mean * mean);
            this._projMean[k] += alpha * (mean - this._projMean[k]);
            this._projStd[k]  += alpha * (Math.sqrt(varr) - this._projStd[k]);
        }
        this._projInit = true;
    }

    // ── Genome generation ─────────────────────────────────────────────────────

    _generateRandomGenome() {
        const floor = PARAMETERS.genomeP;
        const {ncond, n, conditions} = this;
        const genome = new Int8Array(ncond).fill(-1);
        let size = 0;
        for (let i = 0; i < ncond; i++) {
            const cond = conditions[i];
            let n_dead = 6;
            for (let c = 1; c <= n; c++) n_dead -= cond[c];
            const p = floor + (1 - floor) * (n_dead / 6);
            if (Math.random() < p) {
                genome[i] = randomInt(n);
                size++;
            }
        }
        return {genome, size};
    }

    // ── Population init ───────────────────────────────────────────────────────

    _initPopulation() {
        const density = PARAMETERS.initialDensity;
        const {ncond, n} = this;
        for (let col = 0; col < this.cols; col++) {
            for (let row = 0; row < this.rows; row++) {
                if (Math.random() < density) {
                    const i = col * this.rows + row;
                    const c = randomInt(n);
                    this.color[i] = c;
                    this.mtf[i * n] = c;
                    let slot = 1;
                    for (let ci = 0; ci < n; ci++) if (ci !== c) this.mtf[i * n + slot++] = ci;
                    const {genome, size} = this._generateRandomGenome();
                    this.genomes.set(genome, i * ncond);
                    this.genomeSize[i] = size;
                }
            }
        }
    }

    // ── BFS for empty cells within depth ─────────────────────────────────────

    // Returns count of empty cells found; keys stored in this._bfsEmpty
    _findEmptyCells(col, row, depth, arr) {
        const {cols, rows, _bfsVisited, _bfsVisitedList, _bfsFrontierA, _bfsFrontierB, _bfsEmpty} = this;
        let visitedCount = 0;
        let emptyCount   = 0;

        const startKey = col * rows + row;
        _bfsVisited[startKey] = 1;
        _bfsVisitedList[visitedCount++] = startKey;

        let frontierBuf = _bfsFrontierA, nextBuf = _bfsFrontierB;
        frontierBuf[0] = startKey;
        let frontierCount = 1;

        for (let d = 0; d < depth; d++) {
            let nextCount = 0;
            for (let f = 0; f < frontierCount; f++) {
                const key = frontierBuf[f];
                const c = (key / rows) | 0;
                const r = key % rows;
                const offsets = c % 2 === 0 ? EVEN_NEIGHBORS : ODD_NEIGHBORS;
                for (let o = 0; o < 6; o++) {
                    const {dc, dr} = offsets[o];
                    const nc = (c + dc + cols) % cols;
                    const nr = (r + dr + rows) % rows;
                    const nkey = nc * rows + nr;
                    if (!_bfsVisited[nkey]) {
                        _bfsVisited[nkey] = 1;
                        _bfsVisitedList[visitedCount++] = nkey;
                        nextBuf[nextCount++] = nkey;
                        if (arr[nkey] === -1) _bfsEmpty[emptyCount++] = nkey;
                    }
                }
            }
            const tmp = frontierBuf; frontierBuf = nextBuf; nextBuf = tmp;
            frontierCount = nextCount;
            if (frontierCount === 0) break;
        }

        for (let v = 0; v < visitedCount; v++) _bfsVisited[_bfsVisitedList[v]] = 0;
        return emptyCount;
    }

    // ── Main update ───────────────────────────────────────────────────────────

    update() {
        const {cols, rows, N, n, ncond, condLookup, _counts, mtf, firedSelf, firedParent, globalEncountered, _cellOrder, _reprodBuf, _bfsEmpty, prevColor, birthTick} = this;
        const useHistory     = this.useHistory;
        const coherenceBonus = PARAMETERS.coherenceBonus;
        const {k, pDeath} = PARAMETERS;
        const asyncUpdate = PARAMETERS.asyncUpdate;
        const color      = this.color;
        const nextColor  = this.nextColor;
        const genomes    = this.genomes;
        const counter    = this.counter;
        const genomeSize = this.genomeSize;
        const encounterCount = this.encounterCount;
        let encounterCellTicks = 0;

        // Sync: work on nextColor snapshot; async: write directly to color
        const writeColor = asyncUpdate ? color : nextColor;
        if (!asyncUpdate) nextColor.set(color);
        prevColor.set(color);
        globalEncountered.fill(0);

        this._reprodCount = 0;
        let birthsThisTick     = 0;
        let ruleDeathsThisTick = 0;
        let randomDeathsThisTick = 0;
        let mtfDepthSum        = 0;
        let transitionsThisTick = 0;

        // ── Compute pass ──────────────────────────────────────────────────────
        for (let oi = 0; oi < N; oi++) _cellOrder[oi] = oi;
        if (asyncUpdate) shuffle(_cellOrder);

        for (let oi = 0; oi < N; oi++) {
            const i = _cellOrder[oi];
            if (color[i] === -1) continue;

            const col = Math.floor(i / rows);
            const row = i % rows;
            const offsets = col % 2 === 0 ? EVEN_NEIGHBORS : ODD_NEIGHBORS;

            // Count living neighbors by color
            _counts.fill(0);
            for (const {dc, dr} of offsets) {
                const nc_color = color[((col + dc + cols) % cols) * rows + (row + dr + rows) % rows];
                if (nc_color >= 0) _counts[nc_color]++;
            }

            // Compute condition key (Horner base-7)
            const s = color[i];
            let key = useHistory ? s * n + prevColor[i] : s;
            for (let c = 0; c < n; c++) key = key * 7 + _counts[c];

            const condIdx = condLookup[key];
            const rule    = condIdx >= 0 ? genomes[i * ncond + condIdx] : -1;

            if (condIdx >= 0) { globalEncountered[condIdx] = 1; encounterCount[condIdx]++; }
            encounterCellTicks++;

            if (rule === -1) {
                writeColor[i] = -1;
                ruleDeathsThisTick++;
            } else {
                firedSelf[i * ncond + condIdx] = 1;
                writeColor[i] = rule;
                if (rule !== s) {
                    // MTF: find depth of new color, earn that energy, move to front
                    const mtfBase = i * n;
                    let idx = 0;
                    while (idx < n && mtf[mtfBase + idx] !== rule) idx++;
                    counter[i] += idx;
                    mtfDepthSum += idx;
                    transitionsThisTick++;
                    for (let j = idx; j > 0; j--) mtf[mtfBase + j] = mtf[mtfBase + j - 1];
                    mtf[mtfBase] = rule;

                    const threshold = k * genomeSize[i];
                    if (threshold > 0) {
                        const prevMult = Math.floor((counter[i] - idx) / threshold);
                        const newMult  = Math.floor(counter[i] / threshold);
                        if (newMult > prevMult && newMult >= 1) {
                            const rb = this._reprodCount * 4;
                            _reprodBuf[rb]     = col;
                            _reprodBuf[rb + 1] = row;
                            _reprodBuf[rb + 2] = i;
                            _reprodBuf[rb + 3] = Math.min(newMult, 5);
                            this._reprodCount++;
                        }
                    }
                }
            }

            if (writeColor[i] !== -1 && Math.random() < pDeath) {
                writeColor[i] = -1;
                randomDeathsThisTick++;
            }
        }

        // ── Coherence pass ────────────────────────────────────────────────────
        if (coherenceBonus > 0) {
            for (let i = 0; i < N; i++) {
                if (writeColor[i] === -1) continue;
                const pc = prevColor[i];
                const nc = writeColor[i];
                if (nc === pc) continue;
                const col = (i / rows) | 0;
                const row = i % rows;
                const offsets = col % 2 === 0 ? EVEN_NEIGHBORS : ODD_NEIGHBORS;
                let matches = 0;
                for (let o = 0; o < 6; o++) {
                    const {dc, dr} = offsets[o];
                    const j = ((col + dc + cols) % cols) * rows + (row + dr + rows) % rows;
                    if (writeColor[j] !== -1 && prevColor[j] === pc && writeColor[j] === nc) matches++;
                }
                if (matches > 0) counter[i] += matches * coherenceBonus;
            }
        }

        // ── Reproduction pass ─────────────────────────────────────────────────
        // Shuffle flat reprod buffer (swap 4-int blocks)
        const rc = this._reprodCount;
        for (let s = rc - 1; s > 0; s--) {
            const t = randomInt(s + 1);
            const sb = s * 4, tb = t * 4;
            for (let q = 0; q < 4; q++) {
                const tmp = _reprodBuf[sb + q];
                _reprodBuf[sb + q] = _reprodBuf[tb + q];
                _reprodBuf[tb + q] = tmp;
            }
        }

        const mutRate      = PARAMETERS.mutationRate;
        const positiveRate = PARAMETERS.positiveRate;

        for (let ri = 0; ri < rc; ri++) {
            const rb    = ri * 4;
            const col   = _reprodBuf[rb];
            const row   = _reprodBuf[rb + 1];
            const i     = _reprodBuf[rb + 2];
            const depth = _reprodBuf[rb + 3];

            if (writeColor[i] === -1) continue;

            const emptyCount = this._findEmptyCells(col, row, depth, writeColor);
            if (emptyCount === 0) continue;

            const targetKey = _bfsEmpty[randomInt(emptyCount)];
            if (writeColor[targetKey] !== -1) continue;

            genomes.copyWithin(targetKey * ncond, i * ncond, (i + 1) * ncond);
            mtf.copyWithin(targetKey * n, i * n, i * n + n);
            firedParent.copyWithin(targetKey * ncond, i * ncond, (i + 1) * ncond);
            firedSelf.fill(0, targetKey * ncond, (targetKey + 1) * ncond);

            const base = targetKey * ncond;
            const iBase = i * ncond;
            let newSize = 0;
            for (let c = 0; c < ncond; c++) {
                if (Math.random() < mutRate) {
                    genomes[base + c] = Math.random() < 0.5 ? -1 : randomInt(n);
                } else if (genomes[base + c] !== -1 && firedSelf[iBase + c] === 0 && firedParent[iBase + c] === 0) {
                    const rate = globalEncountered[c] ? PARAMETERS.localAtrophyRate : PARAMETERS.globalAtrophyRate;
                    if (Math.random() < rate) genomes[base + c] = -1;
                } else if (genomes[base + c] === -1 && globalEncountered[c]) {
                    if (Math.random() < positiveRate) genomes[base + c] = randomInt(n);
                }
                if (genomes[base + c] !== -1) newSize++;
            }
            genomeSize[targetKey] = newSize;
            writeColor[targetKey] = color[i];
            birthTick[targetKey]  = this.tick;
            counter[targetKey]    = 0;
            counter[i]            = 0;
            birthsThisTick++;
        }

        // ── Apply pass ────────────────────────────────────────────────────────
        if (!asyncUpdate) color.set(nextColor);

        // ── Stats pass ────────────────────────────────────────────────────────
        const stats = this.currentStats;
        stats.births      = birthsThisTick;
        stats.ruleDeaths  = ruleDeathsThisTick;
        stats.randomDeaths = randomDeathsThisTick;
        stats.mtfDepthSum  = mtfDepthSum;
        stats.transitions  = transitionsThisTick;
        this.encounterTicks++;
        this.encounterCellTicks += encounterCellTicks;
        stats.liveCount    = 0;
        stats.meanAge      = 0;
        stats.colorCounts.fill(0);
        stats.genomeSizeSum = 0;
        stats.genomeSizeBuckets.fill(0);
        stats.ageBuckets.fill(0);
        const numBuckets = PARAMETERS.numGenomeBuckets;
        const tick = this.tick;
        let maxAge = 1;
        for (let i = 0; i < N; i++) {
            const c = color[i];
            if (c !== -1) {
                stats.liveCount++;
                stats.colorCounts[c]++;
                const gs = genomeSize[i];
                stats.genomeSizeSum += gs;
                stats.genomeSizeBuckets[Math.min(numBuckets - 1, Math.floor(gs * numBuckets / (ncond + 1)))]++;
                const age = tick - birthTick[i];
                stats.meanAge += age;
                if (age > maxAge) maxAge = age;
            }
        }
        if (stats.liveCount > 0) stats.meanAge /= stats.liveCount;
        stats.maxAge = maxAge;
        for (let i = 0; i < N; i++) {
            if (color[i] !== -1)
                stats.ageBuckets[Math.min(numBuckets - 1, Math.floor((tick - birthTick[i]) / maxAge * numBuckets))]++;
        }

        // Clustering coefficient: mean fraction of same-color live neighbors per cell
        let clusterSum = 0, clusterCount = 0;
        for (let i = 0; i < N; i++) {
            if (color[i] === -1) continue;
            const col = (i / rows) | 0;
            const row = i % rows;
            const offsets = col % 2 === 0 ? EVEN_NEIGHBORS : ODD_NEIGHBORS;
            let same = 0, live = 0;
            for (const {dc, dr} of offsets) {
                const j = ((col + dc + cols) % cols) * rows + (row + dr + rows) % rows;
                if (color[j] !== -1) { live++; if (color[j] === color[i]) same++; }
            }
            if (live > 0) { clusterSum += same / live; clusterCount++; }
        }
        stats.clusterCoeff = clusterCount > 0 ? clusterSum / clusterCount : 0;

        this.tick++;
        document.getElementById('tickCount').textContent = `Tick: ${this.tick}`;
    }

    // ── Draw ──────────────────────────────────────────────────────────────────

    draw(ctx) {
        if (PARAMETERS.drawMode === 'genotype') { this._drawGenotype(ctx); return; }
        const {n} = this;
        const size  = PARAMETERS.cellSize;
        const sqrt3 = Math.sqrt(3);
        const cellColors = getCellColors(n);

        const groups = Array.from({length: n + 1}, () => []);
        for (let col = 0; col < this.cols; col++) {
            for (let row = 0; row < this.rows; row++) {
                const i = col * this.rows + row;
                const c = this.color[i];
                const g = c === -1 ? 0 : c + 1;
                const x = col * size * 1.5 + size;
                const y = row * size * sqrt3 + (col % 2 === 1 ? size * sqrt3 / 2 : 0) + size;
                groups[g].push(x, y);
            }
        }

        const fills = [DEAD_COLOR, ...cellColors];
        for (let g = 0; g <= n; g++) {
            const pts = groups[g];
            if (pts.length === 0) continue;
            ctx.fillStyle = fills[g];
            ctx.beginPath();
            for (let p = 0; p < pts.length; p += 2) {
                const cx = pts[p], cy = pts[p + 1];
                ctx.moveTo(cx + size * HEX_VERTS[0].x, cy + size * HEX_VERTS[0].y);
                for (let v = 1; v < 6; v++) {
                    ctx.lineTo(cx + size * HEX_VERTS[v].x, cy + size * HEX_VERTS[v].y);
                }
                ctx.closePath();
            }
            ctx.fill();
        }
    }

    // ── Genotype view ─────────────────────────────────────────────────────────
    // Colour by genome rather than state. Channels are quantised to 16 levels so
    // that near-identical genomes batch into a single path — a clonal sweep draws
    // as fast as the state view; only a genuinely diverse population costs more.

    _drawGenotype(ctx) {
        const size  = PARAMETERS.cellSize;
        const sqrt3 = Math.sqrt(3);
        const {cols, rows, color} = this;

        this._updateProjNorm();
        const tmp  = this._projTmp || (this._projTmp = new Float32Array(3));
        const mean = this._projMean, std = this._projStd;

        const batches = new Map();
        const dead = [];

        for (let col = 0; col < cols; col++) {
            for (let row = 0; row < rows; row++) {
                const i = col * rows + row;
                const x = col * size * 1.5 + size;
                const y = row * size * sqrt3 + (col % 2 === 1 ? size * sqrt3 / 2 : 0) + size;
                if (color[i] === -1) { dead.push(x, y); continue; }

                this._projectGenome(i, tmp);
                let key = 0;
                const rgbv = [0, 0, 0];
                for (let k = 0; k < 3; k++) {
                    const spread = Math.max(std[k], 0.15);
                    let v = 128 + 127 * (tmp[k] - mean[k]) / (2.2 * spread);
                    v = v < 0 ? 0 : v > 255 ? 255 : v;
                    const q = Math.min(15, v >> 4);       // 16 levels per channel
                    rgbv[k] = q * 17;                     // 0..255 evenly
                    key = key * 16 + q;
                }
                let pts = batches.get(key);
                if (pts === undefined) { pts = {c: rgb(rgbv[0], rgbv[1], rgbv[2]), p: []}; batches.set(key, pts); }
                pts.p.push(x, y);
            }
        }

        this._fillHexes(ctx, DEAD_COLOR, dead, size);
        for (const b of batches.values()) this._fillHexes(ctx, b.c, b.p, size);
    }

    _fillHexes(ctx, fill, pts, size) {
        if (pts.length === 0) return;
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (let p = 0; p < pts.length; p += 2) {
            const cx = pts[p], cy = pts[p + 1];
            ctx.moveTo(cx + size * HEX_VERTS[0].x, cy + size * HEX_VERTS[0].y);
            for (let v = 1; v < 6; v++) ctx.lineTo(cx + size * HEX_VERTS[v].x, cy + size * HEX_VERTS[v].y);
            ctx.closePath();
        }
        ctx.fill();
    }
}
