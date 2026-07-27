import { Link, useLocation } from 'wouter';
import { Settings, User } from 'lucide-react';
import { useCategory } from '../../lib/CategoryContext';
import { isEnterpriseUnlocked, getNextGateRoute } from '../../lib/enterpriseGate';

export function Topbar() {
  const [location, navigate] = useLocation();
  const { tier, setTier } = useCategory();

  const handleEnterprise = () => {
    setTier('Enterprise');
    navigate(isEnterpriseUnlocked() ? '/vera' : getNextGateRoute());
  };

  const handlePersonal = () => {
    setTier('Personal');
    navigate('/line');
  };

  return (
    <header className="sticky top-0 z-50 bg-[var(--bg)]/80 backdrop-blur-md border-b border-[var(--border)] h-16 flex items-center justify-between px-6">
      <div className="flex items-center gap-8">
        <Link href="/line" className="font-syne font-extrabold text-xl tracking-tight">
          Vera Nex<span className="text-[var(--mint)]">us</span>
        </Link>

        <nav className="flex items-center gap-1 font-medium text-sm">
          {[
            { href: '/line', label: 'Line' },
            { href: '/sight', label: 'Sight' },
            { href: '/crypt', label: 'Crypt' },
          ].map(tab => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-1.5 rounded-md transition-colors ${
                location === tab.href || (location === '/' && tab.href === '/line')
                  ? 'bg-[var(--surface2)] text-white'
                  : 'text-[var(--muted)] hover:text-white hover:bg-[var(--surface)]'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex bg-[var(--surface)] p-1 rounded-lg border border-[var(--border)]">
          <button
            onClick={handlePersonal}
            className={`px-3 py-1 text-xs font-bold rounded uppercase transition-colors ${tier === 'Personal' ? 'bg-[var(--indigo)] text-white' : 'text-[var(--muted)] hover:text-white'}`}
          >
            Personal
          </button>
          <button
            onClick={handleEnterprise}
            className={`px-3 py-1 text-xs font-bold rounded uppercase transition-colors ${tier === 'Enterprise' ? 'bg-[var(--mint)] text-black' : 'text-[var(--muted)] hover:text-white'}`}
          >
            Enterprise
          </button>
        </div>

        <div className="flex items-center gap-4 border-l border-[var(--border)] pl-6">
          <Link href="/settings" className="text-[var(--muted)] hover:text-white transition-colors">
            <Settings className="w-5 h-5" />
          </Link>
          <button className="flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-white transition-colors">
            <User className="w-5 h-5" />
            Sign in
          </button>
        </div>
      </div>
    </header>
  );
}
