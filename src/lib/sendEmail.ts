interface SendEmailPayload {
  to: string
  subject: string
  body: string
  student_id: string
  case_id: string | null
  template_code: string | null
  template_version: number | null
}

async function postToWebhook(
  webhookUrl: string | undefined,
  payload: object,
  missingUrlError: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!webhookUrl) return { ok: false, error: missingUrlError }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return { ok: false, error: `Webhook returned ${res.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error calling webhook' }
  }
}

export async function sendEmailViaN8n(payload: SendEmailPayload): Promise<{ ok: boolean; error?: string }> {
  return postToWebhook(import.meta.env.VITE_N8N_EMAIL_WEBHOOK_URL, payload, 'No n8n email webhook configured')
}

interface ReachInvitationPayload {
  student_id: string
  case_id: string | null
  first_name: string | null
  last_name: string | null
  email: string
  university: string | null
  course_title: string | null
}

// Dedicated REACH workflow — generates and sends the meeting-booking link
// itself, unlike the generic email webhook which just sends a pre-built
// subject/body.
export async function sendReachInvitationViaN8n(
  payload: ReachInvitationPayload,
): Promise<{ ok: boolean; error?: string }> {
  return postToWebhook(import.meta.env.VITE_N8N_REACH_WEBHOOK_URL, payload, 'No n8n REACH webhook configured')
}

interface PaymentConfirmationPayload {
  student_id: string
  case_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  university: string | null
  course_title: string | null
  parents: { first_name: string | null; last_name: string | null; email: string | null }[]
}

// Fired the moment AGUK records payment as received — sends the
// registration message to the student and both parents (parent 1 and
// parent 2, if on file). Dedicated workflow, same pattern as REACH.
export async function sendPaymentConfirmationViaN8n(
  payload: PaymentConfirmationPayload,
): Promise<{ ok: boolean; error?: string }> {
  return postToWebhook(import.meta.env.VITE_N8N_PAYMENT_WEBHOOK_URL, payload, 'No n8n payment webhook configured')
}

interface FinalRegistrationPayload {
  student_id: string
  case_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  university: string | null
  course_title: string | null
}

// Fired when AGUK marks a student's registration complete — lets n8n do
// whatever final steps it owns (welcome email, archiving, etc.).
export async function sendFinalRegistrationViaN8n(
  payload: FinalRegistrationPayload,
): Promise<{ ok: boolean; error?: string }> {
  return postToWebhook(
    import.meta.env.VITE_N8N_FINAL_REGISTRATION_WEBHOOK_URL,
    payload,
    'No n8n final registration webhook configured',
  )
}
