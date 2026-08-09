import React, { useState } from "react";
import type { RecordingMeta, SpaceInfo } from "../../shared/types";

interface Props {
  recording: RecordingMeta;
  spaces: SpaceInfo[];
  onClose: () => void;
  onShared: () => void;
}

/**
 * Share a recording into a space (existing or newly created), then surface
 * the invite code so the user can bring reviewers in.
 */
export function ShareDialog({ recording, spaces, onClose, onShared }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    spaceName: string;
    code: string;
  } | null>(null);
  const [newSpaceName, setNewSpaceName] = useState("");

  const publishTo = async (space: SpaceInfo) => {
    setBusy(`Publishing to “${space.name}”…`);
    setError(null);
    try {
      await window.pearloom.spaces.publish(recording.id, space.id);
      const code = await window.pearloom.spaces.invite(space.id);
      setInvite({ spaceName: space.name, code });
      onShared();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const createAndPublish = async () => {
    if (!newSpaceName.trim()) return;
    setBusy("Creating space…");
    setError(null);
    try {
      const space = await window.pearloom.spaces.create(newSpaceName.trim());
      await publishTo(space);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {invite ? (
          <>
            <h2>Shared to “{invite.spaceName}”</h2>
            <p className="muted">
              Send this invite code to teammates. They paste it into Pearloom
              (“Join space”) and sync directly from you — keep the app open
              while they join and download.
            </p>
            <div className="invite-code-box">
              <code>{invite.code}</code>
              <button
                className="btn small primary"
                onClick={() => navigator.clipboard.writeText(invite.code)}
              >
                Copy
              </button>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Share “{recording.title}”</h2>
            <p className="muted">
              Publish into a space. Everyone in the space can watch and leave
              comments — nothing touches a server, ever.
            </p>
            {error && <div className="error-banner">{error}</div>}
            {busy && <div className="muted">{busy}</div>}

            {spaces.length > 0 && (
              <div className="share-space-list">
                {spaces.map((s) => {
                  const already = recording.sharedTo.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      className="share-space-row"
                      disabled={!!busy || already || !s.writable}
                      onClick={() => void publishTo(s)}
                      title={
                        !s.writable
                          ? "Still syncing write access for this space"
                          : undefined
                      }
                    >
                      <span>{s.name}</span>
                      <span className="muted">
                        {already
                          ? "already shared"
                          : s.writable
                            ? "publish →"
                            : "syncing…"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="share-new-space">
              <input
                placeholder="…or create a new space"
                value={newSpaceName}
                onChange={(e) => setNewSpaceName(e.target.value)}
                disabled={!!busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createAndPublish();
                }}
              />
              <button
                className="btn primary"
                disabled={!!busy || !newSpaceName.trim()}
                onClick={() => void createAndPublish()}
              >
                Create &amp; share
              </button>
            </div>

            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
