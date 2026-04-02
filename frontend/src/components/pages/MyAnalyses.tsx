import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMyRecordSubmissions } from '../../api/client';
import { useAuthStore } from '../../stores/useAuthStore';
import type { RecordListItem } from '../../types/record';

export function MyAnalyses() {
  const user = useAuthStore((s) => s.user);
  const [records, setRecords] = useState<RecordListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    fetchMyRecordSubmissions()
      .then((items) => {
        if (!cancelled) setRecords(items);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load saved analyses', error);
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to load saved analyses.'
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) {
    return (
      <div className="page-placeholder">
        <h2>My Analyses</h2>
        <p>Please sign in to view your analysis history.</p>
        <a href="/api/auth/login" className="btn-primary">
          Sign in with Google
        </a>
      </div>
    );
  }

  return (
    <div className="page-placeholder">
      <h2>My Analyses</h2>
      <p className="hint">
        Saved transit records attached to your Google account appear here.
      </p>

      {loading && <p className="hint">Loading saved analyses...</p>}
      {errorMessage && <p className="hint error-text">{errorMessage}</p>}

      {!loading && !errorMessage && records.length === 0 && (
        <div className="page-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <strong>No analyses yet</strong>
          <p>
            Start in Transit Lab and submit the final record form. Submitted records
            will show up here.
          </p>
        </div>
      )}

      {!loading && records.length > 0 && (
        <div className="analysis-record-list">
          {records.map((record) => {
            const payload = record.payload as {
              context?: {
                target_name?: string;
                sector?: number;
                frame_count?: number;
              };
              answers?: {
                transit_visible?: string;
                curve_quality?: string;
                confidence_score?: number;
              };
            };
            return (
              <article key={record.submission_id} className="analysis-record-card">
                <div className="analysis-record-head">
                  <div>
                    <span className="analysis-record-kicker">Record #{record.submission_id}</span>
                    <h3>{record.title}</h3>
                  </div>
                  <span className="analysis-launcher-tag">
                    {payload.context?.target_name ?? record.target_id}
                  </span>
                </div>
                <div className="analysis-record-meta">
                  <span>{record.created_at}</span>
                  {payload.context?.sector !== undefined && (
                    <span>Sector {payload.context.sector}</span>
                  )}
                  {payload.context?.frame_count !== undefined && (
                    <span>{payload.context.frame_count.toLocaleString()} frames</span>
                  )}
                </div>
                <div className="analysis-record-summary">
                  {payload.answers?.transit_visible && (
                    <span>Transit: {payload.answers.transit_visible}</span>
                  )}
                  {payload.answers?.curve_quality && (
                    <span>Quality: {payload.answers.curve_quality}</span>
                  )}
                  {payload.answers?.confidence_score !== undefined && (
                    <span>Confidence: {payload.answers.confidence_score}/5</span>
                  )}
                </div>
                <div className="analysis-record-actions">
                  <Link to={`/lab/${record.target_id}?record=${record.submission_id}`} className="btn-sm">
                    Reopen Lab
                  </Link>
                  <Link to={`/target/${record.target_id}`} className="btn-sm">
                    View Target
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
