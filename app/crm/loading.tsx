export default function CrmLoading() {
  return (
    <main className="relative z-10 mx-auto max-w-[1100px] px-4 py-8 sm:px-5">
      <div className="mb-5 h-8 w-48 animate-pulse rounded-lg bg-panel" />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-20 animate-pulse rounded-xl border border-edge bg-panel/50"
          />
        ))}
      </div>
      <div className="space-y-3">
        <div className="h-36 animate-pulse rounded-2xl border border-edge bg-panel/40" />
        <div className="h-28 animate-pulse rounded-xl border border-edge bg-panel/30" />
        <div className="h-28 animate-pulse rounded-xl border border-edge bg-panel/30" />
      </div>
      <p className="mt-5 text-center font-mono text-xs uppercase tracking-wider text-muted">
        Loading your CRM…
      </p>
    </main>
  );
}
