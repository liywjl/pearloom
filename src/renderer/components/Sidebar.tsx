import React, { useState } from "react";
import type { Profile, SpaceInfo } from "../../shared/types";
import type { Route } from "../App";

interface Props {
  route: Route;
  spaces: SpaceInfo[];
  profile: Profile;
  onNavigate: (route: Route) => void;
  onProfileChange: (name: string) => void;
  onSpacesChanged: () => void;
}

export function Sidebar({
  route,
  spaces,
  profile,
  onNavigate,
  onProfileChange,
  onSpacesChanged,
}: Props) {
  const [joinOpen, setJoinOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);

  const active = (test: (r: Route) => boolean) =>
    test(route) ? " active" : "";

  const join = async (code: string) => {
    setBusy("Pairing with the space owner…");
    setError(null);
    try {
      const space = await window.pearloom.spaces.join(code);
      setJoinOpen(false);
      onSpacesChanged();
      onNavigate({ view: "space", spaceId: space.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const create = async (name: string) => {
    setBusy("Creating space…");
    setError(null);
    try {
      const space = await window.pearloom.spaces.create(name);
      setCreateOpen(false);
      onSpacesChanged();
      onNavigate({ view: "space", spaceId: space.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-dot" /> Pearloom
      </div>

      <nav>
        <button
          className={`nav-item${active((r) => r.view === "record")}`}
          onClick={() => onNavigate({ view: "record" })}
        >
          ● New recording
        </button>
        <button
          className={`nav-item${active((r) => r.view === "library")}`}
          onClick={() => onNavigate({ view: "library" })}
        >
          ▤ Library
        </button>
      </nav>

      <div className="sidebar-section">
        <div className="sidebar-heading">
          Spaces
          <span className="sidebar-heading-actions">
            <button
              title="Create a space"
              onClick={() => {
                setCreateOpen((v) => !v);
                setJoinOpen(false);
              }}
            >
              ＋
            </button>
            <button
              title="Join with invite code"
              onClick={() => {
                setJoinOpen((v) => !v);
                setCreateOpen(false);
              }}
            >
              ⇥
            </button>
          </span>
        </div>

        {createOpen && (
          <InlineForm
            placeholder="Space name"
            submitLabel="Create"
            busy={busy}
            onSubmit={create}
          />
        )}
        {joinOpen && (
          <InlineForm
            placeholder="Paste invite code"
            submitLabel="Join"
            busy={busy}
            onSubmit={join}
          />
        )}
        {error && <div className="sidebar-error">{error}</div>}

        {spaces.map((s) => (
          <button
            key={s.id}
            className={`nav-item space-item${active((r) => r.view === "space" && r.spaceId === s.id)}`}
            onClick={() => onNavigate({ view: "space", spaceId: s.id })}
            title={s.id}
          >
            <span className="space-name">{s.name}</span>
            <span
              className={`peer-badge${s.connectedPeers > 0 ? " online" : ""}`}
            >
              {s.connectedPeers > 0 ? `${s.connectedPeers} online` : "no peers"}
            </span>
          </button>
        ))}
        {spaces.length === 0 && !createOpen && !joinOpen && (
          <div className="sidebar-empty">
            Create a space to share recordings, or join one with an invite code.
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        {editingName ? (
          <InlineForm
            placeholder="Your name"
            submitLabel="Save"
            initial={profile.name}
            busy={null}
            onSubmit={(name) => {
              onProfileChange(name);
              setEditingName(false);
            }}
          />
        ) : (
          <button
            className="profile-chip"
            onClick={() => setEditingName(true)}
            title="Click to change your display name"
          >
            <span className="avatar">
              {(profile.name || "?").slice(0, 1).toUpperCase()}
            </span>
            {profile.name || "…"}
          </button>
        )}
      </div>
    </aside>
  );
}

function InlineForm(props: {
  placeholder: string;
  submitLabel: string;
  initial?: string;
  busy: string | null;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) props.onSubmit(value.trim());
      }}
    >
      <input
        autoFocus
        value={value}
        placeholder={props.placeholder}
        onChange={(e) => setValue(e.target.value)}
        disabled={!!props.busy}
      />
      <button type="submit" disabled={!!props.busy || !value.trim()}>
        {props.busy ? "…" : props.submitLabel}
      </button>
      {props.busy && <div className="inline-form-busy">{props.busy}</div>}
    </form>
  );
}
