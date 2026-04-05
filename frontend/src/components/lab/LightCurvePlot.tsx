import { useEffect, useRef } from 'react';
import PlotlyModule from 'plotly.js-dist-min';
import type { LightCurveResponse } from '../../types/photometry';

interface LightCurvePlotProps {
  data: LightCurveResponse;
  targetName?: string;
  foldPeriod?: number;
  foldT0?: number;
  overlayCurve?: {
    x: number[];
    y: number[];
    name?: string;
    color?: string;
    width?: number;
  } | null;
  highlightRange?: { start: number; end: number } | null;
  enableRangeSelection?: boolean;
  onSelectRange?: ((range: { start: number; end: number }) => void) | null;
}

export function LightCurvePlot({
  data,
  targetName,
  foldPeriod,
  foldT0,
  overlayCurve = null,
  highlightRange = null,
  enableRangeSelection = false,
  onSelectRange = null,
}: LightCurvePlotProps) {
  const plotly = (PlotlyModule as any).default ?? (PlotlyModule as any);
  const plotRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<string | null>(null);
  const shouldFold = Boolean(foldPeriod && foldPeriod > 0);
  const plotData = shouldFold
    ? {
        ...data,
        x_label: 'Phase',
        points: [...data.points]
          .map((point) => ({
            ...point,
            phase: (((point.hjd - (foldT0 ?? 0)) / foldPeriod!) % 1 + 1.5) % 1 - 0.5,
          }))
          .sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0)),
      }
    : data;

  useEffect(() => {
    if (plotData.points.length === 0 || !plotRef.current) return;

    let cancelled = false;

    const renderPlot = async () => {
      if (!plotly?.react || !plotly?.purge) {
        throw new Error('Plotly failed to load.');
      }

      if (cancelled || !plotRef.current) return;

      const isFolded = plotData.x_label === 'Phase';
      const isMagnitudeAxis = plotData.y_label === 'Magnitude';
      const shouldRenderDenseSeries = plotData.points.length > 2000;
      const markerSize = shouldRenderDenseSeries ? 4.8 : 6.2;
      const xValues = isFolded
        ? plotData.points.map((p) => p.phase ?? 0)
        : plotData.points.map((p) => p.hjd);
      const yValues = plotData.points.map((p) => p.magnitude);
      const errors = plotData.points.map((p) => p.mag_error);

      const titleParts: string[] = [];
      if (targetName) titleParts.push(targetName);
      titleParts.push(
        isFolded ? 'Phase-Folded Light Curve' : 'Differential Light Curve'
      );
      const hasHighlight =
        !isFolded &&
        highlightRange !== null &&
        Number.isFinite(highlightRange.start) &&
        Number.isFinite(highlightRange.end) &&
        highlightRange.end > highlightRange.start;

      await plotly.react(
        plotRef.current,
        [
          {
            x: xValues,
            y: yValues,
            error_y: {
              type: 'data',
              array: errors,
              visible: isMagnitudeAxis,
              color: 'rgba(180, 180, 180, 0.5)',
              thickness: 1,
            },
            mode: 'markers',
            type: 'scatter',
            marker: {
              color: '#000000',
              size: markerSize,
              opacity: shouldRenderDenseSeries ? 0.88 : 0.94,
            },
            line: { color: '#000000', width: 0 },
            name: 'F_target / F_comp',
          },
          ...(overlayCurve &&
          overlayCurve.x.length > 1 &&
          overlayCurve.x.length === overlayCurve.y.length
            ? [
                {
                  x: overlayCurve.x,
                  y: overlayCurve.y,
                  mode: 'lines',
                  type: 'scatter',
                  line: {
                    color: overlayCurve.color ?? '#d62728',
                    width: overlayCurve.width ?? 2.5,
                  },
                  name: overlayCurve.name ?? 'Transit fit',
                  hoverinfo: 'skip',
                },
              ]
            : []),
        ],
        {
          title: {
            text: titleParts.join(' \u2014 '),
            font: { size: 14, color: '#1a1a1a', family: 'IBM Plex Sans, sans-serif' },
          },
          dragmode: enableRangeSelection && !isFolded ? 'select' : 'zoom',
          selectdirection: enableRangeSelection && !isFolded ? 'h' : undefined,
          xaxis: {
            title: { text: plotData.x_label, font: { color: '#333' } },
            gridcolor: 'rgba(0,0,0,0.1)',
            zerolinecolor: 'rgba(0,0,0,0.2)',
            color: '#333',
            linecolor: '#bbb',
            linewidth: 1,
          },
          yaxis: {
            title: { text: plotData.y_label, font: { color: '#333' } },
            autorange: isMagnitudeAxis ? 'reversed' : true,
            gridcolor: 'rgba(0,0,0,0.1)',
            zerolinecolor: 'rgba(0,0,0,0.2)',
            color: '#333',
            linecolor: '#bbb',
            linewidth: 1,
          },
          plot_bgcolor: '#ffffff',
          paper_bgcolor: '#ffffff',
          font: { family: 'IBM Plex Mono, monospace', color: '#333', size: 11 },
          margin: { t: 50, r: 30, b: 55, l: 65 },
          showlegend: Boolean(overlayCurve),
          shapes: hasHighlight
            ? [
                {
                  type: 'rect',
                  xref: 'x',
                  yref: 'paper',
                  x0: highlightRange.start,
                  x1: highlightRange.end,
                  y0: 0,
                  y1: 1,
                  fillcolor: 'rgba(232, 114, 42, 0.10)',
                  line: {
                    color: 'rgba(232, 114, 42, 0.55)',
                    width: 1.2,
                  },
                },
              ]
            : [],
        },
        {
          responsive: true,
          displayModeBar: true,
          modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        }
      );

      const graphDiv = plotRef.current as any;
      if (enableRangeSelection && !isFolded && graphDiv?.on && onSelectRange) {
        graphDiv.removeAllListeners?.('plotly_selected');
        graphDiv.on('plotly_selected', (event: any) => {
          const range =
            event?.range?.x && Array.isArray(event.range.x) && event.range.x.length >= 2
              ? event.range.x
              : event?.points?.map((point: any) => point.x);
          if (!range || range.length < 2) return;
          const start = Number(range[0]);
          const end = Number(range[range.length - 1]);
          if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return;
          onSelectRange({
            start: Math.min(start, end),
            end: Math.max(start, end),
          });
        });
      }
    };

    renderPlot().catch((error) => {
      console.error('Failed to render light curve plot', error);
      errorRef.current =
        error instanceof Error ? error.message : 'Failed to render plot.';

      if (plotRef.current) {
        plotRef.current.innerHTML =
          '<div class="plot-error">Light curve plot failed to load.</div>';
      }
    });

    return () => {
      cancelled = true;
      errorRef.current = null;

      if (plotly && plotRef.current) {
        (plotRef.current as any).removeAllListeners?.('plotly_selected');
        plotly.purge(plotRef.current);
      }
    };
  }, [plotData, highlightRange, enableRangeSelection, onSelectRange]);

  if (plotData.points.length === 0) return null;

  const isFolded = plotData.x_label === 'Phase';

  return (
    <div className="lightcurve-plot">
      <h4>
        {targetName ? `${targetName} Light Curve` : 'Light Curve'}
        {(foldPeriod ?? plotData.period_days) && isFolded && (
          <span className="period-info"> (P = {foldPeriod ?? plotData.period_days} d)</span>
        )}
      </h4>
      <div ref={plotRef} className="plot-canvas" />
      {enableRangeSelection && !isFolded && (
        <p className="hint" style={{ marginTop: 8 }}>
          Drag horizontally on the plot to set the BJD fit window.
        </p>
      )}
    </div>
  );
}
