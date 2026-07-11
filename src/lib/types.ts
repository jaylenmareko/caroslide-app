export type Angle = 'Value' | 'Growth' | 'Education'
export type Format = 'Post' | 'Square' | 'Story'
export type Look = 'Circles + Photo' | 'Plain Text' | 'Bold Stat'

export type Slide = {
  url: string
}

export type Carousel = {
  id: string
  user_id: string
  title: string
  angle: Angle
  format: Format
  look: Look
  brief: string | null
  slides: Slide[]
  created_at: string
  updated_at: string
}

export type BrandKit = {
  user_id: string
  colors: string[]
  logo_url: string | null
  voice_description: string | null
  updated_at: string
}

export const ANGLE_TO_LOOK: Record<Angle, Look> = {
  Value: 'Bold Stat',
  Growth: 'Plain Text',
  Education: 'Circles + Photo',
}

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} minutes ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`
  const weeks = Math.floor(days / 7)
  return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
}
