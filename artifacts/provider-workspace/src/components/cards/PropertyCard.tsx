import { useState } from "react";
import type { PropertyCandidate } from "@/state/chat-model";
import { candidatePriceText, formatArea, formatScore, scoreColor } from "@/lib/format";
import { ScoreBadge } from "./ScoreBadge";

interface PropertyCardProps {
  candidate: PropertyCandidate;
  presentation: "generic_listing" | "scored_screening";
  onAnalyse: (candidate: PropertyCandidate) => void;
  analysing?: boolean;
}

function ScorePip({ score, label, loading }: { score: number; label: string; loading?: boolean }) {
  return (
    <div className="score-pill">
      <span className="label">{label}</span>
      <span className="val" style={{ color: loading ? "var(--muted)" : scoreColor(score) }}>
        {loading ? "…" : formatScore(score)}
      </span>
    </div>
  );
}

export function PropertyCard({ candidate, presentation, onAnalyse, analysing }: PropertyCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const scored = presentation === "scored_screening";
  const photo = !imgFailed ? candidate.photoUrl ?? candidate.photoUrls?.[0] : undefined;
  const price = candidatePriceText(candidate);
  const composite = candidate.scores?.composite ?? 0;
  const scoresLoading = candidate.scoresLoading || (scored && !(composite > 0));

  const metaBits: string[] = [];
  if (typeof candidate.bedrooms === "number" && candidate.bedrooms > 0)
    metaBits.push(`${candidate.bedroomsApprox ? "~" : ""}${candidate.bedrooms} bd`);
  if (typeof candidate.bathrooms === "number" && candidate.bathrooms > 0)
    metaBits.push(`${candidate.bathroomsApprox ? "~" : ""}${candidate.bathrooms} ba`);
  const land = formatArea(candidate.landArea, candidate.landAreaApprox);
  if (land) metaBits.push(land);
  const floor = formatArea(candidate.floorArea, candidate.floorAreaApprox);
  if (floor) metaBits.push(`${floor} floor`);

  const potentialLots = candidate.potentialLots ?? 0;

  return (
    <article className="pcard">
      <div className="pcard-photo">
        {photo ? (
          <img src={photo} alt={candidate.address} loading="lazy" onError={() => setImgFailed(true)} />
        ) : (
          <div className="placeholder">🏠</div>
        )}
        {scored && (
          <div className="pcard-score-badge">
            <ScoreBadge composite={composite} loading={scoresLoading} />
          </div>
        )}
      </div>

      <div className="pcard-body">
        {price && <div className="pcard-price">{price}</div>}
        <div className="pcard-addr">{candidate.address}</div>

        {metaBits.length > 0 && <div className="pcard-meta">{metaBits.map((b) => <span key={b}>{b}</span>)}</div>}

        {/* Title / tenure status (scored screening only) */}
        {scored && (
          <div className="pcard-chips">
            {candidate.subdivisionTenureWarning && (
              <span className="pcard-tag warn">⚠ {tenureLabel(candidate.subdivisionTenureWarning)}</span>
            )}
            {candidate.titleStatus === "verified" && !candidate.subdivisionTenureWarning && (
              <span className="pcard-tag good">✓ {candidate.titleType?.trim() || "Freehold"}</span>
            )}
            {candidate.titleStatus === "unverified" && !candidate.subdivisionTenureWarning && (
              <span className="pcard-tag">Title unverified</span>
            )}
            {candidate.zone && <span className="pcard-tag">{candidate.zone}</span>}
            {potentialLots >= 2 && <span className="pcard-tag good">{potentialLots} lots potential</span>}
            {candidate.propertyType && <span className="pcard-tag">{candidate.propertyType}</span>}
          </div>
        )}

        {!scored && candidate.propertyType && (
          <div className="pcard-chips">
            <span className="pcard-tag">{candidate.propertyType}</span>
          </div>
        )}

        {/* Subdivision scores row */}
        {scored && (
          <div className="score-row">
            <ScorePip score={candidate.scores?.ease ?? 0} label="Ease" loading={scoresLoading} />
            <ScorePip score={candidate.scores?.cost ?? 0} label="Cost" loading={scoresLoading} />
            <ScorePip score={candidate.scores?.roi ?? 0} label="ROI" loading={scoresLoading} />
          </div>
        )}

        <div className="pcard-actions">
          <button className="btn btn-primary" onClick={() => onAnalyse(candidate)} disabled={analysing}>
            {analysing ? "Analysing…" : "Full analysis"}
          </button>
        </div>
      </div>
    </article>
  );
}

function tenureLabel(t: "cross_lease" | "leasehold" | "unit_title"): string {
  switch (t) {
    case "cross_lease":
      return "Cross-lease";
    case "leasehold":
      return "Leasehold";
    case "unit_title":
      return "Unit title";
  }
}
