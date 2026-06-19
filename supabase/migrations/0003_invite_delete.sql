-- 0003 — allow org admins to cancel (delete) pending invites.
drop policy if exists "invites admin delete" on public.org_invites;
create policy "invites admin delete" on public.org_invites for delete
  using (public.is_org_admin(org_id));
