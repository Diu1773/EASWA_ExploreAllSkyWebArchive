import { useCallback, useEffect, useRef } from 'react';
import {
  cancelTransitPreviewJob,
  createTransitPreviewJob,
  fetchTransitCutoutPreview,
  fetchTransitPreviewJob,
} from '../../../api/client';
import type { PixelCoordinate, TransitCutoutPreview, TransitPhotometryResponse } from '../../../types/transit';
import type { Target } from '../../../types/target';
import type { TransitWorkflowStep } from '../definition';
import type { TransitLabState } from '../state';

interface UseTransitPreviewParams {
  workflowHydrated: boolean;
  step: TransitWorkflowStep;
  activeObservationId: string | null;
  cutoutSizePx: number | null;
  selectedFrameIndex: number | null;
  targetPositionOffset: PixelCoordinate | null;
  preview: TransitCutoutPreview | null;
  result: TransitPhotometryResponse | null;
  target: Target;
  restoringSessionPreviewRef: React.MutableRefObject<boolean>;
  replaceStep: (step: TransitWorkflowStep) => void;
  patch: (changes: Partial<TransitLabState>) => void;
}

export function useTransitPreview({
  workflowHydrated,
  step,
  activeObservationId,
  cutoutSizePx,
  selectedFrameIndex,
  targetPositionOffset,
  preview,
  result,
  target,
  restoringSessionPreviewRef,
  replaceStep,
  patch,
}: UseTransitPreviewParams): { cancelAll: () => void } {
  const previewJobIdRef = useRef<string | null>(null);
  const previewPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const framePreviewAbortRef = useRef<AbortController | null>(null);

  const cancelAll = useCallback(() => {
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
  }, []);

  useEffect(() => {
    return cancelAll;
  }, [cancelAll]);

  useEffect(() => {
    if (!workflowHydrated) return;
    const stepNeedsPreview =
      step === 'select' ||
      (step === 'run' && preview === null && result === null && targetPositionOffset === null);
    const shouldDeferRestoredPreview =
      restoringSessionPreviewRef.current && result !== null && preview === null && !stepNeedsPreview;

    const clearPreviewRuntime = {
      previewLoading: false,
      framePreviewLoading: false,
      previewProgress: 0,
      previewMessage: null,
    } as const;

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
        if (previewJobIdRef.current !== null) return;
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

  return { cancelAll };
}
