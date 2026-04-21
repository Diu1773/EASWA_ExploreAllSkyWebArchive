import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { runPhotometry, buildLightCurve } from '../../api/client';
import { useAppStore } from '../../stores/useAppStore';
import { useLabData } from '../../hooks/useLabData';
import { useAuthStore } from '../../stores/useAuthStore';
import { useWorkflowDraftRoute } from '../../hooks/useWorkflowDraftRoute';
import { ThumbnailStrip } from './ThumbnailStrip';
import { ParamsPanel } from './ParamsPanel';
import { PhotometryResult } from './PhotometryResult';
import { LightCurvePlot } from './LightCurvePlot';
import { TransitLab } from './TransitLab';
import { KmtnetLab } from './KmtnetLab';
import type {
  PhotometryMeasurement,
  LightCurveResponse,
} from '../../types/photometry';
import { buildDssPreviewUrl } from '../../utils/surveys';
import {
  alignExplorerContext,
  buildExplorerContextSearchParams,
  buildTargetHref,
  getExplorerContext,
} from '../../utils/explorerNavigation';

// Map topic_id → workflow identifier
const TOPIC_WORKFLOW: Record<string, string> = {
  exoplanet_transit: 'transit',
  microlensing: 'microlensing',
};

export function LabView() {
  const { targetId } = useParams<{ targetId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { target, observations, error: loadError } = useLabData(targetId);
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

  // Resolve workflow: prefer ?workflow= URL param (so back/forward works before
  // target data loads), fall back to topic_id once target is available.
  const workflowParam = searchParams.get('workflow');
  const topicWorkflow = target?.topic_id ? (TOPIC_WORKFLOW[target.topic_id] ?? null) : null;
  const resolvedWorkflow = workflowParam ?? topicWorkflow;
  const navigationContext = useMemo(() => {
    const ctx = getExplorerContext(searchParams, { topicId: target?.topic_id ?? null });
    return target === null ? ctx : alignExplorerContext(ctx, target.topic_id);
  }, [searchParams, target]);

  useEffect(() => {
    if (!target || !resolvedWorkflow) return;
    const next = new URLSearchParams(searchParams);
    next.delete('module');
    next.delete('topic');
    next.delete('site');
    next.delete('workflow');

    const canonical = buildExplorerContextSearchParams(
      navigationContext,
      [['workflow', resolvedWorkflow]]
    );
    canonical.forEach((value, key) => {
      next.set(key, value);
    });

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [navigationContext, resolvedWorkflow, searchParams, setSearchParams, target]);

  const isTransitWorkflow = resolvedWorkflow === 'transit';
  const isMicrolensingWorkflow = resolvedWorkflow === 'microlensing';

  const {
    draftId: parsedDraftId,
    seedRecordId: parsedSeedRecordId,
    draftRestoreReady,
  } = useWorkflowDraftRoute({
    workflowId: isMicrolensingWorkflow ? 'kmtnet_lab' : 'transit_lab',
    subjectId: targetId,
    enableDrafts: isTransitWorkflow || isMicrolensingWorkflow,
    userPresent: Boolean(user),
    onError: setErrorMessage,
  });

  useEffect(() => {
    if (loadError) setErrorMessage(loadError);
  }, [loadError]);

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

  const targetHref = buildTargetHref(targetId ?? target.id, {
    ...navigationContext,
    topicId: target.topic_id,
  });

  if (isMicrolensingWorkflow) {
    if (!draftRestoreReady) {
      return <div className="loading">Restoring draft...</div>;
    }
    return (
      <div className="lab-view">
        <div className="lab-header">
          <div className="lab-header-main">
            <Link to={targetHref} className="back-link">
              &larr; Back to Target
            </Link>
            <div className="lab-header-copy">
              <h2>Microlensing Lab: {target.name}</h2>
              <div className="target-meta">
                <span className="badge">{target.type}</span>
                <span>{target.constellation}</span>
                <span>KMTNet</span>
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
          <div className="lab-results kmtnet-results">
            <KmtnetLab
              target={target}
              observations={observations}
              siteId={navigationContext.siteId ?? 'ctio'}
              draftId={parsedDraftId}
              seedRecordId={parsedSeedRecordId}
            />
          </div>
        </div>
      </div>
    );
  }

  if (isTransitWorkflow) {
    if (!draftRestoreReady) {
      return <div className="loading">Restoring draft...</div>;
    }
    return (
      <div className="lab-view">
        <div className="lab-header">
          <div className="lab-header-main">
            <Link to={targetHref} className="back-link">
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
          <Link to={targetHref} className="back-link">
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
