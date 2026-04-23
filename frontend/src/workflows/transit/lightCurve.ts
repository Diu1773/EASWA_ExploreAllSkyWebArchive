import type { TransitPhotometryResponse } from '../../types/transit';
import type { TransitFitResponse } from '../../types/transitFit';
import type {
  TransitFitDataSource,
  TransitFitDisplayXAxis,
  TransitFitDisplayYAxis,
} from './definition';

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

interface TransitLightCurveDisplayOptions {
  xAxisMode: TransitFitDisplayXAxis;
  yAxisMode: TransitFitDisplayYAxis;
  period: number | null | undefined;
  t0: number | null | undefined;
}

const DELTA_MAG_FACTOR = 2.5 / Math.LN10;

export function fluxToDeltaMagnitude(flux: number): number {
  if (!Number.isFinite(flux) || flux <= 0) return Number.NaN;
  return -2.5 * Math.log10(flux);
}

export function fluxErrorToDeltaMagnitudeError(
  flux: number,
  fluxError: number
): number {
  if (!Number.isFinite(flux) || flux <= 0) return 0;
  if (!Number.isFinite(fluxError) || fluxError <= 0) return 0;
  return DELTA_MAG_FACTOR * (fluxError / flux);
}

function resolveDisplayPhase(
  point: TransitPhotometryResponse['light_curve']['points'][number],
  period: number | null | undefined,
  t0: number | null | undefined
): number | null {
  if (typeof point.phase === 'number' && Number.isFinite(point.phase)) {
    return point.phase;
  }
  if (
    typeof period !== 'number' ||
    !Number.isFinite(period) ||
    period <= 0 ||
    typeof t0 !== 'number' ||
    !Number.isFinite(t0)
  ) {
    return null;
  }
  return computeTransitPhase(point.hjd, period, t0);
}

function toDisplayYAxisValue(
  flux: number,
  fluxError: number,
  yAxisMode: TransitFitDisplayYAxis
): { value: number; error: number } | null {
  if (!Number.isFinite(flux)) return null;
  if (yAxisMode === 'delta_mag') {
    const deltaMag = fluxToDeltaMagnitude(flux);
    if (!Number.isFinite(deltaMag)) return null;
    return {
      value: deltaMag,
      error: fluxErrorToDeltaMagnitudeError(flux, fluxError),
    };
  }
  return {
    value: flux,
    error: Number.isFinite(fluxError) && fluxError > 0 ? fluxError : 0,
  };
}

export function transformLightCurveForDisplay(
  lightCurve: TransitLightCurve,
  options: TransitLightCurveDisplayOptions
): TransitLightCurve | null {
  const transformedPoints = lightCurve.points
    .flatMap((point) => {
      const phase = resolveDisplayPhase(point, options.period, options.t0);
      if (options.xAxisMode === 'orbital_phase' && phase === null) {
        return [];
      }

      const yValue = toDisplayYAxisValue(
        point.magnitude,
        point.mag_error,
        options.yAxisMode
      );
      if (!yValue) return [];

      return [
        {
          ...point,
          phase,
          magnitude: yValue.value,
          mag_error: yValue.error,
        },
      ];
    })
    .sort((left, right) =>
      options.xAxisMode === 'orbital_phase'
        ? (left.phase ?? 0) - (right.phase ?? 0)
        : left.hjd - right.hjd
    );

  if (transformedPoints.length === 0) return null;

  return {
    target_id: lightCurve.target_id,
    period_days: options.period ?? lightCurve.period_days ?? null,
    x_label: options.xAxisMode === 'orbital_phase' ? 'Orbital Phase' : 'BTJD',
    y_label: options.yAxisMode === 'delta_mag' ? 'Delta mag' : 'Normalized Flux',
    points: transformedPoints,
  };
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
  xAxisMode: TransitFitDisplayXAxis,
  yAxisMode: TransitFitDisplayYAxis
): TransitLightCurveOverlay | null {
  const xValues = xAxisMode === 'orbital_phase' ? fitResult.data_phase : fitResult.data_time;
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
      y:
        yAxisMode === 'delta_mag'
          ? fluxToDeltaMagnitude(fitResult.data_flux[index] - fitResult.residuals[index])
          : fitResult.data_flux[index] - fitResult.residuals[index],
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
  xAxisMode: TransitFitDisplayXAxis,
  yAxisMode: TransitFitDisplayYAxis
): TransitLightCurveResiduals | null {
  const xValues = xAxisMode === 'orbital_phase' ? fitResult.data_phase : fitResult.data_time;
  if (
    xValues.length <= 1 ||
    xValues.length !== fitResult.residuals.length ||
    fitResult.data_flux.length !== fitResult.residuals.length
  ) {
    return null;
  }

  const points = xValues
    .map((x, index) => ({
      x,
      value: fitResult.data_flux[index],
      model: fitResult.data_flux[index] - fitResult.residuals[index],
      error: fitResult.data_error[index] ?? 0,
    }))
    .filter(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.value) &&
        Number.isFinite(point.model) &&
        Number.isFinite(point.error)
    )
    .flatMap((point) => {
      if (yAxisMode === 'delta_mag') {
        const dataMag = fluxToDeltaMagnitude(point.value);
        const modelMag = fluxToDeltaMagnitude(point.model);
        if (!Number.isFinite(dataMag) || !Number.isFinite(modelMag)) {
          return [];
        }
        return [
          {
            x: point.x,
            y: dataMag - modelMag,
            error: fluxErrorToDeltaMagnitudeError(point.value, point.error),
          },
        ];
      }
      return [
        {
          x: point.x,
          y: point.value - point.model,
          error: point.error,
        },
      ];
    })
    .sort((left, right) => left.x - right.x);

  if (points.length <= 1) return null;

  return {
    x: points.map((point) => point.x),
    y: points.map((point) => point.y),
    error: points.map((point) => point.error),
  };
}
