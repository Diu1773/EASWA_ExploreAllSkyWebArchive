import { Link } from 'react-router-dom';
import { ImageWithFallback } from '../layout/ImageWithFallback';
import {
  ASTRO_FALLBACK_IMAGE,
  HOME_HERO_BG,
  KMT_MODULE_IMAGE,
  TESS_MODULE_IMAGE,
} from '../../data/imageSources';
import { buildExplorerHref } from '../../utils/explorerNavigation';

const TESS_EXPLORER = buildExplorerHref({
  moduleId: 'tess',
  topicId: 'exoplanet_transit',
  siteId: null,
});

const MODULES = [
  {
    id: 'tess',
    image: TESS_MODULE_IMAGE,
    imageAlt: 'TESS 우주망원경 아티스트 컨셉 이미지',
    imageCredit: 'NASA',
    chip: 'NASA TESS · Space Telescope',
    title: 'TESS Transit Lab',
    description:
      '우주에서 하늘 전체를 스캔하는 TESS 위성의 측광 자료로 외계행성 식현상을 직접 분석합니다. 대상 선택 → 광도곡선 → Transit Fit까지 한 흐름으로 진행됩니다.',
    tags: ['Exoplanet Transit', 'Light Curve', 'Sector Cutout'],
    href: '/tess',
    cta: 'TESS 탐구 시작',
  },
  {
    id: 'kmtnet',
    image: KMT_MODULE_IMAGE,
    imageAlt: 'KMTNet 소개 배너 이미지',
    imageCredit: 'KMTNet official website',
    chip: 'KASI KMTNet · Ground Network',
    title: 'KMTNet Microlensing Lab',
    description:
      '칠레 · 남아프리카 · 호주 3개 관측소를 연결한 KMTNet으로 은하 벌지의 미시중력렌즈 이벤트를 24시간 추적합니다. 관측소 맥락부터 이벤트 해석까지 탐구합니다.',
    tags: ['Microlensing', 'CTIO / SAAO / SSO', 'Galactic Bulge'],
    href: '/kmtnet',
    cta: 'KMTNet 탐구 보기',
  },
];

const FEATURES = [
  { icon: '🔭', label: '실제 천문 데이터', desc: 'NASA TESS · KASI KMTNet 관측 자료' },
  { icon: '📈', label: '웹 기반 분석', desc: '설치 없이 브라우저에서 바로 실행' },
  { icon: '🎓', label: '탐구 활동 중심', desc: '단계별 가이드와 해석 포인트 제공' },
];

export function HomePage() {
  return (
    <div className="home-page">

      {/* ── 히어로 배너 ─────────────────────────────── */}
      <section className="home-hero">
        <div className="home-hero-bg">
          <ImageWithFallback
            src={HOME_HERO_BG}
            fallbackSrc={ASTRO_FALLBACK_IMAGE}
            alt=""
            className="home-hero-bg-img"
            aria-hidden="true"
          />
          <div className="home-hero-bg-overlay" />
          <span className="home-hero-bg-credit">Image: ESA / Hubble — Ultra Deep Field</span>
        </div>

        <div className="home-hero-content">
          <div className="home-hero-copy">
            <div className="home-hero-brand">
              <svg
                className="home-hero-logo"
                viewBox="0 0 56 56"
                aria-hidden="true"
              >
                <defs>
                  <radialGradient id="easwa-logo-core" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#fef3c7" />
                    <stop offset="55%" stopColor="#fbbf24" />
                    <stop offset="100%" stopColor="#e8722a" stopOpacity="0.85" />
                  </radialGradient>
                </defs>
                {/* 외곽 고리: 전천 탐색 */}
                <circle cx="28" cy="28" r="25"
                  fill="none" stroke="#7dd3fc" strokeWidth="1.4"
                  strokeDasharray="2 3" opacity="0.85" />
                {/* 자오선 */}
                <ellipse cx="28" cy="28" rx="25" ry="9"
                  fill="none" stroke="#7dd3fc" strokeWidth="1" opacity="0.55" />
                <ellipse cx="28" cy="28" rx="9" ry="25"
                  fill="none" stroke="#7dd3fc" strokeWidth="1" opacity="0.55" />
                {/* 중앙 별 */}
                <circle cx="28" cy="28" r="9" fill="url(#easwa-logo-core)" />
                {/* 광도곡선 dip */}
                <path
                  d="M8,42 L21,42 C24,42 25,42 26,45 L28,49 L30,45 C31,42 32,42 35,42 L48,42"
                  fill="none" stroke="#e8722a" strokeWidth="1.8" strokeLinejoin="round"
                />
                {/* transiting planet */}
                <circle cx="38" cy="20" r="3" fill="#0f172a" stroke="#7dd3fc" strokeWidth="1.2" />
              </svg>
              <div className="home-hero-brand-text">
                <span className="home-hero-brand-name">EASWA</span>
                <span className="home-hero-brand-sub">Exploring All-Sky Web App</span>
              </div>
            </div>
            <span className="home-hero-kicker">천문 데이터 탐구 플랫폼</span>
            <h1 className="home-hero-title">
              실제 천문 데이터로<br />
              외계행성을 직접 분석하는<br />
              탐구 플랫폼
            </h1>
            <p className="home-hero-desc">
              코딩 없이 웹에서 바로 — NASA TESS 위성의 광도곡선으로 외계행성 식현상을 확인하고,
              KMTNet 관측소 네트워크로 미시중력렌즈 이벤트를 추적합니다.
              학생과 시민이 직접 데이터를 보고 해석하는 과학 탐구 경험을 제공합니다.
            </p>
            <div className="home-hero-actions">
              <Link to={TESS_EXPLORER} className="btn-primary">
                탐구 바로 시작 →
              </Link>
              <Link to="/tess" className="btn-secondary">
                TESS 소개 보기
              </Link>
            </div>
          </div>

          <ul className="home-feature-list">
            {FEATURES.map((f) => (
              <li key={f.label} className="home-feature-item">
                <span className="home-feature-icon">{f.icon}</span>
                <div>
                  <strong>{f.label}</strong>
                  <span>{f.desc}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── 탐구 모듈 카드 ──────────────────────────── */}
      <section className="home-modules">
        <p className="home-modules-label">탐구 모듈 선택</p>
        <div className="module-stack">
          {MODULES.map((mod) => (
            <article key={mod.id} className="module-row-card">
              <div className="module-row-image-wrap">
                <ImageWithFallback
                  src={mod.image}
                  fallbackSrc={ASTRO_FALLBACK_IMAGE}
                  alt={mod.imageAlt}
                  className="module-row-image"
                  loading="lazy"
                />
                <div className="module-row-image-overlay" />
                <span className="module-row-image-credit">{mod.imageCredit}</span>
              </div>
              <div className="module-row-body">
                <span className="module-row-chip">{mod.chip}</span>
                <h2 className="module-row-title">{mod.title}</h2>
                <p className="module-row-desc">{mod.description}</p>
                <ul className="module-row-tags">
                  {mod.tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
                <Link to={mod.href} className="btn-primary module-row-cta">
                  {mod.cta} →
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
