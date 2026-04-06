import { describe, expect, it } from 'vitest';
import { normalizeWorkflowDraftSearchParams } from './draftRoute';

describe('normalizeWorkflowDraftSearchParams', () => {
  it('normalizes legacy record params into seedRecord + draft', () => {
    const nextParams = normalizeWorkflowDraftSearchParams({
      searchParams: new URLSearchParams('record=12&step=run'),
      enableDrafts: true,
      subjectId: 'hat_p_7_b',
      userPresent: true,
      createDraftId: () => 'draft-from-record',
    });

    expect(nextParams).not.toBeNull();
    expect(nextParams?.get('record')).toBeNull();
    expect(nextParams?.get('seedRecord')).toBe('12');
    expect(nextParams?.get('draft')).toBe('draft-from-record');
    expect(nextParams?.get('step')).toBe('run');
  });

  it('creates a draft param for normal live entry when drafts are enabled', () => {
    const nextParams = normalizeWorkflowDraftSearchParams({
      searchParams: new URLSearchParams('step=select'),
      enableDrafts: true,
      subjectId: 'hats_5_b',
      userPresent: true,
      createDraftId: () => 'draft-live',
    });

    expect(nextParams?.get('draft')).toBe('draft-live');
    expect(nextParams?.get('step')).toBe('select');
  });

  it('returns null when no canonicalization is needed', () => {
    const nextParams = normalizeWorkflowDraftSearchParams({
      searchParams: new URLSearchParams('draft=existing&seedRecord=5'),
      enableDrafts: true,
      subjectId: 'hats_5_b',
      userPresent: true,
    });

    expect(nextParams).toBeNull();
  });
});
