# -*- coding: utf-8 -*-
"""표·그림이 본문과 맞물리는지 본다.

2026-09-08 ARS 심사가 잡은 세 유형을 기계로 잡는다. 셋 다 기존 검사기를 통과했다 —
참조 대상이 «존재하기» 때문에 참조 무결성 검사로는 걸리지 않는다.

  ① 캡션은 있는데 본문이 부르지 않는 표·그림
     v16에서 그림 4-2~4-8 일곱 장이 아무 문장에도 걸려 있지 않았다.
  ② 본문이 부르는 표의 제목이 그 문장이 말하는 것과 다른 경우
     3.3이 「선정 기준은 표 3-4」라 했는데 표 3-4는 「조사 도구의 구성」이었다.
     기계는 판정하지 못하므로 «부르는 문장 + 표 제목»을 나란히 찍어 사람이 훑게 한다.
  ③ 같은 항목이 두 표에서 다른 값을 갖는 경우
     표 4-10의 「그래프 도움말 8명」이 표 4-17에서는 7명이었다.

  python -X utf8 docs/check_tables_figures.py           # 정본 원고
  python -X utf8 docs/check_tables_figures.py <경로>
"""
import io
import os
import re
import sys
from collections import defaultdict

DEFAULT = r'C:\Users\bmffr\Desktop\Me\ERP2026_Cosmos\EASWA_논문_v16.md'
P = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
L = io.open(P, encoding='utf-8').read().replace('\r\n', '\n').split('\n')
APP = next((n for n, x in enumerate(L) if x.startswith('# 부록')), len(L))

caps = {}          # 번호 → (행, 제목)
for n, x in enumerate(L[:APP]):
    m = re.match(r'\*\*(표|그림) (\d+-\d+)\.\s*(.+?)\*\*', x)
    if m:
        caps[(m.group(1), m.group(2))] = (n + 1, m.group(3).rstrip('.'))

calls = defaultdict(list)   # 번호 → [(행, 문장)]
for n, x in enumerate(L[:APP]):
    if x.startswith(('**표', '**그림', '|', '![', '#')):
        continue
    for kind, num in re.findall(r'(표|그림) (\d+-\d+)', x):
        calls[(kind, num)].append((n + 1, x))

print('표·그림 검사 — %s' % os.path.basename(P))
print('캡션 %d개 (표 %d · 그림 %d)'
      % (len(caps), sum(1 for k in caps if k[0] == '표'), sum(1 for k in caps if k[0] == '그림')))
print()

# ── ① 본문이 부르지 않는 캡션 ──────────────────────────────────
orphan = [(k, v) for k, v in caps.items() if not calls.get(k)]
print('[상] 본문이 부르지 않는 표·그림 — %d건' % len(orphan))
for (kind, num), (ln, title) in sorted(orphan, key=lambda x: (x[0][0], x[0][1])):
    print('   %s %-6s %4d행  %s' % (kind, num, ln, title[:60]))
if not orphan:
    print('   없음')
print()

# ── ② 캡션 없는 참조 ───────────────────────────────────────────
ghost = [(k, v) for k, v in calls.items() if k not in caps]
print('[상] 캡션이 없는 참조 — %d건' % len(ghost))
for (kind, num), hits in sorted(ghost.__iter__() if False else ghost, key=lambda x: x[0][1]):
    for ln, sent in hits[:2]:
        print('   %s %-6s %4d행  …%s…' % (kind, num, ln, sent.strip()[:66]))
if not ghost:
    print('   없음')
print()

# ── ③ 부르는 문장 ↔ 캡션 제목 (사람이 판정) ────────────────────
print('[검토] 부르는 문장과 캡션 제목을 나란히 — 주제가 어긋나면 사람이 잡는다')
for (kind, num), (ln, title) in sorted(caps.items(), key=lambda x: (x[0][0], x[0][1])):
    hits = calls.get((kind, num), [])
    if not hits:
        continue
    cl, cs = hits[0]
    i = cs.find('%s %s' % (kind, num))
    frag = cs[max(0, i - 52):i + 10].strip()
    print('   %s %-6s  부름 %4d행  …%s' % (kind, num, cl, frag))
    print('   %s          캡션 %4d행  %s' % (' ' * len(kind), ln, title[:66]))
print()

# ── ④ 표끼리 같은 항목의 값이 다른가 ───────────────────────────
def rows_of(num):
    ln = caps.get(('표', num), (None,))[0]
    if not ln:
        return []
    out, n = [], ln
    while n < len(L) and not L[n].startswith('|'):
        n += 1
    while n < len(L) and L[n].startswith('|'):
        cells = [c.strip() for c in L[n].strip('|').split('|')]
        if cells and not set(''.join(cells)) <= set('- '):
            out.append(cells)
        n += 1
    return out


def label_values(num):
    """표에서 (긴 라벨 → 첫 정수값) 짝을 뽑는다."""
    got = {}
    for cells in rows_of(num):
        label = next((c for c in cells if len(c) >= 12 and not re.fullmatch(r'[\d.,%\s·]+', c)), None)
        if not label:
            continue
        for c in cells:
            m = re.fullmatch(r'(\d+)', c)
            if m:
                got.setdefault(label, int(m.group(1)))
                break
    return got


tabs = sorted((k[1] for k in caps if k[0] == '표'),
              key=lambda s: (int(s.split('-')[0]), int(s.split('-')[1])))
vals = {t: label_values(t) for t in tabs}
clash = []
for i, a in enumerate(tabs):
    for b in tabs[i + 1:]:
        for lab, va in vals[a].items():
            vb = vals[b].get(lab)
            if vb is not None and vb != va:
                clash.append((lab, a, va, b, vb))
print('[상] 같은 항목이 두 표에서 다른 값 — %d건' % len(clash))
for lab, a, va, b, vb in clash[:20]:
    print('   「%s」' % lab[:52])
    print('      표 %-6s %s   ↔   표 %-6s %s' % (a, va, b, vb))
if not clash:
    print('   없음')
print()
print('주. ③은 판정이 아니라 대조표다. ④는 라벨이 완전히 같은 행만 본다 —')
print('    표현이 조금 달라 놓치는 것이 있으므로 이 검사를 통과해도 사람이 한 번 훑는다.')
