export type ProviderRecommendationDiscipline =
  | "architect_designer"
  | "planner"
  | "engineer"
  | "quantity_surveyor"
  | "other";

export interface ProviderRecommendationIntentSignal {
  wantsProviderRecommendation: boolean;
  wantsAnotherProvider: boolean;
  suggestedDiscipline: ProviderRecommendationDiscipline | null;
}

const disciplineMatchers: Array<{
  discipline: ProviderRecommendationDiscipline;
  patterns: RegExp[];
}> = [
  {
    discipline: "quantity_surveyor",
    patterns: [
      /\b(?:quantity\s+surveyor|qs|cost\s+consultant|cost\s+estimator)\b/i,
      /(?:\u9020\u4ef7|\u9020\u50f9|\u5de5\u6599\u6d4b\u91cf|\u5de5\u6599\u6e2c\u91cf)/,
    ],
  },
  {
    discipline: "engineer",
    patterns: [
      /\b(?:(?:civil|structural|geotech(?:nical)?|drainage)\s+engineer|engineer)\b/i,
      /\b(?:civil|structural|geotech(?:nical)?|drainage)\b/i,
      /(?:\u5de5\u7a0b\u5e08|\u5de5\u7a0b\u5e2b|\u571f\u6728|\u7ed3\u6784|\u7d50\u69cb|\u5ca9\u571f|\u6392\u6c34)/,
    ],
  },
  {
    discipline: "planner",
    patterns: [
      /\b(?:planner|planning\s+consultant|town\s+planner|resource\s+consent\s+consultant)\b/i,
      /(?:\u89c4\u5212\u5e08|\u898f\u5283\u5e2b|\u89c4\u5212\u987e\u95ee|\u898f\u5283\u9867\u554f|\u8d44\u6e90\u8bb8\u53ef|\u8cc7\u6e90\u8a31\u53ef)/,
    ],
  },
  {
    discipline: "architect_designer",
    patterns: [
      /\b(?:architect|designer|architectural\s+designer|draftsperson)\b/i,
      /(?:\u5efa\u7b51\u5e08|\u5efa\u7bc9\u5e2b|\u8bbe\u8ba1\u5e08|\u8a2d\u8a08\u5e2b|\u8bbe\u8ba1\u987e\u95ee|\u8a2d\u8a08\u9867\u554f)/,
    ],
  },
  {
    discipline: "other",
    patterns: [
      /\b(?:builder|project\s+manager|specialist|professional|consultant|contractor)\b/i,
      /(?:\u987e\u95ee|\u9867\u554f|\u4e13\u4e1a\u4eba\u58eb|\u5c08\u696d\u4eba\u58eb|\u670d\u52a1\u5546|\u670d\u52d9\u5546|\u5efa\u5546|\u627f\u5305\u5546)/,
    ],
  },
];

const recommendationPatterns = [
  /\b(?:recommend|referral|refer|introduce|connect|find\s+me|find\s+us|who\s+can\s+help|do\s+you\s+know|know\s+anyone|any\s+(?:good\s+)?(?:specialists?|professionals?|consultants?)|need\s+(?:a|an|some))\b/i,
  /(?:\u63a8\u8350|\u63a8\u85a6|\u4ecb\u7ecd|\u4ecb\u7d39|\u5e2e\u6211|\u5e6b\u6211|\u5e2e\u5fd9\u627e|\u5e6b\u5fd9\u627e|\u7ed9\u6211|\u7d66\u6211|\u9700\u8981|\u627e(?:\u4e00\u4e0b)?|\u6709\u6ca1\u6709|\u6709\u6c92\u6709)/,
];

const anotherProviderPatterns = [
  /\b(?:another|different|someone\s+else|other\s+one|more\s+options?|swap|replace|change|next|skip|pass)\b/i,
  /(?:\u6362\u4e00\u4e2a|\u63db\u4e00\u500b|\u6362\u4eba|\u63db\u4eba|\u522b\u7684|\u5225\u7684|\u5176\u4ed6|\u5176\u4ed6|\u53e6\u4e00\u4e2a|\u53e6\u4e00\u500b|\u4e0b\u4e00\u4e2a|\u4e0b\u4e00\u500b|\u4e0d\u5408\u9002|\u4e0d\u5408\u9069)/,
];

function matchDiscipline(text: string): ProviderRecommendationDiscipline | null {
  for (const candidate of disciplineMatchers) {
    if (candidate.patterns.some((pattern) => pattern.test(text))) {
      return candidate.discipline;
    }
  }
  return null;
}

function isShortProviderFollowUp(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return compact.length > 0 && compact.length <= 32 && /(?:\?|\uff1f|\u5462|\u5417|\u55ce)?$/.test(compact);
}

export function detectProviderRecommendationIntent(text: string): ProviderRecommendationIntentSignal {
  const content = String(text ?? "").trim();
  if (!content) {
    return { wantsProviderRecommendation: false, wantsAnotherProvider: false, suggestedDiscipline: null };
  }

  const suggestedDiscipline = matchDiscipline(content);
  const hasProviderTerm = suggestedDiscipline !== null;
  const hasRecommendationPhrase = recommendationPatterns.some((pattern) => pattern.test(content));
  const wantsAnotherProvider = anotherProviderPatterns.some((pattern) => pattern.test(content));
  const wantsProviderRecommendation =
    hasProviderTerm && (hasRecommendationPhrase || wantsAnotherProvider || isShortProviderFollowUp(content));

  return {
    wantsProviderRecommendation,
    wantsAnotherProvider: hasProviderTerm && wantsAnotherProvider,
    suggestedDiscipline: wantsProviderRecommendation ? suggestedDiscipline : null,
  };
}
