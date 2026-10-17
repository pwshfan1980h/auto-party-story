export interface Preferences {speed:number;camera:boolean;clarity:boolean;reducedMotion:boolean;shake:boolean;guideSeen:boolean}
const defaults:Preferences={speed:.75,camera:true,clarity:false,reducedMotion:typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches,shake:true,guideSeen:false};
export const preferences:Preferences={...defaults};
try{const saved=JSON.parse(localStorage.getItem('aps-preferences-v1')??'{}');for(const key of ['camera','clarity','reducedMotion','shake','guideSeen'] as const)if(typeof saved[key]==='boolean')preferences[key]=saved[key];if([.5,.75,1,2,4].includes(saved.speed))preferences.speed=saved.speed}catch{/* session defaults */}
export function updatePreferences(update:Partial<Preferences>){
  for(const key of ['camera','clarity','reducedMotion','shake','guideSeen'] as const)if(typeof update[key]==='boolean')preferences[key]=update[key]!;
  if(update.speed!==undefined && [.5,.75,1,2,4].includes(update.speed))preferences.speed=update.speed;
  try{localStorage.setItem('aps-preferences-v1',JSON.stringify(preferences))}catch{/* session preferences still work */}
  if(typeof window!=='undefined')window.dispatchEvent(new Event('aps-preferences'));
}
