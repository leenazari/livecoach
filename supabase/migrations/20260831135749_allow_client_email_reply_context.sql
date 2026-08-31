-- Email replies are first-class CRM timeline activity. The application has
-- written this kind since the client email monitor shipped, so keep the
-- database constraint aligned with the canonical activity model.
alter table public.client_context
  drop constraint if exists client_context_kind_check;

alter table public.client_context
  add constraint client_context_kind_check
  check (kind in ('note', 'link', 'doc', 'email_reply'));
