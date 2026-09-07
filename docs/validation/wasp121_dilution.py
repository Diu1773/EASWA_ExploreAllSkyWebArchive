# -*- coding: utf-8 -*-
"""WASP-121 b 산출값–문헌값 차이의 분해를 재현한다 (2026-09-08).

원고 4.4는 「측정 반지름비 0.110±0.002가 문헌값 0.12488보다 약 12% 작고, 그 차이가
이웃별 빛 혼입(약 9%)과 간략화한 분석 조건으로 설명된다」고 적는다. 이 계산을 재현하는
코드가 저장소에 없어 새로 만들었다 — 소유자 지적(2026-09-08):
*「tess자료로 문헌값재현해서 비교한거랑 웹 값 연구자 비교 이거 자세히 코드로 남아있나
오차분석 내용들까지? 없으면 다시 해봐야할듯」*

**첫 재현에서 원고 수치가 나오지 않았다.** 원고가 이름을 든 이웃별(TIC 22529333) 하나만
넣으면 혼입 광량비가 0.10에 그친다. TIC 카탈로그를 실제로 조회해 측광 구경에 드는 별을
모두 더하니 0.19가 되어 원고의 0.22에 가까워졌다. **원고 수치는 여러 별의 합이며, 한 별의
기여로 읽히도록 쓰여 있었다.**

이 스크립트는 관측을 다시 하지 않는다. 카탈로그 등급·좌표와 점퍼짐함수 모형만으로 구경에
섞이는 광량을 구한다. 측광과 적합 자체의 재현은 실제 컷아웃이 필요하며 그 경로는
`backend/services/transit_service.py`다.

  python -X utf8 docs/validation/wasp121_dilution.py
  python -X utf8 docs/validation/wasp121_dilution.py --offline   # 조회 없이 캐시 사용
"""
from __future__ import annotations

import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'wasp121_tic_cache.json')

# ── 입력값과 출처 ───────────────────────────────────────────────
TARGET = 'WASP-121'
SEARCH_RADIUS_DEG = 0.03          # 108″ — 구경 반지름 52.5″의 두 배
APERTURE_PX = 2.5                 # 플랫폼 기본 측광 구경 반지름 (원고 3.4)
PIXEL_SCALE = 21.0                # arcsec/pixel (Ricker et al. 2015)
PSF_FWHM_PX = 1.5                 # TESS Instrument Handbook, 위치에 따라 1~2
RATROR_LIT = 0.12488              # Daylan et al. 2021 (TESS 섹터 7)
RATROR_MEAS = 0.110               # 원고 표 4-5, 플랫폼 기본 조건
RATROR_MEAS_ERR = 0.002


def fetch_tic() -> list[dict]:
    """TIC를 조회해 캐시에 남긴다. 캐시가 있으면 그것을 쓴다."""
    if os.path.exists(CACHE):
        return json.load(io.open(CACHE, encoding='utf-8'))
    from astroquery.mast import Catalogs
    import numpy as np
    t = Catalogs.query_object(TARGET, radius=SEARCH_RADIUS_DEG, catalog='TIC')
    t.sort('dstArcSec')
    out = []
    for row in t:
        tm = row['Tmag']
        if np.ma.is_masked(tm):
            continue
        out.append({'id': str(row['ID']), 'tmag': float(tm),
                    'sep': float(row['dstArcSec'])})
    json.dump(out, io.open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return out


def enclosed(d_px: float, r_px: float, fwhm_px: float, n: int = 600) -> float:
    """구경 중심에서 d_px 떨어진 점원의 광량 중 반지름 r_px 안에 드는 비율."""
    s = fwhm_px / (2.0 * math.sqrt(2.0 * math.log(2.0)))
    if d_px < 1e-6:
        return 1.0 - math.exp(-(r_px ** 2) / (2.0 * s * s))
    tot, dr, dth = 0.0, r_px / n, 2.0 * math.pi / 240
    for i in range(n):
        rr = (i + 0.5) * dr
        for j in range(240):
            th = (j + 0.5) * dth
            dx = rr * math.cos(th) - d_px
            dy = rr * math.sin(th)
            tot += (math.exp(-(dx * dx + dy * dy) / (2 * s * s))
                    / (2 * math.pi * s * s) * rr * dr * dth)
    return tot


def contamination(stars: list[dict], fwhm: float, aper: float = APERTURE_PX):
    """혼입 광량비와 별별 기여를 돌려준다."""
    t0 = stars[0]['tmag']
    f_target = enclosed(0.0, aper, fwhm)
    parts = []
    for st in stars[1:]:
        if st['sep'] > aper * PIXEL_SCALE * 1.6:
            continue
        ratio = 10.0 ** (-0.4 * (st['tmag'] - t0))
        frac = enclosed(st['sep'] / PIXEL_SCALE, aper, fwhm)
        c = ratio * frac
        if c > 1e-4:
            parts.append((st['id'], st['tmag'], st['sep'], ratio, c))
    total = sum(p[4] for p in parts)
    return total / (f_target + total), f_target, total, parts


def main() -> None:
    stars = fetch_tic()
    tgt = stars[0]
    contam, f_target, num, parts = contamination(stars, PSF_FWHM_PX)
    dilution = 1.0 - contam
    expected = RATROR_LIT * math.sqrt(dilution)

    print('WASP-121 b — 이웃별 혼입에 의한 반지름비 축소 (재현 계산)')
    print('=' * 66)
    print('대상  TIC %s  T=%.3f' % (tgt['id'], tgt['tmag']))
    print('구경  반지름 %.1f 픽셀 = %.0f″ · 픽셀 스케일 %.0f″ · 점퍼짐함수 FWHM %.1f 픽셀'
          % (APERTURE_PX, APERTURE_PX * PIXEL_SCALE, PIXEL_SCALE, PSF_FWHM_PX))
    print()
    print('구경에 광량을 더하는 이웃별 (기여 큰 순)')
    print('  %-12s %7s %8s %9s %10s %7s' % ('TIC', 'Tmag', '거리(″)', '광량비', '구경내기여', '비중'))
    for pid, tm, sep, ratio, c in sorted(parts, key=lambda x: -x[4])[:8]:
        print('  %-12s %7.3f %8.2f %9.5f %10.5f %6.1f%%'
              % (pid, tm, sep, ratio, c, c / num * 100))
    if len(parts) > 8:
        rest = sum(p[4] for p in sorted(parts, key=lambda x: -x[4])[8:])
        print('  %-12s %7s %8s %9s %10.5f %6.1f%%'
              % ('나머지 %d개' % (len(parts) - 8), '', '', '', rest, rest / num * 100))
    print()
    print('  구경 내 대상 광량 비율   %.4f' % f_target)
    print('  이웃별 기여 합계         %.5f  (별 %d개)' % (num, len(parts)))
    print('  혼입 광량비              %.4f' % contam)
    print('  희석 계수                %.4f' % dilution)
    print()
    d_tot = (RATROR_MEAS - RATROR_LIT) / RATROR_LIT * 100
    d_dil = (expected - RATROR_LIT) / RATROR_LIT * 100
    print('문헌 반지름비             %.5f   Daylan et al. (2021)' % RATROR_LIT)
    print('혼입만 반영한 기대 관측값  %.5f   문헌 대비 %+.1f%%' % (expected, d_dil))
    print('플랫폼 측정값             %.3f ± %.3f   문헌 대비 %+.1f%%'
          % (RATROR_MEAS, RATROR_MEAS_ERR, d_tot))
    print('설명되지 않는 나머지                     %+.1f%%   (분석 조건·모델 처리)'
          % (d_tot - d_dil))
    print()
    print('점퍼짐함수 반치전폭에 대한 민감도 (TESS는 위치에 따라 1~2픽셀)')
    print('  %-7s %-10s %-12s %s' % ('FWHM', '혼입비', '기대 관측값', '혼입 기여'))
    for fw in (1.0, 1.2, 1.5, 1.8, 2.0):
        c, _, _, _ = contamination(stars, fw)
        e = RATROR_LIT * math.sqrt(1 - c)
        print('  %-7.1f %-10.4f %-12.5f %+.1f%%' % (fw, c, e, (e - RATROR_LIT) / RATROR_LIT * 100))
    print()
    print('측광 구경에 대한 민감도 (학습자가 바꿀 수 있는 값)')
    print('  %-9s %-10s %-12s %s' % ('구경(px)', '혼입비', '기대 관측값', '혼입 기여'))
    for ap in (2.0, 2.5, 3.0, 3.5):
        c, _, _, _ = contamination(stars, PSF_FWHM_PX, ap)
        e = RATROR_LIT * math.sqrt(1 - c)
        print('  %-9.1f %-10.4f %-12.5f %+.1f%%' % (ap, c, e, (e - RATROR_LIT) / RATROR_LIT * 100))
    print()
    print('주. 관측을 다시 하지 않는다. TIC 등급·좌표와 가우시안 점퍼짐함수로 구경에 드는')
    print('    광량을 구한 것이다. 측광·적합의 재현은 backend/services/transit_service.py.')
    print('    카탈로그 조회 결과는 %s에 캐시로 남는다.' % os.path.basename(CACHE))


if __name__ == '__main__':
    if '--offline' in sys.argv and not os.path.exists(CACHE):
        sys.exit('캐시가 없다. --offline 없이 한 번 실행해 캐시를 만든다.')
    main()
