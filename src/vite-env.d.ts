/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_N8N_EMAIL_WEBHOOK_URL?: string
  readonly VITE_N8N_REACH_WEBHOOK_URL?: string
  readonly VITE_N8N_FINAL_REGISTRATION_WEBHOOK_URL?: string
  readonly VITE_N8N_PAYMENT_WEBHOOK_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
