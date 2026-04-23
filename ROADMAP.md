# EASWA — 개발 로드맵

진행 상태: ✅ 완료 · 🔧 진행 중 · 📋 예정 · 💡 아이디어

---

## 핵심 탐구 워크플로우 (Transit Lab)

### 데이터 파이프라인
- [x] TESS cutout 다운로드 (MAST TESScut API)
- [x] 메모리 캐시 (LRU, 200MB 한도)
- [x] 디스크 캐시 (로컬 전용, 1일 TTL)
- [x] Stall 감지 (30초 window, 50KB 미만 → RuntimeError)
- [x] 인메모리 ZIP 처리 (BytesIO, 디스크 I/O 없음)

### 분석 기능
- [x] Cutout 미리보기 (단일 프레임 JPEG)
- [x] Preview Job 비동기 처리 (polling)
- [x] 측광 (aperture photometry) — SSE 스트리밍
- [x] Transit 피팅 (trapezoid model) — SSE 스트리밍
- [x] 비교성 선택 + TIC 카탈로그 오버레이
- [x] 광도 곡선 플롯 (LightCurvePlot)
- [x] Transit fit 결과 표시 (period, depth, duration, Rp/Rs)
- [ ] **행성-별 크기 비교 시각화** (SVG 다이어그램, Rp/Rs 기반) 📋

### UX / 탐구 흐름
- [x] 6단계 워크플로우 (select → aperture → photometry → fit → result → record)
- [x] 단계별 탐구 질문 (OX · 객관식 · 서술형)
- [x] 정답 + 해설 피드백 표시
- [x] 탐구 질문 답변 → record payload 저장 (통계 수집)
- [x] 모바일 반응형 스타일 (≤600px)
- [x] Draft 자동저장 (Zustand + URL params + 백엔드)
- [x] Draft 상태 바 (초안 이름, 마지막 저장 시각)

---

## 기록 관리

- [x] 분석 기록 저장 (SQLite `analysis_records`)
- [x] 기록 목록 조회 (`/my`)
- [x] 기록 삭제
- [x] 기록 공유 링크 (share token, `/shared/:token`)
- [x] CSV 다운로드 (측광 재실행 후 광도곡선 export)
- [x] Draft 저장/불러오기/삭제 (`analysis_drafts`)
- [ ] **기록 편집** (저장 후 제목/메모 수정) 📋
- [ ] **기록 태그/분류** (탐구 주제별 필터링) 💡

---

## 인증 / 사용자 관리

- [x] Google OAuth 로그인
- [x] 세션 쿠키 (Starlette SessionMiddleware)
- [x] 비로그인 제출 허용 옵션 (`RECORD_REQUIRE_LOGIN`)
- [ ] **관리자 역할** (DB에 `is_admin` 컬럼 추가) 📋
- [ ] **사용자 목록/관리** (어드민 전용) 📋
- [ ] **계정 삭제** (GDPR 요건) 📋

---

## 관리자 / 운영

- [x] 탐구 질문 응답 통계 API (`GET /api/records/admin/guide-stats`)
- [x] 어드민 대시보드 UI (`/admin`)
- [ ] **어드민 엔드포인트 인증** (현재 누구나 접근 가능 — 보안 구멍) 🔧
- [ ] **어드민 URL 보호** (프론트엔드 `/admin` 라우트 접근 제한) 🔧
- [ ] **에러 트래킹** (Sentry 연동) 📋
- [ ] **구조화 로깅** (JSON 포맷, 요청/에러 추적) 📋
- [ ] **모니터링/알람** (Uptime, 응답 시간) 💡

---

## 데이터베이스 / 인프라

- [x] SQLite (단일 파일, WAL 모드)
- [x] 스키마 자동 초기화 + 컬럼 추가 (수동 `ALTER TABLE` 체크)
- [x] Persistent disk 환경변수 지원 (`EASWA_DB_PATH`, `EASWA_EXPORT_DIR`)
- [ ] **마이그레이션 시스템** (Alembic 도입, 현재 수동 ALTER 방식) 💡 (천문대 서버 이전 시점에 검토)
- [ ] **PostgreSQL 이전** (동시 쓰기, 수평 확장 필요 시) 💡 (대규모 운영 시점에 검토)
- [ ] **DB 백업 자동화** 💡 (천문대 서버 이전 시점에 검토)
- [ ] ~~**Render persistent disk 설정**~~ — 현재 무료 플랜(프로토타입 데모) 수준이므로 불필요. 천문대 서버 이전 시 자동 해결.

---

## 보안

- [x] SQL 파라미터화 쿼리 (인젝션 방지)
- [x] Rate limiting (기록 제출)
- [x] Context payload 크기 제한
- [x] CORS 설정 옵션
- [ ] **어드민 API 인증** (위 참조) 🔧
- [ ] **CSP 헤더** (Content Security Policy) 📋
- [ ] **개인정보처리방침 / 이용약관** 페이지 📋

---

## 워크플로우 확장 (장기)

- [x] **Transit Lab** (외계행성 식현상) ✅ 완성
- [ ] **Variable Star Lab** (변광성 주기 분석) 💡
- [ ] **Eclipsing Binary Lab** (식쌍성) 💡
- [ ] **Cluster CMD Lab** (성단 HR도) 💡
- [ ] **시민과학 집단 분석** (Planet Hunters 방식, 다수 사용자 동일 대상 분석) 💡

---

## 개발 환경 / 코드 품질

- [x] TypeScript 엄격 모드
- [x] ESLint
- [x] pytest 백엔드 테스트
- [x] Docker + render.yaml 배포 설정
- [ ] **프론트엔드 테스트** (Vitest + React Testing Library) 📋
- [ ] **CI/CD** (GitHub Actions — lint, test, build) 📋
- [ ] **번들 코드 스플리팅** (현재 단일 7MB 번들) 📋

---

## 최근 완료 이력

| 날짜 | 내용 |
|------|------|
| 2026-04 | 탐구 질문 답변 통계 어드민 대시보드 |
| 2026-04 | 단계별 탐구 질문 (OX/객관식/서술형 + 정답 피드백) |
| 2026-04 | 탐구 답변 → record payload 연동 |
| 2026-04 | TIC 토글 버튼 사이드바 이동 |
| 2026-04 | Draft 상태 바, Load→Reload 버튼, 텍스트 가독성 개선 |
| 2026-04 | 기록 공유 링크 + CSV 다운로드 |
| 2026-04 | 모바일 반응형 스타일 |
| 2026-04 | SQLite ALTER TABLE UNIQUE 인덱스 분리 |
