import { ITEMS } from '../sim/data';
import { hash32 } from '../sim/rng';
const cache=new Map<string,string>();
/** Original pixel-shaped thumbnails, derived from slot, weapon family, tier, and item identity. */
export function itemIcon(id:string):string {
  if(cache.has(id))return cache.get(id)!;
  const it=ITEMS[id];if(!it)return'';
  const metal=['#a49c84','#b7b8bc','#ead095'][it.tier-1]??'#b7b8bc',accent=`hsl(${hash32(id)%360} 42% 60%)`;
  let shape='';
  if(it.slot==='armour')shape=`<path fill="${metal}" d="M9 4h5v4h4V4h5v4h5v10h-6v12H10V18H4V8h5z"/><path fill="${accent}" d="M13 10h7v14h-7z"/>`;
  else if(it.slot==='shield')shape=`<path fill="${metal}" d="M5 4h22v15h-4v6h-4v5h-6v-5H9v-6H5z"/><path fill="${accent}" d="M10 8h12v10h-4v8h-4v-8h-4z"/>`;
  else if(it.slot==='trinket')shape=`<path fill="#876b43" d="M8 2h4v6h8V2h4v9h-4v3h-8v-3H8z"/><path fill="${metal}" d="M12 13h8v4h5v10h-5v4h-8v-4H7V17h5z"/><path fill="${accent}" d="M13 18h6v8h-6z"/>`;
  else if(it.gear==='bow')shape=`<path fill="#8d6440" d="M10 3h5v4h4v5h3v8h-3v5h-4v4h-5v-4h4v-5h3v-8h-3V7h-4z"/><path fill="${metal}" d="M9 4h2v24H9zM4 15h20v2H4z"/>`;
  else if(it.gear==='staff'||it.gear==='lute'||it.gear==='flask')shape=it.gear==='flask'?`<path fill="${metal}" d="M12 3h8v8l6 8v9H6v-9l6-8z"/><path fill="${accent}" d="M9 20h14v5H9z"/>`:it.gear==='lute'?`<path fill="#9c7347" d="M14 2h4v13h5v5h3v7h-4v4H10v-4H6v-7h3v-5h5z"/><path fill="${accent}" d="M13 20h6v7h-6z"/>`:`<path fill="#87613a" d="M14 8h4v23h-4z"/><path fill="${metal}" d="M10 2h12v11H10z"/><path fill="${accent}" d="M13 5h6v5h-6z"/>`;
  else shape=`<path fill="#86603c" d="M14 19h4v12h-4z"/><path fill="${metal}" d="M14 1h4v4h3v12h-3v5h-4v-5h-3V5h3z"/><path fill="${accent}" d="M7 20h18v3H7z"/>`;
  const stamp=hash32('seal',id)%8;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32" shape-rendering="crispEdges"><rect width="32" height="32" fill="#16121c"/>${shape}<rect x="${2+stamp}" y="29" width="${it.tier}" height="2" fill="${accent}"/></svg>`;
  const url='data:image/svg+xml,'+encodeURIComponent(svg);cache.set(id,url);return url;
}
