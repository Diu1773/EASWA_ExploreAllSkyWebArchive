import { describe, expect, it } from 'vitest';
import type { TransitFitResponse } from '../../types/transitFit';
import {
  buildBjdLightCurve,
  buildFitOverlayCurve,
  buildFitResidualCurve,
  fluxToDeltaMagnitude,
  transformLightCurveForDisplay,
} from './lightCurve';

const fitResultFixture: TransitFitResponse = {
  target_id: 'wasp-26-b',
  period: 2.7566,
  t0: 2093.15,
  reference_t0: 2093.15,
  limb_darkening_source: null,
  limb_darkening_filter: null,
  used_batman: true,
  used_mcmc: false,
  preprocessing: {
    fit_mode: 'bjd_window',
    fit_window_phase: 0.12,
    bjd_start: 2093.0,
    bjd_end: 2093.3,
    limb_darkening_source: null,
    limb_darkening_filter: null,
    baseline_order: 0,
    sigma_clip_sigma: 0,
    sigma_clip_iterations: 0,
    retained_points: 3,
    clipped_points: 0,
  },
  fitted_params: {
    rp_rs: 0.1,
    rp_rs_err: 0.01,
    a_rs: 8,
    a_rs_err: 0.5,
    inclination: 88,
    inclination_err: 0.2,
    u1: 0.3,
    u1_err: 0.01,
    u2: 0.2,
    u2_err: 0.01,
    chi_squared: 1,
    reduced_chi_squared: 1,
    degrees_of_freedom: 1,
  },
  initial_params: {
    rp_rs: 0.11,
    rp_rs_err: 0,
    a_rs: 7.5,
    a_rs_err: 0,
    inclination: 87.5,
    inclination_err: 0,
    u1: 0.28,
    u1_err: 0,
    u2: 0.18,
    u2_err: 0,
    chi_squared: 0,
    reduced_chi_squared: 0,
    degrees_of_freedom: 0,
  },
  model_curve: {
    phase: [-0.1, 0, 0.1],
    flux: [1.0, 0.99, 1.0],
  },
  initial_curve: {
    phase: [-0.1, 0, 0.1],
    flux: [1.0, 0.991, 1.0],
  },
  model_time: [2092.87434, 2093.15, 2093.42566],
  data_time: [2093.05, 2093.15, 2093.25],
  data_phase: [-0.036276, 0, 0.036276],
  data_flux: [1.0, 0.99, 1.0],
  data_error: [0.001, 0.001, 0.001],
  residuals: [0.0, -0.001, 0.0],
};

describe('transformLightCurveForDisplay', () => {
  it('converts BTJD flux points to orbital phase and delta magnitude', () => {
    const lightCurve = buildBjdLightCurve(
      [
        { hjd: 2093.15, phase: null, magnitude: 1.0, mag_error: 0.001 },
        { hjd: 2093.25, phase: null, magnitude: 0.99, mag_error: 0.001 },
      ],
      'wasp-26-b',
      2.7566
    );

    expect(lightCurve).not.toBeNull();

    const transformed = transformLightCurveForDisplay(lightCurve!, {
      xAxisMode: 'orbital_phase',
      yAxisMode: 'delta_mag',
      period: 2.7566,
      t0: 2093.15,
    });

    expect(transformed).not.toBeNull();
    expect(transformed?.x_label).toBe('Orbital Phase');
    expect(transformed?.y_label).toBe('Delta mag');
    expect(transformed?.points[0].phase).toBeCloseTo(0, 6);
    expect(transformed?.points[0].magnitude).toBeCloseTo(0, 6);
    expect(transformed?.points[1].magnitude).toBeCloseTo(0.010912, 6);
  });
});

describe('fit display curves', () => {
  it('keeps overlays on the sampled ROI x-range for both BTJD and orbital-phase views', () => {
    const bjdOverlay = buildFitOverlayCurve(
      fitResultFixture,
      'btjd',
      'normalized_flux'
    );
    const phaseOverlay = buildFitOverlayCurve(
      fitResultFixture,
      'orbital_phase',
      'delta_mag'
    );

    expect(bjdOverlay).not.toBeNull();
    expect(bjdOverlay?.x).toEqual(fitResultFixture.data_time);
    expect(bjdOverlay?.y[1]).toBeCloseTo(0.991, 6);

    expect(phaseOverlay).not.toBeNull();
    expect(phaseOverlay?.x).toEqual(fitResultFixture.data_phase);
    expect(phaseOverlay?.y[1]).toBeCloseTo(fluxToDeltaMagnitude(0.991), 6);
  });

  it('converts residuals into delta-magnitude units when requested', () => {
    const residualCurve = buildFitResidualCurve(
      fitResultFixture,
      'orbital_phase',
      'delta_mag'
    );

    expect(residualCurve).not.toBeNull();
    expect(residualCurve?.x).toEqual(fitResultFixture.data_phase);
    expect(residualCurve?.y[1]).toBeCloseTo(
      fluxToDeltaMagnitude(0.99) - fluxToDeltaMagnitude(0.991),
      6
    );
    expect(residualCurve?.error?.[1]).toBeGreaterThan(0);
  });
});
