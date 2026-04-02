import type { LightCurvePoint } from './photometry';

export interface TransitFitRequest {
  target_id: string;
  period: number;
  t0: number;
  fit_limb_darkening: boolean;
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

export interface TransitFitResponse {
  target_id: string;
  period: number;
  t0: number;
  fitted_params: TransitFitParameters;
  initial_params: TransitFitParameters;
  model_curve: TransitModelCurve;
  initial_curve: TransitModelCurve;
  data_phase: number[];
  data_flux: number[];
  data_error: number[];
  residuals: number[];
}
