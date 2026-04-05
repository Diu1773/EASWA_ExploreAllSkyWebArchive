import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

interface PersistedWorkflowEnvelope<TStep extends string, TSnapshot> {
  version: number;
  step: TStep;
  snapshot: TSnapshot;
}

interface UsePersistedWorkflowStepOptions<
  TStep extends string,
  TSnapshot,
  TAvailability,
> {
  storageKey: string;
  version: number;
  defaultStep: TStep;
  searchParam?: string;
  currentAvailability: TAvailability;
  emptyAvailability: TAvailability;
  parseStep: (value: string | null) => TStep | null;
  clampStep: (requestedStep: TStep, availability: TAvailability) => TStep;
  snapshot: TSnapshot;
  restoreSnapshot: (raw: unknown) => TSnapshot | null;
  applyRestoredSnapshot: (snapshot: TSnapshot | null, restoredStep: TStep) => void;
  getSnapshotAvailability: (snapshot: TSnapshot | null) => TAvailability;
}

export function usePersistedWorkflowStep<
  TStep extends string,
  TSnapshot,
  TAvailability,
>({
  storageKey,
  version,
  defaultStep,
  searchParam = 'step',
  currentAvailability,
  emptyAvailability,
  parseStep,
  clampStep,
  snapshot,
  restoreSnapshot,
  applyRestoredSnapshot,
  getSnapshotAvailability,
}: UsePersistedWorkflowStepOptions<TStep, TSnapshot, TAvailability>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [step, setStepState] = useState<TStep>(defaultStep);
  const [hydrated, setHydrated] = useState(false);
  const stepRef = useRef(defaultStep);
  const searchParamsRef = useRef(searchParams);
  const selfNavigationSearchRef = useRef<string | null>(null);
  const parseStepRef = useRef(parseStep);
  const clampStepRef = useRef(clampStep);
  const currentAvailabilityRef = useRef(currentAvailability);
  const emptyAvailabilityRef = useRef(emptyAvailability);
  const restoreSnapshotRef = useRef(restoreSnapshot);
  const applyRestoredSnapshotRef = useRef(applyRestoredSnapshot);
  const getSnapshotAvailabilityRef = useRef(getSnapshotAvailability);

  const buildSearchParamsForStep = (nextStep: TStep, base: URLSearchParams) => {
    const next = new URLSearchParams(base);
    if (nextStep === defaultStep) {
      next.delete(searchParam);
    } else {
      next.set(searchParam, nextStep);
    }
    return next;
  };

  const commitStep = (
    requestedStep: TStep,
    historyMode: 'push' | 'replace'
  ) => {
    const safeStep = clampStepRef.current(requestedStep, currentAvailabilityRef.current);
    if (stepRef.current !== safeStep) {
      stepRef.current = safeStep;
      setStepState(safeStep);
    }

    const nextParams = buildSearchParamsForStep(safeStep, searchParamsRef.current);
    const currentSearch = searchParamsRef.current.toString();
    const nextSearch = nextParams.toString();
    if (nextSearch === currentSearch) {
      selfNavigationSearchRef.current = null;
      return safeStep;
    }

    selfNavigationSearchRef.current = nextSearch;
    setSearchParams(nextParams, { replace: historyMode === 'replace' });
    return safeStep;
  };

  useEffect(() => {
    parseStepRef.current = parseStep;
    clampStepRef.current = clampStep;
    currentAvailabilityRef.current = currentAvailability;
    emptyAvailabilityRef.current = emptyAvailability;
    restoreSnapshotRef.current = restoreSnapshot;
    applyRestoredSnapshotRef.current = applyRestoredSnapshot;
    getSnapshotAvailabilityRef.current = getSnapshotAvailability;
  }, [
    applyRestoredSnapshot,
    clampStep,
    currentAvailability,
    emptyAvailability,
    getSnapshotAvailability,
    parseStep,
    restoreSnapshot,
  ]);

  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    selfNavigationSearchRef.current = null;
    setHydrated(false);

    const urlStep = parseStepRef.current(searchParams.get(searchParam));
    let restoredSnapshot: TSnapshot | null = null;
    let savedStep: TStep | null = null;

    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as
          | PersistedWorkflowEnvelope<TStep, unknown>
          | Record<string, unknown>;

        if (
          parsed &&
          typeof parsed === "object" &&
          "version" in parsed &&
          "snapshot" in parsed
        ) {
          const envelope = parsed as PersistedWorkflowEnvelope<TStep, unknown>;
          savedStep = parseStepRef.current(
            typeof envelope.step === 'string' ? envelope.step : null
          );
          restoredSnapshot =
            envelope.version === version
              ? restoreSnapshotRef.current(envelope.snapshot)
              : restoreSnapshotRef.current(envelope.snapshot ?? parsed);
        } else {
          savedStep = parseStepRef.current(
            typeof parsed?.step === 'string' ? (parsed.step as string) : null
          );
          restoredSnapshot = restoreSnapshotRef.current(parsed);
        }
      }
    } catch (error) {
      console.error('Failed to restore persisted workflow state', error);
    }

    const restoredStep = clampStepRef.current(
      urlStep ?? savedStep ?? defaultStep,
      restoredSnapshot
        ? getSnapshotAvailabilityRef.current(restoredSnapshot)
        : emptyAvailabilityRef.current
    );

    applyRestoredSnapshotRef.current(restoredSnapshot, restoredStep);
    stepRef.current = restoredStep;
    setStepState(restoredStep);

    const nextParams = buildSearchParamsForStep(restoredStep, searchParamsRef.current);
    const currentSearch = searchParamsRef.current.toString();
    const nextSearch = nextParams.toString();
    if (nextSearch !== currentSearch) {
      selfNavigationSearchRef.current = nextSearch;
      setSearchParams(nextParams, { replace: true });
    }

    setHydrated(true);
  }, [defaultStep, searchParam, setSearchParams, storageKey, version]);

  useEffect(() => {
    if (!hydrated) return;
    const safeStep = clampStepRef.current(stepRef.current, currentAvailability);
    if (safeStep !== stepRef.current) {
      commitStep(safeStep, 'replace');
    }
  }, [currentAvailability, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const currentSearch = searchParams.toString();
    if (
      selfNavigationSearchRef.current !== null &&
      currentSearch === selfNavigationSearchRef.current
    ) {
      selfNavigationSearchRef.current = null;
      return;
    }

    const urlStep = parseStepRef.current(searchParams.get(searchParam));
    const safeStep = clampStepRef.current(
      urlStep ?? defaultStep,
      currentAvailabilityRef.current
    );
    if (safeStep !== stepRef.current) {
      stepRef.current = safeStep;
      setStepState(safeStep);
    }
  }, [defaultStep, hydrated, searchParam, searchParams]);

  useEffect(() => {
    if (!hydrated) return;
    const envelope: PersistedWorkflowEnvelope<TStep, TSnapshot> = {
      version,
      step,
      snapshot,
    };
    sessionStorage.setItem(storageKey, JSON.stringify(envelope));
  }, [hydrated, snapshot, step, storageKey, version]);

  const clearPersistedWorkflow = () => {
    sessionStorage.removeItem(storageKey);
  };

  const setStep = (requestedStep: TStep) => {
    commitStep(requestedStep, 'push');
  };

  const replaceStep = (requestedStep: TStep) => {
    commitStep(requestedStep, 'replace');
  };

  return {
    step,
    setStep,
    replaceStep,
    hydrated,
    clearPersistedWorkflow,
  };
}
