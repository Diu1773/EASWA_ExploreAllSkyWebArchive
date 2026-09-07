import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLangStore } from '../../i18n';
import { localize } from '../../explorationBlocks/localize';
import type {
  ExplorationModuleAdapter,
  ExplorationModuleConfig,
  InquiryStepId,
} from '../../explorationBlocks/types';
import { AnalysisControlPanel } from './AnalysisControlPanel';
import { ComparisonPanel } from './ComparisonPanel';
import { DataSourcePanel } from './DataSourcePanel';
import { MetadataPanel } from './MetadataPanel';
import { isAnswerFilled, isAnswerGateOn } from '../../utils/answerGate';
import { useSelfCheckSkip } from '../../utils/selfCheckSkip';
import { ReflectionPanel } from './ReflectionPanel';
import { AnonCollectionNotice } from './AnonCollectionNotice';
import { SiteFeedbackPanel } from './SiteFeedbackPanel';
import { StartOverButton } from './StartOverButton';
import { StepPanel } from './StepPanel';
import {
  LAB_DRAFT_SAVED_EVENT,
  inquiryDraftScope,
  loadInquiryDraft,
  loadLabDraft,
  saveInquiryDraft,
} from '../../utils/inquiryDraft';
import {
  anonRecordWorthSyncing,
  buildAnonRecordPayload,
  getRecordSinkUrl,
  syncAnonRecord,
  type AnonSubmitConfig,
  type SelfCheckSummary,
} from '../../utils/recordSink';
import { useAuthStore } from '../../stores/useAuthStore';

/** Debounce for the autosave write — long enough not to hit localStorage on
 *  every keystroke, short enough that a reload right after typing keeps it. */
const AUTOSAVE_DELAY_MS = 600;

/** Debounce before pushing a draft row to the sheet. Deliberately far longer
 *  than the local one: this is a network round-trip to Apps Script (which has
 *  execution quotas), and the intent is "they stopped typing", not "they typed".
 *  The local autosave already covers a crash a second after the last keystroke. */
const SHEET_SYNC_DELAY_MS = 4000;

/** Random extra wait on top of the debounce. A whole class finishing a step
 *  together would otherwise fire at the same instant and pile onto the sink's
 *  single script lock; spreading the starts is what keeps the burst from
 *  forming. Measured 2026-07-18: 20 simultaneous writes took 19.0 s to drain
 *  against the script's 20 s wait — about 1 s of headroom. */
const SHEET_SYNC_JITTER_MS = 2500;

/** One retry after a failed upload. The sink answers "busy, retry" when its
 *  lock wait runs out, and without this the row simply stopped updating until
 *  the learner happened to edit again — a silent loss of research data behind a
 *  "saved in this browser only" label. */
const SHEET_SYNC_RETRY_MS = 6000;

type SheetSyncState = 'idle' | 'syncing' | 'synced' | 'failed';

const STEP_SHORT_LABELS: Record<string, Record<string, string>> = {
  step0_intro: { ko: '주제 소개', en: 'Intro' },
  step1_select: { ko: '대상 선택', en: 'Select' },
  step2_metadata: { ko: '자료 확인', en: 'Data Check' },
  step3_analysis_conditions: { ko: '분석 준비', en: 'Prep' },
  step4_run_visualize: { ko: '분석·시각화', en: 'Analyze' },
  step5_compare: { ko: '문헌값 비교', en: 'Compare' },
  step6_reflect: { ko: '해석·기록', en: 'Reflect' },
};

interface InquiryLayoutProps<TContext = unknown> {
  module: ExplorationModuleConfig;
  adapter: ExplorationModuleAdapter<TContext>;
  context?: TContext;
  initialStepId?: InquiryStepId;
  contextSlot?: ReactNode;
  analysisSlot?: ReactNode;
  introSlot?: ReactNode;
  /** Module-specific concept/pipeline diagram, shown in Step 0 between the intro
   *  media and the goals — teaches WHY the pipeline exists before the learner runs it. */
  conceptFlowSlot?: ReactNode;
  selectionSlot?: ReactNode;
  metadataSlot?: ReactNode;
  conditionsSlot?: ReactNode;
  comparisonSlot?: ReactNode;
  resultSummarySlot?: ReactNode;
  /** Pinned beside the questions on the reflection step (Step 6). When given,
   *  that step switches to the two-column composition with numbered questions. */
  sideRailSlot?: ReactNode;
  maxUnlockedStepIndex?: number;
  /** Optional explicit "confirm selection" control shown under the selection step. */
  selectionConfirm?: {
    ready: boolean;
    label: { ko: string; en: string };
    hint: { ko: string; en: string };
  };
  /** No-login anonymous submission to the Google Sheets sink (Step 6). */
  anonSubmit?: AnonSubmitConfig;
  /** Selected target id. Scopes the autosaved draft, so the same target opened
   *  from the module page and from the Lab shares one set of notes. Omit and the
   *  draft falls back to a per-module key. */
  draftTargetId?: string | null;
}

export function InquiryLayout<TContext = unknown>({
  module,
  adapter,
  context,
  initialStepId,
  contextSlot,
  analysisSlot,
  introSlot,
  conceptFlowSlot,
  selectionSlot,
  metadataSlot,
  conditionsSlot,
  sideRailSlot,
  comparisonSlot,
  resultSummarySlot,
  maxUnlockedStepIndex,
  selectionConfirm,
  anonSubmit,
  draftTargetId,
}: InquiryLayoutProps<TContext>) {
  const lang = useLangStore((state) => state.lang);
  // The active step rides in the URL (?blockStep=, replace — no history spam).
  // Without it, walking Step 4 → Lab and pressing the browser back button
  // remounted this layout at Step 0: the page came back, the position didn't.
  // A reload keeps the step for the same reason.
  // NOT ?step= — that name belongs to the Lab's internal stepper
  // (usePersistedWorkflowStep), which deletes it whenever the Lab sits on its
  // default step. Sharing the name made the two owners overwrite each other.
  const BLOCK_STEP_PARAM = 'blockStep';
  const [searchParams, setSearchParams] = useSearchParams();
  // react-router (v7) rebuilds setSearchParams on every URL change; route it
  // through a ref so callbacks below don't need it as a dependency.
  const setSearchParamsRef = useRef(setSearchParams);
  useEffect(() => {
    setSearchParamsRef.current = setSearchParams;
  }, [setSearchParams]);

  const resolveStep = (raw: string | null): InquiryStepId | null =>
    raw && module.steps.some((step) => step.id === raw) ? (raw as InquiryStepId) : null;

  // The active step is DERIVED from the URL, not held in state. Two effects used
  // to sync a useState value and the URL in both directions, and a back/forward
  // that momentarily desynced them made each effect overwrite the other — a
  // setState loop (React #185, reported 2026-07-18). With the URL as the single
  // source of truth the loop cannot exist: the URL changes, the render reads it,
  // done.
  const activeStepId: InquiryStepId =
    resolveStep(searchParams.get(BLOCK_STEP_PARAM)) ?? initialStepId ?? module.steps[0].id;
  // User-initiated step moves PUSH a history entry so the browser back button
  // walks the inquiry (Step 5 → 4 → …) instead of dumping the learner out of the
  // app in one press (reported 2026-07-18: back jumped straight to the browser
  // start page, because every step move used replace and nothing accumulated).
  // System corrections (the clamps below, draft-id normalisation) pass replace,
  // so they never trap the back button by re-pushing the entry just left.
  const setActiveStepId = (id: InquiryStepId, options?: { replace?: boolean }) => {
    setSearchParamsRef.current(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(BLOCK_STEP_PARAM, id);
        return next;
      },
      { replace: options?.replace ?? false },
    );
  };
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Self-check answers live here, not in SelfCheckPanel: that panel unmounts on
  // every step change, and the answers have to survive to the Step 6 submission.
  const [selfCheckAnswers, setSelfCheckAnswers] = useState<Record<string, string | number>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [sheetSyncState, setSheetSyncState] = useState<SheetSyncState>('idle');
  // Site feedback (app quality, not learning data) — rides along on the same
  // anonymous row but in its own columns. Optional; 0/'' when untouched.
  const [siteRating, setSiteRating] = useState(0);
  const [siteFeedback, setSiteFeedback] = useState('');
  const draftScope = useMemo(
    () => inquiryDraftScope(module.id, draftTargetId),
    [module.id, draftTargetId],
  );
  // Only write after the learner actually edits something. Without this the
  // hydration below would immediately re-save what it just read, and an empty
  // mount would overwrite a real draft with {}.
  const dirtyRef = useRef(false);

  // (The two step↔URL sync effects that lived here are gone — the step is now
  //  derived from the URL directly, so there is nothing to keep in sync.)

  // Hydrate from the autosaved draft whenever the task (module + target) changes.
  useEffect(() => {
    const draft = loadInquiryDraft(draftScope);
    dirtyRef.current = false;
    setNotes(draft?.notes ?? {});
    setSelfCheckAnswers(draft?.selfChecks ?? {});
    setSavedAt(draft?.savedAt ?? null);
  }, [draftScope]);

  // Start each step at the top. Changing step swaps the panel content but not the
  // scroll offset, so pressing "다음 단계" from the bottom of a long step landed
  // the learner mid-way down the next one — often past its heading, looking like
  // nothing happened. Not window.scrollTo: body is overflow:hidden and the real
  // scroller is the app shell's <main>.
  useEffect(() => {
    const scroller = document.querySelector('.app-main');
    scroller?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeStepId]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => {
      const at = saveInquiryDraft(draftScope, notes, selfCheckAnswers);
      if (at !== null) setSavedAt(at);
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftScope, notes, selfCheckAnswers]);


  const result = useMemo(
    () => adapter.createInitialResult(module, context),
    [adapter, context, module],
  );
  const primaryAction = useMemo(
    () => adapter.getPrimaryAction(module, context),
    [adapter, context, module],
  );
  const activeStep = module.steps.find((step) => step.id === activeStepId) ?? module.steps[0];
  const stepIndex = module.steps.findIndex((step) => step.id === activeStep.id);
  const maxUnlocked = maxUnlockedStepIndex ?? module.steps.length - 1;
  const selectionStepIndex = module.steps.findIndex((step) => step.kind === 'selection');

  // A URL can point past the gate (stale bookmark, hand-edited ?blockStep=):
  // demote to the last unlocked step. Runs as an effect, not at init, because
  // the fit that unlocks Steps 5–6 is read in a mount effect — clamping eagerly
  // would demote a legitimately unlocked learner during that first frame.
  useEffect(() => {
    if (stepIndex > maxUnlocked) {
      setActiveStepId(module.steps[Math.max(maxUnlocked, 0)].id, { replace: true });
    }
  }, [stepIndex, maxUnlocked, module.steps]);

  // No target, but sitting on a step past selection — the shape you land in when
  // back/forward drops ?target= from a deep step's URL (reported 2026-07-18:
  // reload showed Step 4 asking "먼저 Step 1에서 대상을 선택하세요"). Send the
  // learner back to the selection step so the state is coherent.
  const selectionReady = selectionConfirm ? selectionConfirm.ready : true;
  useEffect(() => {
    if (
      !selectionReady &&
      selectionStepIndex >= 0 &&
      stepIndex > selectionStepIndex
    ) {
      setActiveStepId(module.steps[selectionStepIndex].id, { replace: true });
    }
  }, [selectionReady, selectionStepIndex, stepIndex, module.steps]);
  const goToStep = (delta: number) => {
    const next = module.steps[stepIndex + delta];
    if (next) setActiveStepId(next.id);
  };

  const handleNoteChange = (fieldId: string, value: string) => {
    dirtyRef.current = true;
    setNotes((current) => ({ ...current, [fieldId]: value }));
  };

  const handleSelfCheckAnswer = (key: string, value: string | number) => {
    dirtyRef.current = true;
    setSelfCheckAnswers((current) => ({ ...current, [key]: value }));
  };

  // Grading lives here rather than in the submit panel because the correct
  // answers are on the module config, which the panel does not receive.
  const selfCheckSummary = useMemo<SelfCheckSummary>(() => {
    const responses: SelfCheckSummary['responses'] = [];
    let total = 0;
    module.steps.forEach((step) => {
      (step.selfChecks ?? []).forEach((item) => {
        total += 1;
        const answer = selfCheckAnswers[`${step.id}:${item.id}`];
        if (answer === undefined) return;
        responses.push({
          step: step.id,
          id: item.id,
          answer,
          correct: item.type === 'ox' ? answer === item.correct : answer === item.correctIndex,
        });
      });
    });
    return {
      responses,
      total,
      answered: responses.length,
      correct: responses.filter((response) => response.correct).length,
    };
  }, [module.steps, selfCheckAnswers]);

  // A Lab draft save (생각해보기 O/X, 서술) counts as learner work too: bump the
  // footer's "저장됨" time, let the start-over button re-evaluate, and make the
  // sheet sync below re-run — otherwise a learner who only answered inside the
  // Lab never reached the sheet and saw no autosave signal at all.
  const [labDraftPulse, setLabDraftPulse] = useState(0);
  useEffect(() => {
    const onLabDraftSaved = (event: Event) => {
      const savedTargetId = (event as CustomEvent<string>).detail;
      if (draftTargetId && savedTargetId !== draftTargetId) return;
      dirtyRef.current = true;
      setSavedAt(Date.now());
      setLabDraftPulse((n) => n + 1);
    };
    window.addEventListener(LAB_DRAFT_SAVED_EVENT, onLabDraftSaved);
    return () => window.removeEventListener(LAB_DRAFT_SAVED_EVENT, onLabDraftSaved);
  }, [draftTargetId]);

  // Push a draft row to the sheet once the learner stops typing. Without this a
  // record only reached the sheet if someone remembered to press submit at the
  // very end — anyone who closed the tab first left nothing behind. The script
  // upserts on (anon_id, module, target_id), so this keeps refreshing one row rather
  // than appending. Local autosave still runs at 600ms; this is the slow lane.
  const anonTargetId = anonSubmit?.targetId ?? null;
  const anonFit = anonSubmit?.fit ?? null;
  const anonDerived = anonSubmit?.derived;
  const hasAnonAnalysisResult =
    anonFit != null || (anonDerived != null && Object.keys(anonDerived).length > 0);
  // Signed-in state rides along as a plain boolean (no identity — see
  // AnonRecordPayload.logged_in). Kept in the effect deps so a learner who signs
  // in mid-sitting re-upserts their row with the flag corrected, instead of
  // leaving it stuck at whatever it was when they first typed.
  const loggedIn = useAuthStore((state) => state.user !== null);
  useEffect(() => {
    // A module result is meaningful research on its own. Transit uses `fit`,
    // while KMTNet and cluster CMD place their fitted values in `derived`.
    // Sync when the learner has edited OR either result exists, so running the
    // analysis without writing a note still reaches the sheet.
    if (!anonTargetId || !anonRecordWorthSyncing(dirtyRef.current, hasAnonAnalysisResult)) return;
    const sinkUrl = getRecordSinkUrl();
    if (!sinkUrl) return;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const send = (attempt: number) => {
      setSheetSyncState('syncing');
      syncAnonRecord(
        sinkUrl,
        buildAnonRecordPayload({
          targetId: anonTargetId,
          module: module.id,
          status: 'draft',
          fit: anonFit,
          derived: anonDerived,
          notes,
          selfCheckResponses: selfCheckSummary.responses,
          selfCheckAnswered: selfCheckSummary.answered,
          selfCheckTotal: selfCheckSummary.total,
          selfCheckCorrect: selfCheckSummary.correct,
          labGuideAnswers: loadLabDraft(anonTargetId)?.guideAnswers ?? {},
          loggedIn,
          siteRating,
          siteFeedback,
        }),
      )
        .then(() => setSheetSyncState('synced'))
        .catch(() => {
          // The sink serialises every write behind one script lock, so a class
          // saving at the same moment can push the tail past its 20 s wait and
          // get "busy, retry" back. Leaving it for the learner's next edit was a
          // silent loss — they see "saved in this browser only" and the row never
          // catches up. One retry covers the burst without becoming a storm.
          if (attempt === 0) {
            retryTimer = setTimeout(() => send(1), SHEET_SYNC_RETRY_MS);
            return;
          }
          setSheetSyncState('failed');
        });
    };

    // Jitter, because a fixed delay makes a burst worse: everyone who finishes a
    // step together fires at the same instant and queues behind the same lock.
    // Measured 2026-07-18 — 20 simultaneous writes drained in 19.0 s against the
    // script's 20 s wait, about 1 s of headroom. Spreading the start times is
    // what actually keeps the burst from forming.
    const timer = setTimeout(
      () => send(0),
      SHEET_SYNC_DELAY_MS + Math.random() * SHEET_SYNC_JITTER_MS,
    );
    return () => {
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [
    anonTargetId,
    anonFit,
    anonDerived,
    hasAnonAnalysisResult,
    notes,
    selfCheckSummary,
    labDraftPulse,
    loggedIn,
    siteRating,
    siteFeedback,
  ]);

  // Site feedback edits count as work so the row syncs even if the learner only
  // left feedback and wrote no inquiry notes.
  const handleSiteRating = (rating: number) => { dirtyRef.current = true; setSavedAt(Date.now()); setSiteRating(rating); };
  const handleSiteFeedback = (text: string) => { dirtyRef.current = true; setSavedAt(Date.now()); setSiteFeedback(text); };

  // 생각해보기 접기 버튼을 두 번 누르면 켜지는 시연자 우회 — utils/selfCheckSkip.
  // 생각해보기와 기록 칸을 함께 빼 준다. 처음에는 생각해보기만 뺐는데, 진행자는
  // 서술 칸도 청중 앞에서 채워야 다음 화면으로 갈 수 있었다(3단계는 서술 1개가
  // 남아 「다음 단계」가 잠겼다 — Render 실측 2026-09-07). 아래 두 게이트가
  // 모두 이 값을 본다.
  const skipSelfChecks = useSelfCheckSkip();

  // Progression gate: a step that asks for notes wants at least ONE of them
  // before moving on — enough to keep the record habit without demanding every
  // box (a full-completion gate would stall a classroom on the first snag).
  const isStepAnswered = (step: (typeof module.steps)[number]) =>
    skipSelfChecks ||
    step.recordFields.length === 0 ||
    step.recordFields.some((field) => {
      const raw = notes[`${step.id}:${field.id}`];
      return raw !== undefined && raw.trim() !== '' && raw !== '[]';
    });

  const isFieldFilled = (step: (typeof module.steps)[number], fieldId: string) =>
    isAnswerFilled(notes[`${step.id}:${fieldId}`]);

  /** Every 생각해보기 and every record field on this step, still blank. */
  // Split by kind: a self-check is CHOSEN, a record field is WRITTEN. The
  // "you may write 모르겠다" hint only applies to the latter — O/X items have no
  // text box, so telling a learner to type there sends them looking for a
  // control that does not exist.
  const unansweredOnStep = (step: (typeof module.steps)[number]) => {
    if (skipSelfChecks) return { checks: 0, fields: 0, total: 0 };
    const checks = (step.selfChecks ?? []).filter(
      (item) => selfCheckAnswers[`${step.id}:${item.id}`] === undefined,
    ).length;
    const fields = step.recordFields.filter((field) => !isFieldFilled(step, field.id)).length;
    return { checks, fields, total: checks + fields };
  };

  // The full-completion gate runs on the deployed site only. Locally (5173 dev
  // and the 5895 production build) every screen has to stay walkable while the
  // app is being built and checked, and filling every box on the way is not
  // that. Hostname, not import.meta.env.PROD: 5895 serves the production build.
  const answerGateOn = isAnswerGateOn();
  const unansweredHere = answerGateOn ? unansweredOnStep(activeStep) : { checks: 0, fields: 0, total: 0 };

  // The selection step now gates "다음 단계" directly on having a target — no
  // separate "이 대상으로 확인" button. Picking a target on the map (which pops
  // its info panel showing it as selected) is the confirmation.
  const selectionUnmet =
    activeStep.kind === 'selection' && Boolean(selectionConfirm) && !selectionConfirm?.ready;
  const gateBlocked = !isStepAnswered(activeStep) || selectionUnmet || unansweredHere.total > 0;

  // Why "다음 단계" is unavailable, or null when it is. Never hide the button:
  // a missing control reads as a broken page (the learner finished the Lab fit
  // and had no way forward), whereas a disabled one with a reason teaches.
  const nextBlockedReason: string | null = selectionUnmet
    ? selectionConfirm?.hint[lang] ??
      (lang === 'ko' ? '먼저 지도에서 대상을 선택하세요.' : 'Select a target on the map first.')
    : unansweredHere.total > 0
    ? lang === 'ko'
      ? `이 단계에 아직 답하지 않은 문항이 ${unansweredHere.total}개 있습니다. 모두 답해야 다음 단계로 넘어갑니다.` +
        (unansweredHere.checks > 0
          ? ' 생각해보기는 확신이 없어도 지금 생각에 더 가까운 쪽을 고른 뒤 해설을 확인하세요.'
          : '') +
        (unansweredHere.fields > 0 ? ' 서술 칸은 모르겠으면 「모르겠다」라고 적어도 됩니다.' : '')
      : `${unansweredHere.total} item${unansweredHere.total > 1 ? 's' : ''} on this step still have no answer. Answer them all to continue.` +
        (unansweredHere.checks > 0
          ? ' For the check questions, pick whichever side is closer to what you think, then read the explanation.'
          : '') +
        (unansweredHere.fields > 0
          ? ' In the written boxes, saying you are unsure counts as an answer.'
          : '')
    : !isStepAnswered(activeStep)
    ? lang === 'ko'
      ? '다음 단계로 가려면 이 단계의 탐구 기록을 한 가지 이상 작성하세요.'
      : 'Write at least one inquiry note in this step to continue.'
    : stepIndex >= maxUnlocked
      ? activeStep.kind === 'visualization'
        ? lang === 'ko'
          ? '정밀 분석(Lab)에서 모델 적합까지 마치면 다음 단계가 열립니다.'
          : 'Finish the model fit in the Lab to unlock the next step.'
        : lang === 'ko'
          ? '이 단계를 완료하면 다음 단계가 열립니다.'
          : 'Complete this step to unlock the next one.'
      : null;

  // The rail only makes sense where the learner is writing about a finished
  // result; on the earlier steps the same space belongs to the analysis itself.
  const showSideRail = Boolean(sideRailSlot) && activeStep.kind === 'reflection';

  const renderStepBody = () => {
    if (activeStep.kind === 'intro') {
      return (
        <>
          {introSlot && <div className="inquiry-intro-media">{introSlot}</div>}
          {conceptFlowSlot}
          <div className="inquiry-two-column">
          <section className="inquiry-info-panel">
            <span className="inquiry-panel-kicker">{lang === 'ko' ? '이 탐구에서 할 일' : 'What You’ll Do'}</span>
            <ul className="inquiry-check-list">
              {module.learningGoals.map((goal, index) => (
                <li key={`${localize(goal, lang)}-${index}`}>{localize(goal, lang)}</li>
              ))}
            </ul>
          </section>
          <section className="inquiry-info-panel">
            <span className="inquiry-panel-kicker">{lang === 'ko' ? '수업 적용' : 'Classroom Use'}</span>
            <h3>{localize(module.classroomUse.level, lang)}</h3>
            <dl className="inquiry-field-list compact">
              <div>
                <dt>{lang === 'ko' ? '권장 시간' : 'Suggested time'}</dt>
                <dd>{localize(module.classroomUse.suggestedTime, lang)}</dd>
              </div>
              <div>
                <dt>{lang === 'ko' ? '운영 방식' : 'Grouping'}</dt>
                <dd>{localize(module.classroomUse.grouping, lang)}</dd>
              </div>
            </dl>
          </section>
        </div>
        </>
      );
    }

    if (activeStep.kind === 'selection') {
      // No "이 대상으로 확인" button: selecting a target on the map (which shows
      // it as selected in the popup) is the confirmation, and the footer's
      // "다음 단계" stays disabled with a reason until one is picked
      // (selectionUnmet → nextBlockedReason above).
      if (selectionSlot) {
        return <>{selectionSlot}</>;
      }
      return (
        <section className="inquiry-info-panel inquiry-selection-card">
          <span className="inquiry-panel-kicker">{lang === 'ko' ? '다음 행동' : 'Next Action'}</span>
          <p>{primaryAction?.helperText ? localize(primaryAction.helperText, lang) : localize(module.entry.helperText, lang)}</p>
          {primaryAction && (
            <Link to={primaryAction.href} className="btn-primary inquiry-panel-action">
              {localize(primaryAction.label, lang)}
            </Link>
          )}
        </section>
      );
    }

    if (activeStep.kind === 'metadata') {
      return (
        <div className="inquiry-step-stack">
          {metadataSlot}
          <DataSourcePanel dataSource={module.dataSource} />
          <MetadataPanel fields={result.metadata} />
        </div>
      );
    }

    if (activeStep.kind === 'analysis') {
      return (
        <div className="inquiry-step-stack">
          {conditionsSlot}
          <AnalysisControlPanel
            analysisConfig={module.analysisConfig}
            conditions={result.analysisConditions}
          />
        </div>
      );
    }

    if (activeStep.kind === 'visualization') {
      if (analysisSlot) {
        return <div className="inquiry-analysis-slot">{analysisSlot}</div>;
      }
      return (
        <div className="inquiry-placeholder-run">
          <strong>{lang === 'ko' ? '실제 분석 adapter 연결 대기' : 'Waiting for live adapter wiring'}</strong>
          <span>
            {lang === 'ko'
              ? '이 블럭은 공통 구조와 결과 스키마를 먼저 보여주는 placeholder입니다.'
              : 'This block currently demonstrates the shared structure and result schema as a placeholder.'}
          </span>
        </div>
      );
    }

    if (activeStep.kind === 'comparison') {
      if (comparisonSlot) {
        return <>{comparisonSlot}</>;
      }
      return (
        <ComparisonPanel
          comparisonConfig={module.comparisonConfig}
          derivedValues={result.derivedValues}
          comparisonValues={result.comparisonValues}
        />
      );
    }

    return (
      <>
        {resultSummarySlot}
        {result.interpretationPrompts.length > 0 && (
          <ReflectionPanel
            prompts={result.interpretationPrompts}
            notes={notes}
            onNoteChange={handleNoteChange}
          />
        )}
        {anonSubmit && <AnonCollectionNotice />}
      </>
    );
  };

  // Site feedback lives AFTER the record fields (via StepPanel's afterRecordSlot),
  // not inside renderStepBody which lands above them. The inquiry notes are the
  // point of Step 6; the tool-feedback panel is an optional afterthought below.
  const siteFeedbackSlot =
    anonSubmit && activeStep.kind === 'reflection' ? (
      <SiteFeedbackPanel
        rating={siteRating}
        feedback={siteFeedback}
        onRating={handleSiteRating}
        onFeedback={handleSiteFeedback}
      />
    ) : null;

  return (
    <div className="inquiry-layout">
      <header className="inquiry-layout-header">
        {/* Column, not a bare div: back-link (inline <a>) and kicker
            (inline-flex) used to run together on one line — "← 홈모듈형 탐구블럭". */}
        <div className="inquiry-layout-header-copy">
          <Link to="/" className="back-link">
            <svg className="back-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            {lang === 'ko' ? '홈' : 'Home'}
          </Link>
          <h1>{localize(module.title, lang)}</h1>
          {/* 설명은 0단계에서만. 뒤 단계에서 매번 되풀이하면 한 화면의 덩어리가
              늘고 자료가 밀린다 — 분석 단계 첫 화면에 그림이 0개였던 원인 중 하나.
              근거: DESIGN_HARNESS_EASWA.md §4-1 규칙 2. */}
          {stepIndex === 0 && <p>{localize(module.description, lang)}</p>}
        </div>
        {/* Hides itself when there is nothing saved for this target. */}
        <StartOverButton moduleId={module.id} targetId={draftTargetId} savedAt={savedAt} />
      </header>

      {contextSlot && <div className="inquiry-context-slot">{contextSlot}</div>}

      <nav className="transit-step-indicator inquiry-stepper" aria-label={lang === 'ko' ? '탐구 단계' : 'Inquiry steps'}>
        {module.steps.map((step, index) => {
          const isCurrent = index === stepIndex;
          const isCompleted = index < stepIndex;
          const isLocked = index > maxUnlocked || (gateBlocked && index > stepIndex);
          const shortLabel = STEP_SHORT_LABELS[step.id]?.[lang] ?? localize(step.title, lang);
          return (
            <div key={step.id} className="transit-step-indicator-item">
              {index > 0 && (
                <div className={`transit-step-connector ${index <= stepIndex ? 'completed' : ''}`} />
              )}
              <button
                type="button"
                className={`transit-step-circle ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''} ${isLocked ? 'locked' : ''}`}
                disabled={isLocked}
                onClick={() => {
                  if (!isLocked) setActiveStepId(step.id);
                }}
                title={localize(step.title, lang)}
              >
                {isCompleted ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span>{step.number}</span>
                )}
              </button>
              <span className={`transit-step-label ${isCurrent ? 'current' : ''}`}>{shortLabel}</span>
            </div>
          );
        })}
      </nav>

      <div className={`inquiry-layout-grid${showSideRail ? ' has-rail' : ''}`}>
        <main className="inquiry-layout-main">
          <StepPanel
            step={activeStep}
            notes={notes}
            onNoteChange={handleNoteChange}
            selfCheckAnswers={selfCheckAnswers}
            onSelfCheckAnswer={handleSelfCheckAnswer}
            afterRecordSlot={siteFeedbackSlot}
            recordLayout={showSideRail ? 'numbered' : 'plain'}
          >
            {renderStepBody()}
          </StepPanel>
          <div className="inquiry-step-footer">
            <button
              type="button"
              className="btn-secondary"
              disabled={stepIndex <= 0}
              onClick={() => goToStep(-1)}
            >
              {lang === 'ko' ? '이전 단계' : 'Previous'}
            </button>
            <span className="inquiry-step-progress">
              {activeStep.number} / {module.steps[module.steps.length - 1].number}
              {savedAt !== null && (
                <em className={`inquiry-autosave-status${sheetSyncState === 'failed' ? ' failed' : ''}`}>
                  {sheetSyncState === 'syncing'
                    ? lang === 'ko'
                      ? '자동 저장 중…'
                      : 'Autosaving…'
                    : sheetSyncState === 'synced'
                      ? lang === 'ko'
                        ? '자동 저장됨 '
                        : 'Autosaved '
                      : sheetSyncState === 'failed'
                        ? lang === 'ko'
                          ? '이 브라우저에만 저장됨 (전송 실패) '
                          : 'Saved in this browser only (upload failed) '
                        : lang === 'ko'
                          ? '이 브라우저에 자동 저장됨 '
                          : 'Autosaved in this browser '}
                  {sheetSyncState !== 'syncing' &&
                    new Date(savedAt).toLocaleTimeString(lang === 'ko' ? 'ko-KR' : 'en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                </em>
              )}
            </span>
            {stepIndex < module.steps.length - 1 ? (
              <button
                type="button"
                className="btn-primary"
                disabled={nextBlockedReason !== null}
                title={nextBlockedReason ?? undefined}
                onClick={() => goToStep(1)}
              >
                {lang === 'ko' ? '다음 단계' : 'Next'}
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  document
                    .querySelector('.inquiry-record-fields')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                {/* 하는 일은 위 기록칸으로 스크롤하는 것뿐이다. 원래 '탐구 마무리'라고
                    적혀 있었는데 마지막 단계의 '다음 단계' 자리라 완료·제출 버튼으로
                    읽혔다 — 이 앱엔 제출이 없고(자동저장) 이 버튼도 아무것도 끝내지
                    않는다. 라벨을 실제 동작에 맞춘다. */}
                {lang === 'ko' ? '기록 작성하러 가기 ↑' : 'Go to Your Notes ↑'}
              </button>
            )}
          </div>
          {nextBlockedReason !== null && stepIndex < module.steps.length - 1 && (
            <p className="inquiry-step-gate-hint">{nextBlockedReason}</p>
          )}
        </main>
        {showSideRail && <aside className="inquiry-layout-rail">{sideRailSlot}</aside>}
      </div>
    </div>
  );
}
