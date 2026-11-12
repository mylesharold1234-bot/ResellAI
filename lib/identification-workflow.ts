import { normalizeProduct, recognizableName, type FieldSources } from "./product-profile";
import type { FacebookLocation } from "./facebook";
import {
  emptyMatchDetails,
  parseMatchDetails,
  type MatchDetails,
} from "./marketplaces";
import { type Identification, parseIdentification } from "./identification";
export type ProductPhoto = {
  id: string;
  url: string;
  name: string;
  file?: File;
};
export type IdentificationState = {
  aiIdentification: Identification | null;
  sources: FieldSources;
  photos: ProductPhoto[];
  details: MatchDetails;
  facebookLocation: FacebookLocation | null;
  confirmationId: string | null;
  draft: Identification | null;
  confirmed: Identification | null;
  edited: boolean;
};
export const emptyIdentificationState: IdentificationState = {
  aiIdentification: null,
  sources: {},
  photos: [],
  details: emptyMatchDetails,
  facebookLocation: null,
  confirmationId: null,
  draft: null,
  confirmed: null,
  edited: false,
};
export type IdentificationAction =
  | { type: "photos"; photos: ProductPhoto[] }
  | { type: "identified"; identification: Identification }
  | { type: "edit"; identification: Identification }
  | { type: "confirm"; requestId?: string; mode?: "refined" | "general" }
  | { type: "details"; details: MatchDetails }
  | { type: "facebook-location"; location: FacebookLocation | null }
  | { type: "reset" };
export function identificationReducer(
  state: IdentificationState,
  action: IdentificationAction,
): IdentificationState {
  switch (action.type) {
    case "photos":
      return {
        ...emptyIdentificationState,
        facebookLocation: state.facebookLocation,
        photos: action.photos,
      };
    case "identified":
      return {
        ...state,
        aiIdentification: parseIdentification(action.identification),
        sources: Object.fromEntries(Object.keys(action.identification).filter(k=>typeof action.identification[k as keyof Identification] === "string").map(k=>[k,action.identification.understanding?.evidence.find(e=>e.field===k)?.source || "ai-inferred"])),
        draft: normalizeProduct(parseIdentification(action.identification)),
        details: {
          ...state.details,
          condition: state.details.condition || (action.identification.understanding?.evidence.some(e=>e.field==="describedCondition"&&e.source==="user-described") ? /for parts|not working/i.test(action.identification.understanding.describedCondition||"") ? "parts" : /used|pre.?owned/i.test(action.identification.understanding.describedCondition||"") ? "used" : /new|unused/i.test(action.identification.understanding.describedCondition||"") ? "new" : "" : ""),
          subtype: action.identification.understanding?.subtype || "",
          includedAccessories: (action.identification.understanding?.includedAccessories || []).join(", "),
          productIdentifier: "",
          productIdentifierVerified: false,
        },
        confirmed: null,
        confirmationId: null,
        edited: false,
      };
    case "edit":
      return {
        ...state,
        draft: normalizeProduct(parseIdentification(action.identification)),
        sources: Object.fromEntries(Object.keys(state.sources).concat(["brand","productName","category","model","colorway","visibleCondition","identifyingInformation"]).map(k=>[k,action.identification[k as keyof Identification] === state.aiIdentification?.[k as keyof Identification] ? state.aiIdentification?.understanding?.evidence.find(e=>e.field===k)?.source || "ai-inferred" : "user-provided"])),
        confirmed: null,
        confirmationId: null,
        edited: true,
      };
    case "confirm": {
      if (
        !state.photos.length ||
        !state.draft || !recognizableName(state.draft)
      )
        throw new Error("Describe the recognizable item before confirming.");
      if(action.mode !== "general") parseMatchDetails(state.details);
      return {
        ...state,
        details: action.mode === "general" ? {...emptyMatchDetails} : state.details,
        confirmationId: action.requestId || null,
        confirmed: normalizeProduct(parseIdentification(state.draft)),
      };
    }
    case "details":
      return { ...state, details: action.details };
    case "facebook-location":
      return { ...state, facebookLocation: action.location };
    case "reset":
      return emptyIdentificationState;
  }
}
