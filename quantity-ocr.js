/* Browser-only OCR. Images stay on this device; CDN supplies pinned engine/model files. */
(function(root){
'use strict';
const aliases=[['냉동기','chiller'],['냉각탑','coolingtower'],['축열조'],['보일러'],['열교환기'],['팽창탱크'],['펌프'],['지열'],['태양열'],['연료전지'],['패키지에어컨','패키지에어콘'],['항온항습기'],['공기조화기','공조기','ahu'],['팬코일유닛','팬코일유니트','팬코일','fcu'],['환기설비','환기팬'],['필터'],['위생기구'],['급수급탕','급수','급탕'],['고저수조','고가수조','저수조'],['오배수'],['오수정화'],['물재이용'],['배관'],['덕트'],['보온'],['자동제어'],['방음방진']];
const norm=s=>String(s).toLowerCase().replace(/[^가-힣a-z0-9]/g,'');
function parse(text){return String(text).split(/\r?\n/).map(line=>{
 const normalized=norm(line);if(!normalized||/합계|소계|총계/.test(line))return null;
 const hits=aliases.map((names,i)=>names.some(n=>normalized.includes(norm(n)))?i:-1).filter(i=>i>=0);
 if(!hits.length)return null;
 // Read numbers only after the last recognized equipment name, keeping model numbers visible for review.
 const positions=hits.flatMap(i=>aliases[i].map(n=>{const pattern=n.split('').join('\\s*');const m=line.match(new RegExp(pattern,'i'));return m?m.index+m[0].length:0}));
 const tail=line.slice(Math.max(...positions));
 const numbers=(tail.match(/\d[\d,]*(?:\.\d+)?/g)||[]).map(x=>x.replace(/,/g,''));
 return{line,index:hits.length===1?hits[0]:-1,numbers,value:numbers.length===1&&/^\d+$/.test(numbers[0])?numbers[0]:'',ambiguous:hits.length!==1||numbers.length!==1};
}).filter(Boolean)}
function plan(rows,base,allowed){const changes=[],seen=new Set();for(const r of rows){if(!r.checked)continue;const index=Number(r.index),value=String(r.value).trim(),col=base+index;if(!Number.isInteger(index)||index<0||index>=27||!allowed.has(col))throw Error('반영할 설비 항목을 선택하세요.');if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('수량은 0 이상의 정수로 입력하세요.');if(seen.has(col))throw Error('같은 설비가 여러 행에 있습니다. 합산 여부를 확인한 뒤 한 행만 선택하세요.');seen.add(col);changes.push({col,value:String(Number(value))})}if(!changes.length)throw Error('반영할 항목을 선택하세요.');return changes}
root.QuantityOCR={parse,plan,mount};
function mount(bar,ctx){
 bar.innerHTML='<button type="button" class="primary">사진으로 수량 입력</button><small>촬영·첨부 → 인식 결과 확인 → 입력 칸 반영 → 저장</small>';
 bar.querySelector('button').onclick=()=>open(ctx);
}
function open(ctx){
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dlg=document.createElement('dialog');dlg.className='quantityOcrDialog';
 dlg.innerHTML=`<div class="dlgHead"><h3>사진으로 수량 입력 · ${esc(ctx.title)}</h3><button type="button" data-close>닫기</button></div><p>현장: <strong>${esc(ctx.siteName||'신규 현장')}</strong></p><p>반영할 수량 열이 보이도록 표를 촬영하세요. 숫자 열이 여러 개면 아래 결과에서 사용할 수량을 선택해야 합니다.</p><div class="filterRow"><button type="button" data-camera>사진 촬영</button><button type="button" data-file>사진 첨부</button><button type="button" data-run class="primary" disabled>수량 자동인식</button></div><input hidden data-camera-input type="file" accept="image/*" capture="environment"><input hidden data-file-input type="file" accept="image/*"><img data-preview alt="첨부한 수량표" hidden><p data-status role="status" aria-live="polite"></p><label>인식된 글자 (수정 후 다시 분석 가능)<textarea data-text rows="6"></textarea></label><button type="button" data-parse>글자에서 수량 다시 분석</button><div data-results class="quantityOcrResults"></div><p>선택된 값만 입력 칸에 반영합니다. DB 저장은 현장정보 화면의 저장 버튼으로 완료하세요. 인식값은 반드시 원본과 대조하세요.</p><button type="button" data-apply class="primary">선택 항목 반영</button>`;
 document.body.append(dlg);dlg.showModal();
 const q=s=>dlg.querySelector(s);let file,url,worker,busy=false,cancelled=false;
 const status=s=>{q('[data-status]').textContent=s};
 const close=()=>{cancelled=true;if(worker){worker.terminate().catch(()=>{});worker=null}if(url)URL.revokeObjectURL(url);dlg.close();dlg.remove()};
 q('[data-close]').onclick=close;dlg.addEventListener('cancel',e=>{e.preventDefault();close()});
 q('[data-camera]').onclick=()=>q('[data-camera-input]').click();q('[data-file]').onclick=()=>q('[data-file-input]').click();
 function selected(e){if(busy)return;const f=e.target.files[0];e.target.value='';if(!f)return;if(!/^image\//.test(f.type)||f.size>20*1024*1024){status('20MB 이하의 사진 파일을 선택하세요. HEIC가 열리지 않으면 JPEG로 변환하세요.');return}file=f;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(f);q('[data-preview]').src=url;q('[data-preview]').hidden=false;q('[data-text]').value='';q('[data-results]').innerHTML='';q('[data-run]').disabled=false;status('사진이 준비되었습니다. 수량 자동인식을 눌러 주세요.')}
 q('[data-camera-input]').onchange=selected;q('[data-file-input]').onchange=selected;
 function results(){const rows=parse(q('[data-text]').value);q('[data-results]').innerHTML=rows.length?`<table><thead><tr><th>반영</th><th>사진에서 읽은 행</th><th>연결 항목</th><th>기존값</th><th>반영할 수량</th></tr></thead><tbody>${rows.map(r=>`<tr><td><input type="checkbox" data-check aria-label="반영 선택"></td><td>${esc(r.line)}${r.ambiguous?'<small>수량·항목 확인 필요</small>':''}</td><td><select data-index><option value="-1">항목 선택</option>${ctx.fields.map(f=>`<option value="${f.col-ctx.base}"${f.col-ctx.base===r.index?' selected':''}>${esc(f.name)}</option>`).join('')}</select></td><td data-old></td><td><input data-value type="text" inputmode="numeric" value="${esc(r.value)}" aria-label="반영할 수량">${r.numbers.length>1?`<select data-number><option value="">읽은 숫자 선택</option>${r.numbers.map(n=>`<option>${esc(n)}</option>`).join('')}</select>`:''}</td></tr>`).join('')}</tbody></table>`:'설비명과 수량을 찾지 못했습니다. 인식된 글자를 수정하거나 설비명과 수량이 선명한 사진으로 다시 시도하세요.';
 q('[data-results]').querySelectorAll('tbody tr').forEach(tr=>{const update=()=>{const i=Number(tr.querySelector('[data-index]').value);tr.querySelector('[data-old]').textContent=i>=0?ctx.getValue(ctx.base+i)||'공란':'-'};tr.querySelector('[data-index]').onchange=update;update();const select=tr.querySelector('[data-number]');if(select)select.onchange=()=>{tr.querySelector('[data-value]').value=select.value}});status(`${rows.length}개 행을 분석했습니다. 원본과 대조한 뒤 반영할 행을 체크하세요.`)}
 q('[data-parse]').onclick=results;
 q('[data-run]').onclick=async()=>{if(!file||busy)return;busy=true;dlg.querySelectorAll('[data-run],[data-camera],[data-file],[data-parse],[data-apply]').forEach(b=>b.disabled=true);try{
 status('인식 엔진을 준비하고 있습니다. 최초 실행은 시간이 걸릴 수 있습니다.');await load();if(cancelled)return;
 worker=await root.Tesseract.createWorker(['kor','eng'],1,{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',logger:m=>{if(!cancelled)status(`사진 인식 중: ${Math.round((m.progress||0)*100)}%`)}});
 if(cancelled){await worker.terminate();worker=null;return}const {data}=await worker.recognize(file);if(!cancelled){q('[data-text]').value=data.text;results()}
 }catch(e){if(!cancelled)status('사진 인식 실패: '+e.message+' · 인터넷 연결과 사진 형식을 확인하거나 인식된 글자를 직접 입력해 분석하세요.')}finally{if(worker){await worker.terminate().catch(()=>{});worker=null}busy=false;if(!cancelled)dlg.querySelectorAll('[data-run],[data-camera],[data-file],[data-parse],[data-apply]').forEach(b=>b.disabled=false)}};
 q('[data-apply]').onclick=()=>{try{const rows=[...q('[data-results]').querySelectorAll('tbody tr')].map(tr=>({checked:tr.querySelector('[data-check]').checked,index:tr.querySelector('[data-index]').value,value:tr.querySelector('[data-value]').value}));const changes=plan(rows,ctx.base,new Set(ctx.fields.map(f=>f.col)));if(changes.some(x=>String(ctx.getValue(x.col)||'')!==''&&String(ctx.getValue(x.col))!==x.value)&&!confirm('선택한 항목의 기존 수량을 변경합니다. 원본과 대조했습니까?'))return;ctx.apply(changes);close()}catch(e){status(e.message)}};
}
let loading;
function load(){if(root.Tesseract)return Promise.resolve();if(loading)return loading;loading=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';s.onload=()=>resolve();s.onerror=()=>{s.remove();loading=null;reject(Error('인식 엔진 다운로드 실패'))};document.head.append(s)});return loading}
})(typeof window==='undefined'?globalThis:window);
