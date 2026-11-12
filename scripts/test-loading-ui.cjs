// Optional browser regression: requires playwright-core and an installed Chromium/Edge.
const assert = require('node:assert/strict');
const {chromium} = require(process.env.RESELLAI_PLAYWRIGHT || 'playwright-core');
require('tsx/cjs');
const {pricingEngine}=require('../lib/pricing-engine.ts');
const {emptyMatchDetails}=require('../lib/marketplaces.ts');
const base = process.env.RESELLAI_TEST_BASE_URL || 'http://localhost:3001';
const identity = {brand:'Sony',productName:'Sony WH-1000XM5 headphones',model:'WH-1000XM5',category:'Headphones',colorway:null,visibleCondition:null,identifyingInformation:null,confidence:'medium',uncertainties:[],additionalEvidence:[]};
const gates = {};
const calls = {};
function gate(kind, status, body) {
  let release;
  const promise = new Promise(resolve => { release = () => resolve({status,body}); });
  gates[kind] = promise;
  return release;
}
function listingPayload(prices,provider="ebay") {
  const comparables=prices.map((price,i)=>({id:String(i),title:'Sony WH-1000XM5 Headphones',price,currency:'USD',status:'asking',matchTier:'close',priceEligible:true,condition:'Used',conditionId:'3000',url:'https://www.ebay.com/itm/'+i,observedAt:new Date().toISOString(),shipping:null,seller:'seller'+i,categories:[],warnings:[],matchReasons:[]}));
  const result={provider,status:'available',environment:'production',query:'Sony WH-1000XM5',comparables,examined:comparables.length,excluded:0,invalid:0,cached:false,evidenceId:'fixture-'+prices[0],warnings:[],retrievedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()};
  return {result,recommendation:pricingEngine(result,{identification:identity,details:emptyMatchDetails})};
}
(async()=>{
 const browser=await chromium.launch({channel:process.env.RESELLAI_BROWSER_CHANNEL || 'msedge',headless:true});
 try {
  const page=await browser.newPage({reducedMotion:'reduce'});
  page.setDefaultTimeout(20000);
  for(const [kind,path] of Object.entries({identify:'/api/identify',ebay:'/api/marketplaces/ebay',review:'/api/marketplaces/ebay/review',mercari:'/api/marketplaces/mercari'})){
   await page.route(url=>url.pathname===path,async route=>{
    calls[kind]=(calls[kind]||0)+1;
    const {status,body}=await gates[kind];
    await route.fulfill({status,json:body});
   });
  }
  await page.route('**/api/marketplaces/facebook',route=>route.fulfill({json:{enabled:false,keyConfigured:false}}));
  await page.goto(base+'/analyze');
  const photo=page.getByAltText('Uploaded product photo 1');
  await page.getByLabel('Choose product photos').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7a0AAAAASUVORK5CYII=','base64')});
  await photo.waitFor();
  const twice=locator=>locator.evaluate(el=>{el.click();el.click();});
  const visible=text=>page.getByText(text,{exact:true}).first().waitFor();
  const hidden=text=>page.getByText(text,{exact:true}).first().waitFor({state:'hidden'});
  let release=gate('identify',503,{error:'Image analysis test error'});
  await twice(page.getByRole('button',{name:'Identify Item'}));
  await visible('Analyzing your product…');
  assert(await photo.isVisible());
  assert(await page.getByRole('button',{name:'Analyzing your product…'}).isDisabled());
  assert.equal(await page.locator('.request-skeleton').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await page.locator('.request-spinner').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  release();
  await visible('Image analysis test error');
  await hidden('Analyzing your product…');
  assert.equal(calls.identify,1);
  release=gate('identify',200,{identification:identity});
  await page.getByRole('button',{name:'Retry image analysis'}).click();
  await visible('Analyzing your product…');
  release();
  await page.getByRole('heading',{name:'Review identification'}).waitFor();
  await hidden('Analyzing your product…');

  release=gate('ebay',200,listingPayload([95,100,105]));
  const mercariPayload=listingPayload([75,80,85],'mercari');
  mercariPayload.result.comparables.forEach((item,i)=>{item.url='https://www.mercari.com/us/item/m'+(i+1)+'/';});
  const finishMercari=gate('mercari',200,mercariPayload);
  const ebay=page.getByRole('region',{name:'eBay pricing'});
  const mercari=page.getByRole('region',{name:'Mercari pricing'});
  await page.getByRole('button',{name:'No, continue with general search'}).click();
  await ebay.getByText('Analyzing marketplace prices…',{exact:true}).waitFor();
  assert(await ebay.locator('.request-skeleton').first().isVisible());
  assert.doesNotMatch(await ebay.innerText(),/\$\d/);
  release();
  await ebay.getByText('$99.99',{exact:true}).waitFor();
  assert.match(await ebay.innerText(),/95.00.*105.00/);
  await ebay.getByText('Analyzing marketplace prices…',{exact:true}).waitFor({state:'hidden'});
  assert.equal(calls.ebay,1);
  await mercari.getByText('Analyzing marketplace prices…',{exact:true}).waitFor();
  finishMercari();
  await mercari.getByText('$79.99',{exact:true}).waitFor();
  await mercari.getByText('Comparable Asking Range:',{exact:true}).waitFor();
  await page.getByRole('region',{name:'Marketplace comparison'}).getByText('No marketplace preference').waitFor();
  const profit=page.getByRole('region',{name:'Profit calculator'});
  await profit.getByRole('combobox').selectOption('Mercari');
  await profit.getByText('Profit unavailable until every fee and cost has a valid amount.').waitFor();
  for(const [label,value] of [['Item purchase cost','30'],['Shipping paid to you by the buyer','0'],['Your shipping and packaging cost','7'],['Total marketplace fees','8'],['Other selling expenses','0']])
    await profit.getByLabel(label,{exact:false}).fill(value);
  await profit.getByText('$34.99',{exact:true}).waitFor();

  assert.match(await mercari.innerText(),/75.00.*85.00/);
  assert.equal(calls.ebay,1);
  assert.equal(calls.mercari,1);
  await mercari.getByText('View Mercari listing prices').click();
  assert.match(await mercari.getByRole('link').first().getAttribute('href'),/mercari.com/);


  release=gate('ebay',200,{result:{status:'unavailable',reason:'eBay test error'},recommendation:{}});
  await twice(ebay.getByRole('button',{name:'Refresh Market Prices'}));
  await ebay.getByText('Previous results',{exact:true}).waitFor();
  assert(await ebay.getByText('$99.99',{exact:true}).isVisible());
  assert(await mercari.getByText('$79.99',{exact:true}).isVisible());
  release();
  await visible('eBay test error');
  await ebay.getByText('Analyzing marketplace prices…',{exact:true}).waitFor({state:'hidden'});
  assert.equal(calls.ebay,2);
  release=gate('ebay',200,listingPayload([115,120,125]));
  await page.getByRole('button',{name:'Retry eBay search'}).click();
  await ebay.getByText('Analyzing marketplace prices…',{exact:true}).waitFor();
  release();
  await ebay.getByText('$119.99',{exact:true}).waitFor();
  await ebay.getByText('Analyzing marketplace prices…',{exact:true}).waitFor({state:'hidden'});

  release=gate('review',502,{error:'AI review test error'});
  await twice(page.getByRole('button',{name:'Review comparable similarity with AI'}));
  const reviewing=page.getByRole('button',{name:'Reviewing listings…'});
  await reviewing.waitFor();
  assert(await reviewing.isDisabled());
  assert(await reviewing.locator('svg').isVisible());
  release();
  await visible('AI review test error');
  await reviewing.waitFor({state:'hidden'});
  assert.equal(calls.review,1);
  release=gate('review',200,{review:{summary:'Comparable review fixture complete.',rankings:[],uncertainties:[]}});
  await page.getByRole('button',{name:'Retry AI comparable review'}).click();
  await reviewing.waitFor();
  release();
  await visible('Comparable review fixture complete.');
  await reviewing.waitFor({state:'hidden'});
  assert.equal(calls.review,2);
  console.log('Loading browser checks passed: photo, identification, eBay retrieval/refresh/retry, AI review/retry, duplicate guards, and reduced motion.');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});


