import { useNavigate } from 'react-router-dom';
import type { Target } from '../../types/target';

function formatTargetSource(source?: string | null): string | null {
  if (!source) return null;
  if (source === 'nasa_exoplanet_archive') return 'NASA Exoplanet Archive';
  if (source === 'curated_fallback') return 'Curated fallback';
  return source.replace(/_/g, ' ');
}

interface TargetPopupProps {
  target: Target;
  gotoHint: string | null;
  gotoHintTone: 'info' | 'error' | null;
  gotoInProgress: boolean;
  gotoUnlocked: boolean;
  onGoto: () => void;
  onClose: () => void;
}

export function TargetPopup({
  target,
  gotoHint,
  gotoHintTone,
  gotoInProgress,
  gotoUnlocked,
  onGoto,
  onClose,
}: TargetPopupProps) {
  const navigate = useNavigate();
  const sourceLabel = formatTargetSource(target.data_source);

  return (
    <div className="target-popup">
      <div className="target-popup-header">
        <h3>{target.name}</h3>
        <button className="close-btn" onClick={onClose} aria-label="닫기">
          &times;
        </button>
      </div>
      <div className="target-popup-body">
        <p>
          <strong>Type:</strong> {target.type}
        </p>
        <p>
          <strong>Constellation:</strong> {target.constellation}
        </p>
        <p>
          <strong>Magnitude:</strong> {target.magnitude_range}
        </p>
        {target.period_days && (
          <p>
            <strong>Period:</strong> {target.period_days} days
          </p>
        )}
        {sourceLabel && (
          <p>
            <strong>Source:</strong> {sourceLabel}
          </p>
        )}
        <p className="target-desc">{target.description}</p>
      </div>
      <div className="target-popup-actions">
        <button
          className="btn-primary"
          disabled={gotoInProgress}
          onClick={onGoto}
        >
          {gotoInProgress ? 'GOTO: Slewing & Zooming...' : 'GOTO'}
        </button>
        <button
          className="btn-secondary"
          disabled={!gotoUnlocked || gotoInProgress}
          onClick={() => navigate(`/target/${target.id}`)}
        >
          View Details &amp; Observations
        </button>
      </div>
      {gotoHint ? (
        <p
          className={`target-popup-hint ${
            gotoHintTone === 'error' ? 'error-text' : 'info-text'
          }`}
        >
          {gotoHint}
        </p>
      ) : !gotoUnlocked ? (
        <p className="target-popup-hint">
          Run GOTO first. The detail button unlocks after slew and zoom finish.
        </p>
      ) : (
        <p className="target-popup-hint success-text">
          Detail view is unlocked.
        </p>
      )}
    </div>
  );
}
