# -*- coding: utf-8 -*-
"""v16 원고(md) → 조판 HTML.

v15 조판본(`EASWA_논문_v15_조판.html`)의 <style>을 그대로 물려쓰되 v16에서 생긴 것을 처리한다.

  · **그림 여덟 장** — v15에는 이미지 줄이 없어 기존 스크립트가 다루지 못했다.
    「![대체글](경로)」와 그 뒤의 「**그림 N. …**」를 하나의 figure로 묶는다.
  · **부록 A~C** — 새 쪽에서 시작하도록 표시한다.
  · **인쇄 미디어** — 목차를 감추고 종이 여백만 남긴다.
  · **그림 인라인** — 그림을 data URI로 넣어 파일 하나로 완결시킨다. 폴더를 옮겨도
    그림이 보이고, 헤드리스 Chrome의 PDF 변환이 한글 경로에서 걸리지 않는다.

  python -X utf8 docs/typeset_v16.py            # 그림은 상대경로
  python -X utf8 docs/typeset_v16.py --inline   # 그림을 파일 안에 넣는다
"""
import base64
import io
import html
import os
import re
import sys

BASE = "C:/Users/bmffr/Desktop/Me/ERP2026_Cosmos"
SRC = BASE + "/EASWA_논문_v17.md"
STYLE_FROM = BASE + "/EASWA_논문_v15_조판.html"
INLINE = "--inline" in sys.argv
OUT = BASE + ("/EASWA_논문_v17_조판_자기완결.html" if INLINE else "/EASWA_논문_v17_조판.html")


def img_src(rel):
    """--inline이면 그림을 data URI로 바꾼다. 파일이 없으면 경로를 그대로 둔다."""
    if not INLINE:
        return rel
    p = os.path.join(BASE, rel.replace("/", os.sep))
    if not os.path.exists(p):
        print("  ! 그림 없음: %s" % rel)
        return rel
    ext = os.path.splitext(p)[1].lstrip(".").lower()
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "gif": "image/gif", "svg": "image/svg+xml"}.get(ext, "image/png")
    with open(p, "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode("ascii"))

EXTRA_CSS = """
figure.fig{margin:1.3em 0 1.5em;page-break-inside:avoid;text-align:center}
figure.fig img{max-width:100%;border:1px solid var(--line)}
figure.fig figcaption{font-family:"Noto Sans KR",sans-serif;font-size:9.3pt;font-weight:600;
                      margin-top:.45em;text-align:left;color:#111}
h1.apx{page-break-before:always}
/* 인쇄 여백을 @page가 아니라 본문 padding으로 준다. @page margin이 0이면 Chrome이
   머리글(날짜·제목)과 바닥글(파일 경로·쪽번호)을 그릴 자리를 잃는다.
   --print-to-pdf-no-header / --no-pdf-header-footer 플래그는 이 버전에서 듣지 않았다. */
@page{size:A4;margin:0}
@media print{
  #toc{display:none}
  #page-area{padding-left:0}
  #paper{margin:0;max-width:none;padding:22mm 20mm 20mm;box-shadow:none}
  html{background:#fff}
}
</style>"""

old = io.open(STYLE_FROM, encoding="utf-8").read()
style = old[old.index("<style>"):old.index("</style>")] + EXTRA_CSS

md = io.open(SRC, encoding="utf-8").read().replace("\r\n", "\n")
md = re.sub(r"<!--\s*EASWA_[A-Z_]+\s*-->\n?", "", md)   # 검증기 마커
lines = md.split("\n")


def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![*\w])\*([^*\n]+?)\*(?!\*)", r"<em>\1</em>", t)
    t = re.sub(r"`([^`]+?)`", r"<code>\1</code>", t)
    t = re.sub(r"\[([^\]]+?)\]\(([^)]+?)\)", r'<a href="\2">\1</a>', t)
    return t


out, toc = [], []
sid = 0
i = 0
in_abs = False


def close_abs():
    global in_abs
    if in_abs:
        out.append("</section>")
        in_abs = False


while i < len(lines):
    ln = lines[i]
    s = ln.strip()

    # ── 표 ────────────────────────────────────────────────────────
    if s.startswith("|") and i + 1 < len(lines) and re.match(r"^\|\s*:?-{2,}", lines[i + 1].strip()):
        cap = ""
        if out and out[-1].startswith('<p class="tcapsrc">'):
            cap = out.pop()[len('<p class="tcapsrc">'):-len("</p>")]
        hdr = [c.strip() for c in s.strip("|").split("|")]
        i += 2
        rows = []
        while i < len(lines) and lines[i].strip().startswith("|"):
            rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
            i += 1
        t = ['<figure class="tbl">']
        if cap:
            t.append('<div class="tcap">%s</div>' % cap)
        t.append('<div class="tw"><table><thead><tr>')
        t += ["<th>%s</th>" % inline(c) for c in hdr]
        t.append("</tr></thead><tbody>")
        for r in rows:
            t.append("<tr>" + "".join("<td>%s</td>" % inline(c) for c in r) + "</tr>")
        t.append("</tbody></table></div></figure>")
        out.append("".join(t))
        continue

    # ── 그림 ──────────────────────────────────────────────────────
    # 이미지 줄 다음에 오는 「**그림 N. …**」를 같은 figure의 캡션으로 끌어온다.
    mi = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)\s*$", s)
    if mi:
        cap = ""
        j = i + 1
        while j < len(lines) and not lines[j].strip():
            j += 1
        if j < len(lines) and re.match(r"^\*\*그림\s", lines[j].strip()):
            # 캡션은 「**그림 N. 제목.** 설명…」처럼 굵은 부분 뒤에 설명이 이어지기도 한다.
            # 앞뒤 두 글자를 무조건 자르면 설명의 끝이 날아가므로 원문을 그대로 넘긴다.
            cap = lines[j].strip()
            i = j
        out.append('<figure class="fig"><img src="%s" alt="%s">%s</figure>'
                   % (html.escape(img_src(mi.group(2))), html.escape(mi.group(1)),
                      "<figcaption>%s</figcaption>" % inline(cap) if cap else ""))
        i += 1
        continue

    # ── 헤딩 ──────────────────────────────────────────────────────
    m = re.match(r"^(#{1,4})\s+(.*)$", s)
    if m:
        lvl, txt = len(m.group(1)), m.group(2).strip()
        sid += 1
        aid = "s%d" % sid
        if lvl == 1 and sid == 1:
            close_abs()
            out.append('<h1 class="doctitle" id="%s">%s</h1>' % (aid, inline(txt)))
            toc.append('<a class="lv1" href="#%s">%s</a>' % (aid, html.escape(txt)))
        elif txt in ("국문초록", "Abstract"):
            close_abs()
            out.append('<section class="abs"><h2 class="abshead" id="%s">%s</h2>' % (aid, inline(txt)))
            in_abs = True
            toc.append('<a class="lv2" href="#%s">%s</a>' % (aid, html.escape(txt)))
        else:
            close_abs()
            tag = {1: "h1", 2: "h2", 3: "h3", 4: "h4"}[lvl]
            cls = ' class="apx"' if txt.startswith("부록") else ""
            out.append("<%s%s id=\"%s\">%s</%s>" % (tag, cls, aid, inline(txt), tag))
            if lvl <= 2:
                toc.append('<a class="lv%d" href="#%s">%s</a>' % (lvl, aid, html.escape(txt)))
        i += 1
        continue

    if s == "---" or not s:
        i += 1
        continue

    # ── 목록·인용 ─────────────────────────────────────────────────
    if re.match(r"^[-*]\s+", s):
        items = []
        while i < len(lines) and re.match(r"^[-*]\s+", lines[i].strip()):
            items.append(inline(re.sub(r"^[-*]\s+", "", lines[i].strip())))
            i += 1
        out.append("<ul>" + "".join("<li>%s</li>" % x for x in items) + "</ul>")
        continue
    if re.match(r"^\d+\.\s+", s):
        items = []
        while i < len(lines) and re.match(r"^\d+\.\s+", lines[i].strip()):
            items.append(inline(re.sub(r"^\d+\.\s+", "", lines[i].strip())))
            i += 1
        out.append("<ol>" + "".join("<li>%s</li>" % x for x in items) + "</ol>")
        continue
    if s.startswith(">"):
        q = []
        while i < len(lines) and lines[i].strip().startswith(">"):
            q.append(inline(lines[i].strip().lstrip(">").strip()))
            i += 1
        out.append("<blockquote>" + " ".join(q) + "</blockquote>")
        continue

    # 표 캡션 후보 — 바로 다음이 표면 위에서 캡션으로 회수한다.
    if re.match(r"^\*\*(표|그림)\s", s) and s.endswith("**"):
        out.append('<p class="tcapsrc">%s</p>' % inline(s[2:-2]))
        i += 1
        continue
    if s.startswith("**주제어:**") or s.startswith("**Keywords:**"):
        out.append('<p class="kw">%s</p>' % inline(s))
        i += 1
        continue

    out.append("<p>%s</p>" % inline(s))
    i += 1

close_abs()
body = "".join(out).replace('<p class="tcapsrc">', '<p class="tcap-inline">')
title = re.sub(r"^#\s+", "", lines[0]).strip()

doc = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700&family=Noto+Serif+KR:wght@400;600;700&display=swap" rel="stylesheet">
%s</head><body>
<div id="toc">%s</div>
<div id="page-area"><div id="paper">%s</div></div>
</body></html>""" % (html.escape(title), style, "".join(toc), body)

io.open(OUT, "w", encoding="utf-8", newline="\n").write(doc)

n_fig = body.count('<figure class="fig">')
n_tbl = body.count('<figure class="tbl">')
print("조판 완료 — %s" % OUT)
print("  표 %d개 · 그림 %d개 · 목차 %d항목 · %,d바이트"
      .replace("%,d", "%d") % (n_tbl, n_fig, len(toc), len(doc)))
