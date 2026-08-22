import { useEffect, useState } from 'react';
import { useClerk } from '@clerk/clerk-react';
import { useLocation } from 'wouter';
import { Check, Loader2, LogOut, Pencil, X } from 'lucide-react';
import { useProfile, useUpdateProfile, type VeraProfile, type ProfilePatch } from '../lib/venusApi';
import { VeraMark } from '../components/VeraMark';

/* ---------------------------------------------------------------------------
   THE ACCOUNT CARD — what Vera actually knows about you, as an ID card.

   WHY A CARD AND NOT A SETTINGS FORM. Everything on this screen is already
   somewhere else in the product: the company name is in the dossier, the role
   went into onboarding, the email is Clerk's. What did not exist anywhere was a
   single place a founder could look and see THEMSELVES — the identity Vera is
   reasoning about when it answers. A stack of labelled inputs is a form you
   fill in; a card is a thing you have. The second one is what makes a founder
   check whether it is right.

   TWO SOURCES, NEITHER AUTHORITATIVE FOR THE OTHER (see routes/profile.ts):
   Clerk owns the account — email, joined date, avatar — and is read live, never
   copied here. Vera owns the business context — company, role, team size — and
   that is what is editable, because it is what Vera reasons from and what a
   founder would want to correct after Vera gets something wrong.

   EVERY FIELD IS EDITABLE IN PLACE, one at a time. A single "Save" for the
   whole card would mean a founder correcting one wrong word has to re-confirm
   six other values they never looked at — and PATCH /profile only writes the
   keys it is sent, precisely so this can work field by field.

   FUTURE (enterprise): the design deliberately leaves room under the identity
   block for a real uploaded ID / company badge, the same way the Dossier takes
   uploads. Not built — there is no enterprise tier to attach it to yet, and
   building an upload for an audience of zero is how the plan page ended up
   advertising nine features that did not exist.
--------------------------------------------------------------------------- */

interface EditableField {
  key: keyof ProfilePatch;
  label: string;
  /** Shown when the founder has never given a value. Never a fake example. */
  placeholder: string;
  /** Fields Vera reads into the prompt are marked so the founder knows a
   *  correction here changes the answers, not just this screen. */
  feedsAnswers?: boolean;
}

const IDENTITY_FIELDS: EditableField[] = [
  { key: 'displayName', label: 'Name', placeholder: 'Not set' },
  { key: 'role', label: 'Role', placeholder: 'Not set', feedsAnswers: true },
];

const COMPANY_FIELDS: EditableField[] = [
  { key: 'company', label: 'Company', placeholder: 'Not set', feedsAnswers: true },
  { key: 'teamSize', label: 'Team size', placeholder: 'Not set', feedsAnswers: true },
  { key: 'monthlyRevenue', label: 'Monthly revenue', placeholder: 'Not set', feedsAnswers: true },
  { key: 'industry', label: 'Industry', placeholder: 'Not set', feedsAnswers: true },
  { key: 'stage', label: 'Stage', placeholder: 'Not set', feedsAnswers: true },
  { key: 'country', label: 'Country', placeholder: 'Not set' },
];

function valueOf(profile: VeraProfile | undefined, key: keyof ProfilePatch): string {
  if (!profile) return '';
  // displayName falls back to the Clerk name for DISPLAY, but the editable
  // value stays the stored one — otherwise opening the editor would silently
  // convert "inheriting my Clerk name" into "pinned this exact string", and the
  // founder's name would stop following their account.
  if (key === 'displayName') return profile.displayName ?? '';
  const v = profile[key as keyof VeraProfile];
  return typeof v === 'string' ? v : '';
}

function displayOf(profile: VeraProfile | undefined, field: EditableField): string | null {
  if (!profile) return null;
  if (field.key === 'displayName') return profile.displayName ?? profile.clerkName ?? null;
  const v = profile[field.key as keyof VeraProfile];
  return typeof v === 'string' && v.trim() ? v : null;
}

function FieldRow({
  profile,
  field,
  editing,
  onStartEdit,
  onCancel,
  onSave,
  saving,
}: {
  profile: VeraProfile | undefined;
  field: EditableField;
  editing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(() => valueOf(profile, field.key));

  // Re-seed whenever the editor opens, so a cancelled edit followed by a
  // re-open never shows the abandoned text.
  useEffect(() => {
    if (editing) setDraft(valueOf(profile, field.key));
  }, [editing, profile, field.key]);

  const shown = displayOf(profile, field);

  return (
    <div
      className="flex items-center gap-3 py-2.5 border-b last:border-b-0"
      style={{ borderColor: 'var(--v7-border)' }}
    >
      <span
        className="shrink-0 font-mono uppercase"
        style={{ width: 116, fontSize: 10, letterSpacing: '0.1em', color: 'var(--v7-text-mute)' }}
      >
        {field.label}
      </span>

      {editing ? (
        <form
          className="flex-1 flex items-center gap-2 min-w-0"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft);
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel();
            }}
            className="flex-1 min-w-0 rounded-md px-2.5 py-1.5 text-[13px] outline-none"
            style={{
              background: 'var(--v7-bg-raised-2)',
              border: '1px solid var(--v7-cyan-strong)',
              color: 'var(--v7-text)',
            }}
          />
          <button
            type="submit"
            disabled={saving}
            title="Save"
            className="shrink-0 p-1.5 rounded-md disabled:opacity-50"
            style={{ background: 'var(--v7-cyan)', color: 'var(--v7-bg)' }}
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          </button>
          <button
            type="button"
            onClick={onCancel}
            title="Cancel"
            className="shrink-0 p-1.5 rounded-md"
            style={{ color: 'var(--v7-text-mute)' }}
          >
            <X className="w-3 h-3" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={onStartEdit}
          className="flex-1 min-w-0 flex items-center gap-2 text-left group"
          title={`Edit ${field.label.toLowerCase()}`}
        >
          <span
            className="truncate text-[13px]"
            style={{ color: shown ? 'var(--v7-text)' : 'var(--v7-text-mute)' }}
          >
            {shown ?? field.placeholder}
          </span>
          <Pencil
            className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--v7-text-mute)' }}
          />
        </button>
      )}
    </div>
  );
}

export function AccountCard() {
  const { data: profile, isLoading, isError } = useProfile();
  const updateProfile = useUpdateProfile();
  const { signOut } = useClerk();
  const [, navigate] = useLocation();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = (key: keyof ProfilePatch, value: string) => {
    setSaveError(null);
    updateProfile.mutate(
      // Empty string is sent as null so a cleared field is genuinely removed
      // rather than stored as "". The server normalises this too — belt and
      // braces, because "" and null reading differently is exactly the kind of
      // thing that produces an empty-looking field nothing can clear.
      { [key]: value.trim() === '' ? null : value.trim() } as ProfilePatch,
      {
        onSuccess: () => setEditingKey(null),
        onError: (err) => setSaveError(err instanceof Error ? err.message : "That didn't save."),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center" style={{ color: 'var(--v7-text-mute)' }}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span className="text-[12.5px]">Loading your account…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-6 text-[12.5px]" style={{ color: 'var(--v7-text-mute)' }}>
        Couldn't load your account details. Check your connection and reopen this tab.
      </div>
    );
  }

  const memberSince = profile?.memberSince
    ? new Date(profile.memberSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* ---- The card itself ---- */}
      <div
        style={{
          borderRadius: 14,
          overflow: 'hidden',
          border: '1px solid var(--v7-border-strong)',
          background: 'var(--v7-bg-raised)',
        }}
      >
        {/* Header band. Deliberately reads as the top of a physical ID card —
            issuer mark on one side, status on the other. */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5"
          style={{ background: 'var(--v7-bg-raised-2)', borderBottom: '1px solid var(--v7-border)' }}
        >
          <div className="flex items-center gap-2">
            <VeraMark size={15} />
            <span
              className="font-mono uppercase"
              style={{ fontSize: 9.5, letterSpacing: '0.16em', color: 'var(--v7-text-mute)' }}
            >
              Asher account
            </span>
          </div>
          {memberSince && (
            <span
              className="font-mono uppercase"
              style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--v7-text-mute)' }}
            >
              Since {memberSince}
            </span>
          )}
        </div>

        {/* Identity block: photo + the two things that name a person. */}
        <div className="flex items-center gap-3.5 px-4 pt-4 pb-3">
          <div
            className="shrink-0 flex items-center justify-center overflow-hidden"
            style={{
              width: 54,
              height: 54,
              borderRadius: 12,
              background: 'var(--v7-bg-raised-2)',
              border: '1px solid var(--v7-border-strong)',
            }}
          >
            {profile?.imageUrl ? (
              <img src={profile.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              // Initial, not a stock avatar silhouette — a placeholder person
              // is worse than no person.
              <span className="font-semibold" style={{ fontSize: 22, color: 'var(--v7-text-dim)' }}>
                {(profile?.name ?? profile?.email ?? '?').trim().charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold" style={{ fontSize: 17, color: 'var(--v7-text)' }}>
              {profile?.name ?? 'Unnamed'}
            </div>
            {/* Email is Clerk's and is NOT editable here. Changing the address
                you sign in with is an account-security operation with its own
                verification flow — putting a pencil next to it would imply
                Asher can do something it cannot and should not. */}
            <div className="truncate" style={{ fontSize: 12.5, color: 'var(--v7-text-mute)' }}>
              {profile?.email ?? 'No email on file'}
            </div>
            {profile?.company && (
              <div className="truncate mt-0.5" style={{ fontSize: 12, color: 'var(--v7-text-dim)' }}>
                {profile.role ? `${profile.role} · ` : ''}
                {profile.company}
              </div>
            )}
          </div>
        </div>

        {/* Editable detail. */}
        <div className="px-4 pb-3">
          {IDENTITY_FIELDS.map((f) => (
            <FieldRow
              key={f.key}
              profile={profile}
              field={f}
              editing={editingKey === f.key}
              onStartEdit={() => { setSaveError(null); setEditingKey(f.key); }}
              onCancel={() => setEditingKey(null)}
              onSave={(v) => save(f.key, v)}
              saving={updateProfile.isPending && editingKey === f.key}
            />
          ))}
        </div>

        <div
          className="px-4 py-2"
          style={{ background: 'var(--v7-bg-raised-2)', borderTop: '1px solid var(--v7-border)', borderBottom: '1px solid var(--v7-border)' }}
        >
          <span
            className="font-mono uppercase"
            style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--v7-text-mute)' }}
          >
            What Asher reasons from
          </span>
        </div>

        <div className="px-4 py-1">
          {COMPANY_FIELDS.map((f) => (
            <FieldRow
              key={f.key}
              profile={profile}
              field={f}
              editing={editingKey === f.key}
              onStartEdit={() => { setSaveError(null); setEditingKey(f.key); }}
              onCancel={() => setEditingKey(null)}
              onSave={(v) => save(f.key, v)}
              saving={updateProfile.isPending && editingKey === f.key}
            />
          ))}
        </div>

        {saveError && (
          <div
            className="px-4 py-2.5 text-[12px]"
            style={{ color: 'var(--red, #e5555c)', borderTop: '1px solid var(--v7-border)' }}
          >
            {saveError}
          </div>
        )}
      </div>

      {/* Says plainly that this is not cosmetic — a correction here changes
          the answers, which is the reason to bother making one. */}
      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.55, color: 'var(--v7-text-mute)' }}>
        Asher reads your company, role, size and stage into every analysis. Correcting something here
        changes what it says next, not just what this card shows.
      </p>

      {/* ---- Session ---- */}
      <button
        type="button"
        onClick={() => signOut(() => navigate('/'))}
        className="flex items-center justify-center gap-2 w-full rounded-lg py-2.5 text-[12.5px] font-semibold transition-colors"
        style={{
          background: 'var(--v7-bg-raised-2)',
          border: '1px solid var(--v7-border-strong)',
          color: 'var(--v7-text-dim)',
        }}
      >
        <LogOut className="w-3.5 h-3.5" />
        Sign out
      </button>

      {/* Deletion deliberately NOT duplicated here. It already exists in the
          General tab with a type-to-confirm gate, and a second, differently
          worded delete button is how a founder ends up destroying an account
          from the one that happened to have less friction. */}
      <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--v7-text-mute)' }}>
        Deleting your account and everything in it is under the General tab.
      </p>
    </div>
  );
}
