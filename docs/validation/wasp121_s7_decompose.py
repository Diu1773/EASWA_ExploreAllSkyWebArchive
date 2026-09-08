# -*- coding: utf-8 -*-
"""WASP-121 b — 문헌과 같은 자료에서 방법 차이만 분해한다 (2026-09-08).

자료를 Daylan et al.(2021)에 맞췄다: **TESS 섹터 7, 2분 케이던스.** 섹터·케이던스·대상이
모두 같으므로 조건 사이에 남는 차이는 «분석 방법»뿐이다.

  · A — 같은 픽셀 큐브에 **EASWA의 구경측광**을 적용한다(원형 반지름 2.5픽셀,
        배경 고리 4.0~6.0픽셀의 중앙값을 픽셀 수만큼 빼는 방식).
        측광 마스크는 `backend/services/transit_service.py`의 함수를 그대로 불러 쓴다.
  · B — A를 CROWDSAP으로 나눈다. **이웃별 혼입만** 바뀐다.
  · C — SPOC의 SAP. **구경 정의만** 바뀐다(원형 2.5픽셀 ↔ SPOC 최적 마스크).
  · D — SPOC의 PDCSAP. **체계적 오차 제거와 혼입 보정**이 더해진다.
  · 문헌 — Daylan et al.(2021)의 0.12488. 남는 차이는 적합 설정과 모델 가정이다.

적합은 네 조건 모두 `transit_fit_service.fit_transit_model`로 수행한다. 적합기를 고정해야
측광 방법의 차이만 남는다.

  python -X utf8 docs/validation/wasp121_s7_decompose.py
"""
from __future__ import annotations

import io
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.join(HERE, '_wasp121_cache')
sys.path.insert(0, os.path.join(ROOT, 'backend'))

# ── 대상 · 자료 · 문헌값 ────────────────────────────────────────
TARGET = 'WASP-121 b'
SECTOR = 7
PERIOD = 1.2749255          # 일. Delrez et al. (2016)
T0_BJD = 2456635.70832      # Delrez et al. (2016). BTJD = BJD - 2457000
T0_BTJD = T0_BJD - 2457000.0
RATROR_LIT = 0.12488        # Daylan et al. (2021), TESS 섹터 7

# 플랫폼 기본 측광 설정 (backend/services/transit_service.py)
APER_R, ANN_IN, ANN_OUT = 2.5, 4.0, 6.0


def load_tpf():
    from astropy.io import fits
    path = os.path.join(CACHE, 's%02d_tp.fits' % SECTOR)
    if not os.path.exists(path):
        raise SystemExit('픽셀 큐브가 없다. wasp121_s7_fetch.py 를 먼저 실행한다.')
    with fits.open(path) as h:
        d = h[1].data
        cube = np.array(d['FLUX'], dtype=np.float64)
        time = np.array(d['TIME'], dtype=np.float64)
        qual = np.array(d['QUALITY'], dtype=np.int64)
        aper = np.array(h[2].data, dtype=np.int64)
        h1 = h[1].header
        # 큐브 안에서 대상이 놓인 화소 위치. 1BASED 기준값을 0BASED 로 옮긴다.
        col0, row0 = int(h1['1CRV4P']), int(h1['2CRV4P'])
        exptime = float(h1.get('TIMEDEL', 0.0)) * 86400.0
    return cube, time, qual, aper, (col0, row0), exptime


def load_lc():
    from astropy.io import fits
    path = os.path.join(CACHE, 's%02d_lc.fits' % SECTOR)
    if not os.path.exists(path):
        return None, None
    with fits.open(path) as h:
        d = h[1].data
        out = {
            'time': np.array(d['TIME'], dtype=np.float64),
            'sap': np.array(d['SAP_FLUX'], dtype=np.float64),
            'sap_err': np.array(d['SAP_FLUX_ERR'], dtype=np.float64),
            'pdc': np.array(d['PDCSAP_FLUX'], dtype=np.float64),
            'pdc_err': np.array(d['PDCSAP_FLUX_ERR'], dtype=np.float64),
            'quality': np.array(d['QUALITY'], dtype=np.int64),
        }
        h1 = h[1].header
        meta = {'crowdsap': float(h1.get('CROWDSAP', float('nan'))),
                'flfrcsap': float(h1.get('FLFRCSAP', float('nan')))}
    return out, meta


def easwa_photometry(cube, aper_mask):
    """EASWA 의 구경측광을 그대로 적용한다.

    마스크 계산은 플랫폼 함수를 불러 쓴다. 중심은 SPOC 최적 구경의 광량 가중 중심으로
    잡는다 — 학습자가 화면에서 대상을 찍는 자리에 해당한다.
    """
    from services.transit_service import _circular_mask, _annulus_mask
    _, ny, nx = cube.shape
    ref = np.nanmedian(cube[: min(200, cube.shape[0])], axis=0)
    opt = (aper_mask & 2).astype(bool)
    if not opt.any():
        opt = np.isfinite(ref)
    yy, xx = np.indices((ny, nx), dtype=float)
    wsum = np.nansum(np.where(opt, ref, 0.0))
    cx = float(np.nansum(np.where(opt, ref, 0.0) * (xx + 0.5)) / wsum)
    cy = float(np.nansum(np.where(opt, ref, 0.0) * (yy + 0.5)) / wsum)

    circ = _circular_mask(nx, ny, cx, cy, APER_R)
    ring = _annulus_mask(nx, ny, cx, cy, ANN_IN, ANN_OUT)
    n_pix = max(int(circ.sum()), 1)
    if not ring.any():
        raise SystemExit('배경 고리가 큐브 밖이다 — 큐브 %dx%d 로는 %g~%g 픽셀 고리를 못 만든다.'
                         % (ny, nx, ANN_IN, ANN_OUT))
    raw = np.nansum(cube[:, circ], axis=1)
    sky = np.nanmedian(cube[:, ring], axis=1)
    net = raw - sky * n_pix
    return net, (cx, cy, n_pix, int(ring.sum()))


def fit(flux, err, time, label, **fit_kw):
    """광도곡선을 플랫폼 적합기에 넣는다. fit_kw 로 적합 설정을 바꿀 수 있다."""
    from schemas.lightcurve import LightCurvePoint
    from services.transit_fit_service import fit_transit_model
    good = np.isfinite(flux) & np.isfinite(time) & (flux > 0)
    f = flux[good] / np.nanmedian(flux[good])
    t = time[good]
    e = (err[good] / np.nanmedian(flux[good])) if err is not None else np.full(f.size, np.nanstd(f))
    # 적합기는 LightCurvePoint.magnitude 를 «변환 없이» flux 로 읽는다
    # (transit_fit_service._prepare_fit_series). 필드 이름만 magnitude 이고,
    # 등급으로 바꿔 넣으면 식이 뒤집혀 해가 경계로 달아난다.
    pts = [LightCurvePoint(hjd=float(t[i]) + 2457000.0, phase=None,
                           magnitude=float(f[i]),
                           mag_error=float(e[i]) if np.isfinite(e[i]) and e[i] > 0 else 1e-4)
           for i in range(f.size)]
    res = fit_transit_model(pts, period=PERIOD, t0=T0_BJD, target_id=TARGET,
                            fit_mode='phase_fold', **fit_kw)
    f = res.fitted_params
    return f.rp_rs, f.rp_rs_err, f.reduced_chi_squared, len(pts)


def main() -> None:
    print('%s — 섹터 %d · 2분 케이던스 (Daylan et al. 2021과 같은 자료)' % (TARGET, SECTOR))
    print('=' * 78)
    cube, time, qual, aper, origin, exptime = load_tpf()
    lc, meta = load_lc()
    ny, nx = cube.shape[1], cube.shape[2]
    print('픽셀 큐브 %d프레임 × %d×%d · 노출 %.0f초' % (cube.shape[0], ny, nx, exptime))
    if meta:
        print('CROWDSAP %.5f · FLFRCSAP %.5f' % (meta['crowdsap'], meta['flfrcsap']))
    print()

    ok = (qual == 0)
    net, (cx, cy, npix, nring) = easwa_photometry(cube[ok], aper)
    t_ok = time[ok]
    print('조건 A · EASWA 구경측광 — 중심 (%.2f, %.2f) · 구경 %d픽셀 · 배경 고리 %d픽셀'
          % (cx, cy, npix, nring))

    rows = []
    v, e, x2, n = fit(net, None, t_ok, 'A')
    rows.append(('A', 'EASWA 구경측광 (원형 2.5px, 배경 고리 4~6px)', v, e, x2, n))

    if meta and meta['crowdsap'] == meta['crowdsap']:
        # 혼입 보정: 구경에 든 남의 빛을 빼고 대상 몫만 남긴다.
        med = np.nanmedian(net)
        corrected = (net - med * (1.0 - meta['crowdsap'])) / meta['crowdsap']
        v, e, x2, n = fit(corrected, None, t_ok, 'B')
        rows.append(('B', 'A + CROWDSAP 혼입 보정', v, e, x2, n))

    if lc is not None:
        g = lc['quality'] == 0
        v, e, x2, n = fit(lc['sap'][g], lc['sap_err'][g], lc['time'][g], 'C')
        rows.append(('C', 'SPOC SAP (최적 구경 마스크)', v, e, x2, n))
        v, e, x2, n = fit(lc['pdc'][g], lc['pdc_err'][g], lc['time'][g], 'D')
        rows.append(('D', 'SPOC PDCSAP (체계오차 제거 + 혼입 보정)', v, e, x2, n))
        # 문헌은 주연감광을 «적합»했다 (Daylan et al. 2021: q1=0.115, q2=0.42 →
        # u1=0.285±0.058, u2=0.06±0.11). EASWA 기본값은 Claret 표값 고정이다.
        v, e, x2, n = fit(lc['pdc'][g], lc['pdc_err'][g], lc['time'][g], 'E',
                          fit_limb_darkening=True)
        rows.append(('E', 'D + 주연감광을 적합 (문헌 방식)', v, e, x2, n))
        # 문헌 기준선은 궤도별 3차 스플라인이지만 **이 적합기로는 재현할 수 없다.**
        # transit_fit_service._prepare_fit_series 554행이
        #   baseline_order = 1 if int(baseline_order) > 0 else 0
        # 으로 잘라 0차 또는 1차만 지원한다. 3을 넘겨도 1로 처리되므로 조건을 두지 않는다.
        # 기준선 차수의 몫은 «측정하지 못한 것»으로 남긴다.

    print()
    print('%-3s %-42s %-18s %-10s %-9s %s' % ('', '처리', 'Rp/R*', '문헌 대비', 'chi2_red', '점수'))
    for key, desc, v, e, x2, n in rows:
        d = (v - RATROR_LIT) / RATROR_LIT * 100
        print('%-3s %-42s %.5f±%.5f %+6.1f%%    %-9.2f %d점'
              % (key, desc, v, e or 0, d, x2, n))
    print('%-3s %-42s %.5f %20s' % ('문헌', 'Daylan et al. (2021)', RATROR_LIT, '기준'))

    # 네 조건은 «구경 정의»와 «혼입·체계오차 보정» 두 축의 조합이다. 순서대로 뺄셈하면
    # 두 축이 섞이므로, 한 축만 다른 짝끼리 비교한다.
    val = {k: v for k, _, v, _, _, _ in rows}
    print()
    print('한 축만 다른 짝 비교 — 이것이 «방법 하나의 몫»이다')
    print('  %-46s %s' % ('무엇이 달라지나', '차이'))
    pairs = [
        ('A', 'C', '구경 정의 (원형 2.5px → SPOC 최적 마스크). 둘 다 혼입 미보정'),
        ('A', 'B', '이웃별 혼입 보정 (CROWDSAP). 둘 다 EASWA 구경'),
        ('C', 'D', 'SPOC의 혼입 보정 + 체계오차 제거. 둘 다 SPOC 구경'),
        ('D', 'E', '주연감광: Claret 표값 고정 → 적합 (문헌 방식)'),
    ]
    for a, b, why in pairs:
        if a in val and b in val:
            print('  %-46s %+.1f%%p' % (why, (val[b] - val[a]) / RATROR_LIT * 100))
    last = 'E' if 'E' in val else 'D'
    if last in val:
        print('  %-46s %+.1f%%p' % ('남는 몫 — 아래 셋이 섞여 있고 분리하지 못했다',
                                    (RATROR_LIT - val[last]) / RATROR_LIT * 100))
        print('     · 기준선 차수 — 이 적합기는 0차·1차만 지원한다(문헌은 궤도별 3차 스플라인)')
        print('     · 희석 처리 — SPOC은 CROWDSAP 0.91131(혼입 8.87%)로 나누고,')
        print('       문헌은 희석을 파라미터로 적합해 0.0765±0.0082를 얻었다')
        print('     · 적합기 — 최소제곱+야코비안 대 allesfitter+emcee')
        print()
        print('문헌 Rp/R* 0.12488 ± 0.00072 (Daylan et al. 2021 · allesfitter + emcee ·')
        print('  섹터 7 2분 케이던스 · 주연감광 적합 · SAP에 궤도별 3차 스플라인 ·')
        print('  희석을 파라미터로 두어 0.0765 ± 0.0082 얻음)')

    out = {'target': TARGET, 'sector': SECTOR, 'exptime_s': exptime,
           'period_d': PERIOD, 't0_bjd': T0_BJD, 'lit_ratror': RATROR_LIT,
           'aperture': {'radius_px': APER_R, 'annulus_px': [ANN_IN, ANN_OUT],
                        'centre_px': [cx, cy], 'n_pixels': npix},
           'crowdsap': meta['crowdsap'] if meta else None,
           'rows': [{'key': k, 'desc': d, 'rp_rs': v, 'rp_rs_err': e,
                     'reduced_chi_squared': x2, 'points': n,
                     'vs_literature_pct': (v - RATROR_LIT) / RATROR_LIT * 100}
                    for k, d, v, e, x2, n in rows]}
    p = os.path.join(CACHE, 's%02d_decompose.json' % SECTOR)
    io.open(p, 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1))
    print()
    print('기록: %s' % p)
    print()
    print('주. 네 조건 모두 같은 적합기(transit_fit_service.fit_transit_model)와 같은 궤도요소를')
    print('    쓴다. 따라서 조건 사이의 차이는 측광 방법의 차이이고, 마지막 문헌값과의 차이가')
    print('    적합 설정과 모델 가정의 몫이다.')


if __name__ == '__main__':
    main()
