-- Not applied. Do not run this on production until Lee approves it.
-- Adds a source marker so a website import can replace only its own notes.
-- Existing rows stay null. Null and owner rows are handwritten and are not deleted.

alter table public.interviewer_documents
  add column if not exists source text;

alter table public.interviewer_documents
  drop constraint if exists interviewer_documents_source_check;

alter table public.interviewer_documents
  add constraint interviewer_documents_source_check
  check (source is null or source in ('website-import', 'owner'));
