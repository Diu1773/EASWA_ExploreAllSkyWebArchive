import { usePersistedWorkflowStep, type UsePersistedWorkflowStepOptions } from './usePersistedWorkflowStep';
import { buildWorkflowSessionStorageKey, type WorkflowSessionScope } from '../utils/workflowSession';

export interface UseWorkflowSessionOptions<
  TStep extends string,
  TSnapshot,
  TAvailability,
> extends Omit<
    UsePersistedWorkflowStepOptions<TStep, TSnapshot, TAvailability>,
    'storageKey'
  > {
  scope: WorkflowSessionScope;
}

export function useWorkflowSession<
  TStep extends string,
  TSnapshot,
  TAvailability,
>({
  scope,
  ...options
}: UseWorkflowSessionOptions<TStep, TSnapshot, TAvailability>) {
  return usePersistedWorkflowStep({
    ...options,
    storageKey: buildWorkflowSessionStorageKey(scope),
  });
}
