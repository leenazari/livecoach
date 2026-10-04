import 'server-only';
import { requireRequestScope } from '@/lib/request-scope';
import { supabaseAdmin, supabaseService } from '@/lib/supabase';
export async function marketingScope(manage = false) {
  const scope = requireRequestScope();
  if (scope.status !== 'active') throw new Error('Active workspace access is required');
  const { data, error } = await supabaseAdmin.from('workspace_members').select('department').eq('workspace_id', scope.workspaceId).eq('user_id', scope.userId).single();
  if (error) throw error;
  const canManage = scope.role === 'owner' || scope.role === 'manager' || data.department === 'marketing';
  if (manage && !canManage) throw new Error('Marketing or workspace manager access is required');
  return { ...scope, canManage };
}
// Directory is deliberately limited to active workspace members and display names.
export async function marketingDirectory(workspaceId: string) {
  const { data: members, error } = await supabaseService.from('workspace_members').select('user_id,role,department').eq('workspace_id', workspaceId).eq('status', 'active');
  if (error) throw error;
  const sales = (members || []).filter(row => row.department !== 'marketing');
  if (!sales.length) return [];
  const { data: profiles, error: profileError } = await supabaseService.from('profiles').select('user_id,display_name').in('user_id', sales.map(row => row.user_id));
  if (profileError) throw profileError;
  return sales.map(row => ({ userId: row.user_id as string, name: String(profiles?.find(p => p.user_id === row.user_id)?.display_name || 'Team member') }));
}
