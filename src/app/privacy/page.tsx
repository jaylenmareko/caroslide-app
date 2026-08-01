import Link from 'next/link'

export const metadata = { title: 'Privacy Policy — Caroslide' }

export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <div className="wrap legal-wrap">
        <Link href="/" className="brand legal-brand">
          <span>Caroslide</span>
        </Link>
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: July 29, 2026</p>

        <p>
          This Privacy Policy explains what Caroslide collects and how it&apos;s used. Caroslide is a small,
          independently-run product — we collect only what&apos;s needed to run the service.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>Account info: name, email, password (stored hashed, never in plain text).</li>
          <li>Content you create: topics, briefs, and the carousels Caroslide generates for you (including the colors, logo, and font chosen for each one).</li>
          <li>Billing info: handled entirely by Stripe — Caroslide stores your plan/subscription status, not your card details.</li>
          <li>Basic usage data (e.g. generation timestamps) needed to enforce plan limits and prevent abuse.</li>
        </ul>

        <h2>How we use it</h2>
        <p>
          To generate your carousels, run your account and billing, and keep the service secure. Generating a
          carousel may involve sending your topic/brief to Anthropic&apos;s Claude API (for writing) and to
          third-party photo/search providers (to source relevant images) — only what&apos;s needed to complete that
          generation is sent, and it isn&apos;t used to train models we control.
        </p>

        <h2>Where it&apos;s stored</h2>
        <p>
          Account data and generated content are stored in Supabase (Postgres + file storage). The app itself runs
          on Cloudflare. We don&apos;t sell your personal information to third parties.
        </p>

        <h2>Your choices</h2>
        <p>
          You can delete any carousel at any time from the app. To delete your account
          entirely, contact us and we&apos;ll remove your data from our systems.
        </p>

        <h2>Cookies</h2>
        <p>Caroslide uses only the cookies needed to keep you signed in — no third-party ad tracking.</p>

        <h2>Changes</h2>
        <p>We may update this policy as the product changes. Material changes will be reflected here with an updated date.</p>

        <h2>Contact</h2>
        <p>Questions about this policy: <a href="mailto:support@caroslide.com">support@caroslide.com</a></p>
      </div>
    </div>
  )
}
