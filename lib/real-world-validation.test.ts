import {test} from "node:test";
import assert from "node:assert/strict";
import {evaluateValidation} from "./real-world-validation";
import {emptyMatchDetails} from "./marketplaces";

// Synthetic rows test evaluator arithmetic and policy, not real marketplace performance.
const base={schemaVersion:1,datasetId:"synthetic-regression",kind:"synthetic"};
const stamp="2026-11-10T12:00:00Z";
const identification={brand:"Sony",model:"WH-1000XM5",productName:"Sony WH-1000XM5 headphones",category:"Headphones",colorway:null,visibleCondition:null,identifyingInformation:null,confidence:"medium",uncertainties:[],additionalEvidence:[]};
const label=(id:string,verdict:string)=>({id,verdict,reason:"Synthetic fixture judgment",evidence:"synthetic:test"});
const sale=(id:string,price:number,authorized=true)=>({id,price,soldAt:"2026-11-01T12:00:00Z",currency:"USD",basis:"item-only",authorized,verified:true,meetsCriteria:true,evidence:"synthetic:test"});
const goldCase={id:"fixture",category:"headphones",source:"synthetic:test",reviewer:"synthetic:test",photoRef:"synthetic:none",verifiedIdentity:"Fixture only",verifiedModel:"WH-1000XM5",size:null,sizeSystem:null,condition:"used",criteria:"same model, complete, used",accepted:{model:["WH 1000XM5"],category:["headphones"],brand:["Sony"],visibleCondition:["used"]},
 judgments:{mercari:{pool:"independent",labels:[label("m1","relevant"),label("m2","irrelevant"),label("m4","relevant")],sales:[sale("s1",80),sale("s2",90),sale("s3",100),sale("s4",500,false)]}}};
const mercari=(id:number,price:number)=>({id:"m"+id,name:"Sony WH-1000XM5 Headphones",price,currency:"USD",status:"on_sale",url:"https://www.mercari.com/us/item/m"+id+"/",seller_id:String(id),condition:"Good"});
const caseCapture={id:"fixture",identification:{status:"ok",output:identification},details:{...emptyMatchDetails,condition:"used"},markets:{
 mercari:{status:"ok",capturedAt:stamp,pages:[{country:"US",items:[mercari(1,90),mercari(2,100),mercari(3,110)]}]},
 ebay:{status:"error",capturedAt:stamp,pages:[],reason:"Synthetic timeout"},
}};
const run=(gold=goldCase,capture=caseCapture)=>evaluateValidation({...base,cases:[gold]},{...base,cases:[capture]});

test("offline metrics separate retrieval, labels, coverage and authorized sale references",()=>{
 const a=run(),m=a.summary[1];
 assert.equal(a.fieldSummary.find(f=>f.field==="model")?.accuracy,1);
 assert.equal(a.fieldSummary.find(f=>f.field==="visibleCondition")?.missing,1);
 assert.equal(m.matching.precision,0.5);
 assert.equal(m.matching.recall,0.5);
 assert.equal(m.withinRetrieved.recall,1);
 assert.equal(m.matching.judgmentCoverage,2/3);
 assert.equal(m.coverage,1);
 assert.equal(a.summary[0].coverage,0);
 assert.equal(a.summary[0].failures["provider-error"],1);
 assert.ok(Math.abs(m.pricingError.mae!-9.99)<0.0001);
 assert.equal(m.pricingError.cases,1);
 assert.equal(m.failures["incorrect-match"],1);
 assert.equal(m.failures["retrieval-gap"],1);
 assert.deepEqual(a,run());
});

test("no independent pool or authorized sale sample means no end-to-end recall or pricing error",()=>{
 const a=run({...goldCase,judgments:{mercari:{...goldCase.judgments.mercari,pool:"retrieved-only",sales:[sale("s1",80,false)]}}});
 assert.equal(a.summary[1].matching.recall,null);
 assert.equal(a.summary[1].withinRetrieved.recall,1);
 assert.equal(a.summary[1].pricingError.mae,null);
 assert.equal(a.summary[1].pricingError.cases,0);
});

test("no data is not zero performance; duplicated labels or orphan captures are rejected",()=>{
 const empty=evaluateValidation({...base,cases:[]},{...base,cases:[]});
 assert.equal(empty.summary[1].coverage,null);
 assert.equal(empty.summary[1].matching.precision,null);
 assert.throws(()=>evaluateValidation({...base,cases:[]},{...base,cases:[caseCapture]}),/without an independent/);
 assert.throws(()=>evaluateValidation({...base,cases:[goldCase,goldCase]},{...base,cases:[]}),/duplicate IDs/);
});

test("dispersion and failed identification are distinct from provider errors",()=>{
 const a=run(goldCase,{...caseCapture,markets:{...caseCapture.markets,mercari:{...caseCapture.markets.mercari,pages:[{country:"US",items:[mercari(1,10),mercari(2,90),mercari(3,130)]}]}}});
 assert.equal(a.summary[1].failures["excessive-dispersion"],1);
 assert.equal(a.summary[1].coverage,0);
 const b=evaluateValidation({...base,cases:[goldCase]},{...base,cases:[{id:"fixture",identification:{status:"error",reason:"Synthetic timeout"},markets:{}}]});
 assert.equal(b.summary[0].failures["identification-blocked"],1);
 assert.equal(b.summary[0].coverage,0);
});
