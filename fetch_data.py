import requests
import pandas as pd
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import time
import urllib3

# 공공기관 API SSL 인증서 경고 무시
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

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

# 1. 매매 데이터 수집 함수
def fetch_trade_data(lawd_cd, deal_ymd):
    url = f"https://openapi.molit.go.kr/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/getRTMSDataSvcAptTradeDev?serviceKey={API_KEY}&LAWD_CD={lawd_cd}&DEAL_YMD={deal_ymd}"
    try:
        response = requests.get(url, timeout=10, verify=False)
        root = ET.fromstring(response.content)
        items = []
        for item in root.findall('.//item'):
            data = {child.tag: child.text.strip() if child.text else '' for child in item}
            data['지역코드'] = lawd_cd 
            items.append(data)
        return items
    except: return []

# 2. 전월세 데이터 수집 함수 (전세만 필터링)
def fetch_rent_data(lawd_cd, deal_ymd):
    url = f"https://openapi.molit.go.kr/OpenAPI_ToolInstallPackage/service/rest/RTMSOBJSvc/getRTMSDataSvcAptRentDev?serviceKey={API_KEY}&LAWD_CD={lawd_cd}&DEAL_YMD={deal_ymd}"
    try:
        response = requests.get(url, timeout=10, verify=False)
        root = ET.fromstring(response.content)
        items = []
        for item in root.findall('.//item'):
            data = {child.tag: child.text.strip() if child.text else '' for child in item}
            if data.get('전월세구분') == '전세': # 전세만 가져오기
                data['지역코드'] = lawd_cd
                items.append(data)
        return items
    except: return []

# --- 데이터 수집 실행 ---
all_trade_data = []
all_rent_data = []

print("데이터 수집을 시작합니다. (매매/전세 동시 수집으로 약 5~10분 소요)")
for name, code in DISTRICT_CODES.items():
    for month in months_to_fetch:
        all_trade_data.extend(fetch_trade_data(code, month))
        all_rent_data.extend(fetch_rent_data(code, month))
        time.sleep(0.5) # 서버 과부하 방지

# --- 데이터 가공 및 병합 (Merge) ---
if all_trade_data:
    df_trade = pd.DataFrame(all_trade_data)
    df_rent = pd.DataFrame(all_rent_data) if all_rent_data else pd.DataFrame()

    # 데이터 정리 (공백 제거 및 숫자 변환)
    df_trade['아파트'] = df_trade['아파트'].str.strip()
    df_trade['법정동'] = df_trade['법정동'].str.strip()
    df_trade['거래금액_num'] = df_trade['거래금액'].str.replace(',', '').astype(float)
    df_trade['전용면적_round'] = df_trade['전용면적'].astype(float).round(1) # 면적 소수점 1자리 통일

    if not df_rent.empty:
        df_rent['아파트'] = df_rent['아파트'].str.strip()
        df_rent['법정동'] = df_rent['법정동'].str.strip()
        df_rent['보증금액'] = df_rent['보증금액'].str.replace(',', '').astype(float)
        df_rent['전용면적_round'] = df_rent['전용면적'].astype(float).round(1)
        
        # 동일 아파트/면적의 최근 전세가 평균 구하기
        df_rent_avg = df_rent.groupby(['법정동', '아파트', '전용면적_round'])['보증금액'].mean().reset_index()
        
        # 매매 데이터에 전세 데이터 병합 (Left Join)
        merged_df = pd.merge(df_trade, df_rent_avg, how='left', on=['법정동', '아파트', '전용면적_round'])
    else:
        merged_df = df_trade
        merged_df['보증금액'] = 0

    # 갭(Gap) 및 전세가율 계산
    merged_df['전세가'] = merged_df['보증금액'].fillna(0)
    merged_df['갭_금액'] = merged_df['거래금액_num'] - merged_df['전세가']
    merged_df['전세가율'] = merged_df.apply(lambda x: (x['전세가'] / x['거래금액_num'] * 100) if x['거래금액_num'] > 0 else 0, axis=1)

    # 필요 없는 임시 컬럼 삭제
    merged_df = merged_df.drop(columns=['전용면적_round', '보증금액', '거래금액_num'])
    merged_df = merged_df.drop_duplicates()

    # 최종 CSV 저장
    merged_df.to_csv('apt_trade_data.csv', index=False, encoding='utf-8-sig')
    print(f"🎉 성공! 총 {len(merged_df)}건의 갭투자 병합 데이터를 저장했습니다.")
else:
    print("수집된 데이터가 없습니다.")
