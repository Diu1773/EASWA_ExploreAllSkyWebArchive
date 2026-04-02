import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchTarget, fetchObservations } from '../../api/client';
import { useAppStore } from '../../stores/useAppStore';
import { ObservationTable } from './ObservationTable';
import { AnalysisLauncher } from './AnalysisLauncher';
import type { Target, Observation } from '../../types/target';
import { buildDssPreviewUrl } from '../../utils/surveys';

function formatTargetSource(source?: string | null): string | null {
  if (!source) return null;
  if (source === 'nasa_exoplanet_archive') return 'NASA Exoplanet Archive';
  if (source === 'curated_fallback') return 'Curated fallback';
  return source.replace(/_/g, ' ');
}

export function TargetDetail() {
  const { targetId } = useParams<{ targetId: string }>();
  const [target, setTarget] = useState<Target | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const setCurrentTarget = useAppStore((s) => s.setCurrentTarget);

  useEffect(() => {
    if (!targetId) return;
    setLoading(true);

    Promise.all([fetchTarget(targetId), fetchObservations(targetId)]).then(
      ([detail, obs]) => {
        setTarget(detail.target);
        setCurrentTarget(detail.target);
        setObservations(obs);
        setLoading(false);
      }
    );
  }, [targetId]);

  if (loading || !target) {
    return <div className="loading">Loading target data...</div>;
  }

  const sourceLabel = formatTargetSource(target.data_source);

  return (
    <div className="target-detail">
      <div className="detail-header">
        <Link to="/" className="back-link">
          &larr; Back to Sky Explorer
        </Link>
        <div className="detail-overview">
          <div className="detail-summary">
            <h2>{target.name}</h2>
            <div className="target-meta">
              <span className="badge">{target.type}</span>
              <span>{target.constellation}</span>
              <span>RA: {target.ra.toFixed(4)}&deg;</span>
              <span>Dec: {target.dec.toFixed(4)}&deg;</span>
              <span>Mag: {target.magnitude_range}</span>
              {target.period_days && <span>P = {target.period_days} d</span>}
              {sourceLabel && <span>Source: {sourceLabel}</span>}
            </div>
            <p className="target-description">{target.description}</p>
          </div>

          <div className="detail-survey-card">
            <img
              src={buildDssPreviewUrl(target.ra, target.dec, { width: 640, height: 360, fovDeg: 0.28 })}
              alt={`${target.name} DSS2 preview`}
              className="detail-survey-image"
            />
            <div className="detail-survey-meta">
              <span>DSS2</span>
              <span>{target.constellation}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="detail-body">
        <ObservationTable observations={observations} />
        <AnalysisLauncher target={target} />
      </div>
    </div>
  );
}
