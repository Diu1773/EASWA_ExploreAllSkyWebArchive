import { describe, expect, it } from 'vitest';
import { createTransitWorkflowDefinition } from './definition';

describe('createTransitWorkflowDefinition.normalizeSnapshot', () => {
  const definition = createTransitWorkflowDefinition({
    targetId: 'wasp_26_b',
    targetPeriodDays: 2.7566,
    defaultAperture: {
      apertureRadius: 3,
      innerAnnulus: 6,
      outerAnnulus: 9,
    },
  });

  it('treats legacy persisted foldT0 values as automatic by default', () => {
    const snapshot = definition.normalizeSnapshot({
      activeObservationId: 'sector-1',
      foldEnabled: true,
      foldPeriod: 2.7566,
      foldT0: 2457000.1234,
      fitDataSource: 'phase_fold',
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.foldT0).toBe(2457000.1234);
    expect(snapshot?.foldT0Auto).toBe(true);
  });

  it('preserves explicit manual foldT0 overrides in new snapshots', () => {
    const snapshot = definition.normalizeSnapshot({
      activeObservationId: 'sector-1',
      foldEnabled: true,
      foldPeriod: 2.7566,
      foldT0: 2457000.1234,
      foldT0Auto: false,
      fitDataSource: 'phase_fold',
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.foldT0Auto).toBe(false);
  });
});
