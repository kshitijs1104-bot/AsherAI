const CATEGORIES = [
  { key: 'all', label: 'For You' },
  { key: 'markets', label: 'Markets' },
  { key: 'macro', label: 'Macro' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'global', label: 'Global' },
  { key: 'ipo', label: 'IPO' },
];

interface CategoryPillsProps {
  active: string;
  onChange: (cat: string) => void;
}

export function CategoryPills({ active, onChange }: CategoryPillsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto px-[22px] py-[14px] scrollbar-none [&::-webkit-scrollbar]:hidden">
      {CATEGORIES.map(({ key, label }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex-shrink-0 px-4 py-[7px] rounded-full text-[12.5px] font-medium border transition-all ${
              isActive
                ? 'bg-[var(--indigo)] border-[var(--indigo)] text-white shadow-[0_0_0_4px_rgba(91,79,232,0.14)]'
                : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--muted)]'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
