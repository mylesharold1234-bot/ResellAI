import {test} from "node:test";
import assert from "node:assert/strict";
import {blindReview,mergePilotReviews,pilotCaptureFetch,pilotLabels,sanitizePilotImport,sanitizePilotPage} from "./real-world-pilot";
import {readCaptures,readGold} from "./real-world-validation";

// Synthetic data exercises privacy and reviewer handling; never exported as a pilot result.
const meta={schemaVersion:1,datasetId:"synthetic-pilot-test",kind:"synthetic"};
const stamp="2026-11-10T12:00:00Z";
const identification={brand:"Synthetic AI prediction",productName:"Fixture camera",model:"Unverified prediction",category:"Camera",colorway:null,visibleCondition:null,identifyingInformation:null,confidence:"medium",uncertainties:[],additionalEvidence:[]};
const labels=readGold({...meta,cases:[{id:"fixture",category:"camera",source:"fixture",reviewer:"initial-reviewer",photoRef:"synthetic:none",verifiedIdentity:"Fixture identity",verifiedModel:"Fixture model",size:null,sizeSystem:null,condition:"used",criteria:"Complete camera",accepted:{brand:["Fixture brand"],colorway:["black"],model:["Fixture model"],category:["camera"]},judgments:{}}]});
const row={id:"m1",name:"Fixture camera test@example.com",status:"on_sale",price:99,currency:"USD",condition:"Good",url:"https://www.mercari.com/us/item/m1/?tracking=secret",seller_id:"private-seller",description:"private description",photos:["https://example.test/photo"],raw:{token:"private token"}};
const raw={...meta,cases:[{id:"fixture",identification:{status:"ok",output:identification},markets:{mercari:{status:"ok",capturedAt:stamp,pages:[{country:"US",items:[row,{...row,id:"m2",url:"https://www.mercari.com/us/item/m2/",status:"sold"}]}]}}}]};
const captures=readCaptures(sanitizePilotImport(raw,"fixture-salt"));

test("pilot import allowlists provider data and pseudonymizes sellers deterministically",()=>{
 const json=JSON.stringify(captures);
 assert.doesNotMatch(json,/private-seller|private token|private description|tracking|test@example|example\.test\/photo/);
 assert.match(json,/"price":99/);
 assert.match(json,/email removed/);
 const again=readCaptures(sanitizePilotImport(raw,"fixture-salt"));
 assert.deepEqual(captures,again);
 assert.notDeepEqual(captures,readCaptures(sanitizePilotImport(raw,"another-salt")));
 const ebay=JSON.stringify(sanitizePilotPage("ebay",{itemSummaries:[{itemId:"v1|1|0",title:"Fixture",itemWebUrl:"https://www.ebay.com/itm/1?token=private",price:{value:"25",currency:"USD"},seller:{username:"private-seller"},itemGroupHref:"private variation link"}]},"fixture-salt"));
 assert.doesNotMatch(ebay,/private|token/);
 assert.match(ebay,/variation/);
 assert.throws(()=>sanitizePilotPage("mercari",{country:"JP",items:[]},"fixture-salt"),/Mercari US/);
});

test("worksheet omits predictions, prices and match results; merge requires human evidence",()=>{
 const worksheet=blindReview(labels,captures);
 const json=JSON.stringify(worksheet);
 assert.doesNotMatch(json,/Unverified prediction|price|matchTier|private-seller/);
 assert.equal(worksheet.cases[0].listings.length,2);
 assert.throws(()=>mergePilotReviews(labels,captures,worksheet),/reviewer/);
 worksheet.cases[0].reviewer="independent-reviewer";
 assert.throws(()=>mergePilotReviews(labels,captures,worksheet),/verdict/);
 worksheet.cases[0].listings.forEach((r,i)=>{r.verdict=i?"uncertain":"relevant";r.reason="Fixture reason";r.evidence="fixture:manual";});
 const result=mergePilotReviews(labels,captures,worksheet);
 assert.equal(result.cases[0].judgments.mercari?.reviewer,"independent-reviewer");
 assert.equal(result.cases[0].judgments.mercari?.pool,"retrieved-only");
 assert.equal(result.cases[0].judgments.mercari?.labels[1].verdict,"uncertain");
 assert.equal(labels.cases[0].judgments.mercari,undefined);
 assert.equal(result.cases[0].verifiedIdentity,labels.cases[0].verifiedIdentity);
});

test("pilot requires ten real product labels and rejects synthetic input",()=>{
 assert.throws(()=>pilotLabels(labels),/exactly 10 independently verified real products/);
 assert.throws(()=>pilotLabels({...meta,kind:"real",cases:[]}),/exactly 10/);
});

test("capture fetch records only search payloads and leaves provider response readable",async()=>{
 const pages:unknown[]=[];
 const fetcher:typeof fetch=async(input)=>String(input).includes("/oauth2/token")
   ?Response.json({access_token:"fixture-secret"})
   :Response.json({total:0,secret:"fixture-secret"});
 const capture=pilotCaptureFetch("ebay","fixture",pages,fetcher);
 await capture("https://api.ebay.com/identity/v1/oauth2/token");
 assert.deepEqual(pages,[]);
 const response=await capture("https://api.ebay.com/buy/browse/v1/item_summary/search?q=fixture");
 assert.deepEqual(pages,[{total:0}]);
 assert.deepEqual(await response.json(),{total:0,secret:"fixture-secret"});
});
