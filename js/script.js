let allData = [];
let currentMode = 'latest';
let currentRegStatus = "비규제지역";

// 2026년 기준 규제 지역 정의
const regulatedSido = ["서울특별시"]; 
const regulatedGyeonggi = [
    "과천시", "광명시", "의왕시", "하남시", 
    "성남수정구", "성남중원구", "성남분당구", 
    "수원장안구", "수원팔달구", "수원영통구", 
    "안양동안구", "용인수지구"
];

// 초기 실행
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setupEventListeners();
});

function loadData() {
    Papa.parse("apt_trade_data.csv", {
        download: true,
        header: true,
        complete: function(results) {
            allData = results.data.filter(row => row.아파트 && row.거래금액_n).map(row => {
                const price = parseFloat(row.거래금액_n);
                const area = parseFloat(row.전용면적);
                const pyung = area / 3.3058;
                const pyungPrice = Math.round(price / pyung);
                const sido = row.sido || "미분류";
                const sigungu = row.sigungu || "";
                const dong = row.dong || "";
                
                let regStatus = "비규제지역";
                if (regulatedSido.includes(sido)) regStatus = "투기/조정대상";
                else if (sido === "경기도" && regulatedGyeonggi.includes(sigungu)) regStatus = "투기/조정대상";

                return { 
                    ...row, 
                    price, pyungPrice, pyung: pyung.toFixed(1),
                    sido, sigungu, dong, gudong: `${sigungu} ${dong}`.trim(),
                    regStatus,
                    gap: parseFloat(row.gap || 0),
                    jeonseRatio: parseFloat(row.jeonseRatio || 0),
                    jeonsePrice: parseFloat(row.jeonsePrice || 0)
                };
            });
            initSidoSelect();
            document.getElementById('total-count').innerText = allData.length.toLocaleString();
            document.getElementById('loader').style.display = 'none';
            renderList();
        }
    });
}

function initSidoSelect() {
    const sidos = [...new Set(allData.map(d => d.sido))].filter(s => s !== "미분류").sort();
    const sidoSelect = document.getElementById('sido-select');
    sidos.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.innerText = s;
        sidoSelect.appendChild(opt);
    });
}

function setupEventListeners() {
    document.getElementById('sido-select').addEventListener('change', function() {
        const regionSelect = document.getElementById('region-select');
        regionSelect.innerHTML = '<option value="all">구/동 전체</option>';
        if (this.value === 'all') regionSelect.disabled = true;
        else {
            regionSelect.disabled = false;
            const gudongs = [...new Set(allData.filter(d => d.sido === this.value).map(d => d.gudong))].sort();
            gudongs.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g; opt.innerText = g;
                regionSelect.appendChild(opt);
            });
        }
        renderList();
    });

    document.getElementById('region-select').addEventListener('change', renderList);
    document.getElementById('search-input').addEventListener('input', renderList);
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentMode = this.dataset.mode;
            renderList();
        });
    });

    // 계산기 실시간 연동
    const calcInputs = ['calc-income', 'calc-base-rate', 'calc-stress', 'calc-first-home'];
    calcInputs.forEach(id => {
        document.getElementById(id).addEventListener('input', calculateDsr);
        document.getElementById(id).addEventListener('change', calculateDsr);
    });
}

function renderList() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase();
    const selectedSido = document.getElementById('sido-select').value;
    const selectedGudong = document.getElementById('region-select').value;
    const listDiv = document.getElementById('trade-list');

    let filtered = allData.filter(item => {
        const matchSido = selectedSido === 'all' || item.sido === selectedSido;
        const matchGudong = selectedGudong === 'all' || item.gudong === selectedGudong;
        const matchSearch = item.아파트.toLowerCase().includes(searchTerm);
        return matchSido && matchGudong && matchSearch;
    });

    if (currentMode === 'volume') {
        const grouped = {};
        filtered.forEach(item => {
            const key = `${item.sido} ${item.gudong} ${item.아파트}`;
            if (!grouped[key]) grouped[key] = { ...item, count: 0, maxP: 0 };
            grouped[key].count++;
            if (item.price > grouped[key].maxP) grouped[key].maxP = item.price;
        });
        filtered = Object.values(grouped).sort((a, b) => b.count - a.count);
    } else if (currentMode === 'top_price') filtered.sort((a, b) => b.price - a.price);
    else if (currentMode === 'gap_invest') filtered = filtered.filter(d => d.jeonseRatio > 0).sort((a, b) => b.jeonseRatio - a.jeonseRatio);
    else filtered.sort((a, b) => (b.계약년월 + b.계약일) - (a.계약년월 + a.계약일));

    listDiv.innerHTML = filtered.slice(0, 50).map((item, idx) => `
        <div class="theme-card-bg p-5 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <span class="px-2 py-1 bg-slate-100 text-slate-500 text-[10px] font-extrabold rounded-lg">${item.sido} ${item.gudong}</span>
                    <span class="px-2 py-1 ${item.regStatus.includes('투기') ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'} text-[10px] font-extrabold rounded-lg ml-1">${item.regStatus}</span>
                </div>
                <span class="text-[10px] font-bold theme-text-sub">${item.계약년월}.${item.계약일}</span>
            </div>
            <h3 class="text-lg font-extrabold theme-text tracking-tighter">${item.아파트}</h3>
            <div class="mt-4 flex justify-between items-end">
                <div class="text-xs font-bold theme-text-sub leading-relaxed">${item.전용면적}㎡ (${item.pyung}평) | ${item.층}층</div>
                <div class="text-right">
                    <div class="text-xl font-black text-blue-700">${(item.price/10000).toFixed(1)}억</div>
                    <div class="text-[10px] font-bold theme-text-sub mt-1">평당 ${item.pyungPrice.toLocaleString()}만</div>
                </div>
            </div>
            <button onclick="openDsrModal('${item.아파트}', ${item.price}, '${item.regStatus}')" class="w-full mt-4 py-3 bg-blue-50 text-blue-700 rounded-xl font-extrabold text-[10px] hover:bg-blue-100 transition-colors">💰 LTV/DSR 대출 한도 계산</button>
        </div>
    `).join('');
}

function openDsrModal(name, price, regStatus) {
    currentRegStatus = regStatus;
    document.getElementById('modal-apt-name').innerText = name;
    document.getElementById('calc-price').value = price;
    const ltvRatio = regStatus.includes("투기") ? "40%" : "70%";
    document.getElementById('modal-reg-badge').innerText = `${regStatus} (LTV ${ltvRatio})`;
    document.getElementById('dsr-modal').classList.remove('hidden');
    document.getElementById('dsr-modal').classList.add('flex');
    calculateDsr();
}

function closeDsrModal() {
    document.getElementById('dsr-modal').classList.add('hidden');
    document.getElementById('dsr-modal').classList.remove('flex');
}

function calculateDsr() {
    const income = parseFloat(document.getElementById('calc-income').value) || 0;
    const baseRate = parseFloat(document.getElementById('calc-base-rate').value) || 0;
    const stressRate = parseFloat(document.getElementById('calc-stress').value) || 0;
    const price = parseFloat(document.getElementById('calc-price').value) || 0;
    const isFirstHome = document.getElementById('calc-first-home').checked;
    
    const totalRate = (baseRate + stressRate) / 100;
    let ltvRatio = 0.7;
    if (!isFirstHome && currentRegStatus.includes("투기")) ltvRatio = 0.4;
    
    const ltvLimit = price * ltvRatio;
    const dsrLimit = income * 0.4;
    const n = 30 * 12; // 30년 상환
    const r = totalRate / 12;
    const factor = r === 0 ? (1/n) : (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const dsrMaxLoan = dsrLimit / (factor * 12);
    
    let policyLimit = 60000; 
    if (price > 250000) policyLimit = 20000;
    else if (price > 150000) policyLimit = 40000;

    const finalLoan = Math.min(ltvLimit, dsrMaxLoan, policyLimit);
    const needCash = price - finalLoan;
    
    document.getElementById('calc-result').innerText = Math.floor(finalLoan / 10000) + "억 " + (Math.floor(finalLoan % 10000)).toLocaleString() + "만원";
    document.getElementById('calc-cash').innerText = "필요 자본금: " + Math.floor(needCash / 10000) + "억 " + (Math.floor(needCash % 10000)).toLocaleString() + "만원";
}