import {test} from "node:test";
import assert from "node:assert/strict";
import {tierComparable} from "./ebay-search";
import {matchMercari} from "./mercari-matching";
import {matchComparable} from "./product-matching";
import {pricingEngine} from "./pricing-engine";
import {emptyMatchDetails,type ProductQuery,type Comparable,type MarketplaceResult} from "./marketplaces";

const general:ProductQuery={identification:{brand:"Nike",model:"Dunk Low",productName:"Nike Dunk Low",category:"Sneakers",colorway:"black white",visibleCondition:null,identifyingInformation:null,confidence:"medium",uncertainties:[],additionalEvidence:[]},details:emptyMatchDetails};
const refined:ProductQuery={...general,identification:{...general.identification,model:"Nike Dunk Low",productName:"Nike Dunk Low Sneaker"},details:{...emptyMatchDetails,condition:"new",size:"10",sizeSystem:"US Men",subtype:"Low-top sneaker"}};
const item=(title:string,id=0,price=70):Comparable=>({id:String(id),title,price,currency:"USD",status:"asking",condition:"New",conditionId:"1000",url:"https://www.ebay.com/itm/"+id,observedAt:new Date().toISOString(),shipping:null,seller:"seller"+id,categories:[],warnings:[],matchReasons:[]});
const source=(rows:Comparable[]):MarketplaceResult=>({provider:"ebay",environment:"production",status:"available",query:"fixture",comparables:rows,retrievedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),cached:false,examined:rows.length,excluded:0,invalid:0,warnings:[]});

test("refinement accepts equivalent footwear subtype and repeated brand with explicit size evidence",()=>{
 const row=item("Nike Dunk Low Retro Panda Black White Mens US Size 10");
 assert.equal(tierComparable(row,general).item?.priceEligible,true);
 assert.equal(tierComparable(row,refined).item?.priceEligible,true);
 assert.equal(matchMercari(row,refined).item?.priceEligible,true);
 const other={...refined,identification:{...refined.identification,model:"Dunk Low"}};
 assert.deepEqual(tierComparable(row,refined),tierComparable(row,other));
 const rows=[65,70,75].map((price,n)=>tierComparable({...row,id:String(n),seller:"seller"+n,price},refined).item!);
 assert.equal(pricingEngine(source(rows),refined).suggestedListingPrice,70);
});

test("missing attributes remain unverified and explicit contradictions remain excluded",()=>{
 const cases=[
  ["Nike Dunk Low Panda Black White Mens Size 10","sizing_system_unverified"],
  ["Nike Dunk Low Panda Black White Mens US Size 11","size_mismatch"],
  ["Nike Dunk Low Panda Black White Mens UK Size 10","sizing_system_mismatch"],
  ["Nike Dunk Low Panda Black White Mens US Shoes","size_unverified"],
 ] as const;
 for(const [title,reason] of cases){
  const row=item(title);
  assert.equal(matchComparable(row,refined).exclusionReason,reason);
  assert.equal(tierComparable(row,refined).item?.priceEligible,false);
 }
 assert.equal(matchComparable({...item("Nike Dunk Low Black White Mens US Size 10"),conditionId:""},refined).exclusionReason,"condition_unverified");
 assert.equal(matchComparable({...item("Nike Dunk Low Black White Mens US Size 10"),conditionId:"3000"},refined).exclusionReason,"condition_mismatch");
});

test("identifier and variant constraints still require affirmative listing evidence",()=>{
 const target={...refined,details:{...refined.details,productIdentifierVerified:true,productIdentifier:"DD1391-100",variant:"Panda"}};
 assert.equal(tierComparable(item("Nike Dunk Low Retro Panda Black White Mens US Size 10 DD1391-100"),target).item?.priceEligible,true);
 assert.equal(tierComparable(item("Nike Dunk Low Retro Panda Black White Mens US Size 10 DD1503-101"),target).item?.priceEligible,false);
 assert.equal(tierComparable(item("Nike Dunk Low Retro Black White Mens US Size 10 DD1391-100"),target).item?.priceEligible,false);
 const contradiction={...refined,details:{...refined.details,subtype:"High-top sneaker"}};
 assert.notEqual(tierComparable(item("Nike Dunk Low Black White Mens US Size 10"),contradiction).item?.priceEligible,true);
});

test("size-group uncertainty is not reported as a confirmed contradiction",()=>{
 assert.equal(matchComparable(item("Nike Dunk Low Black White US Size 10"),refined).exclusionReason,"sizing_group_unverified");
 assert.equal(matchComparable(item("Nike Dunk Low Black White Womens US Size 10"),refined).exclusionReason,"sizing_group_mismatch");
});

test("a later size failure does not erase confirmed color evidence",()=>{
 const match=tierComparable(item("Nike Dunk Low Panda Black White Mens Size 10"),refined);
 assert.equal(match.item?.priceEligible,false);
 assert.ok(match.item?.matchReasons.includes("Visible colors present in title"));
 assert.ok(!match.item?.warnings.includes("Full visible colorway not evidenced"));
});
