import { useEffect, useRef, useState } from 'react';
import { upsertMyWorkflowDraft } from '../api/client';
import type { PersistedWorkflowEnvelope } from './usePersistedWorkflowStep';

export type WorkflowDraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseWorkflowDraftAutosaveOptions<TStep extends string, TSnapshot> {
  draftId: string | null | undefined;
  workflowId: string;
  subjectId: string;
  title: string;
  seedRecordId?: number | null;
  userPresent: boolean;
  hydrated: boolean;
  restoreReady: boolean;
  version: number;
  step: TStep;
  snapshot: TSnapshot;
  hasMeaningfulSnapshot: (step: TStep, snapshot: TSnapshot) => boolean;
  debounceMs?: number;
}

interface WorkflowDraftAutosaveState {
  status: WorkflowDraftSaveStatus;
  savedAtLabel: string | null;
}

export function useWorkflowDraftAutosave<TStep extends string, TSnapshot>({
  draftId,
  workflowId,
  subjectId,
  title,
  seedRecordId = null,
  userPresent,
  hydrated,
  restoreReady,
  version,
  step,
  snapshot,
  hasMeaningfulSnapshot,
  debounceMs = 600,
}: UseWorkflowDraftAutosaveOptions<TStep, TSnapshot>): WorkflowDraftAutosaveState {
  const [status, setStatus] = useState<WorkflowDraftSaveStatus>(draftId ? 'saved' : 'idle');
  const [savedAtLabel, setSavedAtLabel] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!draftId) {
      setStatus('idle');
      setSavedAtLabel(null);
      lastSignatureRef.current = null;
      return;
    }
    if (!userPresent || !hydrated || !restoreReady) return;

    if (!hasMeaningfulSnapshot(step, snapshot)) {
      setStatus('idle');
      setSavedAtLabel(null);
      lastSignatureRef.current = null;
      return;
    }

    const envelope: PersistedWorkflowEnvelope<TStep, TSnapshot> = {
      version,
      step,
      snapshot,
    };
    const serializedEnvelope = JSON.stringify(envelope);

    if (serializedEnvelope === lastSignatureRef.current) {
      return;
    }

    setStatus('saving');
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    timeoutRef.current = setTimeout(() => {
      const parsedEnvelope = JSON.parse(serializedEnvelope) as Record<string, unknown>;
      void upsertMyWorkflowDraft(draftId, {
        workflow: workflowId,
        target_id: subjectId,
        title,
        seed_record_id: seedRecordId,
        status: 'active',
        workflow_version: version,
        envelope: parsedEnvelope,
      })
        .then(() => {
          lastSignatureRef.current = serializedEnvelope;
          setStatus('saved');
          setSavedAtLabel(
            new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
          );
        })
        .catch((error) => {
          console.error('Failed to autosave workflow draft', error);
          lastSignatureRef.current = null;
          setStatus('error');
        });
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [
    debounceMs,
    draftId,
    hasMeaningfulSnapshot,
    hydrated,
    restoreReady,
    seedRecordId,
    snapshot,
    step,
    subjectId,
    title,
    userPresent,
    version,
    workflowId,
  ]);

  return {
    status,
    savedAtLabel,
  };
}
