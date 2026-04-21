import type { WorkflowDefinition } from '../core/types';
import type {
  MicrolensingFitResponse,
  MicrolensingLightCurveResponse,
} from '../../types/microlensing';
import type { RecordSubmissionResponse } from '../../types/record';

export type KmtnetWorkflowStep =
  | 'field'
  | 'align'
  | 'difference'
  | 'extract'
  | 'merge'
  | 'fit'
  | 'record';

export interface PersistedKmtnetLabState {
  previewFrameIndex: number | null;
  singleSiteCurve: MicrolensingLightCurveResponse | null;
  mergedCurve: MicrolensingLightCurveResponse | null;
  fitResult: MicrolensingFitResponse | null;
  recordAnswers: Record<string, unknown>;
  recordTitle: string;
  submittedRecord: RecordSubmissionResponse | null;
}

export interface KmtnetStepAvailability {
  hasSingleSiteCurve: boolean;
  hasMergedCurve: boolean;
  hasFitResult: boolean;
}

interface CreateKmtnetWorkflowDefinitionOptions {
  targetId: string;
}

function normalizeFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeOptionalInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function normalizeLightCurveResponse(
  value: unknown,
  fallbackTargetId: string,
): MicrolensingLightCurveResponse | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<MicrolensingLightCurveResponse>;
  const points = Array.isArray(candidate.points)
    ? candidate.points.flatMap((point) => {
        if (!point || typeof point !== 'object') return [];
        const item = point as Partial<MicrolensingLightCurveResponse['points'][number]>;
        const hjd = normalizeFiniteNumber(item.hjd, Number.NaN);
        const magnitude = normalizeFiniteNumber(item.magnitude, Number.NaN);
        const magError = normalizeFiniteNumber(item.mag_error, Number.NaN);
        if (!Number.isFinite(hjd) || !Number.isFinite(magnitude) || !Number.isFinite(magError)) {
          return [];
        }
        return [
          {
            hjd,
            site: typeof item.site === 'string' ? item.site : 'unknown',
            magnitude,
            mag_error: magError,
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
    points,
    x_label: typeof candidate.x_label === 'string' ? candidate.x_label : 'HJD',
    y_label: typeof candidate.y_label === 'string' ? candidate.y_label : 'I-band Magnitude',
  };
}

function normalizeFitResponse(value: unknown): MicrolensingFitResponse | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<MicrolensingFitResponse>;
  const modelCurve = Array.isArray(candidate.model_curve)
    ? candidate.model_curve.flatMap((point) => {
        if (!point || typeof point !== 'object') return [];
        const item = point as Partial<MicrolensingFitResponse['model_curve'][number]>;
        const hjd = normalizeFiniteNumber(item.hjd, Number.NaN);
        const magnitude = normalizeFiniteNumber(item.magnitude, Number.NaN);
        if (!Number.isFinite(hjd) || !Number.isFinite(magnitude)) return [];
        return [{ hjd, magnitude }];
      })
    : [];

  if (modelCurve.length === 0) return null;

  return {
    t0: normalizeFiniteNumber(candidate.t0),
    u0: normalizeFiniteNumber(candidate.u0),
    tE: normalizeFiniteNumber(candidate.tE),
    mag_base: normalizeFiniteNumber(candidate.mag_base),
    t0_err: normalizeFiniteNumber(candidate.t0_err),
    u0_err: normalizeFiniteNumber(candidate.u0_err),
    tE_err: normalizeFiniteNumber(candidate.tE_err),
    mag_base_err: normalizeFiniteNumber(candidate.mag_base_err),
    chi2_dof: normalizeFiniteNumber(candidate.chi2_dof),
    model_curve: modelCurve,
  };
}

function parseKmtnetStep(value: string | null): KmtnetWorkflowStep | null {
  if (
    value === 'field' ||
    value === 'align' ||
    value === 'difference' ||
    value === 'extract' ||
    value === 'merge' ||
    value === 'fit' ||
    value === 'record'
  ) {
    return value;
  }
  if (value === 'single') return 'field';
  if (value === 'lightcurve' || value === 'network') return 'merge';
  if (value === 'interpret') return 'fit';
  return null;
}

function clampKmtnetStep(
  requestedStep: KmtnetWorkflowStep,
  options: KmtnetStepAvailability,
): KmtnetWorkflowStep {
  if (requestedStep === 'record') {
    return options.hasFitResult ? 'record' : clampKmtnetStep('fit', options);
  }
  if (requestedStep === 'fit') {
    return options.hasMergedCurve ? 'fit' : options.hasSingleSiteCurve ? 'merge' : 'extract';
  }
  if (requestedStep === 'merge') {
    return options.hasSingleSiteCurve ? 'merge' : 'extract';
  }
  if (requestedStep === 'difference') {
    return 'difference';
  }
  if (requestedStep === 'align') {
    return 'align';
  }
  if (requestedStep === 'extract') {
    return 'extract';
  }
  return 'field';
}

function getKmtnetStepAvailability(
  snapshot: PersistedKmtnetLabState | null,
): KmtnetStepAvailability {
  return {
    hasSingleSiteCurve: snapshot?.singleSiteCurve !== null,
    hasMergedCurve: snapshot?.mergedCurve !== null,
    hasFitResult: snapshot?.fitResult !== null,
  };
}

function hasMeaningfulKmtnetSnapshot(
  step: KmtnetWorkflowStep,
  snapshot: PersistedKmtnetLabState,
): boolean {
  if (step !== 'field') return true;
  return (
    snapshot.previewFrameIndex !== null ||
    snapshot.singleSiteCurve !== null ||
    snapshot.mergedCurve !== null ||
    snapshot.fitResult !== null
  );
}

export function createKmtnetWorkflowDefinition({
  targetId,
}: CreateKmtnetWorkflowDefinitionOptions): WorkflowDefinition<
  KmtnetWorkflowStep,
  PersistedKmtnetLabState,
  KmtnetStepAvailability
> {
  return {
    workflowId: 'kmtnet_lab',
    version: 1,
    defaultStep: 'field',
    parseStep: parseKmtnetStep,
    clampStep: clampKmtnetStep,
    getAvailability: getKmtnetStepAvailability,
    hasMeaningfulSnapshot: hasMeaningfulKmtnetSnapshot,
    normalizeSnapshot: (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return null;
      const candidate = raw as Partial<PersistedKmtnetLabState> & {
        lcData?: MicrolensingLightCurveResponse | null;
        lightCurve?: MicrolensingLightCurveResponse | null;
      };
      const normalizedLegacyCurve = normalizeLightCurveResponse(
        candidate.mergedCurve ?? candidate.lightCurve ?? candidate.lcData ?? null,
        targetId,
      );
      return {
        previewFrameIndex: normalizeOptionalInteger(candidate.previewFrameIndex),
        singleSiteCurve: normalizeLightCurveResponse(
          candidate.singleSiteCurve ?? null,
          targetId,
        ),
        mergedCurve: normalizedLegacyCurve,
        fitResult: normalizeFitResponse(candidate.fitResult),
        recordAnswers:
          candidate.recordAnswers && typeof candidate.recordAnswers === 'object'
            ? (candidate.recordAnswers as Record<string, unknown>)
            : {},
        recordTitle: typeof candidate.recordTitle === 'string' ? candidate.recordTitle : '',
        submittedRecord:
          candidate.submittedRecord && typeof candidate.submittedRecord === 'object'
            ? (candidate.submittedRecord as RecordSubmissionResponse)
            : null,
      };
    },
  };
}
