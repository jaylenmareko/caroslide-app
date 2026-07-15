'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Angle, Format, Look, TemplateVariant } from '@/lib/types'

const MOCK_SLIDES: Record<string, string[]> = {
  Value: ['/mock/wagyuvalue-1.jpg', '/mock/wagyuvalue-2.jpg', '/mock/wagyuvalue-3.jpg', '/mock/wagyuvalue-4.jpg', '/mock/wagyuvalue-5.jpg'],
  Growth: ['/mock/growth-1.jpg', '/mock/growth-2.jpg', '/mock/growth-3.jpg', '/mock/growth-4.jpg', '/mock/growth-5.jpg'],
  Education: ['/mock/education-1.jpg', '/mock/education-2.jpg', '/mock/education-3.jpg', '/mock/education-4.jpg', '/mock/education-5.jpg'],
}

// TODO: this stubs slide generation with placeholder images so the wizard -> viewer
// flow works end to end. Real generation needs to call an image-rendering pipeline
// (the same template approach the `/carousel` skill uses) from a server route.
export async function createCarousel(input: {
  angle: Angle
  format: Format
  look: Look
  templateVariant: TemplateVariant | null
  brief: string
  referenceImageUrls: string[]
  brandColors: string[]
  logoUrl: string | null
  font: string
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const title = input.brief.trim().slice(0, 60) || `${input.angle} carousel`

  const { data, error } = await supabase
    .from('carousels')
    .insert({
      user_id: user!.id,
      title,
      angle: input.angle,
      format: input.format,
      look: input.look,
      template_variant: input.templateVariant,
      brief: input.brief,
      slides: MOCK_SLIDES[input.angle].map((url) => ({ url })),
      reference_images: input.referenceImageUrls.map((url) => ({ url })),
      // Snapshotted here, not read live from brand_kits at generation time --
      // see the Carousel type's brand_colors/logo_url/font comment.
      brand_colors: input.brandColors,
      logo_url: input.logoUrl,
      font: input.font,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  redirect(`/carousel/${data.id}`)
}

export async function updateCarouselTitle(id: string, title: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('carousels').update({ title }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function saveBrandKit(input: {
  colors: string[]
  logoUrl?: string | null
  font?: string
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase.from('brand_kits').upsert({
    user_id: user!.id,
    colors: input.colors,
    ...(input.logoUrl !== undefined ? { logo_url: input.logoUrl } : {}),
    ...(input.font !== undefined ? { font: input.font } : {}),
  })
  if (error) throw new Error(error.message)
}
