export default function CallLoading() {
  return (
    <main className="relative z-10 mx-auto max-w-[1180px] px-4 py-8 sm:px-5">
      <div className="mx-auto mb-7 h-9 w-56 animate-pulse rounded-lg bg-panel" />
      <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
        <div className="h-72 animate-pulse rounded-2xl border border-edge bg-panel/40" />
        <div className="h-72 animate-pulse rounded-2xl border border-edge bg-panel/30" />
      </div>
      <p className="mt-5 text-center font-mono text-xs uppercase tracking-wider text-muted">
        Loading call workspace…
      </p>
    </main>
  );
}
