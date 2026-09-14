import type { VisualizationSpec } from 'vega-embed';

export type VegaChartOptions = {
  actions?: boolean;
  renderer?: 'canvas' | 'svg';
};

/** Render a portable Vega-Lite spec into an element when the chart is opted in. */
export async function renderVegaChart(element: HTMLElement, spec: VisualizationSpec, options: VegaChartOptions = {}) {
  const { default: embed } = await import('vega-embed');
  return embed(element, spec, { actions: options.actions ?? false, renderer: options.renderer ?? 'canvas' });
}

