import requests
import pandas as pd
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

# 설정
API_KEY = '4dc9ae5186b8259cfa06a26e9aa19e5c2758fb51804d6a48165b7f8ae499d50a'
DISTRICT_CODES = {'성동구': '11200', '광진구': '11215', '중랑구': '11260'}

# 이번 달과 지난달 구하기
today = datetime.now()
months_to_fetch = [
    today.strftime('%Y%m'),                            # 이번 달 (202604)
    (today.replace(day=1) - timedelta(days=1)).strftime('%Y%m')  # 지난 달 (202603)
]

def fetch_land_data(lawd_cd, deal_ymd):
    url = 'http://openapi.molit.go.kr/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/getRTMSDataSvcAptTradeDev'
    params = {'serviceKey': API_KEY, 'LAWD_CD': lawd_cd, 'DEAL_YMD': deal_ymd}
    try:
        response = requests.get(url, params=params)
        # 응답이 정상인지 확인
        if response.status_code != 200:
            return []
            
        root = ET.fromstring(response.content)
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
    for month in months_to_fetch:
        print(f"{name} {month} 수집 중...")
        all_data.extend(fetch_land_data(code, month))

if all_data:
    df = pd.DataFrame(all_data)
    # 중복 제거 (데이터가 겹칠 수 있으므로)
    df = df.drop_duplicates()
    df.to_csv('apt_trade_data.csv', index=False, encoding='utf-8-sig')
    print(f"성공! 총 {len(df)}건의 데이터를 저장했습니다.")
else:
    # 데이터가 없을 경우 에러 방지를 위해 빈 파일이라도 생성
    df = pd.DataFrame(columns=['아파트', '금액', '년', '월', '일']) 
    df.to_csv('apt_trade_data.csv', index=False, encoding='utf-8-sig')
    print("수집된 데이터가 없어 빈 파일을 생성했습니다.")
