import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth, canMutate } from '../lib/AuthContext'
import { logAuditEvent } from '../lib/audit'
import { mergeTemplate } from '../lib/mergeTemplate'
import {
  sendEmailViaN8n,
  sendReachInvitationViaN8n,
  sendFinalRegistrationViaN8n,
  sendPaymentConfirmationViaN8n,
} from '../lib/sendEmail'
import { StatusBadge } from '../components/StatusBadge'
import { Modal } from '../components/Modal'
import { Card } from '../components/Card'
import { StageTracker } from '../components/StageTracker'
import { FilloutAnswers } from '../components/FilloutAnswers'
import { Button } from '../components/Button'
import { FormReviewCard, FORM_STATUS_LABELS, FORM_STATUS_TONES } from '../components/FormReviewCard'
import { StatusPill } from '../components/StatusPill'
import { roleLabel } from '../lib/roles'
import type {
  AccommodationFormRecord,
  AgreementFormRecord,
  ApplicationFormRecord,
  AuditEvent,
  ConductFormRecord,
  EmailLogEntry,
  EmailTemplate,
  MedicalFormRecord,
  ParentRecord,
  Student,
} from '../types'

type FormKey = 'agreement' | 'conduct' | 'medical'

const FORM_META: Record<FormKey, { title: string; statusCol: keyof Student; reviewedByCol: keyof Student; reviewedAtCol: keyof Student; notesCol: keyof Student }> = {
  agreement: {
    title: 'University Agreement',
    statusCol: 'agreement_review_status',
    reviewedByCol: 'agreement_reviewed_by',
    reviewedAtCol: 'agreement_reviewed_at',
    notesCol: 'agreement_notes',
  },
  conduct: {
    title: 'Student Code of Conduct',
    statusCol: 'conduct_review_status',
    reviewedByCol: 'conduct_reviewed_by',
    reviewedAtCol: 'conduct_reviewed_at',
    notesCol: 'conduct_notes',
  },
  medical: {
    title: 'Medical Form',
    statusCol: 'medical_review_status',
    reviewedByCol: 'medical_reviewed_by',
    reviewedAtCol: 'medical_reviewed_at',
    notesCol: 'medical_notes',
  },
}

type ActionKind = 'approve' | 'info' | 'reject' | null

function prettify(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.join(', ')
    } catch {
      // not valid JSON — fall through and show the raw string
    }
  }
  return value
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`mt-0.5 text-sm ${value ? 'text-ink-900' : 'text-ink-400'}`}>{value ? prettify(value) : 'Null'}</p>
    </div>
  )
}

function initials(first: string | null, last: string | null) {
  const a = first?.trim()?.[0] ?? ''
  const b = last?.trim()?.[0] ?? ''
  return (a + b || '?').toUpperCase()
}

function isUrlLike(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function buildStages(student: Student) {
  const status = student.application_status
  const approved = status === 'Approved'
  const rejected = status === 'Rejected' || status === 'Closed'
  const paymentReceived = student.payment_status === 'PAYMENT_RECEIVED'
  const paymentIssue = student.payment_status === 'PAYMENT_ISSUE'

  return [
    { label: 'Application', detail: 'Submitted by student/family', state: 'complete' as const },
    {
      label: 'Admin Review',
      detail: rejected ? 'Rejected / closed' : approved ? 'Approved' : 'Awaiting AGUK decision',
      state: rejected ? ('attention' as const) : approved ? ('complete' as const) : ('current' as const),
    },
    {
      label: 'Payment',
      detail: paymentReceived
        ? 'Received'
        : paymentIssue
          ? 'Payment issue — needs attention'
          : approved
            ? 'Awaiting payment confirmation'
            : 'Not started',
      state: paymentReceived
        ? ('complete' as const)
        : paymentIssue
          ? ('attention' as const)
          : approved
            ? ('current' as const)
            : ('waiting' as const),
    },
    (() => {
      const formsDone = [
        student.agreement_completed,
        student.conduct_completed,
        student.medical_completed,
        student.accommodation_completed,
      ].filter(Boolean).length
      return {
        label: 'Registration Requirements',
        detail: paymentReceived
          ? `${formsDone}/4 complete — Agreement, Conduct, Medical, Accommodation (any order)`
          : 'Not started',
        state: !paymentReceived
          ? ('waiting' as const)
          : formsDone === 4
            ? ('complete' as const)
            : ('current' as const),
      }
    })(),
    (() => {
      const reach = student.reach_status
      const labels: Record<string, string> = {
        NOT_READY: 'Not started',
        READY: 'Ready to invite',
        INVITATION_SENT: 'Invitation sent — awaiting booking',
        BOOKED: 'Booked',
        ATTENDED: 'Attended',
        NOT_ATTENDED: 'Not attended',
      }
      return {
        label: 'REACH',
        detail: labels[reach] ?? 'Introductory meeting',
        state:
          reach === 'ATTENDED'
            ? ('complete' as const)
            : reach === 'NOT_ATTENDED'
              ? ('attention' as const)
              : reach === 'READY' || reach === 'INVITATION_SENT' || reach === 'BOOKED'
                ? ('current' as const)
                : ('waiting' as const),
      }
    })(),
    {
      label: 'Registration Complete',
      detail: student.registration_complete ? 'Complete' : 'Final AGUK confirmation',
      state: student.registration_complete ? ('complete' as const) : ('waiting' as const),
    },
  ]
}

async function queueInfoRequestEmail(
  student: Student,
  reason: string,
  triggeredBy: string | null,
  selectedTemplate?: EmailTemplate | null,
) {
  if (!student.email) return

  let templateRow: EmailTemplate | null = selectedTemplate ?? null
  if (selectedTemplate === undefined) {
    const { data: template } = await supabase
      .from('email_templates')
      .select('*')
      .eq('code', 'FURTHER_INFO_REQUIRED')
      .eq('active', true)
      .maybeSingle()
    templateRow = template as EmailTemplate | null
  }
  const variables = {
    first_name: student.first_name,
    case_id: student.case_id,
    university: student.university,
    reason,
  }

  const subject = templateRow
    ? mergeTemplate(templateRow.subject, variables)
    : `AGUK Application ${student.case_id ?? ''} — Further Information Required`
  const body = templateRow
    ? mergeTemplate(templateRow.body, variables)
    : `Dear ${student.first_name ?? ''},\n\n${reason}\n\nKind regards,\nAcademic Guardians UK`

  const { data: logRow } = await supabase
    .from('email_log')
    .insert({
      student_id: student.student_id,
      template_code: templateRow?.code ?? null,
      template_version: templateRow?.version ?? null,
      recipient: student.email,
      subject,
      body,
      status: 'queued',
      triggered_by: triggeredBy,
    })
    .select()
    .maybeSingle()

  const result = await sendEmailViaN8n({
    to: student.email,
    subject,
    body,
    student_id: student.student_id,
    case_id: student.case_id,
    template_code: templateRow?.code ?? null,
    template_version: templateRow?.version ?? null,
  })

  if (logRow) {
    await supabase
      .from('email_log')
      .update({
        status: result.ok ? 'sent' : 'failed',
        sent_at: result.ok ? new Date().toISOString() : null,
        metadata: result.ok ? null : { error: result.error },
      })
      .eq('id', logRow.id)
  }
}

const EDITABLE_STUDENT_FIELDS = [
  'first_name',
  'last_name',
  'english_name',
  'email',
  'phone',
  'whatsapp',
  'dob',
  'gender',
  'nationality',
  'passport_number',
  'passport_expiry',
  'university',
  'course_title',
  'course_start_date',
  'university_student_id',
] as const

type EditableField = (typeof EDITABLE_STUDENT_FIELDS)[number]

export function ApplicationDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, role } = useAuth()

  const [student, setStudent] = useState<Student | null>(null)
  const [applicationForm, setApplicationForm] = useState<ApplicationFormRecord | null>(null)
  const [parents, setParents] = useState<ParentRecord[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [emailLog, setEmailLog] = useState<EmailLogEntry[]>([])
  const [agreementForm, setAgreementForm] = useState<AgreementFormRecord | null>(null)
  const [conductForm, setConductForm] = useState<ConductFormRecord | null>(null)
  const [medicalForm, setMedicalForm] = useState<MedicalFormRecord | null>(null)
  const [accommodationForm, setAccommodationForm] = useState<AccommodationFormRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reminderSubmitting, setReminderSubmitting] = useState(false)

  const [reviewAction, setReviewAction] = useState<{ form: FormKey; decision: 'approve' | 'reject' | 'info' } | null>(
    null,
  )
  const [reviewNote, setReviewNote] = useState('')
  const [reviewTemplateCode, setReviewTemplateCode] = useState('')
  const [reviewSubmitting, setReviewSubmitting] = useState(false)

  const [templates, setTemplates] = useState<EmailTemplate[]>([])

  const [activeAction, setActiveAction] = useState<ActionKind>(null)
  const [reason, setReason] = useState('')
  const [infoTemplateCode, setInfoTemplateCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const [paymentAction, setPaymentAction] = useState<'received' | 'issue' | null>(null)
  const [paymentNote, setPaymentNote] = useState('')
  const [paymentSubmitting, setPaymentSubmitting] = useState(false)

  const [accommodationAction, setAccommodationAction] = useState<'cleared' | 'info_required' | null>(null)
  const [accommodationNote, setAccommodationNote] = useState('')
  const [accommodationTemplateCode, setAccommodationTemplateCode] = useState('')
  const [accommodationSubmitting, setAccommodationSubmitting] = useState(false)

  const [composeOpen, setComposeOpen] = useState(false)
  const [composeTemplateCode, setComposeTemplateCode] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeSubmitting, setComposeSubmitting] = useState(false)

  const [reachSubmitting, setReachSubmitting] = useState(false)
  const [reachAttendanceAction, setReachAttendanceAction] = useState<'attended' | 'not_attended' | null>(null)
  const [finalRegAction, setFinalRegAction] = useState(false)
  const [finalRegSubmitting, setFinalRegSubmitting] = useState(false)

  const [editingDetails, setEditingDetails] = useState(false)
  const [editForm, setEditForm] = useState<Record<EditableField, string>>({} as Record<EditableField, string>)
  const [editSubmitting, setEditSubmitting] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  const [resettingStage, setResettingStage] = useState<string | null>(null)
  const [simulatingStage, setSimulatingStage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    const [studentRes, formRes, parentsRes, auditRes, emailRes, templatesRes, agreementRes, conductRes, medicalRes, accommodationRes] =
      await Promise.all([
        supabase.from('students').select('*').eq('student_id', id).maybeSingle(),
        supabase.from('application_form').select('*').eq('student_id', id).maybeSingle(),
        supabase.from('parents').select('*').eq('student_id', id).order('parent_number'),
        supabase.from('audit_events').select('*').eq('student_id', id).order('created_at', { ascending: false }),
        supabase.from('email_log').select('*').eq('student_id', id).order('created_at', { ascending: false }),
        supabase.from('email_templates').select('*').eq('active', true).order('name'),
        supabase.from('agreement_form').select('*').eq('student_id', id).maybeSingle(),
        supabase.from('conduct_form').select('*').eq('student_id', id).maybeSingle(),
        supabase.from('medical_form').select('*').eq('student_id', id).maybeSingle(),
        supabase.from('accommodation_form').select('*').eq('student_id', id).maybeSingle(),
      ])

    if (studentRes.error) setError(studentRes.error.message)
    setStudent((studentRes.data as Student) ?? null)
    setApplicationForm((formRes.data as ApplicationFormRecord) ?? null)
    setParents((parentsRes.data as ParentRecord[]) ?? [])
    setAuditEvents((auditRes.data as AuditEvent[]) ?? [])
    setEmailLog((emailRes.data as EmailLogEntry[]) ?? [])
    setTemplates((templatesRes.data as EmailTemplate[]) ?? [])
    setAgreementForm((agreementRes.data as AgreementFormRecord) ?? null)
    setConductForm((conductRes.data as ConductFormRecord) ?? null)
    setMedicalForm((medicalRes.data as MedicalFormRecord) ?? null)
    setAccommodationForm((accommodationRes.data as AccommodationFormRecord) ?? null)
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  async function submitAction() {
    if (!student || !id) return
    setSubmitting(true)

    try {
      let update: Partial<Student> = {}
      let action = ''

      if (activeAction === 'approve') {
        update = {
          application_status: 'Approved',
          overall_registration_status: 'Awaiting AGUK',
          payment_status: 'AWAITING_PAYMENT',
          next_action: 'AGUK - Send/Record Payment Request',
          next_action_owner: 'AGUK',
          application_decision_reason: null,
          application_reviewed_by: user?.id ?? null,
          application_reviewed_at: new Date().toISOString(),
        }
        action = 'APPLICATION_APPROVED'
      } else if (activeAction === 'info') {
        if (!reason.trim()) throw new Error('Please describe what information is required.')
        update = {
          application_status: 'Information Requested',
          overall_registration_status: 'Awaiting Family',
          next_action: 'Student/Family - Provide Further Information',
          next_action_owner: 'Student/Family',
          application_decision_reason: reason.trim(),
          application_reviewed_by: user?.id ?? null,
          application_reviewed_at: new Date().toISOString(),
        }
        action = 'APPLICATION_INFO_REQUESTED'
      } else if (activeAction === 'reject') {
        if (!reason.trim()) throw new Error('Please provide a reason for rejecting/closing this application.')
        update = {
          application_status: 'Rejected',
          overall_registration_status: 'Closed / Withdrawn',
          next_action: null,
          next_action_owner: null,
          application_decision_reason: reason.trim(),
          application_reviewed_by: user?.id ?? null,
          application_reviewed_at: new Date().toISOString(),
        }
        action = 'APPLICATION_REJECTED'
      } else {
        return
      }

      const previousValue = {
        application_status: student.application_status,
        overall_registration_status: student.overall_registration_status,
      }

      const { data, error } = await supabase
        .from('students')
        .update(update)
        .eq('student_id', id)
        .select()
        .maybeSingle()

      if (error) throw error

      await logAuditEvent({
        studentId: id,
        actorUserId: user?.id ?? null,
        actorRole: role,
        action,
        entityType: 'students',
        entityId: id,
        previousValue,
        newValue: update,
        reason: reason.trim() || undefined,
      })

      setStudent(data as Student)

      if (activeAction === 'info') {
        const chosenTemplate = templates.find((t) => t.code === infoTemplateCode) ?? undefined
        await queueInfoRequestEmail(data as Student, reason.trim(), user?.id ?? null, chosenTemplate)
      }

      setToast({ kind: 'success', message: 'Application updated.' })
      setActiveAction(null)
      setReason('')
      setInfoTemplateCode('')
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setSubmitting(false)
    }
  }

  async function submitPayment() {
    if (!student || !id || !paymentAction) return
    setPaymentSubmitting(true)

    try {
      if (paymentAction === 'issue' && !paymentNote.trim()) {
        throw new Error('Please describe the payment issue.')
      }

      const update: Partial<Student> =
        paymentAction === 'received'
          ? {
              payment_status: 'PAYMENT_RECEIVED',
              payment_received_at: new Date().toISOString(),
              payment_recorded_by: user?.id ?? null,
              payment_notes: paymentNote.trim() || null,
              overall_registration_status: 'Internal Onboarding',
              next_action: 'AGUK - Send Registration Email & Track Forms',
              next_action_owner: 'AGUK',
            }
          : {
              payment_status: 'PAYMENT_ISSUE',
              payment_notes: paymentNote.trim(),
              next_action: 'AGUK - Resolve Payment Issue',
              next_action_owner: 'AGUK',
            }

      const previousValue = { payment_status: student.payment_status }

      const { data, error } = await supabase
        .from('students')
        .update(update)
        .eq('student_id', id)
        .select()
        .maybeSingle()

      if (error) throw error

      await logAuditEvent({
        studentId: id,
        actorUserId: user?.id ?? null,
        actorRole: role,
        action: paymentAction === 'received' ? 'PAYMENT_RECEIVED' : 'PAYMENT_ISSUE_RECORDED',
        entityType: 'students',
        entityId: id,
        previousValue,
        newValue: update,
        reason: paymentNote.trim() || undefined,
      })

      if (paymentAction === 'received') {
        // Dedicated payment-confirmation workflow — sends the
        // registration message to the student and both parents.
        const { data: logRow } = await supabase
          .from('email_log')
          .insert({
            student_id: student.student_id,
            template_code: 'PAYMENT_CONFIRMED_REGISTRATION',
            recipient: student.email ?? '',
            subject: 'Registration message — payment confirmed',
            body: 'Sent via the dedicated payment-confirmation n8n workflow — content generated there, not composed here.',
            status: 'queued',
            triggered_by: user?.id ?? null,
          })
          .select()
          .maybeSingle()

        const result = await sendPaymentConfirmationViaN8n({
          student_id: student.student_id,
          case_id: student.case_id,
          first_name: student.first_name,
          last_name: student.last_name,
          email: student.email,
          university: student.university,
          course_title: student.course_title,
          parents: parents.map((p) => ({
            first_name: p.first_name,
            last_name: p.last_name,
            email: p.email,
          })),
        })

        if (logRow) {
          await supabase
            .from('email_log')
            .update({
              status: result.ok ? 'sent' : 'failed',
              sent_at: result.ok ? new Date().toISOString() : null,
              metadata: result.ok ? null : { error: result.error },
            })
            .eq('id', logRow.id)
        }

        setStudent(data as Student)
        setToast(
          result.ok
            ? { kind: 'success', message: 'Payment recorded and registration email sent to student + parents.' }
            : { kind: 'error', message: `Payment recorded, but the registration email failed to send: ${result.error}` },
        )
      } else {
        setStudent(data as Student)
        setToast({ kind: 'success', message: 'Payment status updated.' })
      }

      setPaymentAction(null)
      setPaymentNote('')
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setPaymentSubmitting(false)
    }
  }

  async function submitAccommodationDecision() {
    if (!student || !id || !accommodationAction) return
    setAccommodationSubmitting(true)

    try {
      if (accommodationAction === 'info_required' && !accommodationNote.trim()) {
        throw new Error('Please describe what further information is required.')
      }

      const update: Partial<Student> =
        accommodationAction === 'cleared'
          ? {
              accommodation_status: 'CLEARED_TO_PROCEED',
              accommodation_reviewed_by: user?.id ?? null,
              accommodation_reviewed_at: new Date().toISOString(),
              accommodation_notes: accommodationNote.trim() || null,
            }
          : {
              accommodation_status: 'REQUIRES_REVIEW',
              accommodation_reviewed_by: user?.id ?? null,
              accommodation_reviewed_at: new Date().toISOString(),
              accommodation_notes: accommodationNote.trim(),
            }

      const previousValue = { accommodation_status: student.accommodation_status }

      const { data, error } = await supabase
        .from('students')
        .update(update)
        .eq('student_id', id)
        .select()
        .maybeSingle()

      if (error) throw error

      await logAuditEvent({
        studentId: id,
        actorUserId: user?.id ?? null,
        actorRole: role,
        action: accommodationAction === 'cleared' ? 'ACCOMMODATION_CLEARED' : 'ACCOMMODATION_INFO_REQUESTED',
        entityType: 'students',
        entityId: id,
        previousValue,
        newValue: update,
        reason: accommodationNote.trim() || undefined,
      })

      setStudent(data as Student)

      let emailResultMessage = ''
      if (accommodationAction === 'info_required' && student.email) {
        const selectedTemplate = templates.find((t) => t.code === accommodationTemplateCode) ?? null
        const variables = {
          first_name: student.first_name,
          case_id: student.case_id,
          university: student.university,
          reason: accommodationNote.trim(),
        }
        const subject = selectedTemplate
          ? mergeTemplate(selectedTemplate.subject, variables)
          : `AGUK Accommodation — Further Information Required (${student.case_id ?? ''})`
        const body = selectedTemplate
          ? mergeTemplate(selectedTemplate.body, variables)
          : `Dear ${student.first_name ?? ''},\n\nWe need further information regarding your accommodation arrangements:\n\n${accommodationNote.trim()}\n\nKind regards,\nAcademic Guardians UK`

        const { data: logRow } = await supabase
          .from('email_log')
          .insert({
            student_id: student.student_id,
            template_code: selectedTemplate?.code ?? null,
            template_version: selectedTemplate?.version ?? null,
            recipient: student.email,
            subject,
            body,
            status: 'queued',
            triggered_by: user?.id ?? null,
          })
          .select()
          .maybeSingle()

        const emailResult = await sendEmailViaN8n({
          to: student.email,
          subject,
          body,
          student_id: student.student_id,
          case_id: student.case_id,
          template_code: selectedTemplate?.code ?? null,
          template_version: selectedTemplate?.version ?? null,
        })

        if (logRow) {
          await supabase
            .from('email_log')
            .update({
              status: emailResult.ok ? 'sent' : 'failed',
              sent_at: emailResult.ok ? new Date().toISOString() : null,
              metadata: emailResult.ok ? null : { error: emailResult.error },
            })
            .eq('id', logRow.id)
        }
        emailResultMessage = emailResult.ok ? ' Email sent to student.' : ` Email failed to send: ${emailResult.error}`
      }

      setToast({ kind: 'success', message: `Accommodation status updated.${emailResultMessage}` })
      setAccommodationAction(null)
      setAccommodationNote('')
      setAccommodationTemplateCode('')
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setAccommodationSubmitting(false)
    }
  }

  function openCompose() {
    setComposeOpen(true)
    setComposeTemplateCode('')
    setComposeSubject('')
    setComposeBody('')
  }

  function applyTemplate(code: string) {
    setComposeTemplateCode(code)
    if (!student) return
    if (!code) {
      setComposeSubject('')
      setComposeBody('')
      return
    }
    const t = templates.find((tpl) => tpl.code === code)
    if (!t) return
    const variables = {
      first_name: student.first_name,
      case_id: student.case_id,
      university: student.university,
      reason: '',
    }
    setComposeSubject(mergeTemplate(t.subject, variables))
    setComposeBody(mergeTemplate(t.body, variables))
  }

  async function submitCompose() {
    if (!student || !id) return
    if (!student.email) {
      setToast({ kind: 'error', message: 'This student has no email address on file.' })
      return
    }
    if (!composeSubject.trim() || !composeBody.trim()) {
      setToast({ kind: 'error', message: 'Subject and body are required.' })
      return
    }
    setComposeSubmitting(true)

    try {
      const selectedTemplate = templates.find((t) => t.code === composeTemplateCode) ?? null

      const { data: logRow } = await supabase
        .from('email_log')
        .insert({
          student_id: student.student_id,
          template_code: selectedTemplate?.code ?? null,
          template_version: selectedTemplate?.version ?? null,
          recipient: student.email,
          subject: composeSubject.trim(),
          body: composeBody.trim(),
          status: 'queued',
          triggered_by: user?.id ?? null,
        })
        .select()
        .maybeSingle()

      const result = await sendEmailViaN8n({
        to: student.email,
        subject: composeSubject.trim(),
        body: composeBody.trim(),
        student_id: student.student_id,
        case_id: student.case_id,
        template_code: selectedTemplate?.code ?? null,
        template_version: selectedTemplate?.version ?? null,
      })

      if (logRow) {
        await supabase
          .from('email_log')
          .update({
            status: result.ok ? 'sent' : 'failed',
            sent_at: result.ok ? new Date().toISOString() : null,
            metadata: result.ok ? null : { error: result.error },
          })
          .eq('id', logRow.id)
      }

      await logAuditEvent({
        studentId: id,
        actorUserId: user?.id ?? null,
        actorRole: role,
        action: result.ok ? 'EMAIL_SENT' : 'EMAIL_SEND_FAILED',
        entityType: 'students',
        entityId: id,
        metadata: { template_code: selectedTemplate?.code ?? null, subject: composeSubject.trim() },
      })

      setToast({
        kind: result.ok ? 'success' : 'error',
        message: result.ok ? 'Email sent.' : `Email failed to send: ${result.error}`,
      })
      setComposeOpen(false)
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setComposeSubmitting(false)
    }
  }

  async function sendReachInvitation() {
    if (!student || !id) return
    if (!student.email) {
      setToast({ kind: 'error', message: 'This student has no email address on file.' })
      return
    }
    setReachSubmitting(true)
    try {
      // Dedicated REACH workflow — it builds the meeting-booking link and
      // sends it itself, so we just hand it the student's details rather
      // than a pre-composed subject/body.
      const { data: logRow } = await supabase
        .from('email_log')
        .insert({
          student_id: student.student_id,
          template_code: 'REACH_MEETING_LINK',
          recipient: student.email,
          subject: 'REACH meeting link',
          body: 'Sent via the dedicated REACH n8n workflow — content generated there, not composed here.',
          status: 'queued',
          triggered_by: user?.id ?? null,
        })
        .select()
        .maybeSingle()

      const result = await sendReachInvitationViaN8n({
        student_id: student.student_id,
        case_id: student.case_id,
        first_name: student.first_name,
        last_name: student.last_name,
        email: student.email,
        university: student.university,
        course_title: student.course_title,
      })

      if (logRow) {
        await supabase
          .from('email_log')
          .update({
            status: result.ok ? 'sent' : 'failed',
            sent_at: result.ok ? new Date().toISOString() : null,
            metadata: result.ok ? null : { error: result.error },
          })
          .eq('id', logRow.id)
      }

      if (result.ok) {
        await supabase
          .from('students')
          .update({ reach_status: 'INVITATION_SENT', reach_invitation_sent_at: new Date().toISOString() })
          .eq('student_id', id)

        await logAuditEvent({
          studentId: id,
          actorUserId: user?.id ?? null,
          actorRole: role,
          action: 'REACH_INVITATION_SENT',
          entityType: 'students',
          entityId: id,
        })
      }

      setToast({
        kind: result.ok ? 'success' : 'error',
        message: result.ok ? 'Meeting link sent to student.' : `Failed to send: ${result.error}`,
      })
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setReachSubmitting(false)
    }
  }

  async function markReachBooked() {
    if (!student || !id) return
    setReachSubmitting(true)
    try {
      await supabase
        .from('students')
        .update({ reach_status: 'BOOKED', reach_booking_at: new Date().toISOString() })
        .eq('student_id', id)

      await logAuditEvent({
        studentId: id,
        actorUserId: user?.id ?? null,
        actorRole: role,
        action: 'REACH_BOOKED',
        entityType: 'students',
        entityId: id,
      })

      setToast({ kind: 'success', message: 'REACH meeting marked as booked.' })
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setReachSubmitting(false)
    }
  }

  async function confirmReachAttendance() {
    if (!student || !id || !reachAttendanceAction) return
    setReachSubmitting(true)
    try {
      const newStatus = reachAttendanceAction === 'attended' ? 'ATTENDED' : 'NOT_ATTENDED'
      await supabase
        .from('students')
        .update({
          reach_status: newStatus,
          reach_attendance_confirmed_at: new Date().toISOString(),
          reach_attendance_confirmed_by: user?.id ?? null,
        })
        .eq('student_id', id)

      await logAuditEvent({
        studentId: id,
        actorUserId: user?.id ?? null,
        actorRole: role,
        action: newStatus === 'ATTENDED' ? 'MEETING_ATTENDED' : 'MEETING_NOT_ATTENDED',
        entityType: 'students',
        entityId: id,
      })

      setToast({ kind: 'success', message: `Meeting marked as ${newStatus === 'ATTENDED' ? 'attended' : 'not attended'}.` })
      setReachAttendanceAction(null)
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setReachSubmitting(false)
    }
  }

  async function confirmFinalRegistration() {
    if (!student || !id) return
    setFinalRegSubmitting(true)
    try {
      await supabase
        .from('students')
        .update({
          // Also normalizes application_status back to Approved — this
          // step can only be reached once approved, but if that field
          // was ever hand-edited to something stale in Supabase, this
          // guarantees the badge is correct again once registration is
          // actually complete.
          application_status: 'Approved',
          registration_complete: true,
          registration_completed_at: new Date().toISOString(),
          registration_completed_by: user?.id ?? null,
          overall_registration_status: 'Registration Complete',
          next_action: null,
          next_action_owner: null,
        })
        .eq('student_id', id)

      await logAuditEvent({
        studentId: id,
        actorUserId: user?.id ?? null,
        actorRole: role,
        action: 'REGISTRATION_COMPLETED',
        entityType: 'students',
        entityId: id,
      })

      const webhookResult = await sendFinalRegistrationViaN8n({
        student_id: student.student_id,
        case_id: student.case_id,
        first_name: student.first_name,
        last_name: student.last_name,
        email: student.email,
        university: student.university,
        course_title: student.course_title,
      })

      setToast({
        kind: 'success',
        message: webhookResult.ok
          ? 'Registration marked complete.'
          : `Registration marked complete, but the final-registration webhook failed: ${webhookResult.error}`,
      })
      setFinalRegAction(false)
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setFinalRegSubmitting(false)
    }
  }

  function openEditDetails() {
    if (!student) return
    const initial = {} as Record<EditableField, string>
    for (const field of EDITABLE_STUDENT_FIELDS) {
      initial[field] = (student[field] as string | null) ?? ''
    }
    setEditForm(initial)
    setEditingDetails(true)
  }

  async function saveEditDetails() {
    if (!student || !id) return
    setEditSubmitting(true)
    try {
      const update: Partial<Student> = {}
      const previousValue: Record<string, unknown> = {}
      const newValue: Record<string, unknown> = {}

      for (const field of EDITABLE_STUDENT_FIELDS) {
        const nextRaw = editForm[field].trim()
        const next = nextRaw === '' ? null : nextRaw
        const current = student[field] as string | null
        if (next !== current) {
          ;(update as Record<string, unknown>)[field] = next
          previousValue[field] = current
          newValue[field] = next
        }
      }

      if (Object.keys(update).length === 0) {
        setEditingDetails(false)
        setEditSubmitting(false)
        return
      }

      const { data, error } = await supabase
        .from('students')
        .update(update)
        .eq('student_id', id)
        .select()
        .maybeSingle()

      if (error) throw error

      await logAuditEvent({
        studentId: id,
        actorUserId: user?.id ?? null,
        actorRole: role,
        action: 'STUDENT_DETAILS_UPDATED',
        entityType: 'students',
        entityId: id,
        previousValue,
        newValue,
      })

      setStudent(data as Student)
      setToast({ kind: 'success', message: 'Student details updated.' })
      setEditingDetails(false)
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setEditSubmitting(false)
    }
  }

  async function deleteApplication() {
    if (!student || !id) return
    if (deleteConfirmText.trim() !== student.case_id) {
      setToast({ kind: 'error', message: 'Case ID does not match — deletion cancelled.' })
      return
    }
    setDeleteSubmitting(true)
    try {
      const childTables = [
        'documents',
        'email_log',
        'audit_events',
        'parents',
        'application_form',
        'agreement_form',
        'conduct_form',
        'medical_form',
        'accommodation_form',
      ]
      for (const table of childTables) {
        const { error } = await supabase.from(table).delete().eq('student_id', id)
        if (error) throw new Error(`Failed to delete ${table}: ${error.message}`)
      }

      // .select() forces Postgres to report which rows were actually
      // deleted. Without it, RLS silently deleting 0 rows (no matching
      // DELETE policy) looks identical to a real success — this catches
      // that instead of showing a false "deleted" toast.
      const { data: deletedRows, error: studentError } = await supabase
        .from('students')
        .delete()
        .eq('student_id', id)
        .select('student_id')
      if (studentError) throw new Error(`Failed to delete student: ${studentError.message}`)
      if (!deletedRows || deletedRows.length === 0) {
        throw new Error('Delete did not remove the student record — you may not have permission, or the record no longer exists.')
      }

      // Tombstone record — not linked via student_id (that row is gone), so
      // it survives in History as proof of what was deleted and by whom.
      await supabase.from('audit_events').insert({
        student_id: null,
        actor_user_id: user?.id ?? null,
        actor_role: role,
        action: 'STUDENT_DELETED',
        entity_type: 'students',
        reason: `${student.case_id ?? 'Unknown case'} — ${[student.first_name, student.last_name].filter(Boolean).join(' ')}`,
        metadata: {
          deleted_case_id: student.case_id,
          deleted_name: [student.first_name, student.last_name].filter(Boolean).join(' '),
          deleted_email: student.email,
        },
      })

      setToast({ kind: 'success', message: 'Application permanently deleted.' })
      navigate('/applications')
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
      setDeleteSubmitting(false)
    }
  }

  async function resetStage(label: string, update: Partial<Student>) {
    if (!student || !id) return
    setResettingStage(label)
    try {
      const { data, error } = await supabase
        .from('students')
        .update(update)
        .eq('student_id', id)
        .select()
        .maybeSingle()
      if (error) throw error

      await logAuditEvent({
        studentId: id,
        actorUserId: user?.id ?? null,
        actorRole: role,
        action: 'TEST_STAGE_RESET',
        entityType: 'students',
        entityId: id,
        reason: `Reset for testing: ${label}`,
        newValue: update,
      })

      setStudent(data as Student)
      setToast({ kind: 'success', message: `${label} reset for re-testing.` })
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setResettingStage(null)
    }
  }

  async function simulateFormSubmission(
    label: string,
    formType: 'AGREEMENT' | 'CONDUCT' | 'MEDICAL' | 'ACCOMMODATION',
    accommodationType?: string,
  ) {
    if (!student || !id) return
    setSimulatingStage(label)
    try {
      // Plain update on the students row — same table/pattern as the
      // "Reset" buttons above, which already work with no extra table
      // or migration. Marks the form as filled with dummy data so you
      // don't have to submit it via Fillout to test the next stage.
      let update: Partial<Student>
      if (formType === 'ACCOMMODATION') {
        const type = accommodationType ?? 'University Halls'
        const route = /university/i.test(type) ? 'UNIVERSITY' : /pbsa/i.test(type) ? 'PBSA' : 'PRIVATE'
        const status = route === 'UNIVERSITY' ? 'CLEARED_TO_PROCEED' : 'REQUIRES_REVIEW'
        update = {
          accommodation_route: route,
          accommodation_status: status,
          accommodation_completed: route === 'UNIVERSITY',
        } as Partial<Student>
      } else {
        const column = formType === 'AGREEMENT' ? 'agreement' : formType === 'CONDUCT' ? 'conduct' : 'medical'
        update = {
          [`${column}_review_status`]: 'SUBMITTED',
          [`${column}_completed`]: false, // stays false until a reviewer approves — matches the real flow
        } as Partial<Student>
      }

      const { data, error } = await supabase
        .from('students')
        .update(update)
        .eq('student_id', id)
        .select()
        .maybeSingle()
      if (error) throw error

      await logAuditEvent({
        studentId: id,
        actorUserId: user?.id ?? null,
        actorRole: role,
        action: 'TEST_STAGE_SIMULATED',
        entityType: 'students',
        entityId: id,
        reason: `Simulated submission for testing: ${label}`,
        newValue: update,
      })

      setStudent(data as Student)
      setToast({ kind: 'success', message: `${label} filled with test data.` })
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setSimulatingStage(null)
    }
  }

  async function sendReminder() {
    if (!student || !id) return

    const outstanding = [
      !student.agreement_completed && 'University Agreement',
      !student.conduct_completed && 'Student Code of Conduct',
      !student.medical_completed && 'Medical Form',
      !student.accommodation_completed && 'Confirmation of Accommodation Details',
    ].filter(Boolean) as string[]

    if (outstanding.length === 0) {
      setToast({ kind: 'error', message: 'All 4 requirements are already complete.' })
      return
    }

    // Student + both parents, if on file — same recipients as the
    // automatic 3-day backend reminder.
    const recipients = [
      student.email ? { name: student.first_name, email: student.email } : null,
      ...parents.map((p) => (p.email ? { name: p.first_name, email: p.email } : null)),
    ].filter((r): r is { name: string | null; email: string } => r !== null)

    if (recipients.length === 0) {
      setToast({ kind: 'error', message: 'No email address on file for the student or parents.' })
      return
    }

    setReminderSubmitting(true)
    try {
      let anyFailed = false

      for (const recipient of recipients) {
        const subject = `Reminder: Outstanding Registration Requirements (${student.case_id ?? ''})`
        const body = `Dear ${recipient.name ?? ''},\n\nThis is a reminder that the following registration requirements are still outstanding for ${student.case_id ?? ''}:\n\n${outstanding.join(', ')}\n\nPlease complete these as soon as possible.\n\nKind regards,\nAcademic Guardians UK`

        const { data: logRow } = await supabase
          .from('email_log')
          .insert({
            student_id: student.student_id,
            template_code: 'REMINDER_3_DAY',
            recipient: recipient.email,
            subject,
            body,
            status: 'queued',
            triggered_by: user?.id ?? null,
          })
          .select()
          .maybeSingle()

        const result = await sendEmailViaN8n({
          to: recipient.email,
          subject,
          body,
          student_id: student.student_id,
          case_id: student.case_id,
          template_code: 'REMINDER_3_DAY',
          template_version: null,
        })

        if (!result.ok) anyFailed = true

        if (logRow) {
          await supabase
            .from('email_log')
            .update({
              status: result.ok ? 'sent' : 'failed',
              sent_at: result.ok ? new Date().toISOString() : null,
              metadata: result.ok ? { source: 'manual' } : { error: result.error },
            })
            .eq('id', logRow.id)
        }
      }

      await supabase
        .from('students')
        .update({
          last_reminder_sent_at: new Date().toISOString(),
          reminder_count: (student.reminder_count ?? 0) + 1,
          next_reminder_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('student_id', id)

      await logAuditEvent({
        studentId: id,
        actorUserId: user?.id ?? null,
        actorRole: role,
        action: anyFailed ? 'REMINDER_SEND_FAILED' : 'REMINDER_SENT',
        entityType: 'students',
        entityId: id,
        reason: outstanding.join(', '),
        metadata: { source: 'manual', recipients: recipients.map((r) => r.email) },
      })

      setToast({
        kind: anyFailed ? 'error' : 'success',
        message: anyFailed
          ? 'Reminder sent, but one or more recipients failed — check Communications.'
          : `Reminder sent to ${recipients.length} recipient${recipients.length > 1 ? 's' : ''} (student + parents).`,
      })
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setReminderSubmitting(false)
    }
  }

  async function submitFormReview() {
    if (!student || !id || !reviewAction) return
    const { form, decision } = reviewAction

    if (decision !== 'approve' && !reviewNote.trim()) {
      setToast({ kind: 'error', message: 'Please provide a note explaining the decision.' })
      return
    }

    setReviewSubmitting(true)
    try {
      const meta = FORM_META[form]
      const newStatus = decision === 'approve' ? 'APPROVED' : decision === 'reject' ? 'REJECTED' : 'INFO_REQUESTED'

      const update: Partial<Student> = {
        [meta.statusCol]: newStatus,
        [meta.reviewedByCol]: user?.id ?? null,
        [meta.reviewedAtCol]: new Date().toISOString(),
        [meta.notesCol]: reviewNote.trim() || null,
      }

      const previousValue = { [meta.statusCol]: student[meta.statusCol] }

      const { data, error } = await supabase
        .from('students')
        .update(update)
        .eq('student_id', id)
        .select()
        .maybeSingle()

      if (error) throw error

      await logAuditEvent({
        studentId: id,
        actorUserId: user?.id ?? null,
        actorRole: role,
        action: `${meta.title.toUpperCase().replace(/\s+/g, '_')}_${newStatus}`,
        entityType: 'students',
        entityId: id,
        previousValue,
        newValue: update,
        reason: reviewNote.trim() || undefined,
      })

      setStudent(data as Student)

      let emailResultMessage = ''
      if (decision === 'info' && student.email) {
        const selectedTemplate = templates.find((t) => t.code === reviewTemplateCode) ?? null
        const variables = {
          first_name: student.first_name,
          case_id: student.case_id,
          university: student.university,
          reason: `${meta.title}: ${reviewNote.trim()}`,
        }
        const subject = selectedTemplate
          ? mergeTemplate(selectedTemplate.subject, variables)
          : `AGUK ${meta.title} — Further Information Required (${student.case_id ?? ''})`
        const body = selectedTemplate
          ? mergeTemplate(selectedTemplate.body, variables)
          : `Dear ${student.first_name ?? ''},\n\nWe need further information regarding your ${meta.title}:\n\n${reviewNote.trim()}\n\nKind regards,\nAcademic Guardians UK`

        const { data: logRow } = await supabase
          .from('email_log')
          .insert({
            student_id: student.student_id,
            template_code: selectedTemplate?.code ?? null,
            template_version: selectedTemplate?.version ?? null,
            recipient: student.email,
            subject,
            body,
            status: 'queued',
            triggered_by: user?.id ?? null,
          })
          .select()
          .maybeSingle()

        const emailResult = await sendEmailViaN8n({
          to: student.email,
          subject,
          body,
          student_id: student.student_id,
          case_id: student.case_id,
          template_code: selectedTemplate?.code ?? null,
          template_version: selectedTemplate?.version ?? null,
        })

        if (logRow) {
          await supabase
            .from('email_log')
            .update({
              status: emailResult.ok ? 'sent' : 'failed',
              sent_at: emailResult.ok ? new Date().toISOString() : null,
              metadata: emailResult.ok ? null : { error: emailResult.error },
            })
            .eq('id', logRow.id)
        }
        emailResultMessage = emailResult.ok ? ' Email sent to student.' : ` Email failed to send: ${emailResult.error}`
      }

      setToast({
        kind: 'success',
        message: `${meta.title} ${FORM_STATUS_LABELS[newStatus].toLowerCase()}.${emailResultMessage}`,
      })
      setReviewAction(null)
      setReviewNote('')
      setReviewTemplateCode('')
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setReviewSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl animate-pulse space-y-6">
        <div className="h-4 w-32 rounded bg-ink-100" />
        <div className="h-8 w-64 rounded bg-ink-100" />
        <div className="h-40 rounded-xl bg-ink-100" />
      </div>
    )
  }

  if (error || !student) {
    return <p className="text-sm text-rose-600">{error ?? 'Application not found.'}</p>
  }

  const status = student.application_status
  // Whitelist the "still pending a decision" states, rather than blacklist
  // the "decided" ones — any unexpected/legacy status value should default
  // to hiding these buttons, not showing them.
  const isPendingDecision =
    status === 'Application Submitted' || status === 'Under Review' || status === 'Information Requested'
  const isDecided = !isPendingDecision
  const canAct = canMutate(role) && isPendingDecision
  const stages = buildStages(student)

  return (
    <div className="w-full">
      <Link to="/applications" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to Applications
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-700/10 text-sm font-semibold text-brand-700">
            {initials(student.first_name, student.last_name)}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Application Review</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink-900">
              {[student.first_name, student.last_name].filter(Boolean).join(' ') || 'Unnamed applicant'}
            </h1>
            <p className="mt-1 text-sm text-ink-400">
              {student.case_id ?? 'Null'} · {student.university ?? 'Null'} · {student.course_title ?? 'Null'}
            </p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {toast && (
        <div
          className={`mt-4 rounded-md px-4 py-3 text-sm ${
            toast.kind === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card
            title="Student Details"
            action={
              canMutate(role) &&
              !editingDetails && (
                <Button variant="secondary" className="h-8 px-3 text-xs" onClick={openEditDetails}>
                  Edit
                </Button>
              )
            }
          >
            {editingDetails ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  {(
                    [
                      ['first_name', 'First Name'],
                      ['last_name', 'Last Name'],
                      ['english_name', 'English Name'],
                      ['university_student_id', 'University Student ID'],
                      ['email', 'Email'],
                      ['phone', 'Phone'],
                      ['whatsapp', 'WhatsApp'],
                      ['dob', 'Date of Birth'],
                      ['gender', 'Gender'],
                      ['nationality', 'Nationality'],
                      ['passport_number', 'Passport Number'],
                      ['passport_expiry', 'Passport Expiry'],
                      ['university', 'University'],
                      ['course_title', 'Course'],
                      ['course_start_date', 'Course Start Date'],
                    ] as [EditableField, string][]
                  ).map(([field, label]) => (
                    <div key={field}>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-400">
                        {label}
                      </label>
                      <input
                        value={editForm[field] ?? ''}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, [field]: e.target.value }))}
                        className="w-full rounded-md border border-ink-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2 border-t border-ink-100 pt-4">
                  <Button variant="secondary" onClick={() => setEditingDetails(false)} disabled={editSubmitting}>
                    Cancel
                  </Button>
                  <Button onClick={saveEditDetails} disabled={editSubmitting}>
                    {editSubmitting ? 'Saving…' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-5">
                <Field label="Case ID" value={student.case_id} />
                <Field label="University Student ID" value={student.university_student_id} />
                <Field label="First Name" value={student.first_name} />
                <Field label="Last Name" value={student.last_name} />
                <Field label="English Name" value={student.english_name} />
                <Field label="Email" value={student.email} />
                <Field label="Phone" value={student.phone} />
                <Field label="WhatsApp" value={student.whatsapp} />
                <Field label="Date of Birth" value={student.dob} />
                <Field label="Gender" value={student.gender} />
                <Field label="Nationality" value={student.nationality} />
                <Field label="Passport Number" value={student.passport_number} />
                <Field label="Passport Expiry" value={student.passport_expiry} />
                <Field label="University" value={student.university} />
                <Field label="Course" value={student.course_title} />
                <Field label="Course Start Date" value={student.course_start_date} />
              </div>
            )}
          </Card>

          <Card title="Application Form">
            {applicationForm ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-x-4 gap-y-5 border-b border-ink-100 pb-6 sm:grid-cols-4">
                  <Field label="Guardianship Level" value={applicationForm.guardianship_level} />
                  <Field label="Payment Frequency" value={applicationForm.payment_frequency} />
                  <Field label="Payment Method" value={applicationForm.payment_method} />
                  <Field
                    label="Submitted"
                    value={applicationForm.submitted_at ? new Date(applicationForm.submitted_at).toLocaleString('en-GB') : null}
                  />
                </div>
                <FilloutAnswers rawJson={applicationForm.raw_json} />
              </div>
            ) : (
              <p className="text-sm text-ink-400">No application form record found.</p>
            )}
          </Card>

          {student.payment_status === 'PAYMENT_RECEIVED' && (
            <>
              <FormReviewCard
                title="University Agreement"
                status={student.agreement_review_status}
                submittedAt={agreementForm?.submitted_at ?? null}
                reviewedAt={student.agreement_reviewed_at}
                notes={student.agreement_notes}
                canAct={canMutate(role)}
                submitting={reviewSubmitting}
                onDecision={(decision) => {
                  setReviewAction({ form: 'agreement', decision })
                  setReviewNote('')
                }}
                fields={[
                  { label: 'Accepted', value: agreementForm?.accepted },
                  { label: 'Signed Date', value: agreementForm?.signed_date },
                  { label: 'Signature', value: agreementForm?.signature },
                ]}
              />

              <FormReviewCard
                title="Student Code of Conduct"
                status={student.conduct_review_status}
                submittedAt={conductForm?.submitted_at ?? null}
                reviewedAt={student.conduct_reviewed_at}
                notes={student.conduct_notes}
                canAct={canMutate(role)}
                submitting={reviewSubmitting}
                onDecision={(decision) => {
                  setReviewAction({ form: 'conduct', decision })
                  setReviewNote('')
                }}
                fields={[
                  { label: 'Accepted', value: conductForm?.accepted },
                  { label: 'Signed Date', value: conductForm?.signed_date },
                  { label: 'Signature', value: conductForm?.signature },
                ]}
              />

              <FormReviewCard
                title="Medical Form"
                status={student.medical_review_status}
                submittedAt={medicalForm?.submitted_at ?? null}
                reviewedAt={student.medical_reviewed_at}
                notes={student.medical_notes}
                canAct={canMutate(role)}
                submitting={reviewSubmitting}
                onDecision={(decision) => {
                  setReviewAction({ form: 'medical', decision })
                  setReviewNote('')
                }}
                fields={[
                  { label: 'Allergies', value: medicalForm?.allergies },
                  { label: 'Medical Conditions', value: medicalForm?.medical_conditions },
                  { label: 'Medications', value: medicalForm?.medications },
                  { label: 'Dietary Requirements', value: medicalForm?.dietary_requirements },
                  { label: 'Emergency Contact', value: medicalForm?.emergency_contact },
                  { label: 'Vaccinations', value: medicalForm?.vaccinations },
                  { label: 'OTC Permissions', value: medicalForm?.otc_permissions },
                  { label: 'Signature', value: medicalForm?.signature },
                ]}
              />

              <Card
                title="Confirmation of Accommodation Details"
                action={
                  student.accommodation_route ? (
                    <div className="flex items-center gap-2">
                      <StatusPill tone="info">{student.accommodation_route}</StatusPill>
                      <StatusPill
                        tone={
                          student.accommodation_status === 'COMPLETE' || student.accommodation_status === 'CLEARED_TO_PROCEED'
                            ? 'success'
                            : student.accommodation_status === 'REQUIRES_REVIEW'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {student.accommodation_status === 'COMPLETE'
                          ? 'Auto-Cleared'
                          : student.accommodation_status === 'CLEARED_TO_PROCEED'
                            ? 'Cleared to Proceed'
                            : student.accommodation_status === 'REQUIRES_REVIEW'
                              ? 'Awaiting Review'
                              : 'Not filled'}
                      </StatusPill>
                    </div>
                  ) : (
                    <StatusPill tone="neutral">Not filled</StatusPill>
                  )
                }
              >
                {!accommodationForm && !student.accommodation_route ? (
                  <p className="text-sm text-ink-400">Not yet submitted.</p>
                ) : !accommodationForm ? (
                  <div className="space-y-2">
                    <p className="text-sm text-ink-400">
                      No Fillout submission on file yet — this was set from Testing Tools, not a real form
                      submission.
                    </p>
                    <Field label="Accommodation Type (test)" value={student.accommodation_route} />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                      <Field label="Accommodation Type" value={accommodationForm.accommodation_type} />
                      <Field label="Accommodation Name" value={accommodationForm.accommodation_name} />
                      <Field label="University" value={accommodationForm.university} />
                      <Field label="Tenancy Start" value={accommodationForm.tenancy_start} />
                      <Field
                        label="Guardian Check Required"
                        value={
                          accommodationForm.guardian_check_required === null
                            ? null
                            : accommodationForm.guardian_check_required
                              ? 'Yes'
                              : 'No'
                        }
                      />
                      <Field
                        label="Submitted"
                        value={accommodationForm.submitted_at ? new Date(accommodationForm.submitted_at).toLocaleString('en-GB') : null}
                      />
                      {isUrlLike(accommodationForm.evidence) && (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Evidence</p>
                          <a
                            href={accommodationForm.evidence as string}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 inline-block text-sm text-brand-700 hover:underline"
                          >
                            View file
                          </a>
                        </div>
                      )}
                      {isUrlLike(accommodationForm.signature) && (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Signature</p>
                          <a
                            href={accommodationForm.signature as string}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 inline-block rounded-md border border-ink-200 p-1"
                            style={{ backgroundColor: '#ffffff' }}
                          >
                            <img src={accommodationForm.signature as string} alt="" className="h-20 w-20 object-contain" />
                          </a>
                        </div>
                      )}
                    </div>

                    {student.accommodation_notes && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Notes</p>
                        <p className="mt-0.5 text-sm text-ink-900">{student.accommodation_notes}</p>
                      </div>
                    )}

                    {student.accommodation_route === 'UNIVERSITY' ? (
                      <p className="text-xs text-ink-400">
                        University-approved accommodation is auto-cleared — no AGUK review required.
                      </p>
                    ) : (
                      canMutate(role) &&
                      student.accommodation_status === 'REQUIRES_REVIEW' && (
                        <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4">
                          <Button variant="success" className="h-8 px-3 text-xs" onClick={() => setAccommodationAction('cleared')}>
                            Cleared to Proceed
                          </Button>
                          <Button variant="danger" className="h-8 px-3 text-xs" onClick={() => setAccommodationAction('info_required')}>
                            Further Information Required
                          </Button>
                        </div>
                      )
                    )}
                  </div>
                )}
              </Card>
            </>
          )}

          <Card title="Parents / Guardians">
            {parents.length === 0 && <p className="text-sm text-ink-400">No parent records found.</p>}
            <div className="divide-y divide-ink-100">
              {parents.map((p) => (
                <div key={p.id} className="grid grid-cols-2 gap-x-4 gap-y-5 py-4 first:pt-0 last:pb-0">
                  <Field label={`Parent ${p.parent_number ?? ''} Name`} value={[p.salutation, p.first_name, p.last_name].filter(Boolean).join(' ')} />
                  <Field label="Relationship" value={p.relationship} />
                  <Field label="Email" value={p.email} />
                  <Field label="Phone" value={p.phone} />
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Communications"
            action={
              canMutate(role) && (
                <Button variant="secondary" className="h-8 px-3 text-xs" onClick={openCompose}>
                  Compose Email
                </Button>
              )
            }
          >
            {emailLog.length === 0 && (
              <p className="text-sm text-ink-400">No communications logged yet for this student.</p>
            )}
            <ul className="divide-y divide-ink-100">
              {emailLog.map((e) => (
                <li key={e.id} className="border-l-2 border-ink-200 py-4 pl-4 text-sm first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium leading-snug text-ink-900">{e.subject}</p>
                    {e.status !== 'queued' && (
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                          e.status === 'sent'
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                            : 'bg-rose-50 text-rose-700 ring-rose-200'
                        }`}
                      >
                        {e.status}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-400">
                    To {e.recipient} · {new Date(e.created_at).toLocaleString('en-GB')}
                    {e.template_code && (
                      <span className="ml-1.5 inline-flex items-center rounded bg-ink-50 px-1.5 py-0.5 text-[11px] font-medium text-ink-500">
                        {e.template_code}
                        {e.template_version != null ? ` · v${e.template_version}` : ''}
                      </span>
                    )}
                  </p>
                  <p className="mt-2 whitespace-pre-line leading-relaxed text-ink-600">{e.body}</p>
                </li>
              ))}
            </ul>
            {emailLog.some((e) => e.status === 'failed') && (
              <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
                One or more communications failed to send. Check the n8n workflow is active and reachable.
              </p>
            )}
          </Card>

          <Card title="Audit History">
            {auditEvents.length === 0 && <p className="text-sm text-ink-400">No audit events recorded yet.</p>}
            <ul className="space-y-4">
              {auditEvents.map((e) => (
                <li key={e.id} className="border-l-2 border-ink-100 pl-3 text-sm">
                  <p className="font-medium text-ink-900">{e.action.replaceAll('_', ' ')}</p>
                  <p className="text-xs text-ink-400">
                    {new Date(e.created_at).toLocaleString('en-GB')} · role: {roleLabel(e.actor_role)}
                  </p>
                  {e.reason && <p className="mt-1 text-ink-600">{e.reason}</p>}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Registration Progress">
            <StageTracker stages={stages} />
          </Card>

          {student.payment_status === 'PAYMENT_RECEIVED' &&
            (() => {
              const forms = [
                { label: 'Agreement', status: student.agreement_review_status, submittedAt: agreementForm?.submitted_at ?? null },
                { label: 'Conduct', status: student.conduct_review_status, submittedAt: conductForm?.submitted_at ?? null },
                { label: 'Medical', status: student.medical_review_status, submittedAt: medicalForm?.submitted_at ?? null },
                {
                  label: 'Accommodation',
                  status: student.accommodation_status === 'CLEARED_TO_PROCEED' || student.accommodation_status === 'COMPLETE'
                    ? 'APPROVED'
                    : student.accommodation_status === 'REQUIRES_REVIEW'
                      ? 'SUBMITTED'
                      : 'OUTSTANDING',
                  submittedAt: accommodationForm?.submitted_at ?? null,
                },
              ]
              const doneCount = forms.filter((f) => f.status === 'APPROVED').length
              const allDone = doneCount === 4

              return (
                <Card
                  title={`Registration Forms (${doneCount}/4)`}
                  action={
                    canMutate(role) &&
                    !allDone && (
                      <Button
                        variant="secondary"
                        className="h-8 px-3 text-xs"
                        onClick={sendReminder}
                        disabled={reminderSubmitting}
                      >
                        {reminderSubmitting ? 'Sending…' : 'Send Reminder'}
                      </Button>
                    )
                  }
                >
                  <div className="space-y-3 text-sm">
                    {forms.map((f) => (
                      <div key={f.label} className="flex items-center justify-between">
                        <div>
                          <p className="text-ink-700">{f.label}</p>
                          {f.submittedAt && (
                            <p className="text-xs text-ink-400">
                              Submitted {new Date(f.submittedAt).toLocaleDateString('en-GB', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </p>
                          )}
                        </div>
                        <StatusPill tone={FORM_STATUS_TONES[f.status] ?? 'neutral'}>
                          {FORM_STATUS_LABELS[f.status] ?? f.status}
                        </StatusPill>
                      </div>
                    ))}
                  </div>
                  {!allDone && (student.last_reminder_sent_at || student.next_reminder_at) && (
                    <div className="mt-4 space-y-1 border-t border-ink-100 pt-3 text-xs text-ink-400">
                      {student.last_reminder_sent_at && (
                        <p>
                          Last reminder: {new Date(student.last_reminder_sent_at).toLocaleString('en-GB')}
                          {student.reminder_count ? ` (sent ${student.reminder_count}x)` : ''}
                        </p>
                      )}
                      {student.next_reminder_at && (
                        <p>Next automatic reminder: {new Date(student.next_reminder_at).toLocaleString('en-GB')}</p>
                      )}
                    </div>
                  )}
                </Card>
              )
            })()}

          {student.reach_status && student.reach_status !== 'NOT_READY' && (
            <Card title="REACH">
              <div className="space-y-4 text-sm">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Status</p>
                  <StatusPill
                    tone={
                      student.reach_status === 'ATTENDED'
                        ? 'success'
                        : student.reach_status === 'NOT_ATTENDED'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {student.reach_status.replaceAll('_', ' ')}
                  </StatusPill>
                </div>
                {student.reach_booking_at && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Booked</p>
                    <p className="mt-0.5 text-ink-900">{new Date(student.reach_booking_at).toLocaleString('en-GB')}</p>
                  </div>
                )}

                {canMutate(role) && student.reach_status === 'READY' && (
                  <>
                    <p className="text-xs text-ink-400">
                      All 4 registration requirements are approved. This confirms that and sends the student their
                      REACH meeting link.
                    </p>
                    <Button variant="success" fullWidth onClick={sendReachInvitation} disabled={reachSubmitting}>
                      {reachSubmitting ? 'Sending…' : 'Approve & Send Meeting Link'}
                    </Button>
                  </>
                )}
                {canMutate(role) && student.reach_status === 'INVITATION_SENT' && (
                  <Button variant="success" fullWidth onClick={markReachBooked} disabled={reachSubmitting}>
                    Mark as Booked
                  </Button>
                )}
                {canMutate(role) && student.reach_status === 'BOOKED' && (
                  <div className="flex gap-2">
                    <Button variant="success" className="flex-1" onClick={() => setReachAttendanceAction('attended')}>
                      Mark Attended
                    </Button>
                    <Button variant="danger" className="flex-1" onClick={() => setReachAttendanceAction('not_attended')}>
                      Not Attended
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          )}

          {student.reach_status === 'ATTENDED' && !student.registration_complete && canMutate(role) && (
            <Card title="Final Registration">
              <p className="text-sm text-ink-600">
                All requirements complete and REACH meeting attended. This is the last, separate manual step —
                it does not happen automatically.
              </p>
              <Button variant="success" fullWidth className="mt-4" onClick={() => setFinalRegAction(true)}>
                Mark Registration Complete
              </Button>
            </Card>
          )}

          {student.registration_complete && (
            <Card title="Final Registration">
              <div className="flex items-center gap-2">
                <StatusPill tone="success">Registration Complete</StatusPill>
              </div>
              {student.registration_completed_at && (
                <p className="mt-2 text-xs text-ink-400">
                  {new Date(student.registration_completed_at).toLocaleString('en-GB')}
                </p>
              )}
            </Card>
          )}

          <Card title="Status">
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Overall Registration</p>
                <p className="mt-0.5 text-ink-900">{student.overall_registration_status}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Next Action</p>
                <p className="mt-0.5 text-ink-900">{student.next_action ?? 'Review Application'}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Owner</p>
                <p className="mt-0.5 text-ink-900">{student.next_action_owner ?? 'Admin'}</p>
              </div>
              {student.application_decision_reason && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
                    {student.application_status === 'Information Requested'
                      ? 'Information Requested'
                      : student.application_status === 'Rejected'
                        ? 'Rejection / Closure Reason'
                        : 'Decision Notes'}
                  </p>
                  <p className="mt-0.5 text-ink-900">{student.application_decision_reason}</p>
                </div>
              )}
            </div>
          </Card>

          {student.application_status === 'Approved' && (
            <Card title="Payment">
              <div className="space-y-4 text-sm">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Status</p>
                  <StatusPill
                    tone={
                      student.payment_status === 'PAYMENT_RECEIVED'
                        ? 'success'
                        : student.payment_status === 'PAYMENT_ISSUE'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {(student.payment_status ?? 'NOT_REQUIRED').replaceAll('_', ' ')}
                  </StatusPill>
                </div>
                {student.payment_received_at && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Received</p>
                    <p className="mt-0.5 text-ink-900">{new Date(student.payment_received_at).toLocaleString('en-GB')}</p>
                  </div>
                )}
                {student.payment_notes && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Notes</p>
                    <p className="mt-0.5 text-ink-900">{student.payment_notes}</p>
                  </div>
                )}

                {canMutate(role) && student.payment_status === 'AWAITING_PAYMENT' && (
                  <div className="flex gap-2 pt-1">
                    <Button variant="success" fullWidth onClick={() => setPaymentAction('received')}>
                      Record Payment Received
                    </Button>
                  </div>
                )}
                {canMutate(role) && student.payment_status === 'AWAITING_PAYMENT' && (
                  <button
                    onClick={() => setPaymentAction('issue')}
                    className="text-xs font-medium text-rose-600 hover:underline"
                  >
                    Report a payment issue instead
                  </button>
                )}
                {canMutate(role) && student.payment_status === 'PAYMENT_ISSUE' && (
                  <Button variant="success" fullWidth onClick={() => setPaymentAction('received')}>
                    Record Payment Received
                  </Button>
                )}
              </div>
            </Card>
          )}

          {!canAct && (
            <div className="rounded-xl bg-ink-100 px-4 py-3 text-sm text-ink-600">
              {isDecided
                ? 'This application has already been decided.'
                : role
                  ? 'Your role is read-only — you can view this application but not change its status.'
                  : 'No dashboard role is assigned to your account yet. Contact an administrator to be granted access.'}
            </div>
          )}

          {canAct && (
            <Card title="Actions">
              <div className="space-y-2">
                <Button variant="success" fullWidth onClick={() => setActiveAction('approve')}>
                  Approve Application
                </Button>
                <Button variant="warning" fullWidth onClick={() => setActiveAction('info')}>
                  Request More Information
                </Button>
                <Button variant="danger" fullWidth onClick={() => setActiveAction('reject')}>
                  Reject / Close
                </Button>
              </div>
            </Card>
          )}

          {role === 'administrator' && (
            <Card title="Testing Tools" className="border-amber-200">
              <p className="text-sm text-ink-600">
                Rewind a stage back to re-run a flow, or fast-forward past a form by inserting test submission
                data — same effect as the student filling it in Fillout — so you don't have to fill all 4 forms
                again each time. Testing only — every action here is logged to History.
              </p>

              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                Fast-forward — submit test data (skip filling the form)
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={simulatingStage !== null}
                  onClick={() =>
                    simulateFormSubmission('Agreement', 'AGREEMENT')
                  }
                >
                  {simulatingStage === 'Agreement' ? 'Submitting…' : 'Fill Agreement (test)'}
                </Button>
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={simulatingStage !== null}
                  onClick={() =>
                    simulateFormSubmission('Conduct', 'CONDUCT')
                  }
                >
                  {simulatingStage === 'Conduct' ? 'Submitting…' : 'Fill Conduct (test)'}
                </Button>
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={simulatingStage !== null}
                  onClick={() =>
                    simulateFormSubmission('Medical', 'MEDICAL')
                  }
                >
                  {simulatingStage === 'Medical' ? 'Submitting…' : 'Fill Medical (test)'}
                </Button>
                <span />
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={simulatingStage !== null}
                  onClick={() =>
                    simulateFormSubmission('Accommodation (University)', 'ACCOMMODATION', 'University Halls')
                  }
                >
                  {simulatingStage === 'Accommodation (University)' ? 'Submitting…' : 'Fill Accom. — University (test)'}
                </Button>
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={simulatingStage !== null}
                  onClick={() =>
                    simulateFormSubmission('Accommodation (Private)', 'ACCOMMODATION', 'Private')
                  }
                >
                  {simulatingStage === 'Accommodation (Private)' ? 'Submitting…' : 'Fill Accom. — Private (test)'}
                </Button>
                <Button
                  variant="secondary"
                  className="col-span-2 h-8 px-3 text-xs"
                  disabled={simulatingStage !== null}
                  onClick={() =>
                    simulateFormSubmission('Accommodation (PBSA)', 'ACCOMMODATION', 'PBSA')
                  }
                >
                  {simulatingStage === 'Accommodation (PBSA)' ? 'Submitting…' : 'Fill Accom. — PBSA (test)'}
                </Button>
              </div>

              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                Rewind — reset a stage back to re-test it
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={resettingStage !== null}
                  onClick={() =>
                    resetStage('Payment', {
                      payment_status: 'AWAITING_PAYMENT',
                      payment_received_at: null,
                      payment_recorded_by: null,
                      payment_notes: null,
                    })
                  }
                >
                  {resettingStage === 'Payment' ? 'Resetting…' : 'Reset Payment'}
                </Button>
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={resettingStage !== null}
                  onClick={() =>
                    resetStage('Agreement', {
                      agreement_review_status: 'OUTSTANDING',
                      agreement_completed: false,
                      agreement_reviewed_by: null,
                      agreement_reviewed_at: null,
                      agreement_notes: null,
                    })
                  }
                >
                  {resettingStage === 'Agreement' ? 'Resetting…' : 'Reset Agreement'}
                </Button>
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={resettingStage !== null}
                  onClick={() =>
                    resetStage('Conduct', {
                      conduct_review_status: 'OUTSTANDING',
                      conduct_completed: false,
                      conduct_reviewed_by: null,
                      conduct_reviewed_at: null,
                      conduct_notes: null,
                    })
                  }
                >
                  {resettingStage === 'Conduct' ? 'Resetting…' : 'Reset Conduct'}
                </Button>
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={resettingStage !== null}
                  onClick={() =>
                    resetStage('Medical', {
                      medical_review_status: 'OUTSTANDING',
                      medical_completed: false,
                      medical_reviewed_by: null,
                      medical_reviewed_at: null,
                      medical_notes: null,
                    })
                  }
                >
                  {resettingStage === 'Medical' ? 'Resetting…' : 'Reset Medical'}
                </Button>
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={resettingStage !== null}
                  onClick={() =>
                    resetStage('Accommodation', {
                      accommodation_route: null,
                      accommodation_status: 'OUTSTANDING',
                      accommodation_completed: false,
                      accommodation_reviewed_by: null,
                      accommodation_reviewed_at: null,
                      accommodation_notes: null,
                    })
                  }
                >
                  {resettingStage === 'Accommodation' ? 'Resetting…' : 'Reset Accommodation'}
                </Button>
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={resettingStage !== null}
                  onClick={() =>
                    resetStage('REACH', {
                      reach_status: 'NOT_READY',
                      reach_invitation_sent_at: null,
                      reach_booking_at: null,
                      reach_meeting_at: null,
                      reach_attendance_confirmed_at: null,
                      reach_attendance_confirmed_by: null,
                    })
                  }
                >
                  {resettingStage === 'REACH' ? 'Resetting…' : 'Reset REACH'}
                </Button>
                <Button
                  variant="secondary"
                  className="col-span-2 h-8 px-3 text-xs"
                  disabled={resettingStage !== null}
                  onClick={() =>
                    resetStage('Final Registration', {
                      registration_complete: false,
                      registration_completed_at: null,
                      registration_completed_by: null,
                    })
                  }
                >
                  {resettingStage === 'Final Registration' ? 'Resetting…' : 'Reset Final Registration'}
                </Button>
              </div>
            </Card>
          )}

          {role === 'administrator' && (
            <Card title="Danger Zone" className="border-rose-200">
              <p className="text-sm text-ink-600">
                Permanently delete this student and everything tied to them — forms, parents, documents, emails,
                and audit history. This cannot be undone.
              </p>
              <Button
                variant="danger"
                fullWidth
                className="mt-4"
                onClick={() => {
                  setDeleteConfirmText('')
                  setDeleteOpen(true)
                }}
              >
                Delete Application
              </Button>
            </Card>
          )}
        </div>
      </div>

      {activeAction && (
        <Modal
          title={
            activeAction === 'approve'
              ? 'Approve Application'
              : activeAction === 'info'
                ? 'Request More Information'
                : 'Reject / Close Application'
          }
          onClose={() => {
            setActiveAction(null)
            setReason('')
            setInfoTemplateCode('')
          }}
        >
          <div className="space-y-4">
            {activeAction === 'approve' ? (
              <p className="text-sm text-ink-600">
                This will move the case to the payment stage. Payment will not be marked as received
                automatically — that remains a separate manual step.
              </p>
            ) : (
              <>
                {activeAction === 'info' && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-ink-700">Template</label>
                    <select
                      value={infoTemplateCode}
                      onChange={(e) => {
                        const code = e.target.value
                        setInfoTemplateCode(code)
                        if (!code || !student) return
                        const t = templates.find((tpl) => tpl.code === code)
                        if (!t) return
                        setReason(
                          mergeTemplate(t.body, {
                            first_name: student.first_name,
                            case_id: student.case_id,
                            university: student.university,
                            reason: '',
                          }),
                        )
                      }}
                      className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      <option value="">Write custom message</option>
                      {templates.map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink-700">
                    {activeAction === 'info' ? 'Information required' : 'Reason for rejection / closure'}
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    placeholder={
                      activeAction === 'info'
                        ? 'e.g. Please provide a clearer copy of the passport photo page.'
                        : 'e.g. Family withdrew application.'
                    }
                  />
                </div>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setActiveAction(null)
                  setReason('')
                  setInfoTemplateCode('')
                }}
              >
                Cancel
              </Button>
              <Button onClick={submitAction} disabled={submitting}>
                {submitting ? 'Saving…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {paymentAction && (
        <Modal
          title={paymentAction === 'received' ? 'Record Payment Received' : 'Report a Payment Issue'}
          onClose={() => {
            setPaymentAction(null)
            setPaymentNote('')
          }}
        >
          <div className="space-y-4">
            {paymentAction === 'received' ? (
              <p className="text-sm text-ink-600">
                Confirm that payment has actually been received in AGUK's records for this student. This
                unlocks the registration-forms stage. Do not confirm this speculatively.
              </p>
            ) : (
              <p className="text-sm text-ink-600">
                This flags the case as needing AGUK attention on payment (e.g. failed transfer, wrong amount).
              </p>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">
                Notes {paymentAction === 'issue' && <span className="text-rose-600">(required)</span>}
              </label>
              <textarea
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                placeholder={
                  paymentAction === 'received'
                    ? 'e.g. Bank transfer received 14 Aug, ref AGUK-2026-10013'
                    : 'e.g. Transfer received was short by £50'
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setPaymentAction(null)
                  setPaymentNote('')
                }}
              >
                Cancel
              </Button>
              <Button onClick={submitPayment} disabled={paymentSubmitting}>
                {paymentSubmitting ? 'Saving…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {accommodationAction && (
        <Modal
          title={accommodationAction === 'cleared' ? 'Clear Accommodation to Proceed' : 'Request Further Information'}
          onClose={() => {
            setAccommodationAction(null)
            setAccommodationNote('')
            setAccommodationTemplateCode('')
          }}
        >
          <div className="space-y-4">
            {accommodationAction === 'cleared' ? (
              <p className="text-sm text-ink-600">
                This records that AGUK has reviewed the {student.accommodation_route?.toLowerCase()} accommodation
                arrangement and it can proceed. This is an internal clearance, not confirmation of
                university/provider approval.
              </p>
            ) : (
              <>
                <p className="text-sm text-ink-600">
                  This will email {student.email ?? 'the student (no email on file)'} — pick a template or write a
                  custom note below.
                </p>
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink-700">Template</label>
                  <select
                    value={accommodationTemplateCode}
                    onChange={(e) => setAccommodationTemplateCode(e.target.value)}
                    className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    <option value="">Write custom message</option>
                    {templates.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">
                Notes {accommodationAction === 'info_required' && <span className="text-rose-600">(required)</span>}
              </label>
              <textarea
                value={accommodationNote}
                onChange={(e) => setAccommodationNote(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                placeholder={
                  accommodationAction === 'cleared'
                    ? 'e.g. Tenancy agreement verified, landlord contactable'
                    : 'e.g. Please provide a signed tenancy agreement'
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setAccommodationAction(null)
                  setAccommodationNote('')
                  setAccommodationTemplateCode('')
                }}
              >
                Cancel
              </Button>
              <Button onClick={submitAccommodationDecision} disabled={accommodationSubmitting}>
                {accommodationSubmitting ? 'Saving…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {reviewAction && (
        <Modal
          title={
            reviewAction.decision === 'approve'
              ? `Approve ${FORM_META[reviewAction.form].title}`
              : reviewAction.decision === 'reject'
                ? `Reject ${FORM_META[reviewAction.form].title}`
                : `Request More Information — ${FORM_META[reviewAction.form].title}`
          }
          onClose={() => {
            setReviewAction(null)
            setReviewNote('')
            setReviewTemplateCode('')
          }}
        >
          <div className="space-y-4">
            {reviewAction.decision === 'info' && (
              <>
                <p className="text-xs text-ink-400">
                  This will email {student.email ?? 'the student (no email on file)'} — pick a template or write a
                  custom note below.
                </p>
                <div>
                  <label className="mb-1 block text-sm font-medium text-ink-700">Template</label>
                  <select
                    value={reviewTemplateCode}
                    onChange={(e) => setReviewTemplateCode(e.target.value)}
                    className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    <option value="">Write custom message</option>
                    {templates.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">
                Notes {reviewAction.decision !== 'approve' && <span className="text-rose-600">(required)</span>}
              </label>
              <textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                placeholder={
                  reviewAction.decision === 'approve'
                    ? 'Optional note'
                    : 'e.g. Please provide a clearer copy of the signature page.'
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setReviewAction(null)
                  setReviewNote('')
                  setReviewTemplateCode('')
                }}
              >
                Cancel
              </Button>
              <Button onClick={submitFormReview} disabled={reviewSubmitting}>
                {reviewSubmitting ? 'Saving…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {reachAttendanceAction && (
        <Modal
          title={reachAttendanceAction === 'attended' ? 'Confirm Meeting Attended' : 'Confirm Meeting Not Attended'}
          onClose={() => setReachAttendanceAction(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-ink-600">
              {reachAttendanceAction === 'attended'
                ? 'This records that the REACH introductory meeting took place with this student.'
                : 'This records that the student did not attend the scheduled REACH meeting.'}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setReachAttendanceAction(null)}>
                Cancel
              </Button>
              <Button onClick={confirmReachAttendance} disabled={reachSubmitting}>
                {reachSubmitting ? 'Saving…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {finalRegAction && (
        <Modal title="Mark Registration Complete" onClose={() => setFinalRegAction(false)}>
          <div className="space-y-4">
            <p className="text-sm text-ink-600">
              This is the final, irreversible-in-spirit step for {student.first_name}'s case — it should only be
              confirmed once AGUK is genuinely done onboarding this student. It will not undo automatically.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setFinalRegAction(false)}>
                Cancel
              </Button>
              <Button variant="success" onClick={confirmFinalRegistration} disabled={finalRegSubmitting}>
                {finalRegSubmitting ? 'Saving…' : 'Confirm Registration Complete'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {deleteOpen && (
        <Modal
          title="Delete Application"
          onClose={() => {
            setDeleteOpen(false)
            setDeleteConfirmText('')
          }}
        >
          <div className="space-y-4">
            <p className="text-sm text-ink-600">
              This permanently deletes <span className="font-medium text-ink-900">{student.case_id}</span> (
              {[student.first_name, student.last_name].filter(Boolean).join(' ')}) and every record tied to it —
              forms, parents, documents, communications, and audit history. This cannot be undone.
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">
                Type <span className="font-mono text-ink-900">{student.case_id}</span> to confirm
              </label>
              <input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDeleteOpen(false)
                  setDeleteConfirmText('')
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={deleteApplication}
                disabled={deleteSubmitting || deleteConfirmText.trim() !== student.case_id}
              >
                {deleteSubmitting ? 'Deleting…' : 'Permanently Delete'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {composeOpen && (
        <Modal title="Compose Email" onClose={() => setComposeOpen(false)}>
          <div className="space-y-4">
            <p className="text-xs text-ink-400">To {student.email ?? 'Null'}</p>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Template</label>
              <select
                value={composeTemplateCode}
                onChange={(e) => applyTemplate(e.target.value)}
                className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">Write from scratch</option>
                {templates.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Subject</label>
              <input
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Body</label>
              <textarea
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                rows={8}
                className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setComposeOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submitCompose} disabled={composeSubmitting}>
                {composeSubmitting ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
