import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AiSummaryPanel } from './AiSummaryPanel';
import type { NewsArticle } from '../../lib/sight-data';

const TAG_STYLES: Record<string, string> = {
  markets:  'bg-[rgba(91,79,232,0.14)] text-[var(--indigo-light)]',
  macro:    'bg-[rgba(0,229,176,0.14)] text-[var(--mint)]',
  earnings: 'bg-[rgba(240,168,58,0.14)] text-[var(--amber)]',
  global:   'bg-[rgba(240,94,94,0.14)] text-[var(--red)]',
  ipo:      'bg-[rgba(167,139,250,0.14)] text-[#b9a4ff]',
};

async function fetchArticleSummary(article: NewsArticle) {
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, '');
  const res = await fetch(`${base}/api/ai/summarize-article`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': localStorage.getItem('vn_session_id') || 'anonymous',
    },
    body: JSON.stringify({
      articleId: article.id,
      title: article.title,
      body: article.body.join('\n\n'),
    }),
  });
  if (!res.ok) throw new Error('Summary failed');
  return res.json() as Promise<{ bullets: string[]; stats: { label: string; value: string }[] }>;
}

interface ArticleDrawerProps {
  article: NewsArticle | null;
  onClose: () => void;
}

export function ArticleDrawer({ article, onClose }: ArticleDrawerProps) {
  const [mobileAiOpen, setMobileAiOpen] = useState(false);
  const isOpen = !!article;

  // Close mobile AI panel when article changes
  useEffect(() => { setMobileAiOpen(false); }, [article]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['article-summary', article?.id],
    queryFn: () => fetchArticleSummary(article!),
    enabled: !!article,
    staleTime: Infinity, // Cache per article — never refetch same article
  });

  const tagStyle = article ? (TAG_STYLES[article.cat] || TAG_STYLES.markets) : '';

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-[3px] z-[90] transition-opacity duration-250 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full z-[91] flex overflow-hidden border-l border-[var(--border)] bg-[var(--surface)] transition-transform duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: 'min(880px, 94vw)' }}
      >
        {/* Main content */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {article && (
            <>
              {/* Close button */}
              <button
                onClick={onClose}
                className="sticky top-4 float-right mr-4 mt-4 w-[34px] h-[34px] rounded-full bg-[var(--surface2)] border border-[var(--border)] flex items-center justify-center cursor-pointer text-[var(--muted)] hover:bg-[var(--surface3)] hover:text-[var(--text)] z-10"
              >
                ✕
              </button>

              <img
                src={article.img}
                alt={article.title}
                className="w-full h-[280px] object-cover block"
              />

              {/* Mobile-only AI Summary trigger */}
              <button
                onClick={() => setMobileAiOpen(v => !v)}
                className="hidden max-[980px]:flex items-center gap-[7px] mx-[40px] my-[18px] px-[15px] py-[9px] rounded-full bg-[rgba(91,79,232,0.14)] border border-[rgba(91,79,232,0.3)] text-[var(--indigo-light)] text-[12.5px] font-semibold w-fit"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
                AI Summary
              </button>

              <div className="px-[40px] pb-[60px] max-[980px]:px-[18px] max-[980px]:pb-[100px]">
                <span className={`inline-flex items-center w-fit font-mono text-[10.5px] font-semibold tracking-[0.6px] uppercase px-[9px] py-1 rounded-[5px] mb-[14px] ${tagStyle}`}>
                  {article.tagLabel}
                </span>
                <h1 className="font-syne text-[30px] font-bold leading-[1.25] mb-[14px] tracking-[-0.3px] text-[var(--text)] max-[980px]:text-[23px]">
                  {article.title}
                </h1>
                <div className="flex items-center gap-[10px] text-[12px] text-[var(--dim)] font-mono mb-6">
                  <span>{article.source}</span>
                  <span className="w-[3px] h-[3px] rounded-full bg-[var(--dim)]" />
                  <span>{article.time}</span>
                  <span className="w-[3px] h-[3px] rounded-full bg-[var(--dim)]" />
                  <span>4 min read</span>
                </div>
                <div className="space-y-[18px]">
                  {article.body.map((para, i) => (
                    <p key={i} className="text-[15px] leading-[1.85] text-[#cdd1e0]">{para}</p>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Desktop AI panel */}
        <div className="w-[300px] flex-shrink-0 border-l border-[var(--border)] bg-[var(--surface2)] overflow-y-auto max-[980px]:hidden">
          {article && <AiSummaryPanel isLoading={summaryLoading} data={summaryData} />}
        </div>

        {/* Mobile AI bottom sheet */}
        <div
          className={`hidden max-[980px]:block fixed bottom-0 left-0 right-0 bg-[var(--surface2)] border-t border-[var(--border)] rounded-t-[18px] z-[6] shadow-[0_-10px_40px_rgba(0,0,0,0.5)] transition-all duration-300 overflow-hidden ${mobileAiOpen ? 'h-[60vh] max-h-[78vh] py-5 px-5' : 'h-0 py-0 px-5'}`}
        >
          {article && <AiSummaryPanel isLoading={summaryLoading} data={summaryData} />}
        </div>
      </div>
    </>
  );
}
