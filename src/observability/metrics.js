/**
 * Native Prometheus Metrics Collector & Exporter
 * Zero external dependencies. Generates standard Prometheus exposition text format.
 */

export class MetricsCollector {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
  }

  // --- Counters ---
  incrementCounter(name, value = 1, labels = {}) {
    const key = this._serializeKey(name, labels);
    const current = this.counters.get(key) || { name, labels, value: 0 };
    current.value += value;
    this.counters.set(key, current);
  }

  // --- Gauges ---
  setGauge(name, value, labels = {}) {
    const key = this._serializeKey(name, labels);
    this.gauges.set(key, { name, labels, value });
  }

  // --- Histograms (Latency & Duration) ---
  observeHistogram(name, durationMs, buckets = [0.05, 0.1, 0.5, 1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500]) {
    const key = name;
    let hist = this.histograms.get(key);
    if (!hist) {
      hist = {
        name,
        count: 0,
        sum: 0,
        buckets: buckets.map(le => ({ le, count: 0 })),
      };
      this.histograms.set(key, hist);
    }

    hist.count++;
    hist.sum += durationMs;

    for (const b of hist.buckets) {
      if (durationMs <= b.le) {
        b.count++;
      }
    }
  }

  // --- Render Prometheus Text Format ---
  renderMetrics() {
    const lines = [];

    // 1. Counters
    for (const item of this.counters.values()) {
      const labelStr = this._renderLabels(item.labels);
      lines.push(`${item.name}${labelStr} ${item.value}`);
    }

    // 2. Gauges
    for (const item of this.gauges.values()) {
      const labelStr = this._renderLabels(item.labels);
      lines.push(`${item.name}${labelStr} ${item.value}`);
    }

    // 3. Histograms
    for (const hist of this.histograms.values()) {
      for (const b of hist.buckets) {
        lines.push(`${hist.name}_bucket{le="${b.le}"} ${b.count}`);
      }
      lines.push(`${hist.name}_bucket{le="+Inf"} ${hist.count}`);
      lines.push(`${hist.name}_sum ${hist.sum.toFixed(4)}`);
      lines.push(`${hist.name}_count ${hist.count}`);
    }

    return lines.join('\n') + '\n';
  }

  _serializeKey(name, labels) {
    const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    return `${name}:${JSON.stringify(sorted)}`;
  }

  _renderLabels(labels) {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    const formatted = entries.map(([k, v]) => `${k}="${v}"`).join(',');
    return `{${formatted}}`;
  }
}

// Global default singleton instance
export const globalMetrics = new MetricsCollector();
