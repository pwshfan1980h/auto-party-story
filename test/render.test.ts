import {expect,it} from 'vitest';
import * as THREE from 'three';
import {Fx} from '../src/render/fx';

it('releases expired and cancelled effect resources while retaining the shared debris cube',()=>{
  for(const cancel of [false,true]){
    const group=new THREE.Group(),fx=new Fx(group),at=new THREE.Vector3();
    fx.burst(at,[{x:0,y:0,z:0,c:0xffffff}],.1);fx.projectile(at,at,.2,0xffffff);fx.telegraph(at,1,.2);fx.decal(at);fx.shockwave(at,1,0xffffff);
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();let shared:THREE.BufferGeometry|undefined;
    group.traverse(node=>{if(node instanceof THREE.Mesh){if(node instanceof THREE.InstancedMesh)shared=node.geometry;else geometries.add(node.geometry);for(const m of Array.isArray(node.material)?node.material:[node.material])materials.add(m)}});
    let disposedGeometry=0,disposedMaterial=0,disposedShared=0;
    for(const g of geometries)g.addEventListener('dispose',()=>disposedGeometry++);for(const m of materials)m.addEventListener('dispose',()=>disposedMaterial++);shared!.addEventListener('dispose',()=>disposedShared++);
    if(cancel)fx.clear();else fx.update(10);
    expect(group.children).toHaveLength(0);expect(disposedGeometry).toBe(geometries.size);expect(disposedMaterial).toBe(materials.size);expect(disposedShared).toBe(0);
  }
});
