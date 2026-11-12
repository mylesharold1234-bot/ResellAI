import {AlertTriangle} from 'lucide-react';
import type {Identification} from '../lib/identification';
import type {MatchDetails} from '../lib/marketplaces';
import {assessIdentification,recognizableName} from '../lib/product-profile';
export function IdentificationWarning({identification,details}:{identification:Identification;details?:MatchDetails}){
 const assessment=assessIdentification(identification,details);
 if(assessment.specific)return null;
 return <div role="status" className="info-card" style={{border:'1px solid #d97706',background:'#fffbeb',color:'#78350f'}}><strong><AlertTriangle size={19} aria-hidden="true" style={{display:'inline',verticalAlign:'middle',marginRight:8}} />Identification incomplete</strong><p>We recognized this item as {recognizableName(identification)||'an item'}, but some details remain uncertain. Add information for a more accurate comparison, or continue with a general marketplace search.</p><p className="fine">Helpful details: {assessment.missing.join('; ')}. These are optional.</p></div>;
}
