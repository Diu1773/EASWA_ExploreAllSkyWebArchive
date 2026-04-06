import type { RecordSubmissionResponse } from '../../types/record';
import type {
  ApertureParams,
  PixelCoordinate,
  TransitComparisonDiagnostic,
  TransitPhotometryResponse,
} from '../../types/transit';
import type { TransitFitParameters, TransitFitResponse } from '../../types/transitFit';
import type { WorkflowDefinition } from '../core/types';

export type TransitWorkflowStep =
  | 'select'
  | 'run'
  | 'comparisonqc'
  | 'lightcurve'
  | 'transitfit'
  | 'record';

export type TransitFitDataSource = 'phase_fold' | 'bjd_window';

export interface PersistedTransitComparisonStar {
  position: PixelCoordinate;
  aperture: ApertureParams;
}

export interface PersistedTransitLabState {
  selectedObservationIds: string[];
  activeObservationId: string | null;
  cutoutSizePx: number | null;
  selectedFrameIndex: number | null;
  targetAperture: ApertureParams;
  targetPositionOffset: PixelCoordinate | null;
  comparisonStars: PersistedTransitComparisonStar[];
  selectedStar: 'T' | `C${number}`;
  foldEnabled: boolean;
  foldPeriod: number | null;
  foldT0: number;
  fitLimbDarkening: boolean;
  fitDataSource: TransitFitDataSource;
  bjdWindowStart: number | null;
  bjdWindowEnd: number | null;
  fitWindowPhase: number;
  fitBaselineOrder: number;
  fitSigmaClipSigma: number;
  fitSigmaClipIterations: number;
  fitResult: TransitFitResponse | null;
  result: TransitPhotometryResponse | null;
  recordAnswers: Record<string, unknown>;
  recordTitle: string;
  submittedRecord: RecordSubmissionResponse | null;
}

export interface TransitStepAvailability {
  hasPreviewState: boolean;
  hasComparisonStars: boolean;
  hasResult: boolean;
}

interface CreateTransitWorkflowDefinitionOptions {
  targetId: string;
  targetPeriodDays: number | null | undefined;
  defaultAperture: ApertureParams;
}

function normalizeFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

function normalizePixelCoordinate(
  value: unknown,
  fallback: PixelCoordinate | null = null
): PixelCoordinate | null {
  if (!value || typeof value !== 'object') return fallback;
  const candidate = value as Partial<PixelCoordinate>;
  const x = normalizeFiniteNumber(candidate.x, Number.NaN);
  const y = normalizeFiniteNumber(candidate.y, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
  return { x, y };
}

function normalizeComparisonStars(
  value: unknown,
  defaultAperture: ApertureParams
): PersistedTransitComparisonStar[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<PersistedTransitComparisonStar>;
    const position = normalizePixelCoordinate(candidate.position);
    if (!position) return [];
    return [
      {
        position,
        aperture: {
          apertureRadius: normalizeFiniteNumber(
            candidate.aperture?.apertureRadius,
            defaultAperture.apertureRadius
          ),
          innerAnnulus: normalizeFiniteNumber(
            candidate.aperture?.innerAnnulus,
            defaultAperture.innerAnnulus
          ),
          outerAnnulus: normalizeFiniteNumber(
            candidate.aperture?.outerAnnulus,
            defaultAperture.outerAnnulus
          ),
        },
      },
    ];
  });
}

function normalizeLightCurveResponse(
  value: unknown,
  fallbackTargetId: string,
  fallbackPeriodDays: number | null | undefined
): TransitPhotometryResponse['light_curve'] | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TransitPhotometryResponse['light_curve']>;
  const points = Array.isArray(candidate.points)
    ? candidate.points.flatMap((point) => {
        if (!point || typeof point !== 'object') return [];
        const item = point as Partial<TransitPhotometryResponse['light_curve']['points'][number]>;
        const hjd = normalizeFiniteNumber(item.hjd, Number.NaN);
        const magnitude = normalizeFiniteNumber(item.magnitude, Number.NaN);
        if (!Number.isFinite(hjd) || !Number.isFinite(magnitude)) return [];
        return [
          {
            hjd,
            phase:
              item.phase === null
                ? null
                : typeof item.phase === 'number' && Number.isFinite(item.phase)
                  ? item.phase
                  : null,
            magnitude,
            mag_error: normalizeFiniteNumber(item.mag_error, 0.0),
          },
        ];
      })
    : [];
  if (points.length === 0) return null;
  return {
    target_id:
      typeof candidate.target_id === 'string' && candidate.target_id.trim() !== ''
        ? candidate.target_id
        : fallbackTargetId,
    period_days:
      candidate.period_days === null
        ? null
        : typeof candidate.period_days === 'number' && Number.isFinite(candidate.period_days)
          ? candidate.period_days
          : fallbackPeriodDays ?? null,
    points,
    x_label: typeof candidate.x_label === 'string' ? candidate.x_label : 'BTJD',
    y_label: typeof candidate.y_label === 'string' ? candidate.y_label : 'Normalized Flux',
  };
}

function normalizeTransitComparisonDiagnostics(
  value: unknown,
  fallbackTargetId: string
): TransitComparisonDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<TransitComparisonDiagnostic>;
    const position = normalizePixelCoordinate(candidate.position);
    const lightCurve = normalizeLightCurveResponse(candidate.light_curve, fallbackTargetId, null);
    if (!position || !lightCurve) return [];
    return [
      {
        label:
          typeof candidate.label === 'string' && candidate.label.trim() !== ''
            ? candidate.label
            : `C${index + 1}`,
        position,
        aperture_radius: normalizeFiniteNumber(candidate.aperture_radius, 0),
        inner_annulus: normalizeFiniteNumber(candidate.inner_annulus, 0),
        outer_annulus: normalizeFiniteNumber(candidate.outer_annulus, 0),
        valid_frame_count: normalizeFiniteNumber(candidate.valid_frame_count, 0),
        median_flux: normalizeFiniteNumber(candidate.median_flux, 0),
        differential_rms: normalizeFiniteNumber(candidate.differential_rms, 0),
        differential_mad: normalizeFiniteNumber(candidate.differential_mad, 0),
        ensemble_weight: normalizeFiniteNumber(candidate.ensemble_weight, 0),
        light_curve: lightCurve,
      },
    ];
  });
}

function normalizeTransitPhotometryResponse(
  value: unknown,
  fallbackTargetId: string,
  fallbackPeriodDays: number | null | undefined
): TransitPhotometryResponse | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TransitPhotometryResponse>;
  const lightCurve = normalizeLightCurveResponse(
    candidate.light_curve,
    fallbackTargetId,
    fallbackPeriodDays
  );
  if (!lightCurve) return null;
  const comparisonDiagnostics = normalizeTransitComparisonDiagnostics(
    candidate.comparison_diagnostics,
    lightCurve.target_id
  );
  const targetPosition =
    normalizePixelCoordinate(candidate.target_position) ?? { x: 0, y: 0 };
  const comparisonPositions = Array.isArray(candidate.comparison_positions)
    ? candidate.comparison_positions.flatMap((position) => {
        const normalized = normalizePixelCoordinate(position);
        return normalized ? [normalized] : [];
      })
    : comparisonDiagnostics.map((diagnostic) => diagnostic.position);

  return {
    target_id:
      typeof candidate.target_id === 'string' && candidate.target_id.trim() !== ''
        ? candidate.target_id
        : lightCurve.target_id,
    observation_id:
      typeof candidate.observation_id === 'string' ? candidate.observation_id : '',
    sector: normalizeFiniteNumber(candidate.sector, 0),
    frame_count: normalizeFiniteNumber(candidate.frame_count, lightCurve.points.length),
    comparison_count: normalizeFiniteNumber(
      candidate.comparison_count,
      comparisonDiagnostics.length
    ),
    target_position: targetPosition,
    comparison_positions: comparisonPositions,
    target_median_flux: normalizeFiniteNumber(candidate.target_median_flux, 0),
    comparison_median_flux: normalizeFiniteNumber(candidate.comparison_median_flux, 0),
    comparison_diagnostics: comparisonDiagnostics,
    light_curve: lightCurve,
  };
}

function normalizeTransitFitParameters(value: unknown): TransitFitParameters {
  const candidate = value && typeof value === 'object' ? (value as Partial<TransitFitParameters>) : {};
  return {
    rp_rs: normalizeFiniteNumber(candidate.rp_rs, 0),
    rp_rs_err: normalizeFiniteNumber(candidate.rp_rs_err, 0),
    a_rs: normalizeFiniteNumber(candidate.a_rs, 0),
    a_rs_err: normalizeFiniteNumber(candidate.a_rs_err, 0),
    inclination: normalizeFiniteNumber(candidate.inclination, 0),
    inclination_err: normalizeFiniteNumber(candidate.inclination_err, 0),
    u1: normalizeFiniteNumber(candidate.u1, 0),
    u1_err: normalizeFiniteNumber(candidate.u1_err, 0),
    u2: normalizeFiniteNumber(candidate.u2, 0),
    u2_err: normalizeFiniteNumber(candidate.u2_err, 0),
    chi_squared: normalizeFiniteNumber(candidate.chi_squared, 0),
    reduced_chi_squared: normalizeFiniteNumber(candidate.reduced_chi_squared, 0),
    degrees_of_freedom: normalizeFiniteNumber(candidate.degrees_of_freedom, 0),
  };
}

function normalizeTransitModelCurve(value: unknown): TransitFitResponse['model_curve'] {
  const candidate =
    value && typeof value === 'object'
      ? (value as Partial<TransitFitResponse['model_curve']>)
      : {};
  return {
    phase: normalizeNumberArray(candidate.phase),
    flux: normalizeNumberArray(candidate.flux),
  };
}

export function normalizeTransitFitResponse(value: unknown): TransitFitResponse | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TransitFitResponse>;
  const normalizedReferenceT0 =
    candidate.reference_t0 === null || candidate.reference_t0 === undefined
      ? null
      : normalizeFiniteNumber(candidate.reference_t0, Number.NaN);
  if (!Number.isFinite(normalizedReferenceT0)) {
    return null;
  }
  const referenceT0 = Number(normalizedReferenceT0);
  const modelCurve = normalizeTransitModelCurve(candidate.model_curve);
  const modelTime = normalizeNumberArray(candidate.model_time);
  if (modelTime.length !== modelCurve.flux.length || modelTime.length === 0) {
    return null;
  }
  const preprocessingCandidate =
    candidate.preprocessing && typeof candidate.preprocessing === 'object'
      ? candidate.preprocessing
      : null;
  const normalizedBjdStart =
    preprocessingCandidate?.bjd_start === null || preprocessingCandidate?.bjd_start === undefined
      ? null
      : normalizeFiniteNumber(preprocessingCandidate.bjd_start, 0);
  const normalizedBjdEnd =
    preprocessingCandidate?.bjd_end === null || preprocessingCandidate?.bjd_end === undefined
      ? null
      : normalizeFiniteNumber(preprocessingCandidate.bjd_end, 0);
  return {
    target_id: typeof candidate.target_id === 'string' ? candidate.target_id : '',
    period: normalizeFiniteNumber(candidate.period, 0),
    t0: normalizeFiniteNumber(candidate.t0, 0),
    reference_t0: referenceT0,
    limb_darkening_source:
      typeof candidate.limb_darkening_source === 'string'
        ? candidate.limb_darkening_source
        : null,
    limb_darkening_filter:
      typeof candidate.limb_darkening_filter === 'string'
        ? candidate.limb_darkening_filter
        : null,
    used_batman: Boolean(candidate.used_batman),
    used_mcmc: Boolean(candidate.used_mcmc),
    preprocessing: {
      fit_mode:
        preprocessingCandidate?.fit_mode === 'phase_fold' ? 'phase_fold' : 'bjd_window',
      fit_window_phase: normalizeFiniteNumber(preprocessingCandidate?.fit_window_phase, 0.12),
      bjd_start: normalizedBjdStart,
      bjd_end: normalizedBjdEnd,
      limb_darkening_source:
        typeof preprocessingCandidate?.limb_darkening_source === 'string'
          ? preprocessingCandidate.limb_darkening_source
          : null,
      limb_darkening_filter:
        typeof preprocessingCandidate?.limb_darkening_filter === 'string'
          ? preprocessingCandidate.limb_darkening_filter
          : null,
      baseline_order: normalizeFiniteNumber(preprocessingCandidate?.baseline_order, 0),
      sigma_clip_sigma: normalizeFiniteNumber(preprocessingCandidate?.sigma_clip_sigma, 0),
      sigma_clip_iterations: normalizeFiniteNumber(
        preprocessingCandidate?.sigma_clip_iterations,
        0
      ),
      retained_points: normalizeFiniteNumber(preprocessingCandidate?.retained_points, 0),
      clipped_points: normalizeFiniteNumber(preprocessingCandidate?.clipped_points, 0),
    },
    fitted_params: normalizeTransitFitParameters(candidate.fitted_params),
    initial_params: normalizeTransitFitParameters(candidate.initial_params),
    model_curve: modelCurve,
    initial_curve: normalizeTransitModelCurve(candidate.initial_curve),
    model_time: modelTime,
    data_time: normalizeNumberArray(candidate.data_time),
    data_phase: normalizeNumberArray(candidate.data_phase),
    data_flux: normalizeNumberArray(candidate.data_flux),
    data_error: normalizeNumberArray(candidate.data_error),
    residuals: normalizeNumberArray(candidate.residuals),
  };
}

function parseTransitStep(value: string | null): TransitWorkflowStep | null {
  if (
    value === 'select' ||
    value === 'run' ||
    value === 'comparisonqc' ||
    value === 'lightcurve' ||
    value === 'transitfit' ||
    value === 'record'
  ) {
    return value;
  }
  return null;
}

function clampTransitStep(
  requestedStep: TransitWorkflowStep,
  options: TransitStepAvailability
): TransitWorkflowStep {
  if (requestedStep === 'record') {
    return options.hasResult ? 'record' : clampTransitStep('transitfit', options);
  }
  if (requestedStep === 'transitfit') {
    return options.hasResult ? 'transitfit' : clampTransitStep('lightcurve', options);
  }
  if (requestedStep === 'lightcurve') {
    return options.hasResult ? 'lightcurve' : clampTransitStep('comparisonqc', options);
  }
  if (requestedStep === 'comparisonqc') {
    return options.hasResult ? 'comparisonqc' : clampTransitStep('run', options);
  }
  if (requestedStep === 'run') {
    return options.hasPreviewState && options.hasComparisonStars ? 'run' : 'select';
  }
  return 'select';
}

function getTransitStepAvailability(
  snapshot: PersistedTransitLabState | null
): TransitStepAvailability {
  return {
    hasPreviewState:
      snapshot?.activeObservationId !== null &&
      snapshot?.cutoutSizePx !== null &&
      snapshot?.targetPositionOffset !== null,
    hasComparisonStars: (snapshot?.comparisonStars.length ?? 0) > 0,
    hasResult: snapshot?.result !== null,
  };
}

function hasMeaningfulTransitDraftSnapshot(
  step: TransitWorkflowStep,
  snapshot: PersistedTransitLabState
): boolean {
  if (step !== 'select') return true;
  if (snapshot.selectedObservationIds.length > 0) return true;
  if (snapshot.activeObservationId !== null) return true;
  if (snapshot.cutoutSizePx !== null) return true;
  if (snapshot.selectedFrameIndex !== null) return true;
  if (snapshot.targetPositionOffset !== null) return true;
  if (snapshot.comparisonStars.length > 0) return true;
  if (snapshot.foldEnabled) return true;
  if (snapshot.foldPeriod !== null) return true;
  if (snapshot.bjdWindowStart !== null || snapshot.bjdWindowEnd !== null) return true;
  if (snapshot.fitResult !== null || snapshot.result !== null) return true;
  if (snapshot.recordTitle.trim() !== '') return true;
  if (snapshot.submittedRecord !== null) return true;
  return false;
}

export function createTransitWorkflowDefinition({
  targetId,
  targetPeriodDays,
  defaultAperture,
}: CreateTransitWorkflowDefinitionOptions): WorkflowDefinition<
  TransitWorkflowStep,
  PersistedTransitLabState,
  TransitStepAvailability
> {
  return {
    workflowId: 'transit_lab',
    version: 1,
    defaultStep: 'select',
    parseStep: parseTransitStep,
    clampStep: clampTransitStep,
    getAvailability: getTransitStepAvailability,
    hasMeaningfulSnapshot: hasMeaningfulTransitDraftSnapshot,
    normalizeSnapshot: (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return null;
      const candidate = raw as Partial<PersistedTransitLabState> & {
        recordSaved?: RecordSubmissionResponse | null;
      };
      return {
        selectedObservationIds: Array.isArray(candidate.selectedObservationIds)
          ? candidate.selectedObservationIds.filter(
              (id): id is string => typeof id === 'string' && id.trim() !== ''
            )
          : typeof candidate.activeObservationId === 'string' &&
              candidate.activeObservationId.trim() !== ''
            ? [candidate.activeObservationId]
            : [],
        activeObservationId:
          typeof candidate.activeObservationId === 'string' &&
          candidate.activeObservationId.trim() !== ''
            ? candidate.activeObservationId
            : null,
        cutoutSizePx:
          typeof candidate.cutoutSizePx === 'number' && Number.isFinite(candidate.cutoutSizePx)
            ? candidate.cutoutSizePx
            : null,
        selectedFrameIndex:
          typeof candidate.selectedFrameIndex === 'number' &&
          Number.isFinite(candidate.selectedFrameIndex)
            ? candidate.selectedFrameIndex
            : null,
        targetAperture: {
          apertureRadius: normalizeFiniteNumber(
            candidate.targetAperture?.apertureRadius,
            defaultAperture.apertureRadius
          ),
          innerAnnulus: normalizeFiniteNumber(
            candidate.targetAperture?.innerAnnulus,
            defaultAperture.innerAnnulus
          ),
          outerAnnulus: normalizeFiniteNumber(
            candidate.targetAperture?.outerAnnulus,
            defaultAperture.outerAnnulus
          ),
        },
        targetPositionOffset: normalizePixelCoordinate(candidate.targetPositionOffset),
        comparisonStars: normalizeComparisonStars(candidate.comparisonStars, defaultAperture),
        selectedStar:
          candidate.selectedStar === 'T' ||
          (typeof candidate.selectedStar === 'string' && /^C\d+$/.test(candidate.selectedStar))
            ? candidate.selectedStar
            : 'T',
        foldEnabled: Boolean(candidate.foldEnabled),
        foldPeriod:
          typeof candidate.foldPeriod === 'number' && Number.isFinite(candidate.foldPeriod)
            ? candidate.foldPeriod
            : null,
        foldT0: normalizeFiniteNumber(candidate.foldT0, 0),
        fitLimbDarkening: Boolean(candidate.fitLimbDarkening),
        fitDataSource:
          candidate.fitDataSource === 'phase_fold' ? 'phase_fold' : 'bjd_window',
        bjdWindowStart:
          typeof candidate.bjdWindowStart === 'number' &&
          Number.isFinite(candidate.bjdWindowStart)
            ? candidate.bjdWindowStart
            : null,
        bjdWindowEnd:
          typeof candidate.bjdWindowEnd === 'number' && Number.isFinite(candidate.bjdWindowEnd)
            ? candidate.bjdWindowEnd
            : null,
        fitWindowPhase: normalizeFiniteNumber(candidate.fitWindowPhase, 0.12),
        fitBaselineOrder: normalizeFiniteNumber(candidate.fitBaselineOrder, 0),
        fitSigmaClipSigma: normalizeFiniteNumber(candidate.fitSigmaClipSigma, 0),
        fitSigmaClipIterations: normalizeFiniteNumber(candidate.fitSigmaClipIterations, 0),
        fitResult: normalizeTransitFitResponse(candidate.fitResult),
        result: normalizeTransitPhotometryResponse(
          candidate.result,
          targetId,
          targetPeriodDays
        ),
        recordAnswers:
          candidate.recordAnswers && typeof candidate.recordAnswers === 'object'
            ? (candidate.recordAnswers as Record<string, unknown>)
            : {},
        recordTitle: typeof candidate.recordTitle === 'string' ? candidate.recordTitle : '',
        submittedRecord:
          candidate.submittedRecord && typeof candidate.submittedRecord === 'object'
            ? (candidate.submittedRecord as RecordSubmissionResponse)
            : candidate.recordSaved && typeof candidate.recordSaved === 'object'
              ? (candidate.recordSaved as RecordSubmissionResponse)
              : null,
      };
    },
  };
}
