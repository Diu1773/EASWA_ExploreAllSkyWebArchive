import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  createRecordShareLink,
  downloadMyRecordPhotometryCsv,
  fetchMyRecordSubmission,
  fetchRecordTemplate,
} from '../../api/client';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatAnswerValue, formatMetric } from '../../utils/recordFormat';
import type { RecordListItem, RecordTemplate } from '../../types/record';

type RecordPayload = {
  template?: {
    id?: string;
    title?: string;
    version?: number;
  };
  context?: {
    target_name?: string;
    sector?: number;
    observation_id?: string;
    field_size_px?: number;
    frame_count?: number;
    site_id?: string;
    site_label?: string;
    target_type?: string;
    comparison_positions?: Array<unknown>;
    fit_controls?: {
      fit_data_source?: string;
    };
    transit_fit?: {
      rp_rs?: number;
      rp_rs_err?: number;
      a_rs?: number;
      a_rs_err?: number;
      inclination?: number;
      inclination_err?: number;
      chi_squared_red?: number;
      period?: number;
      t0?: number;
      used_batman?: boolean;
      used_mcmc?: boolean;
    };
  };
  answers?: Record<string, unknown>;
};


export function RecordDetail() {
  const user = useAuthStore((s) => s.user);
  const { recordId } = useParams<{ recordId: string }>();
  const numericRecordId = Number(recordId);
  const [record, setRecord] = useState<RecordListItem | null>(null);
  const [template, setTemplate] = useState<RecordTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (!Number.isFinite(numericRecordId)) {
      setErrorMessage('Invalid analysis record id.');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    setRecord(null);
    setTemplate(null);

    void (async () => {
      try {
        const savedRecord = await fetchMyRecordSubmission(numericRecordId);
        if (cancelled) return;
        if (!savedRecord) {
          throw new Error('Analysis record not found.');
        }
        setRecord(savedRecord);

        try {
          const loadedTemplate = await fetchRecordTemplate(savedRecord.template_id);
          if (!cancelled) {
            setTemplate(loadedTemplate);
          }
        } catch (error) {
          console.error('Failed to load record template metadata', error);
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load analysis record', error);
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to load analysis record.'
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [numericRecordId, user]);

  const payload = (record?.payload ?? null) as RecordPayload | null;
  const context = payload?.context ?? null;
  const transitFit = context?.transit_fit ?? null;
  const microlensingFit = (context as {
    microlensing_fit?: {
      t0?: number;
      u0?: number;
      tE?: number;
      mag_base?: number;
      chi2_dof?: number;
    };
  } | null)?.microlensing_fit ?? null;
  const answerEntries = Object.entries(payload?.answers ?? {});
  const questionMap = useMemo(
    () => new Map((template?.questions ?? []).map((question) => [question.id, question])),
    [template]
  );

  const canDownloadCsv = record?.workflow === 'transit_lab';
  const isMicrolensingRecord = record?.workflow === 'kmtnet_lab';

  const handleDownloadCsv = async () => {
    if (!record) return;
    setErrorMessage(null);
    setDownloading(true);
    try {
      await downloadMyRecordPhotometryCsv(record.submission_id);
    } catch (error) {
      console.error('Failed to download record CSV', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to download record CSV.'
      );
    } finally {
      setDownloading(false);
    }
  };

  const handleShare = async () => {
    if (!record) return;
    setSharing(true);
    try {
      const { share_url } = await createRecordShareLink(record.submission_id);
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(share_url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = share_url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create share link.');
    } finally {
      setSharing(false);
    }
  };

  if (!user) {
    return (
      <div className="page-placeholder">
        <h2>Analysis Record</h2>
        <p>Please sign in to view saved records.</p>
        <a href="/api/auth/login" className="btn-primary">
          Sign in with Google
        </a>
      </div>
    );
  }

  if (!Number.isFinite(numericRecordId)) {
    return (
      <div className="page-placeholder">
        <h2>Analysis Record</h2>
        <p className="hint error-text">Invalid analysis record id.</p>
        <Link to="/my" className="btn-primary">
          Back to My Analyses
        </Link>
      </div>
    );
  }

  return (
    <div className="record-detail-page">
      <div className="record-detail-header">
        <div>
          <Link to="/my" className="back-link">
            &larr; Back to My Analyses
          </Link>
          <span className="analysis-record-kicker">
            {record ? `Record #${record.submission_id}` : `Record #${numericRecordId}`}
          </span>
          <h2>{record?.title ?? 'Analysis Record'}</h2>
          <p className="hint">
            Submitted records are read-only. Use <strong>Create Draft</strong> to continue
            editing in Lab without mutating the saved result.
          </p>
        </div>
        {record && (
          <div className="record-detail-actions">
            <Link
              to={`/lab/${record.target_id}?seedRecord=${record.submission_id}`}
              className="btn-sm"
            >
              Create Draft
            </Link>
            <Link to={`/target/${record.target_id}`} className="btn-sm">
              View Target
            </Link>
            {canDownloadCsv && (
              <button
                type="button"
                className="btn-sm"
                disabled={downloading}
                onClick={() => { void handleDownloadCsv(); }}
              >
                {downloading ? 'Downloading...' : 'Download CSV'}
              </button>
            )}
            <button
              type="button"
              className={`btn-sm ${copiedLink ? 'btn-sm--success' : ''}`}
              disabled={sharing}
              onClick={() => { void handleShare(); }}
            >
              {sharing ? 'Generating...' : copiedLink ? 'Link Copied!' : 'Share'}
            </button>
          </div>
        )}
      </div>

      {loading && <p className="hint">Loading analysis record...</p>}
      {errorMessage && <p className="hint error-text">{errorMessage}</p>}

      {!loading && !errorMessage && !record && (
        <div className="page-empty-state">
          <strong>Record not found</strong>
          <p>The requested analysis record is unavailable or you do not have access.</p>
        </div>
      )}

      {!loading && record && (
        <div className="record-detail-grid">
          <section className="record-detail-card">
            <h3>Overview</h3>
            <div className="analysis-record-meta">
              <span>{record.created_at}</span>
              <span>{payload?.template?.title ?? template?.title ?? record.template_id}</span>
              <span>{record.workflow}</span>
              <span>{context?.target_name ?? record.target_id}</span>
              {context?.sector !== undefined && <span>Sector {context.sector}</span>}
              {context?.site_label && <span>{context.site_label}</span>}
              {record.observation_ids.length > 0 && (
                <span>{record.observation_ids.length} observation</span>
              )}
              {context?.frame_count !== undefined && (
                <span>
                  {context.frame_count.toLocaleString()} {isMicrolensingRecord ? 'points' : 'cadences'}
                </span>
              )}
            </div>
            <dl className="record-detail-metrics">
              <div>
                <dt>{isMicrolensingRecord ? 'Site' : 'Observation'}</dt>
                <dd>
                  {context?.site_label ?? context?.site_id ?? context?.observation_id ?? record.observation_ids[0] ?? '—'}
                </dd>
              </div>
              <div>
                <dt>{isMicrolensingRecord ? 'Target Type' : 'Field'}</dt>
                <dd>
                  {isMicrolensingRecord
                    ? (context?.target_type ?? '—')
                    : context?.field_size_px !== undefined
                      ? `${context.field_size_px} px`
                      : '—'}
                </dd>
              </div>
              <div>
                <dt>{isMicrolensingRecord ? 'Merged Sites' : 'Comparisons'}</dt>
                <dd>{isMicrolensingRecord ? record.observation_ids.length : context?.comparison_positions?.length ?? 0}</dd>
              </div>
              <div>
                <dt>{isMicrolensingRecord ? 'Fit Model' : 'Fit Mode'}</dt>
                <dd>{isMicrolensingRecord ? 'Paczynski single-lens' : context?.fit_controls?.fit_data_source ?? '—'}</dd>
              </div>
            </dl>
          </section>

          {transitFit && (
            <section className="record-detail-card">
              <h3>Transit Fit</h3>
              <dl className="record-detail-metrics">
                <div>
                  <dt>Rp/R*</dt>
                  <dd>{formatMetric(transitFit.rp_rs)}</dd>
                </div>
                <div>
                  <dt>a/R*</dt>
                  <dd>{formatMetric(transitFit.a_rs, 2)}</dd>
                </div>
                <div>
                  <dt>Inclination</dt>
                  <dd>{formatMetric(transitFit.inclination, 2)}°</dd>
                </div>
                <div>
                  <dt>χ²_red</dt>
                  <dd>{formatMetric(transitFit.chi_squared_red, 3)}</dd>
                </div>
                <div>
                  <dt>Period</dt>
                  <dd>{formatMetric(transitFit.period, 6)}</dd>
                </div>
                <div>
                  <dt>T₀</dt>
                  <dd>{formatMetric(transitFit.t0, 6)}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{transitFit.used_batman ? 'batman integrated transit' : 'legacy'}</dd>
                </div>
                <div>
                  <dt>MCMC</dt>
                  <dd>{transitFit.used_mcmc ? 'Enabled' : 'Disabled'}</dd>
                </div>
              </dl>
            </section>
          )}

          {microlensingFit && (
            <section className="record-detail-card">
              <h3>Microlensing Fit</h3>
              <dl className="record-detail-metrics">
                <div>
                  <dt>t₀</dt>
                  <dd>{formatMetric(microlensingFit.t0, 4)}</dd>
                </div>
                <div>
                  <dt>u₀</dt>
                  <dd>{formatMetric(microlensingFit.u0, 5)}</dd>
                </div>
                <div>
                  <dt>tE</dt>
                  <dd>{formatMetric(microlensingFit.tE, 3)} d</dd>
                </div>
                <div>
                  <dt>Ibase</dt>
                  <dd>{formatMetric(microlensingFit.mag_base, 4)}</dd>
                </div>
                <div>
                  <dt>χ²/dof</dt>
                  <dd>{formatMetric(microlensingFit.chi2_dof, 3)}</dd>
                </div>
              </dl>
            </section>
          )}

          <section className="record-detail-card">
            <h3>Survey Answers</h3>
            {answerEntries.length === 0 ? (
              <p className="hint">No survey answers were saved with this record.</p>
            ) : (
              <dl className="record-answer-list">
                {answerEntries.map(([questionId, value]) => {
                  const question = questionMap.get(questionId);
                  return (
                    <div key={questionId}>
                      <dt>{question?.label ?? questionId}</dt>
                      <dd>{formatAnswerValue(value)}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </section>

          <section className="record-detail-card">
            <h3>Payload Notes</h3>
            <p className="hint">
              This page shows the immutable submitted snapshot. Any new analysis settings,
              measurements, previews, or fit changes should happen in a draft session created
              from this record.
            </p>
            <div className="analysis-record-summary">
              {payload?.template?.version !== undefined && (
                <span>Template v{payload.template.version}</span>
              )}
              {context?.target_name && <span>Target: {context.target_name}</span>}
              {context?.sector !== undefined && <span>Sector: {context.sector}</span>}
              {context?.comparison_positions?.length !== undefined && (
                <span>Saved comparisons: {context.comparison_positions.length}</span>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
