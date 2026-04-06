import { createWorkflowDraftId } from '../../utils/workflowSession';

export interface NormalizeWorkflowDraftRouteOptions {
  searchParams: URLSearchParams;
  enableDrafts: boolean;
  subjectId: string | null | undefined;
  userPresent: boolean;
  createDraftId?: (seed?: string | number | null) => string;
}

export function normalizeWorkflowDraftSearchParams({
  searchParams,
  enableDrafts,
  subjectId,
  userPresent,
  createDraftId = createWorkflowDraftId,
}: NormalizeWorkflowDraftRouteOptions): URLSearchParams | null {
  if (!enableDrafts || !subjectId) return null;

  const nextParams = new URLSearchParams(searchParams);
  const draftParam = searchParams.get('draft');
  const seedRecordParam = searchParams.get('seedRecord');
  const legacyRecordParam = searchParams.get('record');
  let changed = false;

  const rawSeedRecord = seedRecordParam ?? legacyRecordParam;
  if (rawSeedRecord) {
    const normalizedRecordId = Number(rawSeedRecord);
    if (Number.isFinite(normalizedRecordId)) {
      if (legacyRecordParam) {
        nextParams.delete('record');
        changed = true;
      }
      if (nextParams.get('seedRecord') !== String(normalizedRecordId)) {
        nextParams.set('seedRecord', String(normalizedRecordId));
        changed = true;
      }
      if (!draftParam && userPresent) {
        nextParams.set('draft', createDraftId(`record-${normalizedRecordId}`));
        changed = true;
      }
    }
  }

  if (!draftParam && userPresent) {
    nextParams.set('draft', createDraftId(subjectId));
    changed = true;
  }

  if (!changed || nextParams.toString() === searchParams.toString()) {
    return null;
  }

  return nextParams;
}
