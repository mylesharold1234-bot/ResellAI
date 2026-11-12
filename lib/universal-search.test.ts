import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Identification} from './identification';
import {assessIdentification} from './product-profile';
import {IdentificationWarning} from '../components/identification-warning';
import {emptyIdentificationState, identificationReducer} from './identification-workflow';
import {emptyMatchDetails, type Comparable} from './marketplaces';
import {searchPlan,tierComparable} from './ebay-search';
import {createMarketplaceHandler} from './marketplace-server';
export const examples:[string,string|null,string|null,string,boolean][]=[['Air Jordan 1 Mid','Jordan','Air Jordan 1 Mid','Footwear',false],['Saxophone',null,null,'Musical instruments',true],['Yamaha YAS-280 Alto Saxophone','Yamaha','YAS-280','Musical instruments',false],['Ceramic dinner plate',null,null,'Dinnerware',true],['Vintage wooden chair',null,null,'Furniture',true],['Unbranded table lamp',null,null,'Lighting',true],['Sony WH-1000XM5 headphones','Sony','WH-1000XM5','Electronics',false],['PlayStation 5','Sony','PlayStation 5','Electronics',false]];
export const identity=(name:string,brand:string|null,model:string|null,category:string):Identification=>({brand,model,productName:name,category,colorway:null,visibleCondition:'Visible condition uncertain',identifyingInformation:null,confidence:'medium',uncertainties:[],additionalEvidence:[]});
const row=(title:string):Comparable=>({id:title,title,price:100,currency:'USD',status:'asking',condition:'Used',conditionId:'3000',url:'https://www.ebay.com/itm/123',observedAt:new Date().toISOString(),shipping:null,seller:'seller',categories:[],matchReasons:[],warnings:[]});
for(const [name,brand,model,category,warn] of examples)test(`${name}: review warning, refine and skip both reach marketplace route`,async()=>{
 const i=identity(name,brand,model,category);let state=identificationReducer(emptyIdentificationState,{type:'photos',photos:[{id:'p',name:'actual-upload.jpg',url:'blob:actual-upload'}]});state=identificationReducer(state,{type:'identified',identification:i});
 assert.equal(assessIdentification(i).specific,!warn);assert.equal(renderToStaticMarkup(createElement(IdentificationWarning,{identification:i})).includes('Identification incomplete'),warn);
 state=identificationReducer(state,{type:'edit',identification:{...i,brand:brand||'User supplied maker'}});assert.equal(state.sources.brand,brand?'ai-inferred':'user-provided');assert.equal(state.aiIdentification?.brand,brand);
 state=identificationReducer(state,{type:'details',details:{...emptyMatchDetails,material:'Wood',dimensions:'30 cm',additionalDetails:'User label text'}});
 for(const mode of ['general','refined'] as const){const confirmed=identificationReducer(state,{type:'confirm',mode,requestId:mode});assert.equal(confirmed.photos[0].url,'blob:actual-upload');assert.equal(confirmed.details.material,mode==='general'?undefined:'Wood');const plan=searchPlan({identification:confirmed.confirmed!,details:confirmed.details});assert.ok(plan.length>=1&&plan.length<=4);let called=false;const handler=createMarketplaceHandler({id:'ebay',search:async q=>{called=true;assert.ok(q.identification.productName);return {provider:'ebay',status:'no_matches',environment:'production',query:searchPlan(q)[0].query,comparables:[],retrievedAt:null,expiresAt:null,cached:false,examined:0,invalid:0,excluded:0,warnings:[]};}});const r=await handler(new Request('http://localhost:3001/api/marketplaces/ebay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identification:confirmed.confirmed,details:confirmed.details})}));assert.equal(r.status,200);assert.equal(called,true);}
});
test('generic saxophone works without brand, model or category; no specific pricing from general objects',async()=>{const i=identity('Saxophone',null,null,'');const q={identification:i,details:emptyMatchDetails};assert.ok(searchPlan(q).some(x=>x.query==='saxophone'));const m=tierComparable(row('Used Alto Saxophone'),q);assert.equal(m.item?.matchTier,'related');assert.equal(m.item?.priceEligible,false);});
test('category-specific incompatible listings are excluded without blocking broad retrieval',()=>{const sax={identification:identity('Alto Saxophone',null,null,'Musical instruments'),details:emptyMatchDetails};assert.equal(tierComparable(row('Alto Saxophone mouthpiece'),sax).item,null);assert.equal(tierComparable(row('Tenor Saxophone'),sax).item,null);assert.ok(tierComparable(row('Alto Saxophone with mouthpiece'),sax).item);const plate={identification:identity('Ceramic dinner plate',null,null,'Dinnerware'),details:emptyMatchDetails};assert.equal(tierComparable(row('Ceramic decorative wall plate'),plate).item,null);const shoe={identification:identity('Adult sneakers','Jordan','Air Jordan 1 Mid','Footwear'),details:{...emptyMatchDetails,size:'9',sizeSystem:'US Men' as const}};assert.equal(tierComparable(row('Jordan Air Jordan 1 Mid toddler shoes'),shoe).item,null);});

test('ambiguous broad object words do not admit unrelated plates, lamp parts or miniature furniture',()=>{
 const plate={identification:identity('Ceramic dinner plate',null,null,'Dinnerware'),details:emptyMatchDetails};
 for(const title of ['Steel Plate 24 x 24','Texas License Plate','Deluxe Wire Plate Hanger','Washer Wash Plate'])assert.equal(tierComparable(row(title),plate).item,null);
 assert.ok(tierComparable(row('White porcelain dinner plate'),plate).item);
 const lamp={identification:identity('Table lamp',null,null,'Lighting'),details:emptyMatchDetails};assert.equal(tierComparable(row('Xenon HID D2S lamp'),lamp).item,null);assert.ok(tierComparable(row('Vintage table lamp'),lamp).item);
 const chair={identification:identity('Vintage wooden chair',null,null,'Furniture'),details:emptyMatchDetails};assert.equal(tierComparable(row('Miniature dollhouse wooden chair'),chair).item,null);
});

test('providing an instrument subtype clears only that missing-information hint',()=>{const i=identity('Saxophone',null,null,'Musical instruments');assert.ok(assessIdentification(i).missing.includes('Instrument subtype'));const a=assessIdentification(i,{...emptyMatchDetails,subtype:'Alto'});assert.equal(a.missing.includes('Instrument subtype'),false);assert.equal(a.specific,false);});
