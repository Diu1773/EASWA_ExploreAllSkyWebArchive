import { Link } from 'react-router-dom';

// 우리 은하 파노라마 — 은하 벌지가 선명히 보임 (public/milkyway.png)
const KMT_BANNER = '/milkyway.png';

// SAAO Sutherland 관측소 (Wikimedia Commons)
const SAAO_IMG =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/SAAO_observatory_sutherland.jpg/800px-SAAO_observatory_sutherland.jpg';

// SSO Siding Spring 관측소 (Wikimedia Commons)
const SSO_IMG =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Siding_Spring_Observatory_2021.jpg/800px-Siding_Spring_Observatory_2021.jpg';

function MicrolensingDiagram() {
  return (
    <svg viewBox="0 0 340 340" className="edu-svg edu-svg--square" aria-hidden="true">
      <defs>
        <radialGradient id="ml-source" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="100%" stopColor="#fbbf24" />
        </radialGradient>
        <radialGradient id="ml-lens" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#bfdbfe" />
          <stop offset="100%" stopColor="#60a5fa" />
        </radialGradient>
        <marker id="ml-arr" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
          <polygon points="0 0, 7 2.5, 0 5" fill="#475569" />
        </marker>
      </defs>

      {/* 배경별 (광원) — 상단 */}
      <circle cx="170" cy="38" r="20" fill="url(#ml-source)" />
      <circle cx="170" cy="38" r="30" fill="#fbbf24" opacity="0.1" />
      <text x="170" y="24" textAnchor="middle" fill="#fde68a"
        fontSize="11" fontFamily="system-ui, sans-serif">배경별 (광원)</text>

      {/* 휘어진 광선: 광원 → 렌즈 → 관측자 */}
      <path d="M 160 58 Q 130 170 148 302"
        fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.7" />
      <path d="M 180 58 Q 210 170 192 302"
        fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.7" />

      {/* 아인슈타인 링 (점선 원) */}
      <circle cx="170" cy="170" r="50"
        fill="none" stroke="#60a5fa" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
      <text x="228" y="154" fill="#60a5fa"
        fontSize="9.5" fontFamily="IBM Plex Mono, monospace" opacity="0.75">Einstein ring</text>

      {/* 렌즈 천체 — 중앙 */}
      <circle cx="170" cy="170" r="22" fill="url(#ml-lens)" />
      <circle cx="170" cy="170" r="32" fill="#60a5fa" opacity="0.1" />
      <text x="170" y="157" textAnchor="middle" fill="#bfdbfe"
        fontSize="11" fontFamily="system-ui, sans-serif">렌즈 천체</text>

      {/* 정렬 축 (점선) */}
      <line x1="170" y1="58" x2="170" y2="148"
        stroke="#334155" strokeWidth="1" strokeDasharray="4 3" />
      <line x1="170" y1="192" x2="170" y2="290"
        stroke="#334155" strokeWidth="1" strokeDasharray="4 3" />

      {/* 관측자 (지구) — 하단 */}
      <circle cx="170" cy="302" r="12" fill="#e8722a" />
      <text x="170" y="322" textAnchor="middle" fill="#e8722a"
        fontSize="11" fontFamily="system-ui, sans-serif">관측자 (KMTNet)</text>
    </svg>
  );
}

function MagCurve() {
  // 정규 곡선(점선, 행성 없음)과 관측 곡선(실선, 행성 이상신호 포함)을 겹쳐 표시.
  // 이상신호는 정규 곡선의 강하구간 위에 짧은 caustic crossing 스파이크로 표현.
  return (
    <svg viewBox="0 0 240 150" className="edu-svg edu-svg--curve" aria-hidden="true">
      <defs>
        <marker id="mc-arr" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
          <polygon points="0 0, 7 2.5, 0 5" fill="#475569" />
        </marker>
      </defs>

      {/* 축 */}
      <line x1="28" y1="128" x2="228" y2="128"
        stroke="#475569" strokeWidth="1.3" markerEnd="url(#mc-arr)" />
      <line x1="28" y1="128" x2="28" y2="14"
        stroke="#475569" strokeWidth="1.3" markerEnd="url(#mc-arr)" />
      <text x="128" y="143" textAnchor="middle" fill="#94a3b8"
        fontSize="11" fontFamily="system-ui, sans-serif">시간</text>
      <text x="14" y="72" textAnchor="middle" fill="#94a3b8"
        fontSize="11" fontFamily="system-ui, sans-serif"
        transform="rotate(-90 14 72)">증폭</text>

      {/* 기준선 (A = 1) */}
      <line x1="28" y1="108" x2="228" y2="108"
        stroke="#334155" strokeWidth="1" strokeDasharray="3 2" opacity="0.5" />

      {/* 정규 미시중력렌즈 곡선 (Paczyński, 점선) — 행성 없는 경우 */}
      <path
        d="M 28,108 C 78,108 94,108 104,98 C 116,82 122,58 128,30 C 134,58 140,82 152,98 C 162,108 178,108 228,108"
        fill="none" stroke="#7dd3fc" strokeWidth="1.8"
        strokeLinejoin="round" strokeDasharray="4 3" opacity="0.75" />

      {/* 관측 곡선 (실선) — 강하구간에 짧은 caustic crossing 스파이크 포함 */}
      <path
        d="M 28,108 C 78,108 94,108 104,98 C 116,82 122,58 128,30 C 132,48 135,60 138,66 L 141,48 L 144,56 L 147,70 C 152,86 162,108 228,108"
        fill="none" stroke="#e8722a" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />

      {/* peak 라벨 */}
      <line x1="128" y1="30" x2="128" y2="22"
        stroke="#7dd3fc" strokeWidth="1" opacity="0.6" />
      <text x="128" y="18" textAnchor="middle" fill="#7dd3fc"
        fontSize="9.5" fontFamily="IBM Plex Mono, monospace">peak (정렬)</text>

      {/* anomaly 라벨 (리더 라인) */}
      <line x1="144" y1="52" x2="172" y2="40"
        stroke="#e8722a" strokeWidth="1" opacity="0.8" />
      <circle cx="144" cy="52" r="1.6" fill="#e8722a" />
      <text x="176" y="42" fill="#e8722a"
        fontSize="9" fontFamily="IBM Plex Mono, monospace">anomaly</text>
      <text x="176" y="53" fill="#e8722a"
        fontSize="9" fontFamily="IBM Plex Mono, monospace">(행성 신호)</text>

      {/* 범례 */}
      <g fontFamily="system-ui, sans-serif" fontSize="8.5">
        <line x1="32" y1="122" x2="50" y2="122" stroke="#7dd3fc"
          strokeWidth="1.8" strokeDasharray="4 3" opacity="0.75" />
        <text x="54" y="125" fill="#94a3b8">단일 렌즈</text>
        <line x1="108" y1="122" x2="126" y2="122" stroke="#e8722a" strokeWidth="2" />
        <text x="130" y="125" fill="#94a3b8">행성 포함</text>
      </g>
    </svg>
  );
}

// 관측소 사진: public/images/ 폴더에 파일 추가 후 image 경로 채우면 바로 적용
const KMT_SITES = [
  {
    code: 'CTIO',
    country: '칠레',
    location: '세로 톨롤로, 칠레 북부',
    detail: '해발 2,207 m. 남미 구간을 담당하며 은하 벌지가 하늘 높이 뜨는 위치.',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/KMTNet_CTIO_small.jpg/800px-KMTNet_CTIO_small.jpg' as string | null,
    imageCredit: 'KASI / KMTNet',
  },
  {
    code: 'SAAO',
    country: '남아프리카',
    location: '서덜랜드, 남아프리카공화국',
    detail: '해발 1,760 m. 경도상 중간에 위치해 CTIO와 SSO 사이의 관측 공백을 잇는 핵심 거점.',
    image: SAAO_IMG as string | null,
    imageCredit: 'Wikimedia Commons',
  },
  {
    code: 'SSO',
    country: '호주',
    location: '사이딩 스프링, 뉴사우스웨일스',
    detail: '해발 1,165 m. 아시아-태평양 시간대를 커버하며 24시간 연속 감시망을 완성.',
    image: SSO_IMG as string | null,
    imageCredit: 'Wikimedia Commons',
  },
];

const KMT_FACTS = [
  { value: '1.6 m', label: '망원경 구경', sub: '3개 관측소 동일 사양' },
  { value: '~4 deg²', label: '시야각 (FOV)', sub: '넓은 벌지 영역 동시 포착' },
  { value: '10분', label: '관측 주기', sub: '벌지 필드당 반복 관측' },
  { value: '~2,000건', label: '연간 이벤트', sub: '은하 벌지 관측 시즌 기준' },
];

export function KmtnetIntroPage() {
  return (
    <div className="edu-page">
      <div className="edu-page-inner">

        {/* 헤더 */}
        <header className="edu-header">
          <Link to="/" className="back-link">&larr; 홈</Link>
          <span className="page-chip">KASI KMTNet · Gravitational Microlensing</span>
          <h1>중력이 빛을 휜다 — 미시중력렌즈 현상</h1>
          <p>
            무거운 천체(렌즈)가 배경별(광원) 앞을 지나갈 때, 중력이 빛을 굽혀
            배경별이 일시적으로 밝아지는 현상이 나타납니다.
            이 빛의 왜곡에서 보이지 않는 천체 — 심지어 행성까지 — 를 찾아낼 수 있습니다.
          </p>
        </header>

        {/* 페이지 배너 이미지 — 은하 중심부 */}
        <div className="edu-page-banner-wrap">
          <img
            src={KMT_BANNER}
            alt="우리 은하 파노라마 — 은하 벌지 영역"
            className="edu-page-banner-img"
            loading="lazy"
          />
          <span className="edu-page-banner-credit">Milky Way panorama · Galactic Bulge</span>
        </div>

        {/* 현상 설명: 다이어그램 + 텍스트 */}
        <section className="edu-explain">
          <div className="edu-diagram-wrap edu-diagram-wrap--pair">
            <div className="edu-diagram-pair">
              <MicrolensingDiagram />
              <div className="edu-diagram-pair-right">
                <p className="edu-diagram-caption edu-diagram-caption--inline">
                  광원·렌즈·관측자가 정렬될수록 아인슈타인 링이 형성되고 밝기가 최대가 됩니다.
                </p>
                <MagCurve />
                <p className="edu-diagram-caption edu-diagram-caption--inline">
                  정규 곡선(파란색) 위에 행성에 의한 이상신호(주황색)가 겹쳐 나타납니다.
                </p>
              </div>
            </div>
          </div>
          <div className="edu-explain-text">
            <h2>미시중력렌즈로 무엇을 알 수 있나?</h2>
            <p>
              렌즈 천체의 질량이 클수록, 정렬이 정확할수록 배경별이 더 밝게 증폭됩니다.
              이벤트의 지속 시간과 증폭 패턴으로 렌즈 천체의 질량과 거리를 추정합니다.
            </p>
            <ul className="edu-bullet-list">
              <li>
                <strong>증폭 인자</strong> — 렌즈-광원 각 간격과 아인슈타인 반경의 비로 결정
              </li>
              <li>
                <strong>이벤트 지속 시간</strong> — 렌즈 질량 · 거리 · 상대 속도에 의존
              </li>
              <li>
                <strong>행성 이상신호(anomaly)</strong> — 렌즈 천체 주변 행성이 만드는
                짧은 추가 증폭
              </li>
            </ul>
            <p>
              행성 이상신호는 수 시간~수일 지속되므로 KMTNet처럼
              여러 관측소가 연속으로 감시해야 포착할 수 있습니다.
            </p>
          </div>
        </section>

        {/* KMTNet 네트워크 */}
        <section className="edu-network-section">
          <h2 className="edu-section-title">KMTNet — 24시간 연속 감시망</h2>
          <p className="edu-section-desc">
            은하 벌지 이벤트는 낮 동안 관측이 중단되면 결정적인 순간을 놓칩니다.
            KMTNet은 경도 120° 간격의 3개 관측소로 24시간 연속 커버리지를 확보합니다.
          </p>
          <div className="edu-sites-grid">
            {KMT_SITES.map((site) => (
              <div key={site.code} className="edu-site-card">
                {/* 사진 영역: image가 null이면 플레이스홀더, 경로 채우면 바로 적용 */}
                <div className="edu-site-photo-wrap">
                  {site.image ? (
                    <img
                      src={site.image}
                      alt={`KMTNet ${site.code} 관측소`}
                      className="edu-site-photo"
                      loading="lazy"
                    />
                  ) : (
                    <div className="edu-site-photo-placeholder">
                      <span className="edu-site-placeholder-code">{site.code}</span>
                      <span className="edu-site-placeholder-hint">사진 추가 예정</span>
                    </div>
                  )}
                  <span className="edu-site-country-badge">{site.country}</span>
                  {site.imageCredit && (
                    <span className="edu-site-photo-credit">{site.imageCredit}</span>
                  )}
                </div>
                <div className="edu-site-info">
                  <strong className="edu-site-code">{site.code}</strong>
                  <span className="edu-site-location">{site.location}</span>
                  <p className="edu-site-detail">{site.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* KMTNet 주요 사양 */}
        <section className="edu-facts-section">
          <h2 className="edu-section-title">KMTNet 주요 사양</h2>
          <div className="edu-facts-grid">
            {KMT_FACTS.map((f) => (
              <div key={f.label} className="edu-fact-card">
                <span className="edu-fact-value">{f.value}</span>
                <strong className="edu-fact-label">{f.label}</strong>
                <span className="edu-fact-sub">{f.sub}</span>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="edu-cta-section">
          <div className="edu-cta-text">
            <h2>관측소를 선택하고 탐구를 시작하세요</h2>
            <p>
              CTIO, SAAO, SSO 중 관측소를 선택한 뒤,
              해당 관측소의 벌지 필드와 이벤트 목록으로 이동합니다.
            </p>
          </div>
          <div className="edu-cta-actions">
            <Link to="/kmtnet/sites" className="btn-primary">
              관측소 선택 →
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
