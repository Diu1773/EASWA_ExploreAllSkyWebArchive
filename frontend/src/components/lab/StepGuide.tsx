import { useState } from 'react';

export type GuideQuestion =
  | { type: 'open'; id: string; text: string }
  | { type: 'ox'; id: string; text: string; correct: 'O' | 'X'; explanation: string }
  | { type: 'choice'; id: string; text: string; options: string[]; correct: string; explanation: string };

export type GuideAnswers = Record<string, string>;

interface StepGuideProps {
  questions: GuideQuestion[];
  storageKey: string;
  onAnswersChange?: (answers: GuideAnswers) => void;
}

export function StepGuide({ questions, storageKey, onAnswersChange }: StepGuideProps) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) !== 'false'; }
    catch { return true; }
  });
  const [answers, setAnswers] = useState<GuideAnswers>({});

  if (!questions?.length) return null;

  const handleAnswer = (id: string, value: string) => {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    onAnswersChange?.(next);
  };

  return (
    <div className={`transit-guide ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="transit-guide-toggle"
        onClick={() => {
          const next = !open;
          setOpen(next);
          try { localStorage.setItem(storageKey, String(next)); } catch { /* ignore */ }
        }}
      >
        <span>생각해보기</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="transit-guide-questions">
          {questions.map((q) => (
            <div key={q.id} className="transit-guide-item">
              <p className="transit-guide-text">{q.text}</p>
              {q.type === 'ox' && (() => {
                const answered = answers[q.id];
                const isCorrect = answered === q.correct;
                return (
                  <>
                    <div className="transit-guide-ox">
                      {(['O', 'X'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          className={`transit-guide-ox-btn ${answered === v ? (isCorrect ? 'correct' : 'wrong') : ''}`}
                          onClick={() => handleAnswer(q.id, answered === v ? '' : v)}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    {answered && (
                      <div className={`transit-guide-feedback ${isCorrect ? 'correct' : 'wrong'}`}>
                        <strong>{isCorrect ? '정답!' : `오답 — 정답: ${q.correct}`}</strong>
                        <span>{q.explanation}</span>
                      </div>
                    )}
                  </>
                );
              })()}
              {q.type === 'choice' && (() => {
                const answered = answers[q.id];
                const isCorrect = answered === q.correct;
                return (
                  <>
                    <div className="transit-guide-choices">
                      {q.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          className={`transit-guide-choice-btn ${answered === opt ? (isCorrect ? 'correct' : 'wrong') : (answered && opt === q.correct ? 'reveal' : '')}`}
                          onClick={() => handleAnswer(q.id, answered === opt ? '' : opt)}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                    {answered && (
                      <div className={`transit-guide-feedback ${isCorrect ? 'correct' : 'wrong'}`}>
                        <strong>{isCorrect ? '정답!' : `오답 — 정답: ${q.correct}`}</strong>
                        <span>{q.explanation}</span>
                      </div>
                    )}
                  </>
                );
              })()}
              {q.type === 'open' && (
                <textarea
                  className="transit-guide-textarea"
                  placeholder="여기에 생각을 적어보세요..."
                  value={answers[q.id] ?? ''}
                  onChange={(e) => handleAnswer(q.id, e.target.value)}
                  rows={3}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
