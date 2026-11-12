import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadEnvConfig} from '@next/env';
import {createEbayProvider} from '../lib/marketplace-providers/ebay';
import {emptyMatchDetails, type ProductQuery} from '../lib/marketplaces';
import {recommend} from '../lib/valuation';
loadEnvConfig(process.cwd(),true,{info(){},error(){}});
async function main(){
 if(process.env.EBAY_ENVIRONMENT!=='production'||process.env.EBAY_PRODUCTION_APPROVED!=='true')throw Error('Approved Production configuration required');
 const q:ProductQuery={identification:{brand:'Jordan',model:'Air Jordan 1 Mid',productName:'Air Jordan 1 Mid',category:'Sneakers',colorway:'black white',visibleCondition:null,identifyingInformation:null,confidence:'medium',uncertainties:[],additionalEvidence:[]},details:{...emptyMatchDetails}};
 const provider=createEbayProvider({clientId:process.env.EBAY_CLIENT_ID,clientSecret:process.env.EBAY_CLIENT_SECRET,environment:'production',productionApproved:true});
 const result=await provider.search(q);const recommendation=recommend(result,q);
 const auditPath=path.join(os.tmpdir(),'resellai-ebay-filter-audit.json');fs.writeFileSync(auditPath,JSON.stringify({result,recommendation},null,2));
 console.log(JSON.stringify({status:result.status,reason:result.reason,returned:result.examined,normalized:result.diagnostics?.normalized,accepted:result.comparables.length,exclusions:result.diagnostics?.exclusions,pricingSample:recommendation.statistics?.count,priceRecommendation:recommendation.suggestedListingPrice,allAcceptedUrlsValid:result.comparables.every(x=>new URL(x.url).hostname==='www.ebay.com'&&x.price>0&&x.matchReasons.length>0),auditPath},null,2));
}
main().catch(()=>{console.error('Diagnostic failed. Credentials and upstream authorization responses withheld.');process.exitCode=1;});
