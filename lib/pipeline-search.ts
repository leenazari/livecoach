// Filter only the rows already authorised by the pipeline owner/visibility rules.
// Never search hidden attributes or trigger a wider company lookup.
export function matchesPipelineSearch(row: { company?: string; title?: string; next_action?: string | null; nextAction?: string }, query: string): boolean {
  const normalise = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const terms = normalise(query.trim()).split(/\s+/).filter(Boolean);
  const searchable = normalise([row.company, row.title, row.next_action || row.nextAction].filter(Boolean).join(' '));
  return terms.every(term => searchable.includes(term));
}
