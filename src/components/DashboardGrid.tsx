import Link from 'next/link'
import type { Carousel } from '@/lib/types'
import { timeAgo } from '@/lib/types'

export default function DashboardGrid({ carousels }: { carousels: Carousel[] }) {
  return (
    <section className="dash-section wrap">
      <div className="dash-head">
        <h1>My Carousels</h1>
        <p>Every draft auto-saves here — click one to keep iterating.</p>
      </div>
      <div className="dash-grid">
        <Link href="/new" className="dash-card new-card">
          <div className="thumb new-card-thumb">
            <div className="plus">+</div>
          </div>
          <div className="meta">
            <div className="k">New Carousel</div>
            <div className="t">Start from scratch</div>
          </div>
        </Link>

        {carousels.map((c) => (
          <Link key={c.id} href={`/carousel/${c.id}`} className="dash-card">
            <div className="thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.slides[0]?.url} alt="" />
            </div>
            <div className="meta">
              <div className="k">{c.title}</div>
              <div className="dash-card-tags">
                <span className="dash-tag">{c.angle}</span>
                <span className="dash-tag neutral">{c.format}</span>
              </div>
              <div className="t">{timeAgo(c.updated_at)}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
