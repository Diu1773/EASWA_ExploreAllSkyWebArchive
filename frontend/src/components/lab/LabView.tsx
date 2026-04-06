import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchTarget, fetchObservations, runPhotometry, buildLightCurve } from '../../api/client';
import { useAppStore } from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useWorkflowDraftRoute } from '../../hooks/useWorkflowDraftRoute';
import { ThumbnailStrip } from './ThumbnailStrip';
import { ParamsPanel } from './ParamsPanel';
import { PhotometryResult } from './PhotometryResult';
import { LightCurvePlot } from './LightCurvePlot';
import { TransitLab } from './TransitLab';
import type { Target, Observation } from '../../types/target';
import type {
  PhotometryMeasurement,
  LightCurveResponse,
} from '../../types/photometry';
import { buildDssPreviewUrl } from '../../utils/surveys';

export function LabView() {
  const { targetId } = useParams<{ targetId: string }>();
  const [target, setTarget] = useState<Target | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [measurements, setMeasurements] = useState<PhotometryMeasurement[]>([]);
  const [lightCurve, setLightCurve] = useState<LightCurveResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [foldEnabled, setFoldEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedIds = useAppStore((s) => s.selectedObservationIds);
  const aperture = useAppStore((s) => s.apertureRadius);
  const inner = useAppStore((s) => s.innerAnnulus);
  const outer = useAppStore((s) => s.outerAnnulus);
  const user = useAuthStore((s) => s.user);
  const isTransitTarget = target?.topic_id === 'exoplanet_transit';
  const {
    draftId: parsedDraftId,
    seedRecordId: parsedSeedRecordId,
    draftRestoreReady,
  } = useWorkflowDraftRoute({
    workflowId: 'transit_lab',
    subjectId: targetId,
    enableDrafts: Boolean(isTransitTarget),
    userPresent: Boolean(user),
    onError: setErrorMessage,
  });

  useEffect(() => {
    if (!targetId) return;

    Promise.all([fetchTarget(targetId), fetchObservations(targetId)]).then(
      ([detail, obs]) => {
        setTarget(detail.target);
        setObservations(obs);
      }
    ).catch((error) => {
      console.error('Failed to load lab data', error);
      setErrorMessage('Failed to load target data.');
    });
  }, [targetId]);

  const handleRunPhotometry = async () => {
    if (!targetId || selectedIds.length === 0) return;

    setErrorMessage(null);
    setLoading(true);

    try {
      const [photoRes, lcRes] = await Promise.all([
        runPhotometry({
          target_id: targetId,
          observation_ids: selectedIds,
          aperture_radius: aperture,
          inner_annulus: inner,
          outer_annulus: outer,
        }),
        buildLightCurve({
          target_id: targetId,
          observation_ids: selectedIds,
          aperture_radius: aperture,
          inner_annulus: inner,
          outer_annulus: outer,
          fold_period: foldEnabled && target?.period_days ? target.period_days : null,
        }),
      ]);

      setMeasurements(photoRes.measurements);
      setLightCurve(lcRes);
    } catch (error) {
      console.error('Photometry run failed', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to run photometry.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFold = async () => {
    const newFold = !foldEnabled;
    setFoldEnabled(newFold);
    setErrorMessage(null);

    if (!targetId || selectedIds.length === 0 || !target) return;

    try {
      const lcRes = await buildLightCurve({
        target_id: targetId,
        observation_ids: selectedIds,
        aperture_radius: aperture,
        inner_annulus: inner,
        outer_annulus: outer,
        fold_period: newFold && target.period_days ? target.period_days : null,
      });
      setLightCurve(lcRes);
    } catch (error) {
      console.error('Failed to rebuild light curve', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to update light curve.'
      );
    }
  };

  if (!target) {
    return <div className="loading">Loading...</div>;
  }

  if (isTransitTarget) {
    if (!draftRestoreReady) {
      return <div className="loading">Restoring draft...</div>;
    }
    return (
      <div className="lab-view">
        <div className="lab-header">
          <div className="lab-header-main">
            <Link to={`/target/${targetId}`} className="back-link">
              &larr; Back to Target
            </Link>
            <div className="lab-header-copy">
              <h2>Transit Lab: {target.name}</h2>
              <div className="target-meta">
                <span className="badge">{target.type}</span>
                <span>{target.constellation}</span>
                {target.period_days && <span>P = {target.period_days} d</span>}
              </div>
            </div>
          </div>
          <img
            src={buildDssPreviewUrl(target.ra, target.dec, { width: 360, height: 220, fovDeg: 0.22 })}
            alt={`${target.name} survey preview`}
            className="lab-header-preview"
          />
        </div>
        <TransitLab
          target={target}
          observations={observations}
          draftId={parsedDraftId}
          seedRecordId={parsedSeedRecordId}
        />
      </div>
    );
  }

  return (
    <div className="lab-view">
      <div className="lab-header">
        <div className="lab-header-main">
          <Link to={`/target/${targetId}`} className="back-link">
            &larr; Back to Target
          </Link>
          <div className="lab-header-copy">
            <h2>Lab: {target.name}</h2>
            <div className="target-meta">
              <span className="badge">{target.type}</span>
              <span>{target.constellation}</span>
              {target.period_days && <span>P = {target.period_days} d</span>}
            </div>
          </div>
        </div>
        <img
          src={buildDssPreviewUrl(target.ra, target.dec, { width: 360, height: 220, fovDeg: 0.22 })}
          alt={`${target.name} survey preview`}
          className="lab-header-preview"
        />
      </div>

      <div className="lab-content">
        <div className="lab-sidebar">
          <ThumbnailStrip
            observations={observations}
            selectedIds={selectedIds}
          />
          <ParamsPanel />
          <div className="lab-actions">
            <button
              className="btn-primary"
              onClick={handleRunPhotometry}
              disabled={selectedIds.length === 0 || loading}
            >
              {loading ? 'Running...' : 'Run Photometry'}
            </button>
            {errorMessage && <p className="hint error-text">{errorMessage}</p>}
            {lightCurve && (
              <label className="fold-toggle">
                <input
                  type="checkbox"
                  checked={foldEnabled}
                  onChange={handleToggleFold}
                />
                Phase Fold (P = {target.period_days} d)
              </label>
            )}
          </div>
        </div>

        <div className="lab-results">
          {lightCurve && <LightCurvePlot data={lightCurve} />}
          <PhotometryResult measurements={measurements} />
        </div>
      </div>
    </div>
  );
}
