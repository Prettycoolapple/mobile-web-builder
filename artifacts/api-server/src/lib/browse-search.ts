const BROWSE_SEARCH_ALIASES: Record<string, string[]> = {
  flatbush: ["flat bush"],
  stheliers: ["st heliers"],
  saintheliers: ["st heliers"],
  mteden: ["mt eden"],
  mounteden: ["mt eden"],
  mtralbert: ["mt albert"],
  mountalbert: ["mt albert"],
  mtwellington: ["mt wellington"],
  mountwellington: ["mt wellington"],
  teatu: ["te atatu"],
  teatatu: ["te atatu"],
  teatatusouth: ["te atatu south"],
  teatatupeninsula: ["te atatu peninsula"],
};

export function compactBrowseSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeBrowseSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function browseSearchVariants(query: string): string[] {
  const normalized = normalizeBrowseSearchText(query);
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);
  const compact = compactBrowseSearchText(normalized);
  for (const alias of BROWSE_SEARCH_ALIASES[compact] ?? []) {
    variants.add(alias);
  }
  return [...variants];
}
