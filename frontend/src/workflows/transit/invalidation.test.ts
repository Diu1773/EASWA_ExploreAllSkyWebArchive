import { describe, expect, it } from 'vitest';
import { reduceTransitInvalidation } from './invalidation';

describe('reduceTransitInvalidation', () => {
  it('returns a full reset scope for observation changes', () => {
    const resolution = reduceTransitInvalidation(
      {
        step: 'transitfit',
        hasPhotometryResult: true,
      },
      { type: 'observation-changed' }
    );

    expect(resolution.clearPreviewRuntime).toBe(true);
    expect(resolution.clearPhotometryResult).toBe(true);
    expect(resolution.clearFitState).toBe(true);
    expect(resolution.clearSelectionState).toBe(true);
    expect(resolution.clearWindowSelection).toBe(true);
    expect(resolution.resetRecordDraft).toBe(true);
    expect(resolution.nextStep).toBe('select');
  });

  it('keeps preview/setup but invalidates downstream analysis when config changes', () => {
    const resolution = reduceTransitInvalidation(
      {
        step: 'record',
        hasPhotometryResult: true,
      },
      { type: 'analysis-config-changed' }
    );

    expect(resolution.clearPreviewRuntime).toBe(false);
    expect(resolution.clearSelectionState).toBe(false);
    expect(resolution.clearPhotometryResult).toBe(true);
    expect(resolution.clearFitState).toBe(true);
    expect(resolution.clearSubmittedRecord).toBe(true);
    expect(resolution.nextStep).toBe('run');
  });

  it('keeps the current step when there is no downstream photometry result to invalidate', () => {
    const resolution = reduceTransitInvalidation(
      {
        step: 'run',
        hasPhotometryResult: false,
      },
      { type: 'analysis-config-changed' }
    );

    expect(resolution.clearPhotometryResult).toBe(false);
    expect(resolution.nextStep).toBeNull();
  });
});
