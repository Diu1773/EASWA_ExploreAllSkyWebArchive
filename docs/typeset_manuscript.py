# -*- coding: utf-8 -*-
"""v15 원고(md) → 조판 HTML. 기존 EASWA_논문_v15_조판.html의 스타일을 그대로 재사용한다."""
import io, re, html, sys

SRC = r"C:\Users\bmffr\Desktop\Me\ERP2026_Cosmos\EASWA_논문_전체수정본_v15.md"
OLD = r"C:\Users\bmffr\Desktop\Me\ERP2026_Cosmos\EASWA_논문_v15_조판.html"
OUT = r"C:\Users\bmffr\Desktop\Me\ERP2026_Cosmos\EASWA_논문_v15_조판.html"

# 기존 파일에서 <style> 블록 그대로 가져오기
old = io.open(OLD, encoding="utf-8").read()
style = old[old.index("<style>"):old.index("</style>") + len("</style>")]

md = io.open(SRC, encoding="utf-8").read().replace("\r\n", "\n")
# 검증기 마커 제거
md = re.sub(r"<!--\s*EASWA_[A-Z_]+\s*-->\n?", "", md)
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

    # 표
    if s.startswith("|") and i + 1 < len(lines) and re.match(r"^\|\s*:?-{2,}", lines[i + 1].strip()):
        cap = ""
        # 바로 앞 문단이 **표 N.** 형태면 캡션으로
        if out and out[-1].startswith("<p class=\"tcapsrc\">"):
            cap = out.pop()[len("<p class=\"tcapsrc\">"):-len("</p>")]
        hdr = [c.strip() for c in s.strip("|").split("|")]
        i += 2
        rows = []
        while i < len(lines) and lines[i].strip().startswith("|"):
            rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
            i += 1
        t = ['<figure class="tbl">']
        if cap:
            t.append(f'<div class="tcap">{cap}</div>')
        t.append('<div class="tw"><table><thead><tr>')
        t += [f"<th>{inline(c)}</th>" for c in hdr]
        t.append("</tr></thead><tbody>")
        for r in rows:
            t.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>")
        t.append("</tbody></table></div></figure>")
        out.append("".join(t))
        continue

    # 헤딩
    m = re.match(r"^(#{1,4})\s+(.*)$", s)
    if m:
        lvl, txt = len(m.group(1)), m.group(2).strip()
        sid += 1
        aid = f"s{sid}"
        if lvl == 1 and sid == 1:
            close_abs()
            out.append(f'<h1 class="doctitle" id="{aid}">{inline(txt)}</h1>')
            toc.append(f'<a class="lv1" href="#{aid}">{html.escape(txt)}</a>')
        elif txt in ("국문초록", "Abstract"):
            close_abs()
            out.append(f'<section class="abs"><h2 class="abshead" id="{aid}">{inline(txt)}</h2>')
            in_abs = True
            toc.append(f'<a class="lv2" href="#{aid}">{html.escape(txt)}</a>')
        else:
            close_abs()
            tag = {1: "h1", 2: "h2", 3: "h3", 4: "h4"}[lvl]
            out.append(f'<{tag} id="{aid}">{inline(txt)}</{tag}>')
            if lvl <= 2:
                toc.append(f'<a class="lv{lvl}" href="#{aid}">{html.escape(txt)}</a>')
        i += 1
        continue

    if s == "---":
        i += 1
        continue
    if not s:
        i += 1
        continue

    # 목록
    if re.match(r"^[-*]\s+", s):
        items = []
        while i < len(lines) and re.match(r"^[-*]\s+", lines[i].strip()):
            items.append(inline(re.sub(r"^[-*]\s+", "", lines[i].strip())))
            i += 1
        out.append("<ul>" + "".join(f"<li>{x}</li>" for x in items) + "</ul>")
        continue
    if re.match(r"^\d+\.\s+", s):
        items = []
        while i < len(lines) and re.match(r"^\d+\.\s+", lines[i].strip()):
            items.append(inline(re.sub(r"^\d+\.\s+", "", lines[i].strip())))
            i += 1
        out.append("<ol>" + "".join(f"<li>{x}</li>" for x in items) + "</ol>")
        continue
    if s.startswith(">"):
        q = []
        while i < len(lines) and lines[i].strip().startswith(">"):
            q.append(inline(lines[i].strip().lstrip(">").strip()))
            i += 1
        out.append("<blockquote>" + " ".join(q) + "</blockquote>")
        continue

    # 표 캡션 후보 (**표 N. …** 단독 줄)
    if re.match(r"^\*\*(표|그림)\s", s) and s.endswith("**"):
        out.append(f'<p class="tcapsrc">{inline(s[2:-2])}</p>')
        i += 1
        continue
    # 주제어
    if s.startswith("**주제어:**") or s.startswith("**Keywords:**"):
        out.append(f'<p class="kw">{inline(s)}</p>')
        i += 1
        continue

    out.append(f"<p>{inline(s)}</p>")
    i += 1

close_abs()
# 남은 캡션 후보를 일반 문단으로
body = "".join(out).replace('<p class="tcapsrc">', '<p class="tcap-inline">')

title = re.sub(r"^#\s+", "", lines[0]).strip()
doc = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700&family=Noto+Serif+KR:wght@400;600;700&display=swap" rel="stylesheet">
{style}</head><body>
<div id="toc">{''.join(toc)}</div>
<div id="page-area"><div id="paper">{body}</div></div>
</body></html>"""

io.open(OUT, "w", encoding="utf-8", newline="\n").write(doc)
print(f"조판 완료: {len(doc):,} bytes · 목차 {len(toc)}항목 · 표 {body.count('<figure class=')}개")
