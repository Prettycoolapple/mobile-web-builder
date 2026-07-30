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
    /\b(?:analyse|analyze|assess|evaluate|buy|purchase)\b[\s\S]{0,100}\b(?:all|both)\b[\s\S]{0,80}\b(?:properties|sites|lots|titles|parcels)\b/i.test(text) ||
    /\b(?:properties|sites|lots|titles|parcels)\b[\s\S]{0,80}\b(?:sold|offered|marketed|analysed|analyzed)\s+together\b/i.test(text) ||
    /\b(?:all\s+(?:two|three|four|five|\d+)|both)\b[\s\S]{0,50}\b(?:together|combined)\b/i.test(text) ||
    /组合|完整组合|打包|整包|組合|完整組合/.test(text);
  if (!hasPackageSignal) return false;
  const hasMultiAddressSignal =
    /\b\d+[a-z]?\s+[^,&+]+(?:street|st|road|rd|avenue|ave|place|pl|drive|dr|terrace|tce|crescent|cres)\b[\s\S]{0,80}(?:&|\+| and | 和 |及)[\s\S]{0,80}\b\d+[a-z]?\s+[^,&+]+(?:street|st|road|rd|avenue|ave|place|pl|drive|dr|terrace|tce|crescent|cres)\b/i.test(text) ||
    /\b\d+[a-z]?\s+[^,&+]+(?:street|st|road|rd|avenue|ave|place|pl|drive|dr|terrace|tce|crescent|cres)\b[\s\S]{0,80}(?:&|\+| and | 和 |及)\s*\d+[a-z]?\b/i.test(text);
  const hasNumberRangeSignal =
    /\b\d+[a-z]?\s*[-\u2013\u2014]\s*\d+[a-z]?\b/i.test(text);
  return hasMultiAddressSignal ||
    hasNumberRangeSignal ||
    /组合|整包|打包|組合/.test(text) ||
    /package/i.test(text);
}

/**
 * Report follow-up questions ("what are the key risks", "explain the cost
 * estimate", "5 个地块的审批流程是什么") are hard-negative for agent contact.
 *
 * Without this guard a single earlier "Contact Sales agent" turn poisons the
 * classifier: the LLM sees it in the recent conversation and keeps answering
 * every later question with the agent card instead of the actual answer.
 * Callers must run {@link hasExplicitAgentContactSignal} FIRST so a genuine
 * "call the agent about the consent process" still resolves to the agent.
 */
export function isReportFollowUpQuestion(text: string): boolean {
  if (!text?.trim()) return false;
  const lower = text.toLowerCase();
  const englishTopic =
    /\b(risk|risks|cost|costs|costing|budget|estimate|estimates|breakdown|roi|return|returns|profit|margin|yield|gdv|feasib\w*|zoning|zone|planning|overlay|overlays|consent|consents|approval|approvals|council|process|timeline|timeframe|how long|subdivid\w*|subdivision|lots?|infrastructure|services|water|wastewater|stormwater|sewer|retaining|slope|terrain|contamination|asbestos|heritage|flood|comparable|comparables|valuation|cv|contribution|contributions|levy|levies|finance|funding|interest rate|holding cost|scores?|assumptions?)\b/i.test(
      lower,
    ) ||
    /\b(explain|why|what does|what do you mean|clarify|elaborate|walk me through|break (?:it|this) down)\b/i.test(lower);
  const chineseTopic =
    /(风险|風險|成本|费用|費用|预算|預算|估算|明细|明細|回报|回報|利润|利潤|收益|可行性|分区|分區|规划|規劃|资源同意|資源同意|建筑许可|建築許可|审批|審批|流程|多久|时间线|時間線|工期|分割|细分|細分|地块|地塊|基础设施|基礎設施|供水|污水|雨水|挡土墙|擋土牆|坡度|地形|石棉|洪水|可比|成交|估值|评分|評分|解释|解釋|为什么|為什麼|说明|說明)/u.test(
      text,
    );
  return englishTopic || chineseTopic;
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
