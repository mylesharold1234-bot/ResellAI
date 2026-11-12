import {test} from "node:test";
import assert from "node:assert/strict";
import {tierComparable,searchPlan} from "./ebay-search";
import {completeComparable,scoreComparable} from "./comparable-quality";
import {emptyMatchDetails,type Comparable,type ProductQuery} from "./marketplaces";
import {parseUnderstanding} from "./product-understanding";

const shoe:ProductQuery={identification:{brand:"Nike",productName:"Air Jordan 1 Mid",category:"Sneakers",model:"Air Jordan 1 Mid",colorway:"black white",visibleCondition:null,identifyingInformation:null,confidence:"medium",uncertainties:[],additionalEvidence:[]},details:emptyMatchDetails};
const camera:ProductQuery={identification:{...shoe.identification,brand:"Canon",model:"EOS R5",productName:"Canon EOS R5 Camera",category:"Camera",colorway:null},details:emptyMatchDetails};
const item=(title:string,n:number):Comparable=>({id:String(n),title,price:100,currency:"USD",status:"asking",condition:"Used",conditionId:"3000",url:"https://www.ebay.com/itm/"+n,observedAt:"2026-11-09T12:00:00Z",shipping:null,seller:"s"+n,categories:[],matchReasons:[],warnings:[]});

test("offline benchmark: explicit model, color, youth, missing metadata and non-footwear cases",t=>{
 const benchmark=[
  [shoe,"Nike Air Jordan 1 Mid Black White 554724-113 Mens Size 13",true],
  [shoe,"Nike Air Jordan 1 Mid Black White",true],
  [shoe,"Nike Air Jordan 1 Low Black White",false],
  [shoe,"Nike Air Jordan 1 High Black White",false],
  [shoe,"Air Jordan 1 Mid Red Black White",false],
  [shoe,"Jordan 1 Mid Black White GS Size 5",false],
  [shoe,"Air Jordan 1 Mid Panda Elite Black White Football Cleats FJ6805-100",false],
  [shoe,"Air Jordan 1 Mid Black White sole separation",false],
  [{...shoe,details:{...emptyMatchDetails,condition:"new"}}, "Air Jordan 1 Mid Black White",false],
  [camera,"Canon EOS R5 camera body with lens",true],
  [camera,"Canon EOS R5 replacement cover",false],
  [camera,"Canon EOS R6 camera",false],
 ] satisfies [ProductQuery,string,boolean][];
 const evaluate=(improved:boolean)=>{
  let tp=0,fp=0,fn=0;
  benchmark.forEach(([q,title,truth],n)=>{
   const listing=item(title,n),match=tierComparable(listing,q);
   const eligible=!!match.item?.priceEligible&&(!improved||completeComparable(listing,q));
   if(eligible&&truth)tp++;else if(eligible)fp++;else if(truth)fn++;
  });
  return {tp,fp,fn,precision:tp/(tp+fp),recall:tp/(tp+fn)};
 };
 const before=evaluate(false),after=evaluate(true);
 t.diagnostic(JSON.stringify({before,after}));
 assert.equal(after.fp,0);assert.equal(after.recall,before.recall);assert.ok(after.precision>before.precision);
});

test("evidence score is explainable and unchanged by listing price",()=>{
 const match=tierComparable(item("Nike Air Jordan 1 Mid Black White",1),shoe).item!;
 assert.deepEqual(scoreComparable(match),scoreComparable({...match,price:999}));
 assert.ok(scoreComparable(match).signals.includes("Visible palette supported"));
});

test("AI candidates are hypotheses and only same-model variants enter the bounded plan",()=>{
 const understanding=parseUnderstanding({primaryProduct:"Sneaker",subtype:null,describedCondition:null,includedAccessories:[],conflicts:[],modelSupport:"inferred",evidence:[{field:"colorPlacement",value:"Black overlays",source:"image-visible"}],candidates:[{model:"Air Jordan 1 High",variant:"Unrelated alternate",basis:"Similar logo"},{model:"Air Jordan 1 Mid",variant:"Panda",basis:"Black overlays"}]});
 const q={...shoe,identification:{...shoe.identification,understanding}};
 const plan=searchPlan(q);
 assert.ok(plan.some(x=>x.query.includes("panda")));
 assert.ok(plan.every(x=>!x.query.includes("unrelated alternate")));
 assert.ok(plan.length<=4);
 assert.throws(()=>parseUnderstanding({...understanding,candidates:Array(4).fill(understanding.candidates![0])}));
});
