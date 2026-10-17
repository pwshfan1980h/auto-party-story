import { PartBuilder,RES,type Model } from './kit';
/** An original company standard and stone plinth, built with the same voxel kit as the heroes. */
export function companyStandard():Model {
  const p=new PartBuilder('standard',[0,0,0]);
  p.box(-6,0,-4,6,2,4,0x71616f).box(-4,3,-3,4,4,3,0x9a8790);
  p.box(-2,5,-1,-1,37,0,0x8c6038).box(-3,37,-2,0,39,1,0xddad58);
  p.box(0,32,0,13,34,1,0x9d713c).box(1,19,0,12,31,0,0xba7c34).box(3,16,0,10,18,0,0xba7c34);
  p.box(3,21,1,10,29,1,0xe5b65b).box(6,23,2,7,28,2,0xffe2a0).box(4,25,2,9,26,2,0xffe2a0);
  return{id:'company-standard',rig:'biped',parts:[p.build()],scale:1,height:40*RES,style:'none'};
}

/** A carried flame beside the stone route marker, for ordinary homecomings. */
export function returnTorch():Model {
  const p=new PartBuilder('torch',[0,0,0]);
  p.box(-7,0,-4,7,2,4,0x675869).box(-5,3,-3,3,13,2,0x91838c).box(-3,6,3,1,7,3,0xe5b65b).box(-1,4,3,0,10,3,0xe5b65b);
  p.box(5,3,-1,6,22,0,0x815431).box(4,21,-2,7,24,1,0xb58b43).box(4,25,-1,7,30,0,0xe38b32).box(5,27,-1,6,33,0,0xffd87c);
  return{id:'return-torch',rig:'biped',parts:[p.build()],scale:1,height:34*RES,style:'none'};
}
