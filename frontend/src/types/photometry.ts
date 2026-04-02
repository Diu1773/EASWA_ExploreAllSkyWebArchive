export interface PhotometryRequest {
  target_id: string;
  observation_ids: string[];
  aperture_radius: number;
  inner_annulus: number;
  outer_annulus: number;
}

export interface PhotometryMeasurement {
  observation_id: string;
  epoch: string;
  hjd: number;
  raw_flux: number;
  sky_flux: number;
  net_flux: number;
  instrumental_mag: number;
  mag_error: number;
}

export interface PhotometryResponse {
  target_id: string;
  aperture_radius: number;
  measurements: PhotometryMeasurement[];
}

export interface LightCurveRequest {
  target_id: string;
  observation_ids: string[];
  aperture_radius: number;
  inner_annulus: number;
  outer_annulus: number;
  fold_period: number | null;
}

export interface LightCurvePoint {
  hjd: number;
  phase: number | null;
  magnitude: number;
  mag_error: number;
}

export interface LightCurveResponse {
  target_id: string;
  period_days: number | null;
  points: LightCurvePoint[];
  x_label: string;
  y_label: string;
}
