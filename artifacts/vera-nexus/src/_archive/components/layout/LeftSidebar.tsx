import { useCategory } from '../../lib/CategoryContext';

const DOT_COLORS: Record<string, string> = {
  all: 'var(--text)',
  technology: 'var(--indigo)',
  finance: 'var(--green)',
  markets: 'var(--amber)',
  health: 'var(--red)',
};

export function LeftSidebar() {
  const { category, setCategory } = useCategory();

  const categories = ['all', 'technology', 'finance', 'markets', 'health'];

  return (
    <aside className="w-[200px] border-r border-[var(--border)] bg-[var(--surface)] flex flex-col p-4 shrink-0">
      <div className="mb-8">
        <h3 className="text-xs font-bold text-[var(--dim)] uppercase tracking-wider mb-3">Feeds</h3>
        <ul className="space-y-1">
          {categories.map(cat => (
            <li key={cat}>
              <button
                onClick={() => setCategory(cat as any)}
                className={`w-full flex items-center gap-3 px-2 py-1.5 rounded text-sm transition-colors ${
                  category === cat ? 'bg-[var(--surface2)] text-white' : 'text-[var(--muted)] hover:bg-[var(--surface2)] hover:text-white'
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: DOT_COLORS[cat] }}></span>
                <span className="capitalize">{cat === 'all' ? 'All Topics' : cat}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-xs font-bold text-[var(--dim)] uppercase tracking-wider mb-3">Saved</h3>
        <ul className="space-y-1">
          <li>
            <button className="w-full text-left px-2 py-1.5 rounded text-sm text-[var(--muted)] hover:bg-[var(--surface2)] hover:text-white transition-colors">
              Bookmarks
            </button>
          </li>
          <li>
            <button className="w-full text-left px-2 py-1.5 rounded text-sm text-[var(--muted)] hover:bg-[var(--surface2)] hover:text-white transition-colors">
              Notes
            </button>
          </li>
        </ul>
      </div>
    </aside>
  );
}
