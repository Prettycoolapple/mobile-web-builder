import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform, Share } from "react-native";
import { getApiBase } from "@/lib/api";
import { isOSChineseLocale } from "@/lib/i18n";
import type {
  FeasibilityReport,
  PropertyCandidate,
  SelectedListingContext,
} from "@/context/ChatContext";
import type { BrowseListing } from "@/lib/browseListings";

export const PENDING_SHARE_TOKEN_KEY = "@devfeasible/pending-share-token";

type ApiHeaders = Record<string, string>;

type ShareResponse = {
  token: string;
  url: string;
};

export type OpenedPropertyShare =
  | {
      token: string;
      kind: "candidate";
      address: string;
      payload: {
        kind: "candidate";
        address: string;
        candidate: PropertyCandidate;
      };
    }
  | {
      token: string;
      kind: "listing";
      address: string;
      payload: {
        kind: "listing";
        address: string;
        listing: BrowseListing;
      };
    }
  | {
      token: string;
      kind: "report";
      address: string;
      payload: {
        kind: "report";
        address: string;
        rerun: {
          address: string;
          selectedListingUrl?: string | null;
          selectedPhotoUrl?: string | null;
          selectedListingContext?: SelectedListingContext | null;
        };
      };
    };

function cleanAddress(address: string | null | undefined): string {
  return String(address ?? "").trim();
}

function reportAddress(report: FeasibilityReport): string {
  return cleanAddress(report.address) || cleanAddress(report.propertyOverview?.address);
}

function reportPhotoUrls(report: FeasibilityReport): string[] {
  const contexts = [
    report.selectedListingContext,
    report.propertyOverview?.selectedListingContext,
  ];
  return Array.from(new Set([
    ...(report.photoUrls ?? []),
    ...(report.photoUrl ? [report.photoUrl] : []),
    ...contexts.flatMap((ctx) => [
      ...(ctx?.photoUrls ?? []),
      ...(ctx?.photoUrl ? [ctx.photoUrl] : []),
    ]),
  ].filter((url): url is string => typeof url === "string" && url.trim().length > 0)));
}

function reportListingUrl(report: FeasibilityReport): string | null {
  return (
    report.propertyOverview?.listingUrl ??
    report.selectedListingContext?.listingUrl ??
    report.propertyOverview?.selectedListingContext?.listingUrl ??
    null
  );
}

function reportSelectedListingContext(report: FeasibilityReport): SelectedListingContext | null {
  return report.selectedListingContext ?? report.propertyOverview?.selectedListingContext ?? null;
}

async function createShare(body: unknown, headers: ApiHeaders): Promise<ShareResponse> {
  const resp = await fetch(`${getApiBase()}/shares`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null) as Partial<ShareResponse> | null;
  if (!resp.ok || !data?.url || !data.token) {
    throw new Error("Could not create share link.");
  }
  return { token: data.token, url: data.url };
}

async function shareText({ title, message, url }: { title: string; message: string; url: string }): Promise<void> {
  if (Platform.OS === "ios") {
    // WeChat's iOS share extension rejects plain text ("不支持的分享类型 / unsupported type"); it
    // needs a real URL item to build a link card. Pull the URL (and the trailing connector
    // punctuation that preceded it, e.g. "：" / ": ") out of the body and pass it as `url`, so
    // WeChat works and iMessage shows the description text plus one clean link preview (no
    // duplicated raw URL).
    const body = message.includes(url)
      ? message.replace(url, "").replace(/[\s：:，,]+$/u, "").trim()
      : message.trim();
    await Share.share({ title, message: body, url });
    return;
  }
  // Android: RN ignores `url`; keep the URL inline in the message so SMS / WeChat get the link.
  const text = message.includes(url) ? message : `${message} ${url}`;
  await Share.share({ title, message: text });
}

export async function shareCandidate(candidate: PropertyCandidate, headers: ApiHeaders): Promise<void> {
  const address = cleanAddress(candidate.address);
  if (!address) throw new Error("This property cannot be shared yet.");
  const share = await createShare({ kind: "candidate", address, candidate }, headers);
  const zh = isOSChineseLocale();
  await shareText({
    title: zh ? "奥房房产机会" : "Project Alpha property opportunity",
    message: zh
      ? `我在奥房上发现了一个房产机会：${address}，点击查看更多：${share.url}`
      : `I found this opportunity on Project Alpha: ${address}. Open Project Alpha to view more: ${share.url}`,
    url: share.url,
  });
}

export async function shareListing(listing: BrowseListing, headers: ApiHeaders): Promise<void> {
  const address = cleanAddress(listing.address);
  if (!address) throw new Error("This listing cannot be shared yet.");
  const share = await createShare({ kind: "listing", address, listing }, headers);
  const zh = isOSChineseLocale();
  await shareText({
    title: zh ? "奥房房源" : "Project Alpha property listing",
    message: zh
      ? `我在奥房上看到了一个房源：${address}，点击查看：${share.url}`
      : `I found this property listing on Project Alpha: ${address}. Open it here: ${share.url}`,
    url: share.url,
  });
}

export async function shareReport(report: FeasibilityReport, headers: ApiHeaders): Promise<void> {
  const address = reportAddress(report);
  if (!address) throw new Error("This report cannot be shared yet.");
  const selectedListingContext = reportSelectedListingContext(report);
  const photos = reportPhotoUrls(report);
  const share = await createShare({
    kind: "report",
    address,
    photoUrl: photos[0] ?? null,
    photoUrls: photos,
    listingUrl: reportListingUrl(report),
    selectedListingContext,
    summary: {
      score: report.scores?.composite ?? null,
      zone: report.zone_label ?? report.planning?.zone ?? report.propertyOverview?.zone ?? null,
      bedrooms: report.propertyOverview?.bedrooms ?? null,
      bathrooms: report.propertyOverview?.bathrooms ?? null,
      titleStatus: report.propertyOverview?.titleType ?? null,
      titleType: report.propertyOverview?.titleType ?? null,
      potentialLots: report.planning?.potentialLots ?? null,
      designLedRange: report.planning?.designLedYieldRange ?? null,
      landArea: report.propertyOverview?.landArea ?? null,
      floorArea: report.propertyOverview?.floorArea ?? null,
      listingPrice: report.propertyOverview?.listingPrice ?? null,
    },
  }, headers);
  const zh = isOSChineseLocale();
  await shareText({
    title: zh ? "奥房可行性分析" : "Project Alpha feasibility analysis",
    message: zh
      ? `奥房可行性分析报告 - ${address}，点击查看最新分析：${share.url}`
      : `Project Alpha feasibility analysis for ${address}. Open Project Alpha to view the latest analysis: ${share.url}`,
    url: share.url,
  });
}

export function parseShareTokenFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "devfeasible:" && (parsed.hostname === "share" || parsed.hostname === "property-share")) {
      return decodeURIComponent(parsed.pathname.replace(/^\/+/, "").split("/")[0] ?? "") || null;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    const shareIdx = parts.findIndex((part) => part === "share" || part === "property-share");
    if (shareIdx >= 0 && parts[shareIdx + 1]) {
      return decodeURIComponent(parts[shareIdx + 1]);
    }
  } catch {
    const match = url.match(/(?:^|\/)(?:property-)?share\/([^/?#]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

export async function storePendingShareToken(token: string): Promise<void> {
  await AsyncStorage.setItem(PENDING_SHARE_TOKEN_KEY, token);
}

export async function consumePendingShareToken(): Promise<string | null> {
  const token = await AsyncStorage.getItem(PENDING_SHARE_TOKEN_KEY);
  if (token) await AsyncStorage.removeItem(PENDING_SHARE_TOKEN_KEY);
  return token;
}

export async function openShareToken(token: string, headers: ApiHeaders): Promise<OpenedPropertyShare> {
  const resp = await fetch(`${getApiBase()}/shares/${encodeURIComponent(token)}`, {
    headers,
  });
  const data = await resp.json().catch(() => null) as OpenedPropertyShare | null;
  if (!resp.ok || !data?.payload || !data.kind) {
    throw new Error("This share link could not be opened.");
  }
  return data;
}
