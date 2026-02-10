export default function RunsPage() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-3xl font-bold mb-2">Runs</h2>
        <p className="text-[var(--muted)]">
          View and analyze past agentic loop executions.
        </p>
      </section>

      <div className="card">
        <div className="text-[var(--muted)] text-center py-16">
          <p className="text-4xl mb-4">📊</p>
          <p className="mb-2">No runs to display yet.</p>
          <p className="text-sm">
            Run data will appear here after you execute your first agentic loop.
          </p>
          <p className="text-sm mt-4">
            Run results are stored in{' '}
            <code className="px-1.5 py-0.5 bg-[var(--background)] rounded text-xs font-mono">
              .agentic-lab/runs/
            </code>
          </p>
        </div>
      </div>

      {/* Placeholder for future charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Token Usage Over Time</h3>
          <div className="h-48 flex items-center justify-center text-[var(--muted)] text-sm">
            Chart will render when data is available
          </div>
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Tool Call Distribution</h3>
          <div className="h-48 flex items-center justify-center text-[var(--muted)] text-sm">
            Chart will render when data is available
          </div>
        </div>
      </div>
    </div>
  );
}
