"""
update_all.py
─────────────────────────────────────────────────────────────────
apt_trade_data.csv  →  trade_seoul.json
                    →  trade_gyeonggi_a.json (경기 절반)
                    →  trade_gyeonggi_b.json (경기 절반)
                    →  trade_incheon.json

GitHub Actions의 fetch_data.py 실행 후 이 스크립트를 실행해
사이트에서 사용하는 JSON 파일을 최신 상태로 유지합니다.

아파트명 정규화 (convert_kb.py 와 동일 규칙 필수):
  (1차)       → 1차
  (2단지)     → 2단지
  (209~222동) → 제거
  101~105동   → 제거
  (BL2-8)     → 제거
  BL2-8       → 제거
  공백         → 제거
─────────────────────────────────────────────────────────────────
"""

import csv
import json
import os
import re
import sys

# ─── 경로 설정 ────────────────────────────────────────────────
BASE_PATH  = os.path.dirname(os.path.abspath(__file__))
INPUT_CSV  = os.path.join(BASE_PATH, 'apt_trade_data.csv')

# 출력 파일 정의
OUTPUT_MAP = {
    '서울특별시':  os.path.join(BASE_PATH, 'trade_seoul.json'),
    '경기도_a':    os.path.join(BASE_PATH, 'trade_gyeonggi_a.json'),
    '경기도_b':    os.path.join(BASE_PATH, 'trade_gyeonggi_b.json'),
    '인천광역시':  os.path.join(BASE_PATH, 'trade_incheon.json'),
}


def normalize_apt(name: str) -> str:
    """
    아파트명 정규화 — convert_kb.py 와 완전히 동일한 규칙 적용
    (두 파일이 반드시 동기화되어야 KB 매칭이 정상 동작함)
    """
    n = name.strip()
    n = re.sub(r'\((\d+차)\)',           r'\1', n)   # (1차) → 1차
    n = re.sub(r'\((\d+단지)\)',         r'\1', n)   # (2단지) → 2단지
    n = re.sub(r'\([\d~,\s]+동[^)]*\)',  '',    n)   # (209~222동) 제거
    n = re.sub(r'[\d~,]+동$',            '',    n)   # 101~105동 제거
    n = re.sub(r'\(BL[\d\-]+\)',         '',    n)   # (BL2-8) 제거
    n = re.sub(r'BL[\d\-]+',             '',    n)   # BL2-8 제거
    n = re.sub(r'\s+',                   '',    n)   # 공백 제거
    return n.strip()


def safe_int(val, default=0) -> int:
    try:
        f = float(val)
        return default if (f != f) else int(round(f))
    except (ValueError, TypeError):
        return default


def safe_float(val) -> float | None:
    try:
        f = float(val)
        return None if (f != f) else f
    except (ValueError, TypeError):
        return None


def build_bucket():
    """sido별 버킷 초기화"""
    return {
        'sg':   [],   # [sigungu, ...]
        'dong': [],   # [dong, ...]
        'apt':  [],   # [apt 원본, ...]
        'aptN': [],   # [apt 정규화, ...]
        'sg_idx':   {},
        'dong_idx': {},
        'apt_idx':  {},
        'aptN_idx': {},
        'd':    [],   # [[sg_i, dong_i, apt_i, aptN_i, area×10, floor, ym, day, price, jPrice, gap, jRatio×10], ...]
    }


def idx_of(lst, idx_dict, val):
    if val not in idx_dict:
        idx_dict[val] = len(lst)
        lst.append(val)
    return idx_dict[val]


def main():
    if not os.path.exists(INPUT_CSV):
        sys.exit(f"❌ CSV 파일 없음: {INPUT_CSV}")

    print(f"⏳ 변환 시작: {INPUT_CSV}")

    # sido별 버킷
    buckets = {
        '서울특별시': build_bucket(),
        '경기도':     build_bucket(),
        '인천광역시': build_bucket(),
    }

    total = skipped = 0

    with open(INPUT_CSV, 'rb') as f:
        raw = f.read()

    # BOM 처리
    text = raw.decode('utf-8-sig')
    reader = csv.DictReader(text.splitlines())

    for row in reader:
        sido    = row.get('sido',    '').strip()
        sigungu = row.get('sigungu', '').strip()
        dong    = row.get('dong',    '').strip()
        apt_raw = row.get('아파트',  '').strip()
        price_s = row.get('거래금액_n', '').strip()
        area_s  = row.get('전용면적',   '').strip()

        if sido not in buckets or not apt_raw or not price_s:
            skipped += 1
            continue

        price = safe_int(price_s)
        if price <= 0:
            skipped += 1
            continue

        area_f = safe_float(area_s)
        if area_f is None:
            skipped += 1
            continue

        # ×10 정수화 (소수점 1자리 보존, 메모리 효율)
        area_x10 = int(round(area_f * 10))
        floor    = safe_int(row.get('층', '0'))
        ym       = safe_int(row.get('계약년월', '0'))
        day      = safe_int(row.get('계약일', '0'))
        jPrice   = safe_int(row.get('jeonsePrice', '0'))
        gap      = safe_int(row.get('gap', '0'))
        jRatio_f = safe_float(row.get('jeonseRatio', '0')) or 0.0
        jRatio_x10 = int(round(jRatio_f * 10))

        aptN = normalize_apt(apt_raw)
        bkt  = buckets[sido]

        sg_i   = idx_of(bkt['sg'],   bkt['sg_idx'],   sigungu)
        dong_i = idx_of(bkt['dong'], bkt['dong_idx'], dong)
        apt_i  = idx_of(bkt['apt'],  bkt['apt_idx'],  apt_raw)
        aptN_i = idx_of(bkt['aptN'], bkt['aptN_idx'], aptN)

        bkt['d'].append([
            sg_i, dong_i, apt_i, aptN_i,
            area_x10, floor, ym, day,
            price, jPrice, gap, jRatio_x10,
        ])
        total += 1

    # ─── 저장 ────────────────────────────────────────────────
    import math

    # 서울
    _save('서울특별시', buckets['서울특별시'], OUTPUT_MAP['서울특별시'])

    # 경기도 절반씩 분할
    gyeonggi = buckets['경기도']
    mid = math.ceil(len(gyeonggi['d']) / 2)

    # sg/dong/apt/aptN 인덱스 테이블은 전체 공유
    for suffix, data_slice in [('_a', gyeonggi['d'][:mid]), ('_b', gyeonggi['d'][mid:])]:
        key = f'경기도{suffix}'
        obj = {
            'sido': '경기도',
            'sg':   gyeonggi['sg'],
            'dong': gyeonggi['dong'],
            'apt':  gyeonggi['apt'],
            'aptN': gyeonggi['aptN'],
            'd':    data_slice,
        }
        _write(obj, OUTPUT_MAP[key])
        print(f"  → {os.path.basename(OUTPUT_MAP[key])}: {len(data_slice):,}건")

    # 인천
    _save('인천광역시', buckets['인천광역시'], OUTPUT_MAP['인천광역시'])

    print(f"\n✅ 완료! 총 {total:,}건 처리 (스킵: {skipped:,}건)")


def _save(sido_name, bkt, path):
    obj = {
        'sido': sido_name,
        'sg':   bkt['sg'],
        'dong': bkt['dong'],
        'apt':  bkt['apt'],
        'aptN': bkt['aptN'],
        'd':    bkt['d'],
    }
    _write(obj, path)
    print(f"  → {os.path.basename(path)}: {len(bkt['d']):,}건")


def _write(obj, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
