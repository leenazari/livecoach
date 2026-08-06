"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch } from "@/lib/crm";

type Duplicate = {
  id: string;
  reason: string;
  records: { id: string; name: string; updatedAt: string | null }[];
};

export default function DuplicateClients() {
  const [items, setItems] = useState<Duplicate[]>([]);

  useEffect(() => {
    crmFetch<{ duplicates: Duplicate[] }>("/api/crm/duplicates")
      .then((d) => setItems(d.duplicates || []))
      .catch(() => {});
  }, []);

  if (!items.length) return null;

  return (
    <div id="duplicates" className="mb-3 scroll-mt-4 rounded-xl border border-amber/45 bg-amber/[0.06] p-4">
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
        {"◇"} Possible duplicate clients · {items.length}
      </p>
      <p className="mt-1 font-sans text-[0.76rem] leading-snug text-bone/65">
        Review before adding more notes or calls. Nothing has been merged or deleted.
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-edge bg-ink/35 px-3 py-2">
            <p className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
              {item.reason}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {item.records.map((record, index) => (
                <span key={record.id} className="flex items-center gap-1.5">
                  {index > 0 ? <span className="text-muted">or</span> : null}
                  <Link
                    href={`/crm/${record.id}`}
                    className="font-sans text-sm text-bone underline decoration-edge underline-offset-2 transition hover:text-amber"
                  >
                    {record.name} ↗
                  </Link>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
