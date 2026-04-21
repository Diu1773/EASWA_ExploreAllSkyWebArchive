import { useEffect, useMemo, useRef, useState } from 'react';
import PlotlyModule from 'plotly.js-dist-min';
import {
  fetchMicrolensingLightcurve,
  fetchMicrolensingPreview,
  fetchMyRecordSubmission,
  fetchRecordTemplate,
  fitMicrolensingModel,
  submitRecordTemplate,
} from '../../api/client';
import { defaultKmtnetRecordTemplate } from '../../data/kmtnetRecordTemplate';
import { useWorkflowController } from '../../hooks/useWorkflowController';
import { useAuthStore } from '../../stores/useAuthStore';
import type {
  MicrolensingLightCurveResponse,
  MicrolensingFitResponse,
  MicrolensingPreviewResponse,
} from '../../types/microlensing';
import type { RecordSubmissionResponse, RecordTemplate } from '../../types/record';
import type { Observation, Target } from '../../types/target';
import type { WorkflowSessionSource } from '../../utils/workflowSession';
import {
  createKmtnetWorkflowDefinition,
  type KmtnetStepAvailability,
  type KmtnetWorkflowStep,
  type PersistedKmtnetLabState,
} from '../../workflows/kmtnet/definition';
import { KmtnetPreviewPanel } from './KmtnetPreviewPanel';
import { StepGuide } from './StepGuide';
import type { GuideQuestion } from './StepGuide';

const plotly = (PlotlyModule as any).default ?? (PlotlyModule as any);

const SITE_COLORS: Record<string, string> = {
  ctio: '#e8722a',
  saao: '#2563eb',
  sso:  '#16a34a',
};
const SITE_LABELS: Record<string, string> = {
  ctio: 'CTIO (칠레)',
  saao: 'SAAO (남아프리카)',
  sso:  'SSO (호주)',
};
// CTIO: Wikimedia Commons 공개 이미지 / SAAO·SSO: public/images/ 에 파일 추가
const SITE_PHOTOS: Record<string, string | null> = {
  ctio: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/KMTNet_CTIO_small.jpg/800px-KMTNet_CTIO_small.jpg',
  saao: '/images/kmtnet-saao.jpg',
  sso:  '/images/kmtnet-sso.jpg',
};
const ALL_SITES = ['ctio', 'saao', 'sso'];

const KMT_GUIDES: Record<'field' | 'align' | 'difference' | 'extract' | 'merge' | 'fit', GuideQuestion[]> = {
  field: [
    { type: 'ox', id: 'kmt_field_q1', text: '단일 관측소 하나만으로 KMTNet 이벤트를 놓치지 않고 24시간 관측할 수 있다.', correct: 'X', explanation: '지상 망원경은 낮 동안 관측이 불가능합니다. 단일 관측소는 하루 약 8시간의 공백이 생겨 결정적인 피크 순간을 놓칠 수 있습니다.' },
    { type: 'choice', id: 'kmt_field_q2', text: '원본 KMTNet 은하벌지 영상에서 측광이 어려운 가장 큰 이유는?', options: ['별이 너무 빽빽하게 섞여 있다', '노출 시간이 너무 짧다', '모든 별이 너무 어둡다', '색지수 정보가 없다'], correct: '별이 너무 빽빽하게 섞여 있다', explanation: '은하벌지 방향은 별 밀도가 높아 한 픽셀 근처에 여러 별의 광도가 겹칩니다. 그래서 단순 aperture photometry만으로는 변하는 소스를 분리하기 어렵습니다.' },
    { type: 'open', id: 'kmt_field_q3', text: '선택한 관측소의 원본 frame에서, 이벤트 위치를 그냥 눈으로 바로 찾기 어려운 이유를 적어보자.' },
  ],
  align: [
    { type: 'ox', id: 'kmt_align_q1', text: 'KMT 원본 frame들은 항상 완벽하게 같은 픽셀 위치에 정렬되어 있으므로 추가 정렬이 필요 없다.', correct: 'X', explanation: '실제 관측 프레임은 pointing과 WCS 오차 때문에 미세하게 어긋납니다. reference에 맞춰 등록해야 차분 품질이 좋아집니다.' },
    { type: 'choice', id: 'kmt_align_q2', text: '정렬 이후 가장 먼저 확인해야 할 것은?', options: ['별상이 reference와 얼마나 겹치는가', '배경색이 더 예쁜가', 'HJD가 커졌는가', '노출시간이 같아졌는가'], correct: '별상이 reference와 얼마나 겹치는가', explanation: '정렬의 목적은 기준 프레임과 현재 프레임의 별상을 같은 위치에 맞추는 것입니다.' },
    { type: 'open', id: 'kmt_align_q3', text: '정렬 전후 이미지를 비교해서 별 위치가 어떻게 달라지는지 적어보자.' },
  ],
  difference: [
    { type: 'ox', id: 'kmt_diff_q1', text: '차분영상에서는 기준영상과 변하지 않는 별빛이 대부분 제거되고, 시간에 따라 변한 성분만 남는다.', correct: 'O', explanation: 'reference를 빼면 거의 일정한 별은 상쇄되고, 해당 시점에 밝기 변화가 생긴 위치만 residual로 남습니다.' },
    { type: 'choice', id: 'kmt_diff_q2', text: 'Difference image에서 밝은 잔차가 의미하는 것은?', options: ['기준영상보다 현재 프레임에서 더 밝아졌다', '현재 프레임에서 소스가 사라졌다', '배경 하늘 밝기가 증가했다', '좌표 보정이 실패했다'], correct: '기준영상보다 현재 프레임에서 더 밝아졌다', explanation: '현재 시점의 광도가 기준영상보다 크면 positive residual이 남습니다. 미시중력렌즈 피크 부근이 여기에 해당합니다.' },
    { type: 'open', id: 'kmt_diff_q3', text: 'frame 슬라이더를 움직이며 residual이 가장 강하게 보이는 구간을 찾고, 그때 HJD가 왜 중요한지 설명해보자.' },
  ],
  extract: [
    { type: 'ox', id: 'kmt_extract_q1', text: 'single-site 곡선은 선택한 관측소 데이터만으로 만들어진다.', correct: 'O', explanation: '먼저 단일 관측소에서 difference flux를 추출해 기초적인 이벤트 형태를 확인합니다.' },
    { type: 'choice', id: 'kmt_extract_q2', text: 'single-site 곡선을 먼저 보는 이유는?', options: ['관측소별 데이터 품질과 공백을 먼저 확인하려고', '세 관측소를 합치면 그래프가 너무 길어서', '모든 미중렌 이벤트는 단일 관측소만으로 충분해서', '행성 이벤트는 merge가 불가능해서'], correct: '관측소별 데이터 품질과 공백을 먼저 확인하려고', explanation: '단일 관측소 곡선을 먼저 보면 공백, 잡음, 피크 포착 여부를 개별적으로 판단할 수 있습니다.' },
    { type: 'open', id: 'kmt_extract_q3', text: '선택한 관측소의 곡선만 봤을 때 남는 공백이나 한계를 적어보자.' },
  ],
  merge: [
    { type: 'ox', id: 'kmt_merge_q1', text: 'CTIO · SAAO · SSO는 경도 약 120° 간격으로 배치되어 24시간 연속 감시에 가깝게 운용된다.', correct: 'O', explanation: '경도 120° 간격으로 배치된 3개 관측소가 각자의 낮 시간 공백을 서로 메워 연속 감시에 가까운 커버리지를 제공합니다.' },
    { type: 'choice', id: 'kmt_merge_q2', text: 'single-site 곡선과 network-merged 곡선을 비교할 때 가장 먼저 봐야 할 것은?', options: ['피크와 공백 구간이 얼마나 채워지는가', '그래프 배경색', '오차막대의 색상', '별자리 이름'], correct: '피크와 공백 구간이 얼마나 채워지는가', explanation: 'KMTNet의 강점은 네트워크 병합으로 피크와 anomaly를 놓치지 않는 것입니다. 공백이 얼마나 줄어드는지가 핵심입니다.' },
    { type: 'open', id: 'kmt_merge_q3', text: 'single-site 결과와 3-site merged 결과를 비교해서, 어떤 정보가 추가로 보이는지 적어보자.' },
  ],
  fit: [
    { type: 'ox', id: 'kmt_fit_q1', text: 'u₀(충격 파라미터)가 작을수록 미시중력렌즈 최대 증폭은 커진다.', correct: 'O', explanation: 'u₀가 작을수록 렌즈와 광원이 더 잘 정렬되어 증폭이 커집니다. u₀가 0에 가까울수록 아인슈타인 링 조건에 접근합니다.' },
    { type: 'choice', id: 'kmt_fit_q2', text: 'Paczyński 모델의 tE는 무엇을 나타내는가?', options: ['피크 시각', '아인슈타인 반경 통과 시간', '기준 광도', '행성 질량비'], correct: '아인슈타인 반경 통과 시간', explanation: 'tE는 이벤트의 시간 척도를 결정하는 파라미터로, 렌즈 질량·거리·상대 운동에 의존합니다.' },
    { type: 'open', id: 'kmt_fit_q3', text: '적합 결과의 u₀, tE, χ²/dof를 보고 이 이벤트가 단일 렌즈로 잘 설명되는지 근거와 함께 적어보자.' },
  ],
};

interface Props {
  target: Target;
  observations: Observation[];
  siteId: string;
  draftId?: string | null;
  seedRecordId?: number | null;
}

function StepBar({ current, hasSingleSiteCurve, hasMergedCurve, hasFitResult }: {
  current: KmtnetWorkflowStep;
  hasSingleSiteCurve: boolean;
  hasMergedCurve: boolean;
  hasFitResult: boolean;
}) {
  const steps = [
    { id: 'field' as const, number: 1, label: 'Field' },
    { id: 'align' as const, number: 2, label: 'Align' },
    { id: 'difference' as const, number: 3, label: 'Difference' },
    { id: 'extract' as const, number: 4, label: 'Extract' },
    { id: 'merge' as const, number: 5, label: 'Merge' },
    { id: 'fit' as const, number: 6, label: 'Fit' },
    { id: 'record' as const, number: 7, label: '결과 저장' },
  ];
  const stepOrder: KmtnetWorkflowStep[] = ['field', 'align', 'difference', 'extract', 'merge', 'fit', 'record'];
  const currentIndex = stepOrder.indexOf(current);
  const getState = (stepId: KmtnetWorkflowStep) => {
    const stepIndex = stepOrder.indexOf(stepId);
    if (stepIndex < currentIndex) return 'done';
    if (stepId === current) return 'active';
    if (stepId === 'record') return hasFitResult ? 'accessible' : 'locked';
    if (stepId === 'fit') return hasMergedCurve ? 'accessible' : 'locked';
    if (stepId === 'merge') return hasSingleSiteCurve ? 'accessible' : 'locked';
    return 'accessible';
  };

  return (
    <div className="ml-step-bar">
      {steps.map((s, i) => {
        const state = getState(s.id);
        return (
          <div key={s.id} className="ml-step-bar-item">
            <div className={`ml-step-dot ml-step-dot--${state}`}>
              {state === 'done' ? '✓' : s.number}
            </div>
            <span className={`ml-step-label ml-step-label--${state}`}>{s.label}</span>
            {i < steps.length - 1 && (
              <div className={`ml-step-line ${state === 'done' ? 'ml-step-line--done' : ''}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PlotPanel({
  lcData,
  showSites,
  fitResult,
  targetName,
}: {
  lcData: MicrolensingLightCurveResponse;
  showSites: string[];
  fitResult?: MicrolensingFitResponse | null;
  targetName: string;
}) {
  const plotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!plotRef.current) return;

    const traces: any[] = showSites.map((site) => {
      const pts = lcData.points.filter((p) => p.site === site);
      return {
        x: pts.map((p) => p.hjd),
        y: pts.map((p) => p.magnitude),
        error_y: {
          type: 'data', array: pts.map((p) => p.mag_error),
          visible: true, color: SITE_COLORS[site] + '99', thickness: 1, width: 0,
        },
        mode: 'markers', type: 'scatter',
        name: SITE_LABELS[site],
        marker: { color: SITE_COLORS[site], size: 6, opacity: 0.9 },
      };
    });

    if (fitResult) {
      traces.push({
        x: fitResult.model_curve.map((p) => p.hjd),
        y: fitResult.model_curve.map((p) => p.magnitude),
        mode: 'lines', type: 'scatter',
        name: 'Paczyński fit',
        line: { color: '#e2e8f0', width: 2.5 },
        hoverinfo: 'skip',
      });
    }

    plotly.react(plotRef.current, traces, {
      title: {
        text: `<b>${targetName}</b>`,
        font: { size: 14, color: '#eceff4', family: 'IBM Plex Sans, sans-serif' },
      },
      xaxis: {
        title: { text: 'HJD', font: { color: '#9aa3b0', size: 12 } },
        gridcolor: 'rgba(255,255,255,0.06)', color: '#9aa3b0',
        linecolor: '#252d3a', linewidth: 1,
      },
      yaxis: {
        title: { text: lcData.y_label, font: { color: '#9aa3b0', size: 12 } },
        autorange: 'reversed',
        gridcolor: 'rgba(255,255,255,0.06)', color: '#9aa3b0',
        linecolor: '#252d3a', linewidth: 1,
      },
      plot_bgcolor: '#12161e',
      paper_bgcolor: '#1a2030',
      font: { family: 'IBM Plex Mono, monospace', color: '#9aa3b0', size: 11 },
      margin: { t: 48, r: 24, b: 52, l: 66 },
      showlegend: true,
      legend: {
        x: 1, y: 1, xanchor: 'right', yanchor: 'top',
        bgcolor: 'rgba(26,32,48,0.9)', bordercolor: '#252d3a', borderwidth: 1,
        font: { family: 'IBM Plex Sans, sans-serif', size: 11, color: '#d4dae5' },
      },
    }, { responsive: true });
  }, [lcData, showSites, fitResult, targetName]);

  return <div ref={plotRef} className="plot-canvas ml-plot-canvas" />;
}

function RawFieldCard({
  preview,
  siteLabel,
  frameChangeDisabled = false,
  frameLoading = false,
  onFrameChange,
}: {
  preview: MicrolensingPreviewResponse;
  siteLabel: string;
  frameChangeDisabled?: boolean;
  frameLoading?: boolean;
  onFrameChange?: (frameIndex: number) => void;
}) {
  const left = `${(preview.raw_target_position.x / preview.cutout_width_px) * 100}%`;
  const top = `${(preview.raw_target_position.y / preview.cutout_height_px) * 100}%`;

  return (
    <section className="ml-preview-panel">
      <div className="ml-preview-head">
        <div>
          <span className="ml-preview-kicker">Raw Field</span>
          <h4>{siteLabel} crowded field</h4>
        </div>
        <div className="ml-preview-stats">
          <span>HJD {preview.frame_metadata.hjd.toFixed(4)}</span>
          <span>I = {preview.frame_metadata.magnitude.toFixed(3)} ± {preview.frame_metadata.mag_error.toFixed(3)}</span>
          <span>{preview.frame_metadata.filter_band ?? 'I'}-band · {preview.frame_metadata.exposure_sec?.toFixed(0) ?? '120'} s</span>
          <span>A ≈ {preview.frame_metadata.magnification.toFixed(2)}x</span>
        </div>
      </div>

      <div className="ml-preview-toolbar">
        <div className="ml-preview-toolbar-group">
          <button
            type="button"
            className="btn-sm"
            disabled={frameChangeDisabled || preview.frame_index <= 0}
            onClick={() => onFrameChange?.(0)}
          >
            First
          </button>
          <button
            type="button"
            className="btn-sm"
            disabled={frameChangeDisabled || preview.frame_index <= 0}
            onClick={() => onFrameChange?.(Math.max(0, preview.frame_index - 1))}
          >
            Prev
          </button>
          <button
            type="button"
            className="btn-sm"
            disabled={frameChangeDisabled || preview.frame_index >= preview.frame_count - 1}
            onClick={() => onFrameChange?.(Math.min(preview.frame_count - 1, preview.frame_index + 1))}
          >
            Next
          </button>
          <button
            type="button"
            className="btn-sm"
            disabled={frameChangeDisabled || preview.frame_index >= preview.frame_count - 1}
            onClick={() => onFrameChange?.(preview.frame_count - 1)}
          >
            Last
          </button>
        </div>
        <div className="ml-preview-toolbar-group ml-preview-toolbar-group--grow">
          <span className="selected-count">
            Frame {preview.frame_index + 1} / {preview.frame_count}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(preview.frame_count - 1, 0)}
            step={1}
            value={preview.frame_index}
            disabled={frameChangeDisabled}
            onChange={(event) => onFrameChange?.(Number(event.target.value))}
          />
        </div>
      </div>

      <div className="ml-preview-grid ml-preview-grid--field">
        <article className="ml-preview-card">
          <div className="ml-preview-card-head">
            <strong>Raw Frame</strong>
            <span>{siteLabel} 단일 frame의 crowded field</span>
          </div>
          <div className="ml-preview-stage">
            <img src={preview.raw_image_data_url} alt="KMT raw field" className="ml-preview-image" />
            <div className="ml-preview-marker" style={{ left, top }} aria-hidden="true" />
          </div>
        </article>
        <div className="ml-field-note-card">
          <h4>왜 그냥 밝기를 재면 안 되나?</h4>
          <p>
            은하벌지 방향은 별이 매우 빽빽해서 한 위치의 광도에 여러 별이 섞입니다.
            그래서 <code>difference imaging</code> 전에는 “어느 별이 실제로 변한 것인지”를 분리하기 어렵습니다.
          </p>
          <dl className="ml-site-dl">
            <dt>Frame</dt><dd>#{preview.frame_index + 1} / {preview.frame_count}</dd>
            <dt>Obs ID</dt><dd>{preview.frame_metadata.observation_id}</dd>
            <dt>HJD</dt><dd>{preview.frame_metadata.hjd.toFixed(4)}</dd>
            <dt>Filter</dt><dd>{preview.frame_metadata.filter_band ?? 'I'}-band</dd>
            <dt>Exposure</dt><dd>{preview.frame_metadata.exposure_sec?.toFixed(0) ?? '120'} s</dd>
            <dt>I-band</dt><dd>{preview.frame_metadata.magnitude.toFixed(3)} ± {preview.frame_metadata.mag_error.toFixed(3)}</dd>
            <dt>Magnification</dt><dd>{preview.frame_metadata.magnification.toFixed(2)}x</dd>
          </dl>
          {frameLoading && (
            <p className="hint">새 raw frame을 불러오는 중...</p>
          )}
        </div>
      </div>
    </section>
  );
}

function AlignmentPanel({
  preview,
  frameChangeDisabled = false,
  frameLoading = false,
  onFrameChange,
}: {
  preview: MicrolensingPreviewResponse;
  frameChangeDisabled?: boolean;
  frameLoading?: boolean;
  onFrameChange?: (frameIndex: number) => void;
}) {
  const rawLeft = `${(preview.raw_target_position.x / preview.cutout_width_px) * 100}%`;
  const rawTop = `${(preview.raw_target_position.y / preview.cutout_height_px) * 100}%`;
  const alignedLeft = `${(preview.aligned_target_position.x / preview.cutout_width_px) * 100}%`;
  const alignedTop = `${(preview.aligned_target_position.y / preview.cutout_height_px) * 100}%`;

  return (
    <section className="ml-preview-panel">
      <div className="ml-preview-head">
        <div>
          <span className="ml-preview-kicker">Frame Registration</span>
          <h4>Raw / Aligned 비교</h4>
        </div>
        <div className="ml-preview-stats">
          <span>Δx {preview.registration_dx_px >= 0 ? '+' : ''}{preview.registration_dx_px.toFixed(2)} px</span>
          <span>Δy {preview.registration_dy_px >= 0 ? '+' : ''}{preview.registration_dy_px.toFixed(2)} px</span>
          <span>{preview.frame_metadata.filter_band ?? 'I'}-band · {preview.frame_metadata.exposure_sec?.toFixed(0) ?? '120'} s</span>
        </div>
      </div>

      <div className="ml-preview-toolbar">
        <div className="ml-preview-toolbar-group">
          <button type="button" className="btn-sm" disabled={frameChangeDisabled || preview.frame_index <= 0} onClick={() => onFrameChange?.(0)}>First</button>
          <button type="button" className="btn-sm" disabled={frameChangeDisabled || preview.frame_index <= 0} onClick={() => onFrameChange?.(Math.max(0, preview.frame_index - 1))}>Prev</button>
          <button type="button" className="btn-sm" disabled={frameChangeDisabled || preview.frame_index >= preview.frame_count - 1} onClick={() => onFrameChange?.(Math.min(preview.frame_count - 1, preview.frame_index + 1))}>Next</button>
          <button type="button" className="btn-sm" disabled={frameChangeDisabled || preview.frame_index >= preview.frame_count - 1} onClick={() => onFrameChange?.(preview.frame_count - 1)}>Last</button>
        </div>
        <div className="ml-preview-toolbar-group ml-preview-toolbar-group--grow">
          <span className="selected-count">
            Frame {preview.frame_index + 1} / {preview.frame_count}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(preview.frame_count - 1, 0)}
            step={1}
            value={preview.frame_index}
            disabled={frameChangeDisabled}
            onChange={(event) => onFrameChange?.(Number(event.target.value))}
          />
        </div>
      </div>

      <div className="ml-preview-grid ml-preview-grid--two">
        <article className="ml-preview-card">
          <div className="ml-preview-card-head">
            <strong>Raw Frame</strong>
            <span>WCS cutout only</span>
          </div>
          <div className="ml-preview-stage">
            <img src={preview.raw_image_data_url} alt="Raw frame" className="ml-preview-image" />
            <div className="ml-preview-marker" style={{ left: rawLeft, top: rawTop }} aria-hidden="true" />
          </div>
        </article>
        <article className="ml-preview-card">
          <div className="ml-preview-card-head">
            <strong>Aligned Frame</strong>
            <span>reference에 맞춰 픽셀 이동</span>
          </div>
          <div className="ml-preview-stage">
            <img src={preview.aligned_image_data_url} alt="Aligned frame" className="ml-preview-image" />
            <div
              className="ml-preview-marker"
              style={{ left: alignedLeft, top: alignedTop }}
              aria-hidden="true"
            />
          </div>
        </article>
      </div>

      <div className="ml-preview-note">
        <span>
          현재 프레임은 기준 프레임에 맞춰 <strong>x {preview.registration_dx_px >= 0 ? '+' : ''}{preview.registration_dx_px.toFixed(2)} px</strong>,
          <strong> y {preview.registration_dy_px >= 0 ? '+' : ''}{preview.registration_dy_px.toFixed(2)} px</strong> 만큼 이동했습니다.
        </span>
        <span>
          정렬이 맞을수록 별상이 reference와 더 잘 겹치고, 다음 단계 difference image에서 잔차가 더 깔끔하게 남습니다.
          {frameLoading ? ' 새 프레임을 불러오는 중입니다…' : ''}
        </span>
      </div>
    </section>
  );
}

function buildInitialRecordAnswers(template: RecordTemplate | null): Record<string, unknown> {
  if (!template) return {};
  return Object.fromEntries(
    template.questions.map((question) => {
      if (question.type === 'checkbox') return [question.id, []];
      return [question.id, ''];
    }),
  );
}

function buildKmtnetRecordAnswers(
  answers: Record<string, unknown>,
  recordTitle: string,
  targetName: string,
): Record<string, unknown> {
  const summaryTitle = recordTitle.trim() || `${targetName} microlensing analysis`;
  return {
    ...answers,
    summary_title: summaryTitle,
  };
}

function RecordQuestionField({
  question,
  value,
  onChange,
}: {
  question: RecordTemplate['questions'][number];
  value: unknown;
  onChange: (nextValue: unknown) => void;
}) {
  if (question.type === 'text') {
    return (
      <input
        type="text"
        value={typeof value === 'string' ? value : ''}
        placeholder={question.placeholder ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (question.type === 'textarea') {
    return (
      <textarea
        rows={4}
        value={typeof value === 'string' ? value : ''}
        placeholder={question.placeholder ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (question.type === 'number') {
    return (
      <input
        type="number"
        min={question.min_value ?? undefined}
        max={question.max_value ?? undefined}
        step="1"
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === '' ? '' : Number(next));
        }}
      />
    );
  }

  if (question.type === 'select') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select…</option>
        {(question.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (question.type === 'radio') {
    return (
      <div className="record-radio-group">
        {(question.options ?? []).map((option) => (
          <label key={option.value} className="record-choice-row">
            <input
              type="radio"
              name={question.id}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    );
  }

  if (question.type === 'checkbox') {
    const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    return (
      <div className="record-checkbox-group">
        {(question.options ?? []).map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label key={option.value} className="record-choice-row">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = checked
                    ? selected.filter((item) => item !== option.value)
                    : [...selected, option.value];
                  onChange(next);
                }}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    );
  }

  return null;
}

export function KmtnetLab({
  target,
  observations,
  siteId,
  draftId = null,
  seedRecordId = null,
}: Props) {
  const user = useAuthStore((s) => s.user);
  const [preview, setPreview] = useState<MicrolensingPreviewResponse | null>(null);
  const [previewFrameIndex, setPreviewFrameIndex] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [singleSiteCurve, setSingleSiteCurve] = useState<MicrolensingLightCurveResponse | null>(null);
  const [mergedCurve, setMergedCurve] = useState<MicrolensingLightCurveResponse | null>(null);
  const [fitResult, setFitResult] = useState<MicrolensingFitResponse | null>(null);
  const [recordTemplate, setRecordTemplate] = useState<RecordTemplate | null>(
    defaultKmtnetRecordTemplate,
  );
  const [recordAnswers, setRecordAnswers] = useState<Record<string, unknown>>(
    buildInitialRecordAnswers(defaultKmtnetRecordTemplate),
  );
  const [recordTitle, setRecordTitle] = useState('');
  const [submittedRecord, setSubmittedRecord] = useState<RecordSubmissionResponse | null>(null);
  const [recordSubmitting, setRecordSubmitting] = useState(false);
  const [fitting, setFitting] = useState(false);
  const [singleSiteLoading, setSingleSiteLoading] = useState(false);
  const [mergedLoading, setMergedLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sitePhotoError, setSitePhotoError] = useState(false);
  const recordTemplateRequestedRef = useRef(false);
  const loadedSeedRecordIdRef = useRef<number | null>(null);
  const previewCacheRef = useRef<Map<string, MicrolensingPreviewResponse>>(new Map());
  const workflowDefinition = useMemo(
    () => createKmtnetWorkflowDefinition({ targetId: target.id }),
    [target.id],
  );
  const workflowSessionSource: WorkflowSessionSource =
    draftId && draftId.trim() !== ''
      ? { kind: 'draft', id: draftId }
      : seedRecordId !== null
        ? { kind: 'record-seed', id: seedRecordId }
        : { kind: 'live' };
  const workflowSnapshot: PersistedKmtnetLabState = useMemo(
    () => ({
      previewFrameIndex,
      singleSiteCurve,
      mergedCurve,
      fitResult,
      recordAnswers,
      recordTitle,
      submittedRecord,
    }),
    [fitResult, mergedCurve, previewFrameIndex, recordAnswers, recordTitle, singleSiteCurve, submittedRecord],
  );
  const workflowAvailability = useMemo<KmtnetStepAvailability>(
    () => workflowDefinition.getAvailability(workflowSnapshot),
    [workflowDefinition, workflowSnapshot],
  );

  const {
    step,
    setStep,
    hydrated: workflowHydrated,
    draftSaveStatus,
    draftSavedAtLabel,
  } = useWorkflowController<KmtnetWorkflowStep, PersistedKmtnetLabState, KmtnetStepAvailability>({
    scope: {
      workflowId: workflowDefinition.workflowId,
      subjectId: target.id,
      source: workflowSessionSource,
    },
    version: workflowDefinition.version,
    defaultStep: workflowDefinition.defaultStep,
    currentAvailability: workflowAvailability,
    emptyAvailability: workflowDefinition.getAvailability(null),
    parseStep: workflowDefinition.parseStep,
    clampStep: workflowDefinition.clampStep,
    snapshot: workflowSnapshot,
    restoreSnapshot: workflowDefinition.normalizeSnapshot,
    getSnapshotAvailability: workflowDefinition.getAvailability,
    draft: {
      draftId,
      title: recordTitle.trim() || `${target.name} KMT draft`,
      userPresent: Boolean(user),
      seedRecordId,
      hasMeaningfulSnapshot: workflowDefinition.hasMeaningfulSnapshot,
    },
    applyRestoredSnapshot: (saved) => {
      setPreviewFrameIndex(saved?.previewFrameIndex ?? null);
      setSingleSiteCurve(saved?.singleSiteCurve ?? null);
      setMergedCurve(saved?.mergedCurve ?? null);
      setFitResult(saved?.fitResult ?? null);
      setRecordAnswers(
        Object.keys(saved?.recordAnswers ?? {}).length > 0
          ? (saved?.recordAnswers ?? {})
          : buildInitialRecordAnswers(recordTemplate ?? defaultKmtnetRecordTemplate),
      );
      setRecordTitle(saved?.recordTitle ?? '');
      setSubmittedRecord(saved?.submittedRecord ?? null);
      setError(null);
      setSingleSiteLoading(false);
      setMergedLoading(false);
    },
  });

  useEffect(() => {
    if (recordTemplate || recordTemplateRequestedRef.current) return;
    recordTemplateRequestedRef.current = true;
    void fetchRecordTemplate('kmtnet_record')
      .then((template) => {
        setRecordTemplate(template);
        setRecordAnswers((current) =>
          Object.keys(current).length > 0 ? current : buildInitialRecordAnswers(template),
        );
      })
      .catch((loadError) => {
        console.error('Failed to load KMT record template', loadError);
      });
  }, [recordTemplate]);

  useEffect(() => {
    if (!workflowHydrated || seedRecordId === null || loadedSeedRecordIdRef.current === seedRecordId) return;
    if (singleSiteCurve || mergedCurve || fitResult || submittedRecord) return;
    let cancelled = false;
    void fetchMyRecordSubmission(seedRecordId)
      .then((record) => {
        if (cancelled || !record || record.workflow !== 'kmtnet_lab' || record.target_id !== target.id) return;
      const payload = record.payload as {
          context?: {
            light_curve?: MicrolensingLightCurveResponse | null;
            single_site_curve?: MicrolensingLightCurveResponse | null;
            merged_curve?: MicrolensingLightCurveResponse | null;
            microlensing_fit?: MicrolensingFitResponse | null;
            preview_frame_index?: number | null;
          };
          answers?: Record<string, unknown>;
        };
        if (payload.context?.single_site_curve) {
          setSingleSiteCurve(payload.context.single_site_curve);
        }
        if (payload.context?.merged_curve) {
          setMergedCurve(payload.context.merged_curve);
        } else if (payload.context?.light_curve) {
          setMergedCurve(payload.context.light_curve);
        }
        if (payload.context?.microlensing_fit) {
          setFitResult(payload.context.microlensing_fit);
        }
        if (typeof payload.context?.preview_frame_index === 'number') {
          setPreviewFrameIndex(Math.max(0, Math.round(payload.context.preview_frame_index)));
        }
        if (payload.answers && Object.keys(payload.answers).length > 0) {
          setRecordAnswers(payload.answers);
        }
        setRecordTitle(record.title);
        loadedSeedRecordIdRef.current = seedRecordId;
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error('Failed to restore KMT seed record', loadError);
      });
    return () => {
      cancelled = true;
    };
  }, [fitResult, mergedCurve, seedRecordId, singleSiteCurve, submittedRecord, target.id, workflowHydrated]);

  const singlePts = useMemo(
    () => singleSiteCurve?.points.filter((point) => point.site === siteId) ?? [],
    [singleSiteCurve, siteId],
  );

  const observationCountsBySite = useMemo(() => {
    const counts: Record<string, number> = { ctio: 0, saao: 0, sso: 0 };
    observations.forEach((observation) => {
      const label = (observation.display_label ?? '').trim().toUpperCase();
      if (label === 'CTIO') counts.ctio += 1;
      if (label === 'SAAO') counts.saao += 1;
      if (label === 'SSO') counts.sso += 1;
    });
    return counts;
  }, [observations]);

  const siteObservationCount = observationCountsBySite[siteId] ?? 0;
  const networkObservationCount = useMemo(
    () => Object.values(observationCountsBySite).reduce((sum, count) => sum + count, 0),
    [observationCountsBySite],
  );

  useEffect(() => {
    if (!workflowHydrated || previewFrameIndex !== null) return;
    setPreviewFrameIndex(0);
  }, [previewFrameIndex, workflowHydrated]);

  useEffect(() => {
    if (!workflowHydrated || previewFrameIndex === null) return;
    let cancelled = false;
    const cacheKey = `${target.id}:${siteId}:${previewFrameIndex}`;
    const cachedPreview = previewCacheRef.current.get(cacheKey);
    if (cachedPreview) {
      setPreview(cachedPreview);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    void fetchMicrolensingPreview(target.id, siteId, previewFrameIndex)
      .then((response) => {
        if (cancelled) return;
        previewCacheRef.current.set(cacheKey, response);
        setPreview(response);
        if (response.frame_index !== previewFrameIndex) {
          setPreviewFrameIndex(response.frame_index);
        }
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error('Failed to load KMT preview', loadError);
        setPreviewError(
          loadError instanceof Error ? loadError.message : 'KMT preview를 불러오지 못했습니다.',
        );
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [previewFrameIndex, siteId, target.id, workflowHydrated]);

  useEffect(() => {
    if (!preview || !workflowHydrated) return;
    const neighbors = [
      preview.frame_index - 2,
      preview.frame_index - 1,
      preview.frame_index + 1,
      preview.frame_index + 2,
      ...preview.sample_frame_indices,
    ].filter((index) => index >= 0 && index < preview.frame_count);
    const uniqueNeighbors = Array.from(new Set(neighbors));

    uniqueNeighbors.forEach((neighborIndex) => {
      const cacheKey = `${target.id}:${siteId}:${neighborIndex}`;
      if (previewCacheRef.current.has(cacheKey)) return;
      void fetchMicrolensingPreview(target.id, siteId, neighborIndex)
        .then((response) => {
          previewCacheRef.current.set(cacheKey, response);
        })
        .catch(() => {
          // Ignore prefetch failures; the foreground request will surface real errors.
        });
    });
  }, [preview, siteId, target.id, workflowHydrated]);

  useEffect(() => {
    setSingleSiteCurve((current) =>
      current && current.points.every((point) => point.site === siteId) ? current : null,
    );
  }, [siteId]);

  const handleGenerateSingleSiteCurve = async () => {
    setSingleSiteLoading(true);
    setError(null);
    setFitResult(null);
    try {
      const data = await fetchMicrolensingLightcurve(target.id, siteId);
      setSingleSiteCurve(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '선택한 관측소 곡선을 불러오지 못했습니다.');
    } finally {
      setSingleSiteLoading(false);
    }
  };

  const handleGenerateMergedCurve = async () => {
    setMergedLoading(true);
    setError(null);
    setFitResult(null);
    try {
      const data = await fetchMicrolensingLightcurve(target.id);
      setMergedCurve(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'KMT network 곡선을 불러오지 못했습니다.');
    } finally {
      setMergedLoading(false);
    }
  };

  const handleFit = async () => {
    if (!mergedCurve) return;
    setFitting(true);
    setError(null);
    try {
      const pts = mergedCurve.points;
      const result = await fitMicrolensingModel({
        target_id: target.id,
        points: pts.map((p) => ({ hjd: p.hjd, magnitude: p.magnitude, mag_error: p.mag_error })),
      });
      setFitResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '적합 실패');
    } finally {
      setFitting(false);
    }
  };

  const goTo = (nextStep: KmtnetWorkflowStep) => {
    setStep(nextStep);
  };

  if (!workflowHydrated) return <div className="loading">Restoring workflow...</div>;

  const siteLabel = SITE_LABELS[siteId] ?? siteId.toUpperCase();
  const sitePhoto = SITE_PHOTOS[siteId];
  const coveragePct = networkObservationCount > 0
    ? Math.round((siteObservationCount / networkObservationCount) * 100)
    : 0;
  const isPlanetary = target.type === 'ML-P';
  const draftStatusLabel =
    draftSaveStatus === 'saving'
      ? 'Saving draft...'
      : draftSaveStatus === 'saved'
        ? draftSavedAtLabel
          ? `Saved ${draftSavedAtLabel}`
          : 'Draft saved'
        : draftSaveStatus === 'error'
          ? 'Draft save failed'
          : null;

  return (
    <div className="kmtnet-lab">
      {draftId && draftStatusLabel && (
        <div className={`transit-draft-bar ${draftSaveStatus}`}>
          <span className="transit-draft-bar-label">Draft</span>
          <span className="transit-draft-bar-id">{draftId}</span>
          <span className="transit-draft-bar-status">{draftStatusLabel}</span>
        </div>
      )}
      <StepBar
        current={step}
        hasSingleSiteCurve={workflowAvailability.hasSingleSiteCurve}
        hasMergedCurve={workflowAvailability.hasMergedCurve}
        hasFitResult={workflowAvailability.hasFitResult}
      />

      {/* ── Step 1: Field ── */}
      {step === 'field' && (
        <div className="ml-step-content">
          <div className="ml-step-header">
            <span className="ml-step-chip">Step 1</span>
            <h3>{siteLabel} 원본 field 확인</h3>
            <p>
              선택한 소스를 GoTo한 뒤, 먼저 원본 KMTNet frame에서 왜 crowded-field 측광이 어려운지 확인합니다.
            </p>
          </div>

          <div className="ml-site-photo-row">
            <div className="ml-site-photo-wrap">
              {sitePhoto && !sitePhotoError ? (
                <img
                  src={sitePhoto}
                  alt={`KMTNet ${siteId.toUpperCase()} 관측소`}
                  className="ml-site-photo"
                  onError={() => setSitePhotoError(true)}
                />
              ) : (
                <div className="ml-site-photo-placeholder">
                  <span>{siteId.toUpperCase()}</span>
                </div>
              )}
            </div>
            <div className="ml-site-info-box">
              <strong>{siteId.toUpperCase()} — {siteLabel.split(' ')[1] ?? ''}</strong>
              <dl className="ml-site-dl">
                {siteId === 'ctio' && <>
                  <dt>위치</dt><dd>세로 톨롤로, 칠레 · 해발 2,207 m</dd>
                  <dt>경도</dt><dd>70.8°W</dd>
                </>}
                {siteId === 'saao' && <>
                  <dt>위치</dt><dd>서덜랜드, 남아프리카 · 해발 1,760 m</dd>
                  <dt>경도</dt><dd>20.8°E</dd>
                </>}
                {siteId === 'sso' && <>
                  <dt>위치</dt><dd>사이딩 스프링, 호주 · 해발 1,165 m</dd>
                  <dt>경도</dt><dd>149.1°E</dd>
                </>}
                <dt>망원경</dt><dd>1.6 m · FOV ~4 deg²</dd>
                <dt>데이터</dt><dd>전체의 {coveragePct}% ({siteObservationCount}개 실제 관측)</dd>
              </dl>
            </div>
          </div>

          {preview && (
            <RawFieldCard
              preview={preview}
              siteLabel={siteLabel}
              frameChangeDisabled={previewLoading}
              frameLoading={previewLoading}
              onFrameChange={setPreviewFrameIndex}
            />
          )}
          {previewLoading && !preview && <p className="hint">KMT preview를 생성하는 중...</p>}
          {previewError && <p className="error-message">{previewError}</p>}

          <StepGuide questions={KMT_GUIDES.field} storageKey="easwa_kmt_guide_field" />

          <div className="ml-step-nav">
            <button className="btn-primary" onClick={() => goTo('align')}>
              다음: Frame 정렬 보기 →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Align ── */}
      {step === 'align' && (
        <div className="ml-step-content">
          <div className="ml-step-header">
            <span className="ml-step-chip">Step 2</span>
            <h3>Reference 기준 프레임 정렬</h3>
            <p>
              선택한 frame을 기준 frame에 맞춰 픽셀 단위로 이동시켜, 차분 전에 별상이 최대한 겹치도록 맞춥니다.
            </p>
          </div>

          {preview && (
            <AlignmentPanel
              preview={preview}
              frameChangeDisabled={previewLoading}
              frameLoading={previewLoading}
              onFrameChange={setPreviewFrameIndex}
            />
          )}
          {previewLoading && !preview && <p className="hint">KMT 정렬 preview를 생성하는 중...</p>}
          {previewError && <p className="error-message">{previewError}</p>}

          <StepGuide questions={KMT_GUIDES.align} storageKey="easwa_kmt_guide_align" />

          <div className="ml-step-nav">
            <button className="btn-secondary" onClick={() => goTo('field')}>← 이전</button>
            <button className="btn-primary" onClick={() => goTo('difference')}>
              다음: Difference image 보기 →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Difference ── */}
      {step === 'difference' && (
        <div className="ml-step-content">
          <div className="ml-step-header">
            <span className="ml-step-chip">Step 3</span>
            <h3>Difference image 해석</h3>
            <p>
              기준 frame과 현재 frame을 비교해, 실제로 밝기가 변한 위치만 남기는 KMT식 차분영상을 확인합니다.
            </p>
          </div>

          {preview && (
            <KmtnetPreviewPanel
              preview={preview}
              frameChangeDisabled={previewLoading}
              frameLoading={previewLoading}
              onFrameChange={setPreviewFrameIndex}
            />
          )}
          {previewLoading && !preview && <p className="hint">KMT preview를 생성하는 중...</p>}
          {previewError && <p className="error-message">{previewError}</p>}

          <StepGuide questions={KMT_GUIDES.difference} storageKey="easwa_kmt_guide_difference" />

          <div className="ml-step-nav">
            <button className="btn-secondary" onClick={() => goTo('align')}>← 이전</button>
            <button className="btn-primary" onClick={() => goTo('extract')}>
              다음: Single-site 추출 →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Extract ── */}
      {step === 'extract' && (
        <div className="ml-step-content">
          <div className="ml-step-header">
            <span className="ml-step-chip">Step 4</span>
            <h3>{siteLabel} single-site curve 추출</h3>
            <p>
              선택한 관측소의 sampled 실제 FITS cutout만 사용해, 단일 관측소 곡선을 먼저 생성합니다.
            </p>
          </div>

          {singleSiteLoading && (
            <div className="ml-lightcurve-card">
              <div className="ml-lightcurve-card-head">
                <strong>{siteLabel} single-site curve 추출 중</strong>
                <span>정렬 후 차분 flux를 이용해 선택한 관측소 곡선을 계산하고 있습니다.</span>
              </div>
              <p className="hint">KMTNet 원본 FITS를 내려받아 sampled 실제 광도곡선을 만들고 있습니다.</p>
            </div>
          )}

          {!singleSiteLoading && error && !singleSiteCurve && (
            <p className="error-message">{error}</p>
          )}

          {!singleSiteCurve && !singleSiteLoading && (
            <div className="ml-lightcurve-card">
              <div className="ml-lightcurve-card-head">
                <strong>single-site extraction</strong>
                <span>먼저 선택한 관측소의 곡선을 생성합니다.</span>
              </div>
              <p className="hint">
                이 단계에서는 <strong>{siteLabel}</strong>의 실제 cutout만 사용합니다. network merge는 다음 단계에서 따로 실행합니다.
              </p>
              <div className="ml-step-nav" style={{ marginTop: 12 }}>
                <button className="btn-primary" onClick={() => void handleGenerateSingleSiteCurve()}>
                  {siteLabel} curve 생성
                </button>
              </div>
            </div>
          )}

          {singleSiteCurve && (
            <>
              <div className="ml-network-legend">
                <div className="ml-network-legend-item">
                  <span className="ml-legend-dot" style={{ background: SITE_COLORS[siteId] }} />
                  <span>{siteLabel}</span>
                  <span className="ml-legend-pts">{singlePts.length}개</span>
                </div>
              </div>

              <div className="ml-lightcurve-card">
                <div className="ml-lightcurve-card-head">
                  <strong>Single-site curve</strong>
                  <span>{siteLabel} cutout에서 추출한 실제 sampled 곡선</span>
                </div>
                <PlotPanel
                  lcData={singleSiteCurve}
                  showSites={[siteId]}
                  targetName={`${target.name} — ${siteId.toUpperCase()}`}
                />
              </div>
            </>
          )}

          <StepGuide questions={KMT_GUIDES.extract} storageKey="easwa_kmt_guide_extract" />

          <div className="ml-step-nav">
            <button className="btn-secondary" onClick={() => goTo('difference')}>← 이전</button>
            <button className="btn-primary" onClick={() => goTo('merge')} disabled={!singleSiteCurve || singleSiteLoading}>
              다음: Network merge →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 5: Merge ── */}
      {step === 'merge' && (
        <div className="ml-step-content">
          <div className="ml-step-header">
            <span className="ml-step-chip">Step 5</span>
            <h3>3개 관측소 network curve 병합</h3>
            <p>
              CTIO · SAAO · SSO의 sampled 실제 cutout을 합쳐, 피크와 공백 구간이 어떻게 달라지는지 비교합니다.
            </p>
          </div>

          {!singleSiteCurve && (
            <p className="hint">Step 4에서 선택한 관측소의 곡선을 먼저 생성해야 합니다.</p>
          )}

          {mergedLoading && (
            <div className="ml-lightcurve-card">
              <div className="ml-lightcurve-card-head">
                <strong>KMT network curve 생성 중</strong>
                <span>CTIO · SAAO · SSO를 순서대로 불러와 병합하고 있습니다.</span>
              </div>
              <p className="hint">network merge는 single-site보다 시간이 더 걸릴 수 있습니다.</p>
            </div>
          )}

          {!mergedCurve && singleSiteCurve && !mergedLoading && (
            <div className="ml-lightcurve-card">
              <div className="ml-lightcurve-card-head">
                <strong>network merge</strong>
                <span>이 단계에서 세 관측소의 곡선을 합칩니다.</span>
              </div>
              <p className="hint">
                먼저 만든 <strong>{siteLabel}</strong> 곡선은 유지되고, 여기서 전체 KMTNet 네트워크 곡선을 추가로 생성합니다.
              </p>
              <div className="ml-step-nav" style={{ marginTop: 12 }}>
                <button className="btn-primary" onClick={() => void handleGenerateMergedCurve()}>
                  Network curve 생성
                </button>
              </div>
            </div>
          )}

          {error && <p className="error-message">{error}</p>}

          {singleSiteCurve && mergedCurve && (
            <>
              <div className="ml-network-legend">
                <div className="ml-network-legend-item">
                  <span className="ml-legend-dot" style={{ background: SITE_COLORS[siteId] }} />
                  <span>{siteLabel}</span>
                  <span className="ml-legend-pts">{singlePts.length}개</span>
                </div>
                {ALL_SITES.map((s) => (
                  <div key={s} className="ml-network-legend-item">
                    <span className="ml-legend-dot" style={{ background: SITE_COLORS[s] }} />
                    <span>{SITE_LABELS[s]}</span>
                    <span className="ml-legend-pts">{mergedCurve.points.filter((p) => p.site === s).length}개</span>
                  </div>
                ))}
              </div>

              <div className="ml-lightcurve-stack">
                <div className="ml-lightcurve-card">
                  <div className="ml-lightcurve-card-head">
                    <strong>Single-site curve</strong>
                    <span>{siteLabel} sampled curve</span>
                  </div>
                  <PlotPanel
                    lcData={singleSiteCurve}
                    showSites={[siteId]}
                    targetName={`${target.name} — ${siteId.toUpperCase()}`}
                  />
                </div>
                <div className="ml-lightcurve-card">
                  <div className="ml-lightcurve-card-head">
                    <strong>Network-merged curve</strong>
                    <span>CTIO · SAAO · SSO 실제 cutout을 모두 합친 곡선</span>
                  </div>
                  <PlotPanel
                    lcData={mergedCurve}
                    showSites={ALL_SITES}
                    targetName={`${target.name} — KMTNet`}
                  />
                </div>
              </div>
            </>
          )}

          <StepGuide questions={KMT_GUIDES.merge} storageKey="easwa_kmt_guide_merge" />

          <div className="ml-step-nav">
            <button className="btn-secondary" onClick={() => goTo('extract')}>← 이전</button>
            <button className="btn-primary" onClick={() => goTo('fit')} disabled={!mergedCurve || mergedLoading}>
              다음: Paczyński 모델 적합 →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 6: Fit ── */}
      {step === 'fit' && (
        <div className="ml-step-content">
          <div className="ml-step-header">
            <span className="ml-step-chip">Step 6</span>
            <h3>Paczyński 모델 적합과 해석</h3>
            <p>광도곡선에 단일 렌즈 모델을 맞추고, 얻어진 파라미터가 무엇을 의미하는지 해석합니다.</p>
          </div>

          <div className="ml-formula-box">
            <div className="ml-formula-row">
              <code>u(t) = √( u₀² + ((t − t₀) / t<sub>E</sub>)² )</code>
              <span>렌즈-광원 각거리</span>
            </div>
            <div className="ml-formula-row">
              <code>A(u) = (u² + 2) / ( u √(u² + 4) )</code>
              <span>Paczyński 증폭 인자</span>
            </div>
            <div className="ml-formula-row">
              <code>I(t) = I<sub>base</sub> − 2.5 log₁₀ A(u(t))</code>
              <span>상대 등급 변화</span>
            </div>
          </div>

          {mergedCurve ? (
            <PlotPanel
              lcData={mergedCurve}
              showSites={ALL_SITES}
              fitResult={fitResult}
              targetName={target.name}
            />
          ) : (
            <p className="hint">Step 5에서 network-merged curve를 먼저 생성해야 적합을 실행할 수 있습니다.</p>
          )}

          <div className="ml-fit-controls">
            {!fitResult ? (
              <button className="btn-primary" onClick={handleFit} disabled={fitting || !mergedCurve}>
                {fitting ? '적합 실행 중...' : 'Paczyński 모델 적합 실행'}
              </button>
            ) : (
              <>
                <button className="btn-secondary" onClick={() => { setFitResult(null); }}>
                  초기화
                </button>
                <span className="ml-fit-ok">✓ 적합 완료</span>
              </>
            )}
            {error && <p className="error-message">{error}</p>}
          </div>

          {fitResult && (
            <div className="ml-fit-result">
              <h4>적합 결과</h4>
              <table className="kmtnet-fit-table">
                <thead>
                  <tr>
                    <th>파라미터</th><th>값</th><th>불확도 (1σ)</th><th>물리적 의미</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>t₀</code></td>
                    <td>{fitResult.t0.toFixed(3)}</td>
                    <td>± {fitResult.t0_err.toFixed(3)}</td>
                    <td>피크 시각 (HJD)</td>
                  </tr>
                  <tr>
                    <td><code>u₀</code></td>
                    <td>{fitResult.u0.toFixed(4)}</td>
                    <td>± {fitResult.u0_err.toFixed(4)}</td>
                    <td>최소 충격 파라미터</td>
                  </tr>
                  <tr>
                    <td><code>t<sub>E</sub></code></td>
                    <td>{fitResult.tE.toFixed(2)} d</td>
                    <td>± {fitResult.tE_err.toFixed(2)} d</td>
                    <td>아인슈타인 반경 통과 시간</td>
                  </tr>
                  <tr>
                    <td><code>I<sub>base</sub></code></td>
                    <td>{fitResult.mag_base.toFixed(3)}</td>
                    <td>± {fitResult.mag_base_err.toFixed(3)}</td>
                    <td>기준 밝기</td>
                  </tr>
                  <tr>
                    <td><code>χ²/dof</code></td>
                    <td colSpan={2}>{fitResult.chi2_dof.toFixed(3)}</td>
                    <td>모델 적합도 (≈1이 이상적)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <StepGuide questions={KMT_GUIDES.fit} storageKey="easwa_kmt_guide_fit" />

          {fitResult && (
            <div className="ml-interpret-grid">
              <div className="ml-interpret-card">
                <span className="ml-interpret-param">u₀ = {fitResult.u0.toFixed(4)}</span>
                <strong>충격 파라미터</strong>
                <p>
                  최대 증폭 A<sub>max</sub> ≈ {((fitResult.u0 ** 2 + 2) / (fitResult.u0 * Math.sqrt(fitResult.u0 ** 2 + 4))).toFixed(2)}배.
                  u₀가 작을수록 렌즈와 광원이 더 정렬되어 증폭이 큽니다.
                  {fitResult.u0 < 0.1 && ' 이 이벤트는 고증폭(u₀ < 0.1) — 아인슈타인 링에 근접합니다.'}
                </p>
              </div>
              <div className="ml-interpret-card">
                <span className="ml-interpret-param">t<sub>E</sub> = {fitResult.tE.toFixed(1)} d</span>
                <strong>아인슈타인 반경 통과 시간</strong>
                <p>
                  렌즈 질량·거리·상대 속도에 의존: t<sub>E</sub> = θ<sub>E</sub> / μ<sub>rel</sub>.
                  은하 벌지 이벤트의 전형적인 t<sub>E</sub>는 10–100일이며,
                  이 이벤트는 {fitResult.tE < 20 ? '짧은' : fitResult.tE > 60 ? '긴' : '중간 범위의'} 이벤트입니다.
                </p>
              </div>
              <div className="ml-interpret-card">
                <span className="ml-interpret-param">χ²/dof = {fitResult.chi2_dof.toFixed(2)}</span>
                <strong>모델 적합도</strong>
                <p>
                  {fitResult.chi2_dof < 1.5
                    ? '단일 렌즈 모델로 데이터를 잘 설명합니다.'
                    : '잔차에 체계적 패턴이 있을 수 있습니다.'}
                  {isPlanetary && ' 이 이벤트는 행성 이상신호를 포함하므로 단일 렌즈 적합에서 잔차가 크게 나타날 수 있습니다.'}
                </p>
              </div>
              {isPlanetary && (
                <div className="ml-interpret-card ml-interpret-card--highlight">
                  <span className="ml-interpret-param">행성 이상신호</span>
                  <strong>이진 렌즈 신호</strong>
                  <p>
                    단일 렌즈 곡선에서 벗어난 짧은 추가 증폭은 렌즈 주변의 행성 신호입니다.
                    완전한 분석에는 질량비 q와 투영 분리 s를 추가 파라미터로 하는
                    이진 렌즈(binary lens) 모델이 필요합니다.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="ml-ref-footer">
            <p>
              <span className="ml-cite">Paczyński (1986, ApJ 304, 1)</span> ·
              <span className="ml-cite">Kim et al. (2016, JKAS 49, 37)</span> ·
              <span className="ml-cite">Albrow et al. (2009, ApJ 698, 1323)</span>
            </p>
          </div>

          <div className="ml-step-nav">
            <button className="btn-secondary" onClick={() => goTo('merge')}>← 이전</button>
            {fitResult && (
              <button className="btn-primary" onClick={() => goTo('record')}>
                다음: 결과 저장 →
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'record' && fitResult && (
        <div className="ml-step-content">
          <div className="ml-step-header">
            <span className="ml-step-chip">Step 7</span>
            <h3>결과 저장</h3>
            <p>
              이 해석 결과를 Google 로그인 계정의 분석 보관함에 저장합니다.
            </p>
          </div>

          <div className="transit-controls-card">
            <h4>Archive Record</h4>
            <p className="hint">
              Saved records show up in <strong>My Analyses</strong> and can be reopened as a new draft later.
            </p>
            {!user && (
              <div className="transit-callout" style={{ marginTop: 12 }}>
                Sign in with Google to save this KMT analysis into your archive history.
              </div>
            )}
            {submittedRecord && (
              <div className="transit-config-summary" style={{ marginTop: 12 }}>
                <div className="transit-config-row">
                  <span>Submission</span>
                  <span>#{submittedRecord.submission_id}</span>
                </div>
                <div className="transit-config-row">
                  <span>Saved To</span>
                  <span>{submittedRecord.export_path}</span>
                </div>
              </div>
            )}
          </div>

          {recordTemplate && (
            <div className="record-form-shell" style={{ marginTop: 16 }}>
              <div className="record-form-head">
                <div>
                  <h4>{recordTemplate.title}</h4>
                  <p className="hint">{recordTemplate.description}</p>
                </div>
              </div>

          <div className="record-cover-card">
                <div className="record-cover-head">
                  <div>
                    <span className="record-section-kicker">Submission</span>
                    <h4>Summary</h4>
                  </div>
                  <span className="record-required-note">* Required</span>
                </div>
                <label className="record-form-field">
                  <span className="record-field-label">
                    Record Title
                    <strong className="record-required">*</strong>
                  </span>
                  <input
                    type="text"
                    value={recordTitle}
                    onChange={(event) => {
                      const nextTitle = event.target.value;
                      setRecordTitle(nextTitle);
                      setRecordAnswers((current) => ({
                        ...current,
                        summary_title: nextTitle,
                      }));
                    }}
                    placeholder={`${target.name} microlensing interpretation`}
                  />
                </label>
              </div>

              <div className="record-form-grid">
                {recordTemplate.questions
                  .filter((question) => question.id !== 'summary_title')
                  .map((question) => (
                  <label
                    key={question.id}
                    className={`record-question-card ${question.type === 'textarea' ? 'record-question-card-wide' : ''}`}
                  >
                    <div className="record-question-head">
                      <span className="record-field-label">
                        {question.label}
                        {question.required && <strong className="record-required">*</strong>}
                      </span>
                      {question.help_text && (
                        <small className="record-question-help">{question.help_text}</small>
                      )}
                    </div>
                    <RecordQuestionField
                      question={question}
                      value={recordAnswers[question.id]}
                      onChange={(nextValue) =>
                        setRecordAnswers((current) => ({ ...current, [question.id]: nextValue }))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {submittedRecord && (
            <div className="transit-run-done transit-record-saved">
              <div className="transit-record-saved-msg">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green, #4ade80)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span>Record #{submittedRecord.submission_id} saved.</span>
              </div>
              <div className="transit-record-saved-actions">
                <a href="/my" className="btn-sm">
                  Open My Analyses
                </a>
              </div>
            </div>
          )}

          <div className="ml-step-nav">
            <button className="btn-secondary" onClick={() => goTo('fit')}>← 이전</button>
            {!user && (
              <a href="/api/auth/login" className="btn-sm">
                Sign In to Save
              </a>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={recordSubmitting || !user}
              onClick={async () => {
                setRecordSubmitting(true);
                setError(null);
                try {
                  const submissionAnswers = buildKmtnetRecordAnswers(
                    recordAnswers,
                    recordTitle,
                    target.name,
                  );
                  const response = await submitRecordTemplate('kmtnet_record', {
                    workflow: 'kmtnet_lab',
                    target_id: target.id,
                    observation_ids: [siteId],
                    title: recordTitle.trim() || `${target.name} microlensing analysis`,
                    context: {
                      target_name: target.name,
                      site_id: siteId,
                      site_label: siteLabel,
                      frame_count: mergedCurve?.points.length ?? 0,
                      light_curve: mergedCurve,
                      single_site_curve: singleSiteCurve,
                      merged_curve: mergedCurve,
                      microlensing_fit: fitResult,
                      preview_frame_index: previewFrameIndex,
                      target_type: target.type,
                    },
                    answers: submissionAnswers,
                    guide_answers: {},
                  });
                  setRecordAnswers(submissionAnswers);
                  setSubmittedRecord(response);
                } catch (submitError) {
                  console.error('Failed to submit KMT analysis record', submitError);
                  setError(
                    submitError instanceof Error
                      ? submitError.message
                      : 'Failed to submit KMT analysis record.',
                  );
                } finally {
                  setRecordSubmitting(false);
                }
              }}
            >
              {recordSubmitting ? 'Submitting...' : 'Submit Record'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
