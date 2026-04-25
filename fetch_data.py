import requests
import pandas as pd
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import time
import sys

# 일반 인증키(Decoding)
API_KEY = '4dc9ae5186b8259cfa06a26e9aa19e5c2758fb51804d6a48165b7f8ae499d50a'

# 수도권 전체 법정동 코드
DISTRICT_CODES = {
    '종로구': '11110', '중구': '11140', '용산구': '11170', '성동구': '11200', '광진구': '11215', '동대문구': '11230', '중랑구': '11260', '성북구': '11290', '강북구': '11305', '도봉구': '11320', '노원구': '11350', '은평구': '11380', '서대문구': '11410', '마포구': '11440', '양천구': '11470', '강서구': '11500', '구로구': '11530', '금천구': '11545', '영등포구': '11560', '동작구': '11590', '관악구': '11620', '서초구': '11650', '강남구': '11680', '송파구': '11710', '강동구': '11740',
    '수원장안': '41111', '수원권선': '41113', '수원팔달': '41115', '수원영통': '41117', '성남수정': '41131', '성남중원': '41133', '성남분당': '41135', '의정부': '41150', '안양만안': '41171', '안양동안': '41173', '부천': '41190', '광명': '41210', '평택': '41220', '안산상록': '41271', '안산단원': '41273', '고양덕양': '41281', '고양일산동': '41285', '고양일산서': '41287', '과천': '41290', '구리': '41310', '남양주': '41360', '오산': '41370', '시흥': '41390', '군포': '41410', '의왕': '41430', '하남': '41450', '용인처인': '41461', '용인기흥': '41463', '용인수지': '41465', '파주': '41480', '이천': '41500', '안성': '41550', '김포': '41570', '화성': '41590', '광주': '41610',
    '인천중구': '28110', '인천동구': '28140', '인천미추홀': '28177', '인천연수': '28185', '인천남동': '28200', '인천부평': '28237', '인천계양': '28245', '인천서구': '28260'
}

today = datetime.now()
months_to_fetch = [
    today.strftime('%Y%m'),
    (today.replace(day=1) - timedelta(days=1)).strftime('%Y%m')
]

# 연속 실패 횟수를 체크하기 위한 변수
consecutive_errors = 0

def fetch_land_data(lawd_cd, deal_ymd):
    global consecutive_errors
    # http -> https 로 변경
    url = f"https://openapi.molit.go.kr/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/getRTMSDataSvcAptTradeDev?serviceKey={API_KEY}&LAWD_CD={lawd_cd}&DEAL_YMD={deal_ymd}"
    try:
        # verify=False 를 추가해 공공기관 인증서 오류 무시
        response = requests.get(url, timeout=10, verify=False)
        root = ET.fromstring(response.content)
        
        result_code = root.find('.//resultCode')
        if result_code is not None and result_code.text != '00':
            return []
            
        items = []
        for item in root.findall('.//item'):
            data = {child.tag: child.text.strip() if child.text else '' for child in item}
            data['지역코드'] = lawd_cd 
            items.append(data)
            
        consecutive_errors = 0 # 성공하면 에러 카운트 초기화
        return items
        
    except requests.exceptions.RequestException as e:
        print(f"네트워크/서버 오류 발생 ({lawd_cd}): {e}")
        consecutive_errors += 1
        return []
    except Exception as e:
        print(f"데이터 파싱 오류 ({lawd_cd}): {e}")
        return []

all_data = []
print("데이터 수집을 시작합니다. (약 3~5분 소요 예상)")
for name, code in DISTRICT_CODES.items():
    if consecutive_errors >= 5:
        print("🚨 공공데이터 서버 응답이 5회 연속 실패했습니다. 서버 점검 중일 확률이 높으므로 스크립트를 강제 종료합니다.")
        break # 서버가 죽었을 때 불필요한 반복 방지
        
    for month in months_to_fetch:
        all_data.extend(fetch_land_data(code, month))
        time.sleep(0.5)

if all_data:
    df = pd.DataFrame(all_data)
    df = df.drop_duplicates()
    df.to_csv('apt_trade_data.csv', index=False, encoding='utf-8-sig')
    print(f"성공! 총 {len(df)}건의 데이터를 저장했습니다.")
else:
    print("수집된 데이터가 없습니다.")
    df = pd.DataFrame(columns=['아파트', '거래금액', '년', '월', '일', '법정동', '지역코드']) 
    df.to_csv('apt_trade_data.csv', index=False, encoding='utf-8-sig')

def fetch_rent_data(lawd_cd, deal_ymd):
    # API 엔드포인트가 'AptRentDev'로 다릅니다.
    url = f"https://openapi.molit.go.kr/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/getRTMSDataSvcAptRentDev?serviceKey={API_KEY}&LAWD_CD={lawd_cd}&DEAL_YMD={deal_ymd}"
    
    try:
        response = requests.get(url, timeout=10, verify=False)
        root = ET.fromstring(response.content)
        
        items = []
        for item in root.findall('.//item'):
            data = {child.tag: child.text.strip() if child.text else '' for child in item}
            
            # 🎯 '전세' 데이터만 필터링 (월세 제외)
            if data.get('전월세구분') == '전세':
                data['지역코드'] = lawd_cd
                items.append(data)
        return items
    except Exception as e:
        return []

# ---------------------------------------------------------
# [데이터 병합 및 가공 로직] - pandas 활용
# ---------------------------------------------------------
# 1. 매매 데이터프레임(df_trade)과 전세 데이터프레임(df_rent) 생성
# 2. 전세 데이터는 같은 아파트/면적이라도 여러 건이므로 '최근 전세가 평균'을 구합니다.
df_rent_avg = df_rent.groupby(['법정동', '단지명', '전용면적(㎡)'])['보증금액'].mean().reset_index()

# 3. 매매 데이터에 전세 데이터를 병합 (Merge)
merged_df = pd.merge(
    df_trade, 
    df_rent_avg, 
    how='left', 
    left_on=['법정동', '단지명', '전용면적(㎡)'], 
    right_on=['법정동', '단지명', '전용면적(㎡)']
)

# 4. 갭(Gap)과 전세가율 계산
# 보증금액이 있는(매칭된) 데이터만 계산
merged_df['전세가'] = merged_df['보증금액'].fillna(0)
merged_df['갭_금액'] = merged_df['거래금액'] - merged_df['전세가']
merged_df['전세가율'] = (merged_df['전세가'] / merged_df['거래금액']) * 100

# 최종 apt_trade_data.csv 에 '전세가', '갭_금액', '전세가율' 컬럼이 추가되어 저장됨
