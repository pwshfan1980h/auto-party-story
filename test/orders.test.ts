import {describe,expect,it} from 'vitest';
import {Fight} from '../src/sim/fight';
import {party,PRESETS} from '../src/sim/presets';
import {buildEncounter} from '../src/sim/encounter';
import {stream} from '../src/sim/rng';
import {ABILITIES} from '../src/sim/data';
function fight(){const f=new Fight({seed:7,tier:'II',roomType:'boss',mode:'full',heroes:party(PRESETS.starter,'II'),monsters:buildEncounter('II','boss',5,stream(7,'test')),embers:3});f.step();return f}
describe('immediate player reactions',()=>{
  it('can Mend a hurt healer in place, spending one ember and the ability cooldown',()=>{
    const f=fight(),healer=f.units.find(u=>u.team===0&&u.defId==='cleric')!;healer.hp=healer.base.maxHp*.1;healer.windup=undefined;healer.order=undefined;healer.cooldowns={};
    const [x,y]=[healer.x,healer.y],before=healer.hp;
    expect(f.order('mend',healer.id)).toBe('ok');expect(healer.hp).toBeGreaterThan(before);expect([healer.x,healer.y]).toEqual([x,y]);expect(f.embersLeft).toBe(2);expect(Object.values(healer.cooldowns).some(n=>n>0)).toBe(true);
  });
  it('rejects a full-health target without spending embers',()=>{
    const f=fight(),h=f.units.find(u=>u.team===0)!;expect(f.order('mend',h.id)).toBe('already healthy');expect(f.embersLeft).toBe(3);
  });
  it('Interrupt stops the observed cast immediately instead of queueing behind it',()=>{
    const f=fight(),enemy=f.units.find(u=>u.team===1)!,hero=f.units.find(u=>u.team===0&&[u.basic,...u.skills].some(id=>ABILITIES[id].interrupts))!;
    expect(hero).toBeTruthy();hero.x=enemy.x-1;hero.y=enemy.y;hero.cooldowns={};hero.windup=undefined;
    enemy.windup={ability:enemy.skills[0]??enemy.basic,targetId:hero.id,ax:hero.x,ay:hero.y,left:.2};
    expect(f.order('interrupt',enemy.id)).toBe('ok');expect(enemy.windup).toBeUndefined();expect(f.embersLeft).toBe(2);expect(f.orderAvailability('interrupt').ready).toBe(false);
    expect(f.events.some(e=>e.type==='interrupted'&&e.unit===enemy.id)).toBe(true);
  });
});
