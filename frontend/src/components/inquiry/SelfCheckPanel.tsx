import { useState } from 'react';
import { useLangStore } from '../../i18n';
import { isAnswerGateOn } from '../../utils/answerGate';
import { toggleSelfCheckSkip, useSelfCheckSkip } from '../../utils/selfCheckSkip';
import { localize } from '../../explorationBlocks/localize';
import type { SelfCheckItem } from '../../explorationBlocks/types';

interface SelfCheckPanelProps {
  items: SelfCheckItem[];
  /** Step id. Scopes answer keys to `${scope}:${item.id}` so that the same item
   *  id appearing in two steps or modules cannot collide in the lifted state. */
  scope: string;
  answers: Record<string, string | number>;
  onAnswer: (key: string, value: string | number) => void;
}

/**
 * Interactive "생각해보기" self-checks (O/X and multiple-choice) with immediate
 * feedback — turns the otherwise read-only info steps into an active check,
 * mirroring the Transit Lab's self-check pattern.
 *
 * Answers are owned by InquiryLayout rather than this panel: they have to
 * survive step navigation (this unmounts on every step change) and they ride
 * along with the Step 6 anonymous submission.
 *
 * The shell is the Lab's collapsible 생각해보기 (transit-guide) on purpose. The
 * two used to look like different things — this one an always-open panel, the
 * Lab's a fold-out bar — so walking 2단계 → 4단계 → 5단계 the same-named block
 * changed shape and behaviour halfway through (소유자 지적 2026-09-07:
 * 「생각해보기 위치가 자꾸 바뀌는게 헷갈리더라고」). Position was already
 * uniform (always after the step's content); the shape was not.
 *
 * Folding rules match the Lab's: open by default, remembered per step, and
 * forced open while unanswered questions are what blocks the next step — a
 * collapsed panel plus a disabled 「다음」 hides the reason. Double-clicking the
 * fold button is the presenter escape hatch (utils/selfCheckSkip).
 */
export function SelfCheckPanel({ items, scope, answers, onAnswer }: SelfCheckPanelProps) {
  const lang = useLangStore((state) => state.lang);
  const storageKey = `easwa_selfcheck_open_${scope}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storageKey) !== 'false';
    } catch {
      return true;
    }
  });
  const skipSelfChecks = useSelfCheckSkip();
  const unanswered = items.filter((item) => answers[`${scope}:${item.id}`] === undefined).length;
  const forceOpen = isAnswerGateOn() && unanswered > 0 && !skipSelfChecks;
  const shown = open || forceOpen;

  return (
    <section className={`transit-guide inquiry-selfcheck-panel${shown ? ' open' : ''}`}>
      <button
        type="button"
        className="transit-guide-toggle"
        onClick={() => {
          const next = !open;
          setOpen(next);
          try { localStorage.setItem(storageKey, String(next)); } catch { /* ignore */ }
        }}
        onDoubleClick={() => {
          if (toggleSelfCheckSkip()) {
            setOpen(false);
            try { localStorage.setItem(storageKey, 'false'); } catch { /* ignore */ }
          }
        }}
      >
        <span>{lang === 'ko' ? '생각해보기' : 'Check Yourself'}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: shown ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {!shown ? null : (
        <div className="inquiry-selfcheck">
      {/* The answer is locked on the first click. Before, the explanation
          revealed the correct option and the buttons stayed live, so a learner
          could switch to it — and only the last answer was recorded. The July
          2026 cohort's 97% / 100% correct rates cannot be told apart from that
          mechanism. */}
      <p className="inquiry-selfcheck-note">
        {lang === 'ko'
          ? '고른 뒤에는 바꿀 수 없습니다.'
          : 'Your first choice is what gets recorded; it cannot be changed afterwards.'}
      </p>
      {items.map((item) => {
        const key = `${scope}:${item.id}`;
        const answer = answers[key];
        const answered = answer !== undefined;
        const isCorrect =
          item.type === 'ox' ? answer === item.correct : answer === item.correctIndex;

        return (
          <div key={item.id} className="inquiry-selfcheck-item">
            <strong>{localize(item.question, lang)}</strong>

            {item.type === 'ox' ? (
              <div className="inquiry-selfcheck-options">
                {(['O', 'X'] as const).map((opt) => {
                  const chosen = answer === opt;
                  const isAnswer = item.correct === opt;
                  // Only the button the learner PRESSED gets a filled background
                  // (green when right, red when wrong). The correct answer they
                  // did NOT press gets a dashed hint outline — otherwise both O
                  // and X ended up filled and looked like two selections.
                  const showCorrect = answered && chosen && isAnswer;
                  const showWrong = answered && chosen && !isAnswer;
                  const showHint = answered && !chosen && isAnswer;
                  return (
                    <button
                      key={opt}
                      type="button"
                      className={`inquiry-selfcheck-btn${chosen ? ' chosen' : ''}${showCorrect ? ' correct' : ''}${showWrong ? ' wrong' : ''}${showHint ? ' answer-hint' : ''}`}
                      disabled={answered}
                      onClick={() => onAnswer(key, opt)}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="inquiry-selfcheck-options choice">
                {item.options.map((opt, idx) => {
                  const chosen = answer === idx;
                  const isAnswer = item.correctIndex === idx;
                  const showCorrect = answered && chosen && isAnswer;
                  const showWrong = answered && chosen && !isAnswer;
                  const showHint = answered && !chosen && isAnswer;
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`inquiry-selfcheck-btn${chosen ? ' chosen' : ''}${showCorrect ? ' correct' : ''}${showWrong ? ' wrong' : ''}${showHint ? ' answer-hint' : ''}`}
                      disabled={answered}
                      onClick={() => onAnswer(key, idx)}
                    >
                      {localize(opt, lang)}
                    </button>
                  );
                })}
              </div>
            )}

            {answered && (
              <p className="inquiry-selfcheck-feedback">
                <span className={isCorrect ? 'ok' : 'no'}>
                  {isCorrect
                    ? lang === 'ko'
                      ? '맞아요 — '
                      : 'Correct — '
                    : lang === 'ko'
                      ? '다시 생각 — '
                      : 'Not quite — '}
                </span>
                {localize(item.explanation, lang)}
              </p>
            )}
          </div>
        );
      })}
        </div>
      )}
    </section>
  );
}
