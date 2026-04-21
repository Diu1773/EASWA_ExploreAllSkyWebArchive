import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../stores/useAppStore';
import type { Target } from '../../types/target';
import {
  buildLabHref,
  getExplorerContext,
} from '../../utils/explorerNavigation';

interface AnalysisLauncherProps {
  target: Target;
}

export function AnalysisLauncher({ target }: AnalysisLauncherProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const selected = useAppStore((s) => s.selectedObservationIds);
  const isTransitTarget = target.topic_id === 'exoplanet_transit';
  const isMicrolensingTarget = target.topic_id === 'microlensing';
  const context = getExplorerContext(new URLSearchParams(location.search), {
    topicId: target.topic_id,
  });
  const extraEntries: Array<[string, string]> = [];

  if (isTransitTarget) {
    extraEntries.push(['workflow', 'transit']);
  }

  if (isMicrolensingTarget) {
    extraEntries.push(['workflow', 'microlensing']);
    extraEntries.push(['step', 'field']);
  }

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
        onClick={() => navigate(buildLabHref(target.id, context, extraEntries))}
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
