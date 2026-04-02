import { useEffect, useRef } from 'react';
import PlotlyModule from 'plotly.js-dist-min';
import type { TransitFitResponse } from '../../types/transitFit';

interface TransitFitPlotProps {
  fitResult: TransitFitResponse;
  targetName?: string;
}

export function TransitFitPlot({ fitResult, targetName }: TransitFitPlotProps) {
  const plotly = (PlotlyModule as any).default ?? (PlotlyModule as any);
  const plotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!plotRef.current || !plotly?.react) return;

    let cancelled = false;
    const fp = fitResult.fitted_params;

    const paramText = [
      `R_p/R* = ${fp.rp_rs.toFixed(5)}${fp.rp_rs_err ? ` ± ${fp.rp_rs_err.toFixed(5)}` : ''}`,
      `a/R* = ${fp.a_rs.toFixed(2)}${fp.a_rs_err ? ` ± ${fp.a_rs_err.toFixed(2)}` : ''}`,
      `i = ${fp.inclination.toFixed(2)}${fp.inclination_err ? ` ± ${fp.inclination_err.toFixed(2)}` : ''}°`,
      `u₁ = ${fp.u1.toFixed(3)}${fp.u1_err ? ` ± ${fp.u1_err.toFixed(3)}` : ''}`,
      `u₂ = ${fp.u2.toFixed(3)}${fp.u2_err ? ` ± ${fp.u2_err.toFixed(3)}` : ''}`,
      `χ²_red = ${fp.reduced_chi_squared.toFixed(3)}`,
    ].join('<br>');

    // Auto-detect transit width from the best-fit model and derive plot ranges
    const modelFlux = fitResult.model_curve.flux;
    const modelPhase = fitResult.model_curve.phase;
    const threshold = 1.0 - (1.0 - Math.min(...modelFlux)) * 0.05;
    let transitStart = -0.15;
    let transitEnd = 0.15;
    for (let i = 0; i < modelFlux.length; i++) {
      if (modelFlux[i] < threshold) {
        transitStart = modelPhase[i];
        break;
      }
    }
    for (let i = modelFlux.length - 1; i >= 0; i--) {
      if (modelFlux[i] < threshold) {
        transitEnd = modelPhase[i];
        break;
      }
    }
    const transitWidth = Math.max(transitEnd - transitStart, 0.02);
    const margin = transitWidth * 1.5;
    const xMin = Math.max(-0.5, transitStart - margin);
    const xMax = Math.min(0.5, transitEnd + margin);

    const visiblePoints = fitResult.data_phase
      .map((phase, index) => ({
        phase,
        flux: fitResult.data_flux[index],
        residual: fitResult.residuals[index],
      }))
      .filter((point) => point.phase >= xMin && point.phase <= xMax);
    const visibleFlux = visiblePoints.map((point) => point.flux);
    const visibleModelFlux = fitResult.model_curve.phase
      .map((phase, index) => ({ phase, flux: fitResult.model_curve.flux[index] }))
      .filter((point) => point.phase >= xMin && point.phase <= xMax)
      .map((point) => point.flux);
    const combinedFlux = [...visibleFlux, ...visibleModelFlux].filter(Number.isFinite);
    const fluxFloor = combinedFlux.length ? Math.min(...combinedFlux) : Math.min(...fitResult.model_curve.flux);
    const fluxCeiling = combinedFlux.length ? Math.max(...combinedFlux) : Math.max(...fitResult.model_curve.flux);
    const fluxPadding = Math.max((fluxCeiling - fluxFloor) * 0.18, 0.0025);
    const yMin = Math.max(0, fluxFloor - fluxPadding);
    const yMax = Math.min(1.05, fluxCeiling + fluxPadding);

    const visibleResiduals = visiblePoints
      .map((point) => point.residual)
      .filter((value) => Number.isFinite(value));
    const residualExtent = visibleResiduals.length
      ? Math.max(...visibleResiduals.map((value) => Math.abs(value)))
      : 0.01;
    const residualPadding = Math.max(residualExtent * 1.25, 0.005);
    const residualRange = [-residualPadding, residualPadding];

    const renderPlot = async () => {
      if (cancelled || !plotRef.current) return;

      // Data scatter (top panel)
      const dataTrace = {
        x: fitResult.data_phase,
        y: fitResult.data_flux,
        error_y: {
          type: 'data' as const,
          array: fitResult.data_error,
          visible: true,
          color: 'rgba(235, 239, 245, 0.34)',
          thickness: 1,
        },
        mode: 'markers' as const,
        type: 'scatter' as const,
        marker: { color: '#f2f5f8', size: 3.6, opacity: 0.88, line: { color: 'rgba(12,14,18,0.55)', width: 0.4 } },
        name: 'Data',
        xaxis: 'x',
        yaxis: 'y',
      };

      // Best-fit model (top panel)
      const modelTrace = {
        x: fitResult.model_curve.phase,
        y: fitResult.model_curve.flux,
        mode: 'lines' as const,
        type: 'scatter' as const,
        line: { color: '#ff5a4f', width: 2.8 },
        name: 'Best fit',
        xaxis: 'x',
        yaxis: 'y',
      };

      // Initial model (top panel)
      const initialTrace = {
        x: fitResult.initial_curve.phase,
        y: fitResult.initial_curve.flux,
        mode: 'lines' as const,
        type: 'scatter' as const,
        line: { color: '#29d391', width: 1.6, dash: 'dash' as const },
        name: 'Initial guess',
        xaxis: 'x',
        yaxis: 'y',
      };

      // Residuals (bottom panel)
      const residualTrace = {
        x: fitResult.data_phase,
        y: fitResult.residuals,
        mode: 'markers' as const,
        type: 'scatter' as const,
        marker: { color: '#f2f5f8', size: 3.6, opacity: 0.88, line: { color: 'rgba(12,14,18,0.55)', width: 0.4 } },
        name: 'Residuals',
        xaxis: 'x2',
        yaxis: 'y2',
        showlegend: false,
      };

      // Zero line for residuals
      const zeroLine = {
        x: [-0.5, 0.5],
        y: [0, 0],
        mode: 'lines' as const,
        type: 'scatter' as const,
        line: { color: 'rgba(255,255,255,0.22)', width: 1, dash: 'dash' as const },
        xaxis: 'x2',
        yaxis: 'y2',
        showlegend: false,
      };

      const titleText = targetName
        ? `${targetName} — Transit Model Fit`
        : 'Transit Model Fit';

      await plotly.react(
        plotRef.current,
        [dataTrace, modelTrace, initialTrace, residualTrace, zeroLine],
        {
          title: {
            text: titleText,
            font: { size: 14, color: '#e0e6f0', family: 'IBM Plex Sans, sans-serif' },
          },
          // Top panel (data + model)
          xaxis: {
            anchor: 'y',
            showticklabels: false,
            gridcolor: 'rgba(255,255,255,0.045)',
            zerolinecolor: 'rgba(255,255,255,0.08)',
            color: '#9aa5b4',
            domain: [0, 1],
            range: [xMin, xMax],
          },
          yaxis: {
            title: { text: 'Normalized Flux' },
            gridcolor: 'rgba(255,255,255,0.045)',
            zerolinecolor: 'rgba(255,255,255,0.08)',
            color: '#9aa5b4',
            domain: [0.28, 1.0],
            range: [yMin, yMax],
          },
          // Bottom panel (residuals)
          xaxis2: {
            title: { text: 'Phase' },
            anchor: 'y2',
            gridcolor: 'rgba(255,255,255,0.045)',
            zerolinecolor: 'rgba(255,255,255,0.08)',
            color: '#9aa5b4',
            domain: [0, 1],
            range: [xMin, xMax],
          },
          yaxis2: {
            title: { text: 'Residuals' },
            gridcolor: 'rgba(255,255,255,0.045)',
            zerolinecolor: 'rgba(255,255,255,0.08)',
            color: '#9aa5b4',
            domain: [0, 0.22],
            range: residualRange,
          },
          annotations: [
            {
              x: 0.98,
              y: 0.98,
              xref: 'paper',
              yref: 'paper',
              text: paramText,
              showarrow: false,
              font: { family: 'IBM Plex Mono, monospace', size: 11, color: '#d4dae5' },
              align: 'left' as const,
              bgcolor: 'rgba(10, 13, 18, 0.74)',
              bordercolor: 'rgba(255,255,255,0.09)',
              borderwidth: 1,
              borderpad: 8,
              xanchor: 'right',
              yanchor: 'top',
            },
            {
              x: 0.02,
              y: 0.02,
              xref: 'paper',
              yref: 'paper',
              text: 'EASWA',
              showarrow: false,
              font: { family: 'IBM Plex Sans, sans-serif', size: 16, color: 'rgba(232, 114, 42, 0.18)' },
              xanchor: 'left',
              yanchor: 'bottom',
            },
          ],
          plot_bgcolor: '#10141b',
          paper_bgcolor: '#10141b',
          font: { family: 'IBM Plex Mono, monospace', color: '#9aa5b4', size: 11 },
          margin: { t: 50, r: 30, b: 55, l: 65 },
          legend: {
            x: 0.02,
            y: 0.98,
            xanchor: 'left',
            yanchor: 'top',
            bgcolor: 'rgba(10, 13, 18, 0.58)',
            bordercolor: 'rgba(255,255,255,0.08)',
            borderwidth: 1,
            font: { size: 11, color: '#d4dae5' },
          },
          showlegend: true,
        },
        {
          responsive: true,
          displayModeBar: true,
          modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        },
      );
    };

    renderPlot().catch((error) => {
      console.error('Failed to render transit fit plot', error);
      if (plotRef.current) {
        plotRef.current.innerHTML =
          '<div class="plot-error">Transit fit plot failed to load.</div>';
      }
    });

    return () => {
      cancelled = true;
      if (plotly && plotRef.current) plotly.purge(plotRef.current);
    };
  }, [fitResult, targetName]);

  return (
    <div className="lightcurve-plot transit-fit-plot">
      <div ref={plotRef} className="plot-canvas" />
    </div>
  );
}
