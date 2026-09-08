# -*- coding: utf-8 -*-
"""WASP-121 b 섹터 7 자료를 받는다 — 문헌과 «같은 자료»를 쓰기 위해서다 (2026-09-08).

Daylan et al.(2021)은 TESS **섹터 7**의 2분 케이던스 자료를 썼다(2019-01-08 ~ 02-01,
24.5일, 식 18회). 원고는 섹터 33의 10분 FFI로 얻은 값을 그 문헌값과 비교하면서 차이를
«방법 차이»로 분해했는데, 자료가 다르면 그 분해가 성립하지 않는다 — 섹터가 다르면
오염원의 위치도, 검출기 조건도 다르다.

  소유자 지적(2026-09-08): *「섹터맞춰서 가져오면 되잖아 (…) 데이터는 맞춰야될거아니야
  그래야 방법적인 차이를 분석할거아니냐」*

그래서 자료를 문헌에 맞춘다. 같은 섹터·같은 케이던스를 쓰면 남는 것은 방법 차이뿐이다.

받는 것 둘:
  · **TPF**(target pixel file) — 픽셀 큐브. 여기에 EASWA의 구경측광을 그대로 적용한다(조건 A).
  · **LC**(light curve) — SPOC 파이프라인의 SAP/PDCSAP와 CROWDSAP 헤더(조건 B·C).

  python -X utf8 docs/validation/wasp121_s7_fetch.py
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '_wasp121_cache')

TARGET = 'WASP-121'
SECTOR = 7                    # Daylan et al. (2021)이 쓴 섹터
WANT_EXPTIME = 120.0          # 2분 케이던스 — 문헌과 같다


def main() -> None:
    os.makedirs(CACHE, exist_ok=True)
    from astroquery.mast import Observations
    import numpy as np

    print('WASP-121 b · 섹터 %d · %.0f초 케이던스 자료를 받는다' % (SECTOR, WANT_EXPTIME))
    print('=' * 66)
    obs = Observations.query_criteria(
        objectname=TARGET, radius='0.001 deg', dataproduct_type='timeseries',
        sequence_number=SECTOR, provenance_name='SPOC')
    obs = obs[np.array([float(x) == WANT_EXPTIME for x in obs['t_exptime']])]
    if not len(obs):
        raise SystemExit('섹터 %d의 %.0f초 SPOC 관측을 찾지 못했다.' % (SECTOR, WANT_EXPTIME))
    print('· 관측 %s' % obs['obs_id'][0])

    prod = Observations.get_product_list(obs)
    names = [str(f) for f in prod['productFilename']]
    print('· 산출물 %d개' % len(names))

    got = {}
    for kind, suffix in (('tp', '_tp.fits'), ('lc', '_lc.fits')):
        mask = np.array([n.endswith(suffix) for n in names])
        if not mask.any():
            print('  ! %s 없음' % kind)
            continue
        dest = os.path.join(CACHE, 's%02d_%s.fits' % (SECTOR, kind))
        if os.path.exists(dest):
            print('  %s 이미 있음: %s' % (kind, os.path.basename(dest)))
            got[kind] = dest
            continue
        res = Observations.download_products(prod[mask][:1], download_dir=CACHE)
        os.replace(str(res['Local Path'][0]), dest)
        print('  %s 받음: %s (%.1f MB)' % (kind, os.path.basename(dest),
                                          os.path.getsize(dest) / 1048576))
        got[kind] = dest

    from astropy.io import fits
    info = {'target': TARGET, 'sector': SECTOR, 'exptime_s': WANT_EXPTIME}
    if 'lc' in got:
        with fits.open(got['lc']) as h:
            h1 = h[1].header
            info['crowdsap'] = float(h1.get('CROWDSAP', float('nan')))
            info['flfrcsap'] = float(h1.get('FLFRCSAP', float('nan')))
            info['lc_points'] = int(h[1].header.get('NAXIS2', 0))
        print()
        print('광도곡선  CROWDSAP %.5f · FLFRCSAP %.5f · %d점'
              % (info['crowdsap'], info['flfrcsap'], info['lc_points']))
    if 'tp' in got:
        with fits.open(got['tp']) as h:
            d = h[1].data
            shape = d['FLUX'].shape
            info['tp_frames'], info['tp_ny'], info['tp_nx'] = [int(x) for x in shape]
        print('픽셀 큐브  %d프레임 × %d×%d픽셀' % (info['tp_frames'], info['tp_ny'], info['tp_nx']))
        print()
        print('주. 구경 반지름 2.5픽셀에 배경 고리 4.0~6.0픽셀을 쓰려면 한 변이 최소 13픽셀이어야')
        print('    한다. 비교성까지 담으려면 더 넓어야 하므로, 큐브가 좁으면 조건 A의 차등측광은')
        print('    같은 섹터의 FFI 컷아웃으로 따로 만들어야 한다 — 그 경우 케이던스가 달라지므로')
        print('    무엇이 달라졌는지 결과에 함께 적는다.')

    with open(os.path.join(CACHE, 's%02d_info.json' % SECTOR), 'w', encoding='utf-8') as f:
        json.dump(info, f, ensure_ascii=False, indent=1)
    print()
    print('기록: %s' % os.path.join(CACHE, 's%02d_info.json' % SECTOR))


if __name__ == '__main__':
    main()
