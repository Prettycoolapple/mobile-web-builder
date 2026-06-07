export interface SubdivisionYieldCandidate {
  potentialLots?: number | null;
}

const EN_DEVELOPMENT_DISCOVERY =
  /\b(develop(?:ment)?|development\s+(?:site|land|lot|opportunit(?:y|ies))|subdivi\w*|sub[-\s]?divide|infill|unitary|yield|duplex|terrace\s+(?:site|development)|townhouse\s+(?:site|development))\b/i;

const ZH_DEVELOPMENT_DISCOVERY =
  /(\u5f00\u53d1|\u958b\u767c|\u5206\u5272|\u5206\u5272\u5730|\u5206\u5730|\u7ec6\u5206|\u7d30\u5206|\u7ec6\u5206\u5730|\u7d30\u5206\u5730|\u5206\u5272\u6f5c\u529b|\u5206\u5272\u6f5b\u529b|\u53ef\u5206\u5272|\u53ef\u7d30\u5206|\u53ef\u7ec6\u5206|\u8054\u6392\u5f00\u53d1|\u806f\u6392\u958b\u767c|\u6392\u5c4b\u5f00\u53d1|\u53cc\u62fc|\u96d9\u62fc|\u52a0\u5efa|\u52a0\u76d6|\u52a0\u84cb|\u5f00\u53d1\u6f5c\u529b|\u958b\u767c\u6f5b\u529b|\u53ef\u5f00\u53d1|\u53ef\u958b\u767c)/i;

const EN_STANDARD_SUBDIVISION =
  /\b(subdivi\w*|sub[-\s]?divide|subdivision|vacant\s+lots?|new\s+titles?|separate\s+titles?|split\s+(?:the\s+)?(?:site|section|land|lot)|(?:2|two)\s+(?:vacant\s+)?lots?)\b/i;

const ZH_STANDARD_SUBDIVISION =
  /(\u5206\u5272|\u5206\u5272\u5730|\u5206\u5730|\u7ec6\u5206|\u7d30\u5206|\u7ec6\u5206\u5730|\u7d30\u5206\u5730|\u53ef\u5206\u5272|\u53ef\u7d30\u5206|\u53ef\u7ec6\u5206|\u5206\u5272\u6f5c\u529b|\u5206\u5272\u6f5b\u529b|\u5206\u6210\s*\u4e24|\u5206\u6210\s*\u4e8c|\u5206\u4e24\u5757|\u5206\u5169\u584a|\u4e24\u4e2a\u5730\u5757|\u5169\u500b\u5730\u584a|\u4e24\u5757\u5730|\u5169\u584a\u5730|\u72ec\u7acb\u4ea7\u6743|\u7368\u7acb\u7522\u6b0a|\u65b0\u4ea7\u6743|\u65b0\u7522\u6b0a)/i;

const EN_DISCOVERY_ACTION_WITH_PROPERTY_OBJECT =
  /\b(?:find|show|search|browse|list|look(?:ing)?\s+for)\b.{0,90}\b(?:properties|property|listings?|homes?|houses?|sections?|land|sites?|opportunit(?:y|ies))\b/i;

const EN_SUBDIVISION_DISCOVERY_QUESTION =
  /\b(?:what(?:'s|\s+is|\s+are)?|any|which)\b.{0,90}\b(?:subdividable|subdivision\s+opportunit(?:y|ies)|development\s+sites?|developable\s+(?:properties|sites?|land))\b/i;

const EN_SUBDIVISION_RULES_INFORMATION =
  /(?:\b(?:what|which|where|how|when|why)\b.{0,120}\b(?:rules?|requirements?|regulations?|criteria|standards?|process|steps?|consent|zoning|unitary\s+plan|minimum\s+lot|min\s+lot|allowed|allowance|work|works)\b|\b(?:explain|understand|clarify|summari[sz]e|tell\s+me\s+about)\b.{0,120}\b(?:subdivi\w*|sub[-\s]?divide|development\s+rules?)\b|\b(?:subdivi\w*|sub[-\s]?divide)\b.{0,120}\b(?:rules?|requirements?|regulations?|criteria|standards?|process|steps?|consent|zoning|unitary\s+plan|minimum\s+lot|min\s+lot|how\s+it\s+works)\b)/i;

const ZH_SUBDIVISION_RULES_INFORMATION =
  /(?:\u89e3\u91ca|\u8bf4\u660e|\u544a\u8bc9|\u4e86\u89e3|\u89c4\u5219|\u8981\u6c42|\u6807\u51c6|\u6d41\u7a0b|\u600e\u4e48|\u5982\u4f55).{0,80}(?:\u5206\u5272|\u5206\u5730|\u7ec6\u5206|\u7d30\u5206|\u5f00\u53d1|\u958b\u767c)|(?:\u5206\u5272|\u5206\u5730|\u7ec6\u5206|\u7d30\u5206).{0,80}(?:\u89c4\u5219|\u8981\u6c42|\u6807\u51c6|\u6d41\u7a0b|\u600e\u4e48|\u5982\u4f55)/i;

export function isSubdivisionRulesInformationIntent(criteria: string | null | undefined): boolean {
  if (!criteria) return false;
  if (EN_DISCOVERY_ACTION_WITH_PROPERTY_OBJECT.test(criteria) || EN_SUBDIVISION_DISCOVERY_QUESTION.test(criteria)) {
    return false;
  }
  return EN_SUBDIVISION_RULES_INFORMATION.test(criteria) || ZH_SUBDIVISION_RULES_INFORMATION.test(criteria);
}

export function isDevelopmentDiscoveryIntent(criteria: string | null | undefined): boolean {
  if (!criteria) return false;
  if (isSubdivisionRulesInformationIntent(criteria)) return false;
  return EN_DEVELOPMENT_DISCOVERY.test(criteria) || ZH_DEVELOPMENT_DISCOVERY.test(criteria);
}

export function isStandardSubdivisionDiscoveryIntent(criteria: string | null | undefined): boolean {
  if (!criteria) return false;
  if (isSubdivisionRulesInformationIntent(criteria)) return false;
  return EN_STANDARD_SUBDIVISION.test(criteria) || ZH_STANDARD_SUBDIVISION.test(criteria);
}

export function hasStandardSubdivisionYield(candidate: SubdivisionYieldCandidate): boolean {
  return (candidate.potentialLots ?? 1) >= 2;
}

export function shouldContinueDiscoveryDrain(input: {
  currentCount: number;
  remainingCount: number;
  attempts: number;
  strictStandardSubdivision: boolean;
  nonStrictAttemptLimit: number;
  targetCount?: number;
}): boolean {
  if (input.remainingCount <= 0) return false;
  const target = input.targetCount ?? 3;
  if (input.strictStandardSubdivision) return input.currentCount < target;
  return input.currentCount === 0 && input.attempts < input.nonStrictAttemptLimit;
}
