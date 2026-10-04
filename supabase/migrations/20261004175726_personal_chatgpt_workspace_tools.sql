-- Expand existing receipt allowlists; retain all previous names and policies.
alter table public.mcp_action_receipts
  drop constraint mcp_action_receipts_tool_name_check,
  add constraint mcp_action_receipts_tool_name_check check (tool_name in (
    'find_my_lead','list_my_leads','add_lead','add_lead_context','create_my_follow_up','list_my_tasks',
    'list_my_work','get_my_work_record','create_my_task','update_my_task','save_my_campaign','save_my_marketing_lead','append_my_note','search_my_email','read_my_email'
  )),
  drop constraint mcp_action_receipts_target_table_check,
  add constraint mcp_action_receipts_target_table_check check (
    target_table is null or target_table in ('outreach_prospects','tasks','marketing_campaigns','marketing_leads','companies','contacts')
  );
