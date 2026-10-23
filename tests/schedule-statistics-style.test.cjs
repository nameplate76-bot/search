const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8')),w=dom.window,d=w.document;
d.getElementById('scheduleCalendar').innerHTML='<button class="scheduleMonthCard"><div class="scheduleMonthHead"><strong>1월</strong><b>0건</b></div><div class="scheduleMiniGrid"><span>1</span></div><small>평일 0/21일 · 0%</small></button><div class="scheduleMonthTitle"><h3>2026년 1월</h3><span>현장 0건 · 평일 0/21일 등록</span></div>';
d.getElementById('scheduleMessage').className='meta';d.getElementById('scheduleMessage').textContent='2026년 점검계획 45건';
for(const selector of ['.scheduleMonthHead>b','.scheduleMonthCard>small','.scheduleMonthTitle>span','#scheduleMessage']){const s=w.getComputedStyle(d.querySelector(selector));assert.equal(s.color,'rgb(23, 63, 122)');assert.equal(s.fontWeight,'800')}
assert.notEqual(w.getComputedStyle(d.querySelector('.scheduleMiniGrid span')).color,'rgb(23, 63, 122)');w.close();console.log('PASS: legacy markup, without external assets, computed navy bold counts/rates, dates unchanged');
