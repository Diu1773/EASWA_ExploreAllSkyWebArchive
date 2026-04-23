import { Link } from 'react-router-dom';
import { ImageWithFallback } from '../layout/ImageWithFallback';
import { ASTRO_FALLBACK_IMAGE, KMT_SITE_IMAGES } from '../../data/imageSources';
import { buildExplorerHref } from '../../utils/explorerNavigation';

const OBSERVATORIES = [
  {
    id: 'ctio',
    code: 'CTIO',
    country: '칠레',
    location: '세로 톨롤로, 칠레 북부 · 해발 2,207 m',
    description: '남미 구간 담당. 은하 벌지가 하늘 높이 뜨는 최적 위치.',
    image: KMT_SITE_IMAGES.ctio as string | null,
  },
  {
    id: 'saao',
    code: 'SAAO',
    country: '남아프리카',
    location: '서덜랜드, 남아프리카공화국 · 해발 1,760 m',
    description: 'CTIO와 SSO 사이의 관측 공백을 잇는 핵심 거점.',
    image: KMT_SITE_IMAGES.saao as string | null,
  },
  {
    id: 'sso',
    code: 'SSO',
    country: '호주',
    location: '사이딩 스프링, 뉴사우스웨일스 · 해발 1,165 m',
    description: '아시아-태평양 시간대를 커버하며 24시간 연속망을 완성.',
    image: KMT_SITE_IMAGES.sso as string | null,
  },
];

export function ObservatorySelectPage() {
  return (
    <div className="edu-page">
      <div className="edu-page-inner">

        <header className="edu-header">
          <Link to="/kmtnet" className="back-link">&larr; KMTNet 인트로</Link>
          <span className="page-chip">KMTNet · 관측소 선택</span>
          <h1>관측소를 선택하세요</h1>
          <p>
            세 관측소는 경도 약 120° 간격으로 배치되어 은하 벌지를 24시간 연속으로
            감시합니다. 탐구를 시작할 관측소를 고르세요.
          </p>
        </header>

        <div className="obs-select-grid">
          {OBSERVATORIES.map((site) => (
            <article key={site.id} className="obs-select-card">
              {/* 사진 영역 */}
              <div className="edu-site-photo-wrap">
                {site.image ? (
                  <ImageWithFallback
                    src={site.image}
                    fallbackSrc={ASTRO_FALLBACK_IMAGE}
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
              </div>

              {/* 정보 */}
              <div className="obs-select-body">
                <strong className="edu-site-code">{site.code}</strong>
                <span className="edu-site-location">{site.location}</span>
                <p className="edu-site-detail">{site.description}</p>
                <Link
                  to={buildExplorerHref({
                    moduleId: 'kmtnet',
                    topicId: null,
                    siteId: site.id,
                  })}
                  className="btn-primary obs-select-cta"
                >
                  {site.code}에서 탐구 시작 →
                </Link>
              </div>
            </article>
          ))}
        </div>

      </div>
    </div>
  );
}
