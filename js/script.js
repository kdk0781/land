'use strict';

// ─── 상태 ───────────────────────────────────────────────
let allData     = [];
let currentMode = 'latest';
let currentRegStatus = '비규제지역';
let activeModalTab   = 'loan';

// ─── 규제지역 정의 (2026 기준) ──────────────────────────
const REG_SIDO = new Set(['서울특별시']);
const REG_GU   = new Set([
    '과천시','광명시','의왕시','하남시',
    '성남수정구','성남중원구','성남분당구',
    '수원장안구','수원팔달구','수원영통구',
    '안양동안구','용인수지구'
]);

function getRegStatus(sido, sigungu) {
    if (REG_SIDO.has(sido))                         return '투기/조정대상';
    if (sido === '경기도' && REG_GU.has(sigungu)) return '투기/조정대상';
    return '비규제지역';
}

// ─── 부동산 규정 상수 ─────────────────────────────────
const BROKERAGE_RATE = {
    매매: [
        { max: 5000,    rate: .006,  maxFee: 250000 },
        { max: 20000,   rate: .005,  maxFee: 800000 },
        { max: 90000,   rate: .004,  maxFee: null },
        { max: 120000,  rate: .005,  maxFee: null },
        { max: 150000,  rate: .006,  maxFee: null },
        { max: Infinity,rate: .007,  maxFee: null },
    ]
};

// ─── 초기화 ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setupEventListeners();
});

// ─── 데이터 로드 ──────────────────────────────────────
function loadData() {
    Papa.parse('apt_trade_data.csv', {
        download: true,
        header: true,
        complete: results => {
            allData = results.data
                .filter(r => r.아파트 && r.거래금액_n)
                .map(r => {
                    const price = parseFloat(r.거래금액_n);
                    const area  = parseFloat(r.전용면적);
                    const pyung = area / 3.3058;
                    return {
                        ...r,
                        price,
                        pyung:      pyung.toFixed(1),
                        pyungPrice: Math.round(price / pyung),
                        sido:       r.sido   || '미분류',
                        sigungu:    r.sigungu || '',
                        dong:       r.dong   || '',
                        gudong:     `${r.sigungu || ''} ${r.dong || ''}`.trim(),
                        regStatus:  getRegStatus(r.sido, r.sigungu),
                        gap:        parseFloat(r.gap       || 0),
                        jeonseRatio:parseFloat(r.jeonseRatio || 0),
                        jeonsePrice:parseFloat(r.jeonsePrice || 0),
                    };
                });

            initSidoSelect();
            updateStats();
            document.getElementById('total-count').textContent = allData.length.toLocaleString();
            document.getElementById('loader').style.display = 'none';
            renderList();
        },
        error: () => {
            document.getElementById('loader').style.display = 'none';
            showEmpty('데이터를 불러올 수 없습니다. CSV 파일을 확인하세요.');
        }
    });
}

function initSidoSelect() {
    const sidos = [...new Set(allData.map(d => d.sido))].filter(s => s !== '미분류').sort();
    const sel   = document.getElementById('sido-select');
    sidos.forEach(s => {
        const o = document.createElement('option');
        o.value = s; o.textContent = s;
        sel.appendChild(o);
    });
}

function updateStats() {
    const prices = allData.map(d => d.price).filter(p => p > 0);
    if (!prices.length) return;
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const sorted = [...prices].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const max = Math.max(...prices);

    document.getElementById('stat-avg').textContent = (avg / 10000).toFixed(1) + '억';
    document.getElementById('stat-med').textContent = (med / 10000).toFixed(1) + '억';
    document.getElementById('stat-max').textContent = (max / 10000).toFixed(1) + '억';
}

// ─── 이벤트 ───────────────────────────────────────────
function setupEventListeners() {
    // 시/도 변경 → 구/동 목록
    document.getElementById('sido-select').addEventListener('change', function () {
        const regSel = document.getElementById('region-select');
        regSel.innerHTML = '<option value="all">구/동 전체</option>';
        if (this.value === 'all') {
            regSel.disabled = true;
        } else {
            regSel.disabled = false;
            [...new Set(allData.filter(d => d.sido === this.value).map(d => d.gudong))]
                .sort()
                .forEach(g => {
                    const o = document.createElement('option');
                    o.value = g; o.textContent = g;
                    regSel.appendChild(o);
                });
        }
        renderList();
    });

    document.getElementById('region-select').addEventListener('change', renderList);
    document.getElementById('search-input').addEventListener('input',  renderList);

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentMode = this.dataset.mode;
            renderList();
        });
    });

    // 모달 내 탭
    document.querySelectorAll('.modal-tab').forEach(t => {
        t.addEventListener('click', function () {
            document.querySelectorAll('.modal-tab').forEach(x => x.classList.remove('active'));
            this.classList.add('active');
            activeModalTab = this.dataset.tab;
            document.querySelectorAll('.modal-panel').forEach(p => p.classList.add('hidden'));
            document.getElementById(`panel-${activeModalTab}`).classList.remove('hidden');
            if (activeModalTab === 'loan') calculateLoan();
            if (activeModalTab === 'tax')  calculateTax();
            if (activeModalTab === 'fee')  calculateFee();
        });
    });

    // 대출 계산 인풋
    ['calc-income','calc-base-rate','calc-stress','calc-first-home'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input',  () => { calculateLoan(); calculateTax(); calculateFee(); });
        el.addEventListener('change', () => { calculateLoan(); calculateTax(); calculateFee(); });
    });

    // 주택수 선택
    const houseCount = document.getElementById('calc-house-count');
    if (houseCount) houseCount.addEventListener('change', calculateTax);

    // 모달 바깥 클릭으로 닫기
    document.getElementById('dsr-modal').addEventListener('click', function(e) {
        if (e.target === this) closeModal('dsr-modal');
    });
    document.getElementById('history-modal').addEventListener('click', function(e) {
        if (e.target === this) closeModal('history-modal');
    });
}

// ─── 렌더링 ───────────────────────────────────────────
function renderList() {
    const search      = document.getElementById('search-input').value.toLowerCase();
    const selectedSido= document.getElementById('sido-select').value;
    const selectedGu  = document.getElementById('region-select').value;
    const listDiv     = document.getElementById('card-list');

    let filtered = allData.filter(d =>
        (selectedSido === 'all' || d.sido === selectedSido) &&
        (selectedGu   === 'all' || d.gudong === selectedGu)  &&
        d.아파트.toLowerCase().includes(search)
    );

    if (!filtered.length) {
        listDiv.innerHTML = `
          <div class="empty-state">
            <div class="icon">🔍</div>
            <p>검색 결과가 없습니다</p>
          </div>`;
        return;
    }

    if (currentMode === 'volume') {
        const grouped = {};
        filtered.forEach(d => {
            const k = `${d.sido}||${d.gudong}||${d.아파트}`;
            if (!grouped[k]) grouped[k] = { ...d, count: 0, maxP: 0, minP: Infinity };
            grouped[k].count++;
            if (d.price > grouped[k].maxP) grouped[k].maxP = d.price;
            if (d.price < grouped[k].minP) grouped[k].minP = d.price;
        });
        const arr = Object.values(grouped).sort((a, b) => b.count - a.count);
        listDiv.innerHTML = arr.slice(0, 50).map((d, i) => cardVolume(d, i)).join('');

    } else if (currentMode === 'gap_invest') {
        filtered = filtered.filter(d => d.jeonseRatio > 0).sort((a, b) => b.jeonseRatio - a.jeonseRatio);
        listDiv.innerHTML = filtered.slice(0, 50).map((d, i) => cardGap(d, i)).join('');

    } else if (currentMode === 'compare') {
        // KB 시세 비교: 아파트별 최근 거래 vs 평균 비교
        const grouped = {};
        filtered.forEach(d => {
            const k = `${d.아파트}||${Math.round(parseFloat(d.전용면적))}`;
            if (!grouped[k]) grouped[k] = { ...d, prices: [], count: 0 };
            grouped[k].prices.push(d.price);
            grouped[k].count++;
        });
        const arr = Object.values(grouped)
            .filter(d => d.count >= 2)
            .map(d => {
                const sorted = [...d.prices].sort((a, b) => a - b);
                const avg    = d.prices.reduce((a, b) => a + b, 0) / d.prices.length;
                const recent = d.price; // 마지막 데이터 = 최근
                const change = ((recent - avg) / avg * 100);
                return { ...d, avg, recent, change, sortedPrices: sorted };
            })
            .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
        listDiv.innerHTML = arr.slice(0, 50).map((d, i) => cardCompare(d, i)).join('');

    } else {
        if (currentMode === 'top_price') {
            filtered.sort((a, b) => b.price - a.price);
        } else {
            filtered.sort((a, b) =>
                (b.계약년월 + String(b.계약일).padStart(2,'0')) -
                (a.계약년월 + String(a.계약일).padStart(2,'0'))
            );
        }
        listDiv.innerHTML = filtered.slice(0, 50).map(d => cardDefault(d)).join('');
    }
}

// ─── 카드 템플릿 ──────────────────────────────────────
function regBadge(status) {
    return status.includes('투기')
        ? `<span class="badge badge-reg">🔴 ${status}</span>`
        : `<span class="badge badge-free">🟢 ${status}</span>`;
}

function cardDefault(d) {
    const priceStr = (d.price / 10000).toFixed(2);
    const ym = String(d.계약년월);
    const dateStr = `${ym.slice(0,4)}.${ym.slice(4)}.${String(d.계약일).padStart(2,'0')}`;
    return `
    <div class="card" onclick="openHistory('${escHtml(d.아파트)}', '${d.sido}', '${d.gudong}')">
        <div class="card-top">
            <div class="badge-row">
                <span class="badge badge-region">${d.sido} ${d.gudong}</span>
                ${regBadge(d.regStatus)}
            </div>
            <span class="badge badge-date">${dateStr}</span>
        </div>
        <div class="card-name">${escHtml(d.아파트)}</div>
        <div class="card-meta">${d.전용면적}㎡ · ${d.pyung}평 · ${d.층}층</div>
        <div class="card-bottom">
            <div>
                <div class="price-main">${priceStr}억</div>
                <div class="price-sub">평당 ${d.pyungPrice.toLocaleString()}만</div>
            </div>
            <button class="loan-btn" onclick="event.stopPropagation(); openDsrModal('${escHtml(d.아파트)}', ${d.price}, '${d.regStatus}')">
                💰 대출 계산
            </button>
        </div>
    </div>`;
}

function cardVolume(d, idx) {
    const isTop = idx < 3;
    return `
    <div class="card card-rank ${isTop ? 'top' : ''}" onclick="openHistory('${escHtml(d.아파트)}', '${d.sido}', '${d.gudong}')">
        <div class="card-top">
            <div class="rank-badge">${idx + 1}위 거래량 순위</div>
            <span class="vol-badge">${d.count}건</span>
        </div>
        <div class="card-name">${escHtml(d.아파트)}</div>
        <div class="card-meta">${d.sido} ${d.gudong}</div>
        <div class="card-bottom">
            <div>
                <div class="price-sub" style="font-size:.72rem">최고 <b style="color:var(--red)">${(d.maxP/10000).toFixed(1)}억</b></div>
                <div class="price-sub" style="font-size:.72rem">최저 <b style="color:var(--blue)">${(d.minP/10000).toFixed(1)}억</b></div>
            </div>
            <button class="loan-btn" onclick="event.stopPropagation(); openDsrModal('${escHtml(d.아파트)}', ${d.maxP}, '${d.regStatus}')">
                💰 대출 계산
            </button>
        </div>
    </div>`;
}

function cardGap(d, idx) {
    const gapBuk = (d.gap / 10000).toFixed(1);
    return `
    <div class="card card-gap" onclick="openHistory('${escHtml(d.아파트)}', '${d.sido}', '${d.gudong}')">
        <div class="ratio-badge">전세가율 ${Number(d.jeonseRatio).toFixed(1)}%</div>
        <div class="badge-row" style="margin-top:.25rem;margin-bottom:.4rem">
            <span class="badge badge-region">${d.sido} ${d.gudong}</span>
            ${regBadge(d.regStatus)}
        </div>
        <div class="card-name">${idx + 1}. ${escHtml(d.아파트)}</div>
        <div class="card-meta">${d.전용면적}㎡ · ${d.pyung}평</div>
        <div class="gap-grid">
            <div class="gap-cell">
                <div class="gap-cell-label">매매가</div>
                <div class="gap-cell-value">${(d.price/10000).toFixed(1)}억</div>
            </div>
            <div class="gap-divider"></div>
            <div class="gap-cell">
                <div class="gap-cell-label">평균 전세가</div>
                <div class="gap-cell-value">${(d.jeonsePrice/10000).toFixed(1)}억</div>
            </div>
            <div class="gap-divider"></div>
            <div class="gap-cell">
                <div class="gap-cell-label">투자금(GAP)</div>
                <div class="gap-cell-value accent">${gapBuk}억</div>
            </div>
        </div>
        <div style="margin-top:.625rem;text-align:right">
            <button class="loan-btn" onclick="event.stopPropagation(); openDsrModal('${escHtml(d.아파트)}', ${d.price}, '${d.regStatus}')">
                💰 대출 계산
            </button>
        </div>
    </div>`;
}

function cardCompare(d, idx) {
    const isUp  = d.change >= 0;
    const arrow = isUp ? '▲' : '▼';
    const cls   = isUp ? 'up' : 'down';
    const ratio = Math.min(100, Math.max(0, (d.recent / Math.max(...d.sortedPrices)) * 100));
    return `
    <div class="card card-compare" onclick="openHistory('${escHtml(d.아파트)}', '${d.sido}', '${d.gudong}')">
        <div class="card-top">
            <div class="badge-row">
                <span class="badge badge-region">${d.sido} ${d.gudong}</span>
                ${regBadge(d.regStatus)}
            </div>
            <span class="badge" style="background:var(--surface2);color:var(${isUp ? '--red' : '--blue'})">${arrow} ${Math.abs(d.change).toFixed(1)}%</span>
        </div>
        <div class="card-name">${escHtml(d.아파트)}</div>
        <div class="card-meta">${d.전용면적}㎡ · ${d.pyung}평 · 거래 ${d.count}건</div>
        <div class="compare-grid">
            <div class="compare-cell">
                <div class="compare-cell-label">최근 실거래가</div>
                <div class="compare-cell-value ${cls}">${(d.recent/10000).toFixed(2)}억</div>
            </div>
            <div class="compare-cell">
                <div class="compare-cell-label">평균 거래가</div>
                <div class="compare-cell-value">${(d.avg/10000).toFixed(2)}억</div>
            </div>
        </div>
        <div class="trend-bar">
            <div class="trend-fill" style="width:${ratio}%;background:var(${isUp ? '--red' : '--blue'})"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:.4rem;">
            <span style="font-size:.6rem;color:var(--text3);font-weight:600">최저 ${(d.sortedPrices[0]/10000).toFixed(1)}억</span>
            <span style="font-size:.6rem;color:var(--text3);font-weight:600">최고 ${(d.sortedPrices[d.sortedPrices.length-1]/10000).toFixed(1)}억</span>
        </div>
    </div>`;
}

function escHtml(s) {
    return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function showEmpty(msg) {
    document.getElementById('card-list').innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <p>${msg}</p>
      </div>`;
}

// ─── 거래이력 모달 ────────────────────────────────────
function openHistory(name, sido, gudong) {
    const histories = allData
        .filter(d => d.아파트 === name && d.sido === sido && d.gudong === gudong)
        .sort((a, b) =>
            (b.계약년월 + String(b.계약일).padStart(2,'0')) -
            (a.계약년월 + String(a.계약일).padStart(2,'0'))
        );

    document.getElementById('history-apt-name').textContent = name;
    document.getElementById('history-region').textContent   = `${sido} ${gudong}`;

    if (!histories.length) {
        document.getElementById('history-list').innerHTML = '<p style="text-align:center;color:var(--text3);font-size:.8rem;padding:2rem">거래 내역이 없습니다</p>';
    } else {
        const maxP = Math.max(...histories.map(d => d.price));
        document.getElementById('history-list').innerHTML = histories.map(d => {
            const ym  = String(d.계약년월);
            const dt  = `${ym.slice(0,4)}.${ym.slice(4)}.${String(d.계약일).padStart(2,'0')}`;
            const isMax = d.price === maxP;
            return `
            <div class="history-item">
                <span class="history-date">${dt}</span>
                <span class="history-area">${d.전용면적}㎡</span>
                <span class="history-floor">${d.층}층</span>
                <div style="text-align:right;flex:1">
                    <div class="history-price" style="${isMax ? 'color:var(--red)' : ''}">${(d.price/10000).toFixed(2)}억</div>
                    <div class="history-pyung">평당 ${d.pyungPrice.toLocaleString()}만</div>
                </div>
            </div>`;
        }).join('');
    }

    openModal('history-modal');
}

// ─── DSR / 대출 모달 ──────────────────────────────────
function openDsrModal(name, price, regStatus) {
    currentRegStatus = regStatus;
    document.getElementById('modal-apt-name').textContent = name;
    document.getElementById('calc-price').value = price;

    const isReg = regStatus.includes('투기');
    const ltvStr = isReg ? '40%' : '70%';
    const regEl  = document.getElementById('modal-reg-badge');
    regEl.textContent = `${regStatus} · LTV ${ltvStr}`;
    regEl.className   = `reg-badge-modal ${isReg ? 'regulated' : 'free'}`;

    // 기본 탭
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.modal-panel').forEach(p => p.classList.add('hidden'));
    document.querySelector('.modal-tab[data-tab="loan"]').classList.add('active');
    document.getElementById('panel-loan').classList.remove('hidden');
    activeModalTab = 'loan';

    openModal('dsr-modal');
    calculateLoan();
    calculateTax();
    calculateFee();
}

function openModal(id) {
    document.getElementById(id).classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeModal(id) {
    document.getElementById(id).classList.remove('open');
    document.body.style.overflow = '';
}

// ─── 대출 한도 계산 ───────────────────────────────────
function calculateLoan() {
    const income     = parseFloat(document.getElementById('calc-income').value)    || 0;
    const baseRate   = parseFloat(document.getElementById('calc-base-rate').value)  || 0;
    const stressRate = parseFloat(document.getElementById('calc-stress').value)     || 0;
    const price      = parseFloat(document.getElementById('calc-price').value)      || 0;
    const isFirst    = document.getElementById('calc-first-home').checked;

    const totalRate = (baseRate + stressRate) / 100;
    let ltvRatio    = 0.7;
    if (!isFirst && currentRegStatus.includes('투기')) ltvRatio = 0.4;

    const ltvLimit  = price * ltvRatio;
    const dsrLimit  = income * 0.4;
    const n = 360, r = totalRate / 12;
    const factor = r === 0 ? (1 / n) : (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const dsrMaxLoan = dsrLimit / (factor * 12);

    let policyLimit = 60000;
    if (price > 250000) policyLimit = 20000;
    else if (price > 150000) policyLimit = 40000;

    const finalLoan = Math.min(ltvLimit, dsrMaxLoan, policyLimit);
    const needCash  = price - finalLoan;

    const fmt = v => `${Math.floor(v / 10000)}억 ${(Math.floor(v % 10000)).toLocaleString()}만원`;
    document.getElementById('calc-result').textContent = fmt(finalLoan);
    document.getElementById('calc-cash').textContent   = '필요 자본금: ' + fmt(needCash);
}

// ─── 취득세 계산 ──────────────────────────────────────
function calculateTax() {
    const price      = parseFloat(document.getElementById('calc-price').value) || 0;
    const isFirst    = document.getElementById('calc-first-home').checked;
    const houseCount = parseInt(document.getElementById('calc-house-count')?.value || '1');
    const isReg      = currentRegStatus.includes('투기');

    const priceW = price * 10000; // 원 단위 (price는 만원)

    // 취득세율 결정
    let rate;
    if (isFirst) {
        // 생애최초: 200만원 한도 감면 (취득세율 1%)
        rate = 0.01;
    } else if (houseCount === 1) {
        if      (price <= 6000)  rate = 0.01;
        else if (price <= 90000) rate = 0.02;
        else                     rate = 0.03;
    } else if (houseCount === 2) {
        rate = isReg ? 0.08 : 0.01; // 조정 2주택=8%, 비조정=일반세율
    } else {
        rate = isReg ? 0.12 : 0.08; // 3주택이상 조정12%, 비조정8%
    }

    const acquisitionTax = Math.floor(priceW * rate);
    const localEduTax    = Math.floor(acquisitionTax * 0.1);        // 지방교육세 10%
    const specialTax     = rate >= 0.02 ? Math.floor(priceW * 0.002) : 0; // 농어촌특별세 0.2% (2%이상일때)

    // 생애최초 감면 (취득세 200만원 한도)
    let discount = 0;
    if (isFirst) discount = Math.min(acquisitionTax, 2000000);

    const totalTax = acquisitionTax + localEduTax + specialTax - discount;

    document.getElementById('tax-acquisition').textContent = (acquisitionTax / 10000).toFixed(0) + '만원';
    document.getElementById('tax-edu').textContent         = (localEduTax / 10000).toFixed(0) + '만원';
    document.getElementById('tax-special').textContent     = (specialTax / 10000).toFixed(0) + '만원';
    document.getElementById('tax-discount').textContent    = discount > 0 ? '-' + (discount / 10000).toFixed(0) + '만원' : '-';
    document.getElementById('tax-total').textContent       = (totalTax / 10000).toFixed(1) + '만원';
    document.getElementById('tax-rate-note').textContent   = `적용 취득세율: ${(rate * 100).toFixed(0)}%`;
}

// ─── 중개수수료 계산 ──────────────────────────────────
function calculateFee() {
    const price = parseFloat(document.getElementById('calc-price').value) || 0;
    // price는 만원 단위
    const priceW = price; // 만원 그대로

    let rate = 0.007, maxFee = null;
    for (const tier of BROKERAGE_RATE.매매) {
        if (priceW <= tier.max) {
            rate   = tier.rate;
            maxFee = tier.maxFee;
            break;
        }
    }

    let fee = Math.floor(priceW * rate) * 10000; // 원
    if (maxFee !== null) fee = Math.min(fee, maxFee);

    const vat       = Math.floor(fee * 0.1);
    const totalFee  = fee + vat;

    document.getElementById('fee-rate').textContent    = `${(rate * 100).toFixed(1)}%`;
    document.getElementById('fee-amount').textContent  = (fee / 10000).toFixed(1) + '만원';
    document.getElementById('fee-vat').textContent     = (vat / 10000).toFixed(1) + '만원';
    document.getElementById('fee-total').textContent   = (totalFee / 10000).toFixed(1) + '만원';
}
