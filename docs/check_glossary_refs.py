# -*- coding: utf-8 -*-
"""부록 C 용어표의 「처음 나오는 절」 열이 실제와 맞는지 본다.

v16 전환에서 3장의 절 번호가 바뀌었는데 부록 C를 함께 고치지 않아 서른 개가 넘는
참조가 한 절씩 밀렸다. 용어 하나하나를 사람이 대조하기 어려우므로 기계로 찾는다.

각 용어의 «본문 첫 등장»을 찾아 그 행이 속한 절 번호를 구하고, 표에 적힌 번호와 비교한다.
괄호 안 원어(예: 「식현상(transit)」)는 한글 부분으로도 찾는다.

  python -X utf8 docs/check_glossary_refs.py [원고경로]
"""
import io, re, sys

DEFAULT = r'C:\Users\bmffr\Desktop\Me\ERP2026_Cosmos\EASWA_논문_v16.md'
P = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
L = io.open(P, encoding='utf-8').read().replace('\r\n', '\n').split('\n')
APP = next((n for n, x in enumerate(L) if x.startswith('# 부록 A')), len(L))
BODY = next((n for n, x in enumerate(L) if x.startswith('# Ⅰ')), 0)   # 초록은 절이 없으므로 뺀다

# 행 번호 → 절 번호
sec_at, cur = {}, None
for n, x in enumerate(L):
    m = re.match(r'## (\d+\.\d+)\.', x)
    if m:
        cur = m.group(1)
    sec_at[n] = cur

def variants(term):
    """「식현상(transit)」 → ['식현상(transit)', '식현상', 'transit']"""
    out = [term]
    m = re.match(r'^(.+?)\s*[(（](.+?)[)）]$', term)
    if m:
        out += [m.group(1).strip(), m.group(2).strip()]
    for v in list(out):          # 「MCMC·emcee」·「BTJD·HJD」는 조각으로도 찾는다.
        # 한글이 섞인 표제어(「설계·개발 연구」)는 나누면 흔한 낱말이 되므로 두지 않는다.
        if '·' in v and not re.search(r'[가-힣]', v):
            out += [x.strip() for x in v.split('·')]
    return [v for v in out if len(v) >= 2]

rows, bad, miss = [], [], []
for n in range(APP, len(L)):
    if not L[n].startswith('|'):
        continue
    c = [x.strip() for x in L[n].strip('|').split('|')]
    if len(c) < 3 or set(''.join(c)) <= set('- '):
        continue
    term, ref = c[0], c[-1]
    if not re.fullmatch(r'\d+\.\d+', ref):
        continue
    first = None
    for v in variants(term):
        for k in range(BODY, APP):
            if L[k].startswith('#') or L[k].startswith('**표') or L[k].startswith('**그림'):
                continue
            if v in L[k]:
                if first is None or k < first[0]:
                    first = (k, v)
                break
    rows.append((n + 1, term, ref, first))
    if first is None:
        miss.append((n + 1, term, ref))
    elif sec_at[first[0]] != ref:
        bad.append((n + 1, term, ref, sec_at[first[0]], first[0] + 1, first[1]))

print('부록 C 참조 검사 — 용어 %d개 (본문 %d~%d행)' % (len(rows), BODY + 1, APP))
print()
print('[상] 표의 절 번호와 실제 첫 등장 절이 다르다 — %d건' % len(bad))
for ln, term, ref, real, fl, v in bad:
    print('   %4d행  %-22s  표 %-5s → 실제 %-5s  (%d행 「%s」)' % (ln, term[:22], ref, real or '없음', fl, v))
print()
print('[중] 본문에서 찾지 못한 용어 — %d건' % len(miss))
for ln, term, ref in miss:
    print('   %4d행  %-22s  표 %s' % (ln, term[:22], ref))
print()
print('주. 첫 등장은 표·그림 캡션과 제목 줄을 뺀 본문 기준이다. 표 안에서만 쓰이는 용어는')
print('    「찾지 못함」으로 나올 수 있으므로 그 경우는 사람이 본다.')
