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
