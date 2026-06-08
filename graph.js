class Graph {
    constructor(x, y, data, label, min, max, colors, resize = true) {
        this.x = x;
        this.y = y;
        this.data = data;           // array of series (each series is a 1D array)
        this.label = label;
        this.resize = resize;
        this.xSize = PARAMETERS.graphWidth;
        this.ySize = PARAMETERS.graphHeight;
        this.minVal = min;
        this.maxVal = max;
        this.seriesColors = colors || ['#e74c3c', '#2ecc71', '#3498db', '#f1c40f'];
    }

    update() {}

    draw(ctx) {
        const c = gameEngine.ctx;
        if (this.resize) this._updateMinMax();

        // Background
        c.fillStyle = '#0d0d1a';
        c.fillRect(this.x, this.y, this.xSize, this.ySize);

        // Clip to graph area
        c.save();
        c.beginPath();
        c.rect(this.x, this.y, this.xSize, this.ySize);
        c.clip();

        const range = this.maxVal - this.minVal || 1;

        if (this.data[0].length > 1) {
            for (let j = 0; j < this.data.length; j++) {
                const series = this.data[j];
                const len = Math.min(series.length, this.xSize);
                const startIdx = series.length > this.xSize ? series.length - this.xSize : 0;

                c.strokeStyle = this.seriesColors[j % this.seriesColors.length];
                c.lineWidth = 1.5;
                c.beginPath();
                for (let i = 0; i < len; i++) {
                    const val = series[startIdx + i];
                    const xPos = this.x + i;
                    const yPos = this.y + this.ySize - Math.floor((val - this.minVal) / range * this.ySize);
                    if (i === 0) c.moveTo(xPos, yPos);
                    else c.lineTo(xPos, yPos);
                }
                c.stroke();

                // Current value label
                if (series.length > 0) {
                    const last = series[series.length - 1];
                    const lastY = this.y + this.ySize - Math.floor((last - this.minVal) / range * this.ySize);
                    c.fillStyle = this.seriesColors[j % this.seriesColors.length];
                    c.font = '10px Arial';
                    c.textAlign = 'right';
                    const display = Number.isInteger(last) ? last : last.toFixed(3);
                    c.fillText(display, this.x + this.xSize - 2, Math.max(this.y + 10, lastY - 2));
                }
            }
        }

        c.restore();

        // Border
        c.strokeStyle = '#444';
        c.lineWidth = 1;
        c.strokeRect(this.x, this.y, this.xSize, this.ySize);

        // Label
        c.fillStyle = '#999';
        c.font = '11px Arial';
        c.textAlign = 'center';
        c.fillText(this.label, this.x + this.xSize / 2, this.y + this.ySize + 13);
    }

    _updateMinMax() {
        const all = [].concat(...this.data);
        if (all.length === 0) return;
        this.minVal = Math.min(...all);
        this.maxVal = Math.max(...all);
        if (this.minVal === this.maxVal) this.maxVal = this.minVal + 1;
    }
}
