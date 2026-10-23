const assert=require('node:assert/strict'),{compareSiteSn}=require('../inspection-schedule.js');
const rows=[{sn:'314-2',site_name:'가학교(26년)',source_id:1},{sn:'314-10',site_name:'다학교(24년)',source_id:2},{sn:'2',site_name:'나학교',source_id:3},{sn:'10',site_name:'라학교',source_id:4},{sn:'',site_name:'빈번호',source_id:5}];
assert.deepEqual([...rows].sort((a,b)=>compareSiteSn(a,b,'desc')).map(x=>x.sn),['314-10','314-2','10','2','']);assert.deepEqual([...rows].sort((a,b)=>compareSiteSn(a,b,'asc')).map(x=>x.sn),['2','10','314-2','314-10','']);assert.deepEqual([...rows].sort(compareSiteSn).map(x=>x.sn),['314-10','314-2','10','2','']);
console.log('PASS: default S/N descending, ascending, numeric and hyphen suffix natural sort, site names/years do not override S/N, empty S/N last');
