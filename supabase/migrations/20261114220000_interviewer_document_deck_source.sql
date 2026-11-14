-- Allows brochure-only deck notes to be marked separately from owner notes
-- and website imports. Existing rows are not changed. deck-import rows are
-- the only ones a later deck sync may replace.

alter table public.interviewer_documents
  drop constraint if exists interviewer_documents_source_check;

alter table public.interviewer_documents
  add constraint interviewer_documents_source_check
  check (source is null or source in ('website-import', 'owner', 'deck-import'));
