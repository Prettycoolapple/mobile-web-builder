import type { Locale } from "./prompts";

export type AssistantTrustResponseKind =
  | "trust"
  | "source_list"
  | "provider_authority"
  | "more_providers";

const TRUST_RESPONSE_EN =
  "You can treat this as a live, current feasibility view. Project Alpha uses up-to-date property signals, including Government and REINZ information, but the output is still a decision-support summary rather than legal or financial advice.";

const SOURCE_LIST_RESPONSE_EN =
  "I can't list every underlying reference or internal source. At a high level, Project Alpha uses Government and REINZ information alongside our property analysis process.";

const PROVIDER_AUTHORITY_RESPONSE_EN =
  "These consultant recommendations are not a general web search. They come from Project Alpha partnered consultants who have been verified for relevant expertise and local experience.";

const MORE_PROVIDERS_RESPONSE_EN =
  "When more consultants come online, we'll notify you. You can also try again later.";

const TRUST_RESPONSE_ZH =
  "\u53ef\u4ee5\u628a\u5b83\u7406\u89e3\u4e3a\u5b9e\u65f6\u3001\u5f53\u524d\u7684\u53ef\u884c\u6027\u53c2\u8003\u3002Project Alpha \u4f1a\u4f7f\u7528\u6700\u65b0\u7684\u623f\u4ea7\u4fe1\u53f7\uff0c\u5305\u62ec Government \u548c REINZ \u4fe1\u606f\uff0c\u4f46\u7ed3\u679c\u4ecd\u5c5e\u4e8e\u51b3\u7b56\u8f85\u52a9\u6458\u8981\uff0c\u4e0d\u662f\u6cd5\u5f8b\u6216\u8d22\u52a1\u5efa\u8bae\u3002";

const SOURCE_LIST_RESPONSE_ZH =
  "\u6211\u4e0d\u80fd\u5217\u51fa\u6240\u6709\u5e95\u5c42\u53c2\u8003\u4fe1\u606f\u6216\u5185\u90e8\u6765\u6e90\u3002\u7b80\u5355\u8bf4\uff0cProject Alpha \u4f1a\u4f7f\u7528 Government \u548c REINZ \u4fe1\u606f\uff0c\u5e76\u7ed3\u5408\u6211\u4eec\u7684\u623f\u4ea7\u5206\u6790\u6d41\u7a0b\u3002";

const PROVIDER_AUTHORITY_RESPONSE_ZH =
  "\u8fd9\u4e9b\u987e\u95ee\u63a8\u8350\u4e0d\u662f\u5168\u7f51\u641c\u7d22\u3002\u4ed6\u4eec\u90fd\u662f Project Alpha \u7684\u5408\u4f5c\u987e\u95ee\uff0c\u5df2\u6838\u9a8c\u76f8\u5173\u4e13\u4e1a\u80fd\u529b\u548c\u672c\u5730\u7ecf\u9a8c\u3002";

const MORE_PROVIDERS_RESPONSE_ZH =
  "\u6709\u66f4\u591a\u987e\u95ee\u4e0a\u7ebf\u65f6\uff0c\u6211\u4eec\u4f1a\u901a\u77e5\u60a8\u3002\u60a8\u4e5f\u53ef\u4ee5\u7a0d\u540e\u518d\u8bd5\u3002";

function compact(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function containsHan(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isProviderContext(text: string): boolean {
  return hasAny(text, [
    /\b(provider|consultant|planner|architect|designer|engineer|builder|surveyor|specialist|professional|advisor|adviser)\b/i,
    /顾问|規劃師|规划师|建築師|建筑师|設計師|设计师|工程師|工程师|測量師|测量师|專家|专家|專業人士|专业人士|推荐的人|推薦的人/i,
  ]);
}

function isMoreProviderRequest(text: string): boolean {
  if (!isProviderContext(text)) return false;
  return hasAny(text, [
    /\b(other|another|more|different|second|alternative|else|not only one|surely not only|must have more|surely.*more)\b/i,
    /其他|其它|别的|別的|更多|另一个|另一個|不只有一个|不只有一個|肯定不只有|多推荐|多推薦|换一个|換一個/i,
  ]);
}

function isProviderAuthorityQuestion(text: string): boolean {
  if (!isProviderContext(text)) return false;
  return hasAny(text, [
    /\b(how|where|why|source|authority|authoritative|verified|trust|credible|reliable|web search|internet search|google|whole web|online search)\b/i,
    /\bcome from|came from|based on|selected|chosen|recommended|recommendation\b/i,
    /怎么来|怎麼來|哪里来|哪裡來|依据|依據|根据|根據|全网|全網|网上搜|網上搜|权威|權威|可靠|可信|怎么推荐|怎麼推薦|推荐.*怎么|推薦.*怎麼/i,
  ]);
}

function isSourceListRequest(text: string): boolean {
  const asksForSources = hasAny(text, [
    /\b(source|sources|reference|references|data source|citation|citations|links?|urls?)\b/i,
    /参考|參考|来源|來源|资料|資料|信息源|出处|出處|链接|連結|依据|依據/i,
  ]);
  if (!asksForSources) return false;

  return hasAny(text, [
    /\b(list|show|give|provide|tell|all|every|everything|full|complete)\b/i,
    /列出|列出来|列出來|全部|所有|完整|都有哪些|哪些信息|哪些資訊|给我|給我|告诉我|告訴我|把.*列/i,
  ]);
}

function isTrustQuestion(text: string): boolean {
  return hasAny(text, [
    /\b(can i trust|should i trust|trust you|how reliable|how accurate|accuracy|confidence|credible|credibility|up to date|live data|current data|real data|fresh data)\b/i,
    /\b(is this reliable|is this accurate|can this be trusted)\b/i,
    /可信度|可信|相信你|信你|准确度|準確度|准确性|準確性|可靠|靠谱吗|靠譜嗎|靠谱么|靠譜么|实时|實時|最新|真实|真實|担心.*准确|擔心.*準確/i,
  ]);
}

export function classifyAssistantTrustResponse(message: string): AssistantTrustResponseKind | null {
  const text = compact(message);
  if (!text) return null;

  if (isMoreProviderRequest(text)) return "more_providers";
  if (isProviderAuthorityQuestion(text)) return "provider_authority";
  if (isSourceListRequest(text)) return "source_list";
  if (isTrustQuestion(text)) return "trust";

  return null;
}

export function assistantTrustResponseFor(
  message: string,
  locale: Locale = "en",
): { kind: AssistantTrustResponseKind; content: string } | null {
  const kind = classifyAssistantTrustResponse(message);
  if (!kind) return null;

  const zh = locale === "zh" || containsHan(message);
  const content =
    kind === "trust" ? (zh ? TRUST_RESPONSE_ZH : TRUST_RESPONSE_EN)
      : kind === "source_list" ? (zh ? SOURCE_LIST_RESPONSE_ZH : SOURCE_LIST_RESPONSE_EN)
      : kind === "provider_authority" ? (zh ? PROVIDER_AUTHORITY_RESPONSE_ZH : PROVIDER_AUTHORITY_RESPONSE_EN)
      : (zh ? MORE_PROVIDERS_RESPONSE_ZH : MORE_PROVIDERS_RESPONSE_EN);

  return { kind, content };
}
