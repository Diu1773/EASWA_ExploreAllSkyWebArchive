import { useAppStore } from '../../stores/useAppStore';
import type { Observation } from '../../types/target';

interface ObservationTableProps {
  observations: Observation[];
}

export function ObservationTable({ observations }: ObservationTableProps) {
  const selected = useAppStore((s) => s.selectedObservationIds);
  const toggle = useAppStore((s) => s.toggleObservation);
  const selectAll = useAppStore((s) => s.selectAllObservations);
  const clearSelections = useAppStore((s) => s.clearSelections);

  const allSelected = observations.length > 0 && selected.length === observations.length;
  const isTessTable = observations.some((obs) => obs.mission === 'TESS');
  const isKmtnetTable = observations.some((obs) => obs.mission === 'KMTNet');

  return (
    <div className="observation-table-wrap">
      <div className="obs-table-header">
        <div>
          <h4>Observations</h4>
          <p className="obs-table-subtitle">
          {isTessTable ? 'TESS sectors and cutout products' : 'Archive observation records'}
          </p>
        </div>
        <div className="obs-table-actions">
          <button
            className="btn-sm"
            onClick={() =>
              allSelected
                ? clearSelections()
                : selectAll(observations.map((o) => o.id))
            }
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          <span className="selected-count">{selected.length} selected</span>
        </div>
      </div>
      <table className="obs-table">
        <thead>
          {isTessTable ? (
            <tr>
              <th></th>
              <th>Sector</th>
              <th>Camera</th>
              <th>CCD</th>
              <th>Band</th>
              <th>Frames</th>
              <th>Cutout</th>
            </tr>
          ) : isKmtnetTable ? (
            <tr>
              <th></th>
              <th>Site</th>
              <th>Epoch</th>
              <th>HJD</th>
              <th>Filter</th>
              <th>Exp (s)</th>
              <th>Preview</th>
              <th>FITS</th>
            </tr>
          ) : (
            <tr>
              <th></th>
              <th>Epoch</th>
              <th>HJD</th>
              <th>Filter</th>
              <th>Exp (s)</th>
              <th>Airmass</th>
            </tr>
          )}
        </thead>
        <tbody>
          {observations.map((obs) => (
            <tr
              key={obs.id}
              className={selected.includes(obs.id) ? 'selected' : ''}
            >
              <td>
                <input
                  type="checkbox"
                  checked={selected.includes(obs.id)}
                  onChange={() => toggle(obs.id)}
                />
              </td>
              {isTessTable ? (
                <>
                  <td>{obs.display_label ?? `Sector ${obs.sector ?? '-'}`}</td>
                  <td>{obs.camera ?? '-'}</td>
                  <td>{obs.ccd ?? '-'}</td>
                  <td>{obs.filter_band}</td>
                  <td>
                    {obs.frame_count !== null && obs.frame_count !== undefined
                      ? obs.frame_count.toLocaleString()
                      : 'n/a'}
                  </td>
                  <td>
                    {obs.cutout_url ? (
                      <a
                        href={obs.cutout_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-link"
                      >
                        FITS
                      </a>
                    ) : (
                      'Pending'
                    )}
                  </td>
                </>
              ) : isKmtnetTable ? (
                <>
                  <td>{obs.display_label ?? '-'}</td>
                  <td>{obs.epoch.includes('T') ? new Date(obs.epoch).toLocaleString() : obs.epoch}</td>
                  <td>{obs.hjd.toFixed(5)}</td>
                  <td>{obs.filter_band}</td>
                  <td>{obs.exposure_sec}</td>
                  <td>
                    {obs.thumbnail_url ? (
                      <a
                        href={obs.thumbnail_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-link"
                      >
                        JPG
                      </a>
                    ) : (
                      'n/a'
                    )}
                  </td>
                  <td>
                    {obs.cutout_url ? (
                      <a
                        href={obs.cutout_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-link"
                      >
                        FITS
                      </a>
                    ) : (
                      'n/a'
                    )}
                  </td>
                </>
              ) : (
                <>
                  <td>{new Date(obs.epoch).toLocaleDateString()}</td>
                  <td>{obs.hjd.toFixed(4)}</td>
                  <td>{obs.filter_band}</td>
                  <td>{obs.exposure_sec}</td>
                  <td>{obs.airmass.toFixed(3)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
