import * as aucklandCouncil from "./auckland-council";
import type { ContourResult, Overlay, ZoneResult } from "./auckland-council";
import { fetchInfrastructure, type InfrastructureFetchOptions, type InfrastructureItem } from "./infrastructure";
import type { ParcelBbox } from "./linz";
import { fetchPropertyHistory, type PropertyHistory } from "./property-data";
import {
  fetchRegionalPlanningOverlays,
  fetchRegionalPlanningZone,
} from "./regional-arcgis";
import { fetchRegionalInfrastructure } from "./regional-infrastructure";
import {
  emptyPropertyHistory,
  partialProviderZone,
  regionalPlanningProvidersEnabled,
  resolvePlanningJurisdiction,
  type PlanningProviderContext,
} from "./regional-planning";

type FetchContourOptions = Parameters<typeof aucklandCouncil.fetchContour>[3];

function context(lat: number, lng: number, address?: string | null): PlanningProviderContext {
  return { lat, lng, address: address ?? null };
}

function shouldUseLegacyAuckland(lat: number, lng: number, address?: string | null): boolean {
  if (!regionalPlanningProvidersEnabled()) return true;
  return resolvePlanningJurisdiction(context(lat, lng, address)).providerId === "auckland-legacy";
}

export async function fetchPlanningZoneForReport(
  lat: number,
  lng: number,
  address?: string | null,
): Promise<ZoneResult> {
  if (shouldUseLegacyAuckland(lat, lng, address)) {
    return aucklandCouncil.fetchUnitaryPlanZone(lat, lng);
  }

  const jurisdiction = resolvePlanningJurisdiction(context(lat, lng, address));
  return fetchRegionalPlanningZone(jurisdiction, lat, lng).catch(() => partialProviderZone(jurisdiction));
}

export async function fetchPlanningOverlaysForReport(
  lat: number,
  lng: number,
  parcelBbox?: ParcelBbox | null,
  options?: {
    address?: string | null;
    consensus?: boolean;
  },
): Promise<Overlay[]> {
  if (shouldUseLegacyAuckland(lat, lng, options?.address)) {
    return options?.consensus
      ? aucklandCouncil.fetchOverlaysWithConsensus(lat, lng, parcelBbox)
      : aucklandCouncil.fetchOverlays(lat, lng, parcelBbox);
  }

  return fetchRegionalPlanningOverlays(
    resolvePlanningJurisdiction(context(lat, lng, options?.address)),
    lat,
    lng,
    parcelBbox,
  ).catch(() => []);
}

export async function fetchTerrainForReport(
  lat: number,
  lng: number,
  parcelBbox?: ParcelBbox | null,
  options?: FetchContourOptions,
  _address?: string | null,
): Promise<ContourResult> {
  // The terrain implementation is already national-first (LINZ/OpenTopoData/
  // Terrarium) despite living beside the Auckland GIS code. Keep it available
  // for non-Auckland regions so reports can still reason about slope without
  // borrowing Auckland planning layers.
  return aucklandCouncil.fetchContour(lat, lng, parcelBbox, options);
}

export async function fetchPropertyHistoryForReport(
  address: string,
  lat?: number | null,
  lng?: number | null,
  linzAreaSqm?: number | null,
): Promise<PropertyHistory> {
  if (lat == null || lng == null || shouldUseLegacyAuckland(lat, lng, address)) {
    return fetchPropertyHistory(address, lat, lng, linzAreaSqm);
  }

  return emptyPropertyHistory(linzAreaSqm);
}

export async function fetchInfrastructureForReport(
  lat: number,
  lng: number,
  parcelBbox?: ParcelBbox | null,
  targetParcelId?: string | null,
  options?: InfrastructureFetchOptions,
  address?: string | null,
): Promise<InfrastructureItem[]> {
  if (shouldUseLegacyAuckland(lat, lng, address)) {
    return fetchInfrastructure(lat, lng, parcelBbox, targetParcelId, options);
  }

  return fetchRegionalInfrastructure(
    resolvePlanningJurisdiction(context(lat, lng, address)).providerId,
    lat,
    lng,
    parcelBbox,
    options,
  ).catch(() => []);
}
