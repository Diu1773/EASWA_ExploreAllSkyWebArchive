import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  cancelTransitPreviewJob,
  createTransitPreviewJob,
  fetchMyRecordSubmission,
  fetchTransitCutoutPreview,
  fetchTransitPreviewJob,
  fetchRecordTemplate,
  fitTransitModelStreaming,
  runTransitPhotometryStreaming,
  submitRecordTemplate,
} from '../../api/client';
import { useAppStore } from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import type { Observation, Target } from '../../types/target';
import type {
  ApertureParams,
  PixelCoordinate,
  StarOverlay,
  TransitApertureConfig,
  TransitComparisonDiagnostic,
  TransitPhotometryResponse,
} from '../../types/transit';
import type { RecordTemplate } from '../../types/record';
import { defaultTransitRecordTemplate } from '../../data/transitRecordTemplate';
import { useWorkflowController } from '../../hooks/useWorkflowController';
import type { WorkflowSessionSource } from '../../utils/workflowSession';
import {
  createTransitWorkflowDefinition,
  normalizeTransitFitResponse,
  type PersistedTransitLabState,
  type TransitFitDataSource,
  type TransitStepAvailability,
  type TransitWorkflowStep,
} from '../../workflows/transit/definition';
import {
  reduceTransitInvalidation,
  type TransitInvalidationAction,
} from '../../workflows/transit/invalidation';
import {
  buildBjdLightCurve,
  buildFitOverlayCurve,
  buildFitResidualCurve,
  buildLightCurveFromFitResult,
  buildPhaseFoldedLightCurve,
  computeDefaultBjdWindow,
  estimatePhaseFoldReferenceT0,
} from '../../workflows/transit/lightCurve';
import {
  createInitialTransitLabState,
  transitLabReducer,
  type ComparisonStar,
  type StarKey,
  type TransitLabDefaults,
  type TransitLabState,
} from '../../workflows/transit/state';
import { TransitCutoutViewer } from './TransitCutoutViewer';
import { LightCurvePlot } from './LightCurvePlot';

interface TransitLabProps {
  target: Target;
  observations: Observation[];
  draftId?: string | null;
  seedRecordId?: number | null;
}

type TransitStep = TransitWorkflowStep;
type StepState = 'locked' | 'accessible' | 'completed';

const STEPS: Array<{ id: TransitStep; label: string; number: number }> = [
  { id: 'select', label: 'Select Stars', number: 1 },
  { id: 'run', label: 'Run Photometry', number: 2 },
  { id: 'comparisonqc', label: 'Comparison QC', number: 3 },
  { id: 'lightcurve', label: 'Light Curve', number: 4 },
  { id: 'transitfit', label: 'Transit Fit', number: 5 },
  { id: 'record', label: 'Record Result', number: 6 },
];

const DEV_CUTOUT_SIZE_OPTIONS = [30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 99] as const;
const PROD_CUTOUT_SIZE_OPTIONS = [30, 35, 40, 45] as const;
const CUTOUT_SIZE_OPTIONS = import.meta.env.DEV
  ? DEV_CUTOUT_SIZE_OPTIONS
  : PROD_CUTOUT_SIZE_OPTIONS;

const DEFAULT_APERTURE: ApertureParams = {
  apertureRadius: 2.5,
  innerAnnulus: 4.0,
  outerAnnulus: 6.0,
};

const MAX_COMPARISON_STARS = 10;

function arePixelPositionsNear(
  left: PixelCoordinate,
  right: PixelCoordinate,
  tolerancePx = 0.75
): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) <= tolerancePx;
}

function toTransitApertureConfig(
  position: PixelCoordinate,
  aperture: ApertureParams
): TransitApertureConfig {
  return {
    position,
    aperture_radius: aperture.apertureRadius,
    inner_annulus: aperture.innerAnnulus,
    outer_annulus: aperture.outerAnnulus,
  };
}

function buildInitialRecordAnswers(template: RecordTemplate | null): Record<string, unknown> {
  if (!template) return {};
  return template.questions.reduce<Record<string, unknown>>((acc, question) => {
    if (question.type === 'checkbox') {
      acc[question.id] = [];
    } else {
      acc[question.id] = '';
    }
    return acc;
  }, {});
}

function isScoreQuestion(question: RecordTemplate['questions'][number]): boolean {
  return question.type === 'number' && question.min_value === 1 && question.max_value === 5;
}

export function TransitLab({
  target,
  observations,
  draftId = null,
  seedRecordId = null,
}: TransitLabProps) {
  const selectedIds = useAppStore((s) => s.selectedObservationIds);
  const selectAllObservations = useAppStore((s) => s.selectAllObservations);
  const user = useAuthStore((s) => s.user);
  const [observationSelectionHydrated, setObservationSelectionHydrated] = useState(() =>
    useAppStore.persist.hasHydrated()
  );
  const [recordTemplate, setRecordTemplate] = useState<RecordTemplate | null>(
    defaultTransitRecordTemplate
  );

  // ── Reducer ──────────────────────────────────────────────────────────
  const stateDefaults = useMemo<TransitLabDefaults>(
    () => ({
      aperture: DEFAULT_APERTURE,
      recordAnswers: buildInitialRecordAnswers(defaultTransitRecordTemplate),
    }),
    [],
  );
  const [state, dispatch] = useReducer(
    transitLabReducer,
    stateDefaults,
    createInitialTransitLabState,
  );
  const patch = useCallback(
    (changes: Partial<TransitLabState>) => dispatch({ type: 'patch', changes }),
    [],
  );
  // Destructure for convenient access throughout the component
  const {
    activeObservationId,
    cutoutSizePx,
    pendingCutoutSizePx,
    selectedFrameIndex,
    targetAperture,
    targetPositionOffset,
    comparisonStars,
    selectedStar,
    result,
    foldEnabled,
    foldPeriod,
    foldT0,
    foldT0Auto,
    fitLimbDarkening,
    fitDataSource,
    bjdWindowStart,
    bjdWindowEnd,
    fitWindowPhase,
    fitBaselineOrder,
    fitSigmaClipSigma,
    fitSigmaClipIterations,
    fitResult,
    recordAnswers,
    recordTitle,
    submittedRecord,
    seedRecordSummary,
    preview,
    previewLoading,
    framePreviewLoading,
    previewProgress,
    previewMessage,
    running,
    progress,
    runProgressEvent,
    errorMessage,
    fitting,
    fitProgress,
    fitDebugRequest,
    fitDebugLog,
    showTicMarkers,
    selectedComparisonDiagnostic,
    qcIncludedComparisonLabels,
    recordLoading,
    recordSubmitting,
  } = state;


  // ── Refs (side-effects only, not in reducer) ─────────────────────────
  const previewJobIdRef = useRef<string | null>(null);
  const previewPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const framePreviewAbortRef = useRef<AbortController | null>(null);
  const runAbortRef = useRef<AbortController | null>(null);
  const recordTemplateRequestedRef = useRef(false);
  const loadedRecordIdRef = useRef<number | null>(null);
  const restoringSessionPreviewRef = useRef(false);
  const suppressAnalysisInvalidationRef = useRef(false);
  const analysisConfigSignatureRef = useRef<string | null>(null);
  const observedActiveObservationRef = useRef<string | null | undefined>(undefined);

  // ── Derived values ───────────────────────────────────────────────────
  const selectedObservations = observations.filter((obs) =>
    selectedIds.includes(obs.id)
  );
  const comparisonDiagnostics = result?.comparison_diagnostics ?? [];
  const fitEngineLabel = fitResult
    ? `${fitResult.used_batman ? 'batman transit model' : 'simplified transit model'} · ${
        fitResult.used_mcmc ? 'emcee MCMC posterior' : 'least-squares optimization'
      }`
    : null;
  const workflowSessionSource: WorkflowSessionSource =
    draftId && draftId.trim() !== ''
      ? { kind: 'draft', id: draftId }
      : seedRecordId !== null
        ? { kind: 'record-seed', id: seedRecordId }
        : { kind: 'live' };
  const workflowDefinition = createTransitWorkflowDefinition({
    targetId: target.id,
    targetPeriodDays: target.period_days,
    defaultAperture: DEFAULT_APERTURE,
  });
  const persistedTargetPosition =
    targetPositionOffset ?? preview?.target_position ?? result?.target_position ?? null;

  // ── Effects: cleanup, hydration ──────────────────────────────────────
  useEffect(() => {
    return () => {
      if (previewPollTimeoutRef.current) {
        clearTimeout(previewPollTimeoutRef.current);
        previewPollTimeoutRef.current = null;
      }
      const previewJobId = previewJobIdRef.current;
      if (previewJobId) {
        cancelTransitPreviewJob(previewJobId).catch(() => undefined);
      }
      framePreviewAbortRef.current?.abort();
      runAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (observationSelectionHydrated) return;
    const unsubscribe = useAppStore.persist.onFinishHydration(() => {
      setObservationSelectionHydrated(true);
    });
    return unsubscribe;
  }, [observationSelectionHydrated]);

  // Auto-select first observation
  useEffect(() => {
    if (!observationSelectionHydrated) return;
    if (selectedObservations.length === 0) {
      patch({ activeObservationId: null });
      return;
    }
    if (activeObservationId && selectedObservations.some((obs) => obs.id === activeObservationId)) {
      return;
    }
    patch({ activeObservationId: selectedObservations[0].id });
  }, [observationSelectionHydrated, selectedObservations, activeObservationId, patch]);

  // ── Workflow snapshot (persisted subset of state) ────────────────────
  const workflowSnapshot: PersistedTransitLabState = {
    selectedObservationIds: selectedIds,
    activeObservationId,
    cutoutSizePx,
    selectedFrameIndex,
    targetAperture,
    targetPositionOffset: persistedTargetPosition,
    comparisonStars,
    selectedStar,
    foldEnabled,
    foldPeriod,
    foldT0,
    foldT0Auto,
    fitLimbDarkening,
    fitDataSource,
    bjdWindowStart,
    bjdWindowEnd,
    fitWindowPhase,
    fitBaselineOrder,
    fitSigmaClipSigma,
    fitSigmaClipIterations,
    fitResult,
    result,
    recordAnswers,
    recordTitle,
    submittedRecord,
  };
  const workflowAvailability = workflowDefinition.getAvailability(workflowSnapshot);

  // ── Defaults ref (for reducer actions in callbacks) ──────────────────
  const currentDefaults = useMemo<TransitLabDefaults>(
    () => ({
      aperture: DEFAULT_APERTURE,
      recordAnswers: recordTemplate
        ? buildInitialRecordAnswers(recordTemplate)
        : stateDefaults.recordAnswers,
    }),
    [recordTemplate, stateDefaults.recordAnswers],
  );

  // ── Workflow controller ──────────────────────────────────────────────
  const {
    step,
    setStep,
    replaceStep,
    hydrated: workflowHydrated,
    hasRestoredSnapshot,
    clearPersistedWorkflow,
    draftSaveStatus,
    draftSavedAtLabel,
  } = useWorkflowController<TransitStep, PersistedTransitLabState, TransitStepAvailability>({
    scope: {
      workflowId: workflowDefinition.workflowId,
      subjectId: target.id,
      source: workflowSessionSource,
    },
    version: workflowDefinition.version,
    defaultStep: workflowDefinition.defaultStep,
    currentAvailability: workflowAvailability,
    emptyAvailability: workflowDefinition.getAvailability(null),
    parseStep: workflowDefinition.parseStep,
    clampStep: workflowDefinition.clampStep,
    snapshot: workflowSnapshot,
    restoreSnapshot: workflowDefinition.normalizeSnapshot,
    getSnapshotAvailability: workflowDefinition.getAvailability,
    draft: {
      draftId,
      title: recordTitle.trim() || `${target.name} draft`,
      userPresent: Boolean(user),
      seedRecordId,
      getRestoreReady: (session) =>
        seedRecordId === null ||
        session.hasRestoredSnapshot ||
        loadedRecordIdRef.current === seedRecordId,
      hasMeaningfulSnapshot: workflowDefinition.hasMeaningfulSnapshot,
    },
    applyRestoredSnapshot: (saved, restoredStep) => {
      // Side-effect resets (refs)
      loadedRecordIdRef.current = null;
      analysisConfigSignatureRef.current = null;
      observedActiveObservationRef.current = undefined;

      const resumeFromSelect = restoredStep === 'select';

      if (saved) {
        restoringSessionPreviewRef.current =
          !resumeFromSelect &&
          saved.activeObservationId !== null &&
          saved.cutoutSizePx !== null;
        if (saved.selectedObservationIds.length > 0) {
          selectAllObservations(saved.selectedObservationIds);
        }
      } else {
        restoringSessionPreviewRef.current = false;
      }

      dispatch({
        type: 'restore',
        snapshot: saved,
        resumeFromSelect,
        defaults: currentDefaults,
      });
    },
  });

  // ── Invalidation dispatcher ──────────────────────────────────────────
  const applyTransitInvalidation = useCallback(
    (action: TransitInvalidationAction) => {
      const resolution = reduceTransitInvalidation(
        { step, hasPhotometryResult: Boolean(result) },
        action,
      );

      // Side effects: cancel in-flight async work
      if (resolution.cancelPreviewJobs) {
        if (previewPollTimeoutRef.current) {
          clearTimeout(previewPollTimeoutRef.current);
          previewPollTimeoutRef.current = null;
        }
        const previewJobId = previewJobIdRef.current;
        previewJobIdRef.current = null;
        if (previewJobId) {
          cancelTransitPreviewJob(previewJobId).catch(() => undefined);
        }
        framePreviewAbortRef.current?.abort();
      }
      if (resolution.abortPhotometryRun) {
        runAbortRef.current?.abort();
      }
      if (resolution.clearPreviewRuntime) {
        restoringSessionPreviewRef.current = false;
      }

      // State transition (atomic)
      dispatch({
        type: 'apply-invalidation',
        resolution,
        defaults: currentDefaults,
      });

      // Step transition (managed by workflow controller)
      if (resolution.nextStep && step !== resolution.nextStep) {
        replaceStep(resolution.nextStep);
      }
    },
    [currentDefaults, replaceStep, result, step],
  );

  useEffect(() => {
    if (!workflowHydrated) return;
    if (!seedRecordId || !user) return;
    if (loadedRecordIdRef.current === seedRecordId) return;
    if (hasRestoredSnapshot) {
      loadedRecordIdRef.current = seedRecordId;
      return;
    }
    let cancelled = false;

    fetchMyRecordSubmission(seedRecordId)
      .then((record) => {
        if (cancelled || !record || record.target_id !== target.id) return;
        const payload = record.payload as {
          context?: {
            observation_id?: string;
            field_size_px?: number;
            target_position?: PixelCoordinate | null;
            target_aperture?: TransitApertureConfig | null;
            comparison_positions?: PixelCoordinate[];
            comparison_apertures?: TransitApertureConfig[];
            aperture?: ApertureParams;
            fit_controls?: {
              fit_data_source?: TransitFitDataSource;
              bjd_start?: number | null;
              bjd_end?: number | null;
              fit_window_phase?: number;
              baseline_order?: number;
              sigma_clip_sigma?: number;
              sigma_clip_iterations?: number;
              fit_limb_darkening?: boolean;
            };
            transit_fit?: {
              period?: number | null;
              t0?: number | null;
            };
          };
          answers?: Record<string, unknown>;
        };
        const recordObservationIds = Array.isArray(record.observation_ids)
          ? record.observation_ids
          : [];
        const observationIds =
          recordObservationIds.length > 0
            ? recordObservationIds
            : payload.context?.observation_id
              ? [payload.context.observation_id]
              : [];

        if (observationIds.length > 0) {
          selectAllObservations(observationIds);
        }
        restoringSessionPreviewRef.current =
          observationIds.length > 0 && (payload.context?.field_size_px ?? 35) !== null;
        patch({
          activeObservationId: observationIds.length > 0 ? observationIds[0] : null,
          cutoutSizePx: payload.context?.field_size_px ?? 35,
          pendingCutoutSizePx: payload.context?.field_size_px ?? 35,
          selectedFrameIndex: null,
          targetPositionOffset: payload.context?.target_position ?? null,
          comparisonStars:
            payload.context?.comparison_apertures?.map((item) => ({
              position: item.position,
              aperture: {
                apertureRadius: item.aperture_radius,
                innerAnnulus: item.inner_annulus,
                outerAnnulus: item.outer_annulus,
              },
            })) ??
            (payload.context?.comparison_positions ?? [])
              .slice(0, MAX_COMPARISON_STARS)
              .map((position) => ({
                position,
                aperture: payload.context?.aperture ?? { ...DEFAULT_APERTURE },
              })),
          fitWindowPhase: payload.context?.fit_controls?.fit_window_phase ?? 0.12,
          fitBaselineOrder: payload.context?.fit_controls?.baseline_order ?? 0,
          fitSigmaClipSigma: payload.context?.fit_controls?.sigma_clip_sigma ?? 0.0,
          fitSigmaClipIterations: payload.context?.fit_controls?.sigma_clip_iterations ?? 0,
          fitLimbDarkening: payload.context?.fit_controls?.fit_limb_darkening ?? false,
          fitDataSource: payload.context?.fit_controls?.fit_data_source ?? 'bjd_window',
          foldPeriod:
            typeof payload.context?.transit_fit?.period === 'number' &&
              Number.isFinite(payload.context.transit_fit.period) &&
              payload.context.transit_fit.period > 0
              ? payload.context.transit_fit.period
              : target.period_days ?? null,
          foldT0:
            typeof payload.context?.transit_fit?.t0 === 'number' &&
              Number.isFinite(payload.context.transit_fit.t0)
              ? payload.context.transit_fit.t0
              : 0,
          foldT0Auto:
            !(
              typeof payload.context?.transit_fit?.t0 === 'number' &&
              Number.isFinite(payload.context.transit_fit.t0)
            ),
          bjdWindowStart: payload.context?.fit_controls?.bjd_start ?? null,
          bjdWindowEnd: payload.context?.fit_controls?.bjd_end ?? null,
          targetAperture: payload.context?.target_aperture
            ? {
                apertureRadius: payload.context.target_aperture.aperture_radius,
                innerAnnulus: payload.context.target_aperture.inner_annulus,
                outerAnnulus: payload.context.target_aperture.outer_annulus,
              }
            : payload.context?.aperture ?? { ...DEFAULT_APERTURE },
          selectedStar: 'T',
          recordAnswers: payload.answers ?? buildInitialRecordAnswers(recordTemplate),
          recordTitle: record.title,
          seedRecordSummary: {
            submission_id: record.submission_id,
            title: record.title,
            created_at: record.created_at,
            export_path: '',
          },
          submittedRecord: null,
        });
        replaceStep('run');
        loadedRecordIdRef.current = seedRecordId;
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to restore saved record', error);
        patch({
          errorMessage:
            error instanceof Error ? error.message : 'Failed to reopen saved record.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    hasRestoredSnapshot,
    patch,
    seedRecordId,
    recordTemplate,
    replaceStep,
    selectAllObservations,
    target.id,
    user,
    workflowHydrated,
  ]);
  useEffect(() => {
    if (!workflowHydrated) return;
    if (observedActiveObservationRef.current === undefined) {
      observedActiveObservationRef.current = activeObservationId;
      return;
    }
    if (observedActiveObservationRef.current === activeObservationId) return;
    observedActiveObservationRef.current = activeObservationId;
    analysisConfigSignatureRef.current = null;
    applyTransitInvalidation({ type: 'observation-changed' });
  }, [activeObservationId, applyTransitInvalidation, workflowHydrated]);

  // Fetch cutout preview
  useEffect(() => {
    if (!workflowHydrated) return;
    const stepNeedsPreview =
      step === 'select' ||
      (step === 'run' &&
        preview === null &&
        result === null &&
        targetPositionOffset === null);
    const shouldDeferRestoredPreview =
      restoringSessionPreviewRef.current &&
      result !== null &&
      preview === null &&
      !stepNeedsPreview;

    const clearPreviewRuntime = { previewLoading: false, framePreviewLoading: false, previewProgress: 0, previewMessage: null } as const;

    if (shouldDeferRestoredPreview) {
      patch(clearPreviewRuntime);
      return;
    }

    if (!stepNeedsPreview) {
      patch(clearPreviewRuntime);
      return;
    }

    if (!activeObservationId || cutoutSizePx === null) {
      if (previewPollTimeoutRef.current) {
        clearTimeout(previewPollTimeoutRef.current);
        previewPollTimeoutRef.current = null;
      }
      const previewJobId = previewJobIdRef.current;
      previewJobIdRef.current = null;
      if (previewJobId) cancelTransitPreviewJob(previewJobId).catch(() => undefined);
      framePreviewAbortRef.current?.abort();
      patch({ preview: null, ...clearPreviewRuntime });
      return;
    }

    const currentFrameIndex = selectedFrameIndex ?? preview?.frame_index ?? null;
    const canReuse =
      preview !== null &&
      preview.observation_id === activeObservationId &&
      preview.cutout_size_px >= cutoutSizePx &&
      preview.frame_index === currentFrameIndex;

    if (canReuse) {
      patch({
        previewLoading: false,
        previewProgress: 1,
        previewMessage:
          currentFrameIndex !== null
            ? `Using loaded frame ${currentFrameIndex + 1} from ${preview.cutout_size_px}px cutout.`
            : `Using loaded ${preview.cutout_size_px}px cutout.`,
      });
      return;
    }

    const requestSizePx =
      preview !== null &&
      preview.observation_id === activeObservationId &&
      preview.cutout_size_px >= cutoutSizePx
        ? preview.cutout_size_px
        : cutoutSizePx;

    const canRefreshFrameOnly =
      preview !== null &&
      preview.observation_id === activeObservationId &&
      preview.cutout_size_px >= cutoutSizePx;
    const preserveRestoredState = restoringSessionPreviewRef.current;

    patch({ errorMessage: null });

    if (previewPollTimeoutRef.current) {
      clearTimeout(previewPollTimeoutRef.current);
      previewPollTimeoutRef.current = null;
    }
    const previousJobId = previewJobIdRef.current;
    previewJobIdRef.current = null;
    if (previousJobId) cancelTransitPreviewJob(previousJobId).catch(() => undefined);
    framePreviewAbortRef.current?.abort();

    if (canRefreshFrameOnly) {
      patch({
        framePreviewLoading: true,
        previewMessage:
          currentFrameIndex !== null
            ? `Loading frame ${currentFrameIndex + 1}...`
            : 'Loading selected frame...',
      });
      const controller = new AbortController();
      framePreviewAbortRef.current = controller;
      fetchTransitCutoutPreview(
        target.id,
        activeObservationId,
        requestSizePx,
        currentFrameIndex,
        controller.signal
      )
        .then((response) => {
          if (framePreviewAbortRef.current !== controller) return;
          restoringSessionPreviewRef.current = false;
          patch({
            preview: response,
            previewMessage:
              response.frame_index !== null
                ? `Viewing frame ${response.frame_index + 1} / ${response.frame_count}.`
                : 'Preview ready.',
            ...(selectedFrameIndex === null && response.frame_index !== null
              ? { selectedFrameIndex: response.frame_index }
              : {}),
          });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.error('Failed to refresh transit preview frame', error);
          patch({
            errorMessage:
              error instanceof Error ? error.message : 'Failed to load selected frame.',
          });
        })
        .finally(() => {
          patch({ framePreviewLoading: false });
          if (framePreviewAbortRef.current === controller) {
            framePreviewAbortRef.current = null;
          }
        });
      return;
    }

    patch({
      previewLoading: true,
      framePreviewLoading: false,
      previewProgress: 0,
      previewMessage:
        currentFrameIndex !== null
          ? `Loading frame ${currentFrameIndex + 1}...`
          : 'Queued preview request.',
      preview: null,
      ...(preserveRestoredState
        ? {}
        : {
            result: null,
            fitResult: null,
            progress: 0,
            runProgressEvent: null,
            comparisonStars: [],
            targetPositionOffset: null,
            selectedStar: 'T' as const,
          }),
    });
    if (!preserveRestoredState) {
      replaceStep('select');
    }

    const loadPreviewInlineFallback = async (message: string) => {
      try {
        patch({ previewMessage: message });
        const response = await fetchTransitCutoutPreview(
          target.id,
          activeObservationId,
          requestSizePx,
          currentFrameIndex
        );
        if (previewJobIdRef.current !== null) {
          return;
        }
        restoringSessionPreviewRef.current = false;
        patch({
          preview: response,
          previewLoading: false,
          previewProgress: 1,
          previewMessage:
            response.frame_index !== null
              ? `Viewing frame ${response.frame_index + 1} / ${response.frame_count}.`
              : 'Preview ready.',
          ...(selectedFrameIndex === null && response.frame_index !== null
            ? { selectedFrameIndex: response.frame_index }
            : {}),
        });
      } catch (fallbackError) {
        console.error('Failed to recover transit preview inline', fallbackError);
        restoringSessionPreviewRef.current = false;
        patch({
          errorMessage:
            fallbackError instanceof Error
              ? fallbackError.message
              : 'Failed to recover TESS cutout preview.',
          preview: null,
          previewLoading: false,
        });
      }
    };

    const pollPreviewJob = async (jobId: string) => {
      try {
        const job = await fetchTransitPreviewJob(jobId);
        if (previewJobIdRef.current !== jobId) return;

        patch({ previewProgress: job.progress, previewMessage: job.message });

        if (job.status === 'completed' && job.result) {
          restoringSessionPreviewRef.current = false;
          previewPollTimeoutRef.current = null;
          previewJobIdRef.current = null;
          patch({
            preview: job.result,
            previewLoading: false,
            previewProgress: 1,
            ...(selectedFrameIndex === null && job.result.frame_index !== null
              ? { selectedFrameIndex: job.result.frame_index }
              : {}),
          });
          return;
        }

        if (job.status === 'failed') {
          restoringSessionPreviewRef.current = false;
          previewPollTimeoutRef.current = null;
          previewJobIdRef.current = null;
          patch({
            preview: null,
            previewLoading: false,
            errorMessage: job.error ?? 'Failed to load TESS cutout preview.',
          });
          return;
        }

        if (job.status === 'cancelled') {
          restoringSessionPreviewRef.current = false;
          previewPollTimeoutRef.current = null;
          previewJobIdRef.current = null;
          patch({
            preview: null,
            previewLoading: false,
            errorMessage: 'Transit preview loading stopped.',
          });
          return;
        }

        previewPollTimeoutRef.current = setTimeout(() => {
          void pollPreviewJob(jobId);
        }, 400);
      } catch (error) {
        if (previewJobIdRef.current !== jobId) return;
        const isMissingPreviewJob =
          error instanceof Error &&
          /preview job not found|GET \/transit\/preview-jobs\/.* failed: 404/i.test(error.message);
        previewPollTimeoutRef.current = null;
        previewJobIdRef.current = null;
        if (isMissingPreviewJob) {
          void loadPreviewInlineFallback('Preview state expired. Recovering cutout directly...');
          return;
        }
        console.error('Failed to poll transit preview job', error);
        restoringSessionPreviewRef.current = false;
        patch({
          errorMessage:
            error instanceof Error ? error.message : 'Failed to monitor TESS cutout preview.',
          preview: null,
          previewLoading: false,
        });
      }
    };

    createTransitPreviewJob(target.id, activeObservationId, requestSizePx, currentFrameIndex)
      .then((job) => {
        previewJobIdRef.current = job.job_id;
        patch({ previewProgress: job.progress, previewMessage: job.message });
        void pollPreviewJob(job.job_id);
      })
      .catch((error) => {
        console.error('Failed to start transit preview job', error);
        previewJobIdRef.current = null;
        void loadPreviewInlineFallback('Preview job failed. Loading cutout directly...');
      });
  }, [
    activeObservationId,
    cutoutSizePx,
    preview,
    result,
    selectedFrameIndex,
    step,
    target.id,
    targetPositionOffset,
    workflowHydrated,
  ]);

  useEffect(() => {
    if (!result) {
      patch({ submittedRecord: null });
      return;
    }
    if (!recordTitle) {
      const sectorLabel = result.sector ? `Sector ${result.sector}` : 'Transit run';
      patch({ recordTitle: `${target.name} ${sectorLabel}` });
    }
  }, [result, target.name, recordTitle]);

  // Auto-enable fold when result arrives and target has a known period
  useEffect(() => {
    if (result && target.period_days) {
      patch({
        ...(foldPeriod === null ? { foldPeriod: target.period_days } : {}),
        ...(!foldEnabled ? { foldEnabled: true } : {}),
      });
    }
  }, [result, target.period_days]);

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

  useEffect(() => {
    if (recordLoading || recordTemplateRequestedRef.current) return;
    let cancelled = false;
    recordTemplateRequestedRef.current = true;
    patch({ recordLoading: true });
    fetchRecordTemplate('transit_record')
      .then((template) => {
        if (cancelled) return;
        setRecordTemplate(template);
        dispatch({
          type: 'update',
          updater: (s) => ({
            recordAnswers:
              Object.keys(s.recordAnswers).length > 0
                ? s.recordAnswers
                : buildInitialRecordAnswers(template),
          }),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load record template', error);
        patch({
          errorMessage:
            error instanceof Error ? error.message : 'Failed to load record form.',
        });
      })
      .finally(() => {
        if (!cancelled) patch({ recordLoading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [recordTemplate, recordLoading]);

  // Invalidate result only after hydration when the analysis inputs truly change
  useEffect(() => {
    if (!workflowHydrated) return;
    const nextSignature = JSON.stringify({
      activeObservationId,
      cutoutSizePx,
      targetAperture,
      targetPositionOffset,
      comparisonStars,
    });
    const previousSignature = analysisConfigSignatureRef.current;
    analysisConfigSignatureRef.current = nextSignature;

    if (suppressAnalysisInvalidationRef.current) {
      suppressAnalysisInvalidationRef.current = false;
      return;
    }

    if (previousSignature === null || previousSignature === nextSignature) return;
    applyTransitInvalidation({ type: 'analysis-config-changed' });
  }, [
    activeObservationId,
    applyTransitInvalidation,
    comparisonStars,
    cutoutSizePx,
    targetAperture,
    targetPositionOffset,
    workflowHydrated,
  ]);

  useEffect(() => {
    if (!result || comparisonDiagnostics.length === 0) {
      patch({ selectedComparisonDiagnostic: null, qcIncludedComparisonLabels: [] });
      return;
    }
    const bestDiagnostic = [...comparisonDiagnostics].sort(
      (left, right) => left.differential_rms - right.differential_rms
    )[0];
    patch({
      selectedComparisonDiagnostic: bestDiagnostic.label,
      qcIncludedComparisonLabels: comparisonDiagnostics.map((diagnostic) => diagnostic.label),
    });
  }, [result]);

  // Effective target position (original or user-dragged)
  const effectiveTargetPosition: PixelCoordinate | null =
    targetPositionOffset ?? preview?.target_position ?? result?.target_position ?? null;

  // Build star overlay array for the cutout viewer
  const buildStarOverlays = (): StarOverlay[] => {
    if (!preview || !effectiveTargetPosition) return [];
    const overlays: StarOverlay[] = [
      {
        label: 'T',
        position: effectiveTargetPosition,
        aperture: targetAperture,
        type: 'target',
        selected: selectedStar === 'T',
      },
    ];
    comparisonStars.forEach((cs, i) => {
      const key = `C${i + 1}` as StarKey;
      overlays.push({
        label: key,
        position: cs.position,
        aperture: cs.aperture,
        type: 'comparison',
        selected: selectedStar === key,
      });
    });
    return overlays;
  };

  const starOverlays = buildStarOverlays();
  const selectedComparisonDiagnosticData: TransitComparisonDiagnostic | null =
    comparisonDiagnostics.find(
      (diagnostic) => diagnostic.label === selectedComparisonDiagnostic
    ) ?? comparisonDiagnostics[0] ?? null;
  const qcIncludedDiagnostics = comparisonDiagnostics.filter((diagnostic) =>
    qcIncludedComparisonLabels.includes(diagnostic.label)
  );
  const persistedComparisonStars: ComparisonStar[] = comparisonDiagnostics.map((diagnostic) => ({
    position: diagnostic.position,
    aperture: {
      apertureRadius: diagnostic.aperture_radius,
      innerAnnulus: diagnostic.inner_annulus,
      outerAnnulus: diagnostic.outer_annulus,
    },
  }));
  const qcBestDiagnostic: TransitComparisonDiagnostic | null =
    [...comparisonDiagnostics].sort(
      (left, right) => left.differential_rms - right.differential_rms
    )[0] ?? null;
  const qcSelectionDirty =
    comparisonDiagnostics.length > 0 &&
    comparisonDiagnostics.some(
      (diagnostic) => !qcIncludedComparisonLabels.includes(diagnostic.label)
    );
  const qcExcludedCount = comparisonDiagnostics.length - qcIncludedDiagnostics.length;
  const qcCanApply =
    Boolean(result) && qcIncludedDiagnostics.length > 0 && qcSelectionDirty && !running;
  const targetComparisonCollisionPosition = effectiveTargetPosition;
  const recommendedComparisonStars = (preview?.tic_stars ?? [])
    .filter((star) => star.recommended)
    .filter(
      (star, index, stars) =>
        stars.findIndex((candidate) => arePixelPositionsNear(candidate.pixel, star.pixel)) ===
        index
    );

  // Get the aperture for the currently selected star
  const getSelectedAperture = (): ApertureParams => {
    if (selectedStar === 'T') return targetAperture;
    const idx = parseInt(selectedStar.slice(1)) - 1;
    return comparisonStars[idx]?.aperture ?? DEFAULT_APERTURE;
  };

  const updateSelectedAperture = (apertureChanges: Partial<ApertureParams>) => {
    if (selectedStar === 'T') {
      dispatch({
        type: 'update',
        updater: (s) => ({ targetAperture: { ...s.targetAperture, ...apertureChanges } }),
      });
    } else {
      const idx = parseInt(selectedStar.slice(1)) - 1;
      dispatch({
        type: 'update',
        updater: (s) => ({
          comparisonStars: s.comparisonStars.map((cs, i) =>
            i === idx ? { ...cs, aperture: { ...cs.aperture, ...apertureChanges } } : cs
          ),
        }),
      });
    }
  };

  // Step state
  const stepOrder: TransitStep[] = [
    'select',
    'run',
    'comparisonqc',
    'lightcurve',
    'transitfit',
    'record',
  ];
  const currentStepIndex = stepOrder.indexOf(step);

  const getStepState = (stepId: TransitStep): StepState => {
    const targetIndex = stepOrder.indexOf(stepId);
    if (stepId === 'select') {
      return step === 'select' ? 'accessible' : 'completed';
    }
    if (stepId === 'run') {
      if (result) {
        if (currentStepIndex > targetIndex) return 'completed';
        if (step === 'run') return 'accessible';
      }
      if (!preview || comparisonStars.length === 0) return 'locked';
      if (currentStepIndex > targetIndex) return 'completed';
      if (step === 'run') return 'accessible';
      return 'locked';
    }
    if (stepId === 'comparisonqc') {
      if (step === 'comparisonqc' && running) return 'accessible';
      if (!result) return 'locked';
      if (currentStepIndex > targetIndex) return 'completed';
      if (step === 'comparisonqc') return 'accessible';
      return 'locked';
    }
    if (stepId === 'lightcurve') {
      if (!result) return 'locked';
      if (currentStepIndex > targetIndex) return 'completed';
      if (step === 'lightcurve') return 'accessible';
      return 'locked';
    }
    if (stepId === 'transitfit') {
      if (!result) return 'locked';
      if (currentStepIndex > targetIndex) return 'completed';
      if (step === 'transitfit') return 'accessible';
      return 'locked';
    }
    if (stepId === 'record') {
      if (!result) return 'locked';
      if (step === 'record') return 'accessible';
      return 'locked';
    }
    return 'locked';
  };

  const handleStepClick = (stepId: TransitStep) => {
    if (getStepState(stepId) === 'locked') return;
    setStep(stepId);
  };

  const handleAddComparison = (position: PixelCoordinate) => {
    dispatch({
      type: 'update',
      updater: (s) => {
        if (s.comparisonStars.length >= MAX_COMPARISON_STARS) return {};
        if (
          targetComparisonCollisionPosition &&
          arePixelPositionsNear(position, targetComparisonCollisionPosition)
        ) {
          return {};
        }
        if (s.comparisonStars.some((star) => arePixelPositionsNear(star.position, position))) {
          return {};
        }
        const next = [...s.comparisonStars, { position, aperture: { ...DEFAULT_APERTURE } }];
        return { comparisonStars: next, selectedStar: `C${next.length}` as StarKey };
      },
    });
  };

  const handleSelectStarFromCutout = (label: string) => {
    if (label === 'T' || /^C\d+$/.test(label)) {
      patch({ selectedStar: label as StarKey });
    }
  };

  const handleMoveStar = (label: string, position: PixelCoordinate) => {
    if (label === 'T') {
      patch({ targetPositionOffset: position });
      return;
    }
    const idx = parseInt(label.slice(1)) - 1;
    if (idx < 0 || idx >= comparisonStars.length) return;
    dispatch({
      type: 'update',
      updater: (s) => ({
        comparisonStars: s.comparisonStars.map((cs, i) => (i === idx ? { ...cs, position } : cs)),
      }),
    });
  };

  const handleRemoveComparison = (index: number) => {
    dispatch({
      type: 'update',
      updater: (s) => ({
        comparisonStars: s.comparisonStars.filter((_, i) => i !== index),
        selectedStar: 'T' as StarKey,
      }),
    });
  };

  const handleFrameChange = (frameIndex: number) => {
    if (!preview) return;
    const clamped = Math.max(0, Math.min(preview.frame_count - 1, frameIndex));
    patch({ selectedFrameIndex: clamped });
  };

  const handleRecordAnswerChange = (questionId: string, value: unknown) => {
    dispatch({
      type: 'update',
      updater: (s) => ({
        submittedRecord: null,
        recordAnswers: { ...s.recordAnswers, [questionId]: value },
      }),
    });
  };

  const handleSubmitRecord = async () => {
    if (!result) {
      patch({ errorMessage: 'No photometry result is available to save.' });
      return;
    }

    const submissionObservationId =
      result.observation_id?.trim() || activeObservationId || preview?.observation_id || '';
    if (!submissionObservationId) {
      patch({ errorMessage: 'Missing observation context for this analysis record.' });
      return;
    }

    const submissionSector = preview?.sector ?? activeObservation?.sector ?? result.sector;
    const submissionFieldSizePx =
      preview?.cutout_size_px ?? cutoutSizePx ?? pendingCutoutSizePx ?? 35;
    const submissionTargetPosition =
      effectiveTargetPosition ?? targetPositionOffset ?? result.target_position ?? null;
    const submissionObservationContext =
      submissionSector !== null && submissionSector !== undefined
        ? {
            sector: submissionSector,
            camera: preview?.camera ?? activeObservation?.camera ?? null,
            ccd: preview?.ccd ?? activeObservation?.ccd ?? null,
          }
        : null;

    patch({ recordSubmitting: true, errorMessage: null });
    try {
      const response = await submitRecordTemplate('transit_record', {
        workflow: 'transit_lab',
        target_id: target.id,
        observation_ids: [submissionObservationId],
        title: recordTitle.trim() || `${target.name} Sector ${submissionSector}`,
        context: {
          target_name: target.name,
          sector: submissionSector,
          observation_id: submissionObservationId,
          field_size_px: submissionFieldSizePx,
          frame_count: result.frame_count,
          target_context: {
            ra: target.ra,
            dec: target.dec,
            period_days: target.period_days,
          },
          observation_context: submissionObservationContext,
          target_position: submissionTargetPosition,
          target_aperture: submissionTargetPosition
            ? toTransitApertureConfig(submissionTargetPosition, targetAperture)
            : null,
          comparison_positions: persistedComparisonStars.map((star) => star.position),
          comparison_apertures: persistedComparisonStars.map((star) =>
            toTransitApertureConfig(star.position, star.aperture)
          ),
          aperture: targetAperture,
          transit_fit: fitResult ? {
            rp_rs: fitResult.fitted_params.rp_rs,
            rp_rs_err: fitResult.fitted_params.rp_rs_err,
            a_rs: fitResult.fitted_params.a_rs,
            a_rs_err: fitResult.fitted_params.a_rs_err,
            inclination: fitResult.fitted_params.inclination,
            inclination_err: fitResult.fitted_params.inclination_err,
            u1: fitResult.fitted_params.u1,
            u2: fitResult.fitted_params.u2,
            chi_squared_red: fitResult.fitted_params.reduced_chi_squared,
            period: fitResult.period,
            t0: fitResult.t0,
            used_batman: fitResult.used_batman,
            used_mcmc: fitResult.used_mcmc,
            preprocessing: fitResult.preprocessing,
          } : null,
          fit_controls: {
            fit_data_source: fitDataSource,
            bjd_start: resolvedBjdWindow?.start ?? null,
            bjd_end: resolvedBjdWindow?.end ?? null,
            fit_window_phase: requestedFitWindowPhase,
            baseline_order: 0,
            sigma_clip_sigma: 0,
            sigma_clip_iterations: 0,
            fit_limb_darkening: false,
          },
        },
        answers: recordAnswers,
      });
      patch({ submittedRecord: response });
    } catch (error) {
      console.error('Failed to submit analysis record', error);
      patch({
        errorMessage:
          error instanceof Error ? error.message : 'Failed to submit analysis record.',
      });
    } finally {
      patch({ recordSubmitting: false });
    }
  };

  const runTransitPhotometryForComparisons = async (
    stars: ComparisonStar[],
    nextStepAfterSuccess: TransitStep | null = null
  ): Promise<TransitPhotometryResponse | null> => {
    const photometryTargetPosition = effectiveTargetPosition ?? result?.target_position ?? null;

    if (!activeObservationId || cutoutSizePx === null || !photometryTargetPosition) {
      patch({ errorMessage: 'Missing cutout setup for transit photometry.' });
      return null;
    }

    const observationContext =
      preview !== null
        ? {
            sector: preview.sector,
            camera: preview.camera,
            ccd: preview.ccd,
          }
        : activeObservation?.sector !== null && activeObservation?.sector !== undefined
          ? {
              sector: activeObservation.sector,
              camera: activeObservation.camera ?? null,
              ccd: activeObservation.ccd ?? null,
            }
          : undefined;

    patch({
      running: true,
      errorMessage: null,
      progress: 0,
      runProgressEvent: {
        type: 'progress',
        pct: 0,
        message: 'Starting transit photometry...',
      },
    });

    runAbortRef.current?.abort();
    const controller = new AbortController();
    runAbortRef.current = controller;

    try {
      const response = await runTransitPhotometryStreaming(
        {
          target_id: target.id,
          observation_id: activeObservationId,
          cutout_size_px: cutoutSizePx,
          preview_dataset_token:
            preview?.observation_id === activeObservationId &&
            preview.cutout_size_px === cutoutSizePx
              ? preview.dataset_token ?? null
              : null,
          target_context: {
            ra: target.ra,
            dec: target.dec,
            period_days: target.period_days,
          },
          observation_context: observationContext,
          target_position: photometryTargetPosition,
          comparison_positions: stars.map((cs) => cs.position),
          aperture_radius: targetAperture.apertureRadius,
          inner_annulus: targetAperture.innerAnnulus,
          outer_annulus: targetAperture.outerAnnulus,
          target_aperture: toTransitApertureConfig(
            photometryTargetPosition,
            targetAperture
          ),
          comparison_apertures: stars.map((cs) =>
            toTransitApertureConfig(cs.position, cs.aperture)
          ),
        },
        (event) => {
          patch({
            runProgressEvent: event,
            progress: Math.max(0, Math.min(100, Math.round((event.pct ?? 0) * 100))),
          });
        },
        controller.signal
      );
      patch({
        progress: 100,
        runProgressEvent: {
          type: 'progress',
          pct: 1,
          message: 'Transit photometry complete.',
        },
        result: response,
      });
      if (nextStepAfterSuccess) {
        replaceStep(nextStepAfterSuccess);
      }
      return response;
    } catch (error) {
      patch({ progress: 0, runProgressEvent: null });
      if (error instanceof DOMException && error.name === 'AbortError') {
        patch({ errorMessage: 'Photometry stopped.' });
        return null;
      }
      console.error('Transit photometry run failed', error);
      patch({
        errorMessage:
          error instanceof Error ? error.message : 'Transit photometry failed.',
      });
      return null;
    } finally {
      patch({ running: false });
      if (runAbortRef.current === controller) runAbortRef.current = null;
    }
  };

  const handleRunPhotometry = async () => {
    await runTransitPhotometryForComparisons(comparisonStars);
  };

  const handleToggleQcComparison = (label: string) => {
    dispatch({
      type: 'update',
      updater: (s) => {
        if (s.qcIncludedComparisonLabels.includes(label)) {
          return { qcIncludedComparisonLabels: s.qcIncludedComparisonLabels.filter((item) => item !== label) };
        }
        return {
          qcIncludedComparisonLabels: [...s.qcIncludedComparisonLabels, label].sort((left, right) => {
            const leftIndex = parseInt(left.slice(1), 10);
            const rightIndex = parseInt(right.slice(1), 10);
            return leftIndex - rightIndex;
          }),
        };
      },
    });
  };

  const handleSelectAllQcComparisons = () => {
    patch({ qcIncludedComparisonLabels: comparisonDiagnostics.map((diagnostic) => diagnostic.label) });
  };

  const handleApplyComparisonQc = async () => {
    const retainedComparisons = comparisonStars.filter((_, index) =>
      qcIncludedComparisonLabels.includes(`C${index + 1}`)
    );
    if (retainedComparisons.length === 0) {
      patch({ errorMessage: 'Keep at least one comparison star before re-running photometry.' });
      return;
    }

    patch({ progress: 0, runProgressEvent: null });
    const response = await runTransitPhotometryForComparisons(retainedComparisons, 'comparisonqc');
    if (response) {
      suppressAnalysisInvalidationRef.current = true;
      patch({ fitResult: null, comparisonStars: retainedComparisons, selectedStar: 'T' });
    }
  };

  const handleStop = () => {
    runAbortRef.current?.abort();
    patch({ running: false, progress: 0, runProgressEvent: null, errorMessage: 'Photometry stopped.' });
  };

  const handleReset = () => {
    clearPersistedWorkflow();
    loadedRecordIdRef.current = null;
    analysisConfigSignatureRef.current = null;
    observedActiveObservationRef.current = undefined;
    applyTransitInvalidation({ type: 'hard-reset' });
    patch({
      foldEnabled: false,
      foldPeriod: null,
      foldT0: 0,
      foldT0Auto: true,
      fitLimbDarkening: false,
      fitDataSource: 'bjd_window',
      fitWindowPhase: 0.12,
      fitBaselineOrder: 0,
      fitSigmaClipSigma: 0.0,
      fitSigmaClipIterations: 0,
    });
  };

  // Navigation
  const canGoNext =
    (step === 'select' && Boolean(preview) && comparisonStars.length > 0) ||
    (step === 'run' && Boolean(result)) ||
    (step === 'comparisonqc' && Boolean(result) && !qcSelectionDirty) ||
    (step === 'lightcurve' && Boolean(result)) ||
    (step === 'transitfit' && Boolean(result));
  const canGoPrevious = currentStepIndex > 0;

  const handleNext = () => {
    if (!canGoNext) return;
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < stepOrder.length) setStep(stepOrder[nextIndex]);
  };
  const handlePrevious = () => {
    if (!canGoPrevious) return;
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) setStep(stepOrder[prevIndex]);
  };

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
    const roiTimes = roiPoints.map((point) => point.hjd).filter(Number.isFinite);
    const roiFluxes = roiPoints.map((point) => point.magnitude).filter(Number.isFinite);
    const roiErrors = roiPoints.map((point) => point.mag_error).filter(Number.isFinite);

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
          patch({ fitProgress: event });
          dispatch({
            type: 'append-fit-debug-log',
            lines: [
              `${event.stage} pct=${((event.pct ?? 0) * 100).toFixed(0)}${event.step && event.total ? ` step=${event.step}/${event.total}` : ''}`,
            ],
          });
        },
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
              (value: number, index: number) =>
                value - normalizedResponse.residuals[index]
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
        lines: [
          `error ${error instanceof Error ? error.message : 'Transit model fitting failed.'}`,
        ],
      });
      patch({
        errorMessage:
          error instanceof Error ? error.message : 'Transit model fitting failed.',
      });
    } finally {
      patch({ fitting: false, fitProgress: null });
    }
  };

  const activeObservation =
    selectedObservations.find((obs) => obs.id === activeObservationId) ?? null;
  const cutoutArcmin =
    cutoutSizePx !== null ? ((cutoutSizePx * 21) / 60).toFixed(1) : null;
  const loadedCutoutArcmin = preview
    ? ((preview.cutout_size_px * 21) / 60).toFixed(1)
    : cutoutArcmin ?? '0.0';
  const currentFrameIndex = selectedFrameIndex ?? preview?.frame_index ?? null;
  const canRenderRestoreStateWithoutPreview =
    restoringSessionPreviewRef.current &&
    preview === null &&
    result !== null &&
    (
      step === 'lightcurve' ||
      step === 'transitfit' ||
      step === 'record'
    );
  const showBlockingPreviewLoad =
    previewLoading && preview === null && !canRenderRestoreStateWithoutPreview;
  const showRunProgress = running || (!result && progress > 0);
  const fitReferencePeriod =
    foldPeriod ?? target.period_days ?? result?.light_curve.period_days ?? null;
  const lightCurveTimeBounds = result
    ? result.light_curve.points.reduce(
        (acc, point) => {
          if (!Number.isFinite(point.hjd)) return acc;
          return {
            min: Math.min(acc.min, point.hjd),
            max: Math.max(acc.max, point.hjd),
          };
        },
        { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
      )
    : null;
  const resolvedBjdWindow =
    bjdWindowStart !== null && bjdWindowEnd !== null
      ? {
          start: Math.min(bjdWindowStart, bjdWindowEnd),
          end: Math.max(bjdWindowStart, bjdWindowEnd),
        }
      : null;
  const roiMidpoint =
    resolvedBjdWindow !== null ? 0.5 * (resolvedBjdWindow.start + resolvedBjdWindow.end) : 0;
  const hasResolvedBjdWindow =
    resolvedBjdWindow !== null && resolvedBjdWindow.end > resolvedBjdWindow.start;
  const roiPoints =
    result && hasResolvedBjdWindow
      ? result.light_curve.points.filter(
          (point) =>
            Number.isFinite(point.hjd) &&
            point.hjd >= resolvedBjdWindow.start &&
            point.hjd <= resolvedBjdWindow.end
        )
      : [];
  const roiLightCurve = buildBjdLightCurve(
    roiPoints,
    result?.light_curve.target_id ?? target.id,
    result?.light_curve.period_days ?? fitReferencePeriod
  );
  const activeFitPreviewResult =
    fitResult && fitResult.preprocessing.fit_mode === fitDataSource ? fitResult : null;
  const estimatedPhaseFoldT0 = estimatePhaseFoldReferenceT0(
    roiPoints,
    fitReferencePeriod,
    roiMidpoint
  );
  const phaseFoldReferenceT0 =
    !foldT0Auto && Number.isFinite(foldT0) && foldT0 !== 0
      ? foldT0
      : activeFitPreviewResult?.preprocessing.fit_mode === 'phase_fold'
        ? activeFitPreviewResult.reference_t0
        : estimatedPhaseFoldT0;
  const requestedFitWindowPhase =
    fitDataSource === 'phase_fold'
      ? fitWindowPhase
      : fitReferencePeriod && hasResolvedBjdWindow
        ? Math.min(
            Math.max(
              (resolvedBjdWindow.end - resolvedBjdWindow.start) / fitReferencePeriod / 2,
              0.04,
            ),
            0.35,
          )
        : fitWindowPhase;
  const fitDisplayLightCurve =
    activeFitPreviewResult
      ? buildLightCurveFromFitResult(activeFitPreviewResult, fitDataSource)
      : fitDataSource === 'phase_fold' && fitReferencePeriod
        ? buildPhaseFoldedLightCurve(
            roiPoints,
            result?.light_curve.target_id ?? target.id,
            fitReferencePeriod,
            phaseFoldReferenceT0,
            requestedFitWindowPhase
          )
        : roiLightCurve;
  const fitWindowPointCount = roiPoints.length;
  const canFitWithBjdWindow =
    hasResolvedBjdWindow && fitWindowPointCount >= 20;
  const canPreviewTransitFit =
    fitDisplayLightCurve !== null && fitDisplayLightCurve.points.length > 0;
  const canRunTransitFit =
    Boolean(canFitWithBjdWindow && fitReferencePeriod);
  const fitSourceLabel =
    fitDataSource === 'phase_fold' ? 'Phase Fold' : 'BJD Window';
  const fitPreviewOverlay =
    activeFitPreviewResult
      ? buildFitOverlayCurve(activeFitPreviewResult, fitDataSource)
      : null;
  const fitPreviewResiduals =
    activeFitPreviewResult
      ? buildFitResidualCurve(activeFitPreviewResult, fitDataSource)
      : null;
  const fitResultModelFlux =
    fitResult && fitResult.data_flux.length === fitResult.residuals.length
      ? fitResult.data_flux.map((value, index) => value - fitResult.residuals[index])
      : [];
  const fitResidualRms =
    fitResult && fitResult.residuals.length > 0
      ? Math.sqrt(
          fitResult.residuals.reduce((sum, value) => sum + value * value, 0) /
            fitResult.residuals.length
        )
      : null;

  const selectedAperture = getSelectedAperture();
  const draftStatusLabel =
    draftSaveStatus === 'saving'
      ? 'Saving draft...'
      : draftSaveStatus === 'saved'
        ? draftSavedAtLabel
          ? `Saved ${draftSavedAtLabel}`
          : 'Saved'
        : draftSaveStatus === 'error'
          ? 'Draft save failed'
          : 'Draft session';

  return (
    <div className="lab-content transit-lab">
      {/* ===== SIDEBAR — changes per step ===== */}
      <div className="lab-sidebar">
        {draftId && (
          <div className={`transit-callout transit-draft-status ${draftSaveStatus}`}>
            <div className="transit-draft-status-head">
              <strong>Draft Session</strong>
              <span>{draftStatusLabel}</span>
            </div>
            <div className="transit-draft-status-meta">
              <span>{draftId}</span>
              {seedRecordSummary && <span>Seed #{seedRecordSummary.submission_id}</span>}
            </div>
          </div>
        )}
        {/* Sector list — always visible */}
        <div className="thumbnail-strip">
          <h4>Selected Sectors ({selectedObservations.length})</h4>
          <div className="transit-sector-list">
            {selectedObservations.map((observation) => {
              const isActive = observation.id === activeObservationId;
              const frameCount =
                isActive && preview
                  ? preview.frame_count
                  : observation.frame_count ?? null;
              return (
                <button
                  key={observation.id}
                  className={`transit-sector-button ${isActive ? 'active' : ''}`}
                  onClick={() => patch({ activeObservationId: observation.id })}
                >
                  <strong>{observation.display_label ?? `Sector ${observation.sector}`}</strong>
                  <span>
                    {observation.display_subtitle ?? 'TESS cutout'}
                    {frameCount !== null && ` · ${frameCount.toLocaleString()} frames`}
                  </span>
                </button>
              );
            })}
          </div>
          {selectedObservations.length === 0 && (
            <p className="hint">Select one or more TESS sectors on the target detail page.</p>
          )}
        </div>

        {/* Step 1 sidebar: Star list + per-star aperture */}
        {step === 'select' && (
          <>
            <div className="transit-controls-card">
              <h4>Stars</h4>
              <p className="hint">
                Click a star below to adjust its aperture. Click the cutout image
                to add comparison stars (up to {MAX_COMPARISON_STARS}).
              </p>
              <div className="transit-star-list">
                {/* Target star */}
                <button
                  className={`transit-star-row ${selectedStar === 'T' ? 'selected' : ''}`}
                  onClick={() => patch({ selectedStar: 'T' })}
                >
                  <span className="transit-star-badge target">T</span>
                  <div className="transit-star-info">
                    <strong>Target</strong>
                    {effectiveTargetPosition && (
                      <span>
                        ({effectiveTargetPosition.x.toFixed(1)},{' '}
                        {effectiveTargetPosition.y.toFixed(1)})
                      </span>
                    )}
                  </div>
                  <span className="transit-star-aperture-tag">
                    r={targetAperture.apertureRadius.toFixed(1)}
                  </span>
                </button>

                {/* Comparison stars */}
                {comparisonStars.map((cs, index) => {
                  const key = `C${index + 1}` as StarKey;
                  return (
                    <button
                      key={key}
                      className={`transit-star-row ${selectedStar === key ? 'selected' : ''}`}
                      onClick={() => patch({ selectedStar: key })}
                    >
                      <span className="transit-star-badge comparison">{key}</span>
                      <div className="transit-star-info">
                        <strong>Comparison {index + 1}</strong>
                        <span>
                          ({cs.position.x.toFixed(1)}, {cs.position.y.toFixed(1)})
                        </span>
                      </div>
                      <span className="transit-star-aperture-tag">
                        r={cs.aperture.apertureRadius.toFixed(1)}
                      </span>
                      <button
                        className="transit-star-remove"
                        title="Remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveComparison(index);
                        }}
                      >
                        &times;
                      </button>
                    </button>
                  );
                })}

                {comparisonStars.length === 0 && (
                  <div className="transit-star-row empty">
                    Click cutout to add comparisons
                  </div>
                )}
              </div>
            </div>
            {pendingCutoutSizePx > 60 && (
              <p className="hint" style={{ marginTop: 8 }}>
                Larger cutouts help compare more stars, but long TESS sectors can load more
                slowly at 70-99 px.
              </p>
            )}

            {/* Per-star aperture sliders */}
            <div className="transit-controls-card">
              <h4>
                Aperture — {selectedStar === 'T' ? 'Target' : `Comparison ${selectedStar.slice(1)}`}
              </h4>
              <div className="param-row">
                <label>
                  Radius: <strong>{selectedAperture.apertureRadius.toFixed(1)} px</strong>
                </label>
                <input
                  type="range"
                  min={1.0}
                  max={5.0}
                  step={0.25}
                  value={selectedAperture.apertureRadius}
                  onChange={(e) =>
                    updateSelectedAperture({ apertureRadius: parseFloat(e.target.value) })
                  }
                />
              </div>
              <div className="param-row">
                <label>
                  Inner Annulus: <strong>{selectedAperture.innerAnnulus.toFixed(1)} px</strong>
                </label>
                <input
                  type="range"
                  min={3.0}
                  max={8.0}
                  step={0.25}
                  value={selectedAperture.innerAnnulus}
                  onChange={(e) =>
                    updateSelectedAperture({ innerAnnulus: parseFloat(e.target.value) })
                  }
                />
              </div>
              <div className="param-row">
                <label>
                  Outer Annulus: <strong>{selectedAperture.outerAnnulus.toFixed(1)} px</strong>
                </label>
                <input
                  type="range"
                  min={4.0}
                  max={10.0}
                  step={0.25}
                  value={selectedAperture.outerAnnulus}
                  onChange={(e) =>
                    updateSelectedAperture({ outerAnnulus: parseFloat(e.target.value) })
                  }
                />
              </div>
            </div>

            {/* TIC recommended comparisons */}
            {preview && (preview.tic_stars?.length ?? 0) > 0 && (
              <div className="transit-controls-card">
                <h4>TIC Catalog Stars</h4>
                <p className="hint">
                  Bright stars from TESS Input Catalog in the field of view.
                  Recommended stars are non-variable and bright.
                </p>
                <div className="transit-tic-list">
                  {recommendedComparisonStars.map((star) => (
                      <button
                        key={star.tic_id}
                        className="transit-star-row tic-recommended"
                        onClick={() => {
                          if (comparisonStars.length >= MAX_COMPARISON_STARS) return;
                          handleAddComparison(star.pixel);
                        }}
                        disabled={comparisonStars.length >= MAX_COMPARISON_STARS}
                        title={`TIC ${star.tic_id} — Tmag ${star.tmag ?? '?'}`}
                      >
                        <span className="transit-star-badge tic">R</span>
                        <div className="transit-star-info">
                          <strong>TIC {star.tic_id}</strong>
                          <span>
                            Tmag {star.tmag?.toFixed(1) ?? '?'} · {star.distance_arcmin?.toFixed(1)}
                            '
                          </span>
                        </div>
                        <span className="transit-star-aperture-tag">
                          ({star.pixel.x.toFixed(1)}, {star.pixel.y.toFixed(1)})
                        </span>
                      </button>
                    ))}
                  {preview.tic_stars!.filter((s) => !s.recommended).length > 0 && (
                    <details className="transit-tic-others">
                      <summary>
                        {preview.tic_stars!.filter((s) => !s.recommended).length} other stars
                      </summary>
                      {preview.tic_stars!
                        .filter((s) => !s.recommended)
                        .map((star) => (
                          <button
                            key={star.tic_id}
                            className="transit-star-row"
                            onClick={() => {
                              if (comparisonStars.length >= MAX_COMPARISON_STARS) return;
                              handleAddComparison(star.pixel);
                            }}
                            disabled={comparisonStars.length >= MAX_COMPARISON_STARS}
                            title={`TIC ${star.tic_id} — Tmag ${star.tmag ?? '?'}${star.is_variable ? ' (variable)' : ''}`}
                          >
                            <span className={`transit-star-badge tic ${star.is_variable ? 'variable' : ''}`}>
                              {star.is_variable ? 'V' : 'S'}
                            </span>
                            <div className="transit-star-info">
                              <strong>TIC {star.tic_id}</strong>
                              <span>Tmag {star.tmag?.toFixed(1) ?? '?'}</span>
                            </div>
                          </button>
                        ))}
                    </details>
                  )}
                </div>
                {comparisonStars.length < MAX_COMPARISON_STARS &&
                  recommendedComparisonStars.length > 0 && (
                  <button
                    className="btn-sm"
                    style={{ marginTop: 8, width: '100%' }}
                    onClick={() => {
                      const recommended = recommendedComparisonStars.filter((star) => {
                        if (
                          targetComparisonCollisionPosition &&
                          arePixelPositionsNear(star.pixel, targetComparisonCollisionPosition)
                        ) {
                          return false;
                        }
                        return !comparisonStars.some((item) =>
                          arePixelPositionsNear(item.position, star.pixel)
                        );
                      });
                      const slotsLeft = MAX_COMPARISON_STARS - comparisonStars.length;
                      recommended.slice(0, slotsLeft).forEach((star) => {
                        handleAddComparison(star.pixel);
                      });
                    }}
                  >
                    Auto-select recommended
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Step 2 sidebar: Run configuration summary */}
        {step === 'run' && (
          <div className="transit-controls-card">
            <h4>Configuration</h4>
            <div className="transit-config-summary">
              <div className="transit-config-row">
                <span>Target (T)</span>
                <span>r={targetAperture.apertureRadius.toFixed(1)}</span>
              </div>
              {comparisonStars.map((cs, i) => (
                <div key={i} className="transit-config-row">
                  <span>C{i + 1}</span>
                  <span>r={cs.aperture.apertureRadius.toFixed(1)}</span>
                </div>
              ))}
              <div className="transit-config-row">
                <span>Field</span>
                <span>{cutoutSizePx} px</span>
              </div>
              {preview && (
                <div className="transit-config-row">
                  <span>Cadences</span>
                  <span>{preview.frame_count.toLocaleString()}</span>
                </div>
              )}
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              Go back to Step 1 to adjust apertures.
            </p>
          </div>
        )}

        {/* Step 3 sidebar: Comparison QC */}
        {step === 'comparisonqc' && (
          <>
            <div className="transit-controls-card">
              <h4>Comparison QC</h4>
              <p className="hint" style={{ marginTop: 10 }}>
                후보 비교성을 점검하고, 품질이 떨어지는 별은 제외한 뒤 photometry를 다시
                실행하세요. 최종 differential light curve는 여기서 살아남은 비교성
                ensemble로 다시 계산됩니다.
              </p>
              <div className="transit-config-summary" style={{ marginTop: 12 }}>
                <div className="transit-config-row">
                  <span>Candidates</span>
                  <span>{comparisonDiagnostics.length}</span>
                </div>
                <div className="transit-config-row">
                  <span>Included</span>
                  <span>{qcIncludedDiagnostics.length}</span>
                </div>
                <div className="transit-config-row">
                  <span>Excluded</span>
                  <span>{qcExcludedCount}</span>
                </div>
                {qcBestDiagnostic && (
                  <div className="transit-config-row">
                    <span>Best RMS</span>
                    <span>
                      {qcBestDiagnostic.label} · {qcBestDiagnostic.differential_rms.toFixed(4)}
                    </span>
                  </div>
                )}
              </div>
              <div className="transit-toggle-row" style={{ marginTop: 10 }}>
                <button
                  className="btn-sm"
                  type="button"
                  onClick={handleSelectAllQcComparisons}
                  disabled={comparisonDiagnostics.length === 0 || running}
                >
                  Select All
                </button>
                <button
                  className="btn-primary btn-sm"
                  type="button"
                  onClick={() => {
                    void handleApplyComparisonQc();
                  }}
                  disabled={!qcCanApply}
                >
                  Apply QC &amp; Re-run
                </button>
              </div>
              {qcSelectionDirty && (
                <div className="transit-callout" style={{ marginTop: 12 }}>
                  QC selection changed. Apply QC and rerun photometry before moving on to ROI
                  selection.
                </div>
              )}
            </div>
            {result && (
              <div className="transit-controls-card">
                <h4>Current Ensemble</h4>
                <div className="transit-config-summary">
                  <div className="transit-config-row">
                    <span>Frames</span>
                    <span>{result.frame_count.toLocaleString()}</span>
                  </div>
                  <div className="transit-config-row">
                    <span>Median Target</span>
                    <span>{result.target_median_flux.toFixed(1)}</span>
                  </div>
                  <div className="transit-config-row">
                    <span>Median Comp</span>
                    <span>{result.comparison_median_flux.toFixed(1)}</span>
                  </div>
                  <div className="transit-config-row">
                    <span>Comp Stars</span>
                    <span>{result.comparison_count}</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Step 4 sidebar: BJD window selection */}
        {step === 'lightcurve' && (
          <>
            <div className="transit-controls-card">
              <h4>BJD Window</h4>
              <p className="hint" style={{ marginTop: 10 }}>
                Step 4 plot에서 가로로 드래그해서 transit 구간을 고르세요.
                숫자 입력은 보조용입니다. Step 4는 ROI만 정하고, Step 5에서 이 ROI를
                시간축 그대로 fit할지 phase-fold해서 fit할지 고릅니다.
              </p>
              {resolvedBjdWindow && (
                <div className="transit-config-summary" style={{ marginTop: 12 }}>
                  <div className="transit-config-row">
                    <span>Window</span>
                    <span>
                      {resolvedBjdWindow.start.toFixed(4)} -{' '}
                      {resolvedBjdWindow.end.toFixed(4)}
                    </span>
                  </div>
                  <div className="transit-config-row">
                    <span>Width</span>
                    <span>
                      {(resolvedBjdWindow.end - resolvedBjdWindow.start).toFixed(4)} d
                    </span>
                  </div>
                </div>
              )}
              <div className="param-row">
                <label>BJD Start</label>
                <input
                  type="number"
                  className="transit-param-number"
                  value={bjdWindowStart ?? ''}
                  step={0.0005}
                  min={
                    lightCurveTimeBounds && Number.isFinite(lightCurveTimeBounds.min)
                      ? lightCurveTimeBounds.min
                      : undefined
                  }
                  max={
                    lightCurveTimeBounds && Number.isFinite(lightCurveTimeBounds.max)
                      ? lightCurveTimeBounds.max
                      : undefined
                  }
                  onChange={(e) => {
                    const value = e.target.value.trim();
                    patch({ bjdWindowStart: value === '' ? null : parseFloat(value), fitResult: null });
                  }}
                />
              </div>
              <div className="param-row">
                <label>BJD End</label>
                <input
                  type="number"
                  className="transit-param-number"
                  value={bjdWindowEnd ?? ''}
                  step={0.0005}
                  min={
                    lightCurveTimeBounds && Number.isFinite(lightCurveTimeBounds.min)
                      ? lightCurveTimeBounds.min
                      : undefined
                  }
                  max={
                    lightCurveTimeBounds && Number.isFinite(lightCurveTimeBounds.max)
                      ? lightCurveTimeBounds.max
                      : undefined
                  }
                  onChange={(e) => {
                    const value = e.target.value.trim();
                    patch({ bjdWindowEnd: value === '' ? null : parseFloat(value), fitResult: null });
                  }}
                />
              </div>
              <div className="transit-toggle-row" style={{ marginTop: 10 }}>
                <button
                  className="btn-sm"
                  type="button"
                  onClick={() => {
                    const defaultWindow = computeDefaultBjdWindow(
                      result?.light_curve.points ?? [],
                      fitReferencePeriod
                    );
                    if (!defaultWindow) return;
                    patch({ bjdWindowStart: defaultWindow.start, bjdWindowEnd: defaultWindow.end, fitResult: null });
                  }}
                >
                  Deepest Dip
                </button>
                <button
                  className="btn-sm"
                  type="button"
                  onClick={() => {
                    patch({ bjdWindowStart: null, bjdWindowEnd: null, fitResult: null });
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
            {result && (
              <div className="transit-controls-card">
                <h4>Stats</h4>
                <div className="transit-config-summary">
                  <div className="transit-config-row">
                    <span>Frames</span>
                    <span>{result.frame_count.toLocaleString()}</span>
                  </div>
                  <div className="transit-config-row">
                    <span>Median Target</span>
                    <span>{result.target_median_flux.toFixed(1)}</span>
                  </div>
                  <div className="transit-config-row">
                    <span>Median Comp</span>
                    <span>{result.comparison_median_flux.toFixed(1)}</span>
                  </div>
                  <div className="transit-config-row">
                    <span>Comp Stars</span>
                    <span>{result.comparison_count}</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Step 5 sidebar: Transit Fit controls */}
        {step === 'transitfit' && (
          <div className="transit-controls-card">
            <h4>Fit Settings</h4>
            <div className="transit-toggle-row" style={{ marginBottom: 12 }}>
              <button
                className={`btn-sm ${fitDataSource === 'bjd_window' ? 'active' : ''}`}
                onClick={() => {
                  patch({ fitDataSource: 'bjd_window', fitResult: null });
                }}
                type="button"
              >
                BJD Window
              </button>
              <button
                className={`btn-sm ${fitDataSource === 'phase_fold' ? 'active' : ''}`}
                onClick={() => {
                  patch({
                    fitDataSource: 'phase_fold',
                    fitResult: null,
                  });
                }}
                type="button"
                disabled={!fitReferencePeriod}
              >
                Phase Fold
              </button>
            </div>
            <div className="transit-config-summary" style={{ marginBottom: 12 }}>
              <div className="transit-config-row">
                <span>Fit Source</span>
                <span>{fitSourceLabel}</span>
              </div>
              {fitDataSource === 'bjd_window' && resolvedBjdWindow && (
                <div className="transit-config-row">
                  <span>BJD Window</span>
                  <span>
                    {resolvedBjdWindow.start.toFixed(4)} - {resolvedBjdWindow.end.toFixed(4)}
                  </span>
                </div>
              )}
              {fitDataSource === 'phase_fold' && fitReferencePeriod && (
                <div className="transit-config-row">
                  <span>Period</span>
                  <span>{fitReferencePeriod.toFixed(6)} d</span>
                </div>
              )}
            </div>
            {fitDataSource === 'phase_fold' ? (
              <>
                <p className="hint" style={{ marginBottom: 12 }}>
                  Step 4 ROI만 phase로 접어서 보여주고 fit합니다. ROI 안에 여러 transit가
                  있으면 같은 위상으로 겹쳐서 한 번에 맞춥니다.
                </p>
                {fitReferencePeriod ? (
                  <>
                    <div className="param-row">
                      <label>
                        Period:{' '}
                        <input
                          type="number"
                          className="transit-param-number"
                          value={foldPeriod ?? fitReferencePeriod}
                          step={0.0001}
                          min={0.01}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v > 0) {
                              patch({ foldPeriod: v, fitResult: null });
                            }
                          }}
                        />
                        <span className="param-unit">d</span>
                      </label>
                    </div>
                    <div className="param-row">
                      <label>
                        T₀:{' '}
                        <input
                          type="number"
                          className="transit-param-number"
                          value={phaseFoldReferenceT0}
                          step={0.0005}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) {
                              patch({ foldT0: v, foldT0Auto: false, fitResult: null });
                            }
                          }}
                        />
                        <span className="param-unit">d</span>
                      </label>
                    </div>
                    <div className="param-row">
                      <label>
                        Phase Window:{' '}
                        <input
                          type="number"
                          className="transit-param-number"
                          value={fitWindowPhase}
                          step={0.01}
                          min={0.04}
                          max={0.35}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) {
                              patch({ fitWindowPhase: Math.min(Math.max(v, 0.04), 0.35), fitResult: null });
                            }
                          }}
                        />
                        <span className="param-unit">phase</span>
                      </label>
                    </div>
                    <button
                      className="btn-sm"
                      type="button"
                      onClick={() => {
                        patch({
                          foldPeriod: target.period_days ?? result?.light_curve.period_days ?? null,
                          foldT0: 0,
                          foldT0Auto: true,
                          fitWindowPhase: 0.12,
                          fitResult: null,
                        });
                      }}
                    >
                      Reset To Transit Center
                    </button>
                  </>
                ) : (
                  <p className="hint" style={{ marginBottom: 12 }}>
                    No known period is available, so phase-fold fitting cannot be used.
                  </p>
                )}
              </>
            ) : (
              <p className="hint" style={{ marginBottom: 12 }}>
                Step 4 ROI를 BTJD 시간축 그대로 fit합니다. ROI가 넓어서 transit가 여러 개
                들어가면, 접지 않고 각 이벤트를 원래 시간 간격대로 유지한 채 맞춥니다.
              </p>
            )}
            <div className="transit-callout" style={{ marginTop: 12 }}>
              Step 5는 항상 Step 4에서 고른 같은 ROI 점열만 씁니다. 바뀌는 건 표시와
              fit 좌표계뿐이고, 소스 cadence 자체는 바뀌지 않습니다.
            </div>
            {fitDataSource === 'phase_fold' && hasResolvedBjdWindow && (
              <div className="transit-callout" style={{ marginTop: 12 }}>
                Phase-fold preview의 기본 T₀는 ROI 중앙이 아니라 dip 중심 추정치
                ({phaseFoldReferenceT0.toFixed(6)})를 씁니다. 필요하면 직접 수정할 수 있습니다.
              </div>
            )}
            {fitResult && (
              <div className="transit-config-summary" style={{ marginTop: 12 }}>
                <div className="transit-config-row">
                  <span>Source</span>
                  <span>{fitSourceLabel}</span>
                </div>
                <div className="transit-config-row">
                  <span>Fitted T₀</span>
                  <span>{fitResult.t0.toFixed(6)}</span>
                </div>
                <div className="transit-config-row">
                  <span>Model</span>
                  <span>{fitResult.used_batman ? 'batman integrated transit' : 'Unavailable'}</span>
                </div>
                {fitDataSource === 'bjd_window' && resolvedBjdWindow && (
                  <div className="transit-config-row">
                    <span>BJD Window</span>
                    <span>
                      {resolvedBjdWindow.start.toFixed(4)} - {resolvedBjdWindow.end.toFixed(4)}
                    </span>
                  </div>
                )}
                <div className="transit-config-row">
                  <span>Rp/R*</span>
                  <span>{fitResult.fitted_params.rp_rs.toFixed(5)} ± {fitResult.fitted_params.rp_rs_err.toFixed(5)}</span>
                </div>
                <div className="transit-config-row">
                  <span>a/R*</span>
                  <span>{fitResult.fitted_params.a_rs.toFixed(2)} ± {fitResult.fitted_params.a_rs_err.toFixed(2)}</span>
                </div>
                <div className="transit-config-row">
                  <span>i</span>
                  <span>{fitResult.fitted_params.inclination.toFixed(2)}° ± {fitResult.fitted_params.inclination_err.toFixed(2)}°</span>
                </div>
                <div className="transit-config-row">
                  <span>u₁</span>
                  <span>{fitResult.fitted_params.u1.toFixed(3)} ± {fitResult.fitted_params.u1_err.toFixed(3)}</span>
                </div>
                <div className="transit-config-row">
                  <span>u₂</span>
                  <span>{fitResult.fitted_params.u2.toFixed(3)} ± {fitResult.fitted_params.u2_err.toFixed(3)}</span>
                </div>
                <div className="transit-config-row">
                  <span>χ²_red</span>
                  <span>{fitResult.fitted_params.reduced_chi_squared.toFixed(3)}</span>
                </div>
                <div className="transit-config-row">
                  <span>Note</span>
                  <span>Rp/R* is usually more reliable than a/R* or i here.</span>
                </div>
                <div className="transit-config-row">
                  <span>Points</span>
                  <span>
                    {fitResult.preprocessing.retained_points}
                    {fitResult.preprocessing.clipped_points > 0
                      ? ` (${fitResult.preprocessing.clipped_points} clipped)`
                      : ''}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'record' && (
          <div className="transit-controls-card">
            <h4>Archive Record</h4>
            <p className="hint">
              Save this run as a short learning record. The submission is written to the
              local archive file and database for later review.
            </p>
            {!user && (
              <div className="transit-callout" style={{ marginTop: 12 }}>
                Sign in with Google to submit this analysis into your archive history.
              </div>
            )}
            {submittedRecord ? (
              <div className="transit-config-summary" style={{ marginTop: 12 }}>
                <div className="transit-config-row">
                  <span>Submission</span>
                  <span>#{submittedRecord.submission_id}</span>
                </div>
                <div className="transit-config-row">
                  <span>Saved To</span>
                  <span>{submittedRecord.export_path}</span>
                </div>
                {seedRecordSummary && (
                  <div className="transit-config-row">
                    <span>Draft Seed</span>
                    <span>Record #{seedRecordSummary.submission_id}</span>
                  </div>
                )}
              </div>
            ) : seedRecordSummary ? (
              <div className="transit-config-summary" style={{ marginTop: 12 }}>
                <div className="transit-config-row">
                  <span>Draft Seed</span>
                  <span>Record #{seedRecordSummary.submission_id}</span>
                </div>
              </div>
            ) : (
              <div className="transit-config-summary" style={{ marginTop: 12 }}>
                <div className="transit-config-row">
                  <span>Target</span>
                  <span>{target.name}</span>
                </div>
                {result && (
                  <div className="transit-config-row">
                    <span>Frames</span>
                    <span>{result.frame_count.toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== MAIN PANEL ===== */}
      <div className="lab-results transit-results">
        {/* Step Progress Indicator */}
        <div className="transit-step-indicator">
          {STEPS.map((item, index) => {
            const state = getStepState(item.id);
            const isActive = step === item.id;
            return (
              <div key={item.id} className="transit-step-indicator-item">
                {index > 0 && (
                  <div
                    className={`transit-step-connector ${
                      state === 'completed' || (state === 'accessible' && !isActive)
                        ? 'completed'
                        : getStepState(STEPS[index - 1].id) === 'completed'
                          ? 'active'
                          : ''
                    }`}
                  />
                )}
                <button
                  className={`transit-step-circle ${state} ${isActive ? 'current' : ''}`}
                  disabled={state === 'locked'}
                  onClick={() => handleStepClick(item.id)}
                  title={item.label}
                >
                  {state === 'completed' && !isActive ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <span>{item.number}</span>
                  )}
                </button>
                <span
                  className={`transit-step-label ${isActive ? 'current' : ''} ${
                    state === 'locked' ? 'locked' : ''
                  }`}
                >
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>

        {errorMessage && <div className="transit-callout error-text">{errorMessage}</div>}

        {showBlockingPreviewLoad && (
          <div className="transit-progress-card">
            <div className="transit-progress-head">
              <strong>Loading TESS cutout</strong>
              <span>{Math.round(previewProgress * 100)}%</span>
            </div>
            <div className="transit-progress-bar">
              <div
                className="transit-progress-fill"
                style={{ width: `${Math.max(4, previewProgress * 100)}%` }}
              />
            </div>
            <p className="hint">
              {previewMessage ?? 'Downloading and preparing the TESS cutout...'}
            </p>
            <div className="transit-progress-actions">
              <button type="button" className="btn-sm" onClick={handleReset}>
                Stop
              </button>
            </div>
          </div>
        )}

        {/* STEP 1: Select Stars */}
        {step === 'select' && (
          <div className="transit-panel">
            <div className="transit-panel-header">
              <div>
                <h3>1. Select Target & Comparison Stars</h3>
                <p className="hint">
                  The target star is marked with an orange aperture (T). Click bright
                  neighboring stars on the cutout to place comparison apertures (blue).
                  Use the frame controls above the image to inspect individual cadences.
                  Click any star on the image or in the sidebar to adjust its aperture.
                </p>
              </div>
              {activeObservation && (
                <div className="transit-observation-meta">
                  <strong>{activeObservation.display_label}</strong>
                  <span>{activeObservation.display_subtitle}</span>
                </div>
              )}
            </div>

            <div className="transit-field-size-card">
              <div>
                <strong>Field Size</strong>
              </div>
              <div className="transit-field-size-options">
                <select
                  className="transit-field-size-select"
                  value={pendingCutoutSizePx}
                  disabled={previewLoading || framePreviewLoading}
                  onChange={(e) => patch({ pendingCutoutSizePx: Number(e.target.value) })}
                >
                  {CUTOUT_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}px — {((size * 21) / 60).toFixed(1)}'
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={previewLoading || framePreviewLoading || (cutoutSizePx === pendingCutoutSizePx && preview !== null)}
                  onClick={() => patch({ cutoutSizePx: pendingCutoutSizePx })}
                >
                  Load
                </button>
              </div>
            </div>

            {preview && (
              <>
                <TransitCutoutViewer
                  preview={preview}
                  displayCutoutSizePx={cutoutSizePx ?? preview.cutout_size_px}
                  stars={starOverlays}
                  showTicMarkers={showTicMarkers}
                  onToggleTicMarkers={() => dispatch({ type: 'update', updater: (s) => ({ showTicMarkers: !s.showTicMarkers }) })}
                  activeFrameIndex={currentFrameIndex}
                  onFrameChange={handleFrameChange}
                  frameChangeDisabled={previewLoading || framePreviewLoading}
                  frameLoading={framePreviewLoading}
                  frameLoadingMessage={previewMessage}
                  onAddComparison={handleAddComparison}
                  onSelectStar={handleSelectStarFromCutout}
                  onMoveStar={handleMoveStar}
                />

                <div className="transit-summary-grid">
                  <div className="transit-summary-card">
                    <span className="transit-summary-label">Field View</span>
                    <strong>
                      {cutoutSizePx} px / {cutoutArcmin}'
                    </strong>
                  </div>
                  <div className="transit-summary-card">
                    <span className="transit-summary-label">Loaded Cutout</span>
                    <strong>
                      {preview.cutout_size_px} px / {loadedCutoutArcmin}'
                    </strong>
                  </div>
                  <div className="transit-summary-card">
                    <span className="transit-summary-label">Cadences</span>
                    <strong>{preview.frame_count.toLocaleString()}</strong>
                  </div>
                  <div className="transit-summary-card">
                    <span className="transit-summary-label">Preview Frame</span>
                    <strong>
                      {currentFrameIndex !== null
                        ? `${currentFrameIndex + 1} / ${preview.frame_count}`
                        : 'Median'}
                    </strong>
                  </div>
                  <div className="transit-summary-card">
                    <span className="transit-summary-label">Time Span</span>
                    <strong>{(preview.time_end - preview.time_start).toFixed(2)} d</strong>
                  </div>
                </div>
              </>
            )}

            {!preview && !showBlockingPreviewLoad && (
              <div className="transit-empty-state">
                {cutoutSizePx === null
                  ? 'Choose a field size to load the TESS cutout.'
                  : 'Select a TESS sector from the sidebar to load a cutout image.'}
              </div>
            )}

            <div className="transit-step-nav">
              <button type="button" className="btn-sm" onClick={handleReset} disabled={!preview}>
                Reset
              </button>
              <div className="transit-step-nav-actions">
                <button type="button" className="btn-primary" disabled={!canGoNext} onClick={handleNext}>
                  Next: Run Photometry
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Run Photometry */}
        {step === 'run' && cutoutSizePx !== null && (
          <div className="transit-panel">
            <div className="transit-panel-header">
              <div>
                <h3>2. Run Differential Photometry</h3>
                <p className="hint">
                  Aperture photometry is performed on every cadence. The target flux is
                  divided by the combined comparison flux to produce a differential light
                  curve (F<sub>target</sub> / F<sub>comp</sub>).
                </p>
              </div>
              {activeObservation && (
                <div className="transit-observation-meta">
                  <strong>{activeObservation.display_label}</strong>
                  <span>{activeObservation.display_subtitle}</span>
                </div>
              )}
            </div>

            {effectiveTargetPosition ? (
              <>
                <div className="transit-summary-grid">
                  <div className="transit-summary-card">
                    <span className="transit-summary-label">Target</span>
                    <strong>
                      ({effectiveTargetPosition.x.toFixed(1)},{' '}
                      {effectiveTargetPosition.y.toFixed(1)})
                    </strong>
                  </div>
                  <div className="transit-summary-card">
                    <span className="transit-summary-label">Comparisons</span>
                    <strong>{comparisonStars.length}</strong>
                  </div>
                  <div className="transit-summary-card">
                    <span className="transit-summary-label">Field</span>
                    <strong>{cutoutSizePx} px</strong>
                  </div>
                  <div className="transit-summary-card">
                    <span className="transit-summary-label">Cadences</span>
                    <strong>
                      {(preview?.frame_count ?? activeObservation?.frame_count ?? 0).toLocaleString()}
                    </strong>
                  </div>
                </div>

                {showRunProgress && (
                  <div className="transit-progress-wrapper">
                    <div className="transit-progress-bar">
                      <div
                        className={`transit-progress-fill ${progress >= 100 ? 'done' : ''}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="transit-progress-label">
                      {progress >= 100
                        ? 'Complete'
                        : running
                          ? `${Math.round(progress)}% — ${
                              runProgressEvent?.message ?? 'Running transit photometry...'
                            }`
                          : `${Math.round(progress)}%`}
                    </span>
                  </div>
                )}

                {result && (
                  <div className="transit-run-done">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green, #4ade80)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <span>
                      Photometry complete — {result.frame_count.toLocaleString()} frames processed.
                    </span>
                  </div>
                )}

                <div className="transit-run-actions">
                  {!running && !result && (
                    <button type="button" className="btn-primary" onClick={handleRunPhotometry}>
                      Run Photometry
                    </button>
                  )}
                  {running && (
                    <button type="button" className="btn-danger" onClick={handleStop}>
                      Stop
                    </button>
                  )}
                  {result && !running && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => {
                        patch({ result: null, progress: 0, runProgressEvent: null });
                        handleRunPhotometry();
                      }}
                    >
                      Re-run
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="transit-empty-state">
                {previewLoading
                  ? 'Restoring the Step 1 cutout and target position...'
                  : 'Missing Step 1 cutout context. Go back to Step 1 and reload the cutout before running photometry.'}
              </div>
            )}

            <div className="transit-step-nav">
              <button type="button" className="btn-sm" onClick={handleReset}>
                Reset
              </button>
              <div className="transit-step-nav-actions">
                <button type="button" className="btn-sm" onClick={handlePrevious}>
                  Previous
                </button>
                <button type="button" className="btn-primary" disabled={!canGoNext} onClick={handleNext}>
                  Next: Comparison QC
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Comparison QC */}
        {step === 'comparisonqc' && (result || running) && (
          <>
            <div className="transit-panel">
              <div className="transit-panel-header">
                <div>
                  <h3>3. Comparison QC — {target.name}</h3>
                  <p className="hint">
                    각 비교성의 target/comparison pair를 점검하고, 품질이 떨어지는 별은
                    제외한 뒤 ensemble photometry를 다시 계산하세요.
                  </p>
                </div>
              </div>

              {running && (
                <div className="transit-progress-card" style={{ marginBottom: 16 }}>
                  <div className="transit-progress-head">
                    <strong>Re-running photometry with QC selection</strong>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="transit-progress-bar">
                    <div
                      className={`transit-progress-fill ${progress >= 100 ? 'done' : ''}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="transit-progress-label">
                    {runProgressEvent?.message ?? 'Rebuilding the comparison ensemble...'}
                  </p>
                </div>
              )}

              {result ? (
                <>
                  <div className="transit-summary-grid">
                    <div className="transit-summary-card">
                      <span className="transit-summary-label">Candidates</span>
                      <strong>{comparisonDiagnostics.length}</strong>
                    </div>
                    <div className="transit-summary-card">
                      <span className="transit-summary-label">Included</span>
                      <strong>{qcIncludedDiagnostics.length}</strong>
                    </div>
                    <div className="transit-summary-card">
                      <span className="transit-summary-label">Excluded</span>
                      <strong>{qcExcludedCount}</strong>
                    </div>
                    <div className="transit-summary-card">
                      <span className="transit-summary-label">Current Ensemble</span>
                      <strong>{result.comparison_count}</strong>
                    </div>
                  </div>

                  {qcSelectionDirty && (
                    <div className="transit-callout" style={{ marginBottom: 16 }}>
                      QC selection changed. Apply QC &amp; Re-run to rebuild the differential light
                      curve before moving on to ROI selection.
                    </div>
                  )}

                  {comparisonDiagnostics.length > 0 ? (
                    <>
                      <div className="transit-comparison-diagnostics">
                        {comparisonDiagnostics.map((diagnostic) => {
                          const isActive =
                            diagnostic.label === selectedComparisonDiagnosticData?.label;
                          const isIncluded = qcIncludedComparisonLabels.includes(diagnostic.label);
                          return (
                            <div
                              key={diagnostic.label}
                              className={`transit-comparison-diagnostic-card ${
                                isActive ? 'active' : ''
                              }`}
                            >
                              <div className="transit-comparison-diagnostic-head">
                                <strong>{diagnostic.label}</strong>
                                <span>{(diagnostic.ensemble_weight * 100).toFixed(1)}%</span>
                              </div>
                              <div className="transit-comparison-diagnostic-grid">
                                <span>Frames</span>
                                <span>{diagnostic.valid_frame_count.toLocaleString()}</span>
                                <span>RMS</span>
                                <span>{diagnostic.differential_rms.toFixed(4)}</span>
                                <span>MAD</span>
                                <span>{diagnostic.differential_mad.toFixed(4)}</span>
                                <span>Median Flux</span>
                                <span>{diagnostic.median_flux.toLocaleString()}</span>
                              </div>
                              <div className="transit-toggle-row" style={{ marginTop: 10 }}>
                                <button
                                  type="button"
                                  className={`btn-sm ${isActive ? 'active' : ''}`}
                                  onClick={() => patch({ selectedComparisonDiagnostic: diagnostic.label })}
                                >
                                  Inspect
                                </button>
                                <button
                                  type="button"
                                  className={`btn-sm ${isIncluded ? 'active' : ''}`}
                                  onClick={() => handleToggleQcComparison(diagnostic.label)}
                                >
                                  {isIncluded ? 'Included' : 'Excluded'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {selectedComparisonDiagnosticData && (
                        <>
                          <div className="transit-summary-grid">
                            <div className="transit-summary-card">
                              <span className="transit-summary-label">Selected Pair</span>
                              <strong>T / {selectedComparisonDiagnosticData.label}</strong>
                            </div>
                            <div className="transit-summary-card">
                              <span className="transit-summary-label">Status</span>
                              <strong>
                                {qcIncludedComparisonLabels.includes(
                                  selectedComparisonDiagnosticData.label
                                )
                                  ? 'Included'
                                  : 'Excluded'}
                              </strong>
                            </div>
                            <div className="transit-summary-card">
                              <span className="transit-summary-label">Pair RMS</span>
                              <strong>
                                {selectedComparisonDiagnosticData.differential_rms.toFixed(4)}
                              </strong>
                            </div>
                            <div className="transit-summary-card">
                              <span className="transit-summary-label">Pair MAD</span>
                              <strong>
                                {selectedComparisonDiagnosticData.differential_mad.toFixed(4)}
                              </strong>
                            </div>
                          </div>

                          <LightCurvePlot
                            data={selectedComparisonDiagnosticData.light_curve}
                            targetName={`${target.name} vs ${selectedComparisonDiagnosticData.label}`}
                          />
                        </>
                      )}
                    </>
                  ) : (
                    <div className="transit-empty-state">
                      Comparison diagnostics are not available for this photometry run.
                    </div>
                  )}
                </>
              ) : !running ? (
                <div className="transit-empty-state">
                  Comparison diagnostics are not available for this photometry run.
                </div>
              ) : null}

              <div className="transit-run-actions" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn-sm"
                  onClick={handleSelectAllQcComparisons}
                  disabled={comparisonDiagnostics.length === 0 || running}
                >
                  Select All
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    void handleApplyComparisonQc();
                  }}
                  disabled={!qcCanApply}
                >
                  Apply QC &amp; Re-run
                </button>
              </div>
            </div>

            <div className="transit-step-nav">
              <button type="button" className="btn-sm" onClick={handleReset}>
                Reset
              </button>
              <div className="transit-step-nav-actions">
                <button type="button" className="btn-sm" onClick={handlePrevious}>
                  Previous
                </button>
                <button type="button" className="btn-primary" disabled={!canGoNext} onClick={handleNext}>
                  Next: Light Curve
                </button>
              </div>
            </div>
          </>
        )}

        {/* STEP 4: Light Curve */}
        {step === 'lightcurve' && result && (
          <>
            <div className="transit-panel">
              <div className="transit-panel-header">
                <div>
                  <h3>4. Differential Light Curve & ROI — {target.name}</h3>
                  <p className="hint">
                    Sector {result.sector} &middot;{' '}
                    F<sub>target</sub> / F<sub>comp</sub>, normalized to unity.
                    {target.period_days
                      ? ` Known period: ${target.period_days} d.`
                      : ''}
                  </p>
                </div>
              </div>

              <div className="transit-summary-grid">
                <div className="transit-summary-card">
                  <span className="transit-summary-label">Frames</span>
                  <strong>{result.frame_count.toLocaleString()}</strong>
                </div>
                <div className="transit-summary-card">
                  <span className="transit-summary-label">Comparisons</span>
                  <strong>{result.comparison_count}</strong>
                </div>
                <div className="transit-summary-card">
                  <span className="transit-summary-label">Median Target</span>
                  <strong>{result.target_median_flux.toLocaleString()}</strong>
                </div>
                <div className="transit-summary-card">
                  <span className="transit-summary-label">Median Comp</span>
                  <strong>{result.comparison_median_flux.toLocaleString()}</strong>
                </div>
              </div>
            </div>

            <LightCurvePlot
              data={result.light_curve}
              targetName={target.name}
              highlightRange={resolvedBjdWindow}
              enableRangeSelection
              onSelectRange={(range) => {
                patch({ bjdWindowStart: range.start, bjdWindowEnd: range.end, fitResult: null });
              }}
            />

            <div className="transit-step-nav">
              <button type="button" className="btn-sm" onClick={handleReset}>
                Reset
              </button>
              <div className="transit-step-nav-actions">
                <button type="button" className="btn-sm" onClick={handlePrevious}>
                  Previous
                </button>
                <button type="button" className="btn-primary" disabled={!canGoNext} onClick={handleNext}>
                  Next: Transit Fit
                </button>
              </div>
            </div>
          </>
        )}

        {/* STEP 5: Transit Fit */}
        {step === 'transitfit' && result && (
          <>
            <div className="transit-panel">
              <div className="transit-panel-header">
                <div>
                  <h3>5. Transit Model Fit — {target.name}</h3>
                  <p className="hint">
                    {fitDataSource === 'phase_fold'
                      ? 'Phase-fold the Step 4 ROI and fit that folded segment.'
                      : 'Fit a transit model on the Step 4 ROI without folding the time axis.'}
                    {fitReferencePeriod && ` P = ${fitReferencePeriod} d`}
                    {fitDataSource === 'phase_fold' ? `, T₀ = ${phaseFoldReferenceT0} d` : ''}
                  </p>
                </div>
              </div>

              <div className="transit-callout">
                Black points are the exact normalized samples used in the fit. Red is the
                best-fit transit model on that same axis, so Step 5 now shows one ROI with
                two view modes instead of mixing Step 4 light-curve selection and Step 5
                fit coordinates.
              </div>

              {fitDataSource === 'phase_fold' && !fitReferencePeriod && (
                <div className="transit-callout">
                  A known orbital period is required to fit the phase-folded curve.
                </div>
              )}

              {!hasResolvedBjdWindow && (
                <div className="transit-callout">
                  Step 4에서 먼저 BJD transit segment를 정해야 Step 5 fit을 실행할 수 있습니다.
                </div>
              )}

              {fitDataSource === 'bjd_window' && !hasResolvedBjdWindow && (
                <div className="transit-callout">
                  Define a valid BJD start and end time before fitting. The selected
                  window is highlighted on the Step 4 BJD light curve.
                </div>
              )}

              {hasResolvedBjdWindow && fitWindowPointCount > 0 && fitWindowPointCount < 20 && (
                <div className="transit-callout">
                  The Step 4 ROI currently contains only {fitWindowPointCount} points. Select a
                  wider BJD window before fitting.
                </div>
              )}

              {fitDataSource === 'bjd_window' && canFitWithBjdWindow && !fitReferencePeriod && (
                <div className="transit-callout">
                  A known period is still required to evaluate the transit model, even
                  when fitting only a BJD window.
                </div>
              )}

              {canPreviewTransitFit && (
                <div className="transit-panel" style={{ marginBottom: 16 }}>
                  <LightCurvePlot
                    data={fitDisplayLightCurve}
                    targetName={target.name}
                    overlayCurve={fitPreviewOverlay}
                    residualCurve={fitPreviewResiduals}
                    analystLabel={user?.email ?? null}
                    variant={activeFitPreviewResult ? 'fit-preview' : 'default'}
                  />
                </div>
              )}

              {(fitDebugRequest || fitResult || fitDebugLog.length > 0) && (
                <details className="transit-panel" style={{ marginBottom: 16 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 12 }}>
                    Step 5 Debug
                  </summary>
                  <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
                    Step 5가 실제로 어떤 ROI와 파라미터를 backend에 보냈고, 무엇을
                    돌려받았는지 그대로 보여줍니다.
                  </p>

                  {fitDebugRequest && (
                    <div className="transit-config-summary" style={{ marginBottom: 12 }}>
                      <div className="transit-config-row">
                        <span>Request Mode</span>
                        <span>{fitDebugRequest.fitMode}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>Request Period</span>
                        <span>{fitDebugRequest.period.toFixed(6)}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>Request T₀</span>
                        <span>{fitDebugRequest.t0.toFixed(6)}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>Request Filter</span>
                        <span>{fitDebugRequest.filterName ?? 'unknown'}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>Stellar Params</span>
                        <span>
                          {fitDebugRequest.stellarTemperature !== null &&
                          fitDebugRequest.stellarLogg !== null
                            ? `Teff ${fitDebugRequest.stellarTemperature.toFixed(0)} / logg ${fitDebugRequest.stellarLogg.toFixed(2)} / [Fe/H] ${(
                                fitDebugRequest.stellarMetallicity ?? 0
                              ).toFixed(2)}`
                            : 'unavailable'}
                        </span>
                      </div>
                      <div className="transit-config-row">
                        <span>ROI Points</span>
                        <span>{fitDebugRequest.roiPointCount}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>ROI Time</span>
                        <span>
                          {fitDebugRequest.roiTimeMin !== null && fitDebugRequest.roiTimeMax !== null
                            ? `${fitDebugRequest.roiTimeMin.toFixed(6)} - ${fitDebugRequest.roiTimeMax.toFixed(6)}`
                            : 'n/a'}
                        </span>
                      </div>
                      <div className="transit-config-row">
                        <span>ROI Flux</span>
                        <span>
                          {fitDebugRequest.roiFluxMin !== null && fitDebugRequest.roiFluxMax !== null
                            ? `${fitDebugRequest.roiFluxMin.toFixed(6)} - ${fitDebugRequest.roiFluxMax.toFixed(6)}`
                            : 'n/a'}
                        </span>
                      </div>
                      <div className="transit-config-row">
                        <span>ROI Error</span>
                        <span>
                          {fitDebugRequest.roiErrorMin !== null && fitDebugRequest.roiErrorMax !== null
                            ? `${fitDebugRequest.roiErrorMin.toFixed(6)} - ${fitDebugRequest.roiErrorMax.toFixed(6)}`
                            : 'n/a'}
                        </span>
                      </div>
                      <div className="transit-config-row">
                        <span>fit_window_phase</span>
                        <span>{fitDebugRequest.requestedFitWindowPhase.toFixed(4)}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>baseline_order</span>
                        <span>{fitDebugRequest.baselineOrder}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>sigma_clip</span>
                        <span>
                          {fitDebugRequest.sigmaClipSigma.toFixed(2)} / {fitDebugRequest.sigmaClipIterations}
                        </span>
                      </div>
                    </div>
                  )}

                  {fitResult && (
                    <div className="transit-config-summary" style={{ marginBottom: 12 }}>
                      <div className="transit-config-row">
                        <span>Response T₀</span>
                        <span>{fitResult.t0.toFixed(6)}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>Reference T₀</span>
                        <span>{fitResult.reference_t0.toFixed(6)}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>Returned Mode</span>
                        <span>{fitResult.preprocessing.fit_mode}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>LD Source</span>
                        <span>
                          {fitResult.limb_darkening_source ??
                            fitResult.preprocessing.limb_darkening_source ??
                            'unknown'}
                          {(fitResult.limb_darkening_filter ??
                            fitResult.preprocessing.limb_darkening_filter) &&
                            ` · ${
                              fitResult.limb_darkening_filter ??
                              fitResult.preprocessing.limb_darkening_filter
                            }`}
                        </span>
                      </div>
                      <div className="transit-config-row">
                        <span>Retained Points</span>
                        <span>{fitResult.preprocessing.retained_points}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>Rp/R*</span>
                        <span>{fitResult.fitted_params.rp_rs.toFixed(5)}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>a/R*</span>
                        <span>{fitResult.fitted_params.a_rs.toFixed(2)}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>Inclination</span>
                        <span>{fitResult.fitted_params.inclination.toFixed(2)}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>χ²_red</span>
                        <span>{fitResult.fitted_params.reduced_chi_squared.toFixed(3)}</span>
                      </div>
                      <div className="transit-config-row">
                        <span>Model Flux</span>
                        <span>
                          {fitResultModelFlux.length > 0
                            ? `${Math.min(...fitResultModelFlux).toFixed(6)} - ${Math.max(...fitResultModelFlux).toFixed(6)}`
                            : 'n/a'}
                        </span>
                      </div>
                      <div className="transit-config-row">
                        <span>Residual RMS</span>
                        <span>{fitResidualRms !== null ? fitResidualRms.toFixed(6) : 'n/a'}</span>
                      </div>
                    </div>
                  )}

                  {fitDebugLog.length > 0 && (
                    <pre
                      style={{
                        margin: 0,
                        padding: 12,
                        background: '#111',
                        color: '#d6e2ff',
                        borderRadius: 8,
                        overflowX: 'auto',
                        fontSize: 12,
                        lineHeight: 1.5,
                      }}
                    >
                      {fitDebugLog.join('\n')}
                    </pre>
                  )}
                </details>
              )}

              {fitDataSource === 'bjd_window' && resolvedBjdWindow && (
                <div className="transit-config-summary" style={{ marginBottom: 12 }}>
                  <div className="transit-config-row">
                    <span>Fit Source</span>
                    <span>BJD Window</span>
                  </div>
                  <div className="transit-config-row">
                    <span>Window</span>
                    <span>
                      {resolvedBjdWindow.start.toFixed(4)} - {resolvedBjdWindow.end.toFixed(4)}
                    </span>
                  </div>
                  <div className="transit-config-row">
                    <span>Width</span>
                    <span>{(resolvedBjdWindow.end - resolvedBjdWindow.start).toFixed(4)} d</span>
                  </div>
                </div>
              )}

              {fitDataSource === 'phase_fold' && fitReferencePeriod && (
                <div className="transit-config-summary" style={{ marginBottom: 12 }}>
                  <div className="transit-config-row">
                    <span>Fit Source</span>
                    <span>Phase Fold</span>
                  </div>
                  <div className="transit-config-row">
                    <span>Period</span>
                    <span>{(foldPeriod ?? fitReferencePeriod).toFixed(6)} d</span>
                  </div>
                  <div className="transit-config-row">
                    <span>T₀</span>
                    <span>{phaseFoldReferenceT0.toFixed(6)} d</span>
                  </div>
                </div>
              )}

              {canRunTransitFit && !fitResult && !fitting && (
                <div className="transit-run-actions">
                  <button type="button" className="btn-primary" onClick={handleFitTransit}>
                    Run Transit Fit
                  </button>
                </div>
              )}

              {fitting && (
                <div className="transit-progress-card">
                  <div className="transit-progress-head">
                    <strong>Fitting transit model</strong>
                    <span>
                      {fitProgress
                        ? `${Math.round((fitProgress.pct ?? 0) * 100)}%`
                        : '0%'}
                    </span>
                  </div>
                  <div className="transit-progress-bar">
                    <div
                      className="transit-progress-fill"
                      style={{ width: `${Math.round((fitProgress?.pct ?? 0) * 100)}%` }}
                    />
                  </div>
                  <p className="transit-progress-label">
                    {!fitProgress || fitProgress.stage === 'init'
                      ? 'Preparing data...'
                        : fitProgress.stage === 'phase_fold'
                          ? fitDataSource === 'bjd_window'
                            ? 'Selecting BJD window and aligning the transit center...'
                            : 'Phase folding & dip detection...'
                        : fitProgress.stage === 'preprocess'
                          ? 'Normalizing the Step 4 ROI and preparing the model...'
                        : fitProgress.stage === 'least_squares'
                          ? 'Initial optimization (least squares)...'
                          : fitProgress.stage === 'mcmc'
                            ? fitProgress.step && fitProgress.total
                              ? `MCMC sampling — step ${fitProgress.step}/${fitProgress.total}`
                              : 'Sampling posterior with MCMC...'
                            : 'Finalizing results...'}
                  </p>
                </div>
              )}

              {fitResult && (
                <>
                  <div className="transit-callout">
                    Method used: {fitEngineLabel}
                  </div>
                  <div className="transit-callout">
                    The fitted transit model is drawn directly on the current Step 5 ROI view.
                  </div>
                  <div className="transit-config-summary">
                    <div className="transit-config-row">
                      <span>Fit Source</span>
                      <span>
                        {fitResult.preprocessing.fit_mode === 'bjd_window'
                          ? 'BJD Window'
                          : 'Phase Fold'}
                      </span>
                    </div>
                    {fitResult.preprocessing.fit_mode === 'bjd_window' &&
                      fitResult.preprocessing.bjd_start !== null &&
                      fitResult.preprocessing.bjd_end !== null && (
                        <div className="transit-config-row">
                          <span>BJD Window</span>
                          <span>
                            {fitResult.preprocessing.bjd_start.toFixed(4)} -{' '}
                            {fitResult.preprocessing.bjd_end.toFixed(4)}
                          </span>
                        </div>
                      )}
                    <div className="transit-config-row">
                      <span>Retained Points</span>
                      <span>{fitResult.preprocessing.retained_points}</span>
                    </div>
                  </div>
                  <div className="transit-run-actions" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() => {
                        patch({ fitResult: null });
                        handleFitTransit();
                      }}
                    >
                      Re-fit
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="transit-step-nav">
              <button type="button" className="btn-sm" onClick={handleReset}>
                Reset
              </button>
              <div className="transit-step-nav-actions">
                <button type="button" className="btn-sm" onClick={handlePrevious}>
                  Previous
                </button>
                <button type="button" className="btn-primary" disabled={!canGoNext} onClick={handleNext}>
                  Next: Record Result
                </button>
              </div>
            </div>
          </>
        )}

        {step === 'record' && result && (
          <div className="transit-panel">
            <div className="transit-panel-header">
              <div>
                <h3>6. Record This Analysis</h3>
                <p className="hint">
                  Turn this run into a reusable archive record. The form definition comes
                  from a JSON template, so the questions can be edited without changing
                  the UI code.
                </p>
              </div>
            </div>

            <div className="transit-summary-grid">
              <div className="transit-summary-card">
                <span className="transit-summary-label">Target</span>
                <strong>{target.name}</strong>
              </div>
              <div className="transit-summary-card">
                <span className="transit-summary-label">Sector</span>
                <strong>{result.sector}</strong>
              </div>
              <div className="transit-summary-card">
                <span className="transit-summary-label">Frames</span>
                <strong>{result.frame_count.toLocaleString()}</strong>
              </div>
              <div className="transit-summary-card">
                <span className="transit-summary-label">Comparisons</span>
                <strong>{result.comparison_count}</strong>
              </div>
            </div>

            {/* Fit result summary in Record step */}
            {fitResult && (
              <div className="transit-record-fit-summary">
                <h4>Transit Fit Result</h4>
                <div className="transit-fit-params-grid">
                  <div className="transit-fit-param-card">
                    <span className="transit-fit-param-label">Rp/R*</span>
                    <strong>{fitResult.fitted_params.rp_rs.toFixed(5)} <span className="transit-fit-param-err">± {fitResult.fitted_params.rp_rs_err.toFixed(5)}</span></strong>
                    <p className="transit-fit-param-desc">
                      Planet-to-star radius ratio. Rp/R* = {fitResult.fitted_params.rp_rs.toFixed(4)} means the planet's
                      radius is about {(fitResult.fitted_params.rp_rs * 100).toFixed(1)}% of the host star,
                      causing a {((fitResult.fitted_params.rp_rs ** 2) * 100).toFixed(2)}% dip in brightness during transit.
                    </p>
                  </div>
                  <div className="transit-fit-param-card">
                    <span className="transit-fit-param-label">a/R*</span>
                    <strong>{fitResult.fitted_params.a_rs.toFixed(2)} <span className="transit-fit-param-err">± {fitResult.fitted_params.a_rs_err.toFixed(2)}</span></strong>
                    <p className="transit-fit-param-desc">
                      Scaled semi-major axis (orbital distance in units of stellar radii).
                      The planet orbits at {fitResult.fitted_params.a_rs.toFixed(1)}x the star's radius from its center.
                      {fitResult.fitted_params.a_rs < 5 ? ' Very close — a "hot" exoplanet.' : ''}
                    </p>
                  </div>
                  <div className="transit-fit-param-card">
                    <span className="transit-fit-param-label">Inclination</span>
                    <strong>{fitResult.fitted_params.inclination.toFixed(2)}° <span className="transit-fit-param-err">± {fitResult.fitted_params.inclination_err.toFixed(2)}°</span></strong>
                    <p className="transit-fit-param-desc">
                      Orbital inclination relative to our line of sight. 90° = edge-on.
                      {fitResult.fitted_params.inclination > 88
                        ? ' Nearly edge-on — deep, symmetric transit.'
                        : fitResult.fitted_params.inclination > 85
                          ? ' Slightly tilted — transit crosses near the center.'
                          : ' Moderate tilt — may produce a grazing transit.'}
                    </p>
                  </div>
                  <div className="transit-fit-param-card">
                    <span className="transit-fit-param-label">Period</span>
                    <strong>{fitResult.period.toFixed(6)} d</strong>
                    <p className="transit-fit-param-desc">
                      Orbital period — the planet completes one orbit every {fitResult.period.toFixed(4)} days
                      ({(fitResult.period * 24).toFixed(1)} hours).
                    </p>
                  </div>
                  <div className="transit-fit-param-card">
                    <span className="transit-fit-param-label">Limb Darkening</span>
                    <strong>u₁ = {fitResult.fitted_params.u1.toFixed(3)}, u₂ = {fitResult.fitted_params.u2.toFixed(3)}</strong>
                    <p className="transit-fit-param-desc">
                      Quadratic limb darkening coefficients describe how the star appears
                      darker at its edges. Affects the transit shape during ingress/egress.
                    </p>
                  </div>
                  <div className="transit-fit-param-card">
                    <span className="transit-fit-param-label">Fit Quality</span>
                    <strong>χ²_red = {fitResult.fitted_params.reduced_chi_squared.toFixed(3)}</strong>
                    <p className="transit-fit-param-desc">
                      Reduced chi-squared measures goodness of fit.
                      {fitResult.fitted_params.reduced_chi_squared < 1.5
                        ? ' Close to 1.0 — good fit to the data.'
                        : fitResult.fitted_params.reduced_chi_squared < 3
                          ? ' Moderate — the model captures the main signal but there is scatter.'
                          : ' High — significant residuals remain; consider adjusting parameters.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!recordTemplate && recordLoading && (
              <div className="transit-empty-state">Loading record form...</div>
            )}

            {recordTemplate && (
              <div className="record-form-shell">
                <div className="record-form-head">
                  <div>
                    <h4>{recordTemplate.title}</h4>
                    <p className="hint">{recordTemplate.description}</p>
                  </div>
                  <span className="analysis-launcher-tag">
                    {user ? `SIGNED IN AS ${user.name.toUpperCase()}` : 'SIGN IN REQUIRED'}
                  </span>
                </div>

                <div className="record-cover-card">
                  <div className="record-cover-head">
                    <div>
                      <span className="record-section-kicker">Submission</span>
                      <h4>Save This Transit Analysis</h4>
                    </div>
                    <span className="record-required-note">* Required</span>
                  </div>
                  <label className="record-form-field">
                    <span className="record-field-label">
                      Saved Record Title
                      <strong className="record-required">*</strong>
                    </span>
                    <input
                      type="text"
                      value={recordTitle}
                      onChange={(event) => patch({ recordTitle: event.target.value })}
                      placeholder={`${target.name} Sector ${result.sector}`}
                    />
                  </label>
                </div>

                <div className="record-form-grid">

                  {recordTemplate.questions.map((question) => {
                    const value = recordAnswers[question.id];
                    const options = question.options ?? [];
                    const requiredMark = question.required ? (
                      <strong className="record-required">*</strong>
                    ) : null;
                    const questionHead = (
                      <div className="record-question-head">
                        <span className="record-field-label">
                          {question.label}
                          {requiredMark}
                        </span>
                        {question.help_text && (
                          <small className="record-question-help">{question.help_text}</small>
                        )}
                      </div>
                    );

                    if (question.type === 'textarea') {
                      return (
                        <label
                          key={question.id}
                          className="record-question-card record-question-card-wide"
                        >
                          {questionHead}
                          <textarea
                            value={typeof value === 'string' ? value : ''}
                            placeholder={question.placeholder ?? ''}
                            onChange={(event) =>
                              handleRecordAnswerChange(question.id, event.target.value)
                            }
                          />
                        </label>
                      );
                    }

                    if (question.type === 'select') {
                      return (
                        <label key={question.id} className="record-question-card">
                          {questionHead}
                          <select
                            value={typeof value === 'string' ? value : ''}
                            onChange={(event) =>
                              handleRecordAnswerChange(question.id, event.target.value)
                            }
                          >
                            <option value="">Select...</option>
                            {options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    }

                    if (question.type === 'radio') {
                      return (
                        <div
                          key={question.id}
                          className="record-question-card record-question-card-wide"
                        >
                          {questionHead}
                          <div className="record-radio-group">
                            {options.map((option) => (
                              <label key={option.value} className="record-choice-row">
                                <input
                                  type="radio"
                                  name={question.id}
                                  checked={value === option.value}
                                  onChange={() =>
                                    handleRecordAnswerChange(question.id, option.value)
                                  }
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    }

                    if (question.type === 'checkbox') {
                      const selectedValues = Array.isArray(value) ? value : [];
                      return (
                        <div
                          key={question.id}
                          className="record-question-card record-question-card-wide"
                        >
                          {questionHead}
                          <div className="record-checkbox-group">
                            {options.map((option) => {
                              const checked = selectedValues.includes(option.value);
                              return (
                                <label key={option.value} className="record-choice-row">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const next = checked
                                        ? selectedValues.filter((item) => item !== option.value)
                                        : [...selectedValues, option.value];
                                      handleRecordAnswerChange(question.id, next);
                                    }}
                                  />
                                  <span>{option.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }

                    if (question.type === 'number') {
                      if (isScoreQuestion(question)) {
                        const min = question.min_value ?? 1;
                        const max = question.max_value ?? 5;
                        return (
                          <div key={question.id} className="record-question-card">
                            {questionHead}
                            <div className="record-score-row">
                              {Array.from({ length: max - min + 1 }, (_, index) => min + index).map(
                                (score) => (
                                  <button
                                    key={score}
                                    type="button"
                                    className={`record-score-pill ${
                                      Number(value) === score ? 'active' : ''
                                    }`}
                                    onClick={() => handleRecordAnswerChange(question.id, score)}
                                  >
                                    {score}
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <label key={question.id} className="record-question-card">
                          {questionHead}
                          <input
                            type="number"
                            min={question.min_value ?? undefined}
                            max={question.max_value ?? undefined}
                            step="1"
                            value={typeof value === 'number' || typeof value === 'string' ? value : ''}
                            onChange={(event) =>
                              handleRecordAnswerChange(question.id, event.target.value)
                            }
                          />
                        </label>
                      );
                    }

                    return (
                      <label key={question.id} className="record-question-card">
                        {questionHead}
                        <input
                          type="text"
                          value={typeof value === 'string' ? value : ''}
                          placeholder={question.placeholder ?? ''}
                          onChange={(event) =>
                            handleRecordAnswerChange(question.id, event.target.value)
                          }
                        />
                      </label>
                    );
                  })}
                </div>

                {submittedRecord && (
                  <div className="transit-run-done">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green, #4ade80)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <span>
                      Saved as record #{submittedRecord.submission_id} to {submittedRecord.export_path}.
                    </span>
                  </div>
                )}

                <div className="transit-step-nav">
                  <button type="button" className="btn-sm" onClick={handleReset}>
                    Reset
                  </button>
                  <div className="transit-step-nav-actions">
                    <button type="button" className="btn-sm" onClick={handlePrevious}>
                      Previous
                    </button>
                    {!user && (
                      <a href="/api/auth/login" className="btn-sm">
                        Sign In to Save
                      </a>
                    )}
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={recordSubmitting || !user}
                      onClick={handleSubmitRecord}
                    >
                      {recordSubmitting ? 'Submitting...' : 'Submit Record'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
