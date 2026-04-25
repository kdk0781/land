let allData = [];
let currentMode = 'latest';

// 1. 데이터 로드 및 초기 지역 필터 생성
Papa.parse("apt_trade_data.csv", {
    download: true,
    header: true,
    complete: function(results) {
        allData = results.data.filter(row => row.아파트 && row.거래금액).map(row => {
            const price = parseInt(row.거래금액);
            const area = parseFloat(row.전용면적);
            const pyung = area / 3.3058;
            const pyungPrice = Math.round(price / pyung);
            
            // 시군구 텍스트 분리 (예: "서울특별시 강남구 논현동")
            const addr = row.시군구 ? row.시군구.split(' ') : ["미분류"];
            const sido = addr[0];
            const gudong = addr.length > 1 ? addr.slice(1).join(' ') : "";
            
            return { 
                ...row, 
                price, 
                pyungPrice, 
                pyung: pyung.toFixed(1),
                sido: sido,
                gudong: gudong
            };
        });
        
        initSidoSelect();
        document.getElementById('total-count').innerText = allData.length.toLocaleString();
        document.getElementById('loader').style.display = 'none';
        renderList();
    }
});

// 2. 계층형 지역 선택 기능
function initSidoSelect() {
    const sidos = [...new Set(allData.map(d => d.sido))].sort();
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

// 3. 탭 메뉴 이벤트
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        if(this.disabled) return;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        currentMode = this.dataset.mode;
        renderList();
    });
});

// 4. 리스트 렌더링 로직
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

    // 모드별 데이터 정렬 및 가공
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
        filtered = filtered.filter(d => d.전세가율 > 0).sort((a, b) => b.전세가율 - a.전세가율);
    } else {
        filtered.sort((a, b) => (b.년+b.월+b.일) - (a.년+a.월+a.일));
    }

    listDiv.innerHTML = filtered.slice(0, 50).map((item, idx) => {
        if (currentMode === 'volume') return renderVolumeCard(item, idx);
        if (currentMode === 'gap_invest') return renderGapCard(item, idx);
        return renderDefaultCard(item);
    }).join('');
}

// 5. 카드 UI 템플릿들
function renderDefaultCard(item) {
    return `
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
            <div class="flex justify-between items-start mb-2">
                <span class="px-2 py-1 bg-slate-100 text-slate-500 text-[10px] font-extrabold rounded-lg">${item.sido} ${item.gudong}</span>
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
            <button onclick="openDsrModal('${item.아파트}', ${item.price})" class="w-full mt-4 py-3 bg-blue-50 text-blue-700 rounded-xl font-extrabold text-[10px] hover:bg-blue-100 transition-colors">LOAN SIMULATOR</button>
        </div>
    `;
}

function renderVolumeCard(item, idx) {
    return `
        <div class="bg-white p-5 rounded-3xl border border-blue-50 shadow-sm ${idx < 3 ? 'rank-top' : ''}">
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
    const gapUk = (item.갭_금액 / 10000).toFixed(1);
    return `
        <div class="bg-white p-5 rounded-3xl border border-emerald-100 shadow-sm relative overflow-hidden">
            <div class="absolute top-0 right-0 bg-emerald-500 text-white px-3 py-1 text-[10px] font-black rounded-bl-xl italic">
                RATIO ${Number(item.전세가율).toFixed(1)}%
            </div>
            <p class="text-[10px] font-extrabold text-slate-400 mb-1">${item.sido} ${item.gudong}</p>
            <h3 class="text-lg font-extrabold text-slate-800 mb-4">${idx+1}. ${item.아파트}</h3>
            <div class="flex justify-between items-center p-3 bg-emerald-50 rounded-2xl">
                <div class="text-center flex-1">
                    <p class="text-[9px] font-black text-slate-400 mb-1">매매가</p>
                    <p class="font-bold text-slate-700 text-xs">${(item.price/10000).toFixed(1)}억</p>
                </div>
                <div class="w-px h-6 bg-emerald-200"></div>
                <div class="text-center flex-1">
                    <p class="text-[9px] font-black text-slate-400 mb-1">전세가</p>
                    <p class="font-bold text-slate-700 text-xs">${(item.전세가/10000).toFixed(1)}억</p>
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

// 6. DSR 계산기 함수
function openDsrModal(name, price) {
    document.getElementById('modal-apt-name').innerText = name;
    document.getElementById('calc-price').value = price;
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
    const totalRate = (4.0 + stressRate) / 100;
    const dsrLimit = income * 0.4;
    
    const n = 40 * 12;
    const r = totalRate / 12;
    const factor = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    
    const maxLoan = dsrLimit / (factor * 12);
    document.getElementById('calc-result').innerText = 
        Math.floor(maxLoan / 10000) + "억 " + (Math.floor(maxLoan % 10000)).toLocaleString() + "만원";
}
