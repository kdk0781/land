import requests
import pandas as pd
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import time
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
API_KEY = '4dc9ae5186b8259cfa06a26e9aa19e5c2758fb51804d6a48165b7f8ae499d50a'

# 지역코드(LAWD_CD)에 시도, 시군구를 직접 매핑 (미분류 에러 원천 차단)
DISTRICT_MAP = {
    '11110': ('서울특별시', '종로구'), '11140': ('서울특별시', '중구'), '11170': ('서울특별시', '용산구'),
    '11200': ('서울특별시', '성동구'), '11215': ('서울특별시', '광진구'), '11230': ('서울특별시', '동대문구'),
    '11260': ('서울특별시', '중랑구'), '11290': ('서울특별시', '성북구'), '11305': ('서울특별시', '강북구'),
    '11320': ('서울특별시', '도봉구'), '11350': ('서울특별시', '노원구'), '11380': ('서울특별시', '은평구'),
    '11410': ('서울특별시', '서대문구'), '11440': ('서울특별시', '마포구'), '11470': ('서울특별시', '양천구'),
    '11500': ('서울특별시', '강서구'), '11530': ('서울특별시', '구로구'), '11545': ('서울특별시', '금천구'),
    '11560': ('서울특별시', '영등포구'), '11590': ('서울특별시', '동작구'), '11620': ('서울특별시', '관악구'),
    '11650': ('서울특별시', '서초구'), '11680': ('서울특별시', '강남구'), '11710': ('서울특별시', '송파구'),
    '11740': ('서울특별시', '강동구'),
    '41111': ('경기도', '수원장안구'), '41113': ('경기도', '수원권선구'), '41115': ('경기도', '수원팔달구'), '41117': ('경기도', '수원영통구'),
    '41131': ('경기도', '성남수정구'), '41133': ('경기도', '성남중원구'), '41135': ('경기도', '성남분당구'),
    '41150': ('경기도', '의정부시'), '41171': ('경기도', '안양만안구'), '41173': ('경기도', '안양동안구'),
    '41190': ('경기도', '부천시'), '41210': ('경기도', '광명시'), '41220': ('경기도', '평택시'), '41250': ('경기도', '동두천시'),
    '41271': ('경기도', '안산상록구'), '41273': ('경기도', '안산단원구'),
    '41281': ('경기도', '고양덕양구'), '41285': ('경기도', '고양일산동구'), '41287': ('경기도', '고양일산서구'),
    '41290': ('경기도', '과천시'), '41310': ('경기도', '구리시'), '41360': ('경기도', '남양주시'), '41370': ('경기도', '오산시'),
    '41390': ('경기도', '시흥시'), '41410': ('경기도', '군포시'), '41430': ('경기도', '의왕시'), '41450': ('경기도', '하남시'),
    '41461': ('경기도', '용인처인구'), '41463': ('경기도', '용인기흥구'), '41465': ('경기도', '용인수지구'),
    '41480': ('경기도', '파주시'), '41500': ('경기도', '이천시'), '41550': ('경기도', '안성시'), '41570': ('경기도', '김포시'),
    '41590': ('경기도', '화성시'), '41610': ('경기도', '광주시'), '41630': ('경기도', '양주시'), '41650': ('경기도', '포천시'),
    '28110': ('인천광역시', '중구'), '28140': ('인천광역시', '동구'), '28177': ('인천광역시', '미추홀구'), '28185': ('인천광역시', '연수구'),
    '28200': ('인천광역시', '남동구'), '28237': ('인천광역시', '부평구'), '28245': ('인천광역시', '계양구'), '28260': ('인천광역시', '서구')
}

today = datetime.now()
months = [today.strftime('%Y%m'), (today.replace(day=1) - timedelta(days=1)).strftime('%Y%m')]

def fetch_data(url_type, lawd_cd, sido, sigungu, ymd):
    base_url = "https://openapi.molit.go.kr/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/"
    endpoint = "getRTMSDataSvcAptTradeDev" if url_type == 'trade' else "getRTMSDataSvcAptRentDev"
    url = f"{base_url}{endpoint}?serviceKey={API_KEY}&LAWD_CD={lawd_cd}&DEAL_YMD={ymd}"
    try:
        res = requests.get(url, timeout=15, verify=False)
        root = ET.fromstring(res.content)
        items = []
        for item in root.findall('.//item'):
            d = {c.tag: c.text.strip() if c.text else '' for c in item}
            if url_type == 'rent' and d.get('전월세구분') != '전세': continue
            d['시도'] = sido
            d['시군구'] = sigungu
            d['법정동'] = d.get('법정동', '').strip()
            items.append(d)
        return items
    except: return []

all_t, all_r = [], []
print("매매 및 전세 데이터를 수집합니다...")
for code, (sido, sigungu) in DISTRICT_MAP.items():
    for m in months:
        all_t.extend(fetch_data('trade', code, sido, sigungu, m))
        all_r.extend(fetch_data('rent', code, sido, sigungu, m))
        time.sleep(0.3)

if all_t:
    dt = pd.DataFrame(all_t)
    dr = pd.DataFrame(all_r)
    
    dt['아파트'] = dt['아파트'].str.strip()
    dt['거래금액_n'] = dt['거래금액'].str.replace(',', '').astype(float)
    dt['면적_r'] = dt['전용면적'].astype(float).round(1)
    
    if not dr.empty:
        dr['아파트'] = dr['아파트'].str.strip()
        dr['보증금'] = dr['보증금액'].str.replace(',', '').astype(float)
        dr['면적_r'] = dr['전용면적'].astype(float).round(1)
        # 완벽한 병합을 위해 시도, 시군구, 법정동, 아파트, 면적을 모두 Key로 사용
        dr_avg = dr.groupby(['시도', '시군구', '법정동', '아파트', '면적_r'])['보증금'].mean().reset_index()
        df = pd.merge(dt, dr_avg, on=['시도', '시군구', '법정동', '아파트', '면적_r'], how='left')
        df['보증금'] = df['보증금'].fillna(0)
    else:
        df = dt
        df['보증금'] = 0
        
    df['갭'] = df['거래금액_n'] - df['보증금']
    df['전세가율'] = (df['보증금'] / df['거래금액_n'] * 100).round(1)
    
    df = df.drop_duplicates()
    df.to_csv('apt_trade_data.csv', index=False, encoding='utf-8-sig')
    print(f"완료! 갭/전세가율 포함 총 {len(df)}건 저장.")
