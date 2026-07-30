-- Real bug found live during a code review (2026-07-30): storage.objects only ever got SELECT
-- (public) and INSERT (owner-scoped) policies for both buckets (schema.sql, 002_reference_images.sql)
-- -- no DELETE policy was ever added. actions.ts calls `.storage.remove(...)` in three places to
-- clean up a replaced/orphaned slide image (createCarousel's partial-failure rollback, editSlide's
-- chat-edit image swap, the click-in-place move/resize re-render path) using the user's own
-- authenticated client, none of which check the call's error -- confirmed live with a real
-- disposable test account that a user's own delete of their own file returns a real 403
-- ("Access denied", storage's AccessDenied code). Every one of those cleanup calls has been
-- silently failing since the buckets were created -- old slide images have been accumulating in
-- Storage indefinitely with no visible symptom, since nothing ever surfaces the swallowed error.
--
-- Scoped identically to the existing owner-scoped INSERT policies (same folder-prefix-is-the-
-- user's-own-uid check) -- a user can only delete objects inside their own top-level folder,
-- same trust boundary already established for uploads.
create policy "Users delete their own carousel slides"
  on storage.objects for delete
  using (bucket_id = 'carousel-slides' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users delete their own reference images"
  on storage.objects for delete
  using (bucket_id = 'carousel-uploads' and auth.uid()::text = (storage.foldername(name))[1]);
