import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchTargets } from '../../api/client';
import type { Target } from '../../types/target';
import {
  buildLabHref,
  getExplorerContext,
} from '../../utils/explorerNavigation';
import { KmtnetSkyMap } from '../sky/KmtnetSkyMap';

const SITE_LABELS: Record<string, string> = {
  ctio: 'CTIO — 칠레',
  saao: 'SAAO — 남아프리카',
  sso:  'SSO — 호주',
};

const TYPE_LABEL: Record<string, string> = {
  'ML':    '단일 렌즈',
  'ML-HM': '고증폭',
  'ML-P':  '행성 이상신호',
};

const TYPE_COLOR: Record<string, string> = {
  'ML':    '#60a5fa',
  'ML-HM': '#fb923c',
  'ML-P':  '#4ade80',
};

const ALL_TYPES = ['ML', 'ML-HM', 'ML-P'] as const;

// ── Inline popup ──────────────────────────────────────────────────────────────

interface PopupProps {
  event: Target;
  onGoto: () => void;
  onExplore: () => void;
  onClose: () => void;
}

function KmtnetEventPopup({ event, onGoto, onExplore, onClose }: PopupProps) {
  const color = TYPE_COLOR[event.type] ?? '#94a3b8';
  const label = TYPE_LABEL[event.type]  ?? event.type;
  return (
    <div className="kmt-event-popup">
      <div className="kmt-popup-header">
        <span className="kmt-popup-type-badge" style={{ color, borderColor: color + '55', background: color + '18' }}>
          {label}
        </span>
        <button className="kmt-popup-close" onClick={onClose} aria-label="닫기">&times;</button>
      </div>
      <h3 className="kmt-popup-name">{event.name}</h3>
      <p className="kmt-popup-coord">
        RA {event.ra.toFixed(3)}° &ensp; Dec {event.dec.toFixed(3)}° &ensp;·&ensp; {event.constellation}
      </p>
      <p className="kmt-popup-mag">{event.magnitude_range}</p>
      <p className="kmt-popup-desc">{event.description}</p>
      <div className="kmt-popup-actions">
        <button className="btn-secondary kmt-popup-goto" onClick={onGoto}>
          GoTo ↗
        </button>
        <button className="btn-primary" onClick={onExplore}>
          탐구 시작 →
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function KmtnetExplorerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const context = getExplorerContext(searchParams, { moduleId: 'kmtnet', siteId: 'ctio' });
  const siteId = context.siteId ?? 'ctio';
  const siteLabel = SITE_LABELS[siteId] ?? siteId.toUpperCase();

  const [events, setEvents]           = useState<Target[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [typeFilter, setTypeFilter]   = useState<string | null>(null);
  const [nameSearch, setNameSearch]   = useState('');
  const [selectedEvent, setSelectedEvent] = useState<Target | null>(null);
  const [focusTarget, setFocusTarget]     = useState<Target | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchTargets('microlensing')
      .then((data) => { setEvents(data); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, []);

  const labHref = (ev: Target) =>
    buildLabHref(
      ev.id,
      { moduleId: 'kmtnet', topicId: 'microlensing', siteId },
      [
        ['workflow', 'microlensing'],
        ['step', 'field'],
      ],
    );

  const handleMapClick = (ev: Target) => {
    setSelectedEvent(ev);
  };

  const handleGoto = () => {
    if (!selectedEvent) return;
    setFocusTarget(selectedEvent);
  };

  const handleExplore = () => {
    if (!selectedEvent) return;
    navigate(labHref(selectedEvent));
  };

  const q = nameSearch.trim().toLowerCase();
  const filteredEvents = events.filter((e) => {
    if (typeFilter && e.type !== typeFilter) return false;
    if (q && !e.name.toLowerCase().includes(q) && !e.id.toLowerCase().includes(q)) return false;
    return true;
  });
  const mapEvents = q || typeFilter ? filteredEvents : events;

  return (
    <div className="edu-page">
      <div className="edu-page-inner">

        <header className="edu-header">
          <Link to="/kmtnet/sites" className="back-link">&larr; 관측소 선택</Link>
          <span className="page-chip">KMTNet · {siteLabel}</span>
          <h1>미시중력렌즈 이벤트 탐구</h1>
          <p>
            은하 벌지 방향 40개 이벤트가 하늘 지도에 표시됩니다.
            마커를 클릭하거나 아래 목록에서 이벤트를 선택하면
            CTIO · SAAO · SSO 측광 자료를 불러와 Paczyński 모델을 직접 적합할 수 있습니다.
          </p>
        </header>

        {/* ── Search + Sky map ── */}
        {!loading && !error && (
          <section className="kmt-skymap-section">
            <div className="kmt-search-bar">
              <input
                type="search"
                className="kmt-search-input"
                placeholder="이벤트 이름 검색 (예: KMT-2022, blg-0440)…"
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
              />
              {q && (
                <span className="kmt-search-count">
                  {filteredEvents.length} / {events.length}
                </span>
              )}
            </div>

            {/* Map + popup wrapper */}
            <div className="kmt-map-popup-wrap">
              <KmtnetSkyMap
                events={mapEvents}
                siteId={siteId}
                selectedEvent={selectedEvent}
                focusTarget={focusTarget}
                onEventClick={handleMapClick}
              />
              {selectedEvent && (
                <KmtnetEventPopup
                  event={selectedEvent}
                  onGoto={handleGoto}
                  onExplore={handleExplore}
                  onClose={() => setSelectedEvent(null)}
                />
              )}
            </div>
          </section>
        )}

        {/* ── Data pipeline ── */}
        <section className="kmtnet-pipeline-box">
          <h3>데이터 처리 파이프라인</h3>
          <div className="kmtnet-pipeline-steps">
            <div className="kmtnet-pipeline-step">
              <span className="kmtnet-step-num">1</span>
              <div>
                <strong>차분 이미지 분석 (DIA)</strong>
                <p>
                  기준 이미지와 각 관측 이미지의 차이를 픽셀 단위로 측정.
                  배경별이 밀집한 은하 벌지에서 혼합광(blending) 문제를 최소화.
                  <span className="kmtnet-ref"> [pySIS: Albrow et al. 2009; pyDIA: Albrow 2017]</span>
                </p>
              </div>
            </div>
            <div className="kmtnet-pipeline-step">
              <span className="kmtnet-step-num">2</span>
              <div>
                <strong>I-band 측광 및 보정</strong>
                <p>
                  KMTNet은 주로 Cousins I-band (λ<sub>eff</sub> ≈ 800 nm)로 관측.
                  3개 관측소의 측광 영점(zeropoint)을 공통 기준으로 정렬.
                  <span className="kmtnet-ref"> [Kim et al. 2016, JKAS 49, 37]</span>
                </p>
              </div>
            </div>
            <div className="kmtnet-pipeline-step">
              <span className="kmtnet-step-num">3</span>
              <div>
                <strong>Paczyński 모델 적합</strong>
                <p>
                  단일 렌즈 3-파라미터 모델 (t₀, u₀, t<sub>E</sub>)을 MCMC 또는
                  Levenberg–Marquardt로 적합.
                  행성 신호가 있으면 이진 렌즈(binary lens) 모델 확장.
                  <span className="kmtnet-ref"> [Paczyński 1986, ApJ 304, 1]</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Event list ── */}
        <section>
          <div className="kmt-list-header">
            <h2 className="edu-section-title" style={{ marginBottom: 0 }}>
              이벤트 목록
              <span className="kmt-list-count">{filteredEvents.length} / {events.length}</span>
            </h2>
            <div className="kmt-list-filter">
              <button
                type="button"
                className={`kmt-list-chip${!typeFilter ? ' active' : ''}`}
                onClick={() => setTypeFilter(null)}
              >
                전체
              </button>
              {ALL_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`kmt-list-chip${typeFilter === t ? ' active' : ''}`}
                  style={{ '--chip-color': TYPE_COLOR[t] } as React.CSSProperties}
                  onClick={() => setTypeFilter(typeFilter === t ? null : t)}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          {loading && <p className="hint">이벤트 불러오는 중...</p>}
          {error && <p className="error-message">{error}</p>}

          {!loading && !error && (
            <div className="kmtnet-event-list">
              {filteredEvents.map((ev) => {
                const color = TYPE_COLOR[ev.type] ?? '#64748b';
                const typeLabel = TYPE_LABEL[ev.type] ?? ev.type;
                const isSelected = selectedEvent?.id === ev.id;
                return (
                  <article
                    key={ev.id}
                    className={`kmtnet-event-card${isSelected ? ' selected' : ''}`}
                    onClick={() => setSelectedEvent(isSelected ? null : ev)}
                  >
                    <div className="kmtnet-event-header">
                      <span
                        className="kmtnet-event-type-badge"
                        style={{ background: color + '18', color, borderColor: color + '44' }}
                      >
                        {typeLabel}
                      </span>
                      <strong className="kmtnet-event-name">{ev.name}</strong>
                      <span className="kmtnet-event-mag">{ev.magnitude_range}</span>
                    </div>
                    <p className="kmtnet-event-desc">{ev.description}</p>
                    <div className="kmtnet-event-footer">
                      <span className="kmtnet-event-coord">
                        RA {ev.ra.toFixed(2)}°&ensp;Dec {ev.dec.toFixed(2)}°&ensp;·&ensp;{ev.constellation}
                      </span>
                      <Link
                        to={labHref(ev)}
                        className="btn-primary kmtnet-event-cta"
                        onClick={(e) => e.stopPropagation()}
                      >
                        탐구 시작 →
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* ── References ── */}
        <section className="kmtnet-ref-section">
          <h3>참고 문헌</h3>
          <ul className="kmtnet-ref-list">
            <li>Kim et al. (2016) — <em>KMTNet: A Network of 1.6m Wide-Field Optical Telescopes</em>, JKAS 49, 37</li>
            <li>Albrow et al. (2009) — <em>Difference Imaging Photometry of Blended Gravitational Microlensing Events</em>, ApJ 698, 1323</li>
            <li>Albrow (2017) — <em>pyDIA: Difference Image Analysis Software</em>, Zenodo</li>
            <li>Paczyński (1986) — <em>Gravitational Microlensing by the Galactic Halo</em>, ApJ 304, 1</li>
            <li>Gould (2000) — <em>A Natural Formalism for Microlensing</em>, ApJ 542, 785</li>
          </ul>
        </section>

      </div>
    </div>
  );
}
