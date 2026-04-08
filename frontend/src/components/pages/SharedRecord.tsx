import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchRecordTemplate, fetchSharedRecord } from '../../api/client';
import type { RecordListItem, RecordTemplate } from '../../types/record';

type RecordPayload = {
  template?: { id?: string; title?: string; version?: number };
  context?: {
    target_name?: string;
    sector?: number;
    transit_fit?: {
      rp_rs?: number; rp_rs_err?: number;
      a_rs?: number; a_rs_err?: number;
      inclination?: number; inclination_err?: number;
      chi_squared_red?: number; period?: number; t0?: number;
    };
  };
  answers?: Record<string, unknown>;
};

function formatAnswerValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined) return '—';
  try { return JSON.stringify(value); } catch { return String(value); }
}

function formatMetric(value: number | undefined, digits = 4): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function SharedRecord() {
  const { token } = useParams<{ token: string }>();
  const [record, setRecord] = useState<RecordListItem | null>(null);
  const [template, setTemplate] = useState<RecordTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const rec = await fetchSharedRecord(token);
        if (cancelled) return;
        if (!rec) throw new Error('공유 링크가 유효하지 않거나 기록을 찾을 수 없습니다.');
        setRecord(rec);
        try {
          const tmpl = await fetchRecordTemplate(rec.template_id);
          if (!cancelled) setTemplate(tmpl);
        } catch { /* template optional */ }
      } catch (error) {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : '불러오기 실패');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const payload = (record?.payload ?? null) as RecordPayload | null;
  const context = payload?.context ?? null;
  const transitFit = context?.transit_fit ?? null;
  const answerEntries = Object.entries(payload?.answers ?? {});
  const questionMap = useMemo(
    () => new Map((template?.questions ?? []).map((q) => [q.id, q])),
    [template]
  );

  if (loading) return <div className="loading">Loading shared record…</div>;

  if (errorMessage) {
    return (
      <div className="page-placeholder">
        <h2>공유 탐구 기록</h2>
        <p className="hint error-text">{errorMessage}</p>
        <Link to="/" className="btn-primary">홈으로</Link>
      </div>
    );
  }

  if (!record) return null;

  return (
    <div className="record-detail-page">
      <div className="record-detail-header">
        <div>
          <span className="analysis-record-kicker shared-badge">공유된 탐구 기록</span>
          <h2>{record.title}</h2>
          <p className="hint">
            이 기록은 공유 링크로 접근한 읽기 전용 페이지입니다.
          </p>
        </div>
        <div className="record-detail-actions">
          <Link to={`/target/${record.target_id}`} className="btn-sm">
            View Target
          </Link>
        </div>
      </div>

      <div className="record-detail-grid">
        <div className="record-detail-card">
          <h3>Overview</h3>
          <dl className="record-detail-metrics">
            <div><dt>Target</dt><dd>{context?.target_name ?? record.target_id}</dd></div>
            <div><dt>Sector</dt><dd>{context?.sector ?? '—'}</dd></div>
            <div><dt>Submitted</dt><dd>{record.created_at ? new Date(record.created_at + 'Z').toLocaleString() : '—'}</dd></div>
            <div><dt>Template</dt><dd>{payload?.template?.title ?? record.template_id}</dd></div>
          </dl>
        </div>

        {transitFit && (
          <div className="record-detail-card">
            <h3>Transit Fit</h3>
            <dl className="record-detail-metrics">
              <div><dt>Rp/R*</dt><dd>{formatMetric(transitFit.rp_rs)} ± {formatMetric(transitFit.rp_rs_err)}</dd></div>
              <div><dt>a/R*</dt><dd>{formatMetric(transitFit.a_rs, 2)} ± {formatMetric(transitFit.a_rs_err, 2)}</dd></div>
              <div><dt>Inclination (°)</dt><dd>{formatMetric(transitFit.inclination, 2)} ± {formatMetric(transitFit.inclination_err, 2)}</dd></div>
              <div><dt>χ² red</dt><dd>{formatMetric(transitFit.chi_squared_red, 3)}</dd></div>
              <div><dt>Period (d)</dt><dd>{formatMetric(transitFit.period, 6)}</dd></div>
              <div><dt>T0 (BJD)</dt><dd>{formatMetric(transitFit.t0, 6)}</dd></div>
            </dl>
          </div>
        )}

        {answerEntries.length > 0 && (
          <div className="record-detail-card">
            <h3>분석 답변</h3>
            <dl className="record-answer-list">
              {answerEntries.map(([key, value]) => {
                const question = questionMap.get(key);
                return (
                  <div key={key}>
                    <dt>{question?.label ?? key}</dt>
                    <dd>{formatAnswerValue(value)}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
