import { useState, useEffect } from 'react';
import { Link } from 'wouter';
import { useGetOnboarding, useSaveOnboarding } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetOnboardingQueryKey } from '@workspace/api-client-react';
import { useCompanyFacts } from '../lib/venusApi';

// Appearance deliberately does NOT live here. The skin is a Vera setting, so
// it sits in Vera's sidebar panel next to Connectors — see the Appearance
// block in Venus.tsx, which renders SkinChoiceList. One place, next to the
// product it changes, rather than two controls that could disagree.
//
// This page used to render inside the Nexus <Layout>. That chrome is archived
// (src/_archive) and this page is not: everything on it is Vera's. It now
// renders standalone, so it carries its own way back.
//
// NOT LINKED FROM ANYWHERE LIVE. The /settings route this page renders at is
// only reachable by typing the URL — the one thing that used to link to it
// (Topbar.tsx) is itself archived. Confirmed the hard way: the "Privacy &
// Terms" section below was added here first, and a founder using the actual
// product could not find it, because nothing in the live UI points here.
// THE settings surface reachable from inside Vera is VeraSettingsModal
// (opened from the sidebar's Settings button in Venus.tsx) — its General tab
// (pages/GeneralSettings.tsx) is where the Privacy Policy link and account
// deletion actually live now. What's below is kept working in case this page
// gets wired back in, but it is not where anyone finds these today.

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: onboarding } = useGetOnboarding();
  const { data: factsData } = useCompanyFacts();
  const facts = factsData?.facts ?? [];

  const [formData, setFormData] = useState({
    companyName: '', stage: '', industry: '', teamSize: '', country: '', primaryGoal: ''
  });

  useEffect(() => {
    if (onboarding) {
      setFormData({
        companyName: onboarding.companyName || '',
        stage: onboarding.stage || '',
        industry: onboarding.industry || '',
        teamSize: onboarding.teamSize || '',
        country: onboarding.country || '',
        primaryGoal: onboarding.primaryGoal || ''
      });
    }
  }, [onboarding]);

  const saveOnboardingMutation = useSaveOnboarding({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetOnboardingQueryKey() });
      }
    }
  });

  return (
    // Two elements, not one: the ground has to be full-bleed while the form
    // stays a centred 3xl column. <Layout>'s wrapper used to provide the
    // former; folding both onto a single div would paint the background only
    // behind the column.
    <div className="dark min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="p-8 max-w-3xl mx-auto space-y-12">
      <Link
        href="/vera"
        className="inline-flex items-center gap-2 text-[13px] text-[var(--muted)] hover:text-white transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5">
          <path d="M15 5L8 12L15 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to Vera
      </Link>
      <header>
        <h1 className="text-2xl font-syne font-bold text-white mb-2">Settings</h1>
        <p className="text-sm font-mono text-[var(--muted)]">Configure how Vera reads your business.</p>
      </header>

      {/* Business Context */}
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8">
        <h2 className="text-lg font-syne font-bold text-white mb-1">Business Context</h2>
        <p className="text-xs text-[var(--muted)] mb-8">This context is sent to Vera with every request to calibrate analysis.</p>

        <form 
          className="space-y-6"
          onSubmit={e => {
            e.preventDefault();
            saveOnboardingMutation.mutate({ data: formData as any });
          }}
        >
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase text-[var(--dim)]">Company Name</label>
              <input 
                type="text" 
                value={formData.companyName}
                onChange={e => setFormData(p => ({...p, companyName: e.target.value}))}
                className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded px-4 py-2 text-sm text-white focus:border-[var(--indigo)] outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase text-[var(--dim)]">Stage</label>
              <select 
                value={formData.stage}
                onChange={e => setFormData(p => ({...p, stage: e.target.value}))}
                className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded px-4 py-2 text-sm text-white focus:border-[var(--indigo)] outline-none"
              >
                <option value="">Select Stage...</option>
                <option value="pre-seed">Pre-Seed</option>
                <option value="seed">Seed</option>
                <option value="series-a">Series A</option>
                <option value="series-b">Series B</option>
                <option value="growth">Growth</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase text-[var(--dim)]">Industry</label>
              <input 
                type="text" 
                value={formData.industry}
                onChange={e => setFormData(p => ({...p, industry: e.target.value}))}
                className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded px-4 py-2 text-sm text-white focus:border-[var(--indigo)] outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase text-[var(--dim)]">Team Size</label>
              <input 
                type="text" 
                value={formData.teamSize}
                onChange={e => setFormData(p => ({...p, teamSize: e.target.value}))}
                className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded px-4 py-2 text-sm text-white focus:border-[var(--indigo)] outline-none"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-xs font-mono uppercase text-[var(--dim)]">Primary Goal / Mission</label>
            <textarea 
              value={formData.primaryGoal}
              onChange={e => setFormData(p => ({...p, primaryGoal: e.target.value}))}
              className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded px-4 py-3 text-sm text-white focus:border-[var(--indigo)] outline-none min-h-[100px] resize-none"
            />
          </div>

          <div className="flex justify-end pt-4 border-t border-[var(--border)]">
            <button 
              type="submit"
              disabled={saveOnboardingMutation.isPending}
              className="bg-white text-black hover:bg-gray-200 disabled:opacity-50 font-bold uppercase text-xs tracking-wider px-6 py-2.5 rounded transition-colors"
            >
              {saveOnboardingMutation.isPending ? 'Saving...' : 'Save Context'}
            </button>
          </div>
        </form>
      </section>

      {/* What Vera Knows — read-only view of the structured Company Memory
          (company_facts table), separate from the free-text business context
          above. Each row is captured automatically from things you've told
          Venus in chat, not something you fill in by hand. */}
      {facts.length > 0 && (
        <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8">
          <h2 className="text-lg font-syne font-bold text-white mb-1">What Vera Knows</h2>
          <p className="text-xs text-[var(--muted)] mb-6">
            Captured automatically from your conversations — this is what Vera factors into every answer, beyond the context above.
          </p>
          <ul className="space-y-2">
            {facts.map((fact) => (
              <li
                key={fact.id}
                className="flex items-start gap-3 text-sm text-[var(--muted)] bg-[var(--surface2)] border border-[var(--border)] rounded p-3"
              >
                <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--dim)] shrink-0 mt-0.5 px-1.5 py-0.5 rounded bg-[var(--surface3)]">
                  {fact.factType}
                </span>
                <span className="text-white">{fact.factText}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Kept as a plain link to /privacy rather than an inline copy of the
          text — PolicyProse already renders that page, and a second render
          site here would be a second place for it to go stale relative to the
          one everyone actually agreed to at signup (see the note atop
          privacyPolicy.tsx on why there is exactly one source of truth). */}
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8">
        <h2 className="text-lg font-syne font-bold text-white mb-1">Privacy &amp; Terms</h2>
        <p className="text-xs text-[var(--muted)] mb-4">
          What Vera stores, how it's protected, and the terms you agreed to when you signed up.
        </p>
        <Link
          href="/privacy"
          className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-white transition-colors underline underline-offset-2"
        >
          Read the Privacy Policy
        </Link>
      </section>
      </div>
    </div>
  );
}
