export interface WorkflowDefinition<
  TStep extends string,
  TSnapshot,
  TAvailability,
> {
  workflowId: string;
  version: number;
  defaultStep: TStep;
  parseStep: (value: string | null) => TStep | null;
  clampStep: (requestedStep: TStep, availability: TAvailability) => TStep;
  normalizeSnapshot: (raw: unknown) => TSnapshot | null;
  getAvailability: (snapshot: TSnapshot | null) => TAvailability;
  hasMeaningfulSnapshot: (step: TStep, snapshot: TSnapshot) => boolean;
}
