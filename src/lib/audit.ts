import { supabase } from './supabase'
import type { DashboardRole } from '../types'

interface LogAuditEventArgs {
  studentId: string
  actorUserId: string | null
  actorRole: DashboardRole | null
  action: string
  entityType?: string
  entityId?: string
  previousValue?: unknown
  newValue?: unknown
  reason?: string
  metadata?: Record<string, unknown>
}

export async function logAuditEvent(args: LogAuditEventArgs) {
  const { error } = await supabase.from('audit_events').insert({
    student_id: args.studentId,
    actor_user_id: args.actorUserId,
    actor_role: args.actorRole,
    action: args.action,
    entity_type: args.entityType ?? 'students',
    entity_id: args.entityId ?? args.studentId,
    previous_value: args.previousValue ?? null,
    new_value: args.newValue ?? null,
    reason: args.reason ?? null,
    metadata: args.metadata ?? null,
  })
  if (error) {
    console.error('Failed to write audit event', error)
  }
}
