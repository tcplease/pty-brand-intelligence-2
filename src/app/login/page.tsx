'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleGoogleLogin() {
    setLoading(true)
    setError('')

    const supabase = createSupabaseBrowserClient()

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError('Sign in failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex items-center justify-center">
      <div className="w-full max-w-sm p-8 animate-fade-up">
        <img
          src="/pty-logo.svg"
          alt="Please & Thank You"
          className="w-48 mx-auto mb-8"
        />
        <p style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginBottom: '24px', fontSize: '14px' }}>
          Internal access only. Sign in with your P&TY Google account.
        </p>
        {error && <p className="text-[#C3202E] text-sm text-center mb-4">{error}</p>}
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full py-3 bg-[#F9D40A] text-[#1B1B1B] font-bold rounded tracking-widest uppercase hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? 'Redirecting...' : 'Sign in with Google'}
        </button>
      </div>
    </div>
  )
}
