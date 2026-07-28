-- Chat-edit abuse guard (2026-07-28). editSlide is the only chat-edit surface that spends real AI
-- tokens per request (at minimum one Haiku classification call, up to Opus for copy_rewrite) -- the
-- click-in-place editor (drag/type/pick-swatch) never calls an LLM at all, so it isn't rate-limited
-- here. This is a bot/abuse backstop, not a plan-tier feature limit (Jaylen: real per-edit cost is
-- sub-cent to a few cents, a normal user iterating a lot costs a couple dollars over a plan's whole
-- lifetime, not worth capping) -- the threshold in code is set high enough that no human hand-typing
-- and waiting for each reply could ever hit it, only a script hammering the endpoint could.
--
-- One row per accepted chat-edit REQUEST, not per successful edit -- a request the classifier marks
-- 'ambiguous'/'clarify' still spent the classification call, so it still counts. A ledger of
-- timestamps, not a counter, because the actual check ("how many in the last N seconds") needs the
-- individual timestamps -- a stored counter can't answer that without its own decay logic.
create table if not exists public.chat_edit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.chat_edit_events enable row level security;

-- Written by the same user-session (anon-key + RLS) client editSlide already uses for everything
-- else -- not a service-role table -- so a user needs insert/select/delete on their OWN rows: select
-- to count their own recent requests, insert to log a new one, delete for the opportunistic
-- old-row cleanup in code (see actions.ts) that keeps this table from growing forever without
-- needing a cron job.
create policy "Users manage their own chat-edit events"
  on public.chat_edit_events for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index chat_edit_events_user_created_idx on public.chat_edit_events (user_id, created_at);
