import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchPlan, tierComparable, searchCacheKey} from './ebay-search';
import {emptyMatchDetails, type Comparable, type ProductQuery} from './marketplaces';
import {identificationReducer,emptyIdentificationState} from './identification-workflow';
import {recommend} from './valuation';
const q:ProductQuery={identification:{brand:'Jordan',productName:'Air Jordan 1 Mid',model:'Air Jordan 1 Mid',category:'Sneakers',colorway:'black white',visibleCondition:null,identifyingInformation:'554724-000',confidence:'medium',uncertainties:[],additionalEvidence:[]},details:{...emptyMatchDetails,productIdentifier:'554724-000'}};
const row=(title:string):Comparable=>({id:title,title,price:100,currency:'USD',status:'asking',condition:'Pre-owned',conditionId:'3000',url:'https://www.ebay.com/itm/123',observedAt:new Date().toISOString(),shipping:null,seller:'seller',categories:[],matchReasons:[],warnings:[]});
test('AI identifier is never automatically promoted to verified search criteria',()=>{const s=identificationReducer(emptyIdentificationState,{type:'identified',identification:q.identification});assert.equal(s.details.productIdentifier,'');assert.equal(s.details.productIdentifierVerified,false);const p=searchPlan(q);assert.equal(p[0].query,'air jordan 1 mid black white');assert.ok(p.every(x=>!x.query.includes('554724')));assert.equal(searchPlan({...q,details:{...q.details,productIdentifierVerified:true}}).at(-1)?.stage,'D');});
test('restrictive details never contaminate broad queries; cache keys separate verified attributes',()=>{const p=searchPlan({...q,details:{...q.details,size:'9.5',sizeSystem:'US Men',condition:'used',packaging:'original',variant:'rare edition'}});assert.ok(p.every(x=>!x.query.includes('9.5')&&!x.query.includes('box')&&!x.query.includes('rare')));assert.notEqual(searchCacheKey(q),searchCacheKey({...q,details:{...q.details,productIdentifierVerified:true}}));assert.ok(p.length<=4);});
test('unverified identifier mismatch retains close models, not accessories or incompatible silhouettes',()=>{assert.equal(tierComparable(row('Nike AJ1 Mid Black White US Mens Size 9.5'),q).item?.matchTier,'close');assert.equal(tierComparable(row('Jordan 1 Low Black White'),q).item,null);assert.equal(tierComparable(row('Air Jordan 1 Mid Black White box only'),q).item,null);});
test('verified identifier disagreement is close evidence without price eligibility',()=>{const r=tierComparable(row('Air Jordan 1 Mid Black White'),{...q,details:{...q.details,productIdentifierVerified:true}});assert.equal(r.item?.matchTier,'close');assert.equal(r.item?.priceEligible,false);});
test('all requested product families support broad searches and close evidence without shoe fields',()=>{for(const [brand,model,category,title] of [['Sony','WH-1000XM5','Headphones','Sony WH-1000XM5 Wireless Headphones'],['Sony','PlayStation 5','Console','Sony PS5 Console'],['Apple','iPhone 15','Smartphone','Apple iPhone 15 128GB Unlocked'],['LEGO','Star Wars','Building toys','LEGO Star Wars 75301 Complete Set']]){const x={identification:{...q.identification,brand,model,productName:model,category,colorway:null},details:{...emptyMatchDetails}};assert.ok(searchPlan(x).length>=1);assert.equal(tierComparable(row(title),x).item?.matchTier,brand==='LEGO'?'related':'close');assert.equal(tierComparable(row(title+' replacement case'),x).item,null);}});
test('related editions and detail mismatches cannot supply valuation inputs',()=>{const x={identification:{...q.identification,brand:'Apple',productName:'iPhone 15',model:'iPhone 15',category:'Smartphone',colorway:null},details:{...emptyMatchDetails}};const r=tierComparable(row('Apple iPhone 15 Pro 256GB'),x).item!;assert.equal(r.matchTier,'related');assert.equal(r.priceEligible,false);});

test('specific electronics model can qualify without shoe-only identifiers',()=>{
 const x={identification:{...q.identification,brand:'Sony',productName:'WH-1000XM5',model:'WH-1000XM5',category:'Headphones',colorway:null},details:{...emptyMatchDetails,condition:'used' as const}};
 const item=tierComparable(row('Sony WH-1000XM5 Wireless Headphones'),x).item!;assert.equal(item.matchTier,'exact');assert.equal(item.priceEligible,true);
 const items=Array.from({length:5},(_,n)=>({...item,id:String(n),seller:'seller-'+n,price:100+n}));
 const r=recommend({provider:'ebay',status:'available',environment:'production',query:'sony wh 1000xm5',comparables:items,retrievedAt:null,expiresAt:new Date(Date.now()+300000).toISOString(),cached:false,examined:5,excluded:0,invalid:0,warnings:[]},x);assert.equal(r.suggestedListingPrice,102);assert.equal(r.pricingBasis,'exact');
});

test('console accessories and unsupported phones never become comparables',()=>{
 const consoleQuery={identification:{...q.identification,brand:'Sony',productName:'PlayStation 5',model:'PlayStation 5',category:'Console',colorway:null},details:{...emptyMatchDetails}};
 assert.equal(tierComparable(row('Sony PlayStation 5 DualSense Controller'),consoleQuery).item,null);
 const phone={...consoleQuery,identification:{...consoleQuery.identification,brand:'Apple',model:'iPhone 15',productName:'iPhone 15',category:'Smartphone'}};
 assert.equal(tierComparable(row('Apple iPhone 15 iCloud Locked'),phone).item,null);
});

test('a named Jordan edition does not price the standard silhouette as that edition',()=>{
 const edition={...q,identification:{...q.identification,model:'Air Jordan 1 Mid SE'}};
 assert.equal(tierComparable(row('Air Jordan 1 Mid Black White'),edition).item?.priceEligible,false);
 assert.equal(tierComparable(row('Air Jordan 1 Mid SE Black White'),edition).item?.priceEligible,true);
});
