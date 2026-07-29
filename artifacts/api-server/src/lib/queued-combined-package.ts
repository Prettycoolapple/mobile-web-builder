import { extractCombinedListingAddressParts } from "./scrapers/realestate-api";

/**
 * The foreground /analyse request has already resolved and semantically
 * confirmed a package before it stores `analysisAddress` on a queued mobile
 * job. Do not make that worker dependent on a second successful portal lookup:
 * if the stored canonical address differs from the user's raw query and still
 * parses as a package, it is trusted as the foreground decision.
 */
export function resolveConfirmedQueuedPackage(
  queryAddress: string,
  analysisAddress: string,
): { packageAddress: string; childAddresses: string[]; listingUrl: null } | null {
  if (!analysisAddress.trim() || analysisAddress.trim() === queryAddress.trim()) return null;
  const parsed = extractCombinedListingAddressParts(analysisAddress);
  if (!parsed) return null;
  return {
    packageAddress: parsed.packageAddress,
    childAddresses: parsed.childAddresses.slice(0, 10),
    listingUrl: null,
  };
}
