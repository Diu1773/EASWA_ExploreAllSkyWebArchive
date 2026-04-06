import type { TransitPhotometryResponse } from '../../types/transit';
import type { TransitFitResponse } from '../../types/transitFit';
import type { TransitFitDataSource } from './definition';

export type TransitLightCurve = TransitPhotometryResponse['light_curve'];

export interface TransitLightCurveOverlay {
  x: number[];
  y: number[];
  name?: string;
  color?: string;
  width?: number;
}

export interface TransitLightCurveResiduals {
  x: number[];
  y: number[];
  error?: number[];
}

export function computeDefaultBjdWindow(
  points: TransitPhotometryResponse['light_curve']['points'],
  periodDays: number | null | undefined
): { start: number; end: number } | null {
  if (!points || points.length === 0) return null;
  const times = points.map((point) => point.hjd).filter((value) => Number.isFinite(value));
  if (times.length === 0) return null;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const span = maxTime - minTime;
  if (!Number.isFinite(span) || span <= 0) return null;

  const deepestPoint = [...points].sort((left, right) => left.magnitude - right.magnitude)[0];
  const center = deepestPoint?.hjd ?? (minTime + maxTime) / 2;
  const halfWidth = Math.min(
    Math.max((periodDays && periodDays > 0 ? periodDays * 0.12 : span * 0.08), 0.08),
    0.6,
    span / 3,
  );
  return {
    start: Math.max(minTime, center - halfWidth),
    end: Math.min(maxTime, center + halfWidth),
  };
}

export function estimatePhaseFoldReferenceT0(
  points: TransitPhotometryResponse['light_curve']['points'],
  periodDays: number | null | undefined,
  fallbackT0: number
): number {
  const finitePoints = points.filter(
    (point) => Number.isFinite(point.hjd) && Number.isFinite(point.magnitude)
  );
  if (finitePoints.length === 0) return fallbackT0;

  const deepestPoint = finitePoints.reduce((best, point) =>
    point.magnitude < best.magnitude ? point : best
  );
  const localHalfWidth = Math.min(
    Math.max(periodDays && periodDays > 0 ? periodDays * 0.08 : 0.08, 0.03),
    0.25,
  );
  const localTransitPoints = finitePoints.filter(
    (point) => Math.abs(point.hjd - deepestPoint.hjd) <= localHalfWidth
  );

  if (localTransitPoints.length < 3) return deepestPoint.hjd;

  const representativePoints = [...localTransitPoints]
    .sort((left, right) => left.magnitude - right.magnitude)
    .slice(
      0,
      Math.max(3, Math.min(localTransitPoints.length, Math.ceil(localTransitPoints.length / 3)))
    )
    .map((point) => point.hjd)
    .sort((left, right) => left - right);

  return representativePoints[Math.floor(representativePoints.length / 2)] ?? deepestPoint.hjd;
}

export function computeTransitPhase(time: number, period: number, t0: number): number {
  return ((((time - t0) / period) % 1) + 1.5) % 1 - 0.5;
}

export function buildBjdLightCurve(
  points: TransitPhotometryResponse['light_curve']['points'],
  targetId: string,
  periodDays: number | null | undefined
): TransitLightCurve | null {
  if (points.length === 0) return null;
  return {
    target_id: targetId,
    period_days: periodDays ?? null,
    x_label: 'BTJD',
    y_label: 'Normalized Flux',
    points: points.map((point) => ({
      ...point,
      phase: null,
    })),
  };
}

export function buildPhaseFoldedLightCurve(
  points: TransitPhotometryResponse['light_curve']['points'],
  targetId: string,
  period: number,
  t0: number,
  phaseHalfWindow: number | null = null
): TransitLightCurve | null {
  if (!Number.isFinite(period) || period <= 0 || points.length === 0) return null;
  return {
    target_id: targetId,
    period_days: period,
    x_label: 'Phase',
    y_label: 'Normalized Flux',
    points: [...points]
      .map((point) => ({
        ...point,
        phase: computeTransitPhase(point.hjd, period, t0),
      }))
      .filter(
        (point) =>
          phaseHalfWindow === null ||
          phaseHalfWindow <= 0 ||
          Math.abs(point.phase ?? 0) <= phaseHalfWindow
      )
      .sort((left, right) => (left.phase ?? 0) - (right.phase ?? 0)),
  };
}

export function buildLightCurveFromFitResult(
  fitResult: TransitFitResponse,
  fitDataSource: TransitFitDataSource
): TransitLightCurve | null {
  const flux = fitResult.data_flux;
  const error = fitResult.data_error;
  if (flux.length === 0) return null;

  if (fitDataSource === 'phase_fold') {
    if (fitResult.data_phase.length !== flux.length) return null;
    return {
      target_id: fitResult.target_id,
      period_days: fitResult.period,
      x_label: 'Phase',
      y_label: 'Normalized Flux',
      points: fitResult.data_phase
        .map((phase, index) => ({
          hjd: fitResult.data_time[index] ?? index,
          phase,
          magnitude: flux[index],
          mag_error: error[index] ?? 0.0005,
        }))
        .sort((left, right) => (left.phase ?? 0) - (right.phase ?? 0)),
    };
  }

  if (fitResult.data_time.length !== flux.length) return null;
  return {
    target_id: fitResult.target_id,
    period_days: fitResult.period,
    x_label: 'BTJD',
    y_label: 'Normalized Flux',
    points: fitResult.data_time
      .map((time, index) => ({
        hjd: time,
        phase: null,
        magnitude: flux[index],
        mag_error: error[index] ?? 0.0005,
      }))
      .sort((left, right) => left.hjd - right.hjd),
  };
}

export function buildFitOverlayCurve(
  fitResult: TransitFitResponse,
  fitDataSource: TransitFitDataSource
): TransitLightCurveOverlay | null {
  const xValues =
    fitDataSource === 'phase_fold' ? fitResult.data_phase : fitResult.data_time;
  if (
    xValues.length <= 1 ||
    xValues.length !== fitResult.data_flux.length ||
    fitResult.data_flux.length !== fitResult.residuals.length
  ) {
    return null;
  }

  const points = xValues
    .map((x, index) => ({
      x,
      y: fitResult.data_flux[index] - fitResult.residuals[index],
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((left, right) => left.x - right.x);

  if (points.length <= 1) return null;

  return {
    x: points.map((point) => point.x),
    y: points.map((point) => point.y),
    name: 'Transit fit',
  };
}

export function buildFitResidualCurve(
  fitResult: TransitFitResponse,
  fitDataSource: TransitFitDataSource
): TransitLightCurveResiduals | null {
  const xValues =
    fitDataSource === 'phase_fold' ? fitResult.data_phase : fitResult.data_time;
  if (xValues.length <= 1 || xValues.length !== fitResult.residuals.length) {
    return null;
  }

  const points = xValues
    .map((x, index) => ({
      x,
      y: fitResult.residuals[index],
      error: fitResult.data_error[index] ?? 0,
    }))
    .filter(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        Number.isFinite(point.error)
    )
    .sort((left, right) => left.x - right.x);

  if (points.length <= 1) return null;

  return {
    x: points.map((point) => point.x),
    y: points.map((point) => point.y),
    error: points.map((point) => point.error),
  };
}
