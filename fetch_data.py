import requests
import pandas as pd
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import time

# 일반 인증키(Decoding)를 사용해야 합니다.
API_KEY = '4dc9ae5186b8259cfa06a26e9aa19e5c2758fb51804d6a48165b7f8ae499d50a'

# 우선 빠른 테스트를 위해 3곳만 진행
DISTRICT_CODES = {'성동구': '11200', '광진구': '11215', '중랑구': '11260'}

today = datetime.now()
months_to_fetch = [
    today.strftime('%Y%m'),
    (today.replace(day=1) - timedelta(days=1)).strftime('%Y%m')
]

def fetch_land_data(lawd_cd, deal_ymd):
    # params를 쓰지 않고 URL에 직접 텍스트로 박아넣음 (이중 인코딩 에러 원천 차단)
    url = f"http://openapi.molit.go.kr/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/getRTMSDataSvcAptTradeDev?serviceKey={API_KEY}&LAWD_CD={lawd_cd}&DEAL_YMD={deal_ymd}"
    
    try:
        print(f"요청 URL: {url[:100]}... (보안상 생략)")
        response = requests.get(url, timeout=10)
        
        # 서버가 에러 메시지를 보냈는지 텍스트 출력 확인
        if 'SERVICE ERROR' in response.text or '<resultCode>' in response.text:
            print(f"서버 응답 내용:\n{response.text[:300]}")
            
        root = ET.fromstring(response.content)
        
        result_code = root.find('.//resultCode')
        if result_code is not None and result_code.text != '00':
            print(f"API Error ({lawd_cd}): {root.find('.//resultMsg').text}")
            return []
            
        items = []
        for item in root.findall('.//item'):
            data = {child.tag: child.text.strip() if child.text else '' for child in item}
            data['지역코드'] = lawd_cd
            items.append(data)
        return items
    except Exception as e:
        print(f"Error fetching {lawd_cd}: {e}")
        return []

all_data = []
for name, code in DISTRICT_CODES.items():
    for month in months_to_fetch:
        print(f"[{name} / {month}] 데이터 수집 시작...")
        all_data.extend(fetch_land_data(code, month))
        time.sleep(1) # 국토부 서버 과부하 방지 (1초 대기)

if all_data:
    df = pd.DataFrame(all_data)
    df = df.drop_duplicates()
    df.to_csv('apt_trade_data.csv', index=False, encoding='utf-8-sig')
    print(f"성공! 총 {len(df)}건의 데이터를 저장했습니다.")
else:
    print("수집된 데이터가 없습니다. 공공데이터포털 API 승인 지연 또는 키 오류입니다.")
    df = pd.DataFrame(columns=['아파트', '거래금액', '년', '월', '일', '법정동', '지역코드']) 
    df.to_csv('apt_trade_data.csv', index=False, encoding='utf-8-sig')
