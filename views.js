// ─── Rule-space view widgets ──────────────────────────────────────────────────
// Raster, MatrixView and Scatter all follow the Graph/Histogram contract:
// constructor(x, y, ...), update(), draw(ctx).
//
// Rasters are expensive to build (w*h pixels) but only change when a new sample
// arrives or the row ordering changes, so each keeps an offscreen canvas and
// blits it every frame.

function hslToRgbArr(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    const f = (n) => {
        const k = (n + h * 12) % 12;
        const a = s * Math.min(l, 1 - l);
        return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
    };
    return [f(0), f(8), f(4)];
}

function cellColorsRGB(n) {
    return Array.from({length: n}, (_, i) => hslToRgbArr(Math.round(i * 360 / n), 75, 58));
}

// ─── Condition x time raster ──────────────────────────────────────────────────
// Rows are conditions (ordered by the RuleSpaceStats ordering), columns are
// samples. A phase transition reads as a vertical discontinuity.

class Raster {
    constructor(x, y, w, h, rs, mode, label) {
        this.x = x; this.y = y; this.width = w; this.height = h;
        this.rs = rs;               // RuleSpaceStats
        this.mode = mode;           // 'possessed' | 'encounter'
        this.label = label;
        this.colorsRGB = cellColorsRGB(rs.n);

        this.canvas = document.createElement('canvas');
        this.canvas.width = w; this.canvas.height = h;
        this.cctx = this.canvas.getContext('2d');
        this.img = this.cctx.createImageData(w, h);

        this._lastLen = -1;
        this._lastOrder = null;
    }

    update() {}

    _source() { return this.mode === 'possessed' ? this.rs.presFreq : this.rs.encFreq; }

    _rebuild() {
        const {width: w, height: h, rs} = this;
        const src = this._source();
        const dom = rs.domOut;
        const order = rs.order;
        const ncond = rs.ncond;
        const data = this.img.data;
        data.fill(0);
        for (let q = 3; q < data.length; q += 4) data[q] = 255;   // opaque

        const len = Math.min(src.length, w);
        const start = src.length > w ? src.length - w : 0;

        // Encounter frequencies are a distribution over ncond conditions, so the
        // typical value is ~1/ncond. Normalise by that before log-scaling or the
        // whole panel reads as black.
        const encScale = ncond;

        for (let i = 0; i < len; i++) {
            const col = src[start + i];
            const dcol = (this.mode === 'possessed' && start + i < dom.length) ? dom[start + i] : null;
            for (let r = 0; r < h; r++) {
                const c0 = Math.floor(r * ncond / h);
                const c1 = Math.max(c0 + 1, Math.floor((r + 1) * ncond / h));
                let sum = 0, cnt = 0, bestV = -1, bestDom = 255;
                for (let cc = c0; cc < c1 && cc < ncond; cc++) {
                    const cond = order[cc];
                    const v = col[cond];
                    sum += v; cnt++;
                    if (v > bestV) { bestV = v; if (dcol) bestDom = dcol[cond]; }
                }
                const mean = cnt > 0 ? sum / cnt : 0;
                let R, G, B;
                if (this.mode === 'possessed') {
                    if (bestDom === 255 || mean <= 0) { R = G = B = 0; }
                    else {
                        const rgbv = this.colorsRGB[bestDom];
                        const b = Math.pow(Math.min(1, mean), 0.6);   // gamma so rare rules stay visible
                        R = rgbv[0] * b; G = rgbv[1] * b; B = rgbv[2] * b;
                    }
                } else {
                    // Log ramp black -> blue -> white. Monotone in mean, and zero
                    // must land on black (a flat blue panel hides all structure).
                    const norm = Math.min(1, mean * encScale / 4);
                    const t = Math.log(1 + norm * 99) / Math.log(100);   // 0..1
                    if (t <= 0.5) { R = G = 0; B = Math.round(510 * t); }
                    else { B = 255; R = G = Math.round(510 * (t - 0.5)); }
                }
                const o = (r * w + i) * 4;
                data[o] = R; data[o + 1] = G; data[o + 2] = B;
            }
        }
        this.cctx.putImageData(this.img, 0, 0);
        this._lastLen = src.length;
        this._lastOrder = rs.order;
    }

    draw(ctx) {
        const c = gameEngine.ctx;
        const src = this._source();
        if (src.length !== this._lastLen || this.rs.order !== this._lastOrder) this._rebuild();

        c.fillStyle = '#0d0d1a';
        c.fillRect(this.x, this.y, this.width, this.height);
        if (src.length > 0) c.drawImage(this.canvas, this.x, this.y);

        c.strokeStyle = '#444'; c.lineWidth = 1;
        c.strokeRect(this.x, this.y, this.width, this.height);

        c.fillStyle = '#999'; c.font = '11px Arial'; c.textAlign = 'center';
        c.fillText(this.label + '  [order: ' + this.rs.orderMode + ']',
                   this.x + this.width / 2, this.y + this.height + 13);

        // n_dead band markers when that ordering is active
        if (this.rs.orderMode === 'ndead') {
            const {ncond, order, nDead} = this.rs;
            c.strokeStyle = 'rgba(255,255,255,0.18)';
            c.beginPath();
            let prev = nDead[order[0]];
            for (let cc = 1; cc < ncond; cc++) {
                const d = nDead[order[cc]];
                if (d !== prev) {
                    const yy = this.y + Math.floor(cc * this.height / ncond) + 0.5;
                    c.moveTo(this.x, yy); c.lineTo(this.x + this.width, yy);
                    prev = d;
                }
            }
            c.stroke();
        }
    }
}

// ─── Colour transition matrix ─────────────────────────────────────────────────
// Top: current n x n heatmap of (self colour -> output colour) mass among
// present rules. Bottom: the same n*n entries as a time raster.
// This measures exactly what the MTF energy model rewards — long orbits show as
// mass off the diagonal; stasis shows as a bright diagonal.

class MatrixView {
    constructor(x, y, w, h, rs, label) {
        this.x = x; this.y = y; this.width = w; this.height = h;
        this.rs = rs; this.label = label;
        this.colorsRGB = cellColorsRGB(rs.n);
        this.cellPx = Math.min(Math.floor(h * 0.55 / rs.n), Math.floor(w / (rs.n + 2)));
    }

    update() {}

    draw(ctx) {
        const c = gameEngine.ctx;
        const {rs, width, height} = this;
        const n = rs.n;
        const hist = rs.transMat;

        c.fillStyle = '#0d0d1a';
        c.fillRect(this.x, this.y, width, height);

        const T = hist.length ? hist[hist.length - 1] : new Float32Array(n * n);
        let mx = 0;
        for (let q = 0; q < T.length; q++) if (T[q] > mx) mx = T[q];
        mx = mx || 1;

        const px = this.cellPx;
        const gridW = n * px;
        const ox = this.x + 28;
        const oy = this.y + 16;

        for (let s = 0; s < n; s++) {
            for (let o = 0; o < n; o++) {
                const v = T[s * n + o] / mx;
                const rgbv = this.colorsRGB[o];
                const b = Math.pow(v, 0.6);
                c.fillStyle = rgb(Math.round(rgbv[0] * b), Math.round(rgbv[1] * b), Math.round(rgbv[2] * b));
                c.fillRect(ox + o * px, oy + s * px, px - 1, px - 1);
                if (s === o) {                       // mark the diagonal (self-loops, zero energy)
                    c.strokeStyle = 'rgba(255,255,255,0.35)';
                    c.strokeRect(ox + o * px + 0.5, oy + s * px + 0.5, px - 2, px - 2);
                }
            }
            const rgbv = this.colorsRGB[s];
            c.fillStyle = rgb(rgbv[0], rgbv[1], rgbv[2]);
            c.fillRect(ox - 10, oy + s * px, 6, px - 1);
        }

        c.fillStyle = '#777'; c.font = '9px Arial'; c.textAlign = 'left';
        c.fillText('self', this.x + 4, oy - 4);
        c.fillText('-> out', ox + gridW + 6, oy + 10);

        // Time raster of the n*n entries
        const rY = oy + n * px + 12;
        const rH = this.y + height - rY - 4;
        if (rH > 8 && hist.length > 1) {
            const rW = width - 36;
            const len = Math.min(hist.length, rW);
            const start = hist.length - len;
            const rowH = rH / (n * n);
            for (let i = 0; i < len; i++) {
                const Tt = hist[start + i];
                let m2 = 0;
                for (let q = 0; q < Tt.length; q++) if (Tt[q] > m2) m2 = Tt[q];
                m2 = m2 || 1;
                for (let q = 0; q < n * n; q++) {
                    const b = Math.pow(Tt[q] / m2, 0.6);
                    const rgbv = this.colorsRGB[q % n];
                    c.fillStyle = rgb(Math.round(rgbv[0] * b), Math.round(rgbv[1] * b), Math.round(rgbv[2] * b));
                    c.fillRect(ox + i, rY + q * rowH, 1, Math.ceil(rowH));
                }
            }
        }

        c.strokeStyle = '#444'; c.lineWidth = 1;
        c.strokeRect(this.x, this.y, width, height);
        c.fillStyle = '#999'; c.font = '11px Arial'; c.textAlign = 'center';
        c.fillText(this.label, this.x + width / 2, this.y + height + 13);
    }
}

// ─── PCA trajectory ───────────────────────────────────────────────────────────
// Each point is one sample's full rule-frequency matrix projected to 2D.
// Time runs blue -> red. Phase transitions appear as jumps between clusters;
// a system that revisits a regime shows a loop.

class Scatter {
    constructor(x, y, w, h, rs, label) {
        this.x = x; this.y = y; this.width = w; this.height = h;
        this.rs = rs; this.label = label;
        this._lastCompute = 0;
    }

    update() {}

    draw(ctx) {
        const c = gameEngine.ctx;
        const rs = this.rs;

        c.fillStyle = '#0d0d1a';
        c.fillRect(this.x, this.y, this.width, this.height);

        // Recompute at most every 1.5s, and only while this page is on screen
        const now = performance.now();
        if (rs.pcaDirty && now - this._lastCompute > 1500) {
            rs.computePca();
            this._lastCompute = now;
        }

        const pts = rs.pcaXY;
        if (pts && pts.length > 2) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const p of pts) {
                if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
                if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
            }
            const pad = 12;
            const sx = (this.width - 2 * pad) / ((maxX - minX) || 1);
            const sy = (this.height - 2 * pad) / ((maxY - minY) || 1);
            const X = (v) => this.x + pad + (v - minX) * sx;
            const Y = (v) => this.y + this.height - pad - (v - minY) * sy;

            c.lineWidth = 1;
            for (let i = 1; i < pts.length; i++) {
                const t = i / (pts.length - 1);
                c.strokeStyle = 'rgba(' + Math.round(60 + 195 * t) + ',' + Math.round(90 * (1 - t)) + ',' + Math.round(235 * (1 - t)) + ',0.75)';
                c.beginPath();
                c.moveTo(X(pts[i - 1][0]), Y(pts[i - 1][1]));
                c.lineTo(X(pts[i][0]), Y(pts[i][1]));
                c.stroke();
            }
            // current position
            const last = pts[pts.length - 1];
            c.fillStyle = '#fff';
            c.beginPath(); c.arc(X(last[0]), Y(last[1]), 3, 0, Math.PI * 2); c.fill();

            c.fillStyle = '#777'; c.font = '9px Arial'; c.textAlign = 'left';
            c.fillText('oldest', this.x + 4, this.y + this.height - 4);
            c.textAlign = 'right';
            c.fillText('newest (white)', this.x + this.width - 4, this.y + 12);
        } else {
            c.fillStyle = '#555'; c.font = '11px Arial'; c.textAlign = 'center';
            c.fillText('accumulating samples...', this.x + this.width / 2, this.y + this.height / 2);
        }

        c.strokeStyle = '#444'; c.lineWidth = 1;
        c.strokeRect(this.x, this.y, this.width, this.height);
        c.fillStyle = '#999'; c.font = '11px Arial'; c.textAlign = 'center';
        c.fillText(this.label, this.x + this.width / 2, this.y + this.height + 13);
    }
}
