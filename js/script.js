let allData = [];
let currentMode = 'latest';

// 현재 법령 기준 투기과열지구 및 조정대상지역 (강남 3구 + 용산)
const regulatedAreas = {
    "서울특별시 강남구": "투기/조정대상",
    "서울특별시 서초구": "투기/조정대상",
    "서울특별시 송파구": "투기/조정대상",
    "서울특별시 용산구": "투기/조정대상"
};

Papa.parse("apt_trade_data.csv", {
    download: true,
    header: true,
    complete: function(results) {
        allData = results.data.filter(row => row.아파트 && row.거래금액_n).map(row => {
            const price = parseFloat(row.거래금액_n);
            const area = parseFloat(row.전용면적);
            const pyung = area / 3.3058;
            const pyungPrice = Math.round(price / pyung);
            
            const sido = row.시도 || "미분류";
            const sigungu = row.시군구 || "";
            const dong = row.법정동 || "";
            
            const fullSigungu = `${sido} ${sigungu}`.trim();
            const regStatus = regulatedAreas[fullSigungu] || "비규제지역";
            
            return { 
                ...row, 
                price, 
                pyungPrice, 
                pyung: pyung.toFixed(1),
                sido: sido,
                sigungu: sigungu,
                dong: dong,
                gudong: `${sigungu} ${dong}`.trim(),
                regStatus: regStatus,
                gap: parseFloat(row.갭 || 0),
                jeonseRatio: parseFloat(row.전세가율 || 0),
                jeonsePrice: parseFloat(row.보증금 || 0)
            };
        });
        
        initSidoSelect();
        document.getElementById('total-count').innerText = allData.length.toLocaleString();
        document.getElementById('loader').style.display = 'none';
        renderList();
    }
});

function initSidoSelect() {
    const sidos = [...new Set(allData.map(d => d.sido))].filter(s => s !== "미분류").sort();
    const sidoSelect = document.getElementById('sido-select');
    
    sidos.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.innerText = s;
        sidoSelect.appendChild(opt);
    });

    sidoSelect.addEventListener('change', function() {
        const selectedSido = this.value;
        const regionSelect = document.getElementById('region-select');
        
        regionSelect.innerHTML = '<option value="all">구/동 전체</option>';
        
        if (selectedSido === 'all') {
            regionSelect.disabled = true;
        } else {
            regionSelect.disabled = false;
            const gudongs = [...new Set(allData.filter(d => d.sido === selectedSido).map(d => d.gudong))].sort();
            gudongs.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g;
                opt.innerText = g;
                regionSelect.appendChild(opt);
            });
        }
        renderList();
    });

    document.getElementById('region-select').addEventListener('change', renderList);
    document.getElementById('search-input').addEventListener('input', renderList);
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        currentMode = this.dataset.mode;
        renderList();
    });
});

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

    listDiv.innerHTML = '';

    if (currentMode === 'volume') {
        const grouped = {};
        filtered.forEach(item => {
            const key = `${item.sido} ${item.gudong} ${item.아파트}`;
            if (!grouped[key]) grouped[key] = { ...item, count: 0, maxP: 0 };
            grouped[key].count++;
            if (item.price > grouped[key].maxP) grouped[key].maxP = item.price;
        });
        filtered = Object.values(grouped).sort((a, b) => b.count - a.count);
    } else if (currentMode === 'top_price') {
        filtered.sort((a, b) => b.price - a.price);
    } else if (currentMode === 'gap_invest') {
        // 전세가율 0% 초과인 진짜 갭 데이터만 필터링
        filtered = filtered.filter(d => d.jeonseRatio > 0).sort((a, b) => b.jeonseRatio - a.jeonseRatio);
    } else {
        filtered.sort((a, b) => (b.년+b.월+b.일) - (a.년+a.월+a.일));
    }

    listDiv.innerHTML = filtered.slice(0, 50).map((item, idx) => {
        if (currentMode === 'volume') return renderVolumeCard(item, idx);
        if (currentMode === 'gap_invest') return renderGapCard(item, idx);
        return renderDefaultCard(item);
    }).join('');
}

function getRegBadge(status) {
    if(status === "비규제지역") return `<span class="px-2 py-1 bg-slate-100 text-slate-500 text-[10px] font-extrabold rounded-lg ml-1">비규제</span>`;
    return `<span class="px-2 py-1 bg-red-100 text-red-600 text-[10px] font-extrabold rounded-lg ml-1 animate-pulse">${status}</span>`;
}

function renderDefaultCard(item) {
    return `
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <span class="px-2 py-1 bg-slate-100 text-slate-500 text-[10px] font-extrabold rounded-lg">${item.sido} ${item.gudong}</span>
                    ${getRegBadge(item.regStatus)}
                </div>
                <span class="text-[10px] font-bold text-slate-300">${item.년}.${item.월}.${item.일}</span>
            </div>
            <h3 class="text-lg font-extrabold text-slate-800 tracking-tighter">${item.아파트}</h3>
            <div class="mt-4 flex justify-between items-end">
                <div class="text-xs font-bold text-slate-400 leading-relaxed">
                    ${item.전용면적}㎡ (${item.pyung}평) | ${item.층}층
                </div>
                <div class="text-right">
                    <div class="text-xl font-black text-blue-700">${(item.price/10000).toFixed(1)}억</div>
                    <div class="text-[10px] font-bold text-slate-300 mt-1">평당 ${item.pyungPrice.toLocaleString()}만</div>
                </div>
            </div>
            <button onclick="openDsrModal('${item.아파트}', ${item.price}, '${item.regStatus}')" class="w-full mt-4 py-3 bg-blue-50 text-blue-700 rounded-xl font-extrabold text-[10px] hover:bg-blue-100 transition-colors">💰 LTV/DSR 대출 한도 계산</button>
        </div>
    `;
}

function renderVolumeCard(item, idx) {
    return `
        <div class="bg-white p-5 rounded-3xl border border-blue-50 shadow-sm ${idx < 3 ? 'border-l-4 border-l-blue-600' : ''}">
            <div class="flex justify-between items-center mb-2">
                <span class="text-[10px] font-black text-blue-600 uppercase tracking-widest">${idx + 1}nd Ranking</span>
                <span class="px-2 py-1 bg-blue-600 text-white text-[10px] font-black rounded-lg">거래 ${item.count}건</span>
            </div>
            <h3 class="text-lg font-extrabold text-slate-800">${item.아파트}</h3>
            <p class="text-[10px] font-bold text-slate-400 mt-1">${item.sido} ${item.gudong}</p>
        </div>
    `;
}

function renderGapCard(item, idx) {
    const gapUk = (item.gap / 10000).toFixed(1);
    return `
        <div class="bg-white p-5 rounded-3xl border border-emerald-100 shadow-sm relative overflow-hidden">
            <div class="absolute top-0 right-0 bg-emerald-500 text-white px-3 py-1 text-[10px] font-black rounded-bl-xl italic">
                전세가율 ${Number(item.jeonseRatio).toFixed(1)}%
            </div>
            <div class="mb-1 flex items-center">
                <p class="text-[10px] font-extrabold text-slate-400">${item.sido} ${item.gudong}</p>
                ${getRegBadge(item.regStatus)}
            </div>
            <h3 class="text-lg font-extrabold text-slate-800 mb-4">${idx+1}. ${item.아파트}</h3>
            <div class="flex justify-between items-center p-3 bg-emerald-50 rounded-2xl">
                <div class="text-center flex-1">
                    <p class="text-[9px] font-black text-slate-400 mb-1">매매가</p>
                    <p class="font-bold text-slate-700 text-xs">${(item.price/10000).toFixed(1)}억</p>
                </div>
                <div class="w-px h-6 bg-emerald-200"></div>
                <div class="text-center flex-1">
                    <p class="text-[9px] font-black text-slate-400 mb-1">평균 전세가</p>
                    <p class="font-bold text-slate-700 text-xs">${(item.jeonsePrice/10000).toFixed(1)}억</p>
                </div>
                <div class="w-px h-6 bg-emerald-200"></div>
                <div class="text-center flex-1">
                    <p class="text-[9px] font-black text-emerald-600 mb-1">투자금(GAP)</p>
                    <p class="font-black text-emerald-600">${gapUk}억</p>
                </div>
            </div>
        </div>
    `;
}

// 글로벌 변수 저장용
let currentCalcPrice = 0;
let currentRegStatus = "비규제지역";

function openDsrModal(name, price, regStatus) {
    currentCalcPrice = price;
    currentRegStatus = regStatus;
    
    document.getElementById('modal-apt-name').innerText = name;
    document.getElementById('calc-price').value = price;
    
    // 규제 지역에 따른 LTV 뱃지 표시
    const ltvRatio = regStatus.includes("투기") ? "50%" : "70%";
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
    const income = document.getElementById('calc-income').value || 0;
    const stressRate = parseFloat(document.getElementById('calc-stress').value);
    
    // 1. LTV 한도 계산
    const ltvRatio = currentRegStatus.includes("투기") ? 0.5 : 0.7;
    const ltvLimit = currentCalcPrice * ltvRatio;
    
    // 2. DSR 한도 계산 (40년 기준)
    const totalRate = (4.0 + stressRate) / 100;
    const dsrLimit = income * 0.4;
    const n = 40 * 12;
    const r = totalRate / 12;
    const factor = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const dsrMaxLoan = dsrLimit / (factor * 12);
    
    // 3. 최종 대출 한도 (MIN 적용)
    const finalLoan = Math.min(ltvLimit, dsrMaxLoan);
    const needCash = currentCalcPrice - finalLoan;
    
    document.getElementById('calc-result').innerText = 
        Math.floor(finalLoan / 10000) + "억 " + (Math.floor(finalLoan % 10000)).toLocaleString() + "만원";
    document.getElementById('calc-cash').innerText = 
        "필요 자본금: " + Math.floor(needCash / 10000) + "억 " + (Math.floor(needCash % 10000)).toLocaleString() + "만원";
}

document.getElementById('calc-income').addEventListener('input', calculateDsr);
document.getElementById('calc-stress').addEventListener('change', calculateDsr);
