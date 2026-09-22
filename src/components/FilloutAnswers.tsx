interface FilloutQuestion {
  id: string
  name: string
  type: string
  value: unknown
}

interface FilloutDocument {
  id: string
  url: string
  name: string
}

interface FilloutRawJson {
  formId?: string
  formName?: string
  submission?: {
    questions?: FilloutQuestion[]
    documents?: FilloutDocument[]
    submissionTime?: string
  }
}

interface Group {
  title: string
  test: (name: string) => boolean
}

const GROUPS: Group[] = [
  { title: 'Parent 1', test: (n) => /^parent\s*1\s*:/i.test(n) || /^parent (first|last) name\s*:/i.test(n) },
  { title: 'Parent 2', test: (n) => /^parent\s*2\s*:/i.test(n) },
  { title: 'Passport', test: (n) => /passport/i.test(n) },
  { title: 'University & Course', test: (n) => /university|course|campus|accommodation/i.test(n) },
  { title: 'Medical & Welfare', test: (n) => /allerg|medical|dietary|medication/i.test(n) },
  { title: 'Consent & Signature', test: (n) => /signature|agree|consent|fast track|^date$/i.test(n) },
  { title: 'Contact Details', test: (n) => /email|mobile|phone|whatsapp/i.test(n) },
  {
    title: 'Personal Information',
    test: (n) => /^(first name|last name|english name)|gender|date of birth|home address/i.test(n),
  },
]

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i

function isFileArray(value: unknown): value is { url: string; filename?: string }[] {
  return Array.isArray(value) && value.every((v) => v && typeof v === 'object' && 'url' in v)
}

function isAddress(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'address' in value
}

function looksLikeDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
}

function isImageFile(url: string, filename?: string) {
  return IMAGE_EXTENSIONS.test(filename ?? '') || IMAGE_EXTENSIONS.test(url.split('?')[0])
}

function formatValue(q: FilloutQuestion) {
  const { value, type } = q

  if (value === null || value === undefined || value === '') return { kind: 'text' as const, text: 'Null' }

  if (isFileArray(value)) {
    return {
      kind: 'files' as const,
      files: value.map((f, i) => ({
        url: f.url,
        label: f.filename || `File ${i + 1}`,
        isImage: isImageFile(f.url, f.filename),
      })),
    }
  }

  if (isAddress(value)) {
    const parts = [value.address, value.city, value.state, value.zipCode, value.country].filter(Boolean)
    return { kind: 'text' as const, text: parts.join(', ') || 'Null' }
  }

  if (Array.isArray(value)) {
    return { kind: 'text' as const, text: value.length ? value.join(', ') : 'Null' }
  }

  if (type === 'Checkbox' && typeof value === 'boolean') {
    return { kind: 'text' as const, text: value ? 'Yes' : 'No' }
  }

  if (looksLikeDate(value)) {
    return { kind: 'text' as const, text: new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  }

  return { kind: 'text' as const, text: String(value) }
}

function shortLabel(name: string) {
  return name.replace(/^Parent \d\s*:\s*/i, '')
}

function AnswerRow({ q }: { q: FilloutQuestion }) {
  const formatted = formatValue(q)
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{shortLabel(q.name)}</p>
      {formatted.kind === 'files' ? (
        <div className="mt-1.5 flex flex-wrap gap-3">
          {formatted.files.map((f, i) =>
            f.isImage ? (
              <a
                key={i}
                href={f.url}
                target="_blank"
                rel="noreferrer"
                title={f.label}
                className="inline-block rounded-md border border-ink-200 p-1 transition-shadow hover:shadow-md"
                style={{ backgroundColor: '#ffffff' }}
              >
                <img src={f.url} alt={f.label} className="h-24 w-24 object-contain" />
              </a>
            ) : (
              <a
                key={i}
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
              >
                {f.label}
              </a>
            ),
          )}
        </div>
      ) : (
        <p className="mt-0.5 break-words text-sm text-ink-900">{formatted.text}</p>
      )}
    </div>
  )
}

function Section({ title, questions }: { title: string; questions: FilloutQuestion[] }) {
  if (questions.length === 0) return null
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-500">{title}</p>
      <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
        {questions.map((q) => (
          <AnswerRow key={q.id} q={q} />
        ))}
      </div>
    </div>
  )
}

export function FilloutAnswers({ rawJson }: { rawJson: unknown }) {
  const parsed = rawJson as FilloutRawJson | null
  const questions = parsed?.submission?.questions ?? []
  const documents = parsed?.submission?.documents ?? []

  if (questions.length === 0 && documents.length === 0) {
    return <p className="text-sm text-ink-400">No submitted form answers found.</p>
  }

  const remaining = [...questions]
  const grouped = GROUPS.map((g) => {
    const matched = remaining.filter((q) => g.test(q.name))
    matched.forEach((q) => {
      const idx = remaining.indexOf(q)
      if (idx !== -1) remaining.splice(idx, 1)
    })
    return { title: g.title, questions: matched }
  }).filter((g) => g.questions.length > 0)

  if (remaining.length > 0) grouped.push({ title: 'Other', questions: remaining })

  return (
    <div className="divide-y divide-ink-100">
      {grouped.map((g, i) => (
        <div key={g.title} className={i === 0 ? 'pb-6' : 'py-6 last:pb-0'}>
          <Section title={g.title} questions={g.questions} />
        </div>
      ))}

      {documents.length > 0 && (
        <div className="pt-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-500">Generated Documents</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {documents.map((d) => (
              <a
                key={d.id}
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
              >
                {d.name}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
