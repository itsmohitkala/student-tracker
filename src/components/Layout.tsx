import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { roleLabel } from '../lib/roles'
import { ThemeToggle } from './ThemeToggle'
import { NotificationBell } from './NotificationBell'

const PAGE_TITLES: Record<string, string> = {
  '/applications': 'Applications',
  '/students': 'All Students',
  '/history': 'History',
  '/users': 'Users & Roles',
  '/templates': 'Email Templates',
}

function initials(text: string | null | undefined) {
  if (!text) return '?'
  const parts = text.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : text.slice(0, 2)
  return letters.toUpperCase()
}

export function Layout() {
  const { user, role, signOut } = useAuth()
  const location = useLocation()

  const navItems = [
    { label: 'Applications', to: '/applications' },
    { label: 'All Students', to: '/students' },
    { label: 'History', to: '/history' },
    ...(role === 'administrator'
      ? [
          { label: 'Users & Roles', to: '/users' },
          { label: 'Email Templates', to: '/templates' },
        ]
      : []),
  ]

  const matchedTitle = Object.entries(PAGE_TITLES).find(([path]) => location.pathname.startsWith(path))?.[1]

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="flex min-h-screen">
        <aside className="flex w-64 shrink-0 flex-col border-r border-ink-100 bg-white">
          <div className="flex h-16 items-center gap-2.5 border-b border-ink-100 px-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-700 text-xs font-bold text-white">
              AG
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight tracking-tight text-ink-900">AGUK Admin</p>
              <p className="text-[11px] leading-tight text-ink-400">U18 Registrations</p>
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 p-3">
            <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-300">
              Operations
            </p>
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-700 text-white shadow-sm'
                      : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-ink-100 p-4">
            <p className="text-[11px] leading-relaxed text-ink-300">
              Academic Guardians UK
              <br />
              Internal staff access only
            </p>
          </div>
        </aside>

        <div className="flex flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-ink-100 bg-white px-6">
            <h1 className="text-sm font-semibold text-ink-900">{matchedTitle ?? ''}</h1>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <NotificationBell />
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600">
                {initials(user?.email)}
              </div>
              <div className="text-right leading-tight">
                <p className="text-sm font-medium text-ink-900">{user?.email}</p>
                <p className="text-[11px] uppercase tracking-wide text-ink-400">{roleLabel(role)}</p>
              </div>
              <button
                onClick={() => signOut()}
                className="rounded-md border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:border-ink-300 hover:bg-ink-50"
              >
                Sign out
              </button>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
