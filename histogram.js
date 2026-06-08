class Histogram {
    constructor(x, y, w, h, data, label, numBuckets, bucketMin, bucketMax, meanSeries = null) {
        this.x = x;
        this.y = y;
        this.width = w;
        this.height = h;
        this.data = data;           // array of snapshots: data[t][bucket] = count
        this.label = label;
        this.numBuckets = numBuckets;
        this.bucketMin = bucketMin;
        this.bucketMax = bucketMax;
        this.meanSeries = meanSeries;
    }

    update() {}

    draw(ctx) {
        const c = gameEngine.ctx;
        const {width, height, numBuckets, data} = this;

        // Background
        c.fillStyle = '#0d0d1a';
        c.fillRect(this.x, this.y, width, height);

        const len = Math.min(data.length, width);
        const startIdx = data.length > width ? data.length - width : 0;
        const bucketH = height / numBuckets;

        for (let i = 0; i < len; i++) {
            const snapshot = data[startIdx + i];
            const total = snapshot.reduce((a, b) => a + b, 0);
            if (total === 0) continue;
            for (let j = 0; j < numBuckets; j++) {
                this._fillCell(c, snapshot[j] / total, this.x + i, this.y + (numBuckets - 1 - j) * bucketH, bucketH);
            }
        }

        // Mean genome size overlay
        if (this.meanSeries && this.meanSeries.length > 0) {
            const mLen = Math.min(this.meanSeries.length, width);
            const mStart = this.meanSeries.length > width ? this.meanSeries.length - width : 0;
            c.strokeStyle = 'rgba(255,255,255,0.85)';
            c.lineWidth = 1;
            c.beginPath();
            for (let i = 0; i < mLen; i++) {
                const val = this.meanSeries[mStart + i];
                const yPos = this.y + (1 - val / this.bucketMax) * height;
                if (i === 0) c.moveTo(this.x + i + 0.5, yPos);
                else c.lineTo(this.x + i + 0.5, yPos);
            }
            c.stroke();
        }

        // Border
        c.strokeStyle = '#444';
        c.lineWidth = 1;
        c.strokeRect(this.x, this.y, width, height);

        // Label
        c.fillStyle = '#999';
        c.font = '11px Arial';
        c.textAlign = 'center';
        c.fillText(this.label, this.x + width / 2, this.y + height + 13);

        // Y-axis range labels
        c.textAlign = 'right';
        c.fillText(this.bucketMax, this.x - 3, this.y + 8);
        c.fillText(this.bucketMin, this.x - 3, this.y + height);
    }

    _fillCell(c, frac, x, y, h) {
        // Log-scale blue gradient: near-zero = dark, high = bright/white
        const val = frac * 99 + 1;
        let level = 511 - Math.floor(Math.log(val) / Math.log(100) * 512);
        if (level > 255) {
            const v = level - 256;
            c.fillStyle = rgb(v, v, 255);
        } else {
            c.fillStyle = rgb(0, 0, level);
        }
        c.fillRect(x, y, 1, Math.ceil(h));
    }
}
