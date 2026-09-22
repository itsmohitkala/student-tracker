import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Card } from '../components/Card'
import { Modal } from '../components/Modal'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/Button'
import type { EmailTemplate } from '../types'

const EMPTY_FORM = { code: '', name: '', subject: '', body: '' }

export function Templates() {
  const { user, role } = useAuth()
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const [editing, setEditing] = useState<EmailTemplate | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<EmailTemplate | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.from('email_templates').select('*').order('name')
    if (error) setError(error.message)
    else setTemplates((data ?? []) as EmailTemplate[])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  function openCreate() {
    setForm(EMPTY_FORM)
    setEditing(null)
    setCreating(true)
  }

  function openEdit(t: EmailTemplate) {
    setForm({ code: t.code, name: t.name, subject: t.subject, body: t.body })
    setEditing(t)
    setCreating(true)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) {
        const { error } = await supabase
          .from('email_templates')
          .update({
            name: form.name,
            subject: form.subject,
            body: form.body,
            version: editing.version + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editing.id)
        if (error) throw error
        setToast({ kind: 'success', message: `Template updated (v${editing.version + 1}).` })
      } else {
        const { error } = await supabase.from('email_templates').insert({
          code: form.code.trim().toUpperCase().replace(/\s+/g, '_'),
          name: form.name.trim(),
          subject: form.subject,
          body: form.body,
          active: false,
          created_by: user?.id ?? null,
        })
        if (error) throw error
        setToast({ kind: 'success', message: 'Template created (inactive until you activate it).' })
      }
      setCreating(false)
      setEditing(null)
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to save template' })
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteSubmitting(true)
    const { error } = await supabase.from('email_templates').delete().eq('id', deleting.id)
    setDeleteSubmitting(false)
    if (error) {
      setToast({ kind: 'error', message: error.message })
    } else {
      setToast({ kind: 'success', message: 'Template deleted.' })
      setDeleting(null)
      load()
    }
  }

  async function toggleActive(t: EmailTemplate) {
    const { error } = await supabase.from('email_templates').update({ active: !t.active }).eq('id', t.id)
    if (error) setToast({ kind: 'error', message: error.message })
    else {
      setToast({ kind: 'success', message: t.active ? 'Template deactivated.' : 'Template activated.' })
      load()
    }
  }

  if (role !== 'administrator') {
    return <p className="text-sm text-rose-600">Only administrators can manage email templates.</p>
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Email Templates</h1>
          <p className="mt-1 text-sm text-ink-400">
            Only <span className="font-medium text-ink-600">active</span> templates can be used to send
            communications. Editing a template creates a new version.
          </p>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          New Template
        </Button>
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

      <div className="mt-6 space-y-3">
        {loading && (
          <>
            <div className="h-20 animate-pulse rounded-xl bg-ink-100" />
            <div className="h-20 animate-pulse rounded-xl bg-ink-100" />
          </>
        )}
        {!loading && error && <p className="text-sm text-rose-600">{error}</p>}
        {!loading && !error && templates.length === 0 && (
          <Card>
            <EmptyState title="No templates yet" description="Create your first email template above." />
          </Card>
        )}
        {!loading &&
          !error &&
          templates.map((t) => (
            <Card key={t.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-ink-900">{t.name}</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                        t.active
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                          : 'bg-ink-100 text-ink-500 ring-ink-200'
                      }`}
                    >
                      {t.active ? 'Active' : 'Inactive'}
                    </span>
                    <span className="text-[11px] text-ink-400">v{t.version}</span>
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-ink-400">{t.code}</p>
                  <p className="mt-2 text-sm text-ink-600">{t.subject}</p>
                  <p className="mt-1 truncate text-xs text-ink-400">{t.body.replace(/\n/g, ' ')}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => openEdit(t)}>
                    Edit
                  </Button>
                  <Button
                    variant={t.active ? 'danger' : 'primary'}
                    className="h-8 px-3 text-xs"
                    onClick={() => toggleActive(t)}
                  >
                    {t.active ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button variant="danger" className="h-8 px-3 text-xs" onClick={() => setDeleting(t)}>
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
      </div>

      {creating && (
        <Modal title={editing ? `Edit ${editing.name}` : 'New Template'} onClose={() => setCreating(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            {!editing && (
              <div>
                <label className="mb-1 block text-sm font-medium text-ink-700">
                  Code <span className="text-ink-400">(unique, e.g. WELCOME_EMAIL)</span>
                </label>
                <input
                  required
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Subject</label>
              <input
                required
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">
                Body <span className="text-ink-400">(use {'{{first_name}}'}, {'{{case_id}}'}, {'{{university}}'}, {'{{reason}}'})</span>
              </label>
              <textarea
                required
                rows={8}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                className="w-full rounded-md border border-ink-200 px-3 py-2 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save new version' : 'Create template'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal title="Delete Template" onClose={() => setDeleting(null)}>
          <div className="space-y-4">
            <p className="text-sm text-ink-600">
              Delete <span className="font-medium text-ink-900">{deleting.name}</span> ({deleting.code})? This
              cannot be undone. Past emails already sent using this template are unaffected — only the template
              itself is removed.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDelete} disabled={deleteSubmitting}>
                {deleteSubmitting ? 'Deleting…' : 'Delete Template'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
