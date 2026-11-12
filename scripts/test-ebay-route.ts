// Exercises the same HTTP route/body as LiveReport. No credential access here.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {emptyMatchDetails} from '../lib/marketplaces';
async function main(){
 const results=[];
 for(const [brand,name,category,colorway] of [['Jordan','Air Jordan 1 Mid','Sneakers','black white'],['Sony','WH-1000XM5','Headphones',null],['Sony','PlayStation 5','Console',null],['Apple','iPhone 15','Smartphone',null],['LEGO','Star Wars','Building toys',null]]){
  const identification={brand,productName:name,model:name,category,colorway,visibleCondition:null,identifyingInformation:null,confidence:'medium',uncertainties:[],additionalEvidence:[]};
  const details={...emptyMatchDetails,...(brand==='Jordan'?{productIdentifier:'554724-000',productIdentifierVerified:false}:{})};
  const response=await fetch('http://localhost:3001/api/marketplaces/ebay',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:3001'},body:JSON.stringify({identification,details}),signal:AbortSignal.timeout(55000)});
  const body=await response.json();const r=body.result;
  const summary={name,httpStatus:response.status,status:r?.status,reason:r?.reason,queries:r?.searchDiagnostics?.attempts,returned:r?.examined,retained:r?.comparables?.length,exact:r?.searchDiagnostics?.exact,close:r?.searchDiagnostics?.close,related:r?.searchDiagnostics?.related,pricingBasis:body.recommendation?.pricingBasis,pricingCount:body.recommendation?.statistics?.count,cached:r?.cached,validAccepted:r?.comparables?.every((x:any)=>x.url.startsWith('https://www.ebay.com/itm/')&&x.price>0&&x.matchReasons.length>0),exclusions:r?.diagnostics?.exclusions};
  results.push({request:{identification,details},summary,response:body});console.log(JSON.stringify(summary));
 }
 const output=path.join(os.tmpdir(),'resellai-progressive-route-audit.json');fs.writeFileSync(output,JSON.stringify(results,null,2));console.log('Public listing audit: '+output);
}
main().catch(()=>{console.error('Route verification failed; no credentials read or logged.');process.exitCode=1;});
