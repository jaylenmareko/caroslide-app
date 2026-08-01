'use client'

import { useState } from 'react'
import { createClient } from '@/backend/lib/supabase/client'
import { createCheckoutSession, createPortalSession, createPackCheckoutSession } from '@/backend/lib/actions'
import { PLAN_CAROUSEL_LIMITS, PLAN_PRICES, type Subscription, type Plan, type PackSize } from '@/backend/lib/plans'
// Internal Next.js import, not the public next/navigation surface -- isRedirectError isn't
// re-exported there in this Next version (checked directly against node_modules). These three
// billing actions succeed via redirect() (actions.ts), which works by THROWING a special
// digest-tagged error Next's own redirect boundary must catch to actually navigate -- a naive
// catch-all here would swallow that signal and silently break real Stripe checkout redirects,
// a far worse regression than the missing error message this fixes. Importing Next's own
// isRedirectError (rather than hand-rolling the digest-parsing) guarantees this stays in exact
// sync with whatever Next's real redirect boundary itself checks -- worth re-verifying this
// import path still resolves on any future Next.js major-version upgrade.
import { isRedirectError } from 'next/dist/client/components/redirect-error'

const PLAN_LABELS: Record<Plan, string> = { starter: 'Starter', pro: 'Pro' }
const PACK_OPTIONS: { size: PackSize; price: string }[] = [
  { size: 5, price: '$10' },
  { size: 15, price: '$25' },
]

export default function SettingsForm({
  name,
  email,
  subscription,
  creditBalance,
}: {
  name: string
  email: string
  subscription: Subscription | null
  creditBalance: number
}) {
  const [billingLoading, setBillingLoading] = useState<Plan | PackSize | 'portal' | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)

  // Real bug found in review (2026-08-01): none of these three had a catch -- a genuine failure
  // (Stripe API error, no billing account yet) threw an unhandled rejection with zero user-facing
  // feedback. A plain catch-all would be wrong here, though -- success is a THROWN redirect
  // signal (see isRedirectError's own import comment above), which must be rethrown unchanged so
  // Next's redirect boundary still performs the real navigation.
  async function handleUpgrade(plan: Plan) {
    setBillingLoading(plan)
    setBillingError(null)
    try {
      await createCheckoutSession(plan)
    } catch (err) {
      if (isRedirectError(err)) throw err
      setBillingError(err instanceof Error ? err.message : 'Something went wrong starting checkout.')
    } finally {
      setBillingLoading(null)
    }
  }

  async function handleBuyPack(size: PackSize) {
    setBillingLoading(size)
    setBillingError(null)
    try {
      await createPackCheckoutSession(size)
    } catch (err) {
      if (isRedirectError(err)) throw err
      setBillingError(err instanceof Error ? err.message : 'Something went wrong starting checkout.')
    } finally {
      setBillingLoading(null)
    }
  }

  async function handleManageBilling() {
    setBillingLoading('portal')
    setBillingError(null)
    try {
      await createPortalSession()
    } catch (err) {
      if (isRedirectError(err)) throw err
      setBillingError(err instanceof Error ? err.message : 'Something went wrong opening billing.')
    } finally {
      setBillingLoading(null)
    }
  }

  const [changingPassword, setChangingPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Real bug found in review (2026-08-01): this had no error branch at all -- a rejected
  // updateUser (password too short/weak per Supabase's own server-side rule, a network error,
  // an expired session) just silently did nothing. The button looked like it did nothing,
  // with zero indication anything went wrong.
  async function handlePasswordSave() {
    setPasswordError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setPasswordError(error.message)
      return
    }
    setPasswordSaved(true)
    setChangingPassword(false)
    setNewPassword('')
  }

  return (
    <section className="settings-section wrap">
      <h1>Settings</h1>
      <p className="lede">Your account and plan.</p>

      <div className="settings-block">
        <div className="settings-block-head">
          <div className="settings-block-icon">
            <svg viewBox="0 0 24 24" width={17} height={17} fill="none">
              <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M5 20c1.2-3.5 4-5.5 7-5.5s5.8 2 7 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h2>Account</h2>
            <p className="sub">Basic profile info.</p>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="label">Name</div>
          </div>
          <input className="settings-input" type="text" defaultValue={name} disabled />
        </div>
        <div className="settings-row">
          <div>
            <div className="label">Email</div>
          </div>
          <input className="settings-input" type="email" defaultValue={email} disabled />
        </div>
        <div className="settings-row">
          <div>
            <div className="label">Password</div>
          </div>
          {changingPassword ? (
            <div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="settings-input"
                  type="password"
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={6}
                />
                <button className="settings-link-btn" onClick={handlePasswordSave}>
                  Save
                </button>
              </div>
              {passwordError && <div className="auth-error" style={{ marginTop: 8, marginBottom: 0 }}>{passwordError}</div>}
            </div>
          ) : (
            <button className="settings-link-btn" onClick={() => setChangingPassword(true)}>
              {passwordSaved ? 'Password updated ✓' : 'Change password'}
            </button>
          )}
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-head">
          <div className="settings-block-icon">
            <svg viewBox="0 0 24 24" width={17} height={17} fill="none">
              <path d="M12 3.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.9l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h2>Plan</h2>
            <p className="sub">Your current subscription.</p>
          </div>
        </div>

        {billingError && <div className="auth-error">{billingError}</div>}

        {subscription?.status === 'active' ? (
          <>
            <div className="plan-current">
              <div>
                <span className="plan-badge">{PLAN_LABELS[subscription.plan!]}</span>
                <div className="plan-current-desc">
                  {PLAN_PRICES[subscription.plan!]} — {PLAN_CAROUSEL_LIMITS[subscription.plan!]} carousels/mo
                  {subscription.current_period_end &&
                    ` — renews ${new Date(subscription.current_period_end).toLocaleDateString()}`}
                </div>
              </div>
              <button className="settings-save" style={{ marginTop: 0 }} onClick={handleManageBilling} disabled={billingLoading !== null}>
                {billingLoading === 'portal' ? 'Loading…' : 'Manage billing'}
              </button>
            </div>
            <p className="plan-upsell">Change plans, update your card, or cancel any time.</p>
          </>
        ) : (
          <>
            <div className="plan-current">
              <div>
                <span className="plan-badge">{subscription?.status === 'past_due' ? 'Past due' : 'Free'}</span>
                <div className="plan-current-desc">
                  {subscription?.status === 'past_due' ? 'Update your card to keep generating' : '1 carousel to start'}
                </div>
              </div>
            </div>
            <div className="settings-plan-cards">
              {(['starter', 'pro'] as Plan[]).map((plan) => {
                const [amount, period] = PLAN_PRICES[plan].split('/')
                return (
                  <div key={plan} className={`settings-plan-card${plan === 'pro' ? ' featured' : ''}`}>
                    <span className="plan-badge">{PLAN_LABELS[plan]}</span>
                    <div className="settings-plan-amount">
                      {amount}
                      <span className="settings-plan-period">/{period}</span>
                    </div>
                    <p className="settings-plan-desc">{PLAN_CAROUSEL_LIMITS[plan]} carousels a month — every angle, format, and look.</p>
                    <button className="settings-save" onClick={() => handleUpgrade(plan)} disabled={billingLoading !== null}>
                      {billingLoading === plan ? 'Loading…' : `Upgrade to ${PLAN_LABELS[plan]}`}
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div className="plan-packs">
          <div className="plan-current-desc" style={{ marginTop: 0 }}>
            Carousel packs -- {creditBalance} credit{creditBalance === 1 ? '' : 's'} available
          </div>
          <div className="settings-pack-cards">
            {PACK_OPTIONS.map(({ size, price }) => (
              <div key={size} className="settings-pack-card">
                <span className="plan-badge">{size} Pack</span>
                <div className="settings-pack-amount">{price}</div>
                <p className="settings-pack-desc">{size} extra carousels, use any time -- no expiration.</p>
                <button className="settings-save" onClick={() => handleBuyPack(size)} disabled={billingLoading !== null}>
                  {billingLoading === size ? 'Loading…' : `Buy ${size} pack`}
                </button>
              </div>
            ))}
          </div>
          <p className="plan-upsell">Went over your monthly limit? Buy a pack instead of waiting for renewal.</p>
        </div>
      </div>
    </section>
  )
}
