export type DashboardRole = 'administrator' | 'operational' | 'read_only' | 'automation'

export const APPLICATION_STATUSES = [
  'Application Submitted',
  'Under Review',
  'Information Requested',
  'Approved',
  'Rejected',
  'Closed',
] as const

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

export const PAYMENT_STATUSES = ['NOT_REQUIRED', 'AWAITING_PAYMENT', 'PAYMENT_RECEIVED', 'PAYMENT_ISSUE'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const ACCOMMODATION_ROUTES = ['UNIVERSITY', 'PRIVATE', 'PBSA'] as const
export type AccommodationRoute = (typeof ACCOMMODATION_ROUTES)[number]

export const ACCOMMODATION_STATUSES = ['OUTSTANDING', 'REQUIRES_REVIEW', 'CLEARED_TO_PROCEED', 'COMPLETE'] as const
export type AccommodationStatus = (typeof ACCOMMODATION_STATUSES)[number]

export const FORM_REVIEW_STATUSES = ['OUTSTANDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'INFO_REQUESTED'] as const
export type FormReviewStatus = (typeof FORM_REVIEW_STATUSES)[number]

export const REACH_STATUSES = ['NOT_READY', 'READY', 'INVITATION_SENT', 'BOOKED', 'ATTENDED', 'NOT_ATTENDED'] as const
export type ReachStatus = (typeof REACH_STATUSES)[number]

export interface Student {
  student_id: string
  case_id: string | null
  university_student_id: string | null
  first_name: string | null
  last_name: string | null
  english_name: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  dob: string | null
  gender: string | null
  nationality: string | null
  passport_number: string | null
  passport_expiry: string | null
  university: string | null
  course_title: string | null
  course_start_date: string | null
  application_status: ApplicationStatus | string
  overall_registration_status: string
  next_action: string | null
  next_action_owner: string | null
  application_decision_reason: string | null
  application_reviewed_by: string | null
  application_reviewed_at: string | null
  payment_status: PaymentStatus | string
  payment_received_at: string | null
  payment_recorded_by: string | null
  payment_notes: string | null
  agreement_completed: boolean
  conduct_completed: boolean
  medical_completed: boolean
  accommodation_completed: boolean
  agreement_review_status: FormReviewStatus | string
  agreement_reviewed_by: string | null
  agreement_reviewed_at: string | null
  agreement_notes: string | null
  conduct_review_status: FormReviewStatus | string
  conduct_reviewed_by: string | null
  conduct_reviewed_at: string | null
  conduct_notes: string | null
  medical_review_status: FormReviewStatus | string
  medical_reviewed_by: string | null
  medical_reviewed_at: string | null
  medical_notes: string | null
  accommodation_route: AccommodationRoute | string | null
  accommodation_status: AccommodationStatus | string
  accommodation_reviewed_by: string | null
  accommodation_reviewed_at: string | null
  accommodation_notes: string | null
  outlook_folder_created: boolean
  outlook_folder_created_at: string | null
  last_reminder_sent_at: string | null
  reminder_count: number
  next_reminder_at: string | null
  reach_status: ReachStatus | string
  reach_invitation_sent_at: string | null
  reach_booking_at: string | null
  reach_meeting_at: string | null
  reach_attendance_confirmed_at: string | null
  reach_attendance_confirmed_by: string | null
  registration_complete: boolean
  registration_completed_at: string | null
  registration_completed_by: string | null
  current_workflow: string | null
  created_at: string
  updated_at: string
}

export interface ApplicationFormRecord {
  id: string
  student_id: string
  passport_upload: unknown
  guardianship_level: string | null
  payment_frequency: string | null
  payment_method: string | null
  signature: unknown
  raw_submission: Record<string, unknown> | null
  raw_json: unknown
  submitted_at: string
}

export interface AgreementFormRecord {
  id: string
  student_id: string
  accepted: boolean | null
  signature: unknown
  signed_date: string | null
  raw_submission: Record<string, unknown> | null
  submitted_at: string
}

export type ConductFormRecord = AgreementFormRecord

export interface MedicalFormRecord {
  id: string
  student_id: string
  allergies: string | null
  medical_conditions: string | null
  medications: string | null
  dietary_requirements: string | null
  emergency_contact: unknown
  vaccinations: unknown
  otc_permissions: unknown
  signature: unknown
  raw_submission: Record<string, unknown> | null
  submitted_at: string
}

export interface AccommodationFormRecord {
  id: string
  student_id: string
  accommodation_type: string | null
  accommodation_name: string | null
  accommodation_address: unknown
  university: string | null
  campus_address: unknown
  tenancy_start: string | null
  evidence: unknown
  guardian_check_required: boolean | null
  signature: unknown
  raw_submission: Record<string, unknown> | null
  submitted_at: string
}

export interface ParentRecord {
  id: string
  student_id: string
  parent_number: number | null
  salutation: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  occupation: string | null
  relationship: string | null
  created_at: string
}

export interface EmailTemplate {
  id: string
  code: string
  name: string
  subject: string
  body: string
  version: number
  active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface EmailLogEntry {
  id: string
  student_id: string | null
  template_code: string | null
  template_version: number | null
  recipient: string
  subject: string
  body: string
  sender: string | null
  status: 'queued' | 'sent' | 'failed'
  triggered_by: string | null
  message_id: string | null
  metadata: unknown
  created_at: string
  sent_at: string | null
}

export interface AuditEvent {
  id: string
  student_id: string | null
  actor_user_id: string | null
  actor_role: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  previous_value: unknown
  new_value: unknown
  reason: string | null
  metadata: unknown
  created_at: string
}
