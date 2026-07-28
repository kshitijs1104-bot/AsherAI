import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { NewsArticle } from '../../lib/sight-data';

interface StoryRailProps {
  articles: NewsArticle[];
  onSelectStory: (index: number) => void;
  activeIndex?: number;
}

export function StoryRail({ articles, onSelectStory, activeIndex }: StoryRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = 300;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  };

  const articlesWithStories = articles.filter(a => a.slides && a.slides.length > 0);

  if (articlesWithStories.length === 0) return null;

  return (
    <div className="px-[22px] py-4 border-b border-[var(--border)] bg-[var(--surface2)]/30">
      <div className="text-[9px] font-mono text-[var(--mint)] uppercase tracking-widest mb-3">Stories</div>
      <div className="relative group">
        {/* Left scroll button */}
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1.5 bg-black/40 hover:bg-black/70 rounded transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Scroll left"
        >
          <ChevronLeft className="w-4 h-4 text-white" />
        </button>

        {/* Horizontal scroll container */}
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scrollbar-hide"
        >
          {articlesWithStories.map((article, idx) => (
            <button
              key={article.id}
              onClick={() => onSelectStory(articles.indexOf(article))}
              className={`relative shrink-0 transition-all ${
                activeIndex === articles.indexOf(article) ? 'ring-2 ring-[var(--mint)]' : 'hover:opacity-80'
              }`}
            >
              {/* Circular thumbnail */}
              <div className="w-20 h-20 rounded-full overflow-hidden border border-[var(--border)] bg-[var(--surface2)]">
                <img
                  src={article.img}
                  alt={article.title}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Category badge */}
              <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-[var(--indigo)] border border-[var(--border)] flex items-center justify-center">
                <span className="text-[8px] font-mono font-bold text-white">
                  {article.tagLabel.charAt(0)}
                </span>
              </div>

              {/* Viewed indicator */}
              <div className="absolute top-0 left-0 w-1 h-1 rounded-full bg-[var(--mint)]" />
            </button>
          ))}
        </div>

        {/* Right scroll button */}
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1.5 bg-black/40 hover:bg-black/70 rounded transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Scroll right"
        >
          <ChevronRight className="w-4 h-4 text-white" />
        </button>
      </div>
    </div>
  );
}
