-- Private presentation assets for imported SOPs. Access remains Worker-mediated.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sop-assets', 'sop-assets', false, 4194304, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
