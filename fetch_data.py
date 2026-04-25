import requests
import pandas as pd
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import time
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

API_KEY = '4dc9ae5186b8259cfa06a26e9aa19e5c2758fb51804d6a48165b7f8ae499d50a'

DISTRICT_CODES = {
    '종로구': '11110', '중구': '11140', '용산구': '11170', '성동구': '11200', '광진구': '11215', '동대문구': '11230', '중랑구': '11260', '성북구': '11290', '강북구': '11305', '도봉구': '11320', '노원구': '11350', '은평구': '11380', '서대문구': '11410', '마포구': '11440', '양천구': '11470', '강서구': '11500', '구로구': '11530', '금천구': '11545', '영등포구': '11560', '동작구': '11590', '관악구': '11620', '서초구': '11650', '강남구': '11680', '송파구': '11710', '강동구': '11740',
    '수원': '41110', '성남': '41130', '의정부': '41150', '안양': '41170', '부천': '41190', '광명': '41210', '평택': '41220', '동두천': '41250', '안산': '41270', '고양': '41280', '과천': '41290', '구리': '41310', '남양주': '41360', '오산': '41370', '시흥': '41390', '군포': '41410', '의왕': '41430', '하남': '41450', '용인': '41460', '파주': '41480', '이천': '41500', '안성': '41550', '김포': '41570', '화성': '41590', '광주': '41610', '양주': '41630', '포천': '41650', '여주': '41670', '연천': '41800', '가평': '41820', '양평': '41830',
    '인천중구': '28110', '인천동구': '28140', '인천미추홀': '28177', '인천연수': '28185', '인천남동': '28200', '인천부평': '28237', '인천계양': '28245', '인천서구': '28260'
}

today = datetime.now()
months = [today.strftime('%Y%m'), (today.replace(day=1) - timedelta(days=1)).strftime('%Y%m')]

def fetch_data(url_type, lawd_cd, ymd):
    base_url = "https://openapi.molit.go.kr/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/"
    endpoint = "getRTMSDataSvcAptTradeDev" if url_type == 'trade' else "getRTMSDataSvcAptRentDev"
    url = f"{base_url}{endpoint}?serviceKey={API_KEY}&LAWD_CD={lawd_cd}&DEAL_YMD={ymd}"
    try:
        res = requests.get(url, timeout=15, verify=False)
        root = ET.fromstring(res.content)
        return [{c.tag: c.text.strip() if c.text else '' for c in item} for item in root.findall('.//item')]
    except: return []

all_t, all_r = [], []
for name, code in DISTRICT_CODES.items():
    for m in months:
        all_t.extend(fetch_data('trade', code, m))
        all_r.extend(fetch_data('rent', code, m))
        time.sleep(0.3)

if all_t:
    dt, dr = pd.DataFrame(all_t), pd.DataFrame(all_r)
    dt['아파트'] = dt['아파트'].str.strip()
    dt['거래금액_n'] = dt['거래금액'].str.replace(',', '').astype(float)
    dt['면적_r'] = dt['전용면적'].astype(float).round(1)
    
    if not dr.empty:
        dr['아파트'] = dr['아파트'].str.strip()
        dr['보증금'] = dr['보증금액'].str.replace(',', '').astype(float)
        dr['면적_r'] = dr['전용면적'].astype(float).round(1)
        dr_avg = dr[dr['전월세구분']=='전세'].groupby(['시군구', '아파트', '면적_r'])['보증금'].mean().reset_index()
        df = pd.merge(dt, dr_avg, on=['시군구', '아파트', '면적_r'], how='left').fillna(0)
    else:
        df = dt; df['보증금'] = 0
    
    df['갭'] = df['거래금액_n'] - df['보증금']
    df['전세가율'] = (df['보증금'] / df['거래금액_n'] * 100).round(1)
    # 시군구 컬럼을 반드시 포함하여 저장
    df.to_csv('apt_trade_data.csv', index=False, encoding='utf-8-sig')
    print(f"완료: {len(df)}건")
