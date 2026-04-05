import type { LightCurvePoint } from './photometry';

export interface TransitFitRequest {
  target_id: string;
  period: number;
  t0: number;
  fit_mode: 'phase_fold' | 'bjd_window';
  bjd_start?: number | null;
  bjd_end?: number | null;
  fit_limb_darkening: boolean;
  fit_window_phase: number;
  baseline_order: number;
  sigma_clip_sigma: number;
  sigma_clip_iterations: number;
  filter_name?: string | null;
  stellar_temperature?: number | null;
  stellar_logg?: number | null;
  stellar_metallicity?: number | null;
  points: LightCurvePoint[];
}

export interface TransitFitParameters {
  rp_rs: number;
  rp_rs_err: number;
  a_rs: number;
  a_rs_err: number;
  inclination: number;
  inclination_err: number;
  u1: number;
  u1_err: number;
  u2: number;
  u2_err: number;
  chi_squared: number;
  reduced_chi_squared: number;
  degrees_of_freedom: number;
}

export interface TransitModelCurve {
  phase: number[];
  flux: number[];
}

export interface TransitFitPreprocessing {
  fit_mode: 'phase_fold' | 'bjd_window';
  fit_window_phase: number;
  bjd_start: number | null;
  bjd_end: number | null;
  limb_darkening_source?: string | null;
  limb_darkening_filter?: string | null;
  baseline_order: number;
  sigma_clip_sigma: number;
  sigma_clip_iterations: number;
  retained_points: number;
  clipped_points: number;
}

export interface TransitFitResponse {
  target_id: string;
  period: number;
  t0: number;
  reference_t0: number;
  limb_darkening_source?: string | null;
  limb_darkening_filter?: string | null;
  used_batman: boolean;
  used_mcmc: boolean;
  preprocessing: TransitFitPreprocessing;
  fitted_params: TransitFitParameters;
  initial_params: TransitFitParameters;
  model_curve: TransitModelCurve;
  initial_curve: TransitModelCurve;
  model_time: number[];
  data_time: number[];
  data_phase: number[];
  data_flux: number[];
  data_error: number[];
  residuals: number[];
}
