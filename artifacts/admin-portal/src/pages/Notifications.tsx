import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { getToken } from "@/lib/auth";

type Audience = "specific_user" | "everyone" | "paid_general" | "sales_agent" | "service_provider";
type Language = "en" | "zh";
type PostBlock =
  | { id: string; type: "text"; textEn: string; textZh: string }
  | { id: string; type: "image"; imageId: string; url: string };

interface PostSummary {
  id: string; status: string; sourceLanguage: Language; titleEn: string; bodyEn: string; titleZh: string; bodyZh: string;
  audience: Audience; targetEmail: string | null; translationStale: boolean; contentRevision: number;
  createdAt: string; updatedAt: string; publishedAt: string | null; audienceUsers: number; guestAudience: number;
  devices: number; pushHandoffs: number; pushOpens: number; readers: number; naturalReaders: number;
  averageReadSeconds: number; failedDeliveries: number; unknownDeliveries: number;
}
interface PostImage { id: string; objectPath: string; contentType: string; byteSize: number; sortOrder: number; url: string }
interface PostDetail extends PostSummary { images: PostImage[]; blocks: PostBlock[] }

const AUDIENCE_LABELS: Record<Audience, string> = {
  specific_user: "Specific user", everyone: "Everyone (accounts + guests)", paid_general: "Paid general users",
  sales_agent: "Sales agents", service_provider: "Service providers",
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function detectNewsLanguage(value: string): Language | null {
  const chineseCharacters = value.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)?.length ?? 0;
  const latinCharacters = value.match(/[A-Za-z]/g)?.length ?? 0;
  if (chineseCharacters >= 4 && chineseCharacters >= latinCharacters * 0.25) return "zh";
  if (latinCharacters >= 4 && latinCharacters > chineseCharacters * 2) return "en";
  return null;
}

function MarkdownPreview({ value }: { value: string }) {
  return <div className="news-markdown-preview">{value.split(/\n{2,}/).map((block, index) => {
    if (block.startsWith("### ")) return <h3 key={index}>{block.slice(4)}</h3>;
    if (block.startsWith("## ")) return <h2 key={index}>{block.slice(3)}</h2>;
    if (block.startsWith("# ")) return <h1 key={index}>{block.slice(2)}</h1>;
    if (/^[-*] /m.test(block)) return <ul key={index}>{block.split("\n").map((line, i) => <li key={i}>{line.replace(/^[-*] /, "")}</li>)}</ul>;
    return <p key={index}>{block}</p>;
  })}</div>;
}

export default function NotificationsPage() {
  const { postId } = useParams();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [bulkEnabled, setBulkEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadList = useCallback(async () => {
    try {
      const data = await apiGet<{ posts: PostSummary[]; bulkSendEnabled: boolean }>("/admin/news-posts");
      setPosts(data.posts); setBulkEnabled(data.bulkSendEnabled); setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load posts"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadList(); }, [loadList]);
  async function deleteTestPost(post: PostSummary) {
    const sentWarning = post.publishedAt
      ? " The push notification already delivered to the test user cannot be recalled, but opening it afterward will show that the post is unavailable."
      : "";
    if (!window.confirm(`Permanently delete \"${post.titleEn || post.titleZh || "Untitled draft"}\"?${sentWarning}`)) return;
    try {
      await apiDelete(`/admin/news-posts/${post.id}`);
      await loadList();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to delete test post"); }
  }
  useEffect(() => {
    if (postId !== "new") return;
    let cancelled = false;
    apiPost<PostSummary>("/admin/news-posts", { sourceLanguage: "en" })
      .then((post) => { if (!cancelled) navigate(`/notifications/${post.id}`, { replace: true }); })
      .catch((err) => { if (!cancelled) { setError(err instanceof Error ? err.message : "Failed to create draft"); navigate("/notifications", { replace: true }); } });
    return () => { cancelled = true; };
  }, [postId, navigate]);
  if (postId && postId !== "new") return <NotificationComposer postId={postId} bulkEnabled={bulkEnabled} onChanged={loadList} />;

  return <div className="news-admin-page">
    <div className="page-header-row"><div><h1>Create notifications</h1><p className="subtitle">Create bilingual news posts and review private engagement analytics.</p></div><Link className="btn-primary news-create-button" to="/notifications/new">Create new post</Link></div>
    {error && <div className="error-banner">{error}</div>}
    {!bulkEnabled && <div className="news-info-banner">Bulk audiences are protected until the mobile news reader is released. Specific-user test sends are available.</div>}
    {loading ? <p>Loading posts…</p> : posts.length === 0 ? <div className="empty-state">No posts yet. Create a draft to begin.</div> :
      <div className="news-table-wrap"><table className="news-table"><thead><tr><th>Post</th><th>Audience</th><th>Status</th><th>Sent</th><th>Accounts + guests / devices</th><th>Push handoffs</th><th>Push opens</th><th>Readers</th><th>Avg. read</th><th>Actions</th></tr></thead>
        <tbody>{posts.map((post) => <tr key={post.id}>
          <td><Link to={`/notifications/${post.id}`} className="news-title-link">{post.titleEn || post.titleZh || "Untitled draft"}</Link><small>{formatDate(post.createdAt)}</small></td>
          <td>{AUDIENCE_LABELS[post.audience]}</td><td><span className={`news-status ${post.status}`}>{post.status.replace("_", " ")}</span></td>
          <td>{formatDate(post.publishedAt)}</td><td>{(post.audienceUsers + post.guestAudience).toLocaleString()} / {post.devices.toLocaleString()}</td>
          <td>{post.pushHandoffs.toLocaleString()}</td><td>{post.pushOpens.toLocaleString()}</td><td>{post.readers.toLocaleString()}</td><td>{Math.round(post.averageReadSeconds)}s</td>
          <td>{(post.status === "draft" || post.audience === "specific_user") && <button className="btn-danger-quiet" onClick={() => void deleteTestPost(post)}>Delete</button>}</td>
        </tr>)}</tbody></table></div>}
  </div>;
}

function NotificationComposer({ postId, bulkEnabled, onChanged }: { postId: string; bulkEnabled: boolean; onChanged: () => Promise<void> }) {
  const navigate = useNavigate();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewLanguage, setPreviewLanguage] = useState<Language>("en");
  const loadedRef = useRef(false);
  const dirtyRef = useRef(false);
  const editVersionRef = useRef(0);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const textareas = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const load = useCallback(async () => {
    try { const data = await apiGet<PostDetail>(`/admin/news-posts/${postId}`); setPost(data); setError(""); loadedRef.current = true; dirtyRef.current = false; editVersionRef.current = 0; }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to load post"); }
  }, [postId]);
  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (silent = false): Promise<PostDetail | null> => {
    if (!post || deletingRef.current || post.status !== "draft" || !dirtyRef.current) return post;
    if (savingRef.current) return null;
    const snapshot = post;
    const saveVersion = editVersionRef.current;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await apiPatch<PostSummary>(`/admin/news-posts/${snapshot.id}`, {
        sourceLanguage: snapshot.sourceLanguage, titleEn: snapshot.titleEn, titleZh: snapshot.titleZh,
        audience: snapshot.audience, targetEmail: snapshot.targetEmail, translationStale: snapshot.translationStale,
        contentRevision: snapshot.contentRevision,
        blocks: snapshot.blocks.map((block) => block.type === "text"
          ? { type: "text", textEn: block.textEn, textZh: block.textZh }
          : { type: "image", imageId: block.imageId }),
      });
      const changedWhileSaving = editVersionRef.current !== saveVersion;
      if (changedWhileSaving) {
        dirtyRef.current = true;
        setPost((current) => current ? { ...current, contentRevision: saved.contentRevision, updatedAt: saved.updatedAt } : current);
      } else {
        dirtyRef.current = false;
        setPost({ ...snapshot, ...saved });
        if (!silent) setNotice("Draft saved");
      }
      setError(""); await onChanged();
      return changedWhileSaving ? null : { ...snapshot, ...saved };
    } catch (err) { setError(err instanceof Error ? err.message : "Save failed"); return null; }
    finally { savingRef.current = false; setSaving(false); }
  }, [post, onChanged]);

  useEffect(() => {
    if (!loadedRef.current || !dirtyRef.current || post?.status !== "draft") return;
    const timer = window.setTimeout(() => { void save(true); }, 1400);
    return () => window.clearTimeout(timer);
  }, [post, save]);

  function update(patch: Partial<PostDetail>, sourceChanged = false) {
    editVersionRef.current += 1; dirtyRef.current = true; setNotice("");
    setPost((current) => current ? { ...current, ...patch, translationStale: sourceChanged ? true : (patch.translationStale ?? current.translationStale) } : current);
  }
  function updateBlock(id: string, patch: Partial<Extract<PostBlock, { type: "text" }>>, sourceChanged = false) {
    if (!post) return;
    update({ blocks: post.blocks.map((block) => block.id === id && block.type === "text" ? { ...block, ...patch } : block) }, sourceChanged);
  }
  function moveBlock(index: number, delta: number) {
    if (!post) return;
    const to = index + delta; if (to < 0 || to >= post.blocks.length) return;
    const blocks = [...post.blocks]; [blocks[index], blocks[to]] = [blocks[to]!, blocks[index]!]; update({ blocks });
  }
  function addTextBlock() {
    if (!post) return;
    update({ blocks: [...post.blocks, { id: `new-${crypto.randomUUID()}`, type: "text", textEn: "", textZh: "" }] }, true);
  }
  function changeSourceLanguage(nextLanguage: Language) {
    if (!post || nextLanguage === post.sourceLanguage) return;
    const previousLanguage = post.sourceLanguage;
    const previousTitle = previousLanguage === "en" ? post.titleEn : post.titleZh;
    const nextTitle = nextLanguage === "en" ? post.titleEn : post.titleZh;
    const blocks = post.blocks.map((block) => {
      if (block.type !== "text") return block;
      const previousText = previousLanguage === "en" ? block.textEn : block.textZh;
      const nextText = nextLanguage === "en" ? block.textEn : block.textZh;
      if (!previousText.trim() || nextText.trim()) return block;
      return { ...block, ...(nextLanguage === "en" ? { textEn: previousText } : { textZh: previousText }) };
    });
    update({
      sourceLanguage: nextLanguage,
      blocks,
      ...(!nextTitle.trim() && previousTitle.trim()
        ? (nextLanguage === "en" ? { titleEn: previousTitle } : { titleZh: previousTitle })
        : {}),
    }, true);
  }
  async function removeBlock(block: PostBlock) {
    if (!post) return;
    if (block.type === "image") { await apiDelete(`/admin/news-posts/${postId}/images/${block.imageId}`); await load(); return; }
    if (post.blocks.filter((item) => item.type === "text").length <= 1) { setError("A post needs at least one text block."); return; }
    update({ blocks: post.blocks.filter((item) => item.id !== block.id) }, true);
  }

  async function translate() {
    if (!post) return;
    const selectedLanguage = post.sourceLanguage;
    const title = selectedLanguage === "en" ? post.titleEn : post.titleZh;
    const textBlocks = post.blocks.filter((block): block is Extract<PostBlock, { type: "text" }> => block.type === "text");
    const texts = textBlocks.map((block) => selectedLanguage === "en" ? block.textEn : block.textZh);
    if (!title.trim() || texts.length === 0 || texts.some((text) => !text.trim())) { setError("Complete the source title and every source text block first."); return; }
    const detectedLanguage = detectNewsLanguage([title, ...texts].join("\n"));
    const sourceLanguage = detectedLanguage ?? selectedLanguage;
    setTranslating(true);
    try {
      const result = await apiPost<{ title: string; texts: string[] }>(`/admin/news-posts/${post.id}/translate`, { sourceLanguage, title, texts });
      const translatedById = new Map(textBlocks.map((block, index) => [block.id, result.texts[index] ?? ""]));
      const blocks = post.blocks.map((block) => block.type === "text"
        ? { ...block, ...(sourceLanguage === "en"
          ? { textEn: texts[textBlocks.findIndex((item) => item.id === block.id)] ?? block.textEn, textZh: translatedById.get(block.id) ?? "" }
          : { textZh: texts[textBlocks.findIndex((item) => item.id === block.id)] ?? block.textZh, textEn: translatedById.get(block.id) ?? "" }) }
        : block);
      update({
        sourceLanguage,
        blocks,
        ...(sourceLanguage === "en" ? { titleEn: title, titleZh: result.title } : { titleZh: title, titleEn: result.title }),
        translationStale: false,
      });
      setPreviewLanguage(sourceLanguage === "en" ? "zh" : "en");
      setNotice(detectedLanguage && detectedLanguage !== selectedLanguage
        ? `${detectedLanguage === "zh" ? "Chinese" : "English"} was detected and the original-language setting was corrected. Review the translation before sending.`
        : "Translation generated. Review every block before sending.");
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Translation failed"); }
    finally { setTranslating(false); }
  }

  async function uploadImages(files: FileList | null) {
    if (!post || !files) return;
    const saved = await save(true); if (!saved) return;
    for (const file of Array.from(files).slice(0, 10 - post.images.length)) {
      try {
        const ticket = await apiPost<{ uploadUrl: string; objectPath: string }>(`/admin/news-posts/${post.id}/images/upload-url`, { contentType: file.type, byteSize: file.size });
        const response = await fetch(ticket.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!response.ok) throw new Error("Storage upload failed");
        await apiPost(`/admin/news-posts/${post.id}/images`, { objectPath: ticket.objectPath, contentType: file.type, byteSize: file.size });
      } catch (err) { setError(err instanceof Error ? err.message : `Failed to upload ${file.name}`); break; }
    }
    await load();
  }

  async function send() {
    const saved = await save(true); if (!saved) return;
    try {
      const counts = await apiPost<{ users: number; guestInstallations: number; devices: number; noDevices: number }>(`/admin/news-posts/${postId}/preflight`);
      const recipients = counts.users + counts.guestInstallations;
      if (recipients === 0) { setError("This audience contains no recipients."); return; }
      const guestText = saved.audience === "everyone" ? ` This includes ${counts.guestInstallations} guest installation(s).` : "";
      if (!window.confirm(`Send this post to ${recipients} account/guest recipient(s) across ${counts.devices} registered device(s)?${guestText} ${counts.noDevices} recipient(s) have no push-enabled device. This cannot be edited after sending.`)) return;
      setSending(true);
      await apiPost(`/admin/news-posts/${postId}/send`, { contentRevision: saved.contentRevision, idempotencyKey: crypto.randomUUID() });
      setNotice("Post queued for delivery."); await load(); await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Send failed"); }
    finally { setSending(false); }
  }

  async function deletePost() {
    if (!post) return;
    const sentWarning = post.publishedAt
      ? " The delivered push cannot be recalled, but the article will no longer open."
      : "";
    if (!window.confirm(`Permanently delete this ${post.status === "draft" ? "draft" : "specific-user test post"}?${sentWarning}`)) return;
    deletingRef.current = true; dirtyRef.current = false; loadedRef.current = false; setDeleting(true);
    try {
      await apiDelete(`/admin/news-posts/${post.id}`);
      await onChanged();
      navigate("/notifications", { replace: true });
    } catch (err) {
      deletingRef.current = false; loadedRef.current = true;
      setError(err instanceof Error ? err.message : "Failed to delete test post");
      setDeleting(false);
    }
  }

  function insertMarkdown(block: Extract<PostBlock, { type: "text" }>, before: string, after = before) {
    if (!post) return;
    const textarea = textareas.current[block.id];
    const key = post.sourceLanguage === "en" ? "textEn" : "textZh";
    const value = block[key]; const start = textarea?.selectionStart ?? value.length; const end = textarea?.selectionEnd ?? value.length;
    updateBlock(block.id, { [key]: `${value.slice(0, start)}${before}${value.slice(start, end)}${after}${value.slice(end)}` }, true);
  }

  if (!post) return <div className="news-admin-page"><Link to="/notifications">← All posts</Link><p>{error || "Loading post…"}</p></div>;
  const isDraft = post.status === "draft";
  const sourceTitleKey = post.sourceLanguage === "en" ? "titleEn" : "titleZh";
  const translatedTitleKey = post.sourceLanguage === "en" ? "titleZh" : "titleEn";
  const previewTitle = previewLanguage === "en" ? post.titleEn : post.titleZh;
  const sourceTextBlocks = post.blocks.filter((block): block is Extract<PostBlock, { type: "text" }> => block.type === "text");
  const detectedSourceLanguage = detectNewsLanguage([
    post.sourceLanguage === "en" ? post.titleEn : post.titleZh,
    ...sourceTextBlocks.map((block) => post.sourceLanguage === "en" ? block.textEn : block.textZh),
  ].join("\n"));
  const effectiveSourceLanguage = detectedSourceLanguage ?? post.sourceLanguage;

  return <div className="news-admin-page">
    <div className="news-composer-header"><div><Link to="/notifications" className="back-link">← All posts</Link><h1>{isDraft ? "Create notification" : previewTitle || "Post"}</h1></div><div className="news-header-actions">{(isDraft || post.audience === "specific_user") && <button className="btn-danger-quiet" onClick={() => void deletePost()} disabled={deleting}>{deleting ? "Deleting…" : "Delete test post"}</button>}{isDraft && <><button className="btn-secondary" onClick={() => void save()} disabled={saving || deleting}>{saving ? "Saving…" : "Save draft"}</button><button className="btn-primary" onClick={() => void send()} disabled={saving || sending || deleting || post.translationStale}>{sending ? "Sending…" : "Send"}</button></>}</div></div>
    {error && <div className="error-banner">{error}</div>}{notice && <div className="success-banner">{notice}</div>}
    {!isDraft && <AnalyticsStrip post={post} />}
    <div className="news-composer-grid"><section className="news-editor-panel">
      <div className="form-row"><label>Original language<select value={post.sourceLanguage} disabled={!isDraft} onChange={(event) => changeSourceLanguage(event.target.value as Language)}><option value="en">English</option><option value="zh">Simplified Chinese</option></select>{detectedSourceLanguage && detectedSourceLanguage !== post.sourceLanguage && <small className="news-language-detected">{detectedSourceLanguage === "zh" ? "Chinese" : "English"} detected — translation will correct this automatically.</small>}</label><label>Audience<select value={post.audience} disabled={!isDraft} onChange={(event) => update({ audience: event.target.value as Audience, targetEmail: event.target.value === "specific_user" ? post.targetEmail : null })}>{(Object.keys(AUDIENCE_LABELS) as Audience[]).map((audience) => <option key={audience} value={audience} disabled={audience !== "specific_user" && !bulkEnabled}>{AUDIENCE_LABELS[audience]}{audience !== "specific_user" && !bulkEnabled ? " — locked" : ""}</option>)}</select></label></div>
      {post.audience === "specific_user" && <label>Test user email<input type="email" value={post.targetEmail ?? ""} disabled={!isDraft} placeholder="user@example.com" onChange={(event) => update({ targetEmail: event.target.value })} /></label>}
      <label>Source title <span>{post[sourceTitleKey].length}/120</span><input maxLength={120} disabled={!isDraft} value={post[sourceTitleKey]} onChange={(event) => update({ [sourceTitleKey]: event.target.value } as Partial<PostDetail>, true)} /></label>
      <label>Translated title<input maxLength={120} disabled={!isDraft} value={post[translatedTitleKey]} onChange={(event) => update({ [translatedTitleKey]: event.target.value, translationStale: false } as Partial<PostDetail>)} /></label>
      <div className="section-title-row"><h3>Article blocks</h3>{isDraft && <div className="news-block-add-actions"><button className="btn-secondary" onClick={addTextBlock}>Add text</button><label className="image-upload-button">Add images<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={(event) => void uploadImages(event.target.files)} /></label></div>}</div>
      <div className="news-block-list">{post.blocks.map((block, index) => <div className="news-block-card" key={block.id}>
        <div className="news-block-card-header"><strong>{block.type === "text" ? `Text ${index + 1}` : `Image ${index + 1}`}</strong>{isDraft && <span className="image-actions"><button disabled={index === 0} onClick={() => moveBlock(index, -1)}>↑</button><button disabled={index === post.blocks.length - 1} onClick={() => moveBlock(index, 1)}>↓</button><button onClick={() => void removeBlock(block)}>Remove</button></span>}</div>
        {block.type === "image" ? <AuthenticatedImage image={{ ...(post.images.find((image) => image.id === block.imageId) ?? { id: block.imageId, objectPath: "", contentType: "", byteSize: 0, sortOrder: index }), url: block.url }} /> : <>
          {isDraft && <div className="markdown-toolbar"><button onClick={() => insertMarkdown(block, "**")}>Bold</button><button onClick={() => insertMarkdown(block, "_", "_")}>Italic</button><button onClick={() => insertMarkdown(block, "## ", "")}>Heading</button><button onClick={() => insertMarkdown(block, "- ", "")}>List</button><button onClick={() => insertMarkdown(block, "[", "](https://)")}>Link</button><button onClick={() => insertMarkdown(block, "✨", "")}>✨</button></div>}
          <label>Source text<textarea ref={(node) => { textareas.current[block.id] = node; }} className="news-body-input" maxLength={20000} disabled={!isDraft} value={post.sourceLanguage === "en" ? block.textEn : block.textZh} onChange={(event) => updateBlock(block.id, post.sourceLanguage === "en" ? { textEn: event.target.value } : { textZh: event.target.value }, true)} /></label>
          <label>Translated text<textarea className="news-body-input translated" maxLength={20000} disabled={!isDraft} value={post.sourceLanguage === "en" ? block.textZh : block.textEn} onChange={(event) => { updateBlock(block.id, post.sourceLanguage === "en" ? { textZh: event.target.value } : { textEn: event.target.value }); update({ translationStale: false }); }} /></label>
        </>}
      </div>)}</div>
      {isDraft && <button className="btn-secondary translate-button" onClick={() => void translate()} disabled={translating}>{translating ? "Translating…" : `Generate ${effectiveSourceLanguage === "en" ? "Chinese" : "English"} translation`}</button>}
      {post.translationStale && <p className="translation-warning">Translation needs regeneration or review before sending.</p>}
    </section><aside className="news-preview-panel"><div className="preview-tabs"><button className={previewLanguage === "en" ? "active" : ""} onClick={() => setPreviewLanguage("en")}>English</button><button className={previewLanguage === "zh" ? "active" : ""} onClick={() => setPreviewLanguage("zh")}>中文</button></div><div className="push-preview"><small>PUSH NOTIFICATION</small><strong>Project Alpha</strong><p>{previewTitle || "Your post title will appear here"}</p><em>Only the title is sent. Readers open the app for the article.</em></div><article className="article-preview"><h1>{previewTitle || "Untitled post"}</h1>{post.blocks.map((block) => block.type === "text" ? <MarkdownPreview key={block.id} value={(previewLanguage === "en" ? block.textEn : block.textZh) || "Your text preview will appear here."} /> : <AuthenticatedImage key={block.id} image={{ ...(post.images.find((image) => image.id === block.imageId) ?? { id: block.imageId, objectPath: "", contentType: "", byteSize: 0, sortOrder: 0 }), url: block.url }} />)}</article></aside></div>
  </div>;
}

function AuthenticatedImage({ image }: { image: PostImage }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null; let cancelled = false;
    const token = getToken();
    fetch(image.url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((response) => { if (!response.ok) throw new Error(); return response.blob(); })
      .then((blob) => { if (!cancelled) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => undefined);
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image.url]);
  return url ? <img src={url} alt="Post attachment" className="news-image-thumb" /> : <div className="news-image-thumb placeholder" />;
}

function AnalyticsStrip({ post }: { post: PostDetail }) {
  const metrics = [["Accounts", post.audienceUsers], ["Guests", post.guestAudience], ["Devices", post.devices], ["Push handoffs", post.pushHandoffs], ["Push opens", post.pushOpens], ["Readers", post.readers], ["Natural readers", post.naturalReaders], ["Avg. read", `${Math.round(post.averageReadSeconds)}s`]];
  return <div className="news-analytics-strip">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{typeof value === "number" ? value.toLocaleString() : value}</strong></div>)}</div>;
}
