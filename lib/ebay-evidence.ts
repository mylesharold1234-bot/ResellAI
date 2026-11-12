import {randomUUID} from 'node:crypto';
import type {MarketplaceResult,ProductQuery} from './marketplaces';
type RecordValue={result:MarketplaceResult;query:ProductQuery;created:number;review?:unknown};
const processState=globalThis as typeof globalThis & {resellaiEvidenceSnapshots?:Map<string,RecordValue>};
const records=processState.resellaiEvidenceSnapshots ||= new Map<string,RecordValue>();
export function saveEvidence(result:MarketplaceResult,query:ProductQuery){for(const [id,x] of records)if(Date.now()-x.created>1800000)records.delete(id);if(records.size>=100)records.delete(records.keys().next().value!);const id=randomUUID();records.set(id,{result,query,created:Date.now()});return id;}
export function getEvidence(id:string){const record=records.get(id);if(!record||Date.now()-record.created>1800000)throw Error('Evidence snapshot no longer available. Refresh comparisons.');return record;}
