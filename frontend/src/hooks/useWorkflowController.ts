import { useWorkflowDraftAutosave, type WorkflowDraftSaveStatus } from './useWorkflowDraftAutosave';
import {
  useWorkflowSession,
  type UseWorkflowSessionOptions,
} from './useWorkflowSession';

interface WorkflowControllerDraftOptions<TStep extends string, TSnapshot> {
  draftId: string | null | undefined;
  title: string;
  userPresent: boolean;
  seedRecordId?: number | null;
  restoreReady?: boolean;
  getRestoreReady?: (session: {
    hydrated: boolean;
    hasRestoredSnapshot: boolean;
    step: TStep;
  }) => boolean;
  debounceMs?: number;
  hasMeaningfulSnapshot: (step: TStep, snapshot: TSnapshot) => boolean;
}

interface UseWorkflowControllerOptions<
  TStep extends string,
  TSnapshot,
  TAvailability,
> extends UseWorkflowSessionOptions<TStep, TSnapshot, TAvailability> {
  draft?: WorkflowControllerDraftOptions<TStep, TSnapshot> | null;
}

interface WorkflowControllerResult<TStep extends string> {
  step: TStep;
  setStep: (requestedStep: TStep) => void;
  replaceStep: (requestedStep: TStep) => void;
  hydrated: boolean;
  hasRestoredSnapshot: boolean;
  clearPersistedWorkflow: () => void;
  draftSaveStatus: WorkflowDraftSaveStatus;
  draftSavedAtLabel: string | null;
}

export function useWorkflowController<
  TStep extends string,
  TSnapshot,
  TAvailability,
>({
  draft = null,
  scope,
  version,
  snapshot,
  ...sessionOptions
}: UseWorkflowControllerOptions<TStep, TSnapshot, TAvailability>): WorkflowControllerResult<
  TStep
> {
  const session = useWorkflowSession({
    scope,
    version,
    snapshot,
    ...sessionOptions,
  });

  const autosave = useWorkflowDraftAutosave({
    draftId: draft?.draftId,
    workflowId: scope.workflowId,
    subjectId: scope.subjectId,
    title: draft?.title ?? `${scope.subjectId} draft`,
    seedRecordId: draft?.seedRecordId ?? null,
    userPresent: draft?.userPresent ?? false,
    hydrated: session.hydrated,
    restoreReady:
      draft?.getRestoreReady?.({
        hydrated: session.hydrated,
        hasRestoredSnapshot: session.hasRestoredSnapshot,
        step: session.step,
      }) ??
      draft?.restoreReady ??
      true,
    version,
    step: session.step,
    snapshot,
    hasMeaningfulSnapshot: draft?.hasMeaningfulSnapshot ?? (() => false),
    debounceMs: draft?.debounceMs,
  });

  return {
    ...session,
    draftSaveStatus: autosave.status,
    draftSavedAtLabel: autosave.savedAtLabel,
  };
}
