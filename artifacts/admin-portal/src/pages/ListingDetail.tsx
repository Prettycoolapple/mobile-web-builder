import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiGet, apiPost } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

interface ListingDetailResponse {
  listing: {
    id: string;
    status: string;
    approvedAt: string | null;
    listingType: string;
    address: string;
    addressStreet: string | null;
    addressSuburb: string | null;
    addressCity: string | null;
    addressPostcode: string | null;
    lat: string | null;
    lng: string | null;
    propertyType: string;
    bedrooms: number | null;
    bathrooms: number | null;
    toilets: number | null;
    garages: number | null;
    landAreaSqm: number | null;
    floorAreaSqm: number | null;
    titleStatus: string | null;
    priceNzd: number | null;
    priceDisplay: string | null;
    methodOfSale: string | null;
    listingTitle: string | null;
    description: string | null;
    imageUrls: string[];
    documentUrls: { category: string; fileName: string; fileUrl: string; mimeType: string; size: number }[];
    features: string[];
    createdAt: string;
    updatedAt: string;
    removedAt: string | null;
    agentId: string;
    agentEmail: string;
    agentName: string | null;
    agentPhone: string | null;
    agentAvatarUrl: string | null;
    agencyName: string | null;
    licenceNumber: string | null;
  };
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 14 }}>{value != null && value !== "" ? value : "—"}</div>
    </div>
  );
}

export default function ListingDetailPage() {
  const { listingId } = useParams<{ listingId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ListingDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);

  useEffect(() => {
    if (!listingId) return;
    setLoading(true);
    apiGet<ListingDetailResponse>(`/admin/listings/${listingId}`)
      .then((d) => { setData(d); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load listing"))
      .finally(() => setLoading(false));
  }, [listingId]);

  async function toggleApproval() {
    if (!data) return;
    const action = data.listing.approvedAt ? "unapprove" : "approve";
    setApproving(true);
    try {
      const result = await apiPost<{ ok: boolean; approvedAt: string | null }>(
        `/admin/listings/${data.listing.id}/${action}`,
      );
      setData((prev) => prev ? { ...prev, listing: { ...prev.listing, approvedAt: result.approvedAt } } : prev);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setApproving(false);
    }
  }

  if (loading) return <div className="empty">Loading…</div>;
  if (error) return <div className="empty">{error}</div>;
  if (!data) return <div className="empty">Listing not found.</div>;

  const { listing } = data;
  const isApproved = !!listing.approvedAt;

  return (
    <>
      {/* Back navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
        <button
          className="btn ghost"
          style={{ fontSize: 13, padding: "3px 10px" }}
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>
        <Link to={`/agents/${listing.agentId}`} style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>
          Agent: {listing.agentName ?? listing.agentEmail}
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>{listing.listingTitle ?? listing.address}</h1>
          <p className="subtitle" style={{ margin: "4px 0 0" }}>{listing.address}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isApproved ? (
            <span className="badge" style={{ background: "#dcfce7", color: "#166534", fontSize: 13, padding: "4px 12px" }}>
              ✓ Approved
            </span>
          ) : (
            <span className="badge" style={{ background: "#fef3c7", color: "#92400e", fontSize: 13, padding: "4px 12px" }}>
              ⏳ Pending approval
            </span>
          )}
          {!listing.removedAt && (
            <button
              className="btn"
              style={{
                background: isApproved ? "var(--danger, #dc2626)" : "var(--accent, #2563eb)",
                color: "#fff",
                border: "none",
                padding: "6px 18px",
              }}
              disabled={approving}
              onClick={toggleApproval}
            >
              {approving ? "…" : isApproved ? "Unapprove listing" : "Approve listing"}
            </button>
          )}
        </div>
      </div>

      {/* Photo gallery */}
      {listing.imageUrls.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
            <img
              src={listing.imageUrls[selectedImage]}
              alt={`Photo ${selectedImage + 1}`}
              style={{ width: "100%", maxHeight: 420, objectFit: "cover", borderRadius: 8 }}
            />
            {listing.imageUrls.length > 1 && (
              <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                {listing.imageUrls.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`Thumb ${i + 1}`}
                    onClick={() => setSelectedImage(i)}
                    style={{
                      width: 72, height: 54, objectFit: "cover", borderRadius: 4, cursor: "pointer", flexShrink: 0,
                      border: i === selectedImage ? "2px solid var(--accent, #2563eb)" : "2px solid transparent",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Property details */}
        <div className="panel">
          <div className="panel-header"><span style={{ fontWeight: 600 }}>Property details</span></div>
          <div style={{ padding: "12px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Type" value={listing.propertyType} />
            <Field label="Listing type" value={listing.listingType === "for_sale" ? "For Sale" : "For Rent"} />
            <Field label="Bedrooms" value={listing.bedrooms} />
            <Field label="Bathrooms" value={listing.bathrooms} />
            <Field label="Toilets" value={listing.toilets} />
            <Field label="Garages" value={listing.garages} />
            <Field label="Land area" value={listing.landAreaSqm ? `${listing.landAreaSqm.toLocaleString()} m²` : null} />
            <Field label="Floor area" value={listing.floorAreaSqm ? `${listing.floorAreaSqm.toLocaleString()} m²` : null} />
            <Field label="Title" value={listing.titleStatus} />
          </div>
        </div>

        {/* Pricing & agent */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="panel">
            <div className="panel-header"><span style={{ fontWeight: 600 }}>Pricing</span></div>
            <div style={{ padding: "12px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Price" value={listing.priceDisplay ?? (listing.priceNzd ? `$${listing.priceNzd.toLocaleString()}` : null)} />
              <Field label="Method of sale" value={listing.methodOfSale?.replace(/_/g, " ")} />
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><span style={{ fontWeight: 600 }}>Agent</span></div>
            <div style={{ padding: "12px 16px", display: "flex", gap: 12, alignItems: "center" }}>
              {listing.agentAvatarUrl && (
                <img
                  src={listing.agentAvatarUrl}
                  alt=""
                  style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }}
                />
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <Link
                  to={`/agents/${listing.agentId}`}
                  style={{ color: "var(--accent, #2563eb)", textDecoration: "none", fontWeight: 600 }}
                >
                  {listing.agentName ?? listing.agentEmail}
                </Link>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>{listing.agentEmail}</div>
                {listing.agencyName && <div style={{ fontSize: 13 }}>{listing.agencyName}</div>}
                {listing.agentPhone && <div style={{ fontSize: 13 }}>{listing.agentPhone}</div>}
                {listing.licenceNumber && <div style={{ fontSize: 12, color: "var(--muted)" }}>REAA {listing.licenceNumber}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      {listing.description && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header"><span style={{ fontWeight: 600 }}>Description</span></div>
          <div style={{ padding: "12px 16px", fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {listing.description}
          </div>
        </div>
      )}

      {/* Features */}
      {listing.features.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header"><span style={{ fontWeight: 600 }}>Features</span></div>
          <div style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {listing.features.map((f, i) => (
              <span key={i} className="badge" style={{ background: "var(--surface, #f3f4f6)" }}>{f}</span>
            ))}
          </div>
        </div>
      )}

      {/* Documents */}
      {listing.documentUrls.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header"><span style={{ fontWeight: 600 }}>Documents</span></div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            {listing.documentUrls.map((doc, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="badge">{doc.category}</span>
                <a href={doc.fileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "var(--accent, #2563eb)" }}>
                  {doc.fileName}
                </a>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {(doc.size / 1024).toFixed(0)} KB
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="panel">
        <div className="panel-header"><span style={{ fontWeight: 600 }}>Audit</span></div>
        <div style={{ padding: "12px 16px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          <Field label="Created" value={`${relativeTime(listing.createdAt)} (${formatDate(listing.createdAt)})`} />
          <Field label="Last updated" value={`${relativeTime(listing.updatedAt)} (${formatDate(listing.updatedAt)})`} />
          <Field label="Approved at" value={listing.approvedAt ? `${relativeTime(listing.approvedAt)} (${formatDate(listing.approvedAt)})` : "Not approved"} />
        </div>
      </div>
    </>
  );
}
