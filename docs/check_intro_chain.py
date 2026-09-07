# -*- coding: utf-8 -*-
"""서론에서 개념이 근거 없이 처음 등장하는지 본다.

2026-09-08에 「웹」이 그랬다. 1.3이 「기존 서비스가 웹이다」라는 사실만 말하고
1.4가 「그러니 웹 환경을 만들자」로 건너뛰었다. 왜 웹이어야 하는지가 어디에도 없었다.
소유자가 읽다가 잡았다 — *「웹탐구가 나온다고 갑자기?? 왜 웹탐구가 필요한지 설명도 안 해놓고」*.

기계는 **어디서 처음 나오는지**만 낸다. 근거가 있는지는 사람이 그 줄을 읽고 판정한다.

  python -X utf8 docs/check_intro_chain.py
"""
import io, os, sys

P = os.environ.get('EASWA_PAPER',
                   r'C:\Users\bmffr\Desktop\Me\ERP2026_Cosmos\EASWA_논문_전체수정본_v15.md')

# 서론이 답으로 내놓는 것들. 처음 나오는 자리에 「왜 그것인가」가 붙어 있어야 한다.
CLAIMS = ['웹', '브라우저', '플랫폼', '자동', '단계', '교사', '예비교사', '학생']
# 3·4장의 산출물 이름. 서론에 나오면 결과 선취다(check_chapter_roles.py B-2가 상으로 잡는다).
PRODUCTS = ['공통 탐구 흐름', '공용 워크플로', '탐구모듈', '탐구블럭', 'EASWA']

L = io.open(P, encoding='utf-8').read().split('\n')
a = next(i for i, x in enumerate(L) if x.startswith('# Ⅰ. 서론'))
b = next(i for i, x in enumerate(L) if x.startswith('# Ⅱ.'))

sec = {}
cur = '1.0'
for n in range(a, b):
    if L[n].startswith('## '):
        cur = L[n][3:].split('.')[0] + '.' + L[n][3:].split('.')[1]
    sec[n] = cur


def first(w):
    for n in range(a, b):
        if w in L[n]:
            return n
    return None


print('서론 개념 사슬 — %s' % os.path.basename(P))
print('%d~%d행 · %d자' % (a + 1, b, len('\n'.join(L[a:b]))))
print()
print('[답으로 내놓는 것] 처음 나오는 줄을 읽고 «왜 그것인가»가 그 앞에 있는지 사람이 본다')
for w in CLAIMS:
    n = first(w)
    if n is None:
        print('  %-8s 서론에 없음' % w)
        continue
    j = L[n].find(w)
    print('  %-8s %s · %d행  …%s…' % (w, sec[n], n + 1, L[n][max(0, j - 40):j + 46]))

print()
print('[3·4장의 산출물 이름] 연구문제 앞 본문에 있으면 결과 선취')
rq = first('이를 위해 다음의 연구문제를 설정하였다') or b
for w in PRODUCTS:
    n = first(w)
    if n is None:
        print('  %-14s 없음' % w)
    elif n < rq:
        print('  %-14s **%s · %d행 — 연구문제보다 앞이다**' % (w, sec[n], n + 1))
    else:
        print('  %-14s %s · %d행 (연구문제 이후라 괜찮다)' % (w, sec[n], n + 1))
