# -*- coding: utf-8 -*-
"""장별 역할 검사 — 각 장이 다루면 안 되는 것이 들어갔는지 기계로 잡는다.

규칙은 docs/논문_고정문서.md 10절. 이 스크립트는 그중 기계 판정이 되는 것만 본다.
사람이 판정해야 하는 것(논지 중복·해석의 적절성)은 여기서 잡지 않는다.

  python -X utf8 docs/check_chapter_roles.py            # 정본 원고
  python -X utf8 docs/check_chapter_roles.py <경로>     # 다른 파일
"""
import io, re, sys, collections

DEFAULT = r"C:\Users\bmffr\Desktop\Me\ERP2026_Cosmos\EASWA_논문_전체수정본_v15.md"
P = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
s = io.open(P, encoding="utf-8").read().replace("\r\n", "\n")
L = s.split("\n")

def idx(prefix):
    return next(n for n, l in enumerate(L) if l.startswith(prefix))

BOUNDS = [
    ("서론", "# Ⅰ. 서론", "# Ⅱ."),
    ("2장",  "# Ⅱ.",     "# Ⅲ."),
    ("3장",  "# Ⅲ.",     "# Ⅳ."),
    ("4장",  "# Ⅳ.",     "# Ⅴ."),
    ("5장",  "# Ⅴ.",     "# Ⅵ."),
    ("6장",  "# Ⅵ.",     "# 생성형 AI"),
]
CH = {}
for name, a, b in BOUNDS:
    i, j = idx(a), idx(b)
    body = [l for l in L[i:j] if l.strip() and not l.startswith("#") and l != "---"
            and not l.startswith("|") and not l.startswith("**표") and not l.startswith("**그림")]
    CH[name] = {"lines": L[i:j], "body": body, "text": "\n".join(body), "start": i}

def sents(p):
    t = re.sub(r"\([^()]*\)", lambda m: m.group(0).replace(".", "\x00"), p)
    return [x.replace("\x00", ".").strip() for x in re.split(r"(?<=[.]) +", t) if x.strip()]

findings = []   # (심각도, 장, 규칙, 증거)
def add(sev, ch, rule, ev): findings.append((sev, ch, rule, ev))

# ── A. 장 간 15자 이상 동일 문구 (인용 괄호·절 참조 제외) ──────────────
def phrases(text, n=15):
    out = set()
    clean = re.sub(r"\([^()]*\)", "", text)
    for line in clean.split("\n"):
        for k in range(len(line) - n + 1):
            w = line[k:k+n]
            if re.search(r"[가-힣]{4}", w) and not re.search(r"\d\.\d", w):
                out.add(w)
    return out
PAIRS = [("서론", "2장"), ("서론", "3장"), ("2장", "3장"), ("4장", "5장"), ("5장", "6장"), ("서론", "5장")]
for a, b in PAIRS:
    common = phrases(CH[a]["text"]) & phrases(CH[b]["text"])
    # 가장 긴 것만 남긴다 (부분 문자열 제거)
    kept = []
    for w in sorted(common, key=len, reverse=True):
        if not any(w in k for k in kept):
            kept.append(w)
    # 상투 어구는 뺀다
    STOCK = ("공공 천문자료 기반 천문탐구", "공공 천문자료 서비스", "공공 천문자료를 활용한", "실제 자료 기반", "기존 공공 천문자료", "학교 천문탐구", "교육용 웹 플랫폼", "설계 원리", "탐구 흐름", "2022 개정 과학과 교육과정", "현직 교사 중심 현장 검토", "구성하였다. 이를 통해", "제공한다. ESASky는", "현직 교사와 과학교육 전공자")
    kept = [w for w in kept if not any(st in w or w.strip() in st for st in STOCK)]
    for w in kept[:6]:
        add("중", "%s↔%s" % (a, b), "장 간 동일 문구", "「%s」" % w)

# ── B. 서론 — 결과 선취·방법 서술·EASWA 위치 ────────────────────────
intro = CH["서론"]
i14 = next(n for n, l in enumerate(intro["lines"]) if l.startswith("## 1.4"))
i15 = next(n for n, l in enumerate(intro["lines"]) if l.startswith("## 1.5"))
t14 = "\n".join(intro["lines"][i14:i15])
if "EASWA" in t14:
    add("상", "서론", "1.4에 EASWA — 설계 방향 절에서 산출물을 말했다", "%d회" % t14.count("EASWA"))
pre15 = "\n".join(intro["lines"][:i15])
for m in re.finditer(r"본 연구(?:는|에서는|가)[^.]{0,60}(?:하였다|도출하였다|개발하였다|구현하였다|설계하였다)", pre15):
    add("상", "서론", "1.5 이전에 연구자 행위 완료형 — 결과 선취", "「%s」" % m.group(0)[:70])
for w in ["시사점", "공백", "기여는", "본 연구의 기여"]:
    c = intro["text"].count(w)
    if c: add("중", "서론", "서론에 결과·위치 잡기 어휘 「%s」" % w, "%d회 — 위치 잡기는 2.1, 시사점은 4·5장" % c)

# ── C. 2장 — 연구자 행위 서술(방법)·서론 재인용 ────────────────────
ch2 = CH["2장"]
for m in re.finditer(r"본 연구(?:는|에서는)[^.]{0,80}(?:설정하였다|분석하였다|조사하였다|수집하였다|측정하였다)", ch2["text"]):
    add("상", "2장", "이론적 배경에 방법 서술", "「%s」" % m.group(0)[:70])
cite = lambda t: set(re.findall(r"\(([A-Z][A-Za-z'’\- ]+?(?: et al\.)?|[가-힣]{2,4}(?:·[가-힣]{2,4})*),\s*(\d{4}[a-z]?)", t))
both = cite(intro["text"]) & cite(ch2["text"])
for au, yr in sorted(both):
    add("하", "서론↔2장", "같은 문헌을 두 장에서 인용 — 논지가 같은지 사람이 확인", "%s (%s)" % (au, yr))

# ── D. 3장 — 결과·해석 동사 ─────────────────────────────────────────
ch3 = CH["3장"]
RESULT_V = ["나타났다", "응답하였다", "확인되었다", "도출되었다", "보고되었다", "높았다", "낮았다", "많았다"]
INTERP_V = ["의미한다", "시사한다", "해석할 수 있다", "뜻한다", "보여 준다", "보여준다"]
for v in RESULT_V:
    for m in re.finditer(r"[^.]{0,50}" + v, ch3["text"]):
        frag = m.group(0)
        if re.search(r"선행|연구에서는|문헌|Wong|Kang|Belland", frag):   # 선행연구 인용은 허용
            continue
        add("중", "3장", "연구 방법에 결과 동사 「%s」" % v, "「%s」" % frag[-60:])
for v in INTERP_V:
    c = ch3["text"].count(v)
    if c: add("중", "3장", "연구 방법에 해석 동사 「%s」" % v, "%d회" % c)

# ── E. 4장 — 해석 동사·당위 ─────────────────────────────────────────
ch4 = CH["4장"]
for v in ["의미한다", "시사한다", "뜻한다", "해석할 수 있다", "해석된다"]:
    hits = [m for m in re.finditer(r"[^.]{0,45}" + v, ch4["text"])]
    if hits:
        add("중", "4장", "결과 장에 해석 동사 「%s」 — 해석은 5장" % v, "%d회 · 예 「%s」" % (len(hits), hits[0].group(0)[-55:]))
for v in ["해야 한다", "필요가 있다", "되어야 한다", "바람직하다"]:
    c = ch4["text"].count(v)
    if c: add("중", "4장", "결과 장에 당위 「%s」" % v, "%d회" % c)

# ── F. 5장 — 서론에 없는 회수어·4장에 없는 수치 ──────────────────
ch5 = CH["5장"]
for w in ["공백"]:
    if w in ch5["text"] and w not in intro["text"]:
        add("상", "5장", "서론에 없는 말 「%s」을 서론에서 받은 것처럼 회수" % w, "%d회" % ch5["text"].count(w))
nums4 = set(re.findall(r"\d+(?:\.\d+)?%|\d+명|\d+건|0\.\d{3,4}", "\n".join(CH[k]["text"] for k in ("서론", "2장", "3장", "4장"))))
nums5 = set(re.findall(r"\d+(?:\.\d+)?%|\d+명|\d+건|0\.\d{3,4}", ch5["text"]))
for x in sorted(nums5 - nums4):
    add("중", "5장", "1~4장 어디에도 없는 수치가 논의에 등장", x)
for v in ["나타났다", "응답하였다"]:
    c = len(re.findall(v, ch5["text"]))
    if c > 3: add("하", "5장", "결과 재서술 동사 「%s」 다수 — 4장 반복인지 확인" % v, "%d회" % c)

# ── G. 6장 — 연구문제 수와 답 수·5장 반복·새 인용 ─────────────────
ch6 = CH["6장"]
rq = len([l for l in intro["lines"] if re.match(r"^\d\. ", l.strip())])
ords = re.findall(r"(?:^|\n)(첫째|둘째|셋째|넷째|다섯째)", CH["6장"]["text"])
if ords and len(ords) != rq:
    add("중", "6장", "6.1의 「첫째~」 개수와 연구문제 수 불일치", "첫째~ %d개 vs 연구문제 %d개 — 둘째·셋째가 같은 연구문제를 나눠 답하면 그 사실을 문장에 적을 것" % (len(ords), rq))
new6 = cite(ch6["text"]) - cite(intro["text"]) - cite(ch2["text"]) - cite(CH["3장"]["text"]) - cite(CH["4장"]["text"]) - cite(ch5["text"])
for au, yr in sorted(new6):
    add("하", "6장", "결론에서 처음 등장하는 인용", "%s (%s)" % (au, yr))

# ── H. 못 하는 주장 (전 장) ───────────────────────────────────────────
BANNED = [("학습 효과", "학생 대상 조사 없음"), ("성취 향상", "학생 대상 조사 없음"),
          ("개선 효과", "1·2차 집단·문항 다름"), ("일반화할 수 있", "표본 작음"),
          ("효율적이었다", "개발 시간·비용 미기록"), ("빠르게 개발", "개발 시간·비용 미기록")]
for name in CH:
    for w, why in BANNED:
        for sent in sents(CH[name]["text"].replace("\n", " ")):
            if w not in sent:
                continue
            if re.search(r"아니|아닌|않|못|없|검증하지|측정하지|범위|후속|과제|외적 타당화|초점을 두|한계|다루지|대신하지", sent):
                continue   # 부정·유보·한계 서술은 허용
            add("상", name, "못 하는 주장 「%s」 (%s)" % (w, why), "「%s」" % sent[:80])

# ── 출력 ────────────────────────────────────────────────────────────
order = {"상": 0, "중": 1, "하": 2}
findings.sort(key=lambda f: (order[f[0]], f[1]))
print("장별 역할 검사 — %s" % P.split("\\")[-1])
print("장 길이: " + " · ".join("%s %s자" % (k, f"{len(v['text']):,}") for k, v in CH.items()))
print()
if not findings:
    print("위반 0")
else:
    cnt = collections.Counter(f[0] for f in findings)
    print("위반 %d건 (상 %d · 중 %d · 하 %d)" % (len(findings), cnt["상"], cnt["중"], cnt["하"]))
    print()
    for sev, ch, rule, ev in findings:
        print("[%s] %-7s %s\n        %s" % (sev, ch, rule, ev))
