export function buildDssPreviewUrl(
  ra: number,
  dec: number,
  options?: {
    width?: number;
    height?: number;
    fovDeg?: number;
  }
): string {
  const width = options?.width ?? 640;
  const height = options?.height ?? 360;
  const fovDeg = options?.fovDeg ?? 0.28;

  const params = new URLSearchParams({
    hips: 'P/DSS2/color',
    width: String(width),
    height: String(height),
    projection: 'TAN',
    coordsys: 'icrs',
    format: 'jpg',
    fov: String(fovDeg),
    ra: ra.toFixed(6),
    dec: dec.toFixed(6),
  });

  return `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${params.toString()}`;
}

export function buildDssAllSkyUrl(
  options?: {
    width?: number;
    height?: number;
    stretch?: 'power' | 'linear' | 'sqrt' | 'log' | 'asinh';
    minCut?: string;
    maxCut?: string;
  }
): string {
  const width = options?.width ?? 2048;
  const height = options?.height ?? Math.round(width / 2);
  const stretch = options?.stretch ?? 'asinh';
  const minCut = options?.minCut ?? '0.5%';
  const maxCut = options?.maxCut ?? '99.5%';

  const params = new URLSearchParams({
    hips: 'P/DSS2/color',
    width: String(width),
    height: String(height),
    projection: 'CAR',
    coordsys: 'icrs',
    format: 'jpg',
    fov: '360',
    ra: '180',
    dec: '0',
    inverse_longitude: 'true',
    stretch,
    min_cut: minCut,
    max_cut: maxCut,
  });

  return `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${params.toString()}`;
}
