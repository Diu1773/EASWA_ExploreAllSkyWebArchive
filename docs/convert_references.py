# -*- coding: utf-8 -*-
"""참고문헌을 APA 에서 한국현장과학교육학회 형식으로 바꾼다 (2026-09-09).

규정 제10조의 예시는 이렇다.

    김창석, 문제인 (2006) 패러데이 법칙과 금속 탐지기. 새물리 23: 157-159.
    Smith PA, Spencer CD and Jones DE (1992) …

APA 와 다른 일곱 지점을 모두 바꾼다.

  ① 국문 저자 구분  가운뎃점 「공병민·공민규」 → 쉼표 「공병민, 공민규」
  ② 연도           「(2023).」 → 「(2023)」 — 뒤에 마침표 없음
  ③ 저널명          「『현장과학교육』」·이탤릭 → 맨 이름
  ④ 권·호·쪽        「17(3), 331–345」 → 「17: 331-335」 — **호 번호를 적지 않는다**
  ⑤ 강조            이탤릭·진하기 전부 제거
  ⑥ 영문 저자       「Smith, P. A., & Spencer, C. D.」 → 「Smith PA and Spencer CD」
  ⑦ 붙임표          en dash「–」 → 하이픈「-」

바꾸지 않는 것: 배열 순서(한글 가나다 → 영문 알파벳)는 이미 맞다. 단행본·보고서·웹
자료처럼 예시에 없는 유형은 최소 변환(②③⑤⑦)만 하고 목록으로 보고한다.

  python -X utf8 docs/convert_references.py <원고경로>
"""
import io
import re
import sys

P = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\bmffr\Desktop\Me\ERP2026_Cosmos\EASWA_논문_v17.md'
L = io.open(P, encoding='utf-8').read().replace('\r\n', '\n').split('\n')

i = next(n for n, x in enumerate(L) if x.startswith('# 참고문헌'))
j = next((n for n, x in enumerate(L) if n > i and x.startswith('# 부록')), len(L))


def eng_authors(seg):
    """「Smith, P. A., Spencer, C. D., & Jones, D. E.」 → 「Smith PA, Spencer CD and Jones DE」"""
    seg = seg.replace(' & ', ' and ')
    # et al. 은 그대로 둔다
    parts = re.split(r',\s*(?![A-Z]\.)', seg)
    out = []
    for p in parts:
        p = p.strip().rstrip(',')
        if not p:
            continue
        m = re.match(r'^(and\s+)?([A-Z][A-Za-z\'’\-]+),?\s*((?:[A-Z]\.\s*)+)$', p)
        if m:
            lead = m.group(1) or ''
            out.append('%s%s %s' % (lead, m.group(2), m.group(3).replace('.', '').replace(' ', '')))
        else:
            out.append(p)
    return ', '.join(out).replace(', and ', ' and ')


def convert(line):
    s = line[2:] if line.startswith('- ') else line
    note = None
    s = s.replace('*', '')                      # ⑤ 이탤릭·진하기
    s = s.replace('–', '-').replace('—', '-')   # ⑦ 붙임표
    s = s.replace('『', '').replace('』', '')     # ③ 낫표

    m = re.match(r'^(.+?)\s*\((\d{4}[a-z]?)\)\.\s*(.*)$', s)
    if not m:
        return '- ' + s, '연도 형식을 못 읽음'
    authors, year, rest = m.group(1), m.group(2), m.group(3)

    if re.search(r'[가-힣]', authors):
        authors = authors.replace('·', ', ')     # ① 국문 저자
    else:
        authors = eng_authors(authors)           # ⑥ 영문 저자

    # ④ 권(호), 쪽 → 권: 쪽
    rest2, n = re.subn(r',\s*(\d+)\((\d+[a-z]?)\),\s*([\dA-Za-z\-]+)\.?\s*$', r' \1: \3.', rest)
    if n == 0:
        rest2, n = re.subn(r',\s*(\d+),\s*([\dA-Za-z\-]+)\.?\s*$', r' \1: \2.', rest)
    if n == 0:
        note = '권·쪽 형식이 예시와 달라 손대지 않음'
        rest2 = rest
    rest2 = re.sub(r'\.\s*,\s*', '. ', rest2)
    return '- %s (%s) %s' % (authors, year, rest2.strip()), note


out, notes = [], []
for n in range(i, j):
    if not L[n].startswith('- '):
        continue
    new, note = convert(L[n])
    if note:
        notes.append((L[n][2:60], note))
    L[n] = new
    out.append(new)

io.open(P, 'w', encoding='utf-8', newline='\n').write('\n'.join(L))
print('참고문헌 %d건 변환 — %s' % (len(out), P))
print()
for x in out[:4]:
    print('  %s' % x[:110])
print('  …')
for x in out[-3:]:
    print('  %s' % x[:110])
print()
print('사람이 볼 것 %d건 (예시에 없는 유형)' % len(notes))
for src, why in notes:
    print('   %-58s %s' % (src, why))
