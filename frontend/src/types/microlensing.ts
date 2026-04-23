export interface MicrolensingPoint {
  hjd: number;
  site: string;
  magnitude: number;
  mag_error: number;
}

export interface MicrolensingLightCurveResponse {
  target_id: string;
  points: MicrolensingPoint[];
  x_label: string;
  y_label: string;
  extraction_mode: string;
  requested_sites: string[];
  included_sites: string[];
  missing_sites: string[];
  sampled_observation_ids: Record<string, string[]>;
  reference_observation_ids: Record<string, string>;
  excluded_observation_ids: Record<string, string[]>;
  warnings: string[];
  is_complete: boolean;
}

export interface MicrolensingFitInputPoint {
  hjd: number;
  magnitude: number;
  mag_error: number;
}

export interface MicrolensingFitRequest {
  target_id: string;
  points: MicrolensingFitInputPoint[];
  t0_init?: number | null;
  u0_init?: number | null;
  tE_init?: number | null;
}

export interface MicrolensingModelPoint {
  hjd: number;
  magnitude: number;
}

export interface MicrolensingFitResponse {
  t0: number;
  u0: number;
  tE: number;
  mag_base: number;
  t0_err: number;
  u0_err: number;
  tE_err: number;
  mag_base_err: number;
  chi2_dof: number;
  model_curve: MicrolensingModelPoint[];
}

export interface MicrolensingPixelCoordinate {
  x: number;
  y: number;
}

export interface MicrolensingPreviewFrameMetadata {
  frame_index: number;
  observation_id: string;
  hjd: number;
  site: string;
  filter_band: string | null;
  exposure_sec: number | null;
  airmass: number | null;
  magnitude: number;
  mag_error: number;
  baseline_magnitude: number;
  magnification: number;
}

export interface MicrolensingPreviewResponse {
  target_id: string;
  site: string;
  site_label: string;
  frame_index: number;
  frame_count: number;
  sample_frame_indices: number[];
  cutout_size_px: number;
  cutout_width_px: number;
  cutout_height_px: number;
  preview_width_px: number;
  preview_height_px: number;
  target_position: MicrolensingPixelCoordinate;
  raw_target_position: MicrolensingPixelCoordinate;
  aligned_target_position: MicrolensingPixelCoordinate;
  reference_target_position: MicrolensingPixelCoordinate;
  reference_frame_index: number;
  reference_candidate_indices: number[];
  reference_observation_id: string;
  reference_hjd: number;
  registration_dx_px: number;
  registration_dy_px: number;
  registration_quality_score: number;
  registration_hit_limit: boolean;
  registration_warning: string | null;
  frame_metadata: MicrolensingPreviewFrameMetadata;
  raw_image_data_url: string;
  aligned_image_data_url: string;
  reference_image_data_url: string;
  difference_image_data_url: string;
}

export interface MicrolensingPreviewBundleResponse {
  target_id: string;
  site: string;
  focus_frame_index: number;
  reference_frame_index: number;
  bundle_frame_indices: number[];
  previews: MicrolensingPreviewResponse[];
}
