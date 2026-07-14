'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { saveBrandKit } from '@/lib/actions'
import type { BrandKit } from '@/lib/types'

export default function SettingsForm({
  name,
  email,
  brandKit,
}: {
  name: string
  email: string
  brandKit: BrandKit | null
}) {
  const [changingPassword, setChangingPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)

  const [colors, setColors] = useState<string[]>(brandKit?.colors ?? ['#5B7A5E', '#F1E6D2', '#16130f'])
  const [voice, setVoice] = useState(brandKit?.voice_description ?? '')
  const [brandSaved, setBrandSaved] = useState(false)

  async function handlePasswordSave() {
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (!error) {
      setPasswordSaved(true)
      setChangingPassword(false)
      setNewPassword('')
    }
  }

  async function handleBrandSave() {
    await saveBrandKit({ colors, voiceDescription: voice })
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
              Save your colors, logo, and voice once — every new carousel starts pre-filled with this instead of asking every time.
            </p>
          </div>
        </div>

        <div className="settings-field-label">Colors</div>
        <div className="brand-swatches">
          {colors.map((c, i) => (
            <div key={i} className="brand-swatch" style={{ background: c }} />
          ))}
          <div className="brand-swatch add">+</div>
        </div>

        <div className="settings-field-label">Logo</div>
        <div className="brand-logo-upload">Drop your logo here, or click to upload</div>

        <div className="settings-field-label">Voice &amp; tone</div>
        <textarea
          className="brand-desc"
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          placeholder="Cream + forest-green earth tones. Minimal, confident, a little playful — never corporate-stiff."
        />
        <br />
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

        <div className="plan-current">
          <div>
            <span className="plan-badge">Free</span>
            <div className="plan-current-desc">3 carousels / month</div>
          </div>
          <button className="settings-save" style={{ marginTop: 0 }}>
            Upgrade
          </button>
        </div>
        <p className="plan-upsell">Upgrade for unlimited carousels, priority generation, and more saved brand kits.</p>
      </div>
    </section>
  )
}
