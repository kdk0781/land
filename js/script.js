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

// kbMap 두 종류의 키 사용:
//   k1: "sido||sgg||aptN||area"  → entry (object, 1:1)
//   k2: "sido||aptN||area"       → [entry, ...] (배열, 모호성 체크용)
let kbMap = {};

let currentMode      = 'latest';
let currentRegStatus = '비규제지역';
let currentKbPrice   = 0;
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

// ═══ 로드 파일 (전국 — GitHub Actions로 자동 업데이트)
const TRADE_FILES = [
    { file:'trade_seoul.json',      sido:'서울특별시', label:'서울' },
    { file:'trade_gyeonggi_a.json', sido:'경기도',    label:'경기(1/2)' },
    { file:'trade_gyeonggi_b.json', sido:'경기도',    label:'경기(2/2)' },
    { file:'trade_incheon.json',    sido:'인천광역시', label:'인천' },
];

// ═══ 초기화
document.addEventListener('DOMContentLoaded', () => { setupEvents(); loadData(); });
function setLoader(t) { const e=document.querySelector('.loader-text'); if(e) e.textContent=t; }
function hideLoader()  { const e=g('loader'); if(e) e.style.display='none'; }

// ═══ 데이터 로드
function loadData() {
    const guard = setTimeout(() => {
        hideLoader();
        if (!allRows.length) showEmpty('⏱ 로딩 시간 초과\ntrade_seoul.json 파일을 찾을 수 없습니다.');
    }, 20000);

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
                // d: [sg_i, dong_i, apt_i, aptN_i, area×10, floor, ym, day, price, jPrice, gap, jRatio×10]
                const rows = json.d.map(r => {
                    const sg=json.sg[r[0]], dong=json.dong[r[1]], apt=json.apt[r[2]], aptN=json.aptN[r[3]];
                    const area=r[4]/10, floor=r[5], ym=r[6], day=r[7];
                    const price=r[8], jPrice=r[9], gap=r[10], jRatio=r[11]/10;
                    const pyung=area/3.3058;
                    return {
                        sido, sg, dong,
                        gudong:`${sg} ${dong}`.trim(),
                        areaRound:Math.round(area),
                        regStatus:getRegStatus(sido,sg,dong),
                        apt, aptN, area, floor, ym, day,
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
            .catch(err => { clearTimeout(guard); hideLoader(); if(!allRows.length) showEmpty('❌ '+err.message); });
    }
    next();

    // KB 백그라운드 로드
    fetch('kb.json')
        .then(r => r.ok ? r.json() : null)
        .then(json => {
            if (!json) return;
            const sgList = json.sg;
            json.d.forEach(row => {
                const [sg_i, aptN, area, low, mid, high] = row;
                if (!aptN || !area || !mid) return;
                const [sido, sgg] = sgList[sg_i];
                const entry = { 하한가:low, 일반거래가:mid, 상한가:high, sido, sigungu:sgg };
                // k1: 정밀키 (sido+sgg+aptN+area) → 1:1 (object)
                const k1 = `${sido}||${sgg}||${aptN}||${area}`;
                kbMap[k1] = entry;
                // k2: 집계키 (sido+aptN+area) → 배열 (모호성 체크용)
                const k2 = `${sido}||${aptN}||${area}`;
                if (!kbMap[k2]) kbMap[k2] = [];
                kbMap[k2].push(entry);
            });
            // KB 로드 건수 표시 (k2 키 수 = 실제 고유 아파트+면적 조합)
            const cnt = json.d.length;
            const s = g('kb-status');
            if (s) { s.textContent=`KB ${cnt.toLocaleString()}건 ✓`; s.className='kb-status loaded'; }
        })
        .catch(()=>{});
}

// ═══ KB 시세 조회 (3단계 엄격 매칭)
// ──────────────────────────────────────────────────────
// Level 1: sido+sgg+aptN+area (±5㎡) — 구까지 일치, 최고 신뢰도
// Level 2: sido+aptN+area (±5㎡)     — 유일한 구에만 존재할 때 반환
//          여러 구 존재 → null (모호 → 시세없음이 오매칭보다 낫다)
// 타 sido → 절대 반환 안 함 (타 지역 오매칭 완전 차단)
// ──────────────────────────────────────────────────────
function getKb(aptN, area, sido, sgg) {
    const ar = Math.round(parseFloat(area)||0);

    // Level 1: sgg 정밀 매칭 (±5㎡)
    for (let d=0; d<=5; d++) for (const dt of (d===0?[0]:[d,-d])) {
        const k = `${sido}||${sgg}||${aptN}||${ar+dt}`;
        if (kbMap[k]) return kbMap[k];
    }

    // Level 2: sido+aptN+area, 유일한 구일 때만 (±5㎡)
    for (let d=0; d<=5; d++) for (const dt of (d===0?[0]:[d,-d])) {
        const k = `${sido}||${aptN}||${ar+dt}`;
        if (!kbMap[k] || !kbMap[k].length) continue;
        const entries = kbMap[k];
        const uniqSggs = new Set(entries.map(e=>e.sigungu));
        if (uniqSggs.size === 1) return entries[0];
        break;  // 여러 구 → 모호, 중단
    }

    return null;
}

function getKbRef(aptN, area, floor, sido, sgg) {
    const kb=getKb(aptN,area,sido,sgg);
    if (!kb) return 0;
    return parseInt(floor)===1 ? kb.하한가 : kb.일반거래가;
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
    const sidos=[...new Set(allRows.map(d=>d.sido))].filter(Boolean).sort();
    const sel=g('sido-select');
    sidos.forEach(s=>{ if(![...sel.options].some(o=>o.value===s)){const o=document.createElement('option');o.value=s;o.textContent=s;sel.appendChild(o);} });
}
function updateGuOptions(sido) {
    const guSel=g('gu-select'), dSel=g('dong-select');
    guSel.innerHTML='<option value="all">전체 구</option>';
    dSel.innerHTML='<option value="all">전체 동</option>';
    guSel.disabled=sido==='all'; dSel.disabled=true;
    if (sido==='all') return;
    [...new Set(allRows.filter(d=>d.sido===sido).map(d=>d.sg))].sort()
        .forEach(gu=>{const o=document.createElement('option');o.value=gu;o.textContent=gu;guSel.appendChild(o);});
}
function updateDongOptions(sido, gu) {
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

// ═══ 필터 & 정렬
function applyFilter() {
    const search=g('search-input').value.toLowerCase();
    const sido=g('sido-select').value, gu=g('gu-select').value, dong=g('dong-select').value;
    let rows=getFiltered().filter(d=>
        (sido==='all'||d.sido===sido)&&(gu==='all'||d.sg===gu)&&
        (dong==='all'||d.dong===dong)&&(search===''||d.apt.toLowerCase().includes(search))
    );

    if(currentMode==='latest')        { rows.sort((a,b)=>(b.ym*100+b.day)-(a.ym*100+a.day)); filteredRows=rows; }
    else if(currentMode==='top_price'){ rows.sort((a,b)=>b.price-a.price); filteredRows=rows; }
    else if(currentMode==='volume')   {
        const grp={};
        rows.forEach(d=>{const k=`${d.sido}||${d.gudong}||${d.apt}`;if(!grp[k])grp[k]={...d,count:0,maxP:0,minP:Infinity};grp[k].count++;if(d.price>grp[k].maxP)grp[k].maxP=d.price;if(d.price<grp[k].minP)grp[k].minP=d.price;});
        filteredRows=Object.values(grp).sort((a,b)=>b.count-a.count);
    }
    else if(currentMode==='gap_invest'){ filteredRows=rows.filter(d=>d.jRatio>0).sort((a,b)=>b.jRatio-a.jRatio); }
    else if(currentMode==='compare')   {
        const grp={};
        rows.forEach(d=>{
            const kb=getKb(d.aptN,d.areaRound,d.sido,d.sg); if(!kb) return;
            const k=`${d.aptN}||${d.areaRound}`;
            if(!grp[k]||d.price>grp[k].price) grp[k]={...d,kb};
        });
        filteredRows=Object.values(grp).map(d=>{
            const ref=parseInt(d.floor)===1?d.kb.하한가:d.kb.일반거래가;
            const diff=d.price-ref;
            return{...d,kbRef:ref,diff,diffPct:ref>0?diff/ref*100:0};
        }).sort((a,b)=>Math.abs(b.diffPct)-Math.abs(a.diffPct));
    }

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
        this.classList.add('active');currentMode=this.dataset.mode;applyFilter();
    }));
    document.querySelectorAll('.modal-tab').forEach(t=>t.addEventListener('click',function(){
        document.querySelectorAll('.modal-tab').forEach(x=>x.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.modal-panel').forEach(p=>p.classList.add('hidden'));
        g('panel-'+this.dataset.tab).classList.remove('hidden');recalc();
    }));
    ['calc-income','calc-base-rate','calc-stress','calc-first-home','calc-house-count'].forEach(id=>{
        const el=document.getElementById(id);
        if(el){el.addEventListener('input',recalc);el.addEventListener('change',recalc);}
    });
    g('dsr-modal').addEventListener('click',ev=>{if(ev.target===g('dsr-modal'))closeModal('dsr-modal');});
    g('history-modal').addEventListener('click',ev=>{if(ev.target===g('history-modal'))closeModal('history-modal');});
}
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}
function applyDate(){
    const from=g('date-from').value,to=g('date-to').value,errEl=g('date-error');
    filterFrom=from?parseInt(from.replace('-','')+'01'):0;
    filterTo=to?parseInt(to.replace('-','')+'31'):0;
    if(from&&to){const diff=(new Date(to+'-01')-new Date(from+'-01'))/86400000;
        if(diff<0){if(errEl)errEl.textContent='종료일이 시작일보다 빠릅니다.';return;}
        if(diff>366){if(errEl)errEl.textContent='최대 1년 이내로 설정하세요.';return;}}
    if(errEl)errEl.textContent='';applyFilter();}

// ═══ 카드
function buildCard(d,idx){return({volume:cardVolume,gap_invest:cardGap,compare:cardCompare}[currentMode]||cardTrade)(d,idx);}
function regBadge(s){return s==='투기과열지구'?`<span class="badge badge-reg">🔴 투기과열</span>`:`<span class="badge badge-free">🟢 비규제</span>`;}
function fmtDate(ym,day){const y=String(ym),m=y.slice(4);return `${y.slice(0,4)}년 ${parseInt(m)}월 ${parseInt(day)}일`;}

function cardTrade(d){
    const kr=getKbRef(d.aptN,d.areaRound,d.floor,d.sido,d.sg);
    return `<div class="card" onclick="openHistory('${e(d.apt)}','${e(d.sido)}','${e(d.gudong)}')">
  <div class="badge-row"><span class="badge badge-region">${d.sg} ${d.dong}</span>${regBadge(d.regStatus)}</div>
  <div class="card-name">${d.apt}</div>
  <div class="card-meta">${d.area}㎡ · ${d.pyung}평 · ${d.floor}층</div>
  <div class="card-date-row">📅 ${fmtDate(d.ym,d.day)}</div>
  <div class="card-bottom">
    <div><div class="price-main">${f억(d.price)}</div><div class="price-sub">평당 ${d.pyungPrice.toLocaleString()}만</div></div>
    <button class="loan-btn" onclick="event.stopPropagation();openM('${e(d.apt)}',${d.price},${kr},'${d.regStatus}','${d.floor}')">💰 대출 계산</button>
  </div>
</div>`;}

function cardVolume(d,idx){
    const kr=getKbRef(d.aptN,d.areaRound,'2',d.sido,d.sg);
    return `<div class="card card-rank ${idx<3?'top':''}" onclick="openHistory('${e(d.apt)}','${e(d.sido)}','${e(d.gudong)}')">
  <div class="badge-row"><span class="rank-label">${idx+1}위</span><span class="vol-badge">${d.count}건</span></div>
  <div class="card-name">${d.apt}</div><div class="card-meta">${d.sg} ${d.dong}</div>
  <div class="card-bottom">
    <div><div class="price-sub">최고 <b style="color:var(--red)">${f억(d.maxP)}</b></div><div class="price-sub">최저 <b style="color:var(--blue)">${f억(d.minP)}</b></div></div>
    <button class="loan-btn" onclick="event.stopPropagation();openM('${e(d.apt)}',${d.maxP},${kr},'${d.regStatus}','2')">💰 대출 계산</button>
  </div>
</div>`;}

function cardGap(d,idx){
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

function cardCompare(d,idx){
    const kb=d.kb,ref=d.kbRef,isUp=d.diff>0,pct=Math.abs(d.diffPct).toFixed(1);
    const fill=Math.min(100,d.price/Math.max(d.price,kb.상한가)*100);
    const lbl=parseInt(d.floor)===1?'KB하한(1층)':'KB일반';
    return `<div class="card" onclick="openHistory('${e(d.apt)}','${e(d.sido)}','${e(d.gudong)}')">
  <div class="badge-row"><span class="badge badge-region">${d.sg} ${d.dong}</span>${regBadge(d.regStatus)}<span class="diff-badge ${isUp?'over':'under'}" style="margin-left:auto">${isUp?'▲':'▼'}${pct}%</span></div>
  <div class="card-name">${d.apt}</div>
  <div class="card-meta">${d.area}㎡ · ${d.pyung}평 · ${d.floor}층${parseInt(d.floor)===1?' · 1층→하한가':''}</div>
  <div class="compare-grid">
    <div class="cmp-cell"><div class="cmp-label">실거래가</div><div class="cmp-value ${isUp?'up':'down'}">${f억(d.price)}</div></div>
    <div class="cmp-cell"><div class="cmp-label">${lbl}</div><div class="cmp-value">${f억(ref)}</div></div>
    <div class="cmp-cell"><div class="cmp-label">KB 하한가</div><div class="cmp-value" style="color:var(--text2)">${f억(kb.하한가)}</div></div>
    <div class="cmp-cell"><div class="cmp-label">KB 상한가</div><div class="cmp-value" style="color:var(--text2)">${f억(kb.상한가)}</div></div>
  </div>
  <div class="trend-bar"><div class="trend-fill" style="width:${fill}%;background:var(${isUp?'--red':'--green'})"></div></div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.35rem">
    <span style="font-size:.58rem;color:var(--text3)">하한 ${f억(kb.하한가)}</span>
    <span style="font-size:.62rem;font-weight:800;color:var(${isUp?'--red':'--green'})">${isUp?'▲':'▼'}${pct}% 실거래 ${isUp?'높음':'낮음'}</span>
    <span style="font-size:.58rem;color:var(--text3)">상한 ${f억(kb.상한가)}</span>
  </div>
  <div style="text-align:right;margin-top:.625rem">
    <button class="loan-btn" onclick="event.stopPropagation();openM('${e(d.apt)}',${d.price},${ref},'${d.regStatus}','${d.floor}')">💰 대출 계산</button>
  </div>
</div>`;}

// ═══ 거래이력 모달
function openHistory(apt,sido,gudong){
    const list=allRows.filter(d=>d.apt===apt&&d.sido===sido&&d.gudong===gudong)
        .sort((a,b)=>(b.ym*100+b.day)-(a.ym*100+a.day));
    g('history-apt-name').textContent=apt;
    g('history-region').textContent=`${sido} ${gudong}`;
    const sg=list.length?list[0].sg:'';
    const kb=list.length?getKb(list[0].aptN,list[0].areaRound,sido,sg):null;
    const kbLine=kb
        ?`<div style="background:var(--surface3);border:1px solid var(--border);border-radius:.5rem;padding:.6rem .875rem;margin-bottom:.75rem;font-size:.72rem;font-weight:700;color:var(--text2)">
            KB 하한 <b style="color:var(--text1)">${f억(kb.하한가)}</b> &nbsp;·&nbsp;
            일반 <b style="color:var(--blue)">${f억(kb.일반거래가)}</b> &nbsp;·&nbsp;
            상한 <b style="color:var(--text1)">${f억(kb.상한가)}</b></div>`
        :`<div style="background:var(--surface3);border:1px solid var(--border);border-radius:.5rem;padding:.5rem .875rem;margin-bottom:.75rem;font-size:.72rem;color:var(--text3)">KB 시세 없음</div>`;
    const maxP=list.length?Math.max(...list.map(d=>d.price)):0;
    const body=list.map(d=>`<div class="history-item">
  <div class="history-date-full">${fmtDate(d.ym,d.day)}</div>
  <div style="display:flex;gap:.4rem"><span class="history-area">${d.area}㎡</span><span class="history-floor">${d.floor}층</span></div>
  <div style="text-align:right;flex:1">
    <div class="history-price" style="${d.price===maxP?'color:var(--red)':''}">${f억(d.price)}</div>
    <div class="history-pyung">평당 ${d.pyungPrice.toLocaleString()}만</div>
  </div>
</div>`).join('')||'<p style="text-align:center;color:var(--text3);padding:2rem;font-size:.8rem">거래 내역이 없습니다</p>';
    g('history-list').innerHTML=kbLine+body;
    openModal('history-modal');}

// ═══ 대출 모달
function openM(apt,tradePrice,kbPrice,regStatus,floor){
    currentRegStatus=regStatus;currentKbPrice=kbPrice||0;
    g('modal-apt-name').textContent=apt;
    const isSpec=regStatus==='투기과열지구';
    const badge=g('modal-reg-badge');
    badge.textContent=isSpec?'투기과열지구 · LTV 40%':'비규제지역 · LTV 70%';
    badge.className=`reg-badge-modal ${isSpec?'regulated':'free'}`;
    g('pcb-kb-label').textContent=parseInt(floor)===1?'KB 하한가 (1층)':'KB 일반거래가';
    g('pcb-trade').textContent=f억(tradePrice);
    const kve=g('pcb-kb');kve.textContent=currentKbPrice>0?f억(currentKbPrice):'시세없음';kve.style.color=currentKbPrice>0?'':'var(--text3)';
    const tc=g('pcb-cell-trade'),kc=g('pcb-cell-kb');
    tc.classList.remove('active-ltv');kc.classList.remove('active-ltv');
    if(currentKbPrice>0){(tradePrice<=currentKbPrice?tc:kc).classList.add('active-ltv');g('pcb-tag').style.display='';}
    else g('pcb-tag').style.display='none';
    g('calc-price').value=tradePrice;g('calc-kb-price').value=currentKbPrice||tradePrice;
    document.querySelectorAll('.modal-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.modal-panel').forEach(p=>p.classList.add('hidden'));
    document.querySelector('.modal-tab[data-tab="loan"]').classList.add('active');
    g('panel-loan').classList.remove('hidden');
    openModal('dsr-modal');recalc();}

function recalc(){calcLoan();calcTax();calcFee();}
function calcLoan(){
    const income=parseFloat(g('calc-income').value)||0,base=parseFloat(g('calc-base-rate').value)||0;
    const stress=parseFloat(g('calc-stress').value)||0,tP=parseFloat(g('calc-price').value)||0;
    const kP=parseFloat(g('calc-kb-price').value)||0,first=g('calc-first-home').checked;
    const evalBase=kP>0?Math.min(tP,kP):tP,rate=(base+stress)/100;
    const ltv=first?0.7:currentRegStatus==='투기과열지구'?0.4:0.7;
    const n=360,r=rate/12,factor=r===0?1/n:r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1);
    const loan=Math.min(evalBase*ltv,(income*.4)/(factor*12),tP>250000?20000:tP>150000?40000:60000);
    g('calc-result').textContent=fW(loan);g('calc-cash').textContent='필요 자본금: '+fW(tP-loan);
    const note=g('calc-base-note');
    if(kP>0&&kP<tP){note.textContent=`⚠ KB시세(${f억(kP)}) 기준 LTV 적용`;note.style.color='var(--amber)';}
    else if(kP>0){note.textContent=`✓ 실거래가(${f억(tP)}) 기준 LTV 적용`;note.style.color='var(--green)';}
    else{note.textContent='KB 시세 없음 — 실거래가 기준 적용';note.style.color='var(--text3)';}
}
function calcTax(){
    const price=parseFloat(g('calc-price').value)||0,first=g('calc-first-home').checked;
    const hc=parseInt(document.getElementById('calc-house-count')?.value||1);
    const isReg=currentRegStatus.includes('투기'),pw=price*10000;
    let rate;
    if(first)rate=.01;else if(hc===1)rate=price<=6000?.01:price<=90000?.02:.03;
    else if(hc===2)rate=isReg?.08:.01;else rate=isReg?.12:.08;
    const acq=Math.floor(pw*rate),edu=Math.floor(acq*.1),spec=rate>=.02?Math.floor(pw*.002):0;
    const disc=first?Math.min(acq,2000000):0;
    g('tax-acquisition').textContent=fM(acq);g('tax-edu').textContent=fM(edu);
    g('tax-special').textContent=fM(spec);g('tax-discount').textContent=disc>0?'-'+fM(disc):'-';
    g('tax-total').textContent=fM(acq+edu+spec-disc);
    g('tax-rate-note').textContent=`적용 취득세율: ${(rate*100).toFixed(0)}%`;
}
function calcFee(){
    const price=parseFloat(g('calc-price').value)||0;
    let rate=.007,cap=null;
    for(const t of BROKER){if(price<=t.max){rate=t.rate;cap=t.cap;break;}}
    let fee=Math.floor(price*rate)*10000;if(cap!==null)fee=Math.min(fee,cap);
    const vat=Math.floor(fee*.1);
    g('fee-rate').textContent=`${(rate*100).toFixed(1)}%`;g('fee-amount').textContent=fM(fee);
    g('fee-vat').textContent=fM(vat);g('fee-total').textContent=fM(fee+vat);
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
