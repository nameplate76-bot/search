/* Browser-only OCR. Images stay on this device; CDN supplies pinned engine/model files. */
(function(root){
'use strict';
const aliases=[['냉동기','chiller'],['냉각탑','coolingtower'],['축열조'],['보일러'],['열교환기'],['팽창탱크'],['펌프'],['지열'],['태양열'],['연료전지'],['패키지에어컨','패키지에어콘'],['항온항습기'],['공기조화기','공조기','ahu'],['팬코일유닛','팬코일유니트','팬코일','팬코일유닛유니트','fcu'],['환기설비','환기팬'],['필터'],['위생기구'],['급수급탕','급수','급탕'],['고저수조','고가수조','저수조'],['오배수'],['오수정화','오수처리'],['물재이용'],['배관'],['덕트'],['보온','보온설비'],['자동제어'],['방음방진']];
const norm=s=>String(s).toLowerCase().replace(/[^가-힣a-z0-9]/g,'');
function parse(text){return String(text).split(/\r?\n/).map(line=>{
 if(line.includes(' | 수량 칸: ')){const [name,qty]=line.split(' | 수량 칸: ');return cellRow(name,qty==='공란'?'':qty)}
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
root.QuantityOCR={parse,plan,mount,detectGrid,rowBounds,classify,cellRow};
function equipmentText(text){const first=String(text).split(/\n|[（({]/)[0];return norm(/신재생/.test(first)?String(text).split(/\n/)[0]:first)}
function distance(a,b){let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next[j+1]=Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]===b[j]?0:1));row=next}return row[b.length]}
function classify(text){
 const first=equipmentText(text);
 const candidates=aliases.flatMap((ns,i)=>ns.filter(n=>first.includes(norm(n))).map(n=>({index:i,length:norm(n).length})));
 if(candidates.length){candidates.sort((a,b)=>b.length-a.length);return candidates[0].index}
 const possible=new Set();aliases.forEach((ns,i)=>ns.forEach(n=>{const word=norm(n);if(word.length<3)return;for(let k=0;k<=first.length-word.length;k++)if(distance(word,first.slice(k,k+word.length))===1)possible.add(i)}));
 return possible.size===1?[...possible][0]:-1;
}
function cellRow(name,qty){const cleaned=String(qty).trim().replace(/\s/g,'').replace(/,/g,'');
 const index=classify(name),value=/^\d+$/.test(cleaned)?cleaned:'';
 return{line:String(name).trim().replace(/\s*\n\s*/g,' ')+' | 수량 칸: '+(cleaned||'공란'),index,numbers:value?[value]:[],value,ambiguous:index<0||!value||!aliases[index].some(n=>equipmentText(name).includes(norm(n)))};
}
function clusters(values){const out=[];let start=values[0],last=start;for(let i=1;i<=values.length;i++){if(i<values.length&&values[i]<=last+2){last=values[i];continue}if(start!==undefined)out.push(Math.round((start+last)/2));start=last=values[i]}return out}
function dark(data,w,x,y){const i=(y*w+x)*4;return data[i]*.299+data[i+1]*.587+data[i+2]*.114<175}
function detectGrid(data,w,h){
 const xs=[],limits=[];
 for(let x=0;x<w;x++){let run=0,best=0,end=0;for(let y=0;y<h;y++){run=dark(data,w,x,y)?run+1:0;if(run>best){best=run;end=y}}
 if(best>h*.18){xs.push(x);limits.push({top:end-best+1,bottom:end})}}
 const columns=clusters(xs);if(columns.length<4||columns.length>20)return null;
 const top=Math.min(...limits.map(v=>v.top)),bottom=Math.max(...limits.map(v=>v.bottom));
 return{columns,top,bottom};
}
function rowBounds(data,w,grid,nameColumn){const left=grid.columns[nameColumn]+2,right=grid.columns[nameColumn+1]-2,ys=[];
 if(right-left<10)return[];for(let y=grid.top;y<=grid.bottom;y++){let n=0;for(let x=left;x<=right;x++)if(dark(data,w,x,y))n++;if(n>(right-left+1)*.85)ys.push(y)}
 return clusters(ys);
}
function cropCanvas(image,left,top,right,bottom){const w=Math.max(1,right-left),h=Math.max(1,bottom-top),scale=Math.min(4,2200/w),pad=12;
 const small=document.createElement('canvas');small.width=w;small.height=h;const sg=small.getContext('2d',{willReadFrequently:true});sg.drawImage(image,left,top,w,h,0,0,w,h);const pixels=sg.getImageData(0,0,w,h);let min=255,max=0;
 for(let i=0;i<pixels.data.length;i+=4){const gray=Math.round(pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114);pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=gray;min=Math.min(min,gray);max=Math.max(max,gray)}
 if(max-min>30)for(let i=0;i<pixels.data.length;i+=4){const v=Math.round((pixels.data[i]-min)*255/(max-min));pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v}sg.putImageData(pixels,0,0);
 const c=document.createElement('canvas');c.width=Math.round(w*scale)+pad*2;c.height=Math.round(h*scale)+pad*2;const g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,c.width,c.height);g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';g.drawImage(small,pad,pad,w*scale,h*scale);return c;
}

function mount(bar,ctx){
 bar.innerHTML='<button type="button" class="primary">사진으로 수량 입력</button><small>촬영·첨부 → 인식 결과 확인 → 입력 칸 반영 → 저장</small>';
 bar.querySelector('button').onclick=()=>open(ctx);
}
function open(ctx){
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dlg=document.createElement('dialog');dlg.className='quantityOcrDialog';
 dlg.innerHTML=`<div class="dlgHead"><h3>사진으로 수량 입력 · ${esc(ctx.title)}</h3><button type="button" data-close>닫기</button></div><p>현장: <strong>${esc(ctx.siteName||'신규 현장')}</strong></p><p>반영할 수량 열이 보이도록 표를 촬영하세요. 숫자 열이 여러 개면 아래 결과에서 사용할 수량을 선택해야 합니다.</p><div class="filterRow"><button type="button" data-camera>사진 촬영</button><button type="button" data-file>사진 첨부</button><button type="button" data-run class="primary" disabled>수량 자동인식</button></div><input hidden data-camera-input type="file" accept="image/*" capture="environment"><input hidden data-file-input type="file" accept="image/*"><img data-preview alt="첨부한 수량표" hidden><canvas data-grid-preview hidden aria-label="표의 열 번호"></canvas><div class="quantityOcrOptions"><label>사진의 수량 종류<select data-source><option value="">선택하세요</option><option value="55">유지관리 전체수량</option><option value="83">성능점검 대상 전체수량</option><option value="111">실제 점검수량 (전체수량 아님)</option></select></label><label>설비명이 있는 열<select data-name-col></select></label><label>읽을 수량 열<select data-qty-col></select></label><label><input type="checkbox" data-header checked> 표 첫 행은 제목이므로 제외</label><p>미리보기 위의 열 번호를 기준으로 선택하세요. 전체수량 칸이 비어 있으면 점검수량에서 가져오지 않습니다.</p></div><p data-status role="status" aria-live="polite"></p><label>인식된 글자 (수정 후 다시 분석 가능)<textarea data-text rows="6"></textarea></label><button type="button" data-parse>글자에서 수량 다시 분석</button><div data-results class="quantityOcrResults"></div><p>선택된 값만 입력 칸에 반영합니다. DB 저장은 현장정보 화면의 저장 버튼으로 완료하세요. 인식값은 반드시 원본과 대조하세요.</p><button type="button" data-apply class="primary">선택 항목 반영</button>`;
 document.body.append(dlg);dlg.showModal();
 const q=s=>dlg.querySelector(s);let file,url,worker,numberWorker,busy=false,cancelled=false,sourceImage,grid,pixels;
 const status=s=>{q('[data-status]').textContent=s};
 const close=()=>{cancelled=true;if(numberWorker){numberWorker.terminate().catch(()=>{});numberWorker=null}if(worker){worker.terminate().catch(()=>{});worker=null}if(url)URL.revokeObjectURL(url);dlg.close();dlg.remove()};
 q('[data-close]').onclick=close;dlg.addEventListener('cancel',e=>{e.preventDefault();close()});
 q('[data-camera]').onclick=()=>q('[data-camera-input]').click();q('[data-file]').onclick=()=>q('[data-file-input]').click();
 async function selected(e){if(busy)return;const f=e.target.files[0];e.target.value='';if(!f)return;if(!/^image\//.test(f.type)||f.size>20*1024*1024){status('20MB 이하의 사진 파일을 선택하세요. HEIC가 열리지 않으면 JPEG로 변환하세요.');return}file=f;sourceImage=null;grid=null;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(f);q('[data-preview]').src=url;q('[data-preview]').hidden=false;q('[data-grid-preview]').hidden=true;q('[data-text]').value='';q('[data-results]').innerHTML='';q('[data-run]').disabled=true;
 try{const image=new Image();image.src=url;await image.decode();if(cancelled)return;
 const c=document.createElement('canvas'),scale=Math.min(1,1800/image.width);c.width=Math.round(image.width*scale);c.height=Math.round(image.height*scale);const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(image,0,0,c.width,c.height);sourceImage=c;pixels=g.getImageData(0,0,c.width,c.height);grid=detectGrid(pixels.data,c.width,c.height);
 for(const key of ['name','qty']){q('[data-'+key+'-col]').innerHTML='<option value="">선택하세요</option>'+(grid?grid.columns.slice(0,-1).map((_,i)=>`<option value="${i}">${i+1}열</option>`).join(''):'<option value="">격자 감지 불가</option>')}
 if(grid){q('[data-name-col]').value='1';const preview=q('[data-grid-preview]');preview.width=c.width;preview.height=c.height+30;const pg=preview.getContext('2d');pg.fillStyle='white';pg.fillRect(0,0,preview.width,preview.height);pg.drawImage(c,0,30);pg.font='bold 14px sans-serif';pg.fillStyle='#064cb5';pg.textAlign='center';for(let i=0;i<grid.columns.length-1;i++){pg.fillText(String(i+1)+'열',(grid.columns[i]+grid.columns[i+1])/2,20);pg.strokeStyle='#1976d2';pg.strokeRect(grid.columns[i],grid.top+30,grid.columns[i+1]-grid.columns[i],grid.bottom-grid.top)}preview.hidden=false;q('[data-preview]').hidden=true;status('표의 격자를 찾았습니다. 사진의 수량 종류와 읽을 수량 열을 선택하세요.')}
 else status('격자를 찾지 못했습니다. 확대 인식으로 진행합니다. 결과의 수량을 직접 대조하세요.');q('[data-run]').disabled=false;
 }catch(err){file=null;status('사진을 열 수 없습니다. JPEG/PNG로 변환한 뒤 다시 첨부하세요.')} }
 q('[data-camera-input]').onchange=selected;q('[data-file-input]').onchange=selected;
 function results(rows){rows=rows||parse(q('[data-text]').value);q('[data-results]').innerHTML=rows.length?`<table><thead><tr><th>반영</th><th>사진에서 읽은 행</th><th>연결 항목</th><th>기존값</th><th>반영할 수량</th></tr></thead><tbody>${rows.map(r=>`<tr><td><input type="checkbox" data-check aria-label="반영 선택"></td><td>${esc(r.line)}${r.ambiguous?'<small>수량·설비명 확인 필요</small>':''}</td><td><select data-index><option value="-1">항목 선택</option>${ctx.fields.map(f=>`<option value="${f.col-ctx.base}"${f.col-ctx.base===r.index?' selected':''}>${esc(f.name)}</option>`).join('')}</select></td><td data-old></td><td><input data-value type="text" inputmode="numeric" value="${esc(r.value)}" aria-label="반영할 수량">${r.numbers.length>1?`<select data-number><option value="">읽은 숫자 선택</option>${r.numbers.map(n=>`<option>${esc(n)}</option>`).join('')}</select>`:''}</td></tr>`).join('')}</tbody></table>`:'설비명과 수량을 찾지 못했습니다. 인식된 글자를 수정하거나 설비명과 수량이 선명한 사진으로 다시 시도하세요.';
 q('[data-results]').querySelectorAll('tbody tr').forEach(tr=>{const update=()=>{const i=Number(tr.querySelector('[data-index]').value);tr.querySelector('[data-old]').textContent=i>=0?ctx.getValue(ctx.base+i)||'공란':'-'};tr.querySelector('[data-index]').onchange=update;update();const select=tr.querySelector('[data-number]');if(select)select.onchange=()=>{tr.querySelector('[data-value]').value=select.value}});status(`${rows.length}개 행을 분석했습니다. 원본과 대조한 뒤 반영할 행을 체크하세요.`)}
 q('[data-parse]').onclick=()=>results();
 for(const key of ['source','name-col','qty-col','header'])q('[data-'+key+']').onchange=()=>{q('[data-text]').value='';q('[data-results]').innerHTML='';status('설정이 바뀌었습니다. 수량 자동인식을 다시 눌러 주세요.');};
 q('[data-run]').onclick=async()=>{if(!file||!sourceImage||busy)return;
 if(Number(q('[data-source]').value)!==ctx.base){status('사진의 수량 종류를 확인하세요. 이 창은 '+ctx.title+' 입력용입니다. 성능점검 표는 성능점검 대상 전체수량 탭에서 입력하세요. 실제 점검수량을 전체수량으로 반영할 수 없습니다.');return}
 if(grid&&(q('[data-name-col]').value===''||q('[data-qty-col]').value===''||q('[data-name-col]').value===q('[data-qty-col]').value)){status('설비명 열과 수량 열을 서로 다르게 선택하세요.');return}
 busy=true;dlg.querySelectorAll('[data-run],[data-camera],[data-file],[data-parse],[data-apply],[data-source],[data-name-col],[data-qty-col],[data-header]').forEach(b=>b.disabled=true);try{
 status('인식 엔진을 준비하고 있습니다. 최초 실행은 시간이 걸릴 수 있습니다.');await load();if(cancelled)return;
 worker=await root.Tesseract.createWorker(['kor','eng'],1,{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',logger:m=>{if(!cancelled)status(`사진 인식 중: ${Math.round((m.progress||0)*100)}%`)}});
 if(cancelled){await worker.terminate();worker=null;return}
 if(grid){numberWorker=await root.Tesseract.createWorker('eng',1,{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0'});await numberWorker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789,-'});if(cancelled){await numberWorker.terminate();numberWorker=null;return}const nameCol=Number(q('[data-name-col]').value),qtyCol=Number(q('[data-qty-col]').value),bounds=rowBounds(pixels.data,sourceImage.width,grid,nameCol),rows=[];
 const first=q('[data-header]').checked?1:0;
 if(bounds.length<3)throw Error('표의 행을 구분하지 못했습니다. 설비명 열을 다시 선택하거나 더 선명한 표를 첨부하세요.');
 for(let i=first;i<bounds.length-1;i++){if(cancelled)break;status(`표의 ${i-first+1}/${bounds.length-1-first}행을 인식합니다.`);
 const top=bounds[i]+2,bottom=bounds[i+1]-1;
 await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
 const named=await worker.recognize(cropCanvas(sourceImage,grid.columns[nameCol]+2,top,grid.columns[nameCol+1]-1,bottom));
 const quantity=await numberWorker.recognize(cropCanvas(sourceImage,grid.columns[qtyCol]+2,top,grid.columns[qtyCol+1]-1,bottom));
 const row=cellRow(named.data.text,quantity.data.text);row.line=`${i+1}행 · `+row.line;rows.push(row);
 }
 if(!cancelled){q('[data-text]').value=rows.map(r=>r.line).join('\n');results(rows);status(`${rows.length}개 행을 칸별로 분석했습니다. 공란과 '-'는 숫자로 바꾸지 않습니다. 원본과 대조한 뒤 반영할 행을 체크하세요.`)}
 }else{await worker.setParameters({tessedit_pageseg_mode:'6'});const {data}=await worker.recognize(cropCanvas(sourceImage,0,0,sourceImage.width,sourceImage.height));if(!cancelled){q('[data-text]').value=data.text;results()}}

 }catch(e){if(!cancelled)status('사진 인식 실패: '+e.message+' · 인터넷 연결과 사진 형식을 확인하거나 인식된 글자를 직접 입력해 분석하세요.')}finally{if(numberWorker){await numberWorker.terminate().catch(()=>{});numberWorker=null}if(worker){await worker.terminate().catch(()=>{});worker=null}busy=false;if(!cancelled)dlg.querySelectorAll('[data-run],[data-camera],[data-file],[data-parse],[data-apply],[data-source],[data-name-col],[data-qty-col],[data-header]').forEach(b=>b.disabled=false)}};
 q('[data-apply]').onclick=()=>{try{if(Number(q('[data-source]').value)!==ctx.base)throw Error('사진의 수량 종류를 현재 전체수량 탭에 맞게 선택하세요.');const rows=[...q('[data-results]').querySelectorAll('tbody tr')].map(tr=>({checked:tr.querySelector('[data-check]').checked,index:tr.querySelector('[data-index]').value,value:tr.querySelector('[data-value]').value}));const changes=plan(rows,ctx.base,new Set(ctx.fields.map(f=>f.col)));if(changes.some(x=>String(ctx.getValue(x.col)||'')!==''&&String(ctx.getValue(x.col))!==x.value)&&!confirm('선택한 항목의 기존 수량을 변경합니다. 원본과 대조했습니까?'))return;ctx.apply(changes);close()}catch(e){status(e.message)}};
}
let loading;
function load(){if(root.Tesseract)return Promise.resolve();if(loading)return loading;loading=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';s.onload=()=>resolve();s.onerror=()=>{s.remove();loading=null;reject(Error('인식 엔진 다운로드 실패'))};document.head.append(s)});return loading}
})(typeof window==='undefined'?globalThis:window);
