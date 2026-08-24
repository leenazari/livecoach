-- Cover the workspace foreign key independently from the user-first unread
-- feed index used by each salesperson.
create index crm_notifications_workspace_user_idx
  on public.crm_notifications (workspace_id, user_id);
