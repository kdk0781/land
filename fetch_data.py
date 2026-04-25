import requests
import pandas as pd
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import time

# 설정
API_KEY = '4dc9ae5186b8259cfa06a26e9aa19e5c2758fb51804d6a48165b7f8ae499d50a'

# 수도권 전체 법정동 코드 (서울, 경기 주요, 인천)
DISTRICT_CODES = {
    # 서울 (25개구)
    '종로구': '11110', '중구': '11140', '용산구': '11170', '성동구': '11200', '광진구': '11215', '동대문구': '11230', '중랑구': '11260', '성북구': '11290', '강북구': '11305', '도봉구': '11320', '노원구': '11350', '은평구': '11380', '서대문구': '11410', '마포구': '11440', '양천구': '11470', '강서구': '11500', '구로구': '11530', '금천구': '11545', '영등포구': '11560', '동작구': '11590', '관악구': '11620', '서초구': '11650', '강남구': '11680', '송파구': '11710', '강동구': '11740',
    # 경기 주요 (너무 외곽이거나 데이터가 적은 군 단위 제외)
    '수원장안': '41111', '수원권선': '41113', '수원팔달': '41115', '수원영통': '41117', '성남수정': '41131', '성남중원': '41133', '성남분당': '41135', '의정부': '41150', '안양만안': '41171', '안양동안': '41173', '부천': '41190', '광명': '41210', '평택': '41220', '안산상록': '41271', '안산단원': '41273', '고양덕양': '41281', '고양일산동': '41285', '고양일산서': '41287', '과천': '41290', '구리': '41310', '남양주': '41360', '오산': '41370', '시흥': '41390', '군포': '41410', '의왕': '41430', '하남': '41450', '용인처인': '41461', '용인기흥': '41463', '용인수지': '41465', '파주': '41480', '이천': '41500', '안성': '41550', '김포': '41570', '화성': '41590', '광주': '41610',
    # 인천
    '인천중구': '28110', '인천동구': '28140', '인천미추홀': '28177', '인천연수': '28185', '인천남동': '28200', '인천부평': '28237', '인천계양': '28245', '인천서구': '28260'
}

today = datetime.now()
months_to_fetch = [
    today.strftime('%Y%m'),
    (today.replace(day=1) - timedelta(days=1)).strftime('%Y%m')
]

def fetch_land_data(lawd_cd, deal_ymd):
    url = 'http://openapi.molit.go.kr/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/getRTMSDataSvcAptTradeDev'
    params = {'serviceKey': API_KEY, 'LAWD_CD': lawd_cd, 'DEAL_YMD': deal_ymd}
    try:
        response = requests.get(url, params=params, timeout=10)
        root = ET.fromstring(response.content)
        
        # 공공데이터 API 에러 체크 로직 추가
        result_code = root.find('.//resultCode')
        if result_code is not None and result_code.text != '00':
            print(f"API Error ({lawd_cd}): {root.find('.//resultMsg').text}")
            return []
            
        items = []
        for item in root.findall('.//item'):
            data = {child.tag: child.text.strip() if child.text else '' for child in item}
            data['지역코드'] = lawd_cd  # 데이터에 지역코드 강제 삽입
            items.append(data)
        return items
    except Exception as e:
        print(f"Error fetching {lawd_cd}: {e}")
        return []

all_data = []
for name, code in DISTRICT_CODES.items():
    for month in months_to_fetch:
        print(f"{name} {month} 수집 중...")
        all_data.extend(fetch_land_data(code, month))
        time.sleep(0.3) # API 서버 과부하 방지를 위한 0.3초 대기

if all_data:
    df = pd.DataFrame(all_data)
    df = df.drop_duplicates()
    df.to_csv('apt_trade_data.csv', index=False, encoding='utf-8-sig')
    print(f"성공! 총 {len(df)}건의 데이터를 저장했습니다.")
else:
    print("수집된 데이터가 없습니다. API 키나 로그를 확인하세요.")
    # 오류 방지를 위한 최소한의 빈 파일 생성
    df = pd.DataFrame(columns=['아파트', '거래금액', '년', '월', '일', '법정동', '지역코드']) 
    df.to_csv('apt_trade_data.csv', index=False, encoding='utf-8-sig')
