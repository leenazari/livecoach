import Link from 'next/link';

export default function SalesJourneySwitch({ active }: { active: 'leads' | 'pipeline' }) {
  return <nav aria-label="Sales journey" className="my-4 inline-flex rounded-xl border border-edge bg-panel p-1">
    {([['leads', '/crm/new-leads', 'New leads'], ['pipeline', '/crm/revenue', 'Pipeline']] as const).map(([key, href, label]) =>
      <Link key={key} href={href} aria-current={active === key ? 'page' : undefined} className={`rounded-lg px-4 py-2 text-sm ${active === key ? 'bg-amber/10 text-amber' : 'text-muted hover:text-bone'}`}>{label}</Link>)}
  </nav>;
}
