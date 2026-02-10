import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agentic Lab — Dashboard',
  description: 'Agentic loop experimentation platform dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <div className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

function Header() {
  return (
    <header className="border-b border-[var(--card-border)] bg-[var(--card)]">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🤖</span>
          <h1 className="text-xl font-bold">Agentic Lab</h1>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
            v0.1.0
          </span>
        </div>
        <nav className="flex items-center gap-6 text-sm">
          <a href="/" className="text-[var(--foreground)] hover:text-[var(--primary)]">
            Dashboard
          </a>
          <a href="/pipelines" className="text-[var(--muted)] hover:text-[var(--primary)]">
            Pipelines
          </a>
          <a href="/recipes" className="text-[var(--muted)] hover:text-[var(--primary)]">
            Recipes
          </a>
          <a href="/runs" className="text-[var(--muted)] hover:text-[var(--primary)]">
            Runs
          </a>
          <a href="/providers" className="text-[var(--muted)] hover:text-[var(--primary)]">
            Providers
          </a>
          <a href="/settings" className="text-[var(--muted)] hover:text-[var(--primary)]">
            Settings
          </a>
        </nav>
      </div>
    </header>
  );
}
