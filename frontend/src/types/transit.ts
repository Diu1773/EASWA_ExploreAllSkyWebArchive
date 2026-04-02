import type { LightCurveResponse } from './photometry';

export interface PixelCoordinate {
  x: number;
  y: number;
}

export interface ApertureParams {
  apertureRadius: number;
  innerAnnulus: number;
  outerAnnulus: number;
}

export interface StarOverlay {
  label: string;
  position: PixelCoordinate;
  aperture: ApertureParams;
  type: 'target' | 'comparison';
  selected: boolean;
}

export interface TransitCutoutPreview {
  target_id: string;
  observation_id: string;
  sector: number;
  camera: number | null;
  ccd: number | null;
  preview_mode: 'median' | 'frame';
  frame_index: number | null;
  sample_frame_indices: number[];
  cutout_size_px: number;
  cutout_width_px: number;
  cutout_height_px: number;
  preview_width_px: number;
  preview_height_px: number;
  frame_count: number;
  time_start: number;
  time_end: number;
  frame_metadata?: TransitFrameMetadata | null;
  target_position: PixelCoordinate;
  image_data_url: string;
}

export interface TransitFrameMetadata {
  frame_index: number | null;
  btjd: number | null;
  cadence_number: number | null;
  quality_flag: number | null;
  finite_fraction: number | null;
  finite_pixels: number | null;
  total_pixels: number | null;
  flux_min: number | null;
  flux_median: number | null;
  flux_max: number | null;
}

export interface TransitPhotometryRequest {
  target_id: string;
  observation_id: string;
  cutout_size_px: number;
  target_position: PixelCoordinate;
  comparison_positions: PixelCoordinate[];
  aperture_radius: number;
  inner_annulus: number;
  outer_annulus: number;
}

export interface TransitPhotometryResponse {
  target_id: string;
  observation_id: string;
  sector: number;
  frame_count: number;
  comparison_count: number;
  target_position: PixelCoordinate;
  comparison_positions: PixelCoordinate[];
  target_median_flux: number;
  comparison_median_flux: number;
  light_curve: LightCurveResponse;
}

export interface TransitPreviewJob {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  result: TransitCutoutPreview | null;
  error: string | null;
}
