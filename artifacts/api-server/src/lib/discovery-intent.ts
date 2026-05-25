export interface SubdivisionYieldCandidate {
  potentialLots?: number | null;
}

const EN_DEVELOPMENT_DISCOVERY =
  /\b(develop(?:ment)?|subdivi\w*|sub[-\s]?divide|section|sections|lot|lots|townhouse|terrace|duplex|infill|unitary|yield)\b/i;

const ZH_DEVELOPMENT_DISCOVERY =
  /(\u5f00\u53d1|\u958b\u767c|\u5206\u5272|\u5206\u5272\u5730|\u5206\u5730|\u7ec6\u5206|\u7d30\u5206|\u7ec6\u5206\u5730|\u7d30\u5206\u5730|\u5206\u5272\u6f5c\u529b|\u5206\u5272\u6f5b\u529b|\u53ef\u5206\u5272|\u53ef\u7d30\u5206|\u53ef\u7ec6\u5206|\u8054\u6392|\u806f\u6392|\u6392\u5c4b|\u53cc\u62fc|\u96d9\u62fc|\u52a0\u5efa|\u52a0\u76d6|\u52a0\u84cb|\u5730\u5757|\u5730\u584a|\u5730\u76ae|\u571f\u5730|\u5355\u5143\u623f|\u55ae\u5143\u623f|\u5f00\u53d1\u6f5c\u529b|\u958b\u767c\u6f5b\u529b|\u53ef\u5f00\u53d1|\u53ef\u958b\u767c)/i;

const EN_STANDARD_SUBDIVISION =
  /\b(subdivi\w*|sub[-\s]?divide|subdivision|vacant\s+lots?|new\s+titles?|separate\s+titles?|split\s+(?:the\s+)?(?:site|section|land|lot)|(?:2|two)\s+(?:vacant\s+)?lots?)\b/i;

const ZH_STANDARD_SUBDIVISION =
  /(\u5206\u5272|\u5206\u5272\u5730|\u5206\u5730|\u7ec6\u5206|\u7d30\u5206|\u7ec6\u5206\u5730|\u7d30\u5206\u5730|\u53ef\u5206\u5272|\u53ef\u7d30\u5206|\u53ef\u7ec6\u5206|\u5206\u5272\u6f5c\u529b|\u5206\u5272\u6f5b\u529b|\u5206\u6210\s*\u4e24|\u5206\u6210\s*\u4e8c|\u5206\u4e24\u5757|\u5206\u5169\u584a|\u4e24\u4e2a\u5730\u5757|\u5169\u500b\u5730\u584a|\u4e24\u5757\u5730|\u5169\u584a\u5730|\u72ec\u7acb\u4ea7\u6743|\u7368\u7acb\u7522\u6b0a|\u65b0\u4ea7\u6743|\u65b0\u7522\u6b0a)/i;

export function isDevelopmentDiscoveryIntent(criteria: string | null | undefined): boolean {
  if (!criteria) return false;
  return EN_DEVELOPMENT_DISCOVERY.test(criteria) || ZH_DEVELOPMENT_DISCOVERY.test(criteria);
}

export function isStandardSubdivisionDiscoveryIntent(criteria: string | null | undefined): boolean {
  if (!criteria) return false;
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
