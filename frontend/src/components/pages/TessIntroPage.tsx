import { Link } from 'react-router-dom';
import { buildExplorerHref } from '../../utils/explorerNavigation';

// HD 189733b 외계행성 대기 관측 이미지 (ESA/Hubble, CC BY 4.0)
const TESS_BANNER =
  'https://cdn.esahubble.org/archives/images/screen/heic0612b.jpg';

const TESS_EXPLORER = buildExplorerHref({
  moduleId: 'tess',
  topicId: 'exoplanet_transit',
  siteId: null,
});

function TransitDiagram() {
  // 상단: 별을 중심으로 행성이 수평으로 횡단.
  // 하단: x축이 시간축과 동일하게 정렬된 광도곡선.
  // 행성이 별 앞에 있을 때 깊이 감소가 같은 x 위치에서 일어남을 한눈에 보이게 함.
  const STAR_CX = 220;
  const STAR_CY = 90;
  const STAR_R = 44;
  const ORBIT_Y = STAR_CY;

  const INGRESS_X = STAR_CX - STAR_R;
  const EGRESS_X = STAR_CX + STAR_R;

  const BASE_Y = 200;
  const DIP_Y = 228;

  return (
    <svg viewBox="0 0 440 290" className="edu-svg" aria-hidden="true">
      <defs>
        <radialGradient id="tess-star" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="55%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
        <marker id="tl-arr" markerWidth="7" markerHeight="5" refX="6.5" refY="2.5" orient="auto">
          <polygon points="0 0, 7 2.5, 0 5" fill="#64748b" />
        </marker>
      </defs>

      {/* ── 상단: 별과 행성 궤도 ───────────────────────── */}

      {/* 궤도(수평 경로) */}
      <line x1="40" y1={ORBIT_Y} x2="400" y2={ORBIT_Y}
        stroke="#334155" strokeWidth="1" strokeDasharray="4 4" />
      <line x1="355" y1={ORBIT_Y} x2="395" y2={ORBIT_Y}
        stroke="#64748b" strokeWidth="1.2" markerEnd="url(#tl-arr)" />

      {/* 별 glow + 본체 */}
      <circle cx={STAR_CX} cy={STAR_CY} r={STAR_R + 22}
        fill="url(#tess-star)" opacity="0.22" />
      <circle cx={STAR_CX} cy={STAR_CY} r={STAR_R} fill="url(#tess-star)" />

      {/* 행성 3단계: 접근 → 별 앞(transit) → 통과 후 */}
      <circle cx="110" cy={ORBIT_Y} r="8"
        fill="#0f172a" stroke="#7dd3fc" strokeWidth="1.5" opacity="0.35" />
      <circle cx={STAR_CX} cy={STAR_CY} r="8"
        fill="#0f172a" stroke="#7dd3fc" strokeWidth="2" />
      <circle cx="330" cy={ORBIT_Y} r="8"
        fill="#0f172a" stroke="#7dd3fc" strokeWidth="1.5" opacity="0.35" />

      {/* 라벨 */}
      <text x={STAR_CX} y={STAR_CY + STAR_R + 18} textAnchor="middle"
        fill="#fbbf24" fontSize="12" fontFamily="system-ui, sans-serif">별 (항성)</text>
      <text x="110" y={ORBIT_Y - 14} textAnchor="middle"
        fill="#7dd3fc" fontSize="11" fontFamily="system-ui, sans-serif">행성</text>
      <text x={STAR_CX} y={STAR_CY - 4} textAnchor="middle"
        fill="#e0f2fe" fontSize="10" fontFamily="IBM Plex Mono, monospace">transit</text>

      {/* 상·하 영역 구분 */}
      <line x1="20" y1="165" x2="420" y2="165" stroke="#1e293b" strokeWidth="1" />

      {/* ── 하단: 광도곡선 (x축이 상단 궤도와 동일 스케일) ── */}

      {/* 축 */}
      <line x1="40" y1="260" x2="400" y2="260"
        stroke="#475569" strokeWidth="1.3" markerEnd="url(#tl-arr)" />
      <line x1="40" y1="260" x2="40" y2="180"
        stroke="#475569" strokeWidth="1.3" markerEnd="url(#tl-arr)" />
      <text x="220" y="278" textAnchor="middle" fill="#94a3b8"
        fontSize="11" fontFamily="system-ui, sans-serif">시간</text>
      <text x="24" y="220" textAnchor="middle" fill="#94a3b8"
        fontSize="11" fontFamily="system-ui, sans-serif"
        transform="rotate(-90 24 220)">밝기</text>

      {/* 광도곡선: 평탄 → 딥(별 앞 통과 구간) → 평탄 */}
      <path
        d={`M45,${BASE_Y} L${INGRESS_X - 14},${BASE_Y} L${INGRESS_X},${DIP_Y} L${EGRESS_X},${DIP_Y} L${EGRESS_X + 14},${BASE_Y} L400,${BASE_Y}`}
        fill="none" stroke="#e8722a" strokeWidth="2.5" strokeLinejoin="round" />

      {/* 별 앞 통과 구간을 상·하로 연결하는 가이드 라인 */}
      <line x1={INGRESS_X} y1={ORBIT_Y + STAR_R - 10} x2={INGRESS_X} y2={BASE_Y}
        stroke="#475569" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
      <line x1={EGRESS_X} y1={ORBIT_Y + STAR_R - 10} x2={EGRESS_X} y2={BASE_Y}
        stroke="#475569" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />

      {/* 깊이 브래킷 */}
      <line x1={EGRESS_X + 30} y1={BASE_Y} x2={EGRESS_X + 30} y2={DIP_Y}
        stroke="#94a3b8" strokeWidth="1" />
      <line x1={EGRESS_X + 26} y1={BASE_Y} x2={EGRESS_X + 34} y2={BASE_Y}
        stroke="#94a3b8" strokeWidth="1" />
      <line x1={EGRESS_X + 26} y1={DIP_Y} x2={EGRESS_X + 34} y2={DIP_Y}
        stroke="#94a3b8" strokeWidth="1" />
      <text x={EGRESS_X + 40} y={(BASE_Y + DIP_Y) / 2 + 4} fill="#cbd5f5"
        fontSize="10" fontFamily="IBM Plex Mono, monospace">
        깊이 ∝ (R_p / R_★)²
      </text>

      {/* transit 구간 표시 */}
      <text x={STAR_CX} y={DIP_Y + 14} textAnchor="middle" fill="#e8722a"
        fontSize="10" fontFamily="IBM Plex Mono, monospace">transit 구간</text>
    </svg>
  );
}

const TESS_FACTS = [
  { value: '~400,000', label: '관측 대상 별', sub: '밝고 가까운 별 우선' },
  { value: '96° × 24°', label: '섹터 크기', sub: '전천을 26개 섹터로 분할' },
  { value: '27일', label: '섹터당 관측 기간', sub: '2분 간격 연속 측광' },
  { value: '~200 ppm', label: '광도 정밀도', sub: '목성 크기 행성 검출 가능' },
];

export function TessIntroPage() {
  return (
    <div className="edu-page">
      <div className="edu-page-inner">

        {/* 헤더 */}
        <header className="edu-header">
          <Link to="/" className="back-link">&larr; 홈</Link>
          <span className="page-chip">NASA TESS · Transit Photometry</span>
          <h1>별빛이 살짝 어두워질 때 — 외계행성 식현상</h1>
          <p>
            행성이 별과 지구 사이를 지나가면 별빛의 일부가 가려져 밝기가 미세하게 감소합니다.
            TESS는 이 순간을 우주에서 포착해 수십만 개 별의 광도곡선을 기록합니다.
          </p>
        </header>

        {/* 페이지 배너 이미지 */}
        <div className="edu-page-banner-wrap">
          <img
            src={TESS_BANNER}
            alt="ESA/Hubble — 외계행성 HD 189733b 대기 관측 아티스트 인상화"
            className="edu-page-banner-img"
            loading="lazy"
          />
          <span className="edu-page-banner-credit">ESA / Hubble &amp; NASA · HD 189733b</span>
        </div>

        {/* 현상 설명: 다이어그램 + 텍스트 */}
        <section className="edu-explain">
          <div className="edu-diagram-wrap">
            <TransitDiagram />
            <p className="edu-diagram-caption">
              행성이 별 앞을 통과(transit)하는 동안 광도곡선에 특징적인 딥이 나타납니다.
            </p>
          </div>
          <div className="edu-explain-text">
            <h2>식현상(Transit)으로 행성 크기를 알 수 있다</h2>
            <p>
              빛의 감소 깊이는 행성 반지름과 별 반지름의 비로 결정됩니다.
              지구 크기 행성은 약 0.01%, 목성 크기 행성은 약 1%의 밝기 감소를 만듭니다.
            </p>
            <ul className="edu-bullet-list">
              <li>
                <strong>transit 깊이</strong> — <code>(R<sub>p</sub> / R<sub>★</sub>)²</code> 로부터 행성 크기 추정
              </li>
              <li>
                <strong>transit 주기</strong> — 반복 관측으로 공전 주기 결정
              </li>
              <li>
                <strong>transit 지속 시간</strong> — 궤도 반경과 별의 크기에 의존
              </li>
            </ul>
            <p>
              TESS는 각 섹터를 약 27일 연속 관측하므로, 수일 이내 주기의 행성은
              여러 번의 transit을 기록할 수 있습니다.
            </p>
          </div>
        </section>

        {/* TESS 주요 사양 */}
        <section className="edu-facts-section">
          <h2 className="edu-section-title">TESS 주요 사양</h2>
          <div className="edu-facts-grid">
            {TESS_FACTS.map((f) => (
              <div key={f.label} className="edu-fact-card">
                <span className="edu-fact-value">{f.value}</span>
                <strong className="edu-fact-label">{f.label}</strong>
                <span className="edu-fact-sub">{f.sub}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 탐구 흐름 안내 (CTA) */}
        <section className="edu-cta-section">
          <div className="edu-cta-text">
            <h2>이제 직접 대상을 골라보세요</h2>
            <p>
              전천 탐색 화면에서 실제 TESS 관측 대상을 선택하고, Sector 자료를 불러와
              광도곡선과 transit fit을 직접 수행할 수 있습니다.
            </p>
          </div>
          <div className="edu-cta-actions">
            <Link to={TESS_EXPLORER} className="btn-primary">
              전천 탐색 시작 →
            </Link>
            <Link to="/" className="btn-secondary">
              홈으로
            </Link>
          </div>
        </section>

      </div>
    </div>
  );
}
