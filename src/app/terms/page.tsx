import Link from 'next/link'

export const metadata = { title: 'Terms of Service — Caroslide' }

export default function TermsPage() {
  return (
    <div className="legal-page">
      <div className="wrap legal-wrap">
        <Link href="/" className="brand legal-brand">
          <span>Caroslide</span>
        </Link>
        <h1>Terms of Service</h1>
        <p className="legal-updated">Last updated: July 29, 2026</p>

        <p>
          These Terms of Service (&quot;Terms&quot;) govern your use of Caroslide (&quot;Caroslide,&quot; &quot;we,&quot;
          &quot;us&quot;), a web application that generates social media carousel images from a topic or brand you
          provide, at caroslide.com. By creating an account or using Caroslide, you agree to these Terms.
        </p>

        <h2>1. The service</h2>
        <p>
          Caroslide uses AI to write, design, and render carousel images on your behalf. Generated content is
          provided as-is — review anything Caroslide produces before you publish it. You&apos;re responsible for
          what you post, including factual claims made in generated copy.
        </p>

        <h2>2. Your account</h2>
        <p>
          You&apos;re responsible for keeping your login credentials secure and for all activity under your
          account. Don&apos;t share your account, and tell us if you suspect unauthorized access.
        </p>

        <h2>3. Plans, billing, and cancellation</h2>
        <p>
          Paid plans renew automatically each month until canceled. Carousel packs are one-time purchases and
          don&apos;t expire. You can cancel or change your plan any time from Settings — cancellation stops future
          renewals but doesn&apos;t refund the current billing period. Payments are processed by Stripe; Caroslide
          never sees or stores your full card number.
        </p>

        <h2>4. Content you provide</h2>
        <p>
          You keep ownership of any text or brief you provide. You grant Caroslide the
          rights needed to process that content solely to generate your carousels — we don&apos;t use it for
          anything else, and don&apos;t sell it.
        </p>

        <h2>5. Content Caroslide generates</h2>
        <p>
          Once generated, a carousel is yours to use, edit, and publish. Photos sourced automatically during
          generation come from licensed/free-to-use sources — Caroslide does not knowingly source stock-marketplace
          or watermarked images, but you&apos;re responsible for verifying rights before commercial use if that
          matters for your situation.
        </p>

        <h2>6. Acceptable use</h2>
        <p>
          Don&apos;t use Caroslide to generate content that&apos;s illegal, harassing, or infringes someone else&apos;s
          rights, and don&apos;t try to abuse, reverse-engineer, or overload the service.
        </p>

        <h2>7. Disclaimer &amp; liability</h2>
        <p>
          Caroslide is provided &quot;as is,&quot; without warranties of any kind. To the extent allowed by law,
          Caroslide isn&apos;t liable for indirect or consequential damages arising from your use of the service.
        </p>

        <h2>8. Changes</h2>
        <p>
          We may update these Terms as the product changes. Material changes will be reflected here with an
          updated date.
        </p>

        <h2>9. Contact</h2>
        <p>Questions about these Terms: <a href="mailto:support@caroslide.com">support@caroslide.com</a></p>
      </div>
    </div>
  )
}
