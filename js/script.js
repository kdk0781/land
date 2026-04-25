'use strict';

// ═══ 상태 ════════════════════════════════════════════
let allData     = [];   // 실거래 데이터
let kbMap       = {};   // KB시세 맵 { "아파트명||전용면적반올림" → {하한가,일반거래가,상한가} }
let currentMode = 'latest';
let currentRegStatus = '비규제지역';
let currentKbPrice   = 0;   // 현재 모달의 KB일반거래가
let activeModalTab   = 'loan';

// ═══ 규제지역 (2025.10.16 10.15대책 이후 기준) ════════
// 투기과열지구 = 조정대상지역 동시 지정
// ▶ 서울특별시 전역 (25개 구)
// ▶ 경기도 12개: 과천시·광명시·의왕시·하남시·
//   성남(분당·수정·중원)·수원(영통·장안·팔달)·안양동안·용인수지

// 서울 전체를 투기과열로 처리 (별도 구 지정 불필요)
const REG_SEOUL = true; // 서울 전역

// 경기도 투기과열 12개 지역 (fetch_data.py DISTRICT_MAP의 sigungu 기준)
const REG_GU_SPEC = new Set([
    '과천시',
    '광명시',
    '의왕시',
    '하남시',
    '성남수정구',
    '성남중원구',
    '성남분당구',
    '수원장안구',
    '수원팔달구',   // 수원권선구는 비규제
    '수원영통구',
    '안양동안구',   // 안양만안구는 비규제
    '용인수지구',   // 용인처인구·기흥구는 비규제
]);

// 규제 등급 반환
// 'SPEC'  : 투기과열지구+조정대상지역 → LTV 40%
// 'NONE'  : 비규제 → LTV 70%
function getRegGrade(sido, sigungu) {
    if (sido === '서울특별시') return 'SPEC';
    if (sido === '경기도' && REG_GU_SPEC.has(sigungu)) return 'SPEC';
    return 'NONE';
}

function getRegStatus(sido, sigungu) {
    return getRegGrade(sido, sigungu) === 'SPEC' ? '투기과열지구' : '비규제지역';
}

// ═══ 중개수수료 요율표 ════════════════════════════════
const BROKER_TABLE = [
    { max: 5000,     rate: .006, maxFee: 250000  },
    { max: 20000,    rate: .005, maxFee: 800000  },
    { max: 90000,    rate: .004, maxFee: null     },
    { max: 120000,   rate: .005, maxFee: null     },
    { max: 150000,   rate: .006, maxFee: null     },
    { max: Infinity, rate: .007, maxFee: null     },
];

// ═══ 초기화 ══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadAllData();
});

// ═══ 로더 헬퍼 ═══════════════════════════════════════
function setLoader(text) {
    const el = document.querySelector('.loader-text');
    if (el) el.textContent = text;
}
function hideLoader() {
    const el = document.getElementById('loader');
    if (el) el.style.display = 'none';
}

// ═══ 데이터 병렬 로드 ════════════════════════════════
function loadAllData() {
    // 30초 안전장치
    const guard = setTimeout(() => {
        hideLoader();
        showEmpty('⏱ 로딩 시간 초과. CSV 파일이 같은 폴더에 있는지 확인하세요.');
    }, 30000);

    setLoader('실거래 데이터 로드 중...');

    const tradePromise = loadCsvChunk('apt_trade_data.csv');
    const kbPromise    = loadCsvChunk('map.csv');

    Promise.all([tradePromise, kbPromise])
        .then(([tradeRows, kbRows]) => {
            clearTimeout(guard);

            // ── 실거래 데이터 처리 ──
            setLoader('실거래 데이터 처리 중...');
            allData = tradeRows
                .filter(r => getField(r, '아파트') && getField(r, '거래금액_n'))
                .map(r => {
                    const sidoRaw = getField(r, 'sido') || '미분류';
                    const sigungu = getField(r, 'sigungu') || '';
                    const dong    = getField(r, 'dong')    || '';
                    const price   = parseFloat(getField(r, '거래금액_n'));
                    const area    = parseFloat(getField(r, '전용면적'));
                    const pyung   = area / 3.3058;
                    return {
                        ...r,
                        price,
                        pyung:       pyung.toFixed(1),
                        pyungPrice:  Math.round(price / pyung),
                        areaRound:   Math.round(area),
                        sido:        sidoRaw,
                        sigungu,
                        dong,
                        gudong:      `${sigungu} ${dong}`.trim(),
                        regStatus:   getRegStatus(sidoRaw, sigungu),
                        gap:         parseFloat(getField(r, 'gap')         || 0),
                        jeonseRatio: parseFloat(getField(r, 'jeonseRatio') || 0),
                        jeonsePrice: parseFloat(getField(r, 'jeonsePrice') || 0),
                        아파트:      getField(r, '아파트') || '',
                        전용면적:    getField(r, '전용면적') || '',
                        층:          getField(r, '층') || '',
                        계약년월:    getField(r, '계약년월') || '',
                        계약일:      getField(r, '계약일') || '',
                    };
                });

            // ── KB 시세 처리 ──
            setLoader('KB 시세 데이터 처리 중...');
            kbRows.forEach(r => {
                // map.csv 컬럼: sido,sigungu,dong,apt,type1,area,type2,pyung,하한가,일반거래가,상한가
                const aptName = getField(r, 'apt') || getField(r, '아파트');
                const area    = parseFloat(getField(r, 'area') || getField(r, '전용면적') || 0);
                const lowStr  = getField(r, '하한가')    || '0';
                const midStr  = getField(r, '일반거래가') || '0';
                const highStr = getField(r, '상한가')    || '0';

                if (!aptName || !area) return;

                const toNum = s => parseFloat(String(s).replace(/,/g,'')) || 0;
                const key = `${aptName.trim()}||${Math.round(area)}`;
                // 동일 아파트 여러 평형 → 모두 저장 (배열)
                if (!kbMap[key]) kbMap[key] = [];
                kbMap[key].push({
                    하한가:    toNum(lowStr),
                    일반거래가: toNum(midStr),
                    상한가:    toNum(highStr),
                    area,
                });
            });

            const kbCount = Object.keys(kbMap).length;
            document.getElementById('kb-status').textContent = `KB 시세 ${kbCount.toLocaleString()}건 ✓`;
            document.getElementById('kb-status').className = 'kb-status loaded';

            initSidoSelect();
            updateStats();
            document.getElementById('total-count').textContent = allData.length.toLocaleString();
            hideLoader();
            renderList();
        })
        .catch(err => {
            clearTimeout(guard);
            hideLoader();
            showEmpty(`❌ 로드 실패: ${err.message}\n\napt_trade_data.csv와 map.csv가 index.html과 같은 폴더에 있어야 합니다.`);
        });
}

// ── chunk 방식 CSV 로드 (Call Stack 안전) ──
function loadCsvChunk(path) {
    return new Promise((resolve, reject) => {
        const rows = [];
        let headers = null;

        Papa.parse(path, {
            download: true,
            header: true,
            skipEmptyLines: true,
            chunk: (results) => {
                if (!headers && results.meta.fields) headers = results.meta.fields;
                rows.push(...results.data);
            },
            complete: () => resolve(rows),
            error: (err)  => reject(new Error(err.message || `${path} 로드 실패`)),
        });
    });
}

// BOM-safe 필드 읽기
function getField(row, key) {
    if (row[key] !== undefined) return row[key];
    // BOM 붙은 경우
    const bomKey = '\uFEFF' + key;
    if (row[bomKey] !== undefined) return row[bomKey];
    return undefined;
}

// KB 시세 조회 (기본 - 아파트명+면적 매칭)
function getKbPrice(aptName, areaStr) {
    const area = parseFloat(areaStr) || 0;
    let key = `${aptName.trim()}||${Math.round(area)}`;
    if (kbMap[key] && kbMap[key].length) return kbMap[key][0];
    for (let d = 1; d <= 5; d++) {
        key = `${aptName.trim()}||${Math.round(area) + d}`;
        if (kbMap[key]) return kbMap[key][0];
        key = `${aptName.trim()}||${Math.round(area) - d}`;
        if (kbMap[key]) return kbMap[key][0];
    }
    return null;
}

// ★ 층수 반영 KB 기준가 반환
// 1층 → 하한가 (선순위 전세처럼 감가), 나머지 → 일반거래가
function getKbRefPrice(aptName, areaStr, floor) {
    const kb = getKbPrice(aptName, areaStr);
    if (!kb) return 0;
    const floorNum = parseInt(floor) || 1;
    return floorNum === 1 ? kb.하한가 : kb.일반거래가;
}

// ═══ 시도/구동 셀렉트 ════════════════════════════════
function initSidoSelect() {
    const sidos = [...new Set(allData.map(d => d.sido))].filter(s => s !== '미분류').sort();
    const sel   = document.getElementById('sido-select');
    sidos.forEach(s => {
        const o = document.createElement('option');
        o.value = s; o.textContent = s; sel.appendChild(o);
    });
}

function updateStats() {
    const prices = allData.map(d => d.price).filter(Boolean);
    if (!prices.length) return;
    const avg    = prices.reduce((a, b) => a + b, 0) / prices.length;
    const sorted = [...prices].sort((a, b) => a - b);
    const med    = sorted[Math.floor(sorted.length / 2)];
    const max    = sorted[sorted.length - 1];
    el('stat-avg').textContent = f억(avg);
    el('stat-med').textContent = f억(med);
    el('stat-max').textContent = f억(max);
}

// ═══ 이벤트 ══════════════════════════════════════════
function setupEventListeners() {
    el('sido-select').addEventListener('change', function () {
        const regSel = el('region-select');
        regSel.innerHTML = '<option value="all">구/동 전체</option>';
        regSel.disabled = (this.value === 'all');
        if (this.value !== 'all') {
            [...new Set(allData.filter(d => d.sido === this.value).map(d => d.gudong))].sort()
                .forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = g; regSel.appendChild(o); });
        }
        renderList();
    });
    el('region-select').addEventListener('change', renderList);
    el('search-input').addEventListener('input', renderList);

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentMode = this.dataset.mode;
            renderList();
        });
    });

    document.querySelectorAll('.modal-tab').forEach(t => {
        t.addEventListener('click', function () {
            document.querySelectorAll('.modal-tab').forEach(x => x.classList.remove('active'));
            this.classList.add('active');
            activeModalTab = this.dataset.tab;
            document.querySelectorAll('.modal-panel').forEach(p => p.classList.add('hidden'));
            el(`panel-${activeModalTab}`).classList.remove('hidden');
            recalcAll();
        });
    });

    ['calc-income','calc-base-rate','calc-stress','calc-first-home','calc-house-count'].forEach(id => {
        const el2 = document.getElementById(id);
        if (el2) { el2.addEventListener('input', recalcAll); el2.addEventListener('change', recalcAll); }
    });

    el('dsr-modal').addEventListener('click',     e => { if (e.target === el('dsr-modal'))     closeModal('dsr-modal'); });
    el('history-modal').addEventListener('click', e => { if (e.target === el('history-modal')) closeModal('history-modal'); });
}

// ═══ 렌더링 ══════════════════════════════════════════
function renderList() {
    const search = el('search-input').value.toLowerCase();
    const sido   = el('sido-select').value;
    const gudong = el('region-select').value;
    const grid   = el('card-grid');

    let filtered = allData.filter(d =>
        (sido   === 'all' || d.sido   === sido)   &&
        (gudong === 'all' || d.gudong === gudong) &&
        d.아파트.toLowerCase().includes(search)
    );

    if (!filtered.length) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-msg">검색 결과가 없습니다</p></div>`;
        return;
    }

    if (currentMode === 'volume') {
        const grp = {};
        filtered.forEach(d => {
            const k = `${d.sido}||${d.gudong}||${d.아파트}`;
            if (!grp[k]) grp[k] = { ...d, count: 0, maxP: 0, minP: Infinity };
            grp[k].count++;
            if (d.price > grp[k].maxP) grp[k].maxP = d.price;
            if (d.price < grp[k].minP) grp[k].minP = d.price;
        });
        grid.innerHTML = Object.values(grp).sort((a,b)=>b.count-a.count).slice(0,60).map((d,i)=>cardVolume(d,i)).join('');

    } else if (currentMode === 'gap_invest') {
        grid.innerHTML = filtered.filter(d=>d.jeonseRatio>0).sort((a,b)=>b.jeonseRatio-a.jeonseRatio)
            .slice(0,60).map((d,i)=>cardGap(d,i)).join('');

    } else if (currentMode === 'compare') {
        // KB 시세 vs 실거래가 비교 (층수 반영)
        const grp = {};
        filtered.forEach(d => {
            const kb = getKbPrice(d.아파트, d.전용면적);
            if (!kb) return;
            const k = `${d.아파트}||${d.areaRound}`;
            if (!grp[k] || d.price > grp[k].price) grp[k] = { ...d, kb };
        });
        const arr = Object.values(grp)
            .map(d => {
                const kbRef  = parseInt(d.층) === 1 ? d.kb.하한가 : d.kb.일반거래가;
                const diff   = d.price - kbRef;
                const diffPct = (diff / kbRef * 100);
                return { ...d, kbRef, diff, diffPct };
            })
            .sort((a,b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
        if (!arr.length) {
            grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><p class="empty-msg">KB 시세와 매칭되는 데이터가 없습니다.<br>지역을 좁혀서 검색해보세요.</p></div>`;
            return;
        }
        grid.innerHTML = arr.slice(0,60).map((d,i)=>cardCompare(d,i)).join('');

    } else {
        if (currentMode === 'top_price') filtered.sort((a,b)=>b.price-a.price);
        else filtered.sort((a,b)=>(b.계약년월+String(b.계약일).padStart(2,'0'))-(a.계약년월+String(a.계약일).padStart(2,'0')));
        grid.innerHTML = filtered.slice(0,60).map(d=>cardDefault(d)).join('');
    }
}

// ═══ 카드 템플릿 ══════════════════════════════════════
function regBadge(s) {
    return s === '투기과열지구'
        ? `<span class="badge badge-reg">🔴 투기과열</span>`
        : `<span class="badge badge-free">🟢 비규제</span>`;
}

// 층수에 따라 1층=하한가, 나머지=일반거래가 기준으로 칩 표시
function kbChip(tradePrice, kb, floor) {
    if (!kb) return '';
    const floorNum = parseInt(floor) || 1;
    const ref    = floorNum === 1 ? kb.하한가 : kb.일반거래가;
    const refLabel = floorNum === 1 ? 'KB하한' : 'KB일반';
    const diff   = tradePrice - ref;
    const pct    = (diff / ref * 100).toFixed(1);
    if (Math.abs(diff) < ref * 0.01) return `<span class="kb-chip neutral">${refLabel} ${f억(ref)} ≈ 비슷</span>`;
    if (diff > 0) return `<span class="kb-chip pricey">▲${pct}% vs ${refLabel}</span>`;
    return `<span class="kb-chip cheap">▼${Math.abs(pct)}% vs ${refLabel}</span>`;
}

function cardDefault(d) {
    const kb    = getKbPrice(d.아파트, d.전용면적);
    const kbRef = getKbRefPrice(d.아파트, d.전용면적, d.층);
    const ym    = String(d.계약년월);
    const date  = `${ym.slice(0,4)}.${ym.slice(4)}.${String(d.계약일).padStart(2,'0')}`;
    return `
<div class="card" onclick="openHistory('${esc(d.아파트)}','${esc(d.sido)}','${esc(d.gudong)}')">
  <div class="badge-row">
    <span class="badge badge-region">${d.sido} ${d.gudong}</span>
    ${regBadge(d.regStatus)}
    <span class="badge badge-date">${date}</span>
  </div>
  <div class="card-name">${d.아파트}</div>
  <div class="card-meta">${d.전용면적}㎡ · ${d.pyung}평 · ${d.층}층</div>
  ${kb ? `<div class="kb-compare-row">${kbChip(d.price, kb, d.층)}<span class="kb-chip neutral">${parseInt(d.층)===1?'KB하한':'KB일반'} ${f억(kbRef)}</span></div>` : ''}
  <div class="card-bottom">
    <div>
      <div class="price-main">${f억(d.price)}</div>
      <div class="price-sub">평당 ${d.pyungPrice.toLocaleString()}만</div>
    </div>
    <button class="loan-btn" onclick="event.stopPropagation();openModal2('${esc(d.아파트)}',${d.price},${kbRef},'${d.regStatus}','${d.전용면적}','${d.층}')">💰 대출 계산</button>
  </div>
</div>`;
}

function cardVolume(d, idx) {
    const kbRef = getKbRefPrice(d.아파트, d.전용면적, d.층 || '2'); // 거래량은 대표층 모르므로 일반가 기준
    return `
<div class="card card-rank ${idx<3?'top':''}" onclick="openHistory('${esc(d.아파트)}','${esc(d.sido)}','${esc(d.gudong)}')">
  <div class="badge-row">
    <span class="rank-label">${idx+1}위</span>
    <span class="vol-badge">${d.count}건</span>
  </div>
  <div class="card-name">${d.아파트}</div>
  <div class="card-meta">${d.sido} ${d.gudong}</div>
  <div class="card-bottom">
    <div>
      <div class="price-sub">최고 <b style="color:var(--red)">${f억(d.maxP)}</b></div>
      <div class="price-sub">최저 <b style="color:var(--blue)">${f억(d.minP)}</b></div>
    </div>
    <button class="loan-btn" onclick="event.stopPropagation();openModal2('${esc(d.아파트)}',${d.maxP},${kbRef},'${d.regStatus}','${d.전용면적}','2')">💰 대출 계산</button>
  </div>
</div>`;
}

function cardGap(d, idx) {
    const kb = getKbPrice(d.아파트, d.전용면적);
    return `
<div class="card" onclick="openHistory('${esc(d.아파트)}','${esc(d.sido)}','${esc(d.gudong)}')">
  <div style="position:absolute;top:0;right:0;background:var(--green);color:#fff;font-size:.58rem;font-weight:900;padding:.25rem .6rem;border-bottom-left-radius:.5rem">전세가율 ${Number(d.jeonseRatio).toFixed(1)}%</div>
  <div class="badge-row" style="margin-top:.2rem">
    <span class="badge badge-region">${d.sido} ${d.gudong}</span>
    ${regBadge(d.regStatus)}
  </div>
  <div class="card-name">${idx+1}. ${d.아파트}</div>
  <div class="card-meta">${d.전용면적}㎡ · ${d.pyung}평</div>
  ${kb ? `<div class="kb-compare-row">${kbChip(d.price,kb,d.층)}</div>` : ''}
  <div class="gap-grid">
    <div class="gap-cell"><div class="gap-cell-label">매매가</div><div class="gap-cell-value">${f억(d.price)}</div></div>
    <div class="gap-div"></div>
    <div class="gap-cell"><div class="gap-cell-label">평균 전세가</div><div class="gap-cell-value">${f억(d.jeonsePrice)}</div></div>
    <div class="gap-div"></div>
    <div class="gap-cell"><div class="gap-cell-label">투자금(GAP)</div><div class="gap-cell-value accent">${f억(d.gap)}</div></div>
  </div>
</div>`;
}

function cardCompare(d, idx) {
    const kb       = d.kb;
    const kbRef    = d.kbRef; // 층수 반영된 기준가
    const isFloor1 = parseInt(d.층) === 1;
    const refLabel = isFloor1 ? 'KB하한가(1층)' : 'KB일반거래가';
    const isOver   = d.diff > 0;
    const arrow    = isOver ? '▲' : '▼';
    const absPct   = Math.abs(d.diffPct).toFixed(1);
    const maxVal   = Math.max(d.price, kb.상한가);
    const fillPct  = Math.min(100, (d.price / maxVal * 100));
    return `
<div class="card" onclick="openHistory('${esc(d.아파트)}','${esc(d.sido)}','${esc(d.gudong)}')">
  <div class="badge-row">
    <span class="badge badge-region">${d.sido} ${d.gudong}</span>
    ${regBadge(d.regStatus)}
    <span class="diff-badge ${isOver?'over':'under'}" style="margin-left:auto">${arrow} ${absPct}%</span>
  </div>
  <div class="card-name">${d.아파트}</div>
  <div class="card-meta">${d.전용면적}㎡ · ${d.pyung}평 · ${d.층}층${isFloor1?' · 1층 하한가 적용':''}</div>
  <div class="compare-grid">
    <div class="cmp-cell">
      <div class="cmp-label">실거래가</div>
      <div class="cmp-value ${isOver?'up':'down'}">${f억(d.price)}</div>
    </div>
    <div class="cmp-cell">
      <div class="cmp-label">${refLabel}</div>
      <div class="cmp-value">${f억(kbRef)}</div>
    </div>
    <div class="cmp-cell">
      <div class="cmp-label">KB 하한가</div>
      <div class="cmp-value" style="color:var(--text2)">${f억(kb.하한가)}</div>
    </div>
    <div class="cmp-cell">
      <div class="cmp-label">KB 상한가</div>
      <div class="cmp-value" style="color:var(--text2)">${f억(kb.상한가)}</div>
    </div>
  </div>
  <div class="trend-bar">
    <div class="trend-fill" style="width:${fillPct}%;background:var(${isOver?'--red':'--green'})"></div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:.35rem">
    <span style="font-size:.58rem;color:var(--text3);font-weight:600">KB 하한 ${f억(kb.하한가)}</span>
    <span style="font-size:.58rem;color:var(--text3);font-weight:600">KB 상한 ${f억(kb.상한가)}</span>
  </div>
  <div style="text-align:right;margin-top:.5rem">
    <button class="loan-btn" onclick="event.stopPropagation();openModal2('${esc(d.아파트)}',${d.price},${kbRef},'${d.regStatus}','${d.전용면적}','${d.층}')">💰 대출 계산</button>
  </div>
</div>`;
}

// ═══ 거래이력 모달 ════════════════════════════════════
function openHistory(name, sido, gudong) {
    const list = allData
        .filter(d => d.아파트 === name && d.sido === sido && d.gudong === gudong)
        .sort((a,b) => (b.계약년월 + String(b.계약일).padStart(2,'0')) - (a.계약년월 + String(a.계약일).padStart(2,'0')));

    el('history-apt-name').textContent = name;
    el('history-region').textContent   = `${sido} ${gudong}`;

    if (!list.length) {
        el('history-list').innerHTML = '<p style="text-align:center;color:var(--text3);font-size:.8rem;padding:2rem">거래 내역이 없습니다</p>';
    } else {
        const maxP = Math.max(...list.map(d=>d.price));
        const kb   = getKbPrice(name, list[0].전용면적);
        let kbLine = '';
        if (kb) kbLine = `<div style="background:var(--surface3);border:1px solid var(--border);border-radius:.5rem;padding:.5rem .875rem;margin-bottom:.75rem;font-size:.72rem;font-weight:700;color:var(--text2)">
            KB시세 하한 <b style="color:var(--text1)">${f억(kb.하한가)}</b> · 일반 <b style="color:var(--blue)">${f억(kb.일반거래가)}</b> · 상한 <b style="color:var(--text1)">${f억(kb.상한가)}</b>
        </div>`;
        el('history-list').innerHTML = kbLine + list.map(d => {
            const ym  = String(d.계약년월);
            const dt  = `${ym.slice(0,4)}.${ym.slice(4)}.${String(d.계약일).padStart(2,'0')}`;
            return `
<div class="history-item">
  <span class="history-date">${dt}</span>
  <span class="history-area">${d.전용면적}㎡</span>
  <span class="history-floor">${d.층}층</span>
  <div style="text-align:right;flex:1">
    <div class="history-price" style="${d.price===maxP?'color:var(--red)':''}">${f억(d.price)}</div>
    <div class="history-pyung">평당 ${d.pyungPrice.toLocaleString()}만</div>
  </div>
</div>`;
        }).join('');
    }
    openModal('history-modal');
}

// ═══ 대출/세금 복합 모달 ═════════════════════════════
function openModal2(name, tradePrice, kbPrice, regStatus, area, floor) {
    currentRegStatus = regStatus;
    currentKbPrice   = kbPrice || 0;

    el('modal-apt-name').textContent = name;

    const isSpec = regStatus === '투기과열지구';
    const badge  = el('modal-reg-badge');
    badge.textContent = isSpec ? '투기과열지구 · LTV 40%' : '비규제지역 · LTV 70%';
    badge.className   = `reg-badge-modal ${isSpec ? 'regulated' : 'free'}`;

    // KB vs 실거래가 비교 박스 업데이트
    const floorNum  = parseInt(floor) || 2;
    const isFloor1  = floorNum === 1;
    const kbLabel   = isFloor1 ? 'KB 하한가 (1층)' : 'KB 일반거래가';
    el('pcb-kb-label').textContent = kbLabel;
    el('pcb-trade').textContent    = f억(tradePrice);
    el('pcb-kb').textContent       = currentKbPrice > 0 ? f억(currentKbPrice) : '—';

    const tradeCell = el('pcb-cell-trade');
    const kbCell    = el('pcb-cell-kb');
    tradeCell.classList.remove('active-ltv');
    kbCell.classList.remove('active-ltv');
    if (currentKbPrice > 0) {
        if (tradePrice <= currentKbPrice) tradeCell.classList.add('active-ltv');
        else                             kbCell.classList.add('active-ltv');
        el('pcb-tag').style.display = '';
    } else {
        el('pcb-tag').style.display = 'none';
    }

    el('calc-price').value    = tradePrice;
    el('calc-kb-price').value = currentKbPrice || tradePrice;

    // 탭 초기화
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.modal-panel').forEach(p => p.classList.add('hidden'));
    document.querySelector('.modal-tab[data-tab="loan"]').classList.add('active');
    el('panel-loan').classList.remove('hidden');
    activeModalTab = 'loan';

    openModal('dsr-modal');
    recalcAll();
}

// ═══ 계산 ════════════════════════════════════════════
function recalcAll() {
    calculateLoan();
    calculateTax();
    calculateFee();
}

function calculateLoan() {
    const income     = parseFloat(el('calc-income').value)    || 0;
    const baseRate   = parseFloat(el('calc-base-rate').value)  || 0;
    const stressRate = parseFloat(el('calc-stress').value)     || 0;
    const tradeP     = parseFloat(el('calc-price').value)      || 0;
    const kbP        = parseFloat(el('calc-kb-price').value)   || 0;
    const isFirst    = el('calc-first-home').checked;

    // ★ 담보평가 기준: 실거래가 vs KB기준가(층수반영) 중 낮은 값
    const evalBase = (kbP > 0) ? Math.min(tradeP, kbP) : tradeP;

    const totalRate = (baseRate + stressRate) / 100;

    // ★ 규제지역별 LTV (2025.10.16 이후 기준)
    // 투기과열지구: 무주택 40% / 생애최초 70%
    // 비규제: 70%
    let ltvRatio;
    if (isFirst) {
        ltvRatio = 0.7; // 생애최초 → 규제 무관 70%
    } else if (currentRegStatus === '투기과열지구') {
        ltvRatio = 0.4; // 투기과열 → 40%
    } else {
        ltvRatio = 0.7; // 비규제 → 70%
    }

    const ltvLimit   = evalBase * ltvRatio;
    const dsrLimit   = income * 0.4;
    const n = 360, r = totalRate / 12;
    const factor     = r === 0 ? (1/n) : (r * Math.pow(1+r,n)) / (Math.pow(1+r,n) - 1);
    const dsrMaxLoan = dsrLimit / (factor * 12);

    // 정책 대출 상한 (투기과열지구 기준)
    let policyLimit = 60000;
    if (tradeP > 250000) policyLimit = 20000;      // 25억 초과 → 2억
    else if (tradeP > 150000) policyLimit = 40000;  // 15억 초과 → 4억

    const finalLoan = Math.min(ltvLimit, dsrMaxLoan, policyLimit);
    const needCash  = tradeP - finalLoan;

    el('calc-result').textContent = fWon(finalLoan);
    el('calc-cash').textContent   = '필요 자본금: ' + fWon(needCash);

    // 평가 기준 안내
    const noteEl = el('calc-base-note');
    if (kbP > 0 && kbP < tradeP) {
        noteEl.textContent = `⚠ KB시세(${f억(kbP)}) 기준 LTV 적용 (실거래가 대비 낮음)`;
        noteEl.style.color = 'var(--amber)';
    } else if (kbP > 0) {
        noteEl.textContent = `✓ 실거래가(${f억(tradeP)}) 기준 LTV 적용`;
        noteEl.style.color = 'var(--green)';
    } else {
        noteEl.textContent = 'KB 시세 정보 없음 — 실거래가 기준 적용';
        noteEl.style.color = 'var(--text3)';
    }
}

function calculateTax() {
    const price      = parseFloat(el('calc-price').value) || 0;
    const isFirst    = el('calc-first-home').checked;
    const hcEl       = document.getElementById('calc-house-count');
    const houseCount = hcEl ? parseInt(hcEl.value) : 1;
    const isReg      = currentRegStatus.includes('투기');
    const priceW     = price * 10000; // 원

    let rate;
    if (isFirst) { rate = 0.01; }
    else if (houseCount === 1) {
        rate = price <= 6000 ? 0.01 : price <= 90000 ? 0.02 : 0.03;
    } else if (houseCount === 2) {
        rate = isReg ? 0.08 : 0.01;
    } else {
        rate = isReg ? 0.12 : 0.08;
    }

    const acq      = Math.floor(priceW * rate);
    const edu      = Math.floor(acq * 0.1);
    const special  = rate >= 0.02 ? Math.floor(priceW * 0.002) : 0;
    const discount = isFirst ? Math.min(acq, 2000000) : 0;
    const total    = acq + edu + special - discount;

    el('tax-acquisition').textContent = fMan(acq);
    el('tax-edu').textContent         = fMan(edu);
    el('tax-special').textContent     = fMan(special);
    el('tax-discount').textContent    = discount > 0 ? '-' + fMan(discount) : '-';
    el('tax-total').textContent       = fMan(total);
    el('tax-rate-note').textContent   = `적용 취득세율: ${(rate*100).toFixed(0)}%`;
}

function calculateFee() {
    const price = parseFloat(el('calc-price').value) || 0;
    let rate = .007, maxFee = null;
    for (const t of BROKER_TABLE) {
        if (price <= t.max) { rate = t.rate; maxFee = t.maxFee; break; }
    }
    let fee = Math.floor(price * rate) * 10000;
    if (maxFee !== null) fee = Math.min(fee, maxFee);
    const vat   = Math.floor(fee * 0.1);
    const total = fee + vat;
    el('fee-rate').textContent   = `${(rate*100).toFixed(1)}%`;
    el('fee-amount').textContent = fMan(fee);
    el('fee-vat').textContent    = fMan(vat);
    el('fee-total').textContent  = fMan(total);
}

// ═══ 모달 열기/닫기 ══════════════════════════════════
function openModal(id) {
    el(id).classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closeModal(id) {
    el(id).classList.remove('open');
    document.body.style.overflow = '';
}

// ═══ 유틸 ════════════════════════════════════════════
function el(id)       { return document.getElementById(id); }
function esc(s)       { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function f억(v)       { return (v/10000).toFixed(2) + '억'; }
function fMan(v)      { return Math.floor(v/10000).toLocaleString() + '만원'; }
function fWon(v)      { return Math.floor(v/10000) + '억 ' + (Math.floor(v%10000)).toLocaleString() + '만원'; }

function showEmpty(msg) {
    const lines = msg.split('\n').map(l=>`<p>${l}</p>`).join('');
    el('card-grid').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-msg">${lines}</div></div>`;
}
