import { Link } from "wouter";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    // Previously this page hardcoded `bg-gray-50`/`text-gray-900`, so a
    // mistyped URL dropped the founder onto a bright white card in the
    // middle of an otherwise dark app, and the only copy on it — "Did you
    // forget to add the page to the router?" — was a note to the developer
    // shipped to the user, with no way back.
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-[var(--bg)] text-[var(--text)] p-6">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8">
        <div className="flex items-center gap-3 mb-3">
          <AlertCircle className="h-6 w-6 text-[var(--muted)] shrink-0" />
          <h1 className="text-xl font-bold">This page doesn’t exist</h1>
        </div>

        <p className="text-sm text-[var(--muted)] mb-6">
          The link may be out of date, or the address may have a typo in it.
        </p>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/vera"
            className="rounded-lg bg-[var(--indigo)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Back to Asher
          </Link>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)] transition-colors hover:text-[var(--text)]"
          >
            Go back
          </button>
        </div>
      </div>
    </div>
  );
}
