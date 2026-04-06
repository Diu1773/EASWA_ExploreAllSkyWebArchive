import type { FitProgressEvent, TransitPhotometryProgressEvent } from '../../api/client';
import type { RecordSubmissionResponse } from '../../types/record';
import type {
  ApertureParams,
  PixelCoordinate,
  TransitCutoutPreview,
  TransitPhotometryResponse,
} from '../../types/transit';
import type { TransitFitResponse } from '../../types/transitFit';
import type { TransitInvalidationResolution } from './invalidation';
import type { PersistedTransitLabState, TransitFitDataSource } from './definition';

// ---------------------------------------------------------------------------
// Shared types (previously inlined in TransitLab.tsx)
// ---------------------------------------------------------------------------

export type StarKey = 'T' | `C${number}`;

export interface ComparisonStar {
  position: PixelCoordinate;
  aperture: ApertureParams;
}

export interface TransitFitDebugRequest {
  fitMode: TransitFitDataSource;
  period: number;
  t0: number;
  filterName: string | null;
  stellarTemperature: number | null;
  stellarLogg: number | null;
  stellarMetallicity: number | null;
  bjdStart: number | null;
  bjdEnd: number | null;
  requestedFitWindowPhase: number;
  baselineOrder: number;
  sigmaClipSigma: number;
  sigmaClipIterations: number;
  roiPointCount: number;
  roiTimeMin: number | null;
  roiTimeMax: number | null;
  roiFluxMin: number | null;
  roiFluxMax: number | null;
  roiErrorMin: number | null;
  roiErrorMax: number | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface TransitLabState {
  // Observation & preview setup
  activeObservationId: string | null;
  cutoutSizePx: number | null;
  pendingCutoutSizePx: number;
  selectedFrameIndex: number | null;

  // Star selection
  targetAperture: ApertureParams;
  targetPositionOffset: PixelCoordinate | null;
  comparisonStars: ComparisonStar[];
  selectedStar: StarKey;

  // Photometry result
  result: TransitPhotometryResponse | null;

  // Light curve / fold
  foldEnabled: boolean;
  foldPeriod: number | null;
  foldT0: number;
  foldT0Auto: boolean;

  // Fit config
  fitLimbDarkening: boolean;
  fitDataSource: TransitFitDataSource;
  bjdWindowStart: number | null;
  bjdWindowEnd: number | null;
  fitWindowPhase: number;
  fitBaselineOrder: number;
  fitSigmaClipSigma: number;
  fitSigmaClipIterations: number;
  fitResult: TransitFitResponse | null;

  // Record
  recordAnswers: Record<string, unknown>;
  recordTitle: string;
  submittedRecord: RecordSubmissionResponse | null;
  seedRecordSummary: RecordSubmissionResponse | null;

  // Runtime — preview
  preview: TransitCutoutPreview | null;
  previewLoading: boolean;
  framePreviewLoading: boolean;
  previewProgress: number;
  previewMessage: string | null;

  // Runtime — photometry run
  running: boolean;
  progress: number;
  runProgressEvent: TransitPhotometryProgressEvent | null;

  // Runtime — error
  errorMessage: string | null;

  // Runtime — fit
  fitting: boolean;
  fitProgress: FitProgressEvent | null;
  fitDebugRequest: TransitFitDebugRequest | null;
  fitDebugLog: string[];

  // Runtime — UI
  showTicMarkers: boolean;
  selectedComparisonDiagnostic: string | null;
  qcIncludedComparisonLabels: string[];
  recordLoading: boolean;
  recordSubmitting: boolean;
}

// ---------------------------------------------------------------------------
// Defaults — passed into actions that need fallback values
// ---------------------------------------------------------------------------

export interface TransitLabDefaults {
  aperture: ApertureParams;
  recordAnswers: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type TransitLabAction =
  | {
      type: 'restore';
      snapshot: PersistedTransitLabState | null;
      resumeFromSelect: boolean;
      defaults: TransitLabDefaults;
    }
  | {
      type: 'apply-invalidation';
      resolution: TransitInvalidationResolution;
      defaults: TransitLabDefaults;
    }
  | { type: 'hard-reset'; defaults: TransitLabDefaults }
  | { type: 'patch'; changes: Partial<TransitLabState> }
  | { type: 'update'; updater: (state: TransitLabState) => Partial<TransitLabState> }
  | { type: 'append-fit-debug-log'; lines: string[] };

// ---------------------------------------------------------------------------
// Initial state factory
// ---------------------------------------------------------------------------

export function createInitialTransitLabState(
  defaults: TransitLabDefaults,
): TransitLabState {
  return {
    activeObservationId: null,
    cutoutSizePx: null,
    pendingCutoutSizePx: 35,
    selectedFrameIndex: null,
    targetAperture: { ...defaults.aperture },
    targetPositionOffset: null,
    comparisonStars: [],
    selectedStar: 'T',
    result: null,
    foldEnabled: false,
    foldPeriod: null,
    foldT0: 0,
    foldT0Auto: true,
    fitLimbDarkening: false,
    fitDataSource: 'bjd_window',
    bjdWindowStart: null,
    bjdWindowEnd: null,
    fitWindowPhase: 0.12,
    fitBaselineOrder: 0,
    fitSigmaClipSigma: 0.0,
    fitSigmaClipIterations: 0,
    fitResult: null,
    recordAnswers: { ...defaults.recordAnswers },
    recordTitle: '',
    submittedRecord: null,
    seedRecordSummary: null,
    preview: null,
    previewLoading: false,
    framePreviewLoading: false,
    previewProgress: 0,
    previewMessage: null,
    running: false,
    progress: 0,
    runProgressEvent: null,
    errorMessage: null,
    fitting: false,
    fitProgress: null,
    fitDebugRequest: null,
    fitDebugLog: [],
    showTicMarkers: false,
    selectedComparisonDiagnostic: null,
    qcIncludedComparisonLabels: [],
    recordLoading: false,
    recordSubmitting: false,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function transitLabReducer(
  state: TransitLabState,
  action: TransitLabAction,
): TransitLabState {
  switch (action.type) {
    // Generic field update — use for simple one/two-field changes.
    case 'patch':
      return { ...state, ...action.changes };

    // Functional field update — preserves current-state semantics for setter wrappers.
    case 'update':
      return { ...state, ...action.updater(state) };

    // Accumulate fit debug lines without stale-closure issues.
    case 'append-fit-debug-log':
      return {
        ...state,
        fitDebugLog: [...state.fitDebugLog, ...action.lines],
      };

    // Restore from a persisted snapshot (session or draft).
    case 'restore': {
      const { snapshot: saved, resumeFromSelect, defaults } = action;
      if (!saved) {
        return createInitialTransitLabState(defaults);
      }
      return {
        // Reset all runtime state to clean defaults
        ...createInitialTransitLabState(defaults),
        // Then apply persisted fields from snapshot
        activeObservationId: saved.activeObservationId,
        cutoutSizePx: resumeFromSelect ? null : saved.cutoutSizePx,
        pendingCutoutSizePx: saved.cutoutSizePx ?? 35,
        selectedFrameIndex: resumeFromSelect ? null : saved.selectedFrameIndex,
        targetAperture: saved.targetAperture,
        targetPositionOffset: resumeFromSelect ? null : saved.targetPositionOffset,
        comparisonStars: resumeFromSelect ? [] : saved.comparisonStars,
        selectedStar: saved.selectedStar,
        result: resumeFromSelect ? null : saved.result,
        foldEnabled: saved.foldEnabled,
        foldPeriod: saved.foldPeriod,
        foldT0: saved.foldT0,
        foldT0Auto: saved.foldT0Auto,
        fitLimbDarkening: saved.fitLimbDarkening,
        fitDataSource: saved.fitDataSource,
        bjdWindowStart: saved.bjdWindowStart,
        bjdWindowEnd: saved.bjdWindowEnd,
        fitWindowPhase: saved.fitWindowPhase,
        fitBaselineOrder: saved.fitBaselineOrder,
        fitSigmaClipSigma: saved.fitSigmaClipSigma,
        fitSigmaClipIterations: saved.fitSigmaClipIterations,
        fitResult: resumeFromSelect ? null : saved.fitResult,
        recordAnswers:
          Object.keys(saved.recordAnswers).length > 0
            ? saved.recordAnswers
            : defaults.recordAnswers,
        recordTitle: saved.recordTitle,
        submittedRecord: resumeFromSelect ? null : saved.submittedRecord,
      };
    }

    // Apply an invalidation resolution (observation change, config change, etc.)
    case 'apply-invalidation': {
      const { resolution, defaults } = action;
      const next = { ...state };

      if (resolution.clearPreviewRuntime) {
        next.selectedFrameIndex = null;
        next.preview = null;
        next.previewLoading = false;
        next.framePreviewLoading = false;
        next.previewProgress = 0;
        next.previewMessage = null;
      }
      if (resolution.clearPhotometryProgress) {
        next.running = false;
        next.progress = 0;
        next.runProgressEvent = null;
      }
      if (resolution.clearPhotometryResult) {
        next.result = null;
      }
      if (resolution.clearFitState) {
        next.fitResult = null;
        next.fitting = false;
        next.fitProgress = null;
        next.fitDebugRequest = null;
        next.fitDebugLog = [];
      }
      if (resolution.clearSelectionState) {
        next.comparisonStars = [];
        next.targetPositionOffset = null;
        next.selectedStar = 'T';
      }
      if (resolution.clearWindowSelection) {
        next.bjdWindowStart = null;
        next.bjdWindowEnd = null;
      }
      if (resolution.clearSubmittedRecord) {
        next.submittedRecord = null;
      }
      if (resolution.resetRecordDraft) {
        next.recordTitle = '';
        next.recordAnswers = defaults.recordAnswers;
      }
      if (resolution.clearSeedRecordSummary) {
        next.seedRecordSummary = null;
      }
      if (resolution.resetCutoutSetup) {
        next.cutoutSizePx = null;
        next.pendingCutoutSizePx = 35;
      }
      if (resolution.resetTargetAperture) {
        next.targetAperture = { ...defaults.aperture };
      }
      if (resolution.clearErrorMessage) {
        next.errorMessage = null;
      }

      return next;
    }

    // Full reset — back to initial state.
    case 'hard-reset':
      return createInitialTransitLabState(action.defaults);
  }
}
