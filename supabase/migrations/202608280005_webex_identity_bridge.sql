-- Keep the OIDC login subject separate from Webex's canonical message person id.

alter table public.users add column if not exists webex_oidc_subject text;

update public.users
set webex_oidc_subject = webex_person_id
where webex_oidc_subject is null;

alter table public.users alter column webex_oidc_subject set not null;

create unique index if not exists users_organization_webex_oidc_subject_key
  on public.users(organization_id, webex_oidc_subject);
