# -*- coding: utf-8 -*-
"""구글 시트에서 받은 xlsx를 분석 스크립트가 읽는 원자료로 바꾼다.

구글 시트는 로컬 파일이 없다. `G:\\내 드라이브`의 `.gsheet`는 198바이트 포인터이고
열면 `[Errno 22] Invalid argument`가 난다. 시트에서 파일 → 다운로드 → xlsx로 받아
`Downloads`에 두고 이것을 돌린다.

  python -X utf8 docs/survey/xlsx_to_raw.py

**코호트를 파일 이름으로 가른다.** 두 구글폼은 문항 구조가 거의 같고 내려받은 이름이
「…조사(응답).xlsx」와 「…조사 (예비교사)(응답).xlsx」로 한 칸 차이다. 첫 응답의
타임스탬프가 07-24면 교사, 09-06/09-07이면 예비교사다. 자세한 것은 data/README.md.
"""
import collections
import csv
import datetime
import io
import os
import sys

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl이 필요하다:  pip install openpyxl")

DL = os.path.join(os.path.expanduser("~"), "Downloads")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

JOBS = [
    # (내려받은 이름, 시트, 저장 이름, 형식, 기대 코호트 날짜 접두)
    ("EASWA 프로토타입 반응 및 보완 요구 조사(응답).xlsx", None,
     "교사_설문_원자료_2026-07-24.tsv", "tsv", "2026-07-24"),
    ("EASWA 프로토타입 반응 및 보완 요구 조사 (예비교사)(응답).xlsx", None,
     "예비교사_설문_원자료_2026-09-07_통합.tsv", "tsv", "2026-09-0"),
    ("익명제출EASWA (1).xlsx", "시트1", "익명제출EASWA.csv", "csv", None),
    ("익명제출EASWA (1).xlsx", "식현상", "익명제출_식현상.csv", "csv", None),
    ("익명제출EASWA (1).xlsx", "KMTNet", "익명제출_KMTNet.csv", "csv", None),
    ("익명제출EASWA (1).xlsx", "성단 CMD", "익명제출_성단CMD.csv", "csv", None),
]


def cell(c):
    """엑셀 값을 구글 시트 화면과 같은 문자열로 되돌린다.

    openpyxl은 리커트 응답을 실수로 읽는다. 그대로 str()하면 「4」가 「4.0」이 되고
    분석 스크립트가 척도 문항을 전부 무응답으로 센다(2026-09-07에 실제로 겪었다).
    """
    if c is None:
        return ""
    if isinstance(c, datetime.datetime):
        return c.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(c, float) and c.is_integer():
        return str(int(c))
    return str(c)


def read_rows(path, sheet):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    rows = []
    for r in ws.iter_rows(values_only=True):
        if not any(c is not None and str(c).strip() for c in r):
            continue
        rows.append([cell(c) for c in r])
    wb.close()
    return rows


def main():
    for src, sheet, name, fmt, expect in JOBS:
        path = os.path.join(DL, src)
        if not os.path.exists(path):
            print("[없음] %s — 건너뛴다" % src)
            continue
        try:
            rows = read_rows(path, sheet)
        except KeyError:
            print("[탭 없음] %s / %s" % (src, sheet))
            continue
        if not rows:
            print("[빈 시트] %s / %s" % (src, sheet))
            continue

        # 코호트 확인 — 이름과 내용이 어긋나면 쓰지 않는다
        if expect:
            first = str(rows[1][0])[:10] if len(rows) > 1 else ""
            if not first.startswith(expect):
                print("[코호트 불일치!] %s 의 첫 응답이 %s 다. %s 를 기대했다. 쓰지 않는다."
                      % (name, first, expect))
                continue

        dst = os.path.join(OUT, name)
        if fmt == "tsv":
            with io.open(dst, "w", encoding="utf-8", newline="") as f:
                for r in rows:
                    f.write("\t".join(c.replace("\t", " ").replace("\n", " ") for c in r) + "\n")
        else:
            with io.open(dst, "w", encoding="utf-8", newline="") as f:
                csv.writer(f).writerows(rows)

        note = ""
        if expect:
            c = collections.Counter(str(r[0])[:10] for r in rows[1:])
            note = "  " + " · ".join("%s %d건" % (k, v) for k, v in sorted(c.items()))
        print("%-42s 헤더1 + %d행%s" % (name, len(rows) - 1, note))


if __name__ == "__main__":
    main()
