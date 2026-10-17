export interface HeroProgress {
  id:string;name:string;classId:string;raceId:string;levelBefore:number;levelAfter:number;
  xpBefore:number;xpAfter:number;xpGained:number;leadershipBefore:number;leadershipAfter:number;
  fallen:boolean;carried:boolean;
  dealt?:number;healed?:number;kills?:number;
}
export interface RunReceipt {
  id:string;run:number;tier:string;outcome:'cleared'|'retreat'|'wipe';banked:number;balance:number;
  firstClear:boolean;firstFinalClear:boolean;heroes:HeroProgress[];gear:string[];rewardId?:string;
  legacyFinal?:boolean;
  unlockedTier?:string;newRaces:string[];volunteers:string[];waystoneBefore:number;waystoneAfter:number;
  floor:number;rooms:number;fights:number;fightsWon:number;returnReason:string;ledger:string[];
}
export interface RewardChoice {id:string;run:number;tier:string;options:string[];claimed?:string}
