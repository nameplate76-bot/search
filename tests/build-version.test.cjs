const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const dom=new JSDOM(html,{url:'https://portal.test',runScripts:'outside-only'}),w=dom.window;
w.document.querySelector('.buildBadge').textContent='V158';
w.eval(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
assert.equal(w.STAFF_PORTAL_BUILD,'20261023-v216');assert.equal(w.localStorage.getItem('staffPortalBuild'),'20261023-v216');assert.equal(w.document.querySelector('.buildBadge').textContent,'V216');
for(const el of w.document.querySelectorAll('script[src],link[rel="stylesheet"]')){const ref=el.src||el.href;if(ref.startsWith('https://portal.test/'))assert(ref.includes('v=20261023-v216'),ref)}
const source=fs.readFileSync(path.join(__dirname,'../inspection-schedule.js'),'utf8');assert(source.includes("STAFF_SCHEDULE_VERSION='V216'"));assert(!html.includes('v158'));console.log('PASS: DOMContentLoaded displays V213, build/storage/cache identifiers agree, schedule source V213');w.close();
