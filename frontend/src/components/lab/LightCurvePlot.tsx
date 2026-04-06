import { useEffect, useRef } from 'react';
import PlotlyModule from 'plotly.js-dist-min';
import type { LightCurveResponse } from '../../types/photometry';

type LightCurveOverlay = {
  x: number[];
  y: number[];
  name?: string;
  color?: string;
  width?: number;
};

type ResidualCurve = {
  x: number[];
  y: number[];
  error?: number[];
};

const EASWA_PLOT_LOGO = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="44" stroke="#ff6600" stroke-width="3" opacity="0.9"/>
    <ellipse cx="50" cy="50" rx="44" ry="16" stroke="#ff8533" stroke-width="1.5" opacity="0.5"/>
    <ellipse cx="50" cy="50" rx="16" ry="44" stroke="#ff8533" stroke-width="1.5" opacity="0.3"/>
    <circle cx="50" cy="50" r="4" fill="#ff6600"/>
    <circle cx="50" cy="50" r="8" fill="#ff6600" opacity="0.2"/>
    <circle cx="30" cy="35" r="2.5" fill="#ffa366"/>
    <circle cx="72" cy="42" r="2.5" fill="#ffa366"/>
    <circle cx="58" cy="70" r="2.5" fill="#ffa366"/>
    <circle cx="38" cy="60" r="2" fill="#ffa366" opacity="0.6"/>
  </svg>`
)}`;

interface LightCurvePlotProps {
  data: LightCurveResponse;
  targetName?: string;
  foldPeriod?: number;
  foldT0?: number;
  overlayCurve?: LightCurveOverlay | null;
  residualCurve?: ResidualCurve | null;
  analystLabel?: string | null;
  variant?: 'default' | 'fit-preview';
  highlightRange?: { start: number; end: number } | null;
  enableRangeSelection?: boolean;
  onSelectRange?: ((range: { start: number; end: number }) => void) | null;
}

function hasValidOverlayCurve(
  overlayCurve: LightCurveOverlay | null
): overlayCurve is LightCurveOverlay {
  return Boolean(
    overlayCurve &&
      overlayCurve.x.length > 1 &&
      overlayCurve.x.length === overlayCurve.y.length
  );
}

function hasValidResidualCurve(
  residualCurve: ResidualCurve | null
): residualCurve is ResidualCurve {
  return Boolean(
    residualCurve &&
      residualCurve.x.length > 1 &&
      residualCurve.x.length === residualCurve.y.length
  );
}

function computeResidualStd(residuals: number[]): number | null {
  const finiteResiduals = residuals.filter((value) => Number.isFinite(value));
  if (finiteResiduals.length === 0) return null;
  return Math.sqrt(
    finiteResiduals.reduce((sum, value) => sum + value * value, 0) / finiteResiduals.length
  );
}

function computeResidualRange(residuals: number[], fallbackErrors: number[]): number {
  const finiteResiduals = residuals.filter((value) => Number.isFinite(value));
  const finiteErrors = fallbackErrors.filter((value) => Number.isFinite(value) && value > 0);
  const maxResidual = finiteResiduals.length
    ? Math.max(...finiteResiduals.map((value) => Math.abs(value)))
    : 0;
  const maxError = finiteErrors.length ? Math.max(...finiteErrors) : 0;
  return Math.max(maxResidual * 1.2, maxError * 2.5, 0.0015);
}

export function LightCurvePlot({
  data,
  targetName,
  foldPeriod,
  foldT0,
  overlayCurve = null,
  residualCurve = null,
  analystLabel = null,
  variant = 'default',
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
      const errors = plotData.points.map((p) =>
        Number.isFinite(p.mag_error) && p.mag_error > 0 ? p.mag_error : 0
      );
      const fitPreviewMode =
        variant === 'fit-preview' && hasValidResidualCurve(residualCurve);
      const showErrorBars = fitPreviewMode || isMagnitudeAxis;
      const hasOverlayCurve = hasValidOverlayCurve(overlayCurve);
      const hasHighlight =
        !fitPreviewMode &&
        !isFolded &&
        highlightRange !== null &&
        Number.isFinite(highlightRange.start) &&
        Number.isFinite(highlightRange.end) &&
        highlightRange.end > highlightRange.start;
      const plotTitle = targetName ?? plotData.target_id ?? 'Light Curve';
      const traces: any[] = [
        {
          x: xValues,
          y: yValues,
          error_y: {
            type: 'data',
            array: errors,
            visible: showErrorBars,
            color: fitPreviewMode ? 'rgba(30, 30, 30, 0.18)' : 'rgba(180, 180, 180, 0.5)',
            thickness: fitPreviewMode ? 0.8 : 1,
            width: 0,
          },
          mode: 'markers',
          type: 'scatter',
          marker: {
            color: '#111111',
            size: fitPreviewMode ? 5.6 : markerSize,
            opacity: fitPreviewMode ? 0.9 : shouldRenderDenseSeries ? 0.88 : 0.94,
          },
          line: { color: '#111111', width: 0 },
          name: 'F_target / F_comp',
          xaxis: 'x',
          yaxis: 'y',
        },
      ];

      if (hasOverlayCurve) {
        traces.push({
          x: overlayCurve.x,
          y: overlayCurve.y,
          mode: 'lines',
          type: 'scatter',
          line: {
            color: overlayCurve.color ?? '#d62728',
            width: overlayCurve.width ?? (fitPreviewMode ? 3 : 2.5),
          },
          name: overlayCurve.name ?? 'Transit fit',
          hoverinfo: 'skip',
          xaxis: 'x',
          yaxis: 'y',
        });
      }

      const annotations: any[] = [];
      const layout: any = fitPreviewMode
        ? (() => {
            const residualErrors =
              residualCurve.error?.map((value) =>
                Number.isFinite(value) && value > 0 ? value : 0
              ) ?? [];
            const residualStd = computeResidualStd(residualCurve.y);
            const residualRange = computeResidualRange(residualCurve.y, residualErrors);

            traces.push(
              {
                x: residualCurve.x,
                y: residualCurve.y,
                error_y: {
                  type: 'data',
                  array: residualErrors,
                  visible: residualErrors.length === residualCurve.y.length,
                  color: 'rgba(30, 30, 30, 0.14)',
                  thickness: 0.8,
                  width: 0,
                },
                mode: 'markers',
                type: 'scatter',
                marker: {
                  color: '#111111',
                  size: 4.2,
                  opacity: 0.82,
                },
                line: { color: '#111111', width: 0 },
                name: 'Residuals',
                showlegend: false,
                xaxis: 'x2',
                yaxis: 'y2',
              },
              {
                x: [Math.min(...residualCurve.x), Math.max(...residualCurve.x)],
                y: [0, 0],
                mode: 'lines',
                type: 'scatter',
                line: { color: 'rgba(214, 39, 40, 0.82)', width: 1.5 },
                hoverinfo: 'skip',
                showlegend: false,
                xaxis: 'x2',
                yaxis: 'y2',
              }
            );

            annotations.push(
              {
                xref: 'paper',
                yref: 'paper',
                x: 0.075,
                y: 1.15,
                xanchor: 'left',
                yanchor: 'middle',
                showarrow: false,
                text: '<b>EASWA</b>',
                font: {
                  family: 'IBM Plex Sans, sans-serif',
                  size: 14,
                  color: '#ff6600',
                },
              },
              {
                xref: 'paper',
                yref: 'paper',
                x: 0.02,
                y: 0.12,
                xanchor: 'left',
                yanchor: 'bottom',
                showarrow: false,
                text:
                  residualStd !== null
                    ? `STD = ${(residualStd * 100).toFixed(2)}%`
                    : 'STD = n/a',
                font: {
                  family: 'IBM Plex Sans, sans-serif',
                  size: 12,
                  color: '#2f2f2f',
                },
              }
            );

            if (analystLabel) {
              annotations.push({
                xref: 'paper',
                yref: 'paper',
                x: 1,
                y: 1.15,
                xanchor: 'right',
                yanchor: 'middle',
                align: 'right',
                showarrow: false,
                text: `Analyst: ${analystLabel}`,
                font: {
                  family: 'IBM Plex Sans, sans-serif',
                  size: 12,
                  color: '#2f2f2f',
                },
              });
            }

            return {
              title: {
                text: `<b>${plotTitle}</b>`,
                x: 0.5,
                y: 0.985,
                xanchor: 'center',
                yanchor: 'top',
                font: {
                  size: 28,
                  color: '#111111',
                  family: 'IBM Plex Sans, sans-serif',
                },
              },
              dragmode: 'zoom',
              xaxis: {
                domain: [0, 1],
                anchor: 'y',
                showticklabels: false,
                gridcolor: 'rgba(0,0,0,0.08)',
                zerolinecolor: 'rgba(0,0,0,0.16)',
                color: '#333',
                linecolor: '#a5a5a5',
                linewidth: 1.1,
              },
              xaxis2: {
                domain: [0, 1],
                anchor: 'y2',
                title: { text: plotData.x_label, font: { color: '#333', size: 13 } },
                matches: 'x',
                gridcolor: 'rgba(0,0,0,0.08)',
                zerolinecolor: 'rgba(0,0,0,0.16)',
                color: '#333',
                linecolor: '#a5a5a5',
                linewidth: 1.1,
              },
              yaxis: {
                domain: [0.28, 1],
                title: { text: plotData.y_label, font: { color: '#333', size: 13 } },
                autorange: isMagnitudeAxis ? 'reversed' : true,
                gridcolor: 'rgba(0,0,0,0.1)',
                zerolinecolor: 'rgba(0,0,0,0.14)',
                color: '#333',
                linecolor: '#a5a5a5',
                linewidth: 1.1,
              },
              yaxis2: {
                domain: [0, 0.18],
                title: { text: 'Residuals', font: { color: '#333', size: 12 } },
                range: [-residualRange, residualRange],
                gridcolor: 'rgba(0,0,0,0.08)',
                zeroline: true,
                zerolinecolor: 'rgba(214, 39, 40, 0.32)',
                color: '#333',
                linecolor: '#a5a5a5',
                linewidth: 1.1,
              },
              plot_bgcolor: '#ffffff',
              paper_bgcolor: '#ffffff',
              font: { family: 'IBM Plex Mono, monospace', color: '#333', size: 11 },
              margin: { t: 115, r: 36, b: 62, l: 78 },
              height: 620,
              showlegend: true,
              legend: {
                x: 1,
                y: 0.95,
                xanchor: 'right',
                yanchor: 'top',
                bgcolor: 'rgba(255,255,255,0.82)',
                bordercolor: 'rgba(0,0,0,0.08)',
                borderwidth: 1,
                font: {
                  family: 'IBM Plex Sans, sans-serif',
                  size: 11,
                  color: '#222',
                },
              },
              images: [
                {
                  source: EASWA_PLOT_LOGO,
                  xref: 'paper',
                  yref: 'paper',
                  x: 0.002,
                  y: 1.185,
                  sizex: 0.065,
                  sizey: 0.12,
                  xanchor: 'left',
                  yanchor: 'top',
                  layer: 'above',
                  opacity: 1,
                },
              ],
              annotations,
            };
          })()
        : {
            title: {
              text: [plotTitle, isFolded ? 'Phase-Folded Light Curve' : 'Differential Light Curve']
                .join(' \u2014 '),
              font: {
                size: 14,
                color: '#1a1a1a',
                family: 'IBM Plex Sans, sans-serif',
              },
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
            showlegend: hasOverlayCurve,
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
          };

      await plotly.react(
        plotRef.current,
        traces,
        layout,
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
  }, [
    plotData,
    targetName,
    overlayCurve,
    residualCurve,
    analystLabel,
    variant,
    highlightRange,
    enableRangeSelection,
    onSelectRange,
  ]);

  if (plotData.points.length === 0) return null;

  const isFolded = plotData.x_label === 'Phase';

  return (
    <div className="lightcurve-plot">
      {variant !== 'fit-preview' && (
        <h4>
          {targetName ? `${targetName} Light Curve` : 'Light Curve'}
          {(foldPeriod ?? plotData.period_days) && isFolded && (
            <span className="period-info"> (P = {foldPeriod ?? plotData.period_days} d)</span>
          )}
        </h4>
      )}
      <div ref={plotRef} className="plot-canvas" />
      {enableRangeSelection && !isFolded && (
        <p className="hint" style={{ marginTop: 8 }}>
          Drag horizontally on the plot to set the BJD fit window.
        </p>
      )}
    </div>
  );
}
