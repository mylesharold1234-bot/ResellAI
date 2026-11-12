import { createHash } from "node:crypto";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { join,resolve } from "node:path";
import { evaluateValidation } from "../lib/real-world-validation";

const pct=(n:number|null)=>n===null?"—":(100*n).toFixed(1)+"%";
const usd=(n:number|null)=>n===null?"—":"$"+n.toFixed(2);
const cell=(s:unknown)=>String(s??"").replace(/[<>]/g,"").replace(/\|/g,"\\|").replace(/[\r\n]+/g," ");

async function main(){
 const [labelsPath,capturesPath,outputPath,...extra]=process.argv.slice(2);
 if(!labelsPath||!capturesPath||!outputPath||extra.length)throw Error("Usage: npm run validate:real -- labels.json captures.json output-directory");
 const output=resolve(outputPath);
 const reportPaths=[join(output,"report.json"),join(output,"report.md")];
 if([labelsPath,capturesPath].some(p=>reportPaths.includes(resolve(p))))throw Error("Report files cannot overwrite input manifests.");
 const inputs=await Promise.all([readFile(labelsPath,"utf8"),readFile(capturesPath,"utf8")]);
 const results=evaluateValidation(...inputs.map(x=>JSON.parse(x.replace(/^\uFEFF/,""))) as [unknown,unknown]);
 const sourcePaths=["real-world-validation.ts","identification.ts","product-understanding.ts","product-profile.ts","ebay-search.ts","product-matching.ts","primary-product.ts","footwear-compatibility.ts","listing-primary-text.ts","retrieval-diagnostics.ts","mercari-matching.ts","marketplaces.ts","comparable-quality.ts","valuation.ts","pricing-engine.ts","marketplace-providers/ebay.ts","marketplace-providers/mercari.ts"];
 const sources=await Promise.all(sourcePaths.map(p=>readFile(join(process.cwd(),"lib",p))));
 const hash=(input:string|Buffer)=>createHash("sha256").update(input).digest("hex");
 const report={...results,provenance:{labelsSha256:hash(inputs[0]),capturesSha256:hash(inputs[1]),engineSourcesSha256:hash(Buffer.concat(sources))}};
 const lines=[
  "# ResellAI Real-World Validation V1", "",
  "Dataset: "+cell(report.datasetId)+" ("+report.kind+") · "+report.labeledProducts+" independently labeled slots · "+report.capturedProducts+" recorded cases.",
  ...(report.kind==="synthetic"?["**Synthetic data: these results do not measure real-world performance.**"]:[]),
  ...(!report.labeledProducts?["**No real-world results yet.** Collect independently labeled products and authorized pre-filter captures."]:[]),
  ...(!report.meetsTarget?["Collection target: 50–100 independently labeled real products."]:[]),"",
  "| Identification field | Correct | Incorrect | Missing | Evaluated | Accuracy |",
  "|---|---:|---:|---:|---:|---:|",
  ...report.fieldSummary.map(f=>"| "+[f.field,f.correct,f.incorrect,f.missing,f.total,pct(f.accuracy)].join(" | ")+" |"),"",
  "| Marketplace | Captures / products | Recommendations | Coverage | Match precision | Judged matches | Within-capture recall | Independent-pool recall | Cohort precision | Sold-reference MAE (n) |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...report.summary.map(m=>"| "+[m.provider,m.recorded+" / "+report.labeledProducts,m.recommendations,pct(m.coverage),pct(m.matching.precision),pct(m.matching.judgmentCoverage),pct(m.withinRetrieved.recall),pct(m.matching.recall),pct(m.cohort.precision),usd(m.pricingError.mae)+" ("+m.pricingError.cases+")"].join(" | ")+" |"),"",
  "Coverage includes recorded provider errors. Unrecorded cases are shown separately. Precision excludes unjudged and uncertain listings; check the judgment coverage column. Recall is relative to the reviewed pool, not to all marketplace inventory. A dash means not measurable.","",
  "## Failure analysis","",
  ...report.summary.map(m=>"- **"+m.provider+":** "+(Object.entries(m.failures).map(([reason,count])=>reason+" "+count).join(", ")||"no recorded failures.")),"",
  "| Product | Category | Identification issues | Marketplace | Result | Eligible | Observed ask recommendation | Findings |",
  "|---|---|---|---|---|---:|---:|---|",
  ...report.cases.flatMap(c=>c.marketplace.map(m=>"| "+[c.id,c.category,c.identificationStatus==="ok"?c.identification.filter(f=>f.outcome!=="correct").map(f=>f.field+": "+f.outcome).join(", "):c.identificationStatus,m.provider,m.status,m.eligibleCount??"—",usd(m.price??null),[m.reason,...m.failureTypes??[],...m.blockers??[]].filter(Boolean).join("; ")].map(cell).join(" | ")+" |")),"",
  "The JSON report includes per-listing decisions, false positives, missed relevant items, pricing-cohort membership and signed/absolute percentage error. Sales error is evaluated only against at least three eligible, independently verified, authorized, same-marketplace item-only USD sales in the preceding 90 days. Asking prices are never used as sale references.","",
  "Engine source fingerprint: "+report.provenance.engineSourcesSha256,"",
 ];
 await mkdir(output,{recursive:true});
 await Promise.all([writeFile(reportPaths[0],JSON.stringify(report,null,2)+"\n"),writeFile(reportPaths[1],lines.join("\n")+"\n")]);
 console.log("Evaluated "+report.capturedProducts+" captures against "+report.labeledProducts+" labels. Reports: "+output);
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Evaluation failed.");process.exitCode=1;});
