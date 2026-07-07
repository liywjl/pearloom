import React, { useMemo, useState } from "react";
import type { RecordingMeta, SpaceInfo } from "../../shared/types";
import { formatDate, formatDuration, formatSize } from "../lib/format";
import { ShareDialog } from "../components/ShareDialog";

interface Props {
  recordings: RecordingMeta[];
  spaces: SpaceInfo[];
  onChanged: () => void;
  onOpen: (rec: RecordingMeta) => void;
  onSpacesChanged: () => void;
}

type ShareFilter = "all" | "shared" | "private";
type SortOrder = "newest" | "oldest" | "longest" | "largest";

export function LibraryView({
  recordings,
  spaces,
  onChanged,
  onOpen,
  onSpacesChanged,
}: Props) {
  const [sharing, setSharing] = useState<RecordingMeta | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [shareFilter, setShareFilter] = useState<ShareFilter>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOrder>("newest");
  const [taggingId, setTaggingId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");

  const allTags = useMemo(
    () => [...new Set(recordings.flatMap((r) => r.tags ?? []))].sort(),
    [recordings],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = recordings.filter((r) => {
      if (shareFilter === "shared" && r.sharedTo.length === 0) return false;
      if (shareFilter === "private" && r.sharedTo.length > 0) return false;
      if (tagFilter && !(r.tags ?? []).includes(tagFilter)) return false;
      if (
        q &&
        !r.title.toLowerCase().includes(q) &&
        !(r.tags ?? []).some((t) => t.includes(q))
      )
        return false;
      return true;
    });
    const by: Record<
      SortOrder,
      (a: RecordingMeta, b: RecordingMeta) => number
    > = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      longest: (a, b) => b.durationMs - a.durationMs,
      largest: (a, b) => b.sizeBytes - a.sizeBytes,
    };
    return [...filtered].sort(by[sort]);
  }, [recordings, query, shareFilter, tagFilter, sort]);

  const addTag = async (rec: RecordingMeta, tag: string) => {
    const clean = tag.trim().toLowerCase();
    if (!clean) return;
    await window.loom.recordings.setTags(rec.id, [...(rec.tags ?? []), clean]);
    setTagDraft("");
    onChanged();
  };

  const removeTag = async (rec: RecordingMeta, tag: string) => {
    await window.loom.recordings.setTags(
      rec.id,
      (rec.tags ?? []).filter((t) => t !== tag),
    );
    if (tagFilter === tag) setTagFilter(null);
    onChanged();
  };

  return (
    <div className="library">
      <header className="view-header">
        <h1>Library</h1>
        <p className="muted">
          {recordings.length === 0
            ? "Nothing here yet — record something!"
            : `${recordings.length} recording${recordings.length === 1 ? "" : "s"}, stored locally on this Mac.`}
        </p>
      </header>

      {recordings.length > 0 && (
        <div className="library-toolbar">
          <input
            className="library-search"
            placeholder="Search titles and tags…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            value={shareFilter}
            onChange={(e) => setShareFilter(e.target.value as ShareFilter)}
            title="Filter by sharing status"
          >
            <option value="all">All recordings</option>
            <option value="shared">Shared</option>
            <option value="private">Private</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOrder)}
            title="Sort order"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="longest">Longest</option>
            <option value="largest">Largest</option>
          </select>
          {allTags.length > 0 && (
            <div className="tag-filter-row">
              {allTags.map((t) => (
                <button
                  key={t}
                  className={`tag-chip${tagFilter === t ? " on" : ""}`}
                  onClick={() => setTagFilter(tagFilter === t ? null : t)}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {visible.length === 0 && recordings.length > 0 && (
        <p className="muted">No recordings match — clear the search/filters.</p>
      )}

      <div className="card-grid">
        {visible.map((rec) => (
          <div key={rec.id} className="rec-card">
            <button
              className="rec-thumb"
              onClick={() => onOpen(rec)}
              title="Play"
            >
              {rec.thumbnailDataUrl ? (
                <img src={rec.thumbnailDataUrl} alt="" />
              ) : (
                <div className="thumb-fallback">▶</div>
              )}
              <span className="duration-chip">
                {formatDuration(rec.durationMs)}
              </span>
            </button>
            <div className="rec-card-body">
              {renaming === rec.id ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await window.loom.recordings.setTitle(
                      rec.id,
                      title.trim() || rec.title,
                    );
                    setRenaming(null);
                    onChanged();
                  }}
                >
                  <input
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => setRenaming(null)}
                  />
                </form>
              ) : (
                <button
                  className="rec-title"
                  title="Click to rename"
                  onClick={() => {
                    setRenaming(rec.id);
                    setTitle(rec.title);
                  }}
                >
                  {rec.title}
                </button>
              )}
              <div className="rec-meta muted">
                {formatDate(rec.createdAt)} · {formatSize(rec.sizeBytes)}
                {rec.sharedTo.length > 0 && (
                  <span
                    className="shared-chip"
                    title={`Shared to ${rec.sharedTo.length} space(s)`}
                  >
                    ⇡ shared
                  </span>
                )}
              </div>

              <div className="rec-tags">
                {(rec.tags ?? []).map((t) => (
                  <span key={t} className="tag-chip static">
                    #{t}
                    <button
                      className="tag-remove"
                      title="Remove tag"
                      onClick={() => void removeTag(rec, t)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {taggingId === rec.id ? (
                  <form
                    className="tag-add-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void addTag(rec, tagDraft);
                    }}
                  >
                    <input
                      autoFocus
                      placeholder="tag"
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onBlur={() => {
                        if (tagDraft.trim()) void addTag(rec, tagDraft);
                        setTaggingId(null);
                      }}
                    />
                  </form>
                ) : (
                  <button
                    className="tag-chip add"
                    title="Add a tag"
                    onClick={() => {
                      setTaggingId(rec.id);
                      setTagDraft("");
                    }}
                  >
                    + tag
                  </button>
                )}
              </div>

              <div className="rec-actions">
                <button className="btn small" onClick={() => onOpen(rec)}>
                  ▶ Play
                </button>
                <button
                  className="btn small primary"
                  onClick={() => setSharing(rec)}
                >
                  ⇡ Share
                </button>
                <button
                  className="btn small ghost danger-text"
                  onClick={async () => {
                    if (
                      confirm(
                        `Delete "${rec.title}"? The local file is removed; copies already shared to spaces remain with peers.`,
                      )
                    ) {
                      await window.loom.recordings.remove(rec.id);
                      onChanged();
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {sharing && (
        <ShareDialog
          recording={sharing}
          spaces={spaces}
          onClose={() => setSharing(null)}
          onShared={() => {
            onChanged();
            onSpacesChanged();
          }}
        />
      )}
    </div>
  );
}
