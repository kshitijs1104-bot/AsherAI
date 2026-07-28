import { useState } from 'react';
import { TickerStrip } from './TickerStrip';
import { CategoryPills } from './CategoryPills';
import { NewsFeed } from './NewsFeed';
import { WatchlistPanel } from './WatchlistPanel';
import { ArticleDrawer } from './ArticleDrawer';
import { StoryRail } from './StoryRail';
import { StoryViewer } from './StoryViewer';
import type { NewsArticle } from '../../lib/sight-data';
import { useNewsArticles } from '../../lib/sight-data';

export function SightPage() {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [openArticle, setOpenArticle] = useState<NewsArticle | null>(null);
  const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);
  const { data: allArticles = [] } = useNewsArticles(category === 'all' ? undefined : category);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sight-internal sticky topbar */}
      <div
        className="sticky top-0 z-40 border-b border-[var(--border)] shrink-0"
        style={{ background: 'rgba(8,8,16,0.86)', backdropFilter: 'blur(16px) saturate(140%)' }}
      >
        {/* Search + live pill row */}
        <div className="flex items-center gap-[14px] px-[22px] py-[14px] max-w-[1320px] mx-auto max-[640px]:px-4 max-[640px]:py-3">
          <div className="relative flex-1 max-w-[480px] max-[640px]:hidden">
            <svg
              className="absolute left-[13px] top-1/2 -translate-y-1/2 w-[15px] h-[15px]"
              viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="var(--dim)"
            >
              <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search news, tickers, sectors…"
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-full px-4 pl-[38px] py-[9px] text-[13.5px] text-[var(--text)] placeholder-[var(--dim)] outline-none focus:border-[var(--indigo)] focus:bg-[var(--surface2)] transition-all font-sans"
            />
          </div>

          <div className="ml-auto flex items-center gap-[10px]">
            <span className="flex items-center gap-[6px] font-mono text-[10.5px] text-[var(--mint)] bg-[rgba(0,229,176,0.14)] border border-[rgba(0,229,176,0.25)] px-[11px] py-[6px] rounded-full whitespace-nowrap max-[640px]:hidden">
              <span
                className="w-[6px] h-[6px] rounded-full bg-[var(--mint)]"
                style={{ animation: 'sight-pulse 1.6s ease-in-out infinite' }}
              />
              LIVE
            </span>
            <button className="w-9 h-9 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center hover:bg-[var(--surface2)] transition-colors relative">
              <svg className="w-4 h-4 stroke-[var(--muted)]" viewBox="0 0 24 24" fill="none" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
              <span className="absolute -top-[3px] -right-[3px] bg-[var(--mint)] text-[#06120d] text-[9px] font-mono font-bold w-[15px] h-[15px] rounded-full flex items-center justify-center">3</span>
            </button>
          </div>
        </div>

        <style>{`
          @keyframes sight-pulse {
            0%,100% { opacity:1; box-shadow:0 0 0 0 rgba(0,229,176,0.5); }
            50% { opacity:.55; box-shadow:0 0 0 4px rgba(0,229,176,0); }
          }
        `}</style>

        {/* Ticker strip */}
        <TickerStrip />

        {/* Category pills */}
        <CategoryPills active={category} onChange={setCategory} />

        {/* Story rail */}
        <StoryRail
          articles={allArticles}
          onSelectStory={(index) => setSelectedStoryIndex(index)}
          activeIndex={selectedStoryIndex ?? undefined}
        />
      </div>

      {/* Main scrollable area — full width terminal layout */}
      <div className="flex-1 overflow-y-auto">
        <div
          className="grid gap-[18px] px-[22px] py-[14px] pb-[60px] max-w-none mx-auto max-[980px]:grid-cols-1 max-[640px]:px-4"
          style={{ gridTemplateColumns: '1fr 320px' }}
        >
          {/* Feed */}
          <main className="min-w-0">
            <div className="flex items-center justify-between mb-[10px]">
              <h2 className="font-mono text-[11px] uppercase tracking-[1.4px] text-[var(--dim)]">
                Live Newswire
              </h2>
              <span className="font-mono text-[10.5px] text-[var(--dim)]">Real-time · chronological</span>
            </div>
            <NewsFeed category={category} onArticleClick={setOpenArticle} />
          </main>

          {/* Sidebar */}
          <aside className="flex flex-col gap-4 self-start sticky top-0 max-[980px]:order-first max-[980px]:sticky-none max-[980px]:relative">
            <WatchlistPanel />

            {/* Ask Vera panel */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[14px] overflow-hidden max-[980px]:hidden">
              <div className="px-4 py-[15px] border-b border-[var(--border)]">
                <h4 className="font-syne text-[14px] font-bold">Ask Vera</h4>
              </div>
              <div className="p-4">
                <p className="text-[12px] text-[var(--muted)] leading-[1.6] mb-[10px]">
                  Quick questions about today's market, a stock, or a headline — answered with cited precedent.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. Why did Bank Nifty fall today?"
                    className="flex-1 bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-[11px] py-[9px] text-[12px] text-[var(--text)] placeholder-[var(--dim)] outline-none focus:border-[var(--indigo)]"
                  />
                  <button className="w-[34px] flex-shrink-0 rounded-lg bg-[var(--indigo)] text-white flex items-center justify-center hover:bg-[var(--indigo-light)] transition-colors">
                    <svg className="w-[14px] h-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <line x1="22" y1="2" x2="11" y2="13"/>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="hidden max-[980px]:flex fixed bottom-0 left-0 right-0 z-50 justify-around border-t border-[var(--border)] px-[10px] pt-2 pb-3"
        style={{ background: 'rgba(13,16,22,0.92)', backdropFilter: 'blur(14px)' }}
      >
        {[
          { label: 'Feed', icon: 'M3 12l9-9 9 9M5 10v10h14V10' },
          { label: 'Sight', icon: 'M3 17l6-6 4 4 8-9' },
          { label: 'Crypt', icon: 'M12 3C8 3 5 6 5 10c0 5 7 11 7 11s7-6 7-11c0-4-3-7-7-7z' },
          { label: 'Saved', icon: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' },
        ].map(({ label, icon }, i) => (
          <div key={label} className={`flex flex-col items-center gap-[3px] text-[10px] font-mono ${i === 1 ? 'text-[var(--mint)]' : 'text-[var(--dim)]'}`}>
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d={icon} />
            </svg>
            {label}
          </div>
        ))}
      </nav>

      {/* Article drawer */}
      <ArticleDrawer article={openArticle} onClose={() => setOpenArticle(null)} />

      {/* Story Viewer modal */}
      {selectedStoryIndex !== null && allArticles[selectedStoryIndex] && (
        <StoryViewer
          article={allArticles[selectedStoryIndex]}
          onClose={() => setSelectedStoryIndex(null)}
          allArticles={allArticles}
          currentIndex={selectedStoryIndex}
          onNavigate={(index) => setSelectedStoryIndex(index)}
        />
      )}
    </div>
  );
}
