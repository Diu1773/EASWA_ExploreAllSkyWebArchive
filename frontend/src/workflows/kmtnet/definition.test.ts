import { describe, expect, it } from 'vitest';
import { createKmtnetWorkflowDefinition } from './definition';

describe('createKmtnetWorkflowDefinition.normalizeSnapshot', () => {
  const definition = createKmtnetWorkflowDefinition({
    targetId: 'kmt-2022-blg-0440',
  });

  it('maps legacy step ids onto the new workflow', () => {
    expect(definition.parseStep('single')).toBe('field');
    expect(definition.parseStep('network')).toBe('merge');
    expect(definition.parseStep('lightcurve')).toBe('merge');
    expect(definition.parseStep('interpret')).toBe('fit');
    expect(definition.parseStep('align')).toBe('align');
    expect(definition.parseStep('difference')).toBe('difference');
  });

  it('restores legacy lcData snapshots', () => {
    const snapshot = definition.normalizeSnapshot({
      lcData: {
        target_id: 'kmt-2022-blg-0440',
        x_label: 'HJD',
        y_label: 'I-band Magnitude',
        points: [
          { hjd: 1, site: 'ctio', magnitude: 18.4, mag_error: 0.02 },
          { hjd: 2, site: 'saao', magnitude: 18.1, mag_error: 0.02 },
        ],
      },
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.previewFrameIndex).toBeNull();
    expect(snapshot?.mergedCurve?.points).toHaveLength(2);
    expect(snapshot?.fitResult).toBeNull();
  });

  it('drops malformed fit snapshots', () => {
    const snapshot = definition.normalizeSnapshot({
      lightCurve: {
        target_id: 'kmt-2022-blg-0440',
        x_label: 'HJD',
        y_label: 'I-band Magnitude',
        points: [
          { hjd: 1, site: 'ctio', magnitude: 18.4, mag_error: 0.02 },
        ],
      },
      fitResult: {
        t0: 1,
        u0: 0.1,
      },
    });

    expect(snapshot?.mergedCurve).not.toBeNull();
    expect(snapshot?.fitResult).toBeNull();
  });

  it('normalizes preview frame index from persisted snapshots', () => {
    const snapshot = definition.normalizeSnapshot({
      previewFrameIndex: 7.2,
      lightCurve: {
        target_id: 'kmt-2022-blg-0440',
        x_label: 'HJD',
        y_label: 'I-band Magnitude',
        points: [
          { hjd: 1, site: 'ctio', magnitude: 18.4, mag_error: 0.02 },
        ],
      },
    });

    expect(snapshot?.previewFrameIndex).toBe(7);
  });
});
