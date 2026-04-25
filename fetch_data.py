import requests
import pandas as pd
import xml.etree.ElementTree as ET
from datetime import datetime

# 설정
API_KEY = '4dc9ae5186b8259cfa06a26e9aa19e5c2758fb51804d6a48165b7f8ae499d50a'
DISTRICT_CODES = {'성동구': '11200', '광진구': '11215', '중랑구': '11260'}
CURRENT_MONTH = datetime.now().strftime('%Y%m') # 예: 202405

def fetch_land_data(lawd_cd, deal_ymd):
    url = 'http://openapi.molit.go.kr/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/getRTMSDataSvcAptTradeDev'
    params = {
        'serviceKey': API_KEY,
        'LAWD_CD': lawd_cd,
        'DEAL_YMD': deal_ymd
    }
    
    try:
        response = requests.get(url, params=params)
        root = ET.fromstring(response.text)
        
        items = []
        for item in root.findall('.//item'):
            data = {child.tag: child.text.strip() if child.text else '' for child in item}
            items.append(data)
        return items
    except Exception as e:
        print(f"Error fetching data for {lawd_cd}: {e}")
        return []

all_data = []
for name, code in DISTRICT_CODES.items():
    print(f"{name} 데이터 수집 중...")
    data = fetch_land_data(code, CURRENT_MONTH)
    all_data.extend(data)

if all_data:
    df = pd.DataFrame(all_data)
    # 파일 저장 (기존 데이터에 덮어쓰거나 새로 생성)
    df.to_csv('apt_trade_data.csv', index=False, encoding='utf-8-sig')
    print(f"성공적으로 {len(df)}건의 데이터를 저장했습니다.")
else:
    print("수집된 데이터가 없습니다.")
