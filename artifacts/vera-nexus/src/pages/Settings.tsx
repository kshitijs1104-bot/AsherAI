import { useState, useEffect } from 'react';
import { useGetOnboarding, useSaveOnboarding } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetOnboardingQueryKey } from '@workspace/api-client-react';
import { useCompanyFacts } from '../lib/venusApi';

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
    <div className="p-8 max-w-3xl mx-auto space-y-12">
      <header>
        <h1 className="text-2xl font-syne font-bold text-white mb-2">Settings</h1>
        <p className="text-sm font-mono text-[var(--muted)]">Configure Vera Nexus core parameters.</p>
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
    </div>
  );
}
