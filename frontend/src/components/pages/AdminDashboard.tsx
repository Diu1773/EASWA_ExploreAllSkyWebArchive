import { useEffect, useState } from 'react';
import { fetchGuideStats, type GuideStats } from '../../api/client';

// Map question IDs to readable labels
const QUESTION_LABELS: Record<string, string> = {
  'select_q1': '[Step 1] 별의 밝기 변화 원인',
  'select_q2': '[Step 1] 식현상 설명',
  'select_q3': '[Step 1] 탐구 서술',
  'aperture_q1': '[Step 2] 측광 구경 선택 이유',
  'aperture_q2': '[Step 2] 비교성 선택 기준',
  'aperture_q3': '[Step 2] 비교성 서술',
  'photometry_q1': '[Step 3] 광도 곡선 해석',
  'photometry_q2': '[Step 3] 식현상 확인',
  'photometry_q3': '[Step 3] 광도 곡선 서술',
  'fit_q1': '[Step 4] 트랜짓 모델 적합',
  'fit_q2': '[Step 4] 주기 해석',
  'fit_q3': '[Step 4] 트랜짓 피팅 서술',
  'result_q1': '[Step 5] 행성 반지름 해석',
  'result_q2': '[Step 5] 외계행성 조건',
  'result_q3': '[Step 5] 종합 서술',
  'record_q1': '[Step 6] 분석 결과 신뢰도',
  'record_q2': '[Step 6] 추가 관측 필요성',
  'record_q3': '[Step 6] 최종 서술',
};

const CORRECT_ANSWERS: Record<string, string> = {
  'select_q1': 'O',
  'select_q2': '행성이 별 앞을 지나가며 빛을 가린다',
  'aperture_q1': 'O',
  'aperture_q2': '목표 별과 비슷한 밝기의 별',
  'photometry_q1': 'O',
  'photometry_q2': '밝기가 일시적으로 감소한다',
  'fit_q1': 'O',
  'fit_q2': '행성이 별 주위를 한 바퀴 도는 데 걸리는 시간',
  'result_q1': 'O',
  'result_q2': '별빛을 가리는 행성이 존재한다',
  'record_q1': 'O',
  'record_q2': '더 많은 관측이 필요하다',
};

function AnswerBar({
  answer,
  count,
  total,
  isCorrect,
  isOpen,
}: {
  answer: string;
  count: number;
  total: number;
  isCorrect: boolean;
  isOpen: boolean;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className="admin-answer-row">
      <div className="admin-answer-label" title={answer}>
        {isOpen ? (
          <span className="admin-answer-open">{answer}</span>
        ) : (
          <>
            {isCorrect && <span className="admin-correct-badge">✓</span>}
            <span>{answer}</span>
          </>
        )}
      </div>
      {!isOpen && (
        <div className="admin-bar-wrap">
          <div
            className={`admin-bar ${isCorrect ? 'admin-bar-correct' : ''}`}
            style={{ width: `${pct}%` }}
          />
          <span className="admin-bar-pct">{count} ({pct}%)</span>
        </div>
      )}
    </div>
  );
}

function QuestionCard({
  qid,
  answers,
}: {
  qid: string;
  answers: Record<string, number>;
}) {
  const label = QUESTION_LABELS[qid] ?? qid;
  const correctAnswer = CORRECT_ANSWERS[qid];
  const isOpen = qid.endsWith('_q3');
  const total = Object.values(answers).reduce((s, c) => s + c, 0);

  const sortedEntries = Object.entries(answers).sort(([, a], [, b]) => b - a);

  return (
    <div className="admin-question-card">
      <div className="admin-question-label">{label}</div>
      <div className="admin-question-total">{total}개 응답</div>
      <div className="admin-answers">
        {sortedEntries.map(([answer, count]) => (
          <AnswerBar
            key={answer}
            answer={answer}
            count={count}
            total={total}
            isCorrect={answer === correctAnswer}
            isOpen={isOpen}
          />
        ))}
      </div>
    </div>
  );
}

export function AdminDashboard() {
  const [stats, setStats] = useState<GuideStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGuideStats()
      .then(setStats)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="page-placeholder"><p>Loading stats…</p></div>;
  }
  if (error) {
    return <div className="page-placeholder"><p style={{ color: 'var(--color-error)' }}>{error}</p></div>;
  }
  if (!stats) {
    return <div className="page-placeholder"><p>No data.</p></div>;
  }

  const guidePct =
    stats.total_records > 0
      ? Math.round((stats.records_with_guide / stats.total_records) * 100)
      : 0;

  const qids = Object.keys(stats.question_stats);

  return (
    <div className="admin-dashboard">
      <h2 className="admin-title">탐구 질문 응답 통계</h2>

      <div className="admin-summary-row">
        <div className="admin-summary-card">
          <div className="admin-summary-value">{stats.total_records}</div>
          <div className="admin-summary-label">전체 기록</div>
        </div>
        <div className="admin-summary-card">
          <div className="admin-summary-value">{stats.records_with_guide}</div>
          <div className="admin-summary-label">탐구 답변 포함</div>
        </div>
        <div className="admin-summary-card">
          <div className="admin-summary-value">{guidePct}%</div>
          <div className="admin-summary-label">탐구 참여율</div>
        </div>
      </div>

      {qids.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', marginTop: '2rem' }}>
          아직 탐구 답변이 없습니다.
        </p>
      ) : (
        <div className="admin-questions-grid">
          {qids.map((qid) => (
            <QuestionCard
              key={qid}
              qid={qid}
              answers={stats.question_stats[qid]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
