# -*- coding: utf-8 -*-
"""예비교사 서술형 판정지를 만든다 (2026-09-08).

부호화의 근거가 두 곳에 나뉘어 있고 서로 어긋난다.

  · 원고 부록 B — 원문 + 의미 단위 + 범주(초벌). 판정 열은 비어 있다.
  · `codebook_2026-09-08.py` — 의미 단위 + 범주 + 관점. 원문이 없다.
  · 표 4-18은 코드북에서 나오지만, 코드북의 의미 단위 일부가 부록 B에 없다.

이 스크립트는 셋을 판정 ID로 맞춰 **한 장의 판정지**로 만든다. 어긋나는 항목은
숨기지 않고 「대조」 줄에 무엇이 다른지 적는다. 연구자는 이 파일 하나만 보고
판정하면 되고, 그 결과를 다시 코드북·부록 B에 반영한다.

  python -X utf8 docs/survey/build_preservice_judgment_sheet.py
"""
import ast
import io
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MS = r'C:\Users\bmffr\Desktop\Me\ERP2026_Cosmos\EASWA_논문_v16.md'
CODEBOOK = os.path.join(HERE, 'codebook_2026-09-08.py')
OUT = os.path.join(HERE, '예비교사_판정지_2026-09-08.md')

QUESTION = {
    'Q6':  '문항 6 — 기존 서비스를 수업에 쓸 때 가장 큰 어려움과 그 이유',
    'Q20': '문항 20 — 어려웠던 단계와 그 이유 (본인이 수행한 경험)',
    'Q20-1': '문항 20-1 — 산출값과 기준값의 차이가 왜 생겼다고 보는가',
    'Q22': '문항 22 — 수업에 쓴다면 가장 걱정되는 점',
    'Q23': '문항 23 — 가장 잘 된 점과 보완이 시급한 점',
}
PERSPECTIVE = {
    '본인수행': '응답자 자신이 수행하며 겪은 것',
    '학생예상': '학생이 겪을 것이라는 예상',
    '수업운영': '수업을 운영하는 조건',
    '서비스예상': '기존 서비스에 대한 예상',
}


def load_codebook():
    """PRE 리스트를 문자열로 잘라 그대로 평가한다 — import 없이 값만 읽는다."""
    src = io.open(CODEBOOK, encoding='utf-8').read()
    m = re.search(r'^PRE = \[(.*?)^\]', src, re.S | re.M)
    rows = ast.literal_eval('[' + m.group(1) + ']')
    out = {}
    for r in rows:
        jid, resp, q, unit, cats, persp, quote = r
        out[jid] = {'resp': resp, 'q': q, 'unit': unit, 'cats': list(cats),
                    'persp': persp, 'quote': bool(quote)}
    return out


def load_appendix_b():
    """부록 B의 표에서 (판정ID, 원문, 의미 단위, 범주 초벌)을 뽑는다."""
    L = io.open(MS, encoding='utf-8').read().replace('\r\n', '\n').split('\n')
    i = next(n for n, x in enumerate(L) if x.startswith('# 부록 B'))
    j = next((n for n, x in enumerate(L) if x.startswith('# 부록 C')), len(L))
    out, order = {}, []
    for x in L[i:j]:
        if not x.startswith('|'):
            continue
        c = [t.strip() for t in x.strip('|').split('|')]
        if len(c) < 4 or not re.match(r'^Q[\d-]+/P\d+', c[0]):
            continue
        jid = c[0]
        out[jid] = {'raw': c[1], 'unit': c[2], 'cat': c[3]}
        order.append(jid)
    return out, order


def qkey(jid):
    return jid.split('/')[0]


def sortkey(jid):
    q, rest = jid.split('/')
    qn = q.replace('Q', '').split('-')
    base = int(qn[0]) * 10 + (int(qn[1]) if len(qn) > 1 else 0)
    m = re.match(r'P(\d+)\.(\d+)', rest)
    return (base, int(m.group(1)), int(m.group(2))) if m else (base, 99, 99)


cb = load_codebook()
ab, ab_order = load_appendix_b()
all_ids = sorted(set(cb) | set(ab), key=sortkey)

# 같은 것을 다르게 부른 짝. 이름만 다르면 판정이 아니라 표기 통일이다.
ALIAS = {
    '기존 서비스의 영어 장벽': '기존 서비스의 영어·용어 장벽',
    '교육과정·수업 시간·학생 수준': '기존 서비스의 수업 운영 조건',   # 문항 6 한정
}


def norm(cat, q):
    c = cat.strip()
    if q == 'Q6' and c in ALIAS:
        return ALIAS[c]
    return c


only_cb = [i for i in all_ids if i not in ab]
only_ab = [i for i in all_ids if i not in cb]
diff_unit, diff_alias, diff_count, diff_real = [], [], [], []
for i in all_ids:
    if not (i in cb and i in ab):
        continue
    q = qkey(i)
    if cb[i]['unit'].strip() != ab[i]['unit'].strip():
        diff_unit.append(i)
    # 「용어·기호·단위의 뜻」처럼 이름 안에도 ·가 있다. 범주 구분자는 공백을 낀 ' · '뿐이다.
    a_parts = [norm(x, q) for x in ab[i]['cat'].split(' · ') if x.strip()]
    c_parts = [norm(x, q) for x in cb[i]['cats']]
    if not a_parts or set(a_parts) == set(c_parts):
        continue
    if ab[i]['cat'].strip() != cb[i]['cats'][0] and set(a_parts) == set(c_parts):
        continue
    if set(c_parts) <= set(a_parts) or set(a_parts) <= set(c_parts):
        diff_count.append(i)          # 한쪽이 범주를 더 붙였다
    elif [x for x in a_parts] == [ALIAS.get(x, x) for x in c_parts]:
        diff_alias.append(i)          # 이름만 다르다
    else:
        diff_real.append(i)           # 실제로 다른 범주
diff_cat = diff_alias + diff_count + diff_real

lines = []
w = lines.append
w('# 예비교사 서술형 판정지 (2026-09-08)')
w('')
w('연구자가 하나씩 판정한다. **판정** 줄의 네모 하나에 표시하고, 범주를 바꿀 때는')
w('바꿀 범주 이름을 적는다. 다 채우면 이 파일을 그대로 두면 된다 —')
w('`codebook_2026-09-08.py`와 부록 B에 반영하는 것은 그다음 작업이다.')
w('')
w('- **AI 초벌**: 범주·의미 단위는 AI가 나눈 것이다. 확정은 여기서 이루어진다.')
w('- **관점**: 같은 어려움이라도 「본인이 겪은 것」과 「학생이 겪을 것이라는 예상」은 다르게 센다.')
w('- **대조**: 코드북과 원고 부록 B가 어긋나는 항목에만 붙는다. 어느 쪽이 맞는지도 판정한다.')
w('')
w('## 대조 요약 — 두 소스가 어긋나는 곳')
w('')
w('| 구분 | 건수 | 판정 ID |')
w('|---|---|---|')
w('| 코드북에만 있음 (부록 B에 없다) | %d | %s |' % (len(only_cb), ', '.join(only_cb) or '없음'))
w('| 부록 B에만 있음 (코드북에 없다) | %d | %s |' % (len(only_ab), ', '.join(only_ab) or '없음'))
w('| 의미 단위 문구가 다름 | %d | %s |' % (len(diff_unit), ', '.join(diff_unit) or '없음'))
w('| 범주 — 이름만 다름 (표기 통일) | %d | %s |' % (len(diff_alias), ', '.join(diff_alias) or '없음'))
w('| 범주 — 한쪽이 하나 더 붙임 | %d | %s |' % (len(diff_count), ', '.join(diff_count) or '없음'))
w('| 범주 — **실제로 다름** | %d | %s |' % (len(diff_real), ', '.join(diff_real) or '없음'))
w('')
w('전체 의미 단위 **%d개** (코드북 %d · 부록 B %d).' % (len(all_ids), len(cb), len(ab)))
w('')
need = sorted(set(only_cb) | set(only_ab) | set(diff_unit) | set(diff_count) | set(diff_real), key=sortkey)
w('**판정이 갈리는 것은 %d개**다. 나머지 %d개는 두 소스가 같으므로 훑고 넘어가면 된다.'
  % (len(need), len(all_ids) - len(need)))
w('')
w('---')
w('')

n = 0
cur_q = None
last_raw = {}
for jid in all_ids:
    q = qkey(jid)
    if q != cur_q:
        cur_q = q
        w('')
        w('## %s' % QUESTION.get(q, q))
        w('')
    n += 1
    c = cb.get(jid)
    a = ab.get(jid)
    raw = a['raw'] if a else '(원고 부록 B에 이 항목이 없다 — 원자료에서 확인 필요)'
    # 한 응답을 여러 의미 단위로 나눈 둘째 이후는 부록 B가 「〃」로 줄여 놓았다.
    # 판정하려면 원문이 눈앞에 있어야 하므로 앞 항목의 원문을 그대로 다시 싣는다.
    if raw.strip() in ('〃', '”', '"') or '같은 응답의 다음' in raw:
        raw = last_raw.get((jid.split('/')[1].split('.')[0], q), raw) + '  〔같은 응답을 나눈 것〕'
    else:
        last_raw[(jid.split('/')[1].split('.')[0], q)] = raw
    unit = (c or a)['unit']
    cats = c['cats'] if c else [a['cat']]
    persp = c['persp'] if c else '?'

    w('### %d / %d · `%s` · 응답자 %s' % (n, len(all_ids), jid, (c or {}).get('resp', jid.split('/')[1].split('.')[0])))
    w('')
    w('> %s' % raw.replace('<br>', ' / '))
    w('')
    w('- **의미 단위**: %s' % unit)
    w('- **초벌 범주**: %s' % ' · '.join(cats))
    w('- **관점**: %s — %s' % (persp, PERSPECTIVE.get(persp, '')))
    if jid in only_cb:
        w('- **대조**: 코드북에는 있고 **원고 부록 B에는 없다.** 부록에 넣을지 판정한다.')
    if jid in only_ab:
        w('- **대조**: 원고 부록 B에는 있고 **코드북에는 없다.** 표 4-18 집계에 빠져 있다.')
    if jid in diff_unit:
        w('- **대조**: 의미 단위 문구가 다르다 — 코드북 「%s」 / 부록 B 「%s」' % (c['unit'], a['unit']))
    if jid in diff_alias:
        w('- **대조**(표기): 같은 뜻을 다르게 불렀다 — 코드북 「%s」 / 부록 B 「%s」. 이름만 고르면 된다.'
          % (' · '.join(c['cats']), a['cat']))
    if jid in diff_count:
        w('- **대조**(개수): 한쪽이 범주를 더 붙였다 — 코드북 「%s」 / 부록 B 「%s」'
          % (' · '.join(c['cats']), a['cat']))
    if jid in diff_real:
        w('- **대조**(실질): **다른 범주로 보았다** — 코드북 「%s」 / 부록 B 「%s」'
          % (' · '.join(c['cats']), a['cat']))
    w('')
    w('**판정**  ☐ 그대로   ☐ 범주 바꿈 → ______   ☐ 의미 단위 수정 → ______   ☐ 제외(내용 없음·중복)')
    w('')
    w('메모:')
    w('')

io.open(OUT, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('판정지 %s' % OUT)
print('  의미 단위 %d개 · 코드북 %d · 부록 B %d' % (len(all_ids), len(cb), len(ab)))
print('  코드북에만 %d · 부록 B에만 %d · 의미단위 불일치 %d · 범주 불일치 %d'
      % (len(only_cb), len(only_ab), len(diff_unit), len(diff_cat)))
