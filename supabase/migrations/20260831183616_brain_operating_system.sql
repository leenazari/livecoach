-- LiveCoach Brain operating system. The feature is intentionally additive and
-- internal-first. Routines can analyse and prepare internal work, but no row in
-- this model grants permission to send customer communication, create paid
-- media, perform a destructive action or publish learning without a person.

create table public.brain_sales_plays (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private'
    check (visibility in ('private', 'team')),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(slug) <= 80),
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 1200),
  trigger_summary text not null default '' check (length(trigger_summary) <= 600),
  steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 20),
  approval_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(approval_policy) = 'object'),
  version integer not null default 1 check (version between 1 and 10000),
  status text not null default 'active' check (status in ('active', 'archived')),
  is_system boolean not null default false,
  estimated_cost_gbp numeric(12, 6) not null default 0
    check (estimated_cost_gbp >= 0),
  hard_cost_cap_gbp numeric(12, 6) not null default 0
    check (hard_cost_cap_gbp >= 0 and hard_cost_cap_gbp >= estimated_cost_gbp),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, owner_id, slug, version)
);

create index brain_sales_plays_workspace_status_idx
  on public.brain_sales_plays (workspace_id, status, updated_at desc);
create index brain_sales_plays_owner_idx
  on public.brain_sales_plays (owner_id, updated_at desc);

create table public.brain_trust_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility = 'private'),
  action_kind text not null check (action_kind in (
    'read_and_analyse',
    'create_internal_draft',
    'update_internal_crm',
    'customer_communication',
    'paid_generation',
    'destructive_action',
    'shared_learning'
  )),
  mode text not null check (mode in ('auto', 'approval_required', 'blocked')),
  hard_locked boolean not null default false,
  reason text not null default '' check (length(reason) <= 800),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, owner_id, action_kind),
  check (
    action_kind not in (
      'customer_communication',
      'paid_generation',
      'destructive_action',
      'shared_learning'
    )
    or mode <> 'auto'
  ),
  check (
    action_kind <> 'destructive_action'
    or (mode = 'blocked' and hard_locked)
  )
);

create index brain_trust_rules_owner_idx
  on public.brain_trust_rules (workspace_id, owner_id, action_kind);

create table public.brain_routines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility = 'private'),
  play_id uuid,
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 1600),
  routine_kind text not null check (routine_kind in ('morning_sales_control')),
  schedule_mode text not null default 'manual'
    check (schedule_mode in ('manual', 'daily', 'weekdays')),
  scheduled_local_time time not null default '07:30:00',
  timezone text not null default 'Europe/London'
    check (timezone = 'Europe/London'),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  approval_mode text not null default 'review_required'
    check (approval_mode in ('review_required', 'auto_internal_only')),
  estimated_cost_gbp numeric(12, 6) not null default 0
    check (estimated_cost_gbp >= 0),
  hard_cost_cap_gbp numeric(12, 6) not null default 0
    check (hard_cost_cap_gbp >= 0 and hard_cost_cap_gbp >= estimated_cost_gbp),
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, owner_id),
  foreign key (play_id, workspace_id)
    references public.brain_sales_plays(id, workspace_id)
    on delete restrict
);

create index brain_routines_due_idx
  on public.brain_routines (status, next_run_at)
  where status = 'active' and next_run_at is not null;
create index brain_routines_owner_idx
  on public.brain_routines (workspace_id, owner_id, updated_at desc);
create index brain_routines_play_idx
  on public.brain_routines (play_id)
  where play_id is not null;

create table public.brain_routine_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility = 'private'),
  routine_id uuid not null,
  trigger_kind text not null check (trigger_kind in ('manual', 'scheduled')),
  idempotency_key text not null check (length(idempotency_key) between 8 and 240),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
  current_step integer not null default 0 check (current_step >= 0),
  total_steps integer not null default 5 check (total_steps between 1 and 20),
  progress_message text not null default 'Queued' check (length(progress_message) <= 500),
  input_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(input_snapshot) = 'object'),
  output jsonb not null default '{}'::jsonb
    check (jsonb_typeof(output) = 'object'),
  proposed_actions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(proposed_actions) = 'array' and jsonb_array_length(proposed_actions) <= 100),
  estimated_cost_gbp numeric(12, 6) not null default 0 check (estimated_cost_gbp >= 0),
  actual_cost_gbp numeric(12, 6) not null default 0 check (actual_cost_gbp >= 0),
  error text check (error is null or length(error) <= 1600),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, owner_id, idempotency_key),
  foreign key (routine_id, workspace_id, owner_id)
    references public.brain_routines(id, workspace_id, owner_id)
    on delete cascade
);

create index brain_routine_runs_owner_created_idx
  on public.brain_routine_runs (workspace_id, owner_id, created_at desc);
create index brain_routine_runs_routine_idx
  on public.brain_routine_runs (routine_id, created_at desc);
create index brain_routine_runs_active_idx
  on public.brain_routine_runs (workspace_id, status, updated_at desc)
  where status in ('queued', 'running', 'awaiting_approval');

create table public.brain_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private'
    check (visibility in ('private', 'team')),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(slug) <= 80),
  title text not null check (length(trim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  widgets jsonb not null default '[]'::jsonb
    check (jsonb_typeof(widgets) = 'array' and jsonb_array_length(widgets) between 1 and 20),
  status text not null default 'active' check (status in ('active', 'archived')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, owner_id, slug)
);

create unique index brain_pages_one_default_per_owner_idx
  on public.brain_pages (workspace_id, owner_id)
  where is_default and status = 'active';
create index brain_pages_workspace_status_idx
  on public.brain_pages (workspace_id, status, updated_at desc);
create index brain_pages_owner_idx
  on public.brain_pages (owner_id, updated_at desc);

create table public.brain_learnings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private'
    check (visibility in ('private', 'team')),
  status text not null default 'proposed' check (status in (
    'proposed',
    'approved_personal',
    'approved_team',
    'rejected',
    'superseded'
  )),
  source_kind text not null check (source_kind in (
    'manual', 'routine', 'team_chat', 'brain_confirmation', 'sales_outcome'
  )),
  source_ref text check (source_ref is null or length(source_ref) <= 500),
  instruction text not null check (length(trim(instruction)) between 1 and 2000),
  expected_impact text not null default '' check (length(expected_impact) <= 1200),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'approved_team' and visibility = 'team')
    or (status <> 'approved_team' and visibility = 'private')
  ),
  check (
    (status = 'proposed' and reviewed_at is null and reviewed_by_user_id is null)
    or (status <> 'proposed' and reviewed_at is not null and reviewed_by_user_id is not null)
  )
);

create index brain_learnings_owner_status_idx
  on public.brain_learnings (workspace_id, owner_id, status, updated_at desc);
create index brain_learnings_team_idx
  on public.brain_learnings (workspace_id, updated_at desc)
  where status = 'approved_team' and visibility = 'team';
create index brain_learnings_reviewer_idx
  on public.brain_learnings (reviewed_by_user_id)
  where reviewed_by_user_id is not null;

-- Composite uniqueness lets the new AI message table prove that a referenced
-- conversation and source message belong to the same workspace and thread.
create unique index if not exists crm_chat_conversations_id_workspace_uidx
  on public.crm_chat_conversations (id, workspace_id);
create unique index if not exists crm_chat_messages_id_conversation_workspace_uidx
  on public.crm_chat_messages (id, conversation_id, workspace_id);

-- Brain responses remain separate from human chat messages. This preserves the
-- human sender foreign key and makes AI output unmistakable in audits and UI.
create table public.crm_chat_brain_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  requested_by_user_id uuid not null references auth.users(id) on delete cascade,
  source_message_id uuid not null,
  body text not null default '' check (length(body) <= 5000),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  model text,
  estimated_cost_gbp numeric(12, 6) not null default 0 check (estimated_cost_gbp >= 0),
  actual_cost_gbp numeric(12, 6) not null default 0 check (actual_cost_gbp >= 0),
  error text check (error is null or length(error) <= 1600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (conversation_id, source_message_id),
  foreign key (conversation_id, workspace_id)
    references public.crm_chat_conversations(id, workspace_id)
    on delete cascade,
  foreign key (source_message_id, conversation_id, workspace_id)
    references public.crm_chat_messages(id, conversation_id, workspace_id)
    on delete cascade
);

create index crm_chat_brain_messages_conversation_idx
  on public.crm_chat_brain_messages (conversation_id, created_at desc);
create index crm_chat_brain_messages_requester_idx
  on public.crm_chat_brain_messages (requested_by_user_id, created_at desc);
create index crm_chat_brain_messages_status_idx
  on public.crm_chat_brain_messages (workspace_id, status, updated_at)
  where status in ('queued', 'running');

create or replace function public.brain_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger brain_sales_plays_touch_updated_at
  before update on public.brain_sales_plays
  for each row execute function public.brain_touch_updated_at();
create trigger brain_trust_rules_touch_updated_at
  before update on public.brain_trust_rules
  for each row execute function public.brain_touch_updated_at();
create trigger brain_routines_touch_updated_at
  before update on public.brain_routines
  for each row execute function public.brain_touch_updated_at();
create trigger brain_routine_runs_touch_updated_at
  before update on public.brain_routine_runs
  for each row execute function public.brain_touch_updated_at();
create trigger brain_pages_touch_updated_at
  before update on public.brain_pages
  for each row execute function public.brain_touch_updated_at();
create trigger brain_learnings_touch_updated_at
  before update on public.brain_learnings
  for each row execute function public.brain_touch_updated_at();
create trigger crm_chat_brain_messages_touch_updated_at
  before update on public.crm_chat_brain_messages
  for each row execute function public.brain_touch_updated_at();

alter table public.brain_sales_plays enable row level security;
alter table public.brain_trust_rules enable row level security;
alter table public.brain_routines enable row level security;
alter table public.brain_routine_runs enable row level security;
alter table public.brain_pages enable row level security;
alter table public.brain_learnings enable row level security;
alter table public.crm_chat_brain_messages enable row level security;

revoke all on public.brain_sales_plays from public, anon, authenticated;
revoke all on public.brain_trust_rules from public, anon, authenticated;
revoke all on public.brain_routines from public, anon, authenticated;
revoke all on public.brain_routine_runs from public, anon, authenticated;
revoke all on public.brain_pages from public, anon, authenticated;
revoke all on public.brain_learnings from public, anon, authenticated;
revoke all on public.crm_chat_brain_messages from public, anon, authenticated;

grant select, insert, update, delete on public.brain_sales_plays to authenticated;
grant select, insert, update, delete on public.brain_trust_rules to authenticated;
grant select, insert, update, delete on public.brain_routines to authenticated;
grant select on public.brain_routine_runs to authenticated;
grant select, insert, update, delete on public.brain_pages to authenticated;
grant select, insert, update, delete on public.brain_learnings to authenticated;
grant select on public.crm_chat_brain_messages to authenticated;

grant all on public.brain_sales_plays to service_role;
grant all on public.brain_trust_rules to service_role;
grant all on public.brain_routines to service_role;
grant all on public.brain_routine_runs to service_role;
grant all on public.brain_pages to service_role;
grant all on public.brain_learnings to service_role;
grant all on public.crm_chat_brain_messages to service_role;

-- Personal rows stay owner-only. A team play or live page is readable by active
-- workspace members only after its owner deliberately changes visibility.
create policy "Members read available Brain plays"
  on public.brain_sales_plays for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_sales_plays.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
    and (owner_id = (select auth.uid()) or visibility = 'team')
  );

create policy "Owners create Brain plays"
  on public.brain_sales_plays for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_sales_plays.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (brain_sales_plays.visibility = 'private' or wm.role in ('owner', 'manager'))
    )
  );

create policy "Owners update Brain plays"
  on public.brain_sales_plays for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_sales_plays.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (brain_sales_plays.visibility = 'private' or wm.role in ('owner', 'manager'))
    )
  );

create policy "Owners delete Brain plays"
  on public.brain_sales_plays for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owners manage Brain trust rules"
  on public.brain_trust_rules for all to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_trust_rules.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_trust_rules.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create policy "Owners manage Brain routines"
  on public.brain_routines for all to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_routines.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_routines.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create policy "Owners read Brain routine runs"
  on public.brain_routine_runs for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_routine_runs.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create policy "Members read available Brain pages"
  on public.brain_pages for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_pages.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
    and (owner_id = (select auth.uid()) or visibility = 'team')
  );

create policy "Owners create Brain pages"
  on public.brain_pages for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_pages.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (brain_pages.visibility = 'private' or wm.role in ('owner', 'manager'))
    )
  );

create policy "Owners update Brain pages"
  on public.brain_pages for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_pages.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (brain_pages.visibility = 'private' or wm.role in ('owner', 'manager'))
    )
  );

create policy "Owners delete Brain pages"
  on public.brain_pages for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "Members read available Brain learnings"
  on public.brain_learnings for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_learnings.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
    and (
      owner_id = (select auth.uid())
      or (visibility = 'team' and status = 'approved_team')
    )
  );

create policy "Owners create Brain learning proposals"
  on public.brain_learnings for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and visibility = 'private'
    and status = 'proposed'
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_learnings.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create policy "Owners review Brain learning proposals"
  on public.brain_learnings for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = brain_learnings.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (brain_learnings.status <> 'approved_team' or wm.role in ('owner', 'manager'))
    )
  );

create policy "Owners delete Brain learnings"
  on public.brain_learnings for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "Conversation members read Brain chat messages"
  on public.crm_chat_brain_messages for select to authenticated
  using (
    exists (
      select 1
      from public.crm_chat_conversation_members cm
      join public.workspace_members wm
        on wm.workspace_id = cm.workspace_id
       and wm.user_id = cm.user_id
       and wm.status = 'active'
      where cm.conversation_id = crm_chat_brain_messages.conversation_id
        and cm.workspace_id = crm_chat_brain_messages.workspace_id
        and cm.user_id = (select auth.uid())
    )
  );

-- Browser clients cannot create or mutate runs or Brain chat output. Verified
-- server code must bind one exact workspace and owner for those operations.
create policy "No browser writes to Brain routine runs"
  on public.brain_routine_runs for all to authenticated
  using (false)
  with check (false);

create policy "No browser writes to Brain chat messages"
  on public.crm_chat_brain_messages for all to authenticated
  using (false)
  with check (false);
