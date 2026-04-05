export interface Topic {
  id: string;
  name: string;
  description: string;
  icon: string;
  target_count: number;
  preview_image_url?: string | null;
  preview_label?: string | null;
}

export interface TransitTargetFilters {
  maxTargets: number;
  minDepthPct: number;
  maxPeriodDays: number;
  maxHostVmag: number;
}

export interface Target {
  id: string;
  name: string;
  ra: number;
  dec: number;
  constellation: string;
  type: string;
  period_days: number | null;
  magnitude_range: string;
  description: string;
  topic_id: string;
  data_source?: string | null;
  stellar_temperature?: number | null;
  stellar_logg?: number | null;
  stellar_metallicity?: number | null;
}

export interface Observation {
  id: string;
  target_id: string;
  epoch: string;
  hjd: number;
  filter_band: string;
  exposure_sec: number;
  thumbnail_url: string;
  airmass: number;
  mission?: string | null;
  sector?: number | null;
  camera?: number | null;
  ccd?: number | null;
  display_label?: string | null;
  display_subtitle?: string | null;
  cutout_url?: string | null;
  frame_count?: number | null;
}
