import { useEffect, useRef } from 'react';
import PlotlyModule from 'plotly.js-dist-min';
import type { LightCurveResponse } from '../../types/photometry';

interface LightCurvePlotProps {
  data: LightCurveResponse;
  targetName?: string;
  foldPeriod?: number;
  foldT0?: number;
}

export function LightCurvePlot({
  data,
  targetName,
  foldPeriod,
  foldT0,
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
              color: 'rgba(255, 102, 0, 0.35)',
            },
            mode: shouldRenderDenseSeries ? 'lines' : 'markers',
            type: 'scatter',
            marker: { color: '#ff6600', size: 5, opacity: 0.8 },
            line: { color: '#ff6600', width: shouldRenderDenseSeries ? 1.2 : 0 },
            name: 'F_target / F_comp',
          },
        ],
        {
          title: {
            text: titleParts.join(' \u2014 '),
            font: { size: 14, color: '#e0e6f0', family: 'IBM Plex Sans, sans-serif' },
          },
          xaxis: {
            title: { text: plotData.x_label },
            gridcolor: 'rgba(255,255,255,0.06)',
            zerolinecolor: 'rgba(255,255,255,0.1)',
            color: '#9aa5b4',
          },
          yaxis: {
            title: { text: plotData.y_label },
            autorange: isMagnitudeAxis ? 'reversed' : true,
            gridcolor: 'rgba(255,255,255,0.06)',
            zerolinecolor: 'rgba(255,255,255,0.1)',
            color: '#9aa5b4',
          },
          plot_bgcolor: '#0e1118',
          paper_bgcolor: '#0e1118',
          font: { family: 'IBM Plex Mono, monospace', color: '#9aa5b4', size: 11 },
          margin: { t: 50, r: 30, b: 55, l: 65 },
          showlegend: false,
        },
        {
          responsive: true,
          displayModeBar: true,
          modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        }
      );
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
        plotly.purge(plotRef.current);
      }
    };
  }, [plotData]);

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
    </div>
  );
}
