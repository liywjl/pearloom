import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActivityEvent,
  CommentRecord,
  MemberInfo,
  ReactionRecord,
  RecordingMeta,
  SharedRecording,
  SpaceInfo,
} from "../../shared/types";
import { formatDate, formatDuration } from "../lib/format";
import { ShareDialog } from "../components/ShareDialog";

export type PlayerTarget =
  | { kind: "local"; recording: RecordingMeta }
  | { kind: "shared"; recording: SharedRecording };

interface Props {
  target: PlayerTarget;
  onBack: () => void;
}

const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "😮"];

export interface SectionRange {
  startMs: number;
  endMs: number;
}

/**
 * Plays a recording and hosts the full feedback experience. Feedback lives in
 * a space; for local recordings we resolve the space(s) the recording was
 * published to, so your own library entries show the same comments, reactions
 * and timeline that reviewers see — and unshared recordings offer to share.
 */
export function PlayerView({ target, onBack }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [reactions, setReactions] = useState<ReactionRecord[]>([]);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  const [localMeta, setLocalMeta] = useState<RecordingMeta | null>(
    target.kind === "local" ? target.recording : null,
  );
  const [feedbackSpaceId, setFeedbackSpaceId] = useState<string | null>(
    target.kind === "shared" ? target.recording.spaceId : null,
  );
  const [shareOpen, setShareOpen] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [pendingSection, setPendingSection] = useState<SectionRange | null>(
    null,
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const rec = target.recording;
  const shared = target.kind === "shared" ? target.recording : null;
  const activity: ActivityEvent[] = rec.activity ?? [];

  // Spaces this recording can collect feedback in (known spaces only).
  const feedbackSpaces =
    target.kind === "shared"
      ? spaces.filter((s) => s.id === target.recording.spaceId)
      : spaces.filter((s) => (localMeta?.sharedTo ?? []).includes(s.id));

  const refreshSpaces = useCallback(async () => {
    setSpaces(await window.loom.spaces.list());
  }, []);

  const refreshLocalMeta = useCallback(async () => {
    if (target.kind !== "local") return;
    const all = await window.loom.recordings.list();
    const mine = all.find((m) => m.id === rec.id);
    if (mine) setLocalMeta(mine);
  }, [target.kind, rec.id]);

  useEffect(() => {
    void refreshSpaces();
    const off = window.loom.events.on("spaces-changed", () => {
      void refreshSpaces();
    });
    return off;
  }, [refreshSpaces]);

  // Default the feedback space once shares are known (local recordings).
  useEffect(() => {
    if (feedbackSpaceId && feedbackSpaces.some((s) => s.id === feedbackSpaceId))
      return;
    setFeedbackSpaceId(feedbackSpaces[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbackSpaces.map((s) => s.id).join(",")]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (target.kind === "local") {
          setSrc(window.loom.recordings.playbackUrl(rec.id));
        } else {
          const url = await window.loom.spaces.playbackUrl(
            target.recording.spaceId,
            target.recording.driveKey,
            target.recording.drivePath,
          );
          if (!cancelled) setSrc(url);
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [target, rec.id]);

  const refreshFeedback = useCallback(async () => {
    if (!feedbackSpaceId) {
      setComments([]);
      setReactions([]);
      setMembers([]);
      return;
    }
    try {
      const [cs, rs, ms] = await Promise.all([
        window.loom.spaces.comments(feedbackSpaceId, rec.id),
        window.loom.spaces.reactions(feedbackSpaceId, rec.id),
        window.loom.spaces.members(feedbackSpaceId),
      ]);
      setComments(cs);
      setReactions(rs);
      setMembers(ms);
    } catch {
      /* space might still be syncing */
    }
  }, [feedbackSpaceId, rec.id]);

  useEffect(() => {
    void refreshFeedback();
    const off = window.loom.events.on("space-updated", (id) => {
      if (id === feedbackSpaceId) void refreshFeedback();
    });
    return off;
  }, [refreshFeedback, feedbackSpaceId]);

  // MediaRecorder webm files report Infinity duration; nudge Chromium into
  // computing the real one so the scrubber works.
  const fixDuration = useCallback(() => {
    const v = videoRef.current;
    if (!v || Number.isFinite(v.duration)) return;
    const onSeeked = () => {
      v.currentTime = 0;
      v.removeEventListener("seeked", onSeeked);
    };
    v.addEventListener("seeked", onSeeked);
    v.currentTime = Number.MAX_SAFE_INTEGER / 1e6;
  }, []);

  const currentTimeMs = () =>
    Math.round((videoRef.current?.currentTime ?? 0) * 1000);

  const seekTo = (ms: number, andPlay = true) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    if (andPlay) void v.play();
  };

  const react = async (emoji: string) => {
    if (!feedbackSpaceId) return;
    try {
      await window.loom.spaces.react(feedbackSpaceId, {
        recordingId: rec.id,
        emoji,
        atMs: currentTimeMs(),
      });
      await refreshFeedback();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const showInvite = async () => {
    if (!feedbackSpaceId) return;
    try {
      setInvite(await window.loom.spaces.invite(feedbackSpaceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Duration for timeline math: meta value, corrected by the element once known.
  const durationMs =
    Number.isFinite(videoRef.current?.duration ?? NaN) &&
    (videoRef.current!.duration ?? 0) > 0
      ? Math.round(videoRef.current!.duration * 1000)
      : rec.durationMs;

  const hasFeedback = feedbackSpaceId !== null;

  return (
    <div className="player-view">
      <header className="view-header player-header">
        <button className="btn ghost" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h1>{rec.title}</h1>
          <p className="muted">
            {shared && `by ${shared.ownerName} · `}
            {formatDate(rec.createdAt)} · {formatDuration(rec.durationMs)}
            {shared && !shared.mine && " · streaming peer-to-peer"}
          </p>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="player-layout with-comments">
        <div className="player-stage">
          {src && (
            <video
              ref={videoRef}
              src={src}
              controls
              autoPlay
              onLoadedMetadata={fixDuration}
              onTimeUpdate={() => setCurrentMs(currentTimeMs())}
              onError={() =>
                setError(
                  shared && !shared.mine
                    ? "Could not stream this recording yet. The owner (or another peer with a copy) must be online."
                    : "Could not play this recording.",
                )
              }
            />
          )}

          <Timeline
            durationMs={durationMs}
            currentMs={currentMs}
            activity={activity}
            comments={comments}
            reactions={reactions}
            pendingSection={pendingSection}
            canSelect={hasFeedback}
            onSeek={seekTo}
            onSelectSection={(range) => setPendingSection(range)}
          />
          {hasFeedback && (
            <div className="reaction-bar">
              <span className="muted">
                React at {formatDuration(currentMs)}:
              </span>
              {REACTION_EMOJIS.map((e) => (
                <button
                  key={e}
                  className="reaction-btn"
                  onClick={() => void react(e)}
                  title={`${e} at ${formatDuration(currentMs)}`}
                >
                  {e}
                </button>
              ))}
              <span className="muted timeline-tip">
                Tip: drag on the timeline to comment on a section.
              </span>
            </div>
          )}
        </div>

        <aside className="comments-panel">
          <div className="feedback-header">
            <h2>Feedback</h2>
            {feedbackSpaces.length > 1 && feedbackSpaceId && (
              <select
                className="feedback-space-select"
                value={feedbackSpaceId}
                onChange={(e) => setFeedbackSpaceId(e.target.value)}
                title="This recording is shared to several spaces — pick which one's feedback to view"
              >
                {feedbackSpaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            {feedbackSpaces.length === 1 && (
              <span className="muted feedback-space-name">
                in “{feedbackSpaces[0]!.name}”
              </span>
            )}
          </div>

          {hasFeedback ? (
            <>
              <div className="members-row">
                <span className="member-avatars">
                  {members.slice(0, 8).map((m) => (
                    <span key={m.key} className="avatar small" title={m.name}>
                      {m.name.slice(0, 1).toUpperCase()}
                    </span>
                  ))}
                </span>
                <span className="muted">
                  {members.length || 1} member{members.length === 1 ? "" : "s"}
                </span>
                <button
                  className="btn small ghost"
                  onClick={() => void showInvite()}
                  title="Create an invite code so more people can watch & comment"
                >
                  ⇥ Invite reviewers
                </button>
              </div>
              {invite && (
                <div className="invite-code-box compact">
                  <code>{invite}</code>
                  <button
                    className="btn small primary"
                    onClick={() => navigator.clipboard.writeText(invite)}
                  >
                    Copy
                  </button>
                  <button
                    className="btn small ghost"
                    onClick={() => setInvite(null)}
                  >
                    ✕
                  </button>
                </div>
              )}

              <CommentsPanel
                spaceId={feedbackSpaceId!}
                recordingId={rec.id}
                comments={comments}
                pendingSection={pendingSection}
                onClearSection={() => setPendingSection(null)}
                onChanged={refreshFeedback}
                currentTimeMs={currentTimeMs}
                onSeek={seekTo}
              />
            </>
          ) : (
            <div className="feedback-empty">
              <p className="muted">
                This recording is private — nobody can watch or comment yet.
              </p>
              <p className="muted">
                Share it into a space to collect timestamped comments, reactions
                and likes from your team, fully peer-to-peer.
              </p>
              {target.kind === "local" && (
                <button
                  className="btn primary"
                  onClick={() => setShareOpen(true)}
                >
                  ⇡ Share to collect feedback
                </button>
              )}
            </div>
          )}
        </aside>
      </div>

      {shareOpen && localMeta && (
        <ShareDialog
          recording={localMeta}
          spaces={spaces}
          onClose={() => setShareOpen(false)}
          onShared={() => {
            void refreshSpaces();
            void refreshLocalMeta();
          }}
        />
      )}
    </div>
  );
}

/**
 * Interactive timeline bar under the video:
 *  - playhead + click-to-seek
 *  - drag to select a section to comment on (when feedback is available)
 *  - activity captured at record time (clicks = red ticks, typing = amber bars)
 *  - comment dots / section bars / emoji reactions, all clickable
 */
function Timeline(props: {
  durationMs: number;
  currentMs: number;
  activity: ActivityEvent[];
  comments: CommentRecord[];
  reactions: ReactionRecord[];
  pendingSection: SectionRange | null;
  canSelect: boolean;
  onSeek: (ms: number, andPlay?: boolean) => void;
  onSelectSection: (range: SectionRange) => void;
}) {
  const dur = Math.max(props.durationMs, 1);
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ startFx: number; curFx: number } | null>(
    null,
  );

  const pct = (ms: number) => `${Math.min(99.4, (ms / dur) * 100)}%`;
  const anchored = props.comments.filter((c) => c.atMs !== null);
  const clicks = props.activity.filter((a) => a.kind === "click");
  const typing = props.activity.filter((a) => a.kind === "typing");

  const fxFromEvent = (e: { clientX: number }) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startFx = fxFromEvent(e);
    setDrag({ startFx, curFx: startFx });

    const onMove = (ev: MouseEvent) => {
      setDrag({ startFx, curFx: fxFromEvent(ev) });
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const endFx = fxFromEvent(ev);
      setDrag(null);
      const startMs = Math.round(Math.min(startFx, endFx) * dur);
      const endMs = Math.round(Math.max(startFx, endFx) * dur);
      if (props.canSelect && endMs - startMs > Math.max(250, dur * 0.01)) {
        props.onSelectSection({ startMs, endMs });
        props.onSeek(startMs, false);
      } else {
        props.onSeek(Math.round(endFx * dur));
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const selection = drag
    ? {
        startMs: Math.round(Math.min(drag.startFx, drag.curFx) * dur),
        endMs: Math.round(Math.max(drag.startFx, drag.curFx) * dur),
      }
    : props.pendingSection;

  return (
    <div className="timeline">
      <div
        ref={trackRef}
        className="timeline-hit"
        onMouseDown={onMouseDown}
        title={
          props.canSelect
            ? "Click to jump · drag to select a section to comment on"
            : "Click to jump"
        }
      >
        <div className="timeline-track" />

        {/* activity captured while recording */}
        {typing.map((a, i) => (
          <div
            key={`t${i}`}
            className="timeline-typing"
            style={{
              left: pct(a.atMs),
              width: `calc(${(((a.endMs ?? a.atMs) - a.atMs) / dur) * 100}% + 2px)`,
            }}
            title={`typing ${formatDuration(a.atMs)}–${formatDuration(a.endMs ?? a.atMs)}`}
          />
        ))}
        {clicks.map((a, i) => (
          <div
            key={`c${i}`}
            className="timeline-click"
            style={{ left: pct(a.atMs) }}
            title={`click at ${formatDuration(a.atMs)}`}
          />
        ))}

        {/* selection (in-progress drag or pending) */}
        {selection && (
          <div
            className="timeline-selection"
            style={{
              left: pct(selection.startMs),
              width: `calc(${((selection.endMs - selection.startMs) / dur) * 100}% + 2px)`,
            }}
          />
        )}

        {/* playhead */}
        <div
          className="timeline-playhead"
          style={{ left: pct(props.currentMs) }}
        />
      </div>

      {/* markers overlay (above the hit area so they stay clickable) */}
      {anchored.map((c) => (
        <React.Fragment key={c.id}>
          {c.endMs !== null && c.endMs > (c.atMs ?? 0) && (
            <button
              className="timeline-section"
              style={{
                left: pct(c.atMs!),
                width: `calc(${((c.endMs - c.atMs!) / dur) * 100}% + 2px)`,
              }}
              onClick={() => props.onSeek(c.atMs!)}
              title={`${c.author}: ${c.text}`}
            />
          )}
          <button
            className="timeline-marker comment-marker"
            style={{ left: pct(c.atMs!) }}
            onClick={() => props.onSeek(c.atMs!)}
            title={`${c.author} at ${formatDuration(c.atMs!)}: ${c.text}`}
          />
        </React.Fragment>
      ))}
      {props.reactions.map((r) => (
        <button
          key={r.id}
          className="timeline-marker reaction-marker"
          style={{ left: pct(r.atMs) }}
          onClick={() => props.onSeek(r.atMs)}
          title={`${r.author} reacted ${r.emoji} at ${formatDuration(r.atMs)}`}
        >
          {r.emoji}
        </button>
      ))}

      <div className="timeline-times muted">
        <span>{formatDuration(props.currentMs)}</span>
        <span>{formatDuration(props.durationMs)}</span>
      </div>
    </div>
  );
}

function CommentsPanel(props: {
  spaceId: string;
  recordingId: string;
  comments: CommentRecord[];
  pendingSection: SectionRange | null;
  onClearSection: () => void;
  onChanged: () => Promise<void>;
  currentTimeMs: () => number;
  onSeek: (ms: number) => void;
}) {
  const [text, setText] = useState("");
  const [atTime, setAtTime] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      let atMs: number | null = null;
      let endMs: number | null = null;
      if (props.pendingSection) {
        atMs = props.pendingSection.startMs;
        endMs = props.pendingSection.endMs;
      } else if (atTime) {
        atMs = props.currentTimeMs();
      }
      await window.loom.spaces.comment(props.spaceId, {
        recordingId: props.recordingId,
        text: text.trim(),
        atMs,
        endMs,
      });
      setText("");
      props.onClearSection();
      await props.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleLike = async (c: CommentRecord) => {
    try {
      await window.loom.spaces.setCommentLike(
        props.spaceId,
        props.recordingId,
        c.id,
        !c.likedByMe,
      );
      await props.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <div className="comments-list">
        {props.comments.map((c) => (
          <div key={c.id} className="comment">
            <div className="comment-head">
              <span className="avatar small">
                {c.author.slice(0, 1).toUpperCase()}
              </span>
              <span className="comment-author">{c.author}</span>
              <span className="muted">{formatDate(c.createdAt)}</span>
            </div>
            {c.atMs !== null && (
              <button
                className="timestamp-chip"
                onClick={() => props.onSeek(c.atMs!)}
              >
                ▶ {formatDuration(c.atMs)}
                {c.endMs !== null && ` – ${formatDuration(c.endMs)}`}
              </button>
            )}
            <p className="comment-text">{c.text}</p>
            <button
              className={`like-btn${c.likedByMe ? " liked" : ""}`}
              onClick={() => void toggleLike(c)}
              title={c.likedByMe ? "Unlike" : "Like"}
            >
              {c.likedByMe ? "♥" : "♡"}
              {c.likeCount > 0 && <span>{c.likeCount}</span>}
            </button>
          </div>
        ))}
        {props.comments.length === 0 && (
          <p className="muted">
            No feedback yet. Drag on the timeline to pick a section, or just
            write below.
          </p>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}
      <div className="comment-composer">
        {props.pendingSection && (
          <div className="section-banner">
            Commenting on {formatDuration(props.pendingSection.startMs)} –{" "}
            {formatDuration(props.pendingSection.endMs)}
            <button
              className="btn small ghost"
              onClick={props.onClearSection}
              title="Clear the selected section"
            >
              ✕
            </button>
          </div>
        )}
        <textarea
          placeholder={
            props.pendingSection
              ? "Comment on this section…"
              : "Leave feedback…"
          }
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
        />
        <div className="composer-row">
          {!props.pendingSection ? (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={atTime}
                onChange={(e) => setAtTime(e.target.checked)}
              />
              at current time
            </label>
          ) : (
            <span />
          )}
          <button
            className="btn small primary"
            disabled={busy || !text.trim()}
            onClick={() => void submit()}
          >
            {busy ? "…" : "Comment"}
          </button>
        </div>
      </div>
    </>
  );
}
