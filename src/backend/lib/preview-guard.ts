import { notFound } from 'next/navigation'

// Real gap found live (2026-07-29, Jaylen: "what is left before we push it out?"): the /preview/*
// routes were built as no-auth mock-data pages to visually QA the UI before a real Supabase project
// existed (see each page's own top comment) -- they were never actually pulled once the real app
// worked, and were confirmed still publicly serving (200) on caroslide.com. Blocking them in the
// production build (not deleting the files) keeps them available for local UI verification via
// `npm run dev` -- exactly what they're still used for -- while real visitors/search engines get a
// real 404 in the deployed app.
export function blockInProduction() {
  if (process.env.NODE_ENV === 'production') notFound()
}
