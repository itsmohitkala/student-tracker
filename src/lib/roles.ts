import type { DashboardRole } from '../types'

export const ROLE_LABELS: Record<DashboardRole, string> = {
  administrator: 'Administrator / Leadership',
  operational: 'AGUK Operational User',
  read_only: 'Read Only',
  automation: 'Automation / System',
}

export const ASSIGNABLE_ROLES: DashboardRole[] = ['administrator', 'operational', 'read_only']

export function roleLabel(role: string | null | undefined) {
  if (!role) return 'No role assigned'
  return ROLE_LABELS[role as DashboardRole] ?? role
}
