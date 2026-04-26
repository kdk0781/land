'use strict';

// ═══ 전역 상태
let allData          = [];
let kbMap            = {};
let currentMode      = 'latest';
let currentRegStatus = '비규제지역';
let currentKbPrice   = 0;

// ═══ 규제지역 (2025.10.16 기준)
const SUWON_GWONSEON = new Set(['고색동','곡반정동','구운동','권선동','금곡동','당수동','세류동','오목천동','입북동','평동','호매실동','서둔동']);
const ANYANG_MANAN   = new Set(['안양동','박달동','석수동']);
const YONGIN_SUJI    = new Set(['동천동','상현동','성복동','신봉동','죽전동','고기동','풍덕천동','보정동']);

function getRegGrade(sido, sigungu, dong) {
    if (sido === '서울특별시') return 'SPEC';
    if (sido !== '경기도') return 'NONE';
    if (['과천시','광명시','의왕시','하남시'].includes(sigungu)) return 'SPEC';
    if (sigungu === '성남시') return 'SPEC';
    if (sigungu === '수원시') return SUWON_GWONSEON.has(dong) ? 'NONE' : 'SPEC';
    if (sigungu === '안양시') return ANYANG_MANAN.has(dong)   ? 'NONE' : 'SPEC';
    if (sigungu === '용인시') return YONGIN_SUJI.has(dong)    ? 'SPEC' : 'NONE';
    return 'NONE';
}
function getRegStatus(sido, sigungu, dong) {
    return getRegGrade(sido, sigungu, dong) === 'SPEC' ? '투기과열지구' : '비규제지역';
}

// ═══ 중개수수료
const BROKER = [
    {max:5000,   rate:.006,cap:250000},{max:20000,  rate:.005,cap:800000},
    {max:90000,  rate:.004,cap:null},  {max:120000, rate:.005,cap:null},
    {max:150000, rate:.006,cap:null},  {max:Infinity,rate:.007,cap:null},
];

// ═══ 초기화
document.addEventListener('DOMContentLoaded', () => { setupEvents(); loadData(); });

// ═══ 로더
function setLoader(t) { const e=document.querySelector('.loader-text'); if(e) e.textContent=t; }
function hideLoader()  { const e=g('loader'); if(e) e.style.display='none'; }

// ═══ 데이터 로드
function loadData() {
    const guard = setTimeout(() => { hideLoader(); showEmpty('⏱ 로딩 시간 초과\napt_trade_data.csv 파일이 index.html과 같은 폴더에 있는지 확인하세요.'); }, 60000);
    setLoader('데이터 다운로드 중...');
    fetchText('apt_trade_data.csv').then(text => {
        if (!text) throw new Error('apt_trade_data.csv를 찾을 수 없습니다.');
        setLoader('데이터 파싱 중...');
        return parseCsv(text);
    }).then(rows => {
        if (!rows.length) throw new Error('CSV 데이터가 비어 있습니다.');
        setLoader('데이터 처리 중...');
        allData = rows.filter(r => r['아파트'] && r['거래금액_n']).map(r => {
            const sido=( r['sido']   ||'미분류').trim(), sigungu=(r['sigungu']||'').trim(), dong=(r['dong']||'').trim();
            const price=parseFloat(r['거래금액_n'])||0, area=parseFloat(r['전용면적'])||0, pyung=area/3.3058;
            return { sido, sigungu, dong, gudong:`${sigungu} ${dong}`.trim(), areaRound:Math.round(area),
                regStatus:getRegStatus(sido,sigungu,dong), price, pyung:pyung.toFixed(1),
                pyungPrice:pyung>0?Math.round(price/pyung):0,
                gap:parseFloat(r['gap']||0), jeonseRatio:parseFloat(r['jeonseRatio']||0), jeonsePrice:parseFloat(r['jeonsePrice']||0),
                아파트:r['아파트']||'', 전용면적:r['전용면적']||'', 층:r['층']||'', 계약년월:r['계약년월']||'', 계약일:r['계약일']||''
            };
        });
        initSidoSelect(); updateStats();
        g('total-count').textContent = allData.length.toLocaleString();
        clearTimeout(guard); hideLoader(); renderList();
    }).catch(err => { clearTimeout(guard); hideLoader(); showEmpty('❌ '+err.message); });

    // KB 시세 (선택)
    fetchText('map.csv').then(text => { if(!text) return; return parseCsv(text); }).then(rows => {
        if(!rows||!rows.length) return;
        rows.forEach(r => {
            const apt=(r['apt']||'').trim(), sido=(r['sido']||'').trim(), sgg=(r['sigungu']||'').trim(), area=parseFloat(r['area']||0);
            if(!apt||!area) return;
            const n=s=>parseFloat(String(s||'0').replace(/,/g,''))||0;
            const entry={하한가:n(r['하한가']),일반거래가:n(r['일반거래가']),상한가:n(r['상한가']),area,sido,sigungu:sgg};
            const ar=Math.round(area), k1=`${sido}||${sgg}||${apt}||${ar}`, k2=`_fb||${apt}||${ar}`;
            if(!kbMap[k1]) kbMap[k1]=[];  kbMap[k1].push(entry);
            if(!kbMap[k2]) kbMap[k2]=[];  kbMap[k2].push(entry);
        });
        const cnt=Object.keys(kbMap).length, s=g('kb-status');
        if(s){s.textContent=`KB ${cnt.toLocaleString()}건 ✓`;s.className='kb-status loaded';}
    }).catch(()=>{});
}

function fetchText(path) { return fetch(path).then(r=>r.ok?r.text():null).catch(()=>null); }
function parseCsv(text) {
    return new Promise(res => {
        Papa.parse(text, {header:true,skipEmptyLines:true,complete:r=>res(r.data||[]),error:()=>res([])});
    });
}

// ═══ KB 시세 조회
function getKb(apt,area,sido,sgg) {
    const a=(apt||'').trim(), ar=Math.round(parseFloat(area)||0);
    for(let d=0;d<=5;d++) for(const dt of(d===0?[0]:[d,-d])) {
        const k=`${sido}||${sgg}||${a}||${ar+dt}`;
        if(kbMap[k]&&kbMap[k].length) return kbMap[k][0];
    }
    for(let d=0;d<=5;d++) for(const dt of(d===0?[0]:[d,-d])) {
        const k=`_fb||${a}||${ar+dt}`;
        if(kbMap[k]&&kbMap[k].length){const m=kbMap[k].filter(e=>e.sido===sido);if(m.length)return m[0];if(kbMap[k].length===1)return kbMap[k][0];}
    }
    return null;
}
function kbRef(apt,area,floor,sido,sgg) { const kb=getKb(apt,area,sido,sgg); if(!kb)return 0; return parseInt(floor)===1?kb.하한가:kb.일반거래가; }

// ═══ 셀렉트 & 통계
function initSidoSelect() {
    const sidos=[...new Set(allData.map(d=>d.sido))].filter(s=>s!=='미분류').sort();
    const sel=g('sido-select');
    sidos.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;sel.appendChild(o);});
}
function updateStats() {
    const p=allData.map(d=>d.price).filter(Boolean);
    if(!p.length)return;
    const s=[...p].sort((a,b)=>a-b);
    g('stat-avg').textContent=f억(p.reduce((a,b)=>a+b,0)/p.length);
    g('stat-med').textContent=f억(s[Math.floor(s.length/2)]);
    g('stat-max').textContent=f억(s[s.length-1]);
}

// ═══ 이벤트
function setupEvents() {
    g('sido-select').addEventListener('change',function(){
        const r=g('region-select'); r.innerHTML='<option value="all">구/동 전체</option>'; r.disabled=this.value==='all';
        if(this.value!=='all') [...new Set(allData.filter(d=>d.sido===this.value).map(d=>d.gudong))].sort().forEach(gu=>{const o=document.createElement('option');o.value=gu;o.textContent=gu;r.appendChild(o);});
        renderList();
    });
    g('region-select').addEventListener('change',renderList);
    g('search-input').addEventListener('input',renderList);
    document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',function(){
        document.querySelectorAll('.tab-btn').forEach(x=>x.classList.remove('active'));
        this.classList.add('active'); currentMode=this.dataset.mode; renderList();
    }));
    document.querySelectorAll('.modal-tab').forEach(t=>t.addEventListener('click',function(){
        document.querySelectorAll('.modal-tab').forEach(x=>x.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.modal-panel').forEach(p=>p.classList.add('hidden'));
        g('panel-'+this.dataset.tab).classList.remove('hidden'); recalc();
    }));
    ['calc-income','calc-base-rate','calc-stress','calc-first-home','calc-house-count'].forEach(id=>{
        const el=document.getElementById(id);
        if(el){el.addEventListener('input',recalc);el.addEventListener('change',recalc);}
    });
    g('dsr-modal').addEventListener('click',ev=>{if(ev.target===g('dsr-modal'))closeM('dsr-modal');});
    g('history-modal').addEventListener('click',ev=>{if(ev.target===g('history-modal'))closeM('history-modal');});
}

// ═══ 렌더링
function renderList() {
    const search=g('search-input').value.toLowerCase(), sido=g('sido-select').value, gudong=g('region-select').value, grid=g('card-grid');
    let filtered=allData.filter(d=>(sido==='all'||d.sido===sido)&&(gudong==='all'||d.gudong===gudong)&&d.아파트.toLowerCase().includes(search));
    if(!filtered.length){grid.innerHTML=`<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-msg">검색 결과가 없습니다</p></div>`;return;}

    if(currentMode==='volume'){
        const grp={};
        filtered.forEach(d=>{const k=`${d.sido}||${d.gudong}||${d.아파트}`;if(!grp[k])grp[k]={...d,count:0,maxP:0,minP:Infinity};grp[k].count++;if(d.price>grp[k].maxP)grp[k].maxP=d.price;if(d.price<grp[k].minP)grp[k].minP=d.price;});
        grid.innerHTML=Object.values(grp).sort((a,b)=>b.count-a.count).slice(0,60).map((d,i)=>cardVolume(d,i)).join('');
    } else if(currentMode==='gap_invest'){
        grid.innerHTML=filtered.filter(d=>d.jeonseRatio>0).sort((a,b)=>b.jeonseRatio-a.jeonseRatio).slice(0,60).map((d,i)=>cardGap(d,i)).join('');
    } else if(currentMode==='compare'){
        const grp={};
        filtered.forEach(d=>{const kb=getKb(d.아파트,d.전용면적,d.sido,d.sigungu);if(!kb)return;const k=`${d.아파트}||${d.areaRound}`;if(!grp[k]||d.price>grp[k].price)grp[k]={...d,kb};});
        const arr=Object.values(grp).map(d=>{const ref=parseInt(d.층)===1?d.kb.하한가:d.kb.일반거래가;const diff=d.price-ref;return{...d,kbRef:ref,diff,diffPct:diff/ref*100};}).sort((a,b)=>Math.abs(b.diffPct)-Math.abs(a.diffPct));
        if(!arr.length){grid.innerHTML=`<div class="empty-state"><div class="empty-icon">📊</div><p class="empty-msg">KB 매칭 데이터가 없습니다<br>지역을 좁혀 검색하세요</p></div>`;return;}
        grid.innerHTML=arr.slice(0,60).map((d,i)=>cardCompare(d,i)).join('');
    } else {
        if(currentMode==='top_price') filtered.sort((a,b)=>b.price-a.price);
        else filtered.sort((a,b)=>(b.계약년월+String(b.계약일).padStart(2,'0'))-(a.계약년월+String(a.계약일).padStart(2,'0')));
        grid.innerHTML=filtered.slice(0,60).map(d=>cardDefault(d)).join('');
    }
}

// ═══ 카드 공통
function regBadge(s){return s==='투기과열지구'?`<span class="badge badge-reg">🔴 투기과열</span>`:`<span class="badge badge-free">🟢 비규제</span>`;}
function kbChipHtml(price,kb,floor){
    if(!kb)return `<span class="kb-chip neutral" style="font-size:.58rem">시세없음</span>`;
    const ref=parseInt(floor)===1?kb.하한가:kb.일반거래가, lbl=parseInt(floor)===1?'KB하한':'KB일반';
    const pct=((price-ref)/ref*100).toFixed(1);
    if(Math.abs(price-ref)<ref*.01)return`<span class="kb-chip neutral">${lbl} ${f억(ref)} ≈</span>`;
    return price>ref?`<span class="kb-chip pricey">▲${pct}% vs ${lbl}</span>`:`<span class="kb-chip cheap">▼${Math.abs(pct)}% vs ${lbl}</span>`;
}

function cardDefault(d){
    const kb=getKb(d.아파트,d.전용면적,d.sido,d.sigungu), kr=kbRef(d.아파트,d.전용면적,d.층,d.sido,d.sigungu);
    const ym=String(d.계약년월), dt=`${ym.slice(0,4)}.${ym.slice(4)}.${String(d.계약일).padStart(2,'0')}`;
    return `<div class="card" onclick="openHistory('${e(d.아파트)}','${e(d.sido)}','${e(d.gudong)}')">
  <div class="badge-row"><span class="badge badge-region">${d.sido} ${d.gudong}</span>${regBadge(d.regStatus)}<span class="badge badge-date">${dt}</span></div>
  <div class="card-name">${d.아파트}</div>
  <div class="card-meta">${d.전용면적}㎡ · ${d.pyung}평 · ${d.층}층</div>
  <div class="kb-compare-row">${kbChipHtml(d.price,kb,d.층)}${kb?`<span class="kb-chip neutral">${parseInt(d.층)===1?'KB하한':'KB일반'} ${f억(kr)}</span>`:''}</div>
  <div class="card-bottom">
    <div><div class="price-main">${f억(d.price)}</div><div class="price-sub">평당 ${d.pyungPrice.toLocaleString()}만</div></div>
    <button class="loan-btn" onclick="event.stopPropagation();openM('${e(d.아파트)}',${d.price},${kr},'${d.regStatus}','${d.층}')">💰 대출 계산</button>
  </div>
</div>`;
}

function cardVolume(d,idx){
    const kr=kbRef(d.아파트,d.전용면적,'2',d.sido,d.sigungu);
    return `<div class="card card-rank ${idx<3?'top':''}" onclick="openHistory('${e(d.아파트)}','${e(d.sido)}','${e(d.gudong)}')">
  <div class="badge-row"><span class="rank-label">${idx+1}위</span><span class="vol-badge">${d.count}건</span></div>
  <div class="card-name">${d.아파트}</div>
  <div class="card-meta">${d.sido} ${d.gudong}</div>
  <div class="card-bottom">
    <div><div class="price-sub">최고 <b style="color:var(--red)">${f억(d.maxP)}</b></div><div class="price-sub">최저 <b style="color:var(--blue)">${f억(d.minP)}</b></div></div>
    <button class="loan-btn" onclick="event.stopPropagation();openM('${e(d.아파트)}',${d.maxP},${kr},'${d.regStatus}','2')">💰 대출 계산</button>
  </div>
</div>`;
}

function cardGap(d,idx){
    const kb=getKb(d.아파트,d.전용면적,d.sido,d.sigungu);
    return `<div class="card" onclick="openHistory('${e(d.아파트)}','${e(d.sido)}','${e(d.gudong)}')">
  <div style="position:absolute;top:0;right:0;background:var(--green);color:#fff;font-size:.58rem;font-weight:900;padding:.25rem .6rem;border-bottom-left-radius:.5rem">전세가율 ${Number(d.jeonseRatio).toFixed(1)}%</div>
  <div class="badge-row" style="margin-top:.2rem"><span class="badge badge-region">${d.sido} ${d.gudong}</span>${regBadge(d.regStatus)}</div>
  <div class="card-name">${idx+1}. ${d.아파트}</div>
  <div class="card-meta">${d.전용면적}㎡ · ${d.pyung}평</div>
  <div class="kb-compare-row">${kbChipHtml(d.price,kb,d.층||'2')}</div>
  <div class="gap-grid">
    <div class="gap-cell"><div class="gap-cell-label">매매가</div><div class="gap-cell-value">${f억(d.price)}</div></div>
    <div class="gap-div"></div>
    <div class="gap-cell"><div class="gap-cell-label">평균 전세가</div><div class="gap-cell-value">${f억(d.jeonsePrice)}</div></div>
    <div class="gap-div"></div>
    <div class="gap-cell"><div class="gap-cell-label">GAP</div><div class="gap-cell-value accent">${f억(d.gap)}</div></div>
  </div>
</div>`;
}

function cardCompare(d,idx){
    const kb=d.kb, ref=d.kbRef, isUp=d.diff>0, pct=Math.abs(d.diffPct).toFixed(1);
    const fill=Math.min(100,d.price/Math.max(d.price,kb.상한가)*100);
    const lbl=parseInt(d.층)===1?'KB하한(1층)':'KB일반';
    return `<div class="card" onclick="openHistory('${e(d.아파트)}','${e(d.sido)}','${e(d.gudong)}')">
  <div class="badge-row"><span class="badge badge-region">${d.sido} ${d.gudong}</span>${regBadge(d.regStatus)}<span class="diff-badge ${isUp?'over':'under'}" style="margin-left:auto">${isUp?'▲':'▼'}${pct}%</span></div>
  <div class="card-name">${d.아파트}</div>
  <div class="card-meta">${d.전용면적}㎡ · ${d.pyung}평 · ${d.층}층${parseInt(d.층)===1?' · 1층 하한가':''}</div>
  <div class="compare-grid">
    <div class="cmp-cell"><div class="cmp-label">실거래가</div><div class="cmp-value ${isUp?'up':'down'}">${f억(d.price)}</div></div>
    <div class="cmp-cell"><div class="cmp-label">${lbl}</div><div class="cmp-value">${f억(ref)}</div></div>
    <div class="cmp-cell"><div class="cmp-label">KB 하한가</div><div class="cmp-value" style="color:var(--text2)">${f억(kb.하한가)}</div></div>
    <div class="cmp-cell"><div class="cmp-label">KB 상한가</div><div class="cmp-value" style="color:var(--text2)">${f억(kb.상한가)}</div></div>
  </div>
  <div class="trend-bar"><div class="trend-fill" style="width:${fill}%;background:var(${isUp?'--red':'--green'})"></div></div>
  <div style="display:flex;justify-content:space-between;margin-top:.3rem">
    <span style="font-size:.58rem;color:var(--text3)">하한 ${f억(kb.하한가)}</span>
    <span style="font-size:.58rem;color:var(--text3)">상한 ${f억(kb.상한가)}</span>
  </div>
  <div style="text-align:right;margin-top:.5rem">
    <button class="loan-btn" onclick="event.stopPropagation();openM('${e(d.아파트)}',${d.price},${ref},'${d.regStatus}','${d.층}')">💰 대출 계산</button>
  </div>
</div>`;
}

// ═══ 거래이력 모달
function openHistory(name,sido,gudong){
    const list=allData.filter(d=>d.아파트===name&&d.sido===sido&&d.gudong===gudong)
        .sort((a,b)=>(b.계약년월+String(b.계약일).padStart(2,'0'))-(a.계약년월+String(a.계약일).padStart(2,'0')));
    g('history-apt-name').textContent=name; g('history-region').textContent=`${sido} ${gudong}`;
    if(!list.length){g('history-list').innerHTML='<p style="text-align:center;color:var(--text3);padding:2rem;font-size:.8rem">거래 내역이 없습니다</p>';}
    else{
        const maxP=Math.max(...list.map(d=>d.price)), kb=getKb(name,list[0].전용면적,sido,list[0].sigungu);
        let kbLine=kb?`<div style="background:var(--surface3);border:1px solid var(--border);border-radius:.5rem;padding:.5rem .875rem;margin-bottom:.75rem;font-size:.72rem;font-weight:700;color:var(--text2)">KB 하한 <b style="color:var(--text1)">${f억(kb.하한가)}</b> · 일반 <b style="color:var(--blue)">${f억(kb.일반거래가)}</b> · 상한 <b style="color:var(--text1)">${f억(kb.상한가)}</b></div>`:'';
        g('history-list').innerHTML=kbLine+list.map(d=>{
            const ym=String(d.계약년월), dt=`${ym.slice(0,4)}.${ym.slice(4)}.${String(d.계약일).padStart(2,'0')}`;
            return `<div class="history-item"><span class="history-date">${dt}</span><span class="history-area">${d.전용면적}㎡</span><span class="history-floor">${d.층}층</span><div style="text-align:right;flex:1"><div class="history-price" style="${d.price===maxP?'color:var(--red)':''}">${f억(d.price)}</div><div class="history-pyung">평당 ${d.pyungPrice.toLocaleString()}만</div></div></div>`;
        }).join('');
    }
    openM2('history-modal');
}

// ═══ 대출/세금 복합 모달
function openM(name,tradePrice,kbPrice,regStatus,floor){
    currentRegStatus=regStatus; currentKbPrice=kbPrice||0;
    g('modal-apt-name').textContent=name;
    const isSpec=regStatus==='투기과열지구', badge=g('modal-reg-badge');
    badge.textContent=isSpec?'투기과열지구 · LTV 40%':'비규제지역 · LTV 70%';
    badge.className=`reg-badge-modal ${isSpec?'regulated':'free'}`;
    const f1=parseInt(floor)===1;
    g('pcb-kb-label').textContent=f1?'KB 하한가 (1층)':'KB 일반거래가';
    g('pcb-trade').textContent=f억(tradePrice); g('pcb-kb').textContent=currentKbPrice>0?f억(currentKbPrice):'—';
    const tc=g('pcb-cell-trade'), kc=g('pcb-cell-kb');
    tc.classList.remove('active-ltv'); kc.classList.remove('active-ltv');
    if(currentKbPrice>0){(tradePrice<=currentKbPrice?tc:kc).classList.add('active-ltv');g('pcb-tag').style.display='';}
    else g('pcb-tag').style.display='none';
    g('calc-price').value=tradePrice; g('calc-kb-price').value=currentKbPrice||tradePrice;
    document.querySelectorAll('.modal-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.modal-panel').forEach(p=>p.classList.add('hidden'));
    document.querySelector('.modal-tab[data-tab="loan"]').classList.add('active');
    g('panel-loan').classList.remove('hidden');
    openM2('dsr-modal'); recalc();
}

function recalc(){calcLoan();calcTax();calcFee();}

function calcLoan(){
    const income=parseFloat(g('calc-income').value)||0, base=parseFloat(g('calc-base-rate').value)||0, stress=parseFloat(g('calc-stress').value)||0;
    const tP=parseFloat(g('calc-price').value)||0, kP=parseFloat(g('calc-kb-price').value)||0, first=g('calc-first-home').checked;
    const evalBase=kP>0?Math.min(tP,kP):tP, rate=(base+stress)/100, ltv=first?0.7:currentRegStatus==='투기과열지구'?0.4:0.7;
    const ltvLim=evalBase*ltv, dsrLim=income*.4, n=360, r=rate/12;
    const factor=r===0?1/n:r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1), dsrMax=dsrLim/(factor*12);
    const polLim=tP>250000?20000:tP>150000?40000:60000, loan=Math.min(ltvLim,dsrMax,polLim), cash=tP-loan;
    g('calc-result').textContent=fW(loan); g('calc-cash').textContent='필요 자본금: '+fW(cash);
    const note=g('calc-base-note');
    if(kP>0&&kP<tP){note.textContent=`⚠ KB시세(${f억(kP)}) 기준 LTV 적용`;note.style.color='var(--amber)';}
    else if(kP>0){note.textContent=`✓ 실거래가(${f억(tP)}) 기준 LTV 적용`;note.style.color='var(--green)';}
    else{note.textContent='KB 시세 없음 — 실거래가 기준 적용';note.style.color='var(--text3)';}
}

function calcTax(){
    const price=parseFloat(g('calc-price').value)||0, first=g('calc-first-home').checked;
    const hcEl=document.getElementById('calc-house-count'), hc=hcEl?parseInt(hcEl.value):1, isReg=currentRegStatus.includes('투기'), pw=price*10000;
    let rate;
    if(first)rate=.01;
    else if(hc===1)rate=price<=6000?.01:price<=90000?.02:.03;
    else if(hc===2)rate=isReg?.08:.01;
    else rate=isReg?.12:.08;
    const acq=Math.floor(pw*rate), edu=Math.floor(acq*.1), spec=rate>=.02?Math.floor(pw*.002):0, disc=first?Math.min(acq,2000000):0;
    g('tax-acquisition').textContent=fM(acq); g('tax-edu').textContent=fM(edu); g('tax-special').textContent=fM(spec);
    g('tax-discount').textContent=disc>0?'-'+fM(disc):'-'; g('tax-total').textContent=fM(acq+edu+spec-disc);
    g('tax-rate-note').textContent=`적용 취득세율: ${(rate*100).toFixed(0)}%`;
}

function calcFee(){
    const price=parseFloat(g('calc-price').value)||0;
    let rate=.007,cap=null;
    for(const t of BROKER){if(price<=t.max){rate=t.rate;cap=t.cap;break;}}
    let fee=Math.floor(price*rate)*10000; if(cap!==null)fee=Math.min(fee,cap);
    const vat=Math.floor(fee*.1);
    g('fee-rate').textContent=`${(rate*100).toFixed(1)}%`; g('fee-amount').textContent=fM(fee);
    g('fee-vat').textContent=fM(vat); g('fee-total').textContent=fM(fee+vat);
}

// ═══ 모달
function openM2(id){g(id).classList.add('open');document.body.style.overflow='hidden';}
function closeM(id){g(id).classList.remove('open');document.body.style.overflow='';}

// ═══ 유틸
function g(id)  {return document.getElementById(id);}
function e(s)   {return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
function f억(v) {return (v/10000).toFixed(2)+'억';}
function fM(v)  {return Math.floor(v/10000).toLocaleString()+'만원';}
function fW(v)  {return `${Math.floor(v/10000)}억 ${Math.floor(v%10000).toLocaleString()}만원`;}
function showEmpty(msg){const html=msg.split('\n').map(l=>`<p>${l}</p>`).join('');g('card-grid').innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-msg">${html}</div></div>`;}
