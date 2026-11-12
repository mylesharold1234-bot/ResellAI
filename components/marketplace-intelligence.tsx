"use client";
import {useState} from "react";
import {compareMarketplaceEvidence,marketplaceProfitScenario,type PricingEvidence} from "../lib/pricing-intelligence";
import {listingDisplayPrice} from "../lib/pricing-engine";
import {dollars} from "./pricing-panel";

type Market="eBay"|"Mercari";
const fields={purchase:"Item purchase cost",buyerShipping:"Shipping paid to you by the buyer",sellerShipping:"Your shipping and packaging cost",fee:"Total marketplace fees",extras:"Other selling expenses"};
const empty={purchase:"",buyerShipping:"",sellerShipping:"",fee:"",extras:""};
type Inputs=typeof empty;

export function MarketplaceComparison({ebay,mercari,now}:{ebay:PricingEvidence|null;mercari:PricingEvidence|null;now:number}){
 const comparison=compareMarketplaceEvidence(ebay,mercari,now);
 return <section className="panel block" aria-label="Marketplace comparison">
   <h2>Marketplace comparison</h2>
   <p><strong>{comparison.marketplace?comparison.marketplace+" has stronger pricing evidence":"No marketplace preference"}</strong></p>
   <p>{comparison.reason}</p>
   <p className="fine">This compares the quality of current asking-price evidence. It does not predict sale speed, completed-sale price, or realized profit.</p>
 </section>;
}

export function MarketplaceProfit({ebay,mercari,now}:{ebay:PricingEvidence|null;mercari:PricingEvidence|null;now:number}){
 const [market,setMarket]=useState<Market>("eBay");
 const [inputs,setInputs]=useState<Record<Market,Inputs>>({"eBay":empty,Mercari:empty});
 const selected=market==="eBay"?ebay:mercari;
 const rec=selected?.recommendation;
 const expiry=selected?.result.expiresAt;
 const price=expiry&&Date.parse(expiry)>now?listingDisplayPrice(rec?.suggestedListingPrice??null,rec?.indicativeAskingRange??null):null;
 const estimate=price===null?null:marketplaceProfitScenario(price,inputs[market]);
 return <section className="panel block" aria-label="Profit calculator">
   <h2>Profit calculator</h2>
   <p className="muted">A scenario if the item sells at the current asking recommendation. Enter the fees applicable to your account and listing.</p>
   <label className="notes-label">Marketplace <select value={market} onChange={e=>setMarket(e.target.value as Market)}><option>eBay</option><option>Mercari</option></select></label>
   <div className="calculator-inputs block">{Object.entries(fields).map(([key,label])=><label key={key}>{label} ($)
    <input type="number" min="0" step="0.01" value={inputs[market][key as keyof Inputs]} onChange={e=>setInputs(old=>({...old,[market]:{...old[market],[key]:e.target.value}}))}/>
   </label>)}</div>
   <p className="fine">Enter 0 only when a cost does not apply. Include all applicable selling, payment, and per-order charges in your fee total. Include buyer shipping only if you receive it. Sales tax collected for remittance is not seller revenue.</p>
   {estimate&&price!==null?<div className="calc-results" role="status">
    <div><span>Hypothetical sale price</span><strong>{dollars(price)}</strong></div>
    <div><span>Proceeds after specified selling costs</span><strong>{dollars(estimate.proceeds)}</strong></div>
    <div><span>Net profit after purchase cost</span><strong>{dollars(estimate.profit)}</strong></div>
   </div>:<p role="status">{price===null?"Profit unavailable without a current supported listing price for "+market+".":"Profit unavailable until every fee and cost has a valid amount."}</p>}
 </section>;
}
