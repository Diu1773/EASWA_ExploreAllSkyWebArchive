import { useCallback, useRef } from 'react';
import { runTransitPhotometryStreaming } from '../../../api/client';
import type { Observation, Target } from '../../../types/target';
import type {
  ApertureParams,
  PixelCoordinate,
  TransitApertureConfig,
  TransitComparisonDiagnostic,
  TransitCutoutPreview,
  TransitPhotometryResponse,
} from '../../../types/transit';
import type { TransitWorkflowStep } from '../definition';
import type { ComparisonStar, TransitLabState } from '../state';

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

interface UseTransitPhotometryParams {
  activeObservationId: string | null;
  cutoutSizePx: number | null;
  effectiveTargetPosition: PixelCoordinate | null;
  targetAperture: ApertureParams;
  comparisonStars: ComparisonStar[];
  comparisonDiagnostics: TransitComparisonDiagnostic[];
  qcIncludedComparisonLabels: string[];
  preview: TransitCutoutPreview | null;
  result: TransitPhotometryResponse | null;
  target: Target;
  activeObservation: Observation | null;
  suppressAnalysisInvalidationRef: React.MutableRefObject<boolean>;
  replaceStep: (step: TransitWorkflowStep) => void;
  patch: (changes: Partial<TransitLabState>) => void;
  dispatch: React.Dispatch<{ type: 'update'; updater: (s: TransitLabState) => Partial<TransitLabState> }>;
}

export interface UseTransitPhotometryResult {
  abortRun: () => void;
  handleRunPhotometry: () => Promise<void>;
  handleStop: () => void;
  handleToggleQcComparison: (label: string) => void;
  handleSelectAllQcComparisons: () => void;
  handleApplyComparisonQc: () => Promise<void>;
}

export function useTransitPhotometry({
  activeObservationId,
  cutoutSizePx,
  effectiveTargetPosition,
  targetAperture,
  comparisonStars,
  comparisonDiagnostics,
  qcIncludedComparisonLabels,
  preview,
  result,
  target,
  activeObservation,
  suppressAnalysisInvalidationRef,
  replaceStep,
  patch,
  dispatch,
}: UseTransitPhotometryParams): UseTransitPhotometryResult {
  const runAbortRef = useRef<AbortController | null>(null);

  const abortRun = useCallback(() => {
    runAbortRef.current?.abort();
  }, []);

  const runTransitPhotometryForComparisons = async (
    stars: ComparisonStar[],
    nextStepAfterSuccess: TransitWorkflowStep | null = null
  ): Promise<TransitPhotometryResponse | null> => {
    const photometryTargetPosition = effectiveTargetPosition ?? result?.target_position ?? null;

    if (!activeObservationId || cutoutSizePx === null || !photometryTargetPosition) {
      patch({ errorMessage: 'Missing cutout setup for transit photometry.' });
      return null;
    }

    const observationContext =
      preview !== null
        ? { sector: preview.sector, camera: preview.camera, ccd: preview.ccd }
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
      runProgressEvent: { type: 'progress', pct: 0, message: 'Starting transit photometry...' },
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
          target_aperture: toTransitApertureConfig(photometryTargetPosition, targetAperture),
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
        runProgressEvent: { type: 'progress', pct: 1, message: 'Transit photometry complete.' },
        result: response,
      });
      if (nextStepAfterSuccess) replaceStep(nextStepAfterSuccess);
      return response;
    } catch (error) {
      patch({ progress: 0, runProgressEvent: null });
      if (error instanceof DOMException && error.name === 'AbortError') {
        patch({ errorMessage: 'Photometry stopped.' });
        return null;
      }
      console.error('Transit photometry run failed', error);
      patch({
        errorMessage: error instanceof Error ? error.message : 'Transit photometry failed.',
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

  const handleStop = () => {
    runAbortRef.current?.abort();
    patch({ running: false, progress: 0, runProgressEvent: null, errorMessage: 'Photometry stopped.' });
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
            return parseInt(left.slice(1), 10) - parseInt(right.slice(1), 10);
          }),
        };
      },
    });
  };

  const handleSelectAllQcComparisons = () => {
    patch({ qcIncludedComparisonLabels: comparisonDiagnostics.map((d) => d.label) });
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

  return {
    abortRun,
    handleRunPhotometry,
    handleStop,
    handleToggleQcComparison,
    handleSelectAllQcComparisons,
    handleApplyComparisonQc,
  };
}
