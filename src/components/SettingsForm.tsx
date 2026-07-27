'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { saveBrandKit, createCheckoutSession, createPortalSession, createPackCheckoutSession } from '@/lib/actions'
import type { BrandKit } from '@/lib/types'
import { MAX_ATTACHMENT_MB, BRAND_FONTS, DEFAULT_BRAND_FONT } from '@/lib/types'
import type { Subscription, Plan, PackSize } from '@/lib/stripe'

const PLAN_LABELS: Record<Plan, string> = { starter: 'Starter', pro: 'Pro' }
const PACK_OPTIONS: { size: PackSize; price: string }[] = [
  { size: 5, price: '$10' },
  { size: 15, price: '$25' },
]

export default function SettingsForm({
  name,
  email,
  brandKit,
  subscription,
  creditBalance,
}: {
  name: string
  email: string
  brandKit: BrandKit | null
  subscription: Subscription | null
  creditBalance: number
}) {
  const [billingLoading, setBillingLoading] = useState<Plan | PackSize | 'portal' | null>(null)

  async function handleUpgrade(plan: Plan) {
    setBillingLoading(plan)
    try {
      await createCheckoutSession(plan)
    } finally {
      setBillingLoading(null)
    }
  }

  async function handleBuyPack(size: PackSize) {
    setBillingLoading(size)
    try {
      await createPackCheckoutSession(size)
    } finally {
      setBillingLoading(null)
    }
  }

  async function handleManageBilling() {
    setBillingLoading('portal')
    try {
      await createPortalSession()
    } finally {
      setBillingLoading(null)
    }
  }

  const [changingPassword, setChangingPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)

  const [colors, setColors] = useState<string[]>(brandKit?.colors ?? ['#5B7A5E', '#F1E6D2', '#16130f'])
  const [logoUrl, setLogoUrl] = useState<string | null>(brandKit?.logo_url ?? null)
  const [font, setFont] = useState(brandKit?.font ?? DEFAULT_BRAND_FONT)
  const [voiceDescription, setVoiceDescription] = useState(brandKit?.voice_description ?? '')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [brandSaved, setBrandSaved] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  async function handlePasswordSave() {
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (!error) {
      setPasswordSaved(true)
      setChangingPassword(false)
      setNewPassword('')
    }
  }

  function handleLogoClick() {
    logoInputRef.current?.click()
  }

  async function handleLogoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setLogoError(null)

    if (!file.type.startsWith('image/')) {
      setLogoError('Logo must be an image file.')
      return
    }
    if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
      setLogoError(`Logo must be under ${MAX_ATTACHMENT_MB}MB.`)
      return
    }

    setUploadingLogo(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const path = `${user?.id}/logo-${crypto.randomUUID()}-${file.name}`
    const { data, error } = await supabase.storage.from('carousel-uploads').upload(path, file)
    setUploadingLogo(false)

    if (error || !data) {
      setLogoError('Upload failed — try again.')
      return
    }
    const { data: pub } = supabase.storage.from('carousel-uploads').getPublicUrl(data.path)
    setLogoUrl(pub.publicUrl)
  }

  function handleRemoveLogo() {
    setLogoUrl(null)
  }

  async function handleBrandSave() {
    await saveBrandKit({ colors, logoUrl, font, voiceDescription: voiceDescription.trim() || null })
    setBrandSaved(true)
    setTimeout(() => setBrandSaved(false), 2000)
  }

  return (
    <section className="settings-section wrap">
      <h1>Settings</h1>
      <p className="lede">Your account, brand defaults, and plan.</p>

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
              <circle cx="7" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="17" cy="6.5" r="2.4" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="17" cy="17.5" r="2.4" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </div>
          <div>
            <h2>Brand Kit</h2>
            <p className="sub">
              Save your colors and logo once — every new carousel starts pre-filled with this instead of asking every time.
            </p>
          </div>
        </div>

        <div className="settings-field-label">Colors</div>
        <div className="brand-color-picker">
          {colors.map((c, i) => (
            <div key={i} className="brand-color-card">
              <label className="color-swatch-input" style={{ background: c }}>
                <input
                  type="color"
                  value={c}
                  aria-label={`Brand color ${i + 1}`}
                  onChange={(e) => {
                    const next = [...colors]
                    next[i] = e.target.value
                    setColors(next)
                  }}
                />
              </label>
              <input
                type="text"
                className="hex-input"
                value={c}
                aria-label={`Brand color ${i + 1} hex code`}
                maxLength={7}
                placeholder="#000000"
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const v = '#' + e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
                  const next = [...colors]
                  next[i] = v
                  setColors(next)
                }}
              />
              <div className="brand-color-label">Color {i + 1}</div>
            </div>
          ))}
        </div>

        <div className="settings-field-label">Logo</div>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleLogoSelected}
        />
        {logoUrl ? (
          <div className="brand-logo-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="Brand logo" />
            <div className="brand-logo-preview-actions">
              <button type="button" className="settings-link-btn" onClick={handleLogoClick}>
                Replace
              </button>
              <button type="button" className="settings-link-btn danger" onClick={handleRemoveLogo}>
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="brand-logo-upload" onClick={handleLogoClick}>
            {uploadingLogo ? 'Uploading…' : 'Drop your logo here, or click to upload'}
          </div>
        )}
        {logoError && <p className="attach-limit-error">{logoError}</p>}

        <div className="settings-field-label">Font</div>
        <div className="brand-font-row">
          {BRAND_FONTS.map((f) => (
            <button
              type="button"
              key={f.name}
              className={`brand-font-chip${font === f.name ? ' selected' : ''}`}
              style={{ fontFamily: f.cssVar }}
              onClick={() => setFont(f.name)}
            >
              {f.name}
            </button>
          ))}
        </div>
        <p className="wiz-step-hint" style={{ margin: '0 0 18px' }}>
          Skip this and every carousel uses {DEFAULT_BRAND_FONT} by default.
        </p>

        <div className="settings-field-label">Voice &amp; Tone</div>
        <textarea
          className="settings-textarea"
          placeholder="Who you are, who you're talking to, and how you sound — a founder detail, your real audience, a phrase you always use. This shapes the topic and tone of every carousel."
          value={voiceDescription}
          onChange={(e) => setVoiceDescription(e.target.value)}
        />
        <p className="wiz-step-hint" style={{ margin: '0 0 18px' }}>
          Optional, but the more specific the better — a real detail beats a generic description.
        </p>

        <button className="settings-save" onClick={handleBrandSave}>
          {brandSaved ? 'Saved ✓' : 'Save brand kit'}
        </button>
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

        {subscription?.status === 'active' ? (
          <>
            <div className="plan-current">
              <div>
                <span className="plan-badge">{PLAN_LABELS[subscription.plan!]}</span>
                <div className="plan-current-desc">
                  {subscription.current_period_end &&
                    `Renews ${new Date(subscription.current_period_end).toLocaleDateString()}`}
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
            <div className="plan-upgrade-row">
              {(['starter', 'pro'] as Plan[]).map((plan) => (
                <button
                  key={plan}
                  className="settings-save"
                  style={{ marginTop: 0 }}
                  onClick={() => handleUpgrade(plan)}
                  disabled={billingLoading !== null}
                >
                  {billingLoading === plan ? 'Loading…' : `Upgrade to ${PLAN_LABELS[plan]}`}
                </button>
              ))}
            </div>
            <p className="plan-upsell">Upgrade for more carousels a month, priority generation, and a saved Brand Kit.</p>
          </>
        )}

        <div className="plan-packs">
          <div className="plan-current-desc" style={{ marginTop: 0 }}>
            Carousel packs -- {creditBalance} credit{creditBalance === 1 ? '' : 's'} available
          </div>
          <div className="plan-upgrade-row">
            {PACK_OPTIONS.map(({ size, price }) => (
              <button
                key={size}
                className="settings-save"
                style={{ marginTop: 0 }}
                onClick={() => handleBuyPack(size)}
                disabled={billingLoading !== null}
              >
                {billingLoading === size ? 'Loading…' : `${size} carousels -- ${price}`}
              </button>
            ))}
          </div>
          <p className="plan-upsell">Went over your monthly limit? Buy a pack instead of waiting for renewal.</p>
        </div>
      </div>
    </section>
  )
}
