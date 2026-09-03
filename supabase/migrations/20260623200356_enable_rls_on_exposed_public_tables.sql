-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

ALTER TABLE public.workspace_profile  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_priority   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upcoming_calls     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_oauth       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaching_points    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_cache           ENABLE ROW LEVEL SECURITY;
