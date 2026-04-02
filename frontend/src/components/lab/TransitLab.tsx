import { useEffect, useRef, useState } from 'react';
import {
  cancelTransitPreviewJob,
  createTransitPreviewJob,
  fetchMyRecordSubmission,
  fetchTransitCutoutPreview,
  fetchTransitPreviewJob,
  fetchRecordTemplate,
  fitTransitModel,
  runTransitPhotometry,
  submitRecordTemplate,
} from '../../api/client';
import { useAppStore } from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import type { Observation, Target } from '../../types/target';
import type {
  ApertureParams,
  PixelCoordinate,
  StarOverlay,
  TransitCutoutPreview,
  TransitPhotometryResponse,
} from '../../types/transit';
import type { RecordSubmissionResponse, RecordTemplate } from '../../types/record';
import type { TransitFitResponse } from '../../types/transitFit';
import { defaultTransitRecordTemplate } from '../../data/transitRecordTemplate';
import { TransitCutoutViewer } from './TransitCutoutViewer';
import { LightCurvePlot } from './LightCurvePlot';
import { TransitFitPlot } from './TransitFitPlot';

interface TransitLabProps {
  target: Target;
  observations: Observation[];
  recordId?: number | null;
}

type TransitStep = 'select' | 'run' | 'lightcurve' | 'transitfit' | 'record';
type StepState = 'locked' | 'accessible' | 'completed';

const STEPS: Array<{ id: TransitStep; label: string; number: number }> = [
  { id: 'select', label: 'Select Stars', number: 1 },
  { id: 'run', label: 'Run Photometry', number: 2 },
  { id: 'lightcurve', label: 'Light Curve', number: 3 },
  { id: 'transitfit', label: 'Transit Fit', number: 4 },
  { id: 'record', label: 'Record Result', number: 5 },
];

const CUTOUT_SIZE_OPTIONS = [30, 35, 40] as const;

const DEFAULT_APERTURE: ApertureParams = {
  apertureRadius: 2.5,
  innerAnnulus: 4.0,
  outerAnnulus: 6.0,
};

type StarKey = 'T' | 'C1' | 'C2' | 'C3';

interface ComparisonStar {
  position: PixelCoordinate;
  aperture: ApertureParams;
}

interface PersistedTransitLabState {
  activeObservationId: string | null;
  cutoutSizePx: number | null;
  selectedFrameIndex: number | null;
  step: TransitStep;
  targetAperture: ApertureParams;
  targetPositionOffset: PixelCoordinate | null;
  comparisonStars: ComparisonStar[];
  selectedStar: StarKey;
  foldEnabled: boolean;
  result: TransitPhotometryResponse | null;
  recordAnswers: Record<string, unknown>;
  recordTitle: string;
  recordSaved: RecordSubmissionResponse | null;
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

function getTransitLabStorageKey(targetId: string): string {
  return `easwa-transit-lab:${targetId}`;
}

export function TransitLab({ target, observations, recordId = null }: TransitLabProps) {
  const selectedIds = useAppStore((state) => state.selectedObservationIds);
  const selectAllObservations = useAppStore((state) => state.selectAllObservations);
  const user = useAuthStore((state) => state.user);

  const [activeObservationId, setActiveObservationId] = useState<string | null>(null);
  const [preview, setPreview] = useState<TransitCutoutPreview | null>(null);
  const [cutoutSizePx, setCutoutSizePx] = useState<number | null>(null);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);
  const [step, setStep] = useState<TransitStep>('select');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [framePreviewLoading, setFramePreviewLoading] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<TransitPhotometryResponse | null>(null);
  const [foldEnabled, setFoldEnabled] = useState(false);
  const [foldPeriod, setFoldPeriod] = useState<number | null>(null);
  const [foldT0, setFoldT0] = useState<number>(0);
  const [fitResult, setFitResult] = useState<TransitFitResponse | null>(null);
  const [fitting, setFitting] = useState(false);
  const [fitLimbDarkening, setFitLimbDarkening] = useState(false);
  const [recordTemplate, setRecordTemplate] = useState<RecordTemplate | null>(
    defaultTransitRecordTemplate
  );
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordSubmitting, setRecordSubmitting] = useState(false);
  const [recordAnswers, setRecordAnswers] = useState<Record<string, unknown>>(
    buildInitialRecordAnswers(defaultTransitRecordTemplate)
  );
  const [recordTitle, setRecordTitle] = useState('');
  const [recordSaved, setRecordSaved] = useState<RecordSubmissionResponse | null>(null);

  // Per-star aperture state
  const [targetAperture, setTargetAperture] = useState<ApertureParams>({ ...DEFAULT_APERTURE });
  const [targetPositionOffset, setTargetPositionOffset] = useState<PixelCoordinate | null>(null);
  const [comparisonStars, setComparisonStars] = useState<ComparisonStar[]>([]);
  const [selectedStar, setSelectedStar] = useState<StarKey>('T');

  const previewJobIdRef = useRef<string | null>(null);
  const previewPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const framePreviewAbortRef = useRef<AbortController | null>(null);
  const runAbortRef = useRef<AbortController | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordTemplateRequestedRef = useRef(false);
  const stateHydratedRef = useRef(false);
  const loadedRecordIdRef = useRef<number | null>(null);

  const selectedObservations = observations.filter((obs) =>
    selectedIds.includes(obs.id)
  );

  // Cleanup on unmount
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
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  // Auto-select first observation
  useEffect(() => {
    if (selectedObservations.length === 0) {
      setActiveObservationId(null);
      return;
    }
    setActiveObservationId((current) => {
      if (current && selectedObservations.some((obs) => obs.id === current)) return current;
      return selectedObservations[0].id;
    });
  }, [selectedObservations]);

  useEffect(() => {
    stateHydratedRef.current = false;
    loadedRecordIdRef.current = null;
    const storageKey = getTransitLabStorageKey(target.id);
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) {
        stateHydratedRef.current = true;
        return;
      }
      const saved = JSON.parse(raw) as PersistedTransitLabState;
      setActiveObservationId(saved.activeObservationId ?? null);
      setCutoutSizePx(saved.cutoutSizePx ?? null);
      setSelectedFrameIndex(saved.selectedFrameIndex ?? null);
      setStep(saved.step ?? 'select');
      setTargetAperture(saved.targetAperture ?? { ...DEFAULT_APERTURE });
      setTargetPositionOffset(saved.targetPositionOffset ?? null);
      setComparisonStars(saved.comparisonStars ?? []);
      setSelectedStar(saved.selectedStar ?? 'T');
      setFoldEnabled(Boolean(saved.foldEnabled));
      setResult(saved.result ?? null);
      setRecordAnswers(saved.recordAnswers ?? buildInitialRecordAnswers(recordTemplate));
      setRecordTitle(saved.recordTitle ?? '');
      setRecordSaved(saved.recordSaved ?? null);
    } catch (error) {
      console.error('Failed to restore transit lab state', error);
    } finally {
      stateHydratedRef.current = true;
    }
  }, [target.id]);

  useEffect(() => {
    if (!recordId || !user) return;
    if (loadedRecordIdRef.current === recordId) return;
    let cancelled = false;

    fetchMyRecordSubmission(recordId)
      .then((record) => {
        if (cancelled || !record || record.target_id !== target.id) return;
        const payload = record.payload as {
          context?: {
            observation_id?: string;
            field_size_px?: number;
            target_position?: PixelCoordinate | null;
            comparison_positions?: PixelCoordinate[];
            aperture?: ApertureParams;
          };
          answers?: Record<string, unknown>;
        };
        const observationIds =
          record.observation_ids.length > 0
            ? record.observation_ids
            : payload.context?.observation_id
              ? [payload.context.observation_id]
              : [];

        if (observationIds.length > 0) {
          selectAllObservations(observationIds);
          setActiveObservationId(observationIds[0]);
        }
        setCutoutSizePx(payload.context?.field_size_px ?? 35);
        setSelectedFrameIndex(null);
        setTargetPositionOffset(payload.context?.target_position ?? null);
        setComparisonStars(
          (payload.context?.comparison_positions ?? []).slice(0, 3).map((position) => ({
            position,
            aperture: payload.context?.aperture ?? { ...DEFAULT_APERTURE },
          }))
        );
        setTargetAperture(payload.context?.aperture ?? { ...DEFAULT_APERTURE });
        setSelectedStar('T');
        setRecordAnswers(payload.answers ?? buildInitialRecordAnswers(recordTemplate));
        setRecordTitle(record.title);
        setRecordSaved({
          submission_id: record.submission_id,
          title: record.title,
          created_at: record.created_at,
          export_path: '',
        });
        setStep('select');
        loadedRecordIdRef.current = recordId;
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to restore saved record', error);
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to reopen saved record.'
        );
      });

    return () => {
      cancelled = true;
    };
  }, [recordId, recordTemplate, selectAllObservations, target.id, user]);

  useEffect(() => {
    if (!stateHydratedRef.current) return;
    const storageKey = getTransitLabStorageKey(target.id);
    const persisted: PersistedTransitLabState = {
      activeObservationId,
      cutoutSizePx,
      selectedFrameIndex,
      step,
      targetAperture,
      targetPositionOffset,
      comparisonStars,
      selectedStar,
      foldEnabled,
      result,
      recordAnswers,
      recordTitle,
      recordSaved,
    };
    sessionStorage.setItem(storageKey, JSON.stringify(persisted));
  }, [
    activeObservationId,
    comparisonStars,
    cutoutSizePx,
    foldEnabled,
    recordAnswers,
    recordSaved,
    recordTitle,
    result,
    selectedFrameIndex,
    selectedStar,
    step,
    target.id,
    targetAperture,
    targetPositionOffset,
  ]);

  useEffect(() => {
    setSelectedFrameIndex(null);
    setRecordSaved(null);
    setRecordTitle('');
    setRecordAnswers((current) =>
      recordTemplate ? buildInitialRecordAnswers(recordTemplate) : current
    );
  }, [activeObservationId]);

  // Fetch cutout preview
  useEffect(() => {
    if (!activeObservationId || cutoutSizePx === null) {
      if (previewPollTimeoutRef.current) {
        clearTimeout(previewPollTimeoutRef.current);
        previewPollTimeoutRef.current = null;
      }
      const previewJobId = previewJobIdRef.current;
      previewJobIdRef.current = null;
      if (previewJobId) cancelTransitPreviewJob(previewJobId).catch(() => undefined);
      framePreviewAbortRef.current?.abort();
      setPreview(null);
      setPreviewLoading(false);
      setFramePreviewLoading(false);
      setPreviewProgress(0);
      setPreviewMessage(null);
      return;
    }

    const currentFrameIndex = selectedFrameIndex ?? preview?.frame_index ?? null;
    const canReuse =
      preview !== null &&
      preview.observation_id === activeObservationId &&
      preview.cutout_size_px >= cutoutSizePx &&
      preview.frame_index === currentFrameIndex;

    if (canReuse) {
      setPreviewLoading(false);
      setPreviewProgress(1);
      setPreviewMessage(
        currentFrameIndex !== null
          ? `Using loaded frame ${currentFrameIndex + 1} from ${preview.cutout_size_px}px cutout.`
          : `Using loaded ${preview.cutout_size_px}px cutout.`
      );
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

    setErrorMessage(null);

    if (previewPollTimeoutRef.current) {
      clearTimeout(previewPollTimeoutRef.current);
      previewPollTimeoutRef.current = null;
    }
    const previousJobId = previewJobIdRef.current;
    previewJobIdRef.current = null;
    if (previousJobId) cancelTransitPreviewJob(previousJobId).catch(() => undefined);
    framePreviewAbortRef.current?.abort();

    if (canRefreshFrameOnly) {
      setFramePreviewLoading(true);
      setPreviewMessage(
        currentFrameIndex !== null
          ? `Loading frame ${currentFrameIndex + 1}...`
          : 'Loading selected frame...'
      );
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
          setPreview(response);
          setPreviewMessage(
            response.frame_index !== null
              ? `Viewing frame ${response.frame_index + 1} / ${response.frame_count}.`
              : 'Preview ready.'
          );
          if (selectedFrameIndex === null && response.frame_index !== null) {
            setSelectedFrameIndex(response.frame_index);
          }
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.error('Failed to refresh transit preview frame', error);
          setErrorMessage(
            error instanceof Error ? error.message : 'Failed to load selected frame.'
          );
        })
        .finally(() => {
          setFramePreviewLoading(false);
          if (framePreviewAbortRef.current === controller) {
            framePreviewAbortRef.current = null;
          }
        });
      return;
    }

    setPreviewLoading(true);
    setFramePreviewLoading(false);
    setPreviewProgress(0);
    setPreviewMessage(
      currentFrameIndex !== null
        ? `Loading frame ${currentFrameIndex + 1}...`
        : 'Queued preview request.'
    );

    setResult(null);
    setPreview(null);
    setComparisonStars([]);
    setTargetPositionOffset(null);
    setSelectedStar('T');
    setStep('select');

    const pollPreviewJob = async (jobId: string) => {
      try {
        const job = await fetchTransitPreviewJob(jobId);
        if (previewJobIdRef.current !== jobId) return;

        setPreviewProgress(job.progress);
        setPreviewMessage(job.message);

        if (job.status === 'completed' && job.result) {
          setPreview(job.result);
          setPreviewLoading(false);
          setPreviewProgress(1);
          previewPollTimeoutRef.current = null;
          previewJobIdRef.current = null;
          if (selectedFrameIndex === null && job.result.frame_index !== null) {
            setSelectedFrameIndex(job.result.frame_index);
          }
          return;
        }

        if (job.status === 'failed') {
          setPreview(null);
          setPreviewLoading(false);
          previewPollTimeoutRef.current = null;
          setErrorMessage(job.error ?? 'Failed to load TESS cutout preview.');
          previewJobIdRef.current = null;
          return;
        }

        if (job.status === 'cancelled') {
          setPreview(null);
          setPreviewLoading(false);
          previewPollTimeoutRef.current = null;
          setErrorMessage('Transit preview loading stopped.');
          previewJobIdRef.current = null;
          return;
        }

        previewPollTimeoutRef.current = setTimeout(() => {
          void pollPreviewJob(jobId);
        }, 400);
      } catch (error) {
        if (previewJobIdRef.current !== jobId) return;
        console.error('Failed to poll transit preview job', error);
        previewPollTimeoutRef.current = null;
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to monitor TESS cutout preview.'
        );
        setPreview(null);
        setPreviewLoading(false);
        previewJobIdRef.current = null;
      }
    };

    createTransitPreviewJob(target.id, activeObservationId, requestSizePx, currentFrameIndex)
      .then((job) => {
        previewJobIdRef.current = job.job_id;
        setPreviewProgress(job.progress);
        setPreviewMessage(job.message);
        void pollPreviewJob(job.job_id);
      })
      .catch((error) => {
        console.error('Failed to start transit preview job', error);
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to start TESS cutout preview.'
        );
        setPreview(null);
        setPreviewLoading(false);
      });
  }, [activeObservationId, cutoutSizePx, selectedFrameIndex, target.id]);

  useEffect(() => {
    if (!result) {
      setRecordSaved(null);
      return;
    }
    if (!recordTitle) {
      const sectorLabel = result.sector ? `Sector ${result.sector}` : 'Transit run';
      setRecordTitle(`${target.name} ${sectorLabel}`);
    }
  }, [result, target.name, recordTitle]);

  // Auto-enable fold when result arrives and target has a known period
  useEffect(() => {
    if (result && target.period_days) {
      if (foldPeriod === null) setFoldPeriod(target.period_days);
      if (!foldEnabled) setFoldEnabled(true);
    }
  }, [result, target.period_days]);

  useEffect(() => {
    if (recordLoading || recordTemplateRequestedRef.current) return;
    let cancelled = false;
    recordTemplateRequestedRef.current = true;
    setRecordLoading(true);
    fetchRecordTemplate('transit_record')
      .then((template) => {
        if (cancelled) return;
        setRecordTemplate(template);
        setRecordAnswers((current) =>
          Object.keys(current).length > 0 ? current : buildInitialRecordAnswers(template)
        );
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load record template', error);
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to load record form.'
        );
      })
      .finally(() => {
        if (!cancelled) setRecordLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recordTemplate, recordLoading]);

  // Invalidate result when apertures/stars change
  useEffect(() => {
    if (!result) return;
    setResult(null);
    setRecordSaved(null);
    if (step === 'lightcurve' || step === 'record') setStep('run');
  }, [activeObservationId, targetAperture, comparisonStars]);

  // Effective target position (original or user-dragged)
  const effectiveTargetPosition: PixelCoordinate | null =
    preview ? (targetPositionOffset ?? preview.target_position) : null;

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

  // Get the aperture for the currently selected star
  const getSelectedAperture = (): ApertureParams => {
    if (selectedStar === 'T') return targetAperture;
    const idx = parseInt(selectedStar.slice(1)) - 1;
    return comparisonStars[idx]?.aperture ?? DEFAULT_APERTURE;
  };

  const updateSelectedAperture = (patch: Partial<ApertureParams>) => {
    if (selectedStar === 'T') {
      setTargetAperture((prev) => ({ ...prev, ...patch }));
    } else {
      const idx = parseInt(selectedStar.slice(1)) - 1;
      setComparisonStars((prev) =>
        prev.map((cs, i) =>
          i === idx ? { ...cs, aperture: { ...cs.aperture, ...patch } } : cs
        )
      );
    }
  };

  // Step state
  const stepOrder: TransitStep[] = ['select', 'run', 'lightcurve', 'transitfit', 'record'];
  const currentStepIndex = stepOrder.indexOf(step);

  const getStepState = (stepId: TransitStep): StepState => {
    const targetIndex = stepOrder.indexOf(stepId);
    if (stepId === 'select') {
      return step === 'select' ? 'accessible' : 'completed';
    }
    if (stepId === 'run') {
      if (!preview || comparisonStars.length === 0) return 'locked';
      if (currentStepIndex > targetIndex) return 'completed';
      if (step === 'run') return 'accessible';
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
    setComparisonStars((current) => {
      if (current.length >= 3) return current;
      return [...current, { position, aperture: { ...DEFAULT_APERTURE } }];
    });
    // Auto-select the new comparison star
    const nextKey = `C${Math.min(comparisonStars.length + 1, 3)}` as StarKey;
    setSelectedStar(nextKey);
  };

  const handleSelectStarFromCutout = (label: string) => {
    if (label === 'T' || label === 'C1' || label === 'C2' || label === 'C3') {
      setSelectedStar(label as StarKey);
    }
  };

  const handleMoveStar = (label: string, position: PixelCoordinate) => {
    if (label === 'T') {
      setTargetPositionOffset(position);
      return;
    }
    const idx = parseInt(label.slice(1)) - 1;
    if (idx < 0 || idx >= comparisonStars.length) return;
    setComparisonStars((prev) =>
      prev.map((cs, i) => (i === idx ? { ...cs, position } : cs))
    );
  };

  const handleRemoveComparison = (index: number) => {
    setComparisonStars((prev) => prev.filter((_, i) => i !== index));
    setSelectedStar('T');
  };

  const handleFrameChange = (frameIndex: number) => {
    if (!preview) return;
    const clamped = Math.max(0, Math.min(preview.frame_count - 1, frameIndex));
    setSelectedFrameIndex(clamped);
  };

  const handleRecordAnswerChange = (questionId: string, value: unknown) => {
    setRecordSaved(null);
    setRecordAnswers((current) => ({
      ...current,
      [questionId]: value,
    }));
  };

  const handleSubmitRecord = async () => {
    if (!result || !preview) return;
    setRecordSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await submitRecordTemplate('transit_record', {
        workflow: 'transit_lab',
        target_id: target.id,
        observation_ids: [preview.observation_id],
        title: recordTitle.trim() || `${target.name} Sector ${result.sector}`,
        context: {
          target_name: target.name,
          sector: result.sector,
          observation_id: preview.observation_id,
          field_size_px: preview.cutout_size_px,
          frame_count: result.frame_count,
          target_position: effectiveTargetPosition,
          comparison_positions: comparisonStars.map((star) => star.position),
          aperture: targetAperture,
          user: user ? { id: user.id, name: user.name, email: user.email } : null,
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
          } : null,
        },
        answers: recordAnswers,
      });
      setRecordSaved(response);
    } catch (error) {
      console.error('Failed to submit analysis record', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to submit analysis record.'
      );
    } finally {
      setRecordSubmitting(false);
    }
  };

  // Progress simulation
  const startProgressSimulation = () => {
    setProgress(0);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    let current = 0;
    progressIntervalRef.current = setInterval(() => {
      current += Math.random() * 12 + 3;
      if (current >= 90) {
        current = 90;
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      }
      setProgress(Math.min(current, 90));
    }, 300);
  };

  const stopProgressSimulation = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  };

  const handleRunPhotometry = async () => {
    if (!preview) return;

    setRunning(true);
    setErrorMessage(null);
    startProgressSimulation();

    runAbortRef.current?.abort();
    const controller = new AbortController();
    runAbortRef.current = controller;

    try {
      const response = await runTransitPhotometry(
        {
          target_id: target.id,
          observation_id: preview.observation_id,
          cutout_size_px: preview.cutout_size_px,
          target_position: effectiveTargetPosition!,
          comparison_positions: comparisonStars.map((cs) => cs.position),
          aperture_radius: targetAperture.apertureRadius,
          inner_annulus: targetAperture.innerAnnulus,
          outer_annulus: targetAperture.outerAnnulus,
        },
        controller.signal
      );
      stopProgressSimulation();
      setProgress(100);
      setResult(response);
    } catch (error) {
      stopProgressSimulation();
      setProgress(0);
      if (error instanceof DOMException && error.name === 'AbortError') {
        setErrorMessage('Photometry stopped.');
        return;
      }
      console.error('Transit photometry run failed', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'Transit photometry failed.'
      );
    } finally {
      setRunning(false);
      if (runAbortRef.current === controller) runAbortRef.current = null;
    }
  };

  const handleStop = () => {
    runAbortRef.current?.abort();
    stopProgressSimulation();
    setRunning(false);
    setProgress(0);
    setErrorMessage('Photometry stopped.');
  };

  const handleReset = () => {
    sessionStorage.removeItem(getTransitLabStorageKey(target.id));
    if (previewPollTimeoutRef.current) {
      clearTimeout(previewPollTimeoutRef.current);
      previewPollTimeoutRef.current = null;
    }
    const previewJobId = previewJobIdRef.current;
    previewJobIdRef.current = null;
    if (previewJobId) cancelTransitPreviewJob(previewJobId).catch(() => undefined);
    framePreviewAbortRef.current?.abort();
    runAbortRef.current?.abort();
    stopProgressSimulation();
    setPreviewLoading(false);
    setFramePreviewLoading(false);
    setPreviewProgress(0);
    setPreviewMessage(null);
    setRunning(false);
    setResult(null);
    setProgress(0);
    setComparisonStars([]);
    setTargetPositionOffset(null);
    setTargetAperture({ ...DEFAULT_APERTURE });
    setCutoutSizePx(null);
    setPreview(null);
    setSelectedFrameIndex(null);
    setSelectedStar('T');
    setStep('select');
    setErrorMessage(null);
    setFoldEnabled(false);
    setFoldPeriod(null);
    setFoldT0(0);
    setFitResult(null);
    setFitting(false);
    setFitLimbDarkening(false);
    setRecordSaved(null);
    setRecordTitle('');
    setRecordAnswers((current) =>
      recordTemplate ? buildInitialRecordAnswers(recordTemplate) : current
    );
  };

  // Navigation
  const canGoNext =
    (step === 'select' && Boolean(preview) && comparisonStars.length > 0) ||
    (step === 'run' && Boolean(result)) ||
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
    if (!result || !foldPeriod) return;
    setFitting(true);
    setErrorMessage(null);
    setFitResult(null);
    try {
      const response = await fitTransitModel({
        target_id: target.id,
        period: foldPeriod,
        t0: foldT0,
        fit_limb_darkening: fitLimbDarkening,
        points: result.light_curve.points,
      });
      setFitResult(response);
    } catch (error) {
      console.error('Transit fitting failed', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'Transit model fitting failed.'
      );
    } finally {
      setFitting(false);
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

  const selectedAperture = getSelectedAperture();

  return (
    <div className="lab-content transit-lab">
      {/* ===== SIDEBAR — changes per step ===== */}
      <div className="lab-sidebar">
        {/* Sector list — always visible */}
        <div className="thumbnail-strip">
          <h4>Selected Sectors ({selectedObservations.length})</h4>
          <div className="transit-sector-list">
            {selectedObservations.map((observation) => (
              <button
                key={observation.id}
                className={`transit-sector-button ${
                  observation.id === activeObservationId ? 'active' : ''
                }`}
                onClick={() => setActiveObservationId(observation.id)}
              >
                <strong>{observation.display_label ?? `Sector ${observation.sector}`}</strong>
                <span>{observation.display_subtitle ?? 'TESS cutout'}</span>
              </button>
            ))}
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
                to add comparison stars (max 3).
              </p>
              <div className="transit-star-list">
                {/* Target star */}
                <button
                  className={`transit-star-row ${selectedStar === 'T' ? 'selected' : ''}`}
                  onClick={() => setSelectedStar('T')}
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
                      onClick={() => setSelectedStar(key)}
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

        {/* Step 3 sidebar: Phase fold controls */}
        {step === 'lightcurve' && (
          <>
            <div className="transit-controls-card">
              <h4>Phase Fold</h4>
              {target.period_days ? (
                <>
                  <label className="transit-fold-toggle">
                    <input
                      type="checkbox"
                      checked={foldEnabled}
                      onChange={() => setFoldEnabled(!foldEnabled)}
                    />
                    <div>
                      <strong>Enable Fold</strong>
                    </div>
                  </label>
                  {foldEnabled && foldPeriod !== null && (
                    <>
                      <div className="param-row">
                        <label>
                          Period:{' '}
                          <input
                            type="number"
                            className="transit-param-number"
                            value={foldPeriod}
                            step={0.0001}
                            min={0.01}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v) && v > 0) setFoldPeriod(v);
                            }}
                          />
                          <span className="param-unit">d</span>
                        </label>
                        <input
                          type="range"
                          min={target.period_days * 0.9}
                          max={target.period_days * 1.1}
                          step={0.0001}
                          value={foldPeriod}
                          onChange={(e) => setFoldPeriod(parseFloat(e.target.value))}
                        />
                      </div>
                      <div className="param-row">
                        <label>
                          T₀:{' '}
                          <input
                            type="number"
                            className="transit-param-number"
                            value={foldT0}
                            step={0.001}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v)) setFoldT0(v);
                            }}
                          />
                          <span className="param-unit">d</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={foldPeriod}
                          step={0.001}
                          value={foldT0}
                          onChange={(e) => setFoldT0(parseFloat(e.target.value))}
                        />
                      </div>
                      <button
                        className="btn-sm"
                        style={{ marginTop: 8 }}
                        onClick={() => {
                          setFoldPeriod(target.period_days!);
                          setFoldT0(0);
                        }}
                      >
                        Reset to catalog
                      </button>
                    </>
                  )}
                </>
              ) : (
                <p className="hint">No known period for phase folding.</p>
              )}
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

        {/* Step 4 sidebar: Transit Fit controls */}
        {step === 'transitfit' && (
          <div className="transit-controls-card">
            <h4>Fit Settings</h4>
            <label className="transit-fold-toggle">
              <input
                type="checkbox"
                checked={fitLimbDarkening}
                onChange={() => setFitLimbDarkening(!fitLimbDarkening)}
              />
              <div>
                <strong>Fit Limb Darkening</strong>
                <span>u₁, u₂ (quadratic)</span>
              </div>
            </label>
            {fitResult && (
              <div className="transit-config-summary" style={{ marginTop: 12 }}>
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
            {recordSaved ? (
              <div className="transit-config-summary" style={{ marginTop: 12 }}>
                <div className="transit-config-row">
                  <span>Submission</span>
                  <span>#{recordSaved.submission_id}</span>
                </div>
                <div className="transit-config-row">
                  <span>Saved To</span>
                  <span>{recordSaved.export_path}</span>
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

        {previewLoading && (
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
              <button className="btn-sm" onClick={handleReset}>
                Stop
              </button>
            </div>
          </div>
        )}

        {/* STEP 1: Select Stars */}
        {!previewLoading && step === 'select' && (
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
                {CUTOUT_SIZE_OPTIONS.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`btn-sm transit-field-size-button ${
                      cutoutSizePx === size ? 'active' : ''
                    }`}
                    disabled={previewLoading || framePreviewLoading}
                    onClick={() => setCutoutSizePx(size)}
                  >
                    {size}px
                    <span>{((size * 21) / 60).toFixed(1)}'</span>
                  </button>
                ))}
              </div>
            </div>

            {preview && (
              <>
                <TransitCutoutViewer
                  preview={preview}
                  displayCutoutSizePx={cutoutSizePx ?? preview.cutout_size_px}
                  stars={starOverlays}
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

            {!preview && !previewLoading && (
              <div className="transit-empty-state">
                {cutoutSizePx === null
                  ? 'Choose a field size to load the TESS cutout.'
                  : 'Select a TESS sector from the sidebar to load a cutout image.'}
              </div>
            )}

            <div className="transit-step-nav">
              <button className="btn-sm" onClick={handleReset} disabled={!preview}>
                Reset
              </button>
              <div className="transit-step-nav-actions">
                <button className="btn-primary" disabled={!canGoNext} onClick={handleNext}>
                  Next: Run Photometry
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Run Photometry */}
        {!previewLoading && step === 'run' && preview && (
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

            <div className="transit-summary-grid">
              <div className="transit-summary-card">
                <span className="transit-summary-label">Target</span>
                <strong>
                  ({effectiveTargetPosition!.x.toFixed(1)},{' '}
                  {effectiveTargetPosition!.y.toFixed(1)})
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
                <strong>{preview.frame_count.toLocaleString()}</strong>
              </div>
            </div>

            {/* Progress Bar */}
            {(running || progress > 0) && (
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
                      ? `Processing... ${Math.round(progress)}%`
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
                <button className="btn-primary" onClick={handleRunPhotometry}>
                  Run Photometry
                </button>
              )}
              {running && (
                <button className="btn-danger" onClick={handleStop}>
                  Stop
                </button>
              )}
              {result && !running && (
                <button
                  className="btn-primary"
                  onClick={() => {
                    setResult(null);
                    setProgress(0);
                    handleRunPhotometry();
                  }}
                >
                  Re-run
                </button>
              )}
            </div>

            <div className="transit-step-nav">
              <button className="btn-sm" onClick={handleReset}>
                Reset
              </button>
              <div className="transit-step-nav-actions">
                <button className="btn-sm" onClick={handlePrevious}>
                  Previous
                </button>
                <button className="btn-primary" disabled={!canGoNext} onClick={handleNext}>
                  Next: Light Curve
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Light Curve */}
        {!previewLoading && step === 'lightcurve' && result && (
          <>
            <div className="transit-panel">
              <div className="transit-panel-header">
                <div>
                  <h3>3. Differential Light Curve — {target.name}</h3>
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
              foldPeriod={foldEnabled && foldPeriod ? foldPeriod : undefined}
              foldT0={foldEnabled ? foldT0 : undefined}
            />

            <div className="transit-step-nav">
              <button className="btn-sm" onClick={handleReset}>
                Reset
              </button>
              <div className="transit-step-nav-actions">
                <button className="btn-sm" onClick={handlePrevious}>
                  Previous
                </button>
                <button className="btn-primary" disabled={!canGoNext} onClick={handleNext}>
                  Next: Transit Fit
                </button>
              </div>
            </div>
          </>
        )}

        {/* STEP 4: Transit Fit */}
        {!previewLoading && step === 'transitfit' && result && (
          <>
            <div className="transit-panel">
              <div className="transit-panel-header">
                <div>
                  <h3>4. Transit Model Fit — {target.name}</h3>
                  <p className="hint">
                    MCMC fitting using batman transit model (Mandel &amp; Agol 2002).
                    {foldPeriod && ` P = ${foldPeriod} d`}
                    {foldT0 ? `, T₀ = ${foldT0} d` : ''}
                  </p>
                </div>
              </div>

              {!foldEnabled && (
                <div className="transit-callout">
                  Go back to Step 3 and enable Phase Fold before fitting.
                  A known orbital period is required to fit the transit model.
                </div>
              )}

              {foldEnabled && foldPeriod && !fitResult && !fitting && (
                <div className="transit-run-actions">
                  <button className="btn-primary" onClick={handleFitTransit}>
                    Run MCMC Fit
                  </button>
                </div>
              )}

              {fitting && (
                <div className="transit-progress-card">
                  <div className="transit-progress-head">
                    <strong>Fitting transit model (MCMC)</strong>
                  </div>
                  <p className="hint">
                    Running {fitLimbDarkening ? '5' : '3'}-parameter MCMC...
                    this may take 10–30 seconds.
                  </p>
                </div>
              )}

              {fitResult && (
                <>
                  <TransitFitPlot fitResult={fitResult} targetName={target.name} />
                  <div className="transit-run-actions" style={{ marginTop: 12 }}>
                    <button
                      className="btn-sm"
                      onClick={() => {
                        setFitResult(null);
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
              <button className="btn-sm" onClick={handleReset}>
                Reset
              </button>
              <div className="transit-step-nav-actions">
                <button className="btn-sm" onClick={handlePrevious}>
                  Previous
                </button>
                <button className="btn-primary" disabled={!canGoNext} onClick={handleNext}>
                  Next: Record Result
                </button>
              </div>
            </div>
          </>
        )}

        {!previewLoading && step === 'record' && result && (
          <div className="transit-panel">
            <div className="transit-panel-header">
              <div>
                <h3>5. Record This Analysis</h3>
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
                <TransitFitPlot fitResult={fitResult} targetName={target.name} />
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
                    {user ? `SIGNED IN AS ${user.name.toUpperCase()}` : 'LOCAL SUBMISSION'}
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
                      onChange={(event) => setRecordTitle(event.target.value)}
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

                {recordSaved && (
                  <div className="transit-run-done">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green, #4ade80)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <span>
                      Saved as record #{recordSaved.submission_id} to {recordSaved.export_path}.
                    </span>
                  </div>
                )}

                <div className="transit-step-nav">
                  <button className="btn-sm" onClick={handleReset}>
                    Reset
                  </button>
                  <div className="transit-step-nav-actions">
                    <button className="btn-sm" onClick={handlePrevious}>
                      Previous
                    </button>
                    <button
                      className="btn-primary"
                      disabled={recordSubmitting}
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
