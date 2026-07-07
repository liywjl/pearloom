import React, { useCallback, useEffect, useState } from "react";
import type { SharedRecording, SpaceInfo } from "../../shared/types";
import { formatDate, formatDuration, formatSize } from "../lib/format";

interface Props {
  spaceId: string;
  spaces: SpaceInfo[];
  onOpen: (rec: SharedRecording) => void;
  onLeft: () => void;
}

export function SpaceView({ spaceId, spaces, onOpen, onLeft }: Props) {
  const space = spaces.find((s) => s.id === spaceId) ?? null;
  const [shared, setShared] = useState<SharedRecording[]>([]);
  const [invite, setInvite] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setShared(await window.loom.spaces.shared(spaceId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [spaceId]);

  useEffect(() => {
    void refresh();
    const off = window.loom.events.on("space-updated", (updatedId) => {
      if (updatedId === spaceId) void refresh();
    });
    return off;
  }, [spaceId, refresh]);

  if (!space)
    return (
      <div className="view-header">
        <h1>Space not found</h1>
      </div>
    );

  return (
    <div className="space-view">
      <header className="view-header space-header">
        <div>
          <h1>{space.name}</h1>
          <p className="muted">
            {space.connectedPeers > 0
              ? `${space.connectedPeers} peer${space.connectedPeers === 1 ? "" : "s"} connected`
              : "No peers connected right now — syncing resumes when someone comes online."}
            {!space.writable && " · read-only until your write access syncs in"}
          </p>
        </div>
        <div className="space-header-actions">
          <button
            className="btn primary"
            onClick={async () => {
              try {
                setInvite(await window.loom.spaces.invite(spaceId));
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            ⇥ Invite people
          </button>
          <button
            className="btn ghost danger-text"
            onClick={async () => {
              if (
                confirm(
                  `Leave “${space.name}”? You'll need a new invite to rejoin.`,
                )
              ) {
                await window.loom.spaces.leave(spaceId);
                onLeft();
              }
            }}
          >
            Leave
          </button>
        </div>
      </header>

      {invite && (
        <div className="invite-code-box">
          <code>{invite}</code>
          <button
            className="btn small primary"
            onClick={() => navigator.clipboard.writeText(invite)}
          >
            Copy
          </button>
          <button className="btn small ghost" onClick={() => setInvite(null)}>
            ✕
          </button>
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}

      <div className="shared-list">
        {shared.map((rec) => (
          <button
            key={rec.id}
            className="shared-row"
            onClick={() => onOpen(rec)}
          >
            <span className="shared-row-title">
              {rec.title}
              {rec.mine && <span className="mine-chip">yours</span>}
            </span>
            <span className="muted">
              by {rec.ownerName} · {formatDate(rec.createdAt)} ·{" "}
              {formatDuration(rec.durationMs)} · {formatSize(rec.sizeBytes)}
            </span>
            <span className="shared-row-cta">Watch &amp; comment →</span>
          </button>
        ))}
        {shared.length === 0 && (
          <div className="empty-state">
            <p>No recordings in this space yet.</p>
            <p className="muted">
              Share one from your Library, or wait for peers to sync theirs to
              you.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
