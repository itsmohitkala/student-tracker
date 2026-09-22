import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { NotificationProvider } from './lib/NotificationContext'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { ResetPassword } from './pages/ResetPassword'
import { Applications } from './pages/Applications'
import { ApplicationDetail } from './pages/ApplicationDetail'
import { Users } from './pages/Users'
import { Templates } from './pages/Templates'
import { History } from './pages/History'
import { AllStudents } from './pages/AllStudents'

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink-400">
        Loading…
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/applications" element={<Applications />} />
        <Route path="/applications/:id" element={<ApplicationDetail />} />
        <Route path="/students" element={<AllStudents />} />
        <Route path="/history" element={<History />} />
        <Route path="/users" element={<Users />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/" element={<Navigate to="/applications" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/applications" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <AppRoutes />
      </NotificationProvider>
    </AuthProvider>
  )
}
