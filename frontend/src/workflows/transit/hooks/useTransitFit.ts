import { useEffect, useRef } from 'react';
import { fitTransitModelStreaming } from '../../../api/client';
import type { Observation, Target } from '../../../types/target';
import type { TransitPhotometryResponse } from '../../../types/transit';
import type { TransitFitResponse } from '../../../types/transitFit';
import { computeDefaultBjdWindow } from '../lightCurve';
import { normalizeTransitFitResponse, type TransitFitDataSource } from '../definition';
import type { TransitLabState } from '../state';

interface LightCurvePoint {
  hjd: number;
  phase: number | null;
  magnitude: number;
  mag_error: number;
}

interface UseTransitFitParams {
  result: TransitPhotometryResponse | null;
  target: Target;
  activeObservation: Observation | null;
  roiPoints: LightCurvePoint[];
  foldEnabled: boolean;
  foldPeriod: number | null;
  foldT0: number;
  foldT0Auto: boolean;
  fitDataSource: TransitFitDataSource;
  fitLimbDarkening: boolean;
  fitWindowPhase: number;
  fitBaselineOrder: number;
  fitSigmaClipSigma: number;
  fitSigmaClipIterations: number;
  fitResult: TransitFitResponse | null;
  bjdWindowStart: number | null;
  bjdWindowEnd: number | null;
  phaseFoldReferenceT0: number;
  requestedFitWindowPhase: number;
  patch: (changes: Partial<TransitLabState>) => void;
  dispatch: React.Dispatch<{ type: 'append-fit-debug-log'; lines: string[] }>;
}

export function useTransitFit({
  result,
  target,
  activeObservation,
  roiPoints,
  foldEnabled,
  foldPeriod,
  foldT0Auto: _foldT0Auto,
  fitDataSource,
  fitLimbDarkening,
  fitWindowPhase: _fitWindowPhase,
  fitBaselineOrder,
  fitSigmaClipSigma,
  fitSigmaClipIterations,
  bjdWindowStart,
  bjdWindowEnd,
  phaseFoldReferenceT0,
  requestedFitWindowPhase,
  patch,
  dispatch,
}: UseTransitFitParams): { handleFitTransit: () => Promise<void> } {
  // Auto-enable phase fold when result arrives and target has a known period
  useEffect(() => {
    if (result && target.period_days) {
      patch({
        ...(foldPeriod === null ? { foldPeriod: target.period_days } : {}),
        ...(!foldEnabled ? { foldEnabled: true } : {}),
      });
    }
  }, [result, target.period_days]);

  // Auto-compute BJD window when result arrives or period changes
  useEffect(() => {
    if (!result) return;
    const times = result.light_curve.points.map((point) => point.hjd).filter(Number.isFinite);
    if (times.length === 0) return;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const windowInvalid =
      bjdWindowStart === null ||
      bjdWindowEnd === null ||
      !Number.isFinite(bjdWindowStart) ||
      !Number.isFinite(bjdWindowEnd) ||
      bjdWindowEnd <= bjdWindowStart ||
      bjdWindowStart < minTime ||
      bjdWindowEnd > maxTime;
    if (!windowInvalid) return;
    const defaultWindow = computeDefaultBjdWindow(
      result.light_curve.points,
      foldPeriod ?? target.period_days ?? result.light_curve.period_days
    );
    if (!defaultWindow) return;
    patch({ bjdWindowStart: defaultWindow.start, bjdWindowEnd: defaultWindow.end });
  }, [result, foldPeriod, target.period_days, bjdWindowStart, bjdWindowEnd]);

  const lastFitProgressAtRef = useRef(0);

  const handleFitTransit = async () => {
    if (!result) return;
    if (roiPoints.length < 20) {
      patch({ errorMessage: 'The Step 4 ROI retained too few points for transit fitting.' });
      return;
    }
    const fitPeriod =
      foldPeriod ?? target.period_days ?? result.light_curve.period_days ?? null;
    if (!fitPeriod) return;

    const resolvedBjdStart =
      bjdWindowStart !== null && bjdWindowEnd !== null
        ? Math.min(bjdWindowStart, bjdWindowEnd)
        : null;
    const resolvedBjdEnd =
      bjdWindowStart !== null && bjdWindowEnd !== null
        ? Math.max(bjdWindowStart, bjdWindowEnd)
        : null;
    const fitT0 =
      fitDataSource === 'bjd_window' && resolvedBjdStart !== null && resolvedBjdEnd !== null
        ? 0.5 * (resolvedBjdStart + resolvedBjdEnd)
        : phaseFoldReferenceT0;
    const resolvedFilterName =
      activeObservation?.mission === 'TESS'
        ? 'TESS'
        : activeObservation?.filter_band?.trim() || null;
    const roiTimes = roiPoints.map((p) => p.hjd).filter(Number.isFinite);
    const roiFluxes = roiPoints.map((p) => p.magnitude).filter(Number.isFinite);
    const roiErrors = roiPoints.map((p) => p.mag_error).filter(Number.isFinite);

    patch({
      fitting: true,
      errorMessage: null,
      fitResult: null,
      fitProgress: null,
      fitDebugRequest: {
        fitMode: fitDataSource,
        period: fitPeriod,
        t0: fitT0,
        filterName: resolvedFilterName,
        stellarTemperature:
          typeof target.stellar_temperature === 'number' ? target.stellar_temperature : null,
        stellarLogg: typeof target.stellar_logg === 'number' ? target.stellar_logg : null,
        stellarMetallicity:
          typeof target.stellar_metallicity === 'number' ? target.stellar_metallicity : null,
        bjdStart: fitDataSource === 'bjd_window' ? resolvedBjdStart : null,
        bjdEnd: fitDataSource === 'bjd_window' ? resolvedBjdEnd : null,
        requestedFitWindowPhase,
        baselineOrder: fitBaselineOrder,
        sigmaClipSigma: fitSigmaClipSigma,
        sigmaClipIterations: fitSigmaClipIterations,
        roiPointCount: roiPoints.length,
        roiTimeMin: roiTimes.length > 0 ? Math.min(...roiTimes) : null,
        roiTimeMax: roiTimes.length > 0 ? Math.max(...roiTimes) : null,
        roiFluxMin: roiFluxes.length > 0 ? Math.min(...roiFluxes) : null,
        roiFluxMax: roiFluxes.length > 0 ? Math.max(...roiFluxes) : null,
        roiErrorMin: roiErrors.length > 0 ? Math.min(...roiErrors) : null,
        roiErrorMax: roiErrors.length > 0 ? Math.max(...roiErrors) : null,
      },
      fitDebugLog: [
        `init mode=${fitDataSource} period=${fitPeriod.toFixed(6)} t0=${fitT0.toFixed(6)} points=${roiPoints.length}`,
      ],
    });
    try {
      const response = await fitTransitModelStreaming(
        {
          target_id: target.id,
          period: fitPeriod,
          t0: fitT0,
          fit_mode: fitDataSource,
          bjd_start: fitDataSource === 'bjd_window' ? resolvedBjdStart : null,
          bjd_end: fitDataSource === 'bjd_window' ? resolvedBjdEnd : null,
          fit_limb_darkening: fitLimbDarkening,
          fit_window_phase: requestedFitWindowPhase,
          baseline_order: fitBaselineOrder,
          sigma_clip_sigma: fitSigmaClipSigma,
          sigma_clip_iterations: fitSigmaClipIterations,
          filter_name: resolvedFilterName,
          stellar_temperature:
            typeof target.stellar_temperature === 'number' ? target.stellar_temperature : null,
          stellar_logg: typeof target.stellar_logg === 'number' ? target.stellar_logg : null,
          stellar_metallicity:
            typeof target.stellar_metallicity === 'number' ? target.stellar_metallicity : null,
          points: roiPoints,
        },
        (event) => {
          const now = Date.now();
          const isDone = (event.pct ?? 0) >= 1;
          if (isDone || now - lastFitProgressAtRef.current >= 100) {
            lastFitProgressAtRef.current = now;
            patch({ fitProgress: event });
            dispatch({
              type: 'append-fit-debug-log',
              lines: [
                `${event.stage} pct=${((event.pct ?? 0) * 100).toFixed(0)}${event.step && event.total ? ` step=${event.step}/${event.total}` : ''}`,
              ],
            });
          }
        }
      );
      const normalizedResponse = normalizeTransitFitResponse(response);
      if (!normalizedResponse) {
        throw new Error(
          'Transit fit response is missing the updated timing metadata. Restart the backend and run the fit again.'
        );
      }
      const responseModel =
        normalizedResponse.data_flux.length === normalizedResponse.residuals.length
          ? normalizedResponse.data_flux.map(
              (value: number, index: number) => value - normalizedResponse.residuals[index]
            )
          : [];
      dispatch({
        type: 'append-fit-debug-log',
        lines: [
          `result rp_rs=${normalizedResponse.fitted_params.rp_rs.toFixed(5)} a_rs=${normalizedResponse.fitted_params.a_rs.toFixed(2)} inc=${normalizedResponse.fitted_params.inclination.toFixed(2)} t0=${normalizedResponse.t0.toFixed(6)} ref_t0=${normalizedResponse.reference_t0.toFixed(6)} retained=${normalizedResponse.preprocessing.retained_points}`,
          responseModel.length > 0
            ? `model flux min=${Math.min(...responseModel).toFixed(6)} max=${Math.max(...responseModel).toFixed(6)}`
            : 'model flux unavailable',
        ],
      });
      patch({ fitResult: normalizedResponse });
    } catch (error) {
      console.error('Transit fitting failed', error);
      dispatch({
        type: 'append-fit-debug-log',
        lines: [`error ${error instanceof Error ? error.message : 'Transit model fitting failed.'}`],
      });
      patch({
        errorMessage: error instanceof Error ? error.message : 'Transit model fitting failed.',
      });
    } finally {
      patch({ fitting: false, fitProgress: null });
    }
  };

  return { handleFitTransit };
}
