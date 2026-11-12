import {test} from 'node:test';import assert from 'node:assert/strict';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {primaryProduct} from './primary-product';import {tierComparable} from './ebay-search';import {emptyMatchDetails,type Comparable,type ProductQuery,type MarketplaceResult} from './marketplaces';import {pricingEngine,defaultPricingOptions,parsePricingOptions} from './pricing-engine';import {parseIdentification} from './identification';import {redactDescription} from './product-understanding';import {PricingPanel} from '../components/pricing-panel';import {reviewComparables} from './ebay-ai-review';
const q:ProductQuery={identification:{brand:'Ozici',model:null,productName:'Ozici Alto Saxophone',category:'Musical instruments',colorway:null,visibleCondition:null,identifyingInformation:null,confidence:'medium',uncertainties:[],additionalEvidence:[]},details:{...emptyMatchDetails,condition:'used',subtype:'Alto',includedAccessories:'case, mouthpiece'}};
const item=(title:string,price=100,n=0):Comparable=>({id:String(n),title,price,currency:'USD',status:'asking',condition:'Used',conditionId:'3000',url:'https://www.ebay.com/itm/123',observedAt:new Date().toISOString(),shipping:10,seller:'seller-'+n,categories:['Saxophones'],matchReasons:[],warnings:[]});
const result=(items:Comparable[]):MarketplaceResult=>({provider:'ebay',status:'available',environment:'production',query:'Ozici Alto Saxophone',comparables:items,retrievedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),cached:false,examined:items.length,excluded:0,invalid:0,warnings:[]});
const close=(prices=[90,100,110])=>prices.map((p,n)=>tierComparable(item('Ozici Alto Saxophone with Case Mouthpiece Gloves',p,n),q).item!);
const identified:ProductQuery={identification:{...q.identification,brand:'Sony',model:'PlayStation 5',productName:'PlayStation 5 Console',category:'Electronics'},details:{...emptyMatchDetails,condition:'used',variant:'Disc',includedAccessories:'controller'}};
const identifiedClose=(prices=[90,100,110])=>prices.map((price,n)=>tierComparable({...item('Sony PlayStation 5 Disc Console',price,n),categories:['Video Game Consoles']},identified).item!);
test('complete saxophone packages survive both accessory checks; separate accessories and parts do not',()=>{for(const title of ['Ozici Alto Saxophone with Case Mouthpiece Gloves','Ozici Alto Saxophone includes cleaning kit and neck strap','Ozici Alto Saxophone case mouthpiece gloves']){assert.equal(primaryProduct(item(title),q).kind,'complete');const m=tierComparable(item(title),q).item;assert.equal(m?.matchTier,'close');assert.equal(m?.priceEligible,true);}for(const title of ['Alto Saxophone Mouthpiece','Ozici Saxophone Case Only','Ozici Alto Saxophone for parts'])assert.equal(tierComparable(item(title),q).item,null);assert.equal(tierComparable(item('Ozici Tenor Saxophone with case'),q).item,null);assert.equal(tierComparable(item('Yamaha Alto Saxophone with case'),q).item?.priceEligible,false);});
test('complete console/controller and camera/lens packages retain their primary product',()=>{for(const [name,title,category] of [['PlayStation 5','Sony PlayStation 5 Console with controllers','Electronics'],['Canon EOS R5 Camera','Canon EOS R5 Camera with Lens','Cameras']]){const x={identification:{...q.identification,brand:name.startsWith('Canon')?'Canon':'Sony',model:name,productName:name,category},details:{...emptyMatchDetails,condition:'used' as const}};assert.equal(primaryProduct(item(title),x).kind,'complete');assert.ok(tierComparable(item(title),x).item);}});
test('close-comparable pricing, assumptions and offer range are deterministic',()=>{const r=pricingEngine(result(identifiedClose()),identified,{...defaultPricingOptions,negotiationMarginPercent:5});assert.equal(r.suggestedListingPrice,100);assert.equal(r.marginAdjustedAsk,105);assert.equal(r.provisional,true);assert.deepEqual(r.modeledOfferRange,{low:80,high:90});assert.equal(r.expectedSellingPrice,null);assert.equal(r.eligibleCount,3);assert.equal(r.conditionCohort,'used');});
test('robust outliers, shipping and seller diversity remain traceable',()=>{const r=pricingEngine(result(identifiedClose([90,95,100,105,110,10000])),identified);assert.deepEqual(r.outlierIds,['5']);assert.equal(r.statistics?.median,100);assert.equal(r.eligibleCount,5);const delivered=pricingEngine(result(identifiedClose()),identified,{...defaultPricingOptions,shippingBasis:'delivered',buyerShippingCharge:5});assert.equal(delivered.statistics?.median,110);assert.equal(delivered.suggestedListingPrice,105);assert.equal(pricingEngine(result(identifiedClose().map(x=>({...x,seller:null}))),identified).suggestedListingPrice,null);});
test('weak evidence gives an illustrative scenario; expired evidence is historical only',()=>{const weak=pricingEngine(result(close([100])),q);assert.equal(weak.suggestedListingPrice,null);assert.equal(weak.modeledOfferRange,null);assert.ok(weak.illustrativeScenario);const snapshot=result(close());snapshot.expiresAt=new Date(Date.now()-1000).toISOString();const old=pricingEngine(snapshot,q);assert.equal(old.suggestedListingPrice,null);assert.equal(old.modeledOfferRange,null);assert.equal(old.illustrativeScenario,null);assert.equal(old.statistics?.median,100);const html=renderToStaticMarkup(createElement(PricingPanel,{recommendation:old,options:defaultPricingOptions,onChange(){},expired:true,historical:100}));assert.match(html,/EXPIRED SNAPSHOT/);assert.match(html,/Historical starting ask/);});
test('invalid assumptions and unresolved description conflicts cannot produce supported guidance',()=>{assert.throws(()=>parsePricingOptions({negotiationMarginPercent:99}));assert.throws(()=>parsePricingOptions({offerDiscountLowPercent:30,offerDiscountHighPercent:10}));const x={...q,identification:{...q.identification,understanding:{primaryProduct:'Saxophone',subtype:'alto',describedCondition:'used',includedAccessories:[],conflicts:['Description says tenor but image appears alto'],modelSupport:'unknown' as const,evidence:[]}}};assert.equal(pricingEngine(result(close()),x).suggestedListingPrice,null);});
test('structured image/description sources validate and an unsupported year is not a model',()=>{const i=parseIdentification({...q.identification,model:'2024',understanding:{primaryProduct:'Saxophone',subtype:'alto',describedCondition:'used',includedAccessories:['case'],conflicts:[],modelSupport:'inferred',evidence:[{field:'brand',value:'Ozici',source:'user-described'}]}});assert.equal(i.model,null);assert.equal(i.understanding?.evidence[0].source,'user-described');assert.throws(()=>parseIdentification({...i,understanding:{...i.understanding,evidence:[{field:'brand',value:'Ozici',source:'independently-verified'}]}}));assert.equal(redactDescription('Ozici saxophone email seller@example.com phone 555-123-4567'),'Ozici saxophone email [email removed] phone [phone removed]');});
test('AI review receives no prices, URLs or seller contacts and validates source IDs',async()=>{const fetcher:typeof fetch=async(_url,init)=>{const b=JSON.parse(String(init?.body));assert.equal(b.store,false);const input=JSON.parse(b.input);assert.equal(input.listings[0].price,undefined);assert.equal(input.listings[0].url,undefined);assert.equal(input.listings[0].seller,undefined);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'Complete instrument with accessories',rankings:[{id:'0',similarity:90,primaryProduct:'complete',reason:'Same subtype; model uncertain'}],uncertainties:['Exact model unconfirmed']})}]}]});};assert.equal((await reviewComparables(q,close(),'test','gpt-4.1-mini',fetcher)).rankings[0].id,'0');});

test('actual neck-only and plural-mouthpiece titles do not masquerade as complete saxophones',()=>{for(const title of ['Yamaha G1 Standard Silver Plate Stock Neck For The YAS-62SII Alto Saxophone','Lot 100 Vintage Bundy Generic Alto Saxophone Mouthpieces Ligatures Caps','Ozici Alto Saxophone Mouthpiece with Cap'])assert.equal(tierComparable(item(title),q).item,null);const parts=item('Ozici Alto Saxophone with case');parts.conditionId='7000';assert.equal(tierComparable(parts,q).item,null);});
test('primary product fallback is specific even when the AI fills only a broad category name',()=>{const i=parseIdentification({...q.identification,productName:'musical instrument',understanding:{primaryProduct:'Alto saxophone',subtype:'alto',describedCondition:null,includedAccessories:[],conflicts:[],modelSupport:'unknown',evidence:[]}});assert.equal(primaryProduct(item('Alto saxophone with case'),{...q,identification:i}).kind,'complete');});
test('low identity confidence retains evidence but restricts recommendation to a scenario',()=>{const x={...q,identification:{...q.identification,confidence:'low' as const}};const r=pricingEngine(result(close()),x);assert.equal(r.suggestedListingPrice,null);assert.ok(r.illustrativeScenario);});

test('unknown accessory packages downgrade exact matches without hiding complete products',()=>{const x={identification:{...q.identification,brand:'Sony',model:'PlayStation 5',productName:'PlayStation 5 Console',category:'Electronics'},details:{...emptyMatchDetails,condition:'used' as const,variant:'Disc',includedAccessories:'controller'}};const r=tierComparable(item('Sony PlayStation 5 Disc Console'),x).item!;assert.equal(r.matchTier,'close');assert.equal(r.priceEligible,true);assert.ok(r.warnings.some(w=>w.includes('accessory package')));assert.equal(tierComparable(item('Sony PlayStation 5 Disc Console with Controller'),x).item?.matchTier,'exact');});

test('dashboard shows a median-based starting ask only when closely matched evidence supports it',()=>{
 const comparable=identifiedClose();
 const r=pricingEngine(result([...comparable,{...comparable[0],id:'related',price:900,matchTier:'related',priceEligible:false},{...comparable[0],id:'new',price:500,conditionId:'1000'}]),identified);
 assert.equal(r.suggestedListingPrice,100);
 assert.equal(r.eligibleCount,3);
 const markup=(recommendation:typeof r)=>renderToStaticMarkup(createElement(PricingPanel,{recommendation,options:defaultPricingOptions,onChange(){},expired:false}));
 assert.match(markup(r),/Recommended Listing Price[\s\S]*\$99.99[\s\S]*Based on 3 comparable eBay listings/);
 const uncertain=pricingEngine(result(close()),q);
 assert.equal(uncertain.suggestedListingPrice,null);
 const html=markup(uncertain);
 assert.match(html,/Price unavailable/);
 assert.match(html,/Add a clear photo of the model label/);
 assert.doesNotMatch(html,/Scenario only|Illustrative negotiation scenario|class="big-value"/);
});


test('incomplete black and white Jordan 1 Mid flows from Browse rows to the estimated results card',async()=>{
 const {normalizeEbaySearch}=await import('./marketplace-providers/ebay');
 const query:ProductQuery={identification:{...q.identification,brand:'Nike',model:'Likely Nike Air Jordan 1 Mid',productName:'Nike Air Jordan 1 Mid',category:'Sneakers',colorway:'black and white',visibleCondition:'Appears new or like new',uncertainties:['Exact model variant and SKU are not confirmed.']},details:emptyMatchDetails};
 const raw=(title:string,price:number,id:number,conditionId='1000',variation=false)=>({itemId:'v1|'+id+'|0',title,price:{value:String(price),currency:'USD'},conditionId,condition:conditionId==='1000'?'New':'Pre-owned',itemWebUrl:'https://www.ebay.com/itm/'+id,buyingOptions:['FIXED_PRICE'],seller:{username:'seller'+id},...(variation?{itemGroupType:'SELLER_DEFINED_VARIATIONS'}:{})});
 const rows=[raw('Nike AJ1 Mid Black White US Mens Size 9',90,1),raw('Jordan 1 Mid White Black Size 10',100,2),raw('Air Jordan 1 Mid Black Size 11',110,3),raw('Jordan 1 Mid Black White Size 12',105,4),raw('Jordan 1 Mid White Black Size 8',95,5),raw('Jordan 1 Mid Black White Size 11',1000,6),raw('Jordan 1 Mid Black Red',300,7),raw('Jordan 1 Low Black White',200,8),raw('Jordan 1 Mid Black White',60,9,'3000'),raw('Jordan 1 Mid Black White Choose Size',10,10,'1000',true),raw('Jordan 1 Mid Black White GS',40,11)];
 const normalized=normalizeEbaySearch({itemSummaries:rows},'production',new Date().toISOString());
 assert.equal(normalized.invalid,0);
 const matches=normalized.items.map(row=>tierComparable(row,query));
 assert.equal(matches[6].reason,'colorway_mismatch');
 assert.equal(matches[7].item,null);
 assert.equal(matches[9].reason,'variation_price_unverified');
 assert.equal(matches[10].item?.matchTier,'related');
 const snapshot=result(matches.flatMap(m=>m.item?[m.item]:[]));
 const rec=pricingEngine(snapshot,query);
 assert.equal(rec.provisional,true);
 assert.equal(rec.eligibleCount,5);
 assert.deepEqual(rec.outlierIds,['v1|6|0']);
 assert.equal(rec.suggestedListingPrice,100);
 assert.deepEqual(rec.indicativeAskingRange,{low:90,high:110});
 assert.equal(rec.exclusions['close: incompatible or unknown condition'],1);
 assert.equal(rec.exclusions['close: variation price unverified'],1);
 const markup=renderToStaticMarkup(createElement(PricingPanel,{recommendation:rec,options:defaultPricingOptions,onChange(){},expired:false}));
 assert.match(markup,/Recommended Listing Price[\s\S]*\$99.99[\s\S]*Based on 5 comparable eBay listings/);
 assert.match(markup,/\$90.00–\$110.00/);
 assert.match(markup,/Evidence quality: <strong>Limited/);
 const verified:ProductQuery={...query,details:{...emptyMatchDetails,condition:'new' as const,size:'10',sizeSystem:'US Men',productIdentifier:'DQ1234-001',productIdentifierVerified:true}};
 const exact=rows.slice(0,5).map((_,n)=>raw('Nike Air Jordan 1 Mid Black White US Mens Size 10 DQ1234-001',98+n,30+n));
 const exactResult=normalizeEbaySearch({itemSummaries:exact},'production',new Date().toISOString()).items.map(row=>tierComparable(row,verified).item!);
 const qualified=pricingEngine(result(exactResult),verified);
 assert.equal(qualified.pricingBasis,'exact');
 assert.equal(qualified.provisional,false);
 assert.equal(qualified.suggestedListingPrice,100);
 assert.match(renderToStaticMarkup(createElement(PricingPanel,{recommendation:qualified,options:defaultPricingOptions,onChange(){},expired:false})),/Recommended Listing Price/);
});

