const assert=require('node:assert/strict');require('../quantity-ocr.js');
const q=global.QuantityOCR;
assert.equal(q.parse('냉 동 기 4대')[0].value,'4');
assert.equal(q.parse('AHU 6대')[0].index,12);
assert.equal(q.parse('팬코일유닛 1,200대')[0].value,'1200');
assert.equal(q.parse('펌프 12 3')[0].value,'');
assert.equal(q.parse('냉동기 합계 8').length,0);
assert.equal(q.parse('보일러 42 kW 2대')[0].ambiguous,true);
assert.equal(q.parse('냉동기 냉각탑 4')[0].index,-1);
const allowed=new Set(Array.from({length:27},(_,i)=>55+i));
assert.deepEqual(q.plan([{checked:true,index:0,value:'0'}],55,allowed),[{col:55,value:'0'}]);
for(const value of ['-1','1.2','','1e2','9007199254740993'])assert.throws(()=>q.plan([{checked:true,index:0,value}],55,allowed));
assert.throws(()=>q.plan([{checked:true,index:0,value:'2'},{checked:true,index:0,value:'4'}],55,allowed));
assert.throws(()=>q.plan([{checked:true,index:27,value:'2'}],55,allowed));
assert.throws(()=>q.plan([{checked:true,index:0,value:'2'}],55,new Set([56])));
assert.throws(()=>q.plan([{checked:false,index:0,value:'2'}],55,allowed));
assert.equal(q.plan([{checked:true,index:26,value:'3'}],83,new Set([109]))[0].col,109);
console.log('PASS: quantity OCR parsing and safe selective application');

assert.equal(q.classify('신재생에너지(지열)'),7);
assert.equal(q.classify('항몬항습기(내부필터 포함)'),11);
assert.equal(q.classify('HIY 유닛{유니트 기준, 내부필터 포함)'),-1);
assert.equal(q.cellRow('보일러 (42 kW 이하 제외)','4').value,'4');
assert.equal(q.cellRow('공기조화기 (송풍기 포함)','3').index,12);
assert.equal(q.cellRow('보온설비','-').value,'');
assert.equal(q.cellRow('덕트설비','').value,'');
assert.equal(q.parse('보일러 (42 kW 이하 제외) | 수량 칸: 4')[0].value,'4');
const d=new Uint8ClampedArray(200*300*4).fill(255);
for(const x of [10,50,100,130,190])for(let y=20;y<=280;y++){const i=(y*200+x)*4;d[i]=d[i+1]=d[i+2]=0}
for(const y of [20,50,80,110,150,200,280])for(let x=10;x<=190;x++){const i=(y*200+x)*4;d[i]=d[i+1]=d[i+2]=0}
const grid=q.detectGrid(d,200,300);assert.deepEqual(grid.columns,[10,50,100,130,190]);assert.deepEqual(q.rowBounds(d,200,grid,1),[20,50,80,110,150,200,280]);
console.log('PASS: table geometry, qualifier exclusion, cropped-cell values, blanks and OCR typo candidates');
