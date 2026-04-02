import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../stores/useAppStore';
import type { Target } from '../../types/target';

interface AnalysisLauncherProps {
  target: Target;
}

export function AnalysisLauncher({ target }: AnalysisLauncherProps) {
  const navigate = useNavigate();
  const selected = useAppStore((s) => s.selectedObservationIds);
  const isTransitTarget = target.topic_id === 'exoplanet_transit';

  return (
    <div className="analysis-launcher">
      <div className="analysis-launcher-head">
        <h4>Analysis Tools</h4>
        <span className="analysis-launcher-tag">
          {isTransitTarget ? 'TESS WORKFLOW' : 'PHOTOMETRY'}
        </span>
      </div>
      <button
        className="btn-primary"
        disabled={selected.length === 0}
        onClick={() => navigate(`/lab/${target.id}`)}
      >
        {isTransitTarget ? 'Transit Analysis (TESS)' : 'Photometry & Light Curve'}
        {selected.length > 0 && ` (${selected.length} obs)`}
      </button>
      {selected.length === 0 && (
        <p className="hint">Select observations above to enable analysis.</p>
      )}
      {isTransitTarget && selected.length > 0 && (
        <p className="hint">
          Selected sectors will feed the TESS FITS transit workflow.
        </p>
      )}
    </div>
  );
}
