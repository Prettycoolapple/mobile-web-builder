export interface AsbestosClassification {
  risk: "low" | "high" | "unknown";
  notes: string;
  worksafe_required: boolean;
}

export function classifyAsbestos(build_year: number | null): AsbestosClassification {
  if (build_year === null) {
    return {
      risk: "unknown",
      notes:
        "Build year unknown. A pre-demolition asbestos survey is recommended before any demolition works, as required under WorkSafe NZ guidelines.",
      worksafe_required: true,
    };
  }

  if (build_year < 1940) {
    return {
      risk: "low",
      notes:
        "Pre-1940 construction. Asbestos cement products were not in widespread use in NZ at this time.",
      worksafe_required: false,
    };
  }

  if (build_year <= 1990) {
    return {
      risk: "high",
      notes:
        "Built during the peak NZ asbestos use period (1940–1990). Buildings of this era commonly contain asbestos cement cladding (fibrolite), textured ceiling coatings, vinyl floor tiles, and pipe lagging. A licensed asbestos assessor is legally required before demolition under the Health and Safety at Work (Asbestos) Regulations 2016.",
      worksafe_required: true,
    };
  }

  return {
    risk: "low",
    notes:
      "Post-1990 construction. Asbestos was largely phased out of NZ building products by this time. Low risk.",
    worksafe_required: false,
  };
}
