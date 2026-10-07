'use strict';
// Back to front. The chair includes the intact animated role; a table includes
// its attached tabletop prop. Background and UI never enter this list.
const DEFAULT_ORDER=Object.freeze(['corner-vine-left','corner-vine-right','corner-curtain-left','corner-curtain-right','string-lights','wall-art','rug','lamp','plant','chair','floor-light','portable-light','side-furniture','foreground-plant','pendant']);
function validateOrder(order){if(!Array.isArray(order)||order.length!==DEFAULT_ORDER.length||new Set(order).size!==order.length||!DEFAULT_ORDER.every(id=>order.includes(id)))throw Error('物件层次记录不正确；原文件已保留。');return [...order];}
const groupFor=category=>category==='tabletop'?'side-furniture':category;
const effectiveOrder=state=>validateOrder((state.testAccess?.enabled?state.testAccess.layerOrder:state.layerOrder)||DEFAULT_ORDER);
function moveLayer(order,category,delta,equipment){
 const next=validateOrder(order),group=groupFor(category),from=next.indexOf(group);
 if(from<0||![1,-1].includes(delta))throw Error('这件物品不能调整层次。');
 for(let to=from+delta;to>=0&&to<next.length;to+=delta){const candidate=next[to];if(candidate==='chair'||equipment[candidate]){[next[from],next[to]]=[next[to],next[from]];return next;}}
 return next;
}
const api={DEFAULT_ORDER,validateOrder,groupFor,effectiveOrder,moveLayer};
if(typeof module!=='undefined')module.exports=api;globalThis.owlLayerOrder=api;
