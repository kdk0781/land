import requests
import pandas as pd
import xml.etree.ElementTree as ET
from datetime import datetime

# 설정
API_KEY = '4dc9ae5186b8259cfa06a26e9aa19e5c2758fb51804d6a48165b7f8ae499d50a'
DISTRICT_CODES = {'성동구': '11200', '광진구': '11215', '중랑구': '11260'}
CURRENT_MONTH = datetime.now().strftime('%Y%m')

def fetch_land_data(lawd_cd, deal_ymd):
    url = 'http://openapi.molit.go.kr/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/getRTMSDataSvcAptTradeDev'
    params = {'serviceKey': API_KEY, 'LAWD_CD': lawd_cd, 'DEAL_YMD': deal_ymd}
    try:
        response = requests.get(url, params=params)
        root = ET.fromstring(response.content) # response.text 대신 content 사용 (인코딩 방지)
        items = []
        for item in root.findall('.//item'):
            data = {child.tag: child.text.strip() if child.text else '' for child in item}
            items.append(data)
        return items
    except Exception as e:
        print(f"Error: {e}")
        return []

all_data = []
for name, code in DISTRICT_CODES.items():
    print(f"{name} 수집 중...")
    all_data.extend(fetch_land_data(code, CURRENT_MONTH))

if all_data:
    df = pd.DataFrame(all_data)
    df.to_csv('apt_trade_data.csv', index=False, encoding='utf-8-sig')
    print(f"성공! {len(df)}건 저장됨.")
