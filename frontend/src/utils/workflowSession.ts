export type WorkflowSessionSource =
  | { kind: 'live' }
  | { kind: 'record-seed'; id: number }
  | { kind: 'draft'; id: string };

export interface WorkflowSessionScope {
  workflowId: string;
  subjectId: string;
  source?: WorkflowSessionSource | null;
}

function sanitizeWorkflowSessionPart(value: string): string {
  const trimmed = value.trim();
  return trimmed === '' ? 'unknown' : trimmed.replace(/\s+/g, '_');
}

export function getWorkflowSessionSourceKey(
  source: WorkflowSessionSource | null | undefined
): string {
  if (!source || source.kind === 'live') return 'live';
  if (source.kind === 'record-seed') return `record-seed:${source.id}`;
  return `draft:${sanitizeWorkflowSessionPart(source.id)}`;
}

export function buildWorkflowSessionStorageKey(scope: WorkflowSessionScope): string {
  const workflowId = sanitizeWorkflowSessionPart(scope.workflowId);
  const subjectId = sanitizeWorkflowSessionPart(scope.subjectId);
  const sourceKey = getWorkflowSessionSourceKey(scope.source);
  return `workflow-session:${workflowId}:${subjectId}:${sourceKey}`;
}

export function createWorkflowDraftId(seed?: string | number | null): string {
  const normalizedSeed =
    seed === null || seed === undefined ? 'draft' : sanitizeWorkflowSessionPart(String(seed));
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${normalizedSeed}-${crypto.randomUUID()}`;
  }
  return `${normalizedSeed}-${Date.now().toString(36)}`;
}
