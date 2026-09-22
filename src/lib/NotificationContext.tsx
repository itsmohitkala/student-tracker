import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'

export interface AppNotification {
  id: string
  studentId: string
  caseId: string | null
  name: string
  createdAt: string
  read: boolean
}

interface NotificationState {
  notifications: AppNotification[]
  unreadCount: number
  markAllRead: () => void
}

const NotificationContext = createContext<NotificationState | undefined>(undefined)

const MAX_NOTIFICATIONS = 50

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [notifications, setNotifications] = useState<AppNotification[]>([])

  useEffect(() => {
    if (!session) return

    const channel = supabase
      .channel('students-new-applications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'students' },
        (payload) => {
          const row = payload.new as {
            student_id: string
            case_id: string | null
            first_name: string | null
            last_name: string | null
          }
          setNotifications((prev) => {
            if (prev.some((n) => n.studentId === row.student_id)) return prev
            const next: AppNotification = {
              id: `${row.student_id}-${Date.now()}`,
              studentId: row.student_id,
              caseId: row.case_id,
              name: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'New applicant',
              createdAt: new Date().toISOString(),
              read: false,
            }
            return [next, ...prev].slice(0, MAX_NOTIFICATIONS)
          })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session])

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })))
  }, [])

  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}
