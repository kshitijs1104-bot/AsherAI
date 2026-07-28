import React from 'react';
import { Topbar } from './Topbar';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { useLocation } from 'wouter';

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  // Sight is a self-contained, full-width terminal view with its own watchlist —
  // collapse both global sidebars there so the feed uses the entire screen width.
  const isSight = location === '/sight';
  const showLeftSidebar = !isSight;
  const showRightSidebar = !['/vera', '/venus', '/settings', '/crypt', '/sight'].includes(location);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col dark">
      <Topbar />
      
      {/* Green Banner */}
      <div className="bg-[var(--surface2)] border-b border-[var(--border)] py-1.5 px-4 flex items-center justify-center text-xs font-mono text-[var(--mint)]">
        <span className="relative flex h-2 w-2 mr-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--mint)] opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--mint)]"></span>
        </span>
        Causal AI layer active — events annotated with causal chain analysis
      </div>

      <div className="flex flex-1 overflow-hidden">
        {showLeftSidebar && <LeftSidebar />}
        <main className="flex-1 overflow-y-auto relative">
          {children}
        </main>
        {showRightSidebar && <RightSidebar />}
      </div>
    </div>
  );
}
