/**
 * Detects an explicit "analyse the full package" prompt — the message the
 * '分析完整组合' / 'Analyse full package' button sends. We treat these as
 * hard-negative for the agent-contact intent so the button can never get
 * hijacked into the agent-contact bubble, no matter what other heuristics
 * say. Both English and Chinese phrasings are covered.
 */
export function isCombinedPackageAnalyseRequest(text: string): boolean {
  if (!text?.trim()) return false;
  const hasPackageSignal =
    /combined\s+(listing\s+)?package|full\s+package|package\s+analysis|analyse\s+.*package|analyze\s+.*package/i.test(text) ||
    /组合|完整组合|打包|整包|組合|完整組合/.test(text);
  if (!hasPackageSignal) return false;
  const hasMultiAddressSignal =
    /\b\d+[a-z]?\s+[^,&+]+(?:street|st|road|rd|avenue|ave|place|pl|drive|dr|terrace|tce|crescent|cres)\b[\s\S]{0,80}(?:&|\+| and | 和 |及)[\s\S]{0,80}\b\d+[a-z]?\s+[^,&+]+(?:street|st|road|rd|avenue|ave|place|pl|drive|dr|terrace|tce|crescent|cres)\b/i.test(text) ||
    /\b\d+[a-z]?\s+[^,&+]+(?:street|st|road|rd|avenue|ave|place|pl|drive|dr|terrace|tce|crescent|cres)\b[\s\S]{0,80}(?:&|\+| and | 和 |及)\s*\d+[a-z]?\b/i.test(text);
  return hasMultiAddressSignal || /组合|整包|打包|組合/.test(text) || /package/i.test(text);
}

export function hasExplicitAgentContactSignal(text: string): boolean {
  // Combined-package-analyse prompts must never be classified as agent-contact —
  // the '分析完整组合' button depends on this.
  if (isCombinedPackageAnalyseRequest(text)) return false;
  const lower = text.toLowerCase();
  const signals = [
    "agent", "listing agent", "sales agent", "selling agent", "realtor",
    "who is selling", "who listed", "contact agent", "call agent",
    "agent phone", "agent number", "open home", "viewing", "inspection",
    "谁是 agent", "誰是 agent", "agent 是谁", "agent 是誰",
    "中介", "经纪", "經紀", "销售中介", "銷售中介", "房产中介", "房產中介",
    "谁在卖", "誰在賣", "谁卖", "誰賣", "联系销售", "聯繫銷售",
    "联系中介", "聯繫中介", "看房", "开放日",
  ];
  return signals.some((signal) => lower.includes(signal.toLowerCase()));
}
