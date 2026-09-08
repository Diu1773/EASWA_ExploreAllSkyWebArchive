# -*- coding: utf-8 -*-
"""WASP-121 b — 산출값과 문헌값의 차이를 변인 하나씩 통제하며 분해한다 (2026-09-08).

`wasp121_dilution.py`는 **관측을 다시 하지 않고** 카탈로그 등급과 가우시안 점퍼짐함수로
혼입을 «추정»했다. 그래서 「혼입 8~10%p」의 하한이 어디서 왔는지 문장으로 설명되지 않았다
(재심 지적). 이 스크립트는 그 대신 **같은 자료를 조건만 바꿔 실제로 다시 분석한다.**

  소유자 지시(2026-09-08): *「easwa의 구경측광 방식을 그대로 재현한 거랑, 똑같은 데이터로
  다른 어떤 방법으로 분석했을 문헌값을 정량적으로 분해하는 것 / 변인들 하나씩 통제하면서
  코드기록 잘남기고」*

## 다섯 조건 — 한 단계에서 바뀌는 변인은 하나뿐이다

| 조건 | 광도곡선 | 혼입 보정 | 주연감광 | 구간 | 앞 단계와의 차이 |
|---|---|---|---|---|---|
| A | EASWA 컷아웃 구경측광 | 없음 | Claret 표값 | 식 1회 | (기준선) |
| B | A를 CROWDSAP로 나눔 | **있음** | Claret 표값 | 식 1회 | 이웃별 혼입 |
| C | TESS-SPOC FFI PDCSAP | 있음 | Claret 표값 | 식 1회 | 측광·기준선 처리 |
| D | C | 있음 | **문헌 계수** | 식 1회 | 모델 가정 |
| E | D | 있음 | 문헌 계수 | **섹터 전체** | 자료량 |

**케이던스를 전 구간 600초로 고정한다.** SPOC의 2분 광도곡선을 쓰면 케이던스까지 함께
바뀌어 변인이 둘이 되므로, FFI에서 만든 TESS-SPOC HLSP(600초)만 쓴다.

## 재현의 한계 — 조건 A는 «재현»이 아니다

원고 표 4-5의 0.110이 어떤 비교성으로 나온 값인지 기록이 저장소에 없다. 익명 실행 로그에도
WASP-121 은 0건이다(참여자는 WASP-6 b 를 썼다). 그래서 A 는 아래 규칙으로 **새로 측정**한 값이며,
원고 값과 다르면 그 차이를 결과에 함께 적는다.

  · 비교성: 대상에서 12픽셀 안, 대상보다 어둡고 T등급 차 3.0 이내, 밝은 순 최대 5개
  · 구경 반지름 2.5픽셀 · 배경 고리 4.0~6.0픽셀 (플랫폼 기본값)
  · 컷아웃 50×50픽셀 (플랫폼 기본값)

실행:

    python -X utf8 docs/validation/wasp121_decomposition.py            # 전체
    python -X utf8 docs/validation/wasp121_decomposition.py --offline  # 받아 둔 자료로만
"""
from __future__ import annotations

import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.join(HERE, '_wasp121_cache')
sys.path.insert(0, os.path.join(ROOT, 'backend'))

# ── 대상과 문헌값 ───────────────────────────────────────────────
TARGET = 'WASP-121'
TIC = '22529346'
SECTOR = 33
PERIOD = 1.27492504          # Delrez et al. (2016)
T0_BTJD = None               # 자료에서 찾는다
RATROR_LIT = 0.12488         # Daylan et al. (2021), TESS
CADENCE_S = 600              # FFI

# 플랫폼 기본 측광 설정 (backend/services/transit_service.py 의 기본값)
APER_R, ANN_IN, ANN_OUT = 2.5, 4.0, 6.0
CUTOUT_PX = 50

# 비교성 선택 규칙 — 원고에 기록이 없어 여기서 정한다. 바꾸면 A·B 가 함께 바뀐다.
COMP_MAX_SEP_PX = 12.0
COMP_MAX_DMAG = 3.0
COMP_MAX_N = 5


def log(msg: str) -> None:
    print(msg, flush=True)


def ensure_cache() -> None:
    if not os.path.isdir(CACHE):
        os.makedirs(CACHE)


# ── 1. TESS-SPOC FFI 광도곡선 (조건 C~E) ───────────────────────
def fetch_spoc_ffi_lightcurve(offline: bool = False):
    """TESS-SPOC HLSP(600초 FFI)의 광도곡선과 헤더를 돌려준다.

    PDCSAP 는 SPOC 파이프라인이 오염 보정(CROWDSAP)과 체계적 오차 제거를 마친 값이고,
    SAP 는 보정 전 구경 합이다. 둘을 함께 받아 두면 조건 B 의 보정 계수도 같은 파일에서 나온다.
    """
    path = os.path.join(CACHE, 'tess_spoc_ffi_s%02d.fits' % SECTOR)
    if not os.path.exists(path):
        if offline:
            raise SystemExit('받아 둔 광도곡선이 없다. --offline 없이 한 번 실행한다.')
        from astroquery.mast import Observations
        log('· TESS-SPOC FFI 광도곡선을 찾는다 …')
        obs = Observations.query_criteria(
            objectname=TARGET, radius='0.001 deg', dataproduct_type='timeseries',
            sequence_number=SECTOR, provenance_name='TESS-SPOC')
        if not len(obs):
            raise SystemExit('TESS-SPOC HLSP를 찾지 못했다.')
        prod = Observations.get_product_list(obs)
        # download_products 는 obsid 열을 가진 «테이블»을 받는다. Row 를 골라 넘기면 안 된다.
        import numpy as np
        mask = np.array([str(f).endswith('_lc.fits') for f in prod['productFilename']])
        if not mask.any():
            mask = np.array([str(s).upper() == 'LC'
                             for s in prod['productSubGroupDescription']])
        if not mask.any():
            raise SystemExit('광도곡선(LC) 산출물이 목록에 없다: %s'
                             % sorted({str(f) for f in prod['productFilename']})[:6])
        got = Observations.download_products(prod[mask][:1], download_dir=CACHE)
        src = str(got['Local Path'][0])
        os.replace(src, path)
        log('  받았다: %s' % os.path.basename(path))

    from astropy.io import fits
    with fits.open(path) as hdul:
        hdr0, hdr1 = hdul[0].header, hdul[1].header
        d = hdul[1].data
        rows = {
            'time': list(map(float, d['TIME'])),
            'sap': list(map(float, d['SAP_FLUX'])),
            'sap_err': list(map(float, d['SAP_FLUX_ERR'])),
            'pdc': list(map(float, d['PDCSAP_FLUX'])),
            'pdc_err': list(map(float, d['PDCSAP_FLUX_ERR'])),
            'quality': list(map(int, d['QUALITY'])),
        }
        meta = {
            'crowdsap': float(hdr1.get('CROWDSAP', float('nan'))),
            'flfrcsap': float(hdr1.get('FLFRCSAP', float('nan'))),
            'exposure_s': float(hdr1.get('TIMEDEL', 0.0)) * 86400.0,
            'sector': int(hdr0.get('SECTOR', SECTOR)),
            'file': os.path.basename(path),
        }
    return rows, meta


def main() -> None:
    offline = '--offline' in sys.argv
    ensure_cache()
    log('WASP-121 b — 조건별 분해 (변인 하나씩)')
    log('=' * 74)

    rows, meta = fetch_spoc_ffi_lightcurve(offline)
    n_all = len(rows['time'])
    good = [i for i in range(n_all)
            if rows['quality'][i] == 0
            and rows['pdc'][i] == rows['pdc'][i]
            and rows['sap'][i] == rows['sap'][i]]
    log('')
    log('자료  %s' % meta['file'])
    log('  섹터 %d · 노출 %.0f초 · 전체 %d점 · 품질 통과 %d점'
        % (meta['sector'], meta['exposure_s'], n_all, len(good)))
    log('  CROWDSAP %.5f  (구경에 든 빛 중 대상의 몫)' % meta['crowdsap'])
    log('  FLFRCSAP %.5f  (대상 빛 중 구경에 든 몫)' % meta['flfrcsap'])
    log('')
    log('주. 이 파일 하나에서 조건 B 의 보정 계수와 조건 C~E 의 광도곡선이 모두 나온다.')
    log('    조건 A(EASWA 구경측광)는 같은 섹터의 TESScut 컷아웃에서 따로 만든다.')

    out = {'target': TARGET, 'tic': TIC, 'sector': SECTOR,
           'cadence_s': CADENCE_S, 'lit_ratror': RATROR_LIT,
           'source': meta, 'points_good': len(good)}
    io.open(os.path.join(CACHE, 'stage1_spoc.json'), 'w', encoding='utf-8').write(
        json.dumps(out, ensure_ascii=False, indent=1))
    log('')
    log('1단계 기록: %s' % os.path.join(CACHE, 'stage1_spoc.json'))


if __name__ == '__main__':
    main()
