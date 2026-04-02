import type { PhotometryMeasurement } from '../../types/photometry';

interface PhotometryResultProps {
  measurements: PhotometryMeasurement[];
}

export function PhotometryResult({ measurements }: PhotometryResultProps) {
  if (measurements.length === 0) return null;

  return (
    <div className="photometry-result">
      <h4>Photometry Measurements</h4>
      <div className="result-table-wrap">
        <table className="result-table">
          <thead>
            <tr>
              <th>#</th>
              <th>HJD</th>
              <th>Raw Flux</th>
              <th>Sky Flux</th>
              <th>Net Flux</th>
              <th>Inst. Mag</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {measurements.map((m, i) => (
              <tr key={m.observation_id}>
                <td>{i + 1}</td>
                <td>{m.hjd.toFixed(4)}</td>
                <td>{m.raw_flux.toFixed(1)}</td>
                <td>{m.sky_flux.toFixed(1)}</td>
                <td>{m.net_flux.toFixed(1)}</td>
                <td>{m.instrumental_mag.toFixed(4)}</td>
                <td>&plusmn;{m.mag_error.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
