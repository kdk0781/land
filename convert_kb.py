"""
convert_kb.py
─────────────────────────────────────────────────────────────────
KB 시세표 XLS  →  kb.json 변환 스크립트 (전국판)

사용법:
    python convert_kb.py

입력:  시세표.xls   (스크립트와 같은 폴더에 위치)
출력:  kb.json      (스크립트와 같은 폴더에 생성)

시트 구조:
    시세표(서울,경기,인천)  → 서울/경기/인천 데이터
    시세표(그외지역)        → 전국 나머지 14개 시도 데이터
    데이터 시작: 3행 (0-indexed)

컬럼 구조 (0-indexed):
    0 시/도       1 시/군/구    2 지역(법정동)  3 아파트
    4 주택형(공급) 5 전용면적    6 주택형2       7 구평형
    8 하한가       9 일반거래가  10 상한가

⚠ normalize_apt() 규칙은 update_all.py 와 반드시 동일해야 합니다.

의존성:  pip install xlrd==1.2.0
─────────────────────────────────────────────────────────────────
"""

import re
import json
import os
import sys
import time

try:
    import xlrd
except ImportError:
    sys.exit("❌ xlrd가 없습니다.  pip install xlrd==1.2.0  로 설치하세요.")

# ─── 경로 설정 ────────────────────────────────────────────────
BASE_PATH   = os.path.dirname(os.path.abspath(__file__))
INPUT_FILE  = os.path.join(BASE_PATH, '시세표.xls')
OUTPUT_FILE = os.path.join(BASE_PATH, 'kb.json')

# ─── 처리할 시트 목록 ─────────────────────────────────────────
# XLS 내 모든 시트를 순서대로 처리
# Sheet3 같은 빈 시트는 데이터 없으면 자동 스킵됨
TARGET_SHEETS = ['시세표(서울,경기,인천)', '시세표(그외지역)']

# ─── XLS 컬럼 인덱스 ─────────────────────────────────────────
DATA_START_ROW = 3   # 0~2행: 헤더, 3행부터 데이터
COL_SIDO  = 0
COL_SGG   = 1   # 원본: '가평군 ', '고양시 덕양구' 등
COL_APT   = 3
COL_EXCL  = 5   # 전용면적 (㎡)
COL_LOW   = 8
COL_MID   = 9
COL_HIGH  = 10


def normalize_apt(name: str) -> str:
    """
    아파트명 정규화 — update_all.py 와 완전히 동일한 규칙
    두 파일 수정 시 반드시 함께 동기화할 것

    (1차)        → 1차
    (2단지)      → 2단지
    (209~222동)  → 제거
    101~105동    → 제거
    (BL2-8)      → 제거
    BL2-8        → 제거
    공백          → 제거
    """
    n = name.strip()
    n = re.sub(r'\((\d+차)\)',           r'\1', n)
    n = re.sub(r'\((\d+단지)\)',         r'\1', n)
    n = re.sub(r'\([\d~,\s]+동[^)]*\)',  '',    n)
    n = re.sub(r'[\d~,]+동$',            '',    n)
    n = re.sub(r'\(BL[\d\-]+\)',         '',    n)
    n = re.sub(r'BL[\d\-]+',             '',    n)
    n = re.sub(r'\s+',                   '',    n)
    return n.strip()


def normalize_sgg(raw: str) -> str:
    """
    시군구 정규화 — 실거래 CSV sigungu 컬럼과 일치시킴

    KB 원본 → 정규화
    '가평군 '      → '가평군'
    '고양시 덕양구' → '고양시'   ← 첫 단어만 (구 단위 제거)

    실거래 CSV는 시 단위로만 저장되므로 첫 단어를 사용
    """
    return raw.strip().split()[0] if raw.strip() else ''


def safe_int(val) -> int | None:
    """숫자 변환 실패 또는 0이면 None"""
    try:
        f = float(val)
        if f != f or f == 0:   # NaN 또는 0
            return None
        return int(round(f))
    except (ValueError, TypeError):
        return None


def process():
    if not os.path.exists(INPUT_FILE):
        sys.exit(f"❌ 파일 없음: {INPUT_FILE}")

    t0 = time.time()
    print(f"⏳ 변환 시작: {INPUT_FILE}")

    try:
        wb = xlrd.open_workbook(INPUT_FILE, on_demand=True)
    except Exception as exc:
        sys.exit(f"❌ XLS 파일 열기 실패: {exc}")

    sheet_names = wb.sheet_names()
    print(f"   시트 목록: {sheet_names}")

    sg_map:  dict[str, int] = {}
    sg_list: list           = []
    d_list:  list           = []
    skipped = total = 0

    for si, target in enumerate(TARGET_SHEETS):
        if target not in sheet_names:
            print(f"  ⚠ 시트 없음 (스킵): '{target}'")
            continue

        idx = sheet_names.index(target)
        ws  = wb.sheet_by_index(idx)
        print(f"\n  📄 '{target}' ({ws.nrows:,}행)")

        for ri in range(DATA_START_ROW, ws.nrows):
            sido    = str(ws.cell_value(ri, COL_SIDO)).strip()
            raw_sgg = str(ws.cell_value(ri, COL_SGG))
            apt_raw = str(ws.cell_value(ri, COL_APT)).strip()

            # 빈 행 스킵
            if not sido or sido in ('nan', '시/도'):
                continue

            area = safe_int(ws.cell_value(ri, COL_EXCL))
            mid  = safe_int(ws.cell_value(ri, COL_MID))
            low  = safe_int(ws.cell_value(ri, COL_LOW))
            high = safe_int(ws.cell_value(ri, COL_HIGH))

            if area is None or mid is None or not apt_raw:
                skipped += 1
                continue

            sgg  = normalize_sgg(raw_sgg)
            aptN = normalize_apt(apt_raw)

            key = f"{sido}|{sgg}"
            if key not in sg_map:
                sg_map[key] = len(sg_list)
                sg_list.append([sido, sgg])

            d_list.append([
                sg_map[key],
                aptN,
                area,
                low  if low  is not None else 0,
                mid,
                high if high is not None else 0,
            ])
            total += 1

        print(f"     → {total:,}건 누계")

    # ─── 저장 ────────────────────────────────────────────────
    output = {"sg": sg_list, "d": d_list}
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

    raw_sz = os.path.getsize(OUTPUT_FILE)
    elapsed = time.time() - t0

    print(f"\n{'─'*55}")
    print(f"✅ 완료! ({elapsed:.1f}초)")
    print(f"   총 데이터:  {total:,}건  (스킵: {skipped:,}건)")
    print(f"   시군구:     {len(sg_list)}개")
    print(f"   파일 크기:  {raw_sz/1024:.0f}KB  →  {OUTPUT_FILE}")

    # 시도별 건수 요약
    from collections import Counter
    sido_cnt = Counter(sg_list[row[0]][0] for row in d_list)
    print(f"\n   시도별 건수:")
    for k, v in sorted(sido_cnt.items(), key=lambda x: -x[1]):
        print(f"     {k}: {v:,}")

    print(f"\n📌 다음 단계: kb.json → GitHub land/ 폴더에 덮어쓰기")
    print(f"⚠  normalize_apt() 수정 시 update_all.py 도 반드시 동기화!")


if __name__ == '__main__':
    process()
