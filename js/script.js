'use strict';

// ═══ 인덱스 테이블
let SG   = [];
let DONG = [];
let APT  = [];
let APTN = [];

let allRows       = [];
let filteredRows  = [];
let renderedCount = 0;
const PAGE_SIZE   = 30;

let currentMode      = 'latest';
let currentRegStatus = '비규제지역';
let filterFrom       = 0;
let filterTo         = 0;

// ═══ 규제지역 (2025.10.16)
const SUWON_GW = new Set(['고색동','곡반정동','구운동','권선동','금곡동','당수동','세류동','오목천동','입북동','평동','호매실동','서둔동']);
const ANYANG_M = new Set(['안양동','박달동','석수동']);
const YONGIN_S = new Set(['동천동','상현동','성복동','신봉동','죽전동','고기동','풍덕천동','보정동']);

function getRegStatus(sido, sg, dong) {
    if (sido === '서울특별시') return '투기과열지구';
    if (sido !== '경기도')     return '비규제지역';
    if (['과천시','광명시','의왕시','하남시'].includes(sg)) return '투기과열지구';
    if (sg==='성남시') return '투기과열지구';
    if (sg==='수원시') return SUWON_GW.has(dong) ? '비규제지역' : '투기과열지구';
    if (sg==='안양시') return ANYANG_M.has(dong)  ? '비규제지역' : '투기과열지구';
    if (sg==='용인시') return YONGIN_S.has(dong)  ? '투기과열지구' : '비규제지역';
    return '비규제지역';
}

const BROKER = [
    {max:5000,   rate:.006,cap:250000}, {max:20000,  rate:.005,cap:800000},
    {max:90000,  rate:.004,cap:null},   {max:120000, rate:.005,cap:null},
    {max:150000, rate:.006,cap:null},   {max:Infinity,rate:.007,cap:null},
];

// ═══ 로드 파일 (운영 전환 시 주석 해제)
const TRADE_FILES = [
    { file:'trade_seoul.json',      sido:'서울특별시',    label:'서울' },
    { file:'trade_gyeonggi_a.json', sido:'경기도',        label:'경기(1/2)' },
    { file:'trade_gyeonggi_b.json', sido:'경기도',        label:'경기(2/2)' },
    { file:'trade_incheon.json',    sido:'인천광역시',    label:'인천' },
    { file:'trade_busan.json',      sido:'부산광역시',    label:'부산' },
    { file:'trade_daegu.json',      sido:'대구광역시',    label:'대구' },
    { file:'trade_gwangju.json',    sido:'광주광역시',    label:'광주' },
    { file:'trade_daejeon.json',    sido:'대전광역시',    label:'대전' },
    { file:'trade_ulsan.json',      sido:'울산광역시',    label:'울산' },
    { file:'trade_sejong.json',     sido:'세종특별자치시',label:'세종' },
    { file:'trade_gangwon.json',    sido:'강원특별자치도',label:'강원' },
    { file:'trade_chungbuk.json',   sido:'충청북도',      label:'충북' },
    { file:'trade_chungnam.json',   sido:'충청남도',      label:'충남' },
    { file:'trade_jeonbuk.json',    sido:'전북특별자치도',label:'전북' },
    { file:'trade_jeonnam.json',    sido:'전라남도',      label:'전남' },
    { file:'trade_gyeongbuk.json',  sido:'경상북도',      label:'경북' },
    { file:'trade_gyeongnam.json',  sido:'경상남도',      label:'경남' },
    { file:'trade_jeju.json',       sido:'제주특별자치도',label:'제주' },
];

// ═══ Sticky 오프셋 동적 계산
function updateStickyOffsets() {
    const header = document.querySelector('.app-header');
    const stats  = document.querySelector('.stats-wrap');
    if (!header || !stats) return;
    const hh = header.getBoundingClientRect().height;
    const sh = stats.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--header-h', hh + 'px');
    document.documentElement.style.setProperty('--stats-top', (hh + sh) + 'px');
}

// ═══ 초기화
document.addEventListener('DOMContentLoaded', () => {
    initSelects();
    setupEvents();
    loadData();
    requestAnimationFrame(updateStickyOffsets);
    window.addEventListener('resize', updateStickyOffsets, { passive:true });
});

function setLoader(t) { const e=document.querySelector('.loader-text'); if(e) e.textContent=t; }
function hideLoader()  { const e=g('loader'); if(e) e.style.display='none'; }

// ═══ 데이터 로드
function loadData() {
    const guard = setTimeout(() => {
        hideLoader();
        if (!allRows.length) showEmpty('⏱ 로딩 시간 초과\ntrade_seoul.json 파일을 찾을 수 없습니다.');
    }, 60000);

    let firstDone=false, idx=0;

    function next() {
        if (idx >= TRADE_FILES.length) { clearTimeout(guard); return; }
        const {file, sido, label} = TRADE_FILES[idx++];
        setLoader(`${label} 데이터 로드 중...`);
        fetch(file)
            .then(r => { if(!r.ok) throw new Error(`${file} 로드 실패 (${r.status})`); return r.json(); })
            .then(json => {
                if (!SG.length)   SG   = json.sg;
                if (!DONG.length) DONG = json.dong;
                if (!APT.length)  APT  = json.apt;
                if (!APTN.length) APTN = json.aptN;
                setLoader(`${label} 데이터 처리 중...`);
                const rows = json.d.map(r => {
                    const sg=json.sg[r[0]], dong=json.dong[r[1]], apt=json.apt[r[2]];
                    const area=r[4]/10, floor=r[5], ym=r[6], day=r[7];
                    const price=r[8], jPrice=r[9], gap=r[10], jRatio=r[11]/10;
                    const pyung=area/3.3058;
                    return {
                        sido, sg, dong,
                        gudong:`${sg} ${dong}`.trim(),
                        areaRound:Math.round(area),
                        regStatus:getRegStatus(sido,sg,dong),
                        apt, area, floor, ym, day,
                        price, jPrice, gap, jRatio,
                        pyung:pyung.toFixed(1),
                        pyungPrice:pyung>0?Math.round(price/pyung):0,
                    };
                });
                allRows.push(...rows);
                if (!firstDone) {
                    firstDone=true;
                    initSelects();
                    g('total-count').textContent=allRows.length.toLocaleString();
                    hideLoader();
                    applyFilter();
                } else {
                    g('total-count').textContent=allRows.length.toLocaleString();
                    initSelects();
                }
                next();
            })
            .catch(err => {
                if (!allRows.length && idx<=1) { clearTimeout(guard); hideLoader(); showEmpty('❌ '+err.message); }
                else { console.warn(`[스킵] ${file}: ${err.message}`); next(); }
            });
    }
    next();
}

// ═══ 날짜 필터
function getFiltered() {
    if (!filterFrom && !filterTo) return allRows;
    return allRows.filter(d => {
        const dk = d.ym*100+d.day;
        if (filterFrom && dk<filterFrom) return false;
        if (filterTo   && dk>filterTo)   return false;
        return true;
    });
}

// ═══ 셀렉트 초기화 (3단계)
function initSelects() {
    const seen=new Set(), sidoOrder=[];
    TRADE_FILES.forEach(({sido}) => { if(!seen.has(sido)){seen.add(sido);sidoOrder.push(sido);} });
    const sel=g('sido-select');
    sidoOrder.sort().forEach(s => {
        if(![...sel.options].some(o=>o.value===s)){
            const o=document.createElement('option'); o.value=s; o.textContent=s; sel.appendChild(o);
        }
    });
}
function updateGuOptions(sido) {
    const guSel=g('gu-select'), dSel=g('dong-select');
    guSel.innerHTML='<option value="all">전체 구</option>';
    dSel.innerHTML='<option value="all">전체 동</option>';
    guSel.disabled=sido==='all'; dSel.disabled=true;
    if (sido==='all') return;
    const gus=[...new Set(allRows.filter(d=>d.sido===sido).map(d=>d.sg))].sort();
    if (!gus.length) {
        const o=document.createElement('option'); o.value=''; o.textContent='(로드 중...)'; o.disabled=true;
        guSel.appendChild(o); return;
    }
    gus.forEach(gu=>{const o=document.createElement('option');o.value=gu;o.textContent=gu;guSel.appendChild(o);});
}
function updateDongOptions(sido,gu) {
    const dSel=g('dong-select');
    dSel.innerHTML='<option value="all">전체 동</option>'; dSel.disabled=gu==='all';
    if (gu==='all') return;
    [...new Set(allRows.filter(d=>d.sido===sido&&d.sg===gu).map(d=>d.dong))].sort()
        .forEach(dong=>{const o=document.createElement('option');o.value=dong;o.textContent=dong;dSel.appendChild(o);});
}
function updateStats(rows) {
    const p=(rows||allRows).map(d=>d.price).filter(Boolean);
    if(!p.length){['stat-avg','stat-med','stat-max'].forEach(id=>{const e=g(id);if(e)e.textContent='—';});return;}
    const s=[...p].sort((a,b)=>a-b);
    g('stat-avg').textContent=f억(p.reduce((a,b)=>a+b,0)/p.length);
    g('stat-med').textContent=f억(s[Math.floor(s.length/2)]);
    g('stat-max').textContent=f억(s[s.length-1]);
}

// ═══ 이벤트
function setupEvents() {
    g('sido-select').addEventListener('change',function(){updateGuOptions(this.value);applyFilter();});
    g('gu-select').addEventListener('change',function(){updateDongOptions(g('sido-select').value,this.value);applyFilter();});
    g('dong-select').addEventListener('change',applyFilter);
    g('search-input').addEventListener('input',debounce(applyFilter,200));
    g('date-from').addEventListener('change',applyDate);
    g('date-to').addEventListener('change',applyDate);
    document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',function(){
        document.querySelectorAll('.tab-btn').forEach(x=>x.classList.remove('active'));
        this.classList.add('active'); currentMode=this.dataset.mode; applyFilter();
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
    g('dsr-modal').addEventListener('click',ev=>{if(ev.target===g('dsr-modal'))closeModal('dsr-modal');});
    g('history-modal').addEventListener('click',ev=>{if(ev.target===g('history-modal'))closeModal('history-modal');});
}
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}
function applyDate() {
    const from=g('date-from').value, to=g('date-to').value, errEl=g('date-error');
    filterFrom=from?parseInt(from.replace('-','')+'01'):0;
    filterTo=to?parseInt(to.replace('-','')+'31'):0;
    if(from&&to){
        const diff=(new Date(to+'-01')-new Date(from+'-01'))/86400000;
        if(diff<0){if(errEl)errEl.textContent='종료일이 시작일보다 빠릅니다.';return;}
        if(diff>366){if(errEl)errEl.textContent='최대 1년 이내로 설정하세요.';return;}
    }
    if(errEl)errEl.textContent=''; applyFilter();
}

// ═══ 필터 & 정렬
function applyFilter() {
    const search=g('search-input').value.toLowerCase();
    const sido=g('sido-select').value, gu=g('gu-select').value, dong=g('dong-select').value;
    let rows=getFiltered().filter(d=>
        (sido==='all'||d.sido===sido)&&(gu==='all'||d.sg===gu)&&
        (dong==='all'||d.dong===dong)&&(search===''||d.apt.toLowerCase().includes(search))
    );

    if(currentMode==='latest')         { rows.sort((a,b)=>(b.ym*100+b.day)-(a.ym*100+a.day)); filteredRows=rows; }
    else if(currentMode==='top_price') { rows.sort((a,b)=>b.price-a.price); filteredRows=rows; }
    else if(currentMode==='volume')    {
        const grp={};
        rows.forEach(d=>{const k=`${d.sido}||${d.gudong}||${d.apt}`;
            if(!grp[k])grp[k]={...d,count:0,maxP:0,minP:Infinity};
            grp[k].count++;if(d.price>grp[k].maxP)grp[k].maxP=d.price;if(d.price<grp[k].minP)grp[k].minP=d.price;});
        filteredRows=Object.values(grp).sort((a,b)=>b.count-a.count);
    }
    else if(currentMode==='gap_invest') { filteredRows=rows.filter(d=>d.jRatio>0).sort((a,b)=>b.jRatio-a.jRatio); }

    updateStats(filteredRows);
    renderedCount=0;
    renderPage();
}

// ═══ 가상 스크롤
function renderPage() {
    const grid=g('card-grid'), total=filteredRows.length;
    if(!total){
        const isD=filterFrom>0||filterTo>0;
        grid.innerHTML=`<div class="empty-state">
  <div class="empty-icon">${isD?'📅':'🔍'}</div>
  <p class="empty-msg">${isD?'선택한 기간에 해당하는 거래가 없습니다':'검색 결과가 없습니다'}</p>
  ${isD?'<p class="empty-msg" style="font-size:.75rem;color:var(--text3);margin-top:.5rem">기간을 조정하거나 필터를 변경해 보세요</p>':''}
</div>`; return;
    }
    const slice=filteredRows.slice(renderedCount,renderedCount+PAGE_SIZE);
    const html=slice.map((d,i)=>buildCard(d,renderedCount+i)).join('');
    if(renderedCount===0){grid.innerHTML=html;}
    else{const s=document.getElementById('scroll-sentinel');if(s)s.remove();grid.insertAdjacentHTML('beforeend',html);}
    renderedCount+=slice.length;
    if(renderedCount<total) grid.insertAdjacentHTML('beforeend','<div id="scroll-sentinel" style="height:1px"></div>');
}
const ioObs=new IntersectionObserver(entries=>{if(entries[0].isIntersecting&&renderedCount<filteredRows.length)renderPage();},{rootMargin:'200px'});
const muObs=new MutationObserver(()=>{const s=document.getElementById('scroll-sentinel');if(s)ioObs.observe(s);});
document.addEventListener('DOMContentLoaded',()=>{const g2=g('card-grid');if(g2)muObs.observe(g2,{childList:true});});

// ═══ 카드
function buildCard(d,idx){return({volume:cardVolume,gap_invest:cardGap}[currentMode]||cardTrade)(d,idx);}
function regBadge(s){return s==='투기과열지구'?`<span class="badge badge-reg">🔴 투기과열</span>`:`<span class="badge badge-free">🟢 비규제</span>`;}
function fmtDate(ym,day){const y=String(ym),m=y.slice(4);return `${y.slice(0,4)}년 ${parseInt(m)}월 ${parseInt(day)}일`;}

function cardTrade(d) {
    return `<div class="card" onclick="openHistory('${e(d.apt)}','${e(d.sido)}','${e(d.gudong)}')">
  <div class="badge-row"><span class="badge badge-region">${d.sg} ${d.dong}</span>${regBadge(d.regStatus)}</div>
  <div class="card-name">${d.apt}</div>
  <div class="card-meta">${d.area}㎡ · ${d.pyung}평 · ${d.floor}층</div>
  <div class="card-date-row">📅 ${fmtDate(d.ym,d.day)}</div>
  <div class="card-bottom">
    <div><div class="price-main">${f억(d.price)}</div><div class="price-sub">평당 ${d.pyungPrice.toLocaleString()}만</div></div>
    <button class="loan-btn" onclick="event.stopPropagation();openM('${e(d.apt)}',${d.price},'${d.regStatus}','${d.floor}')">💰 대출 계산</button>
  </div>
</div>`;}

function cardVolume(d,idx) {
    return `<div class="card card-rank ${idx<3?'top':''}" onclick="openHistory('${e(d.apt)}','${e(d.sido)}','${e(d.gudong)}')">
  <div class="badge-row"><span class="rank-label">${idx+1}위</span><span class="vol-badge">${d.count}건</span></div>
  <div class="card-name">${d.apt}</div><div class="card-meta">${d.sg} ${d.dong}</div>
  <div class="card-bottom">
    <div><div class="price-sub">최고 <b style="color:var(--red)">${f억(d.maxP)}</b></div><div class="price-sub">최저 <b style="color:var(--blue)">${f억(d.minP)}</b></div></div>
    <button class="loan-btn" onclick="event.stopPropagation();openM('${e(d.apt)}',${d.maxP},'${d.regStatus}','2')">💰 대출 계산</button>
  </div>
</div>`;}

function cardGap(d,idx) {
    return `<div class="card" onclick="openHistory('${e(d.apt)}','${e(d.sido)}','${e(d.gudong)}')">
  <div style="position:absolute;top:0;right:0;background:var(--green);color:#fff;font-size:.58rem;font-weight:900;padding:.25rem .6rem;border-bottom-left-radius:.5rem">전세가율 ${d.jRatio.toFixed(1)}%</div>
  <div class="badge-row" style="margin-top:.2rem"><span class="badge badge-region">${d.sg} ${d.dong}</span>${regBadge(d.regStatus)}</div>
  <div class="card-name">${idx+1}. ${d.apt}</div>
  <div class="card-meta">${d.area}㎡ · ${d.pyung}평</div>
  <div class="gap-grid">
    <div class="gap-cell"><div class="gap-cell-label">매매가</div><div class="gap-cell-value">${f억(d.price)}</div></div>
    <div class="gap-div"></div>
    <div class="gap-cell"><div class="gap-cell-label">평균 전세가</div><div class="gap-cell-value">${f억(d.jPrice)}</div></div>
    <div class="gap-div"></div>
    <div class="gap-cell"><div class="gap-cell-label">GAP</div><div class="gap-cell-value accent">${f억(d.gap)}</div></div>
  </div>
</div>`;}

// ═══ 거래이력 모달
function openHistory(apt,sido,gudong) {
    const list=allRows.filter(d=>d.apt===apt&&d.sido===sido&&d.gudong===gudong)
        .sort((a,b)=>(b.ym*100+b.day)-(a.ym*100+a.day));
    g('history-apt-name').textContent=apt;
    g('history-region').textContent=`${sido} ${gudong}`;
    const maxP=list.length?Math.max(...list.map(d=>d.price)):0;
    const body=list.map(d=>{
        const ym=String(d.ym), dt=`${ym.slice(0,4)}.${ym.slice(4)}.${String(d.day).padStart(2,'0')}`;
        return `<div class="history-item">
  <div class="history-date-full">${fmtDate(d.ym,d.day)}</div>
  <div style="display:flex;gap:.4rem"><span class="history-area">${d.area}㎡</span><span class="history-floor">${d.floor}층</span></div>
  <div style="text-align:right;flex:1">
    <div class="history-price" style="${d.price===maxP?'color:var(--red)':''}">${f억(d.price)}</div>
    <div class="history-pyung">평당 ${d.pyungPrice.toLocaleString()}만</div>
  </div>
</div>`;}).join('')||'<p style="text-align:center;color:var(--text3);padding:2rem;font-size:.8rem">거래 내역이 없습니다</p>';
    g('history-list').innerHTML=body;
    openModal('history-modal');
}

// ═══ 대출/세금 모달
function openM(apt, price, regStatus, floor) {
    currentRegStatus=regStatus;
    g('modal-apt-name').textContent=apt;
    const isSpec=regStatus==='투기과열지구';
    const badge=g('modal-reg-badge');
    badge.textContent=isSpec?'투기과열지구 · LTV 40%':'비규제지역 · LTV 70%';
    badge.className=`reg-badge-modal ${isSpec?'regulated':'free'}`;
    g('calc-price').value=price;
    document.querySelectorAll('.modal-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.modal-panel').forEach(p=>p.classList.add('hidden'));
    document.querySelector('.modal-tab[data-tab="loan"]').classList.add('active');
    g('panel-loan').classList.remove('hidden');
    openModal('dsr-modal'); recalc();
}
function recalc(){calcLoan();calcTax();calcFee();}

function calcLoan() {
    const income=parseFloat(g('calc-income').value)||0, base=parseFloat(g('calc-base-rate').value)||0;
    const stress=parseFloat(g('calc-stress').value)||0, tP=parseFloat(g('calc-price').value)||0;
    const first=g('calc-first-home').checked;
    const rate=(base+stress)/100, ltv=first?0.7:currentRegStatus==='투기과열지구'?0.4:0.7;
    const n=360, r=rate/12, factor=r===0?1/n:r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1);
    const loan=Math.min(tP*ltv,(income*.4)/(factor*12),tP>250000?20000:tP>150000?40000:60000);
    g('calc-result').textContent=fW(loan);
    g('calc-cash').textContent='필요 자본금: '+fW(tP-loan);
}
function calcTax() {
    const price=parseFloat(g('calc-price').value)||0, first=g('calc-first-home').checked;
    const hc=parseInt(document.getElementById('calc-house-count')?.value||1);
    const isReg=currentRegStatus.includes('투기'), pw=price*10000;
    let rate;
    if(first)rate=.01;else if(hc===1)rate=price<=6000?.01:price<=90000?.02:.03;
    else if(hc===2)rate=isReg?.08:.01;else rate=isReg?.12:.08;
    const acq=Math.floor(pw*rate),edu=Math.floor(acq*.1),spec=rate>=.02?Math.floor(pw*.002):0;
    const disc=first?Math.min(acq,2000000):0;
    g('tax-acquisition').textContent=fM(acq); g('tax-edu').textContent=fM(edu);
    g('tax-special').textContent=fM(spec); g('tax-discount').textContent=disc>0?'-'+fM(disc):'-';
    g('tax-total').textContent=fM(acq+edu+spec-disc);
    g('tax-rate-note').textContent=`적용 취득세율: ${(rate*100).toFixed(0)}%`;
}
function calcFee() {
    const price=parseFloat(g('calc-price').value)||0;
    let rate=.007,cap=null;
    for(const t of BROKER){if(price<=t.max){rate=t.rate;cap=t.cap;break;}}
    let fee=Math.floor(price*rate)*10000;if(cap!==null)fee=Math.min(fee,cap);
    const vat=Math.floor(fee*.1);
    g('fee-rate').textContent=`${(rate*100).toFixed(1)}%`; g('fee-amount').textContent=fM(fee);
    g('fee-vat').textContent=fM(vat); g('fee-total').textContent=fM(fee+vat);
}

// ═══ 모달
function openModal(id){g(id).classList.add('open');document.body.style.overflow='hidden';}
function closeModal(id){g(id).classList.remove('open');document.body.style.overflow='';}

// ═══ 유틸
function g(id){return document.getElementById(id);}
function e(s){return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
function f억(v){return (v/10000).toFixed(2)+'억';}
function fM(v){return Math.floor(v/10000).toLocaleString()+'만원';}
function fW(v){return `${Math.floor(v/10000)}억 ${Math.floor(v%10000).toLocaleString()}만원`;}
function showEmpty(msg){
    const html=msg.split('\n').map(l=>`<p>${l}</p>`).join('');
    g('card-grid').innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-msg">${html}</div></div>`;}
