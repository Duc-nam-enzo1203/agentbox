export interface MetricLabels {
  readonly [key: string]: string | number;
}

export interface HistogramBucket {
  readonly le: number;
  readonly count: number;
}

export class MetricsCollector {
  incrementCounter(name: string, value?: number, labels?: MetricLabels): void;
  setGauge(name: string, value: number, labels?: MetricLabels): void;
  observeHistogram(name: string, durationMs: number, buckets?: readonly number[]): void;
  renderMetrics(): string;
}

export const globalMetrics: MetricsCollector;
