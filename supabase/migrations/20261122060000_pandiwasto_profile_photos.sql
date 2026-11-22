begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-photos', 'player-photos', false, 262144, array['image/jpeg']);

create policy "Players can read their own photos" on storage.objects for select to authenticated
using (bucket_id = 'player-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Players can upload their own photos" on storage.objects for insert to authenticated
with check (
  bucket_id = 'player-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.jpg$'
);

create policy "Players can remove their own photos" on storage.objects for delete to authenticated
using (bucket_id = 'player-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
