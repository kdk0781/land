"""
update_all.py - apt_trade_data.csv → trade_*.json 전국 변환
GitHub Actions에서 fetch_data.py 실행 후 자동 호출됨

출력 파일:
  trade_seoul.json        서울특별시
  trade_gyeonggi_a.json   경기도 (전반)
  trade_gyeonggi_b.json   경기도 (후반)
  trade_incheon.json      인천광역시
  trade_busan.json        부산광역시
  trade_daegu.json        대구광역시
  trade_gwangju.json      광주광역시
  trade_daejeon.json      대전광역시
  trade_ulsan.json        울산광역시
  trade_sejong.json       세종특별자치시
  trade_gangwon.json      강원특별자치도
  trade_chungbuk.json     충청북도
  trade_chungnam.json     충청남도
  trade_jeonbuk.json      전북특별자치도
  trade_jeonnam.json      전라남도
  trade_gyeongbuk.json    경상북도
  trade_gyeongnam.json    경상남도
  trade_jeju.json         제주특별자치도
"""

import csv, json, math, os, re, sys

BASE_PATH = os.path.dirname(os.path.abspath(__file__))
INPUT_CSV = os.path.join(BASE_PATH, 'apt_trade_data.csv')

# sido → 출력 파일 키 매핑
SIDO_FILE = {
    '서울특별시':    'seoul',
    '부산광역시':    'busan',
    '대구광역시':    'daegu',
    '인천광역시':    'incheon',
    '광주광역시':    'gwangju',
    '대전광역시':    'daejeon',
    '울산광역시':    'ulsan',
    '세종특별자치시':'sejong',
    '경기도':        'gyeonggi',
    '강원특별자치도':'gangwon',
    '충청북도':      'chungbuk',
    '충청남도':      'chungnam',
    '전북특별자치도':'jeonbuk',
    '전라남도':      'jeonnam',
    '경상북도':      'gyeongbuk',
    '경상남도':      'gyeongnam',
    '제주특별자치도':'jeju',
}


def normalize_apt(name):
    """convert_kb.py 와 완전히 동일한 규칙 — 반드시 동기화 유지"""
    n = name.strip()
    n = re.sub(r'\((\d+차)\)',           r'\1', n)
    n = re.sub(r'\((\d+단지)\)',         r'\1', n)
    n = re.sub(r'\([\d~,\s]+동[^)]*\)',  '',    n)
    n = re.sub(r'[\d~,]+동$',            '',    n)
    n = re.sub(r'\(BL[\d\-]+\)',         '',    n)
    n = re.sub(r'BL[\d\-]+',             '',    n)
    n = re.sub(r'\s+',                   '',    n)
    return n.strip()


def safe_int(val, default=0):
    try:
        f = float(val)
        return default if (f != f) else int(round(f))
    except: return default


def safe_float(val):
    try:
        f = float(val)
        return None if (f != f) else f
    except: return None


def make_bucket():
    return {
        'sg': [], 'dong': [], 'apt': [], 'aptN': [],
        'sg_idx': {}, 'dong_idx': {}, 'apt_idx': {}, 'aptN_idx': {},
        'd': [],
    }


def idx_of(lst, d, val):
    if val not in d:
        d[val] = len(lst); lst.append(val)
    return d[val]


def main():
    if not os.path.exists(INPUT_CSV):
        sys.exit(f"❌ {INPUT_CSV} 없음")
    print(f"⏳ 변환 시작: {INPUT_CSV}")

    buckets = {}  # sido → bucket

    with open(INPUT_CSV, 'rb') as f:
        raw = f.read()
    reader = csv.DictReader(raw.decode('utf-8-sig').splitlines())

    total = skipped = 0
    for row in reader:
        sido    = row.get('sido',    '').strip()
        sg      = row.get('sigungu', '').strip()
        dong    = row.get('dong',    '').strip()
        apt_raw = row.get('아파트',  '').strip()
        price_s = row.get('거래금액_n', '').strip()
        area_s  = row.get('전용면적',   '').strip()

        if not sido or not apt_raw or not price_s:
            skipped += 1; continue

        price  = safe_int(price_s)
        area_f = safe_float(area_s)
        if price <= 0 or area_f is None:
            skipped += 1; continue

        if sido not in buckets:
            buckets[sido] = make_bucket()

        area_x10   = int(round(area_f * 10))
        floor      = safe_int(row.get('층', '0'))
        ym         = safe_int(row.get('계약년월', '0'))
        day        = safe_int(row.get('계약일', '0'))
        jPrice     = safe_int(row.get('jeonsePrice', '0'))
        gap        = safe_int(row.get('gap', '0'))
        jRatio_f   = safe_float(row.get('jeonseRatio', '0')) or 0.0
        jRatio_x10 = int(round(jRatio_f * 10))
        aptN       = normalize_apt(apt_raw)

        bkt = buckets[sido]
        bkt['d'].append([
            idx_of(bkt['sg'],   bkt['sg_idx'],   sg),
            idx_of(bkt['dong'], bkt['dong_idx'], dong),
            idx_of(bkt['apt'],  bkt['apt_idx'],  apt_raw),
            idx_of(bkt['aptN'], bkt['aptN_idx'], aptN),
            area_x10, floor, ym, day,
            price, jPrice, gap, jRatio_x10,
        ])
        total += 1

    # ─── 저장 ────────────────────────────────────────────────
    for sido, bkt in buckets.items():
        file_key = SIDO_FILE.get(sido)
        if not file_key:
            print(f"  ⚠ 알 수 없는 sido: {sido} ({len(bkt['d'])}건 스킵)")
            continue

        if sido == '경기도':
            # 경기도는 데이터가 많으므로 절반씩 분할
            data = bkt['d']
            mid  = math.ceil(len(data) / 2)
            for suffix, slc in [('_a', data[:mid]), ('_b', data[mid:])]:
                obj = {
                    'sido': sido,
                    'sg': bkt['sg'], 'dong': bkt['dong'],
                    'apt': bkt['apt'], 'aptN': bkt['aptN'],
                    'd': slc,
                }
                path = os.path.join(BASE_PATH, f'trade_gyeonggi{suffix}.json')
                _write(obj, path)
                print(f"  → trade_gyeonggi{suffix}.json: {len(slc):,}건")
        else:
            obj = {
                'sido': sido,
                'sg': bkt['sg'], 'dong': bkt['dong'],
                'apt': bkt['apt'], 'aptN': bkt['aptN'],
                'd': bkt['d'],
            }
            path = os.path.join(BASE_PATH, f'trade_{file_key}.json')
            _write(obj, path)
            print(f"  → trade_{file_key}.json: {len(bkt['d']):,}건")

    print(f"\n✅ 완료! 총 {total:,}건 (스킵: {skipped:,}건)")


def _write(obj, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
