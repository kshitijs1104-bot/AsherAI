import { useListThoughts, useCreateThought, useToggleReaction } from '@workspace/api-client-react';
import { useCategory } from '../lib/CategoryContext';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListThoughtsQueryKey } from '@workspace/api-client-react';

export function ThoughtsPage() {
  const { category } = useCategory();
  const queryClient = useQueryClient();
  const { data: thoughts = [], isLoading } = useListThoughts({ category: category !== 'all' ? category : undefined } as any);
  
  const [content, setContent] = useState('');
  const [postCategory, setPostCategory] = useState<'technology' | 'finance' | 'markets' | 'health'>('technology');
  
  const createMutation = useCreateThought({
    mutation: {
      onSuccess: () => {
        setContent('');
        queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() });
      }
    }
  });

  const reactionMutation = useToggleReaction({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListThoughtsQueryKey() });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    createMutation.mutate({ data: { content, author: 'Operator', category: postCategory } as any });
  };

  return (
    <div className="p-8 max-w-3xl mx-auto flex flex-col h-full min-h-screen">
      <header className="mb-6">
        <h1 className="text-2xl font-syne font-bold text-white mb-1">Thoughts Hub</h1>
        <p className="text-sm font-mono text-[var(--muted)]">Raw signals from the network.</p>
      </header>

      <form onSubmit={handleSubmit} className="mb-10 bg-[var(--surface2)] border border-[var(--border)] rounded-xl p-4 shadow-lg focus-within:border-[var(--indigo)] transition-colors">
        <textarea 
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Share a causal insight or anomaly..."
          className="w-full bg-transparent border-none outline-none resize-none text-[var(--text)] text-sm mb-4 placeholder-[var(--dim)] min-h-[80px]"
        />
        <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
          <select 
            value={postCategory}
            onChange={(e) => setPostCategory(e.target.value as any)}
            className="bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)] rounded px-3 py-1 text-xs uppercase font-mono outline-none"
          >
            <option value="technology">Technology</option>
            <option value="finance">Finance</option>
            <option value="markets">Markets</option>
            <option value="health">Health</option>
          </select>
          <button 
            type="submit"
            disabled={!content.trim() || createMutation.isPending}
            className="bg-[var(--indigo)] hover:bg-[var(--indigo-light)] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider px-6 py-2 rounded transition-colors"
          >
            Broadcast
          </button>
        </div>
      </form>

      <div className="flex-1 space-y-4 pb-12">
        {isLoading ? (
          [1,2,3].map(i => <div key={i} className="h-32 bg-[var(--surface)] rounded-lg animate-pulse border border-[var(--border)]"></div>)
        ) : thoughts.map(thought => (
          <div key={thought.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-gradient-to-br from-[var(--indigo)] to-[var(--mint)] flex items-center justify-center text-white font-bold font-syne shadow-md text-xs">
                  {thought.author.charAt(0)}
                </div>
                <div>
                  <div className="text-sm font-bold text-[var(--text)]">{thought.author}</div>
                  <div className="text-[10px] uppercase font-mono text-[var(--muted)]">{thought.category} · {thought.createdAt ? new Date(thought.createdAt).toLocaleDateString() : ''}</div>
                </div>
              </div>
            </div>
            
            <p className="text-sm text-[var(--text)] leading-relaxed mb-4 pl-11">
              {thought.content}
            </p>

            <div className="pl-11 flex flex-wrap gap-2">
              {[
                { type: 'fire', icon: '🔥' },
                { type: 'brain', icon: '🧠' },
                { type: 'chart', icon: '📈' },
                { type: 'signal', icon: '📡' },
                { type: 'agree', icon: '✓' }
              ].map(reaction => {
                const count = thought.reactions?.[reaction.type] || 0;
                return (
                  <button 
                    key={reaction.type}
                    onClick={() => reactionMutation.mutate({ data: { thoughtId: thought.id, reactionType: reaction.type as any }})}
                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--surface2)] hover:bg-[var(--surface3)] border border-[var(--border)] text-xs text-[var(--muted)] hover:text-white transition-colors"
                  >
                    <span>{reaction.icon}</span>
                    {count > 0 && <span className="font-mono">{count}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
