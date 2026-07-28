import type { NewsArticle } from '../../lib/sight-data';

const TAG_STYLES: Record<string, string> = {
  markets:  'bg-[rgba(91,79,232,0.14)] text-[var(--indigo-light)]',
  macro:    'bg-[rgba(0,229,176,0.14)] text-[var(--mint)]',
  earnings: 'bg-[rgba(240,168,58,0.14)] text-[var(--amber)]',
  global:   'bg-[rgba(240,94,94,0.14)] text-[var(--red)]',
  ipo:      'bg-[rgba(167,139,250,0.14)] text-[#b9a4ff]',
};

interface NewsCardProps {
  article: NewsArticle;
  onClick: () => void;
  animDelay?: number;
}

export function HeroCard({ article, onClick }: { article: NewsArticle; onClick: () => void }) {
  const tagStyle = TAG_STYLES[article.cat] || TAG_STYLES.markets;

  return (
    <div
      onClick={onClick}
      className="grid grid-cols-[1.15fr_1fr] bg-[var(--surface)] border border-[var(--border)] rounded-[14px] overflow-hidden cursor-pointer transition-all duration-200 hover:border-[var(--indigo)] hover:-translate-y-0.5 animate-[sight-rise_0.6s_ease_forwards] opacity-0 max-[640px]:grid-cols-1"
      style={{ animationDelay: '0.05s' } as React.CSSProperties}
    >
      <div className="relative min-h-[280px] overflow-hidden max-[640px]:min-h-[190px]">
        <img
          src={article.img}
          alt={article.title}
          className="w-full h-full object-cover block transition-transform duration-500 group-hover:scale-[1.04]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[var(--surface)]" />
      </div>
      <div className="p-[26px_28px_24px] flex flex-col gap-3 max-[640px]:p-[18px_18px_18px]">
        <span className={`inline-flex items-center w-fit font-mono text-[10.5px] font-semibold tracking-[0.6px] uppercase px-[9px] py-1 rounded-[5px] ${tagStyle}`}>
          {article.tagLabel}
        </span>
        <h2 className="font-syne font-bold text-[25px] leading-[1.25] tracking-[-0.2px] text-[var(--text)] max-[640px]:text-[20px]">
          {article.title}
        </h2>
        <p className="text-[var(--muted)] text-[14px] leading-[1.6]">{article.blurb}</p>
        <div className="flex items-center gap-[10px] text-[11.5px] text-[var(--dim)] font-mono mt-auto pt-[6px]">
          <span>{article.source}</span>
          <span className="w-[3px] h-[3px] rounded-full bg-[var(--dim)]" />
          <span>{article.time}</span>
          <span className="w-[3px] h-[3px] rounded-full bg-[var(--dim)]" />
          <span>4 min read</span>
        </div>
      </div>
    </div>
  );
}

export function NewsCard({ article, onClick, animDelay = 0 }: NewsCardProps) {
  const tagStyle = TAG_STYLES[article.cat] || TAG_STYLES.markets;

  return (
    <div
      onClick={onClick}
      className="flex gap-[14px] bg-[var(--surface)] border border-[var(--border)] rounded-[14px] p-[14px] cursor-pointer transition-all duration-200 hover:border-[var(--muted)] hover:-translate-y-0.5 hover:bg-[var(--surface2)] animate-[sight-rise_0.5s_ease_forwards] opacity-0"
      style={{ animationDelay: `${animDelay}s` } as React.CSSProperties}
    >
      <div className="w-24 h-24 rounded-[9px] overflow-hidden flex-shrink-0 bg-[var(--surface3)]">
        <img src={article.img} alt={article.title} className="w-full h-full object-cover block" />
      </div>
      <div className="flex flex-col gap-[7px] min-w-0">
        <span className={`inline-flex items-center w-fit font-mono text-[10.5px] font-semibold tracking-[0.6px] uppercase px-[9px] py-0.5 rounded-[5px] ${tagStyle}`}>
          {article.tagLabel}
        </span>
        <h3 className="font-syne text-[14.5px] font-bold leading-[1.32] tracking-[-0.1px] text-[var(--text)] line-clamp-2">
          {article.title}
        </h3>
        <div className="flex items-center gap-[8px] text-[10.5px] text-[var(--dim)] font-mono">
          <span>{article.source}</span>
          <span className="w-[3px] h-[3px] rounded-full bg-[var(--dim)]" />
          <span>{article.time}</span>
        </div>
      </div>
    </div>
  );
}
