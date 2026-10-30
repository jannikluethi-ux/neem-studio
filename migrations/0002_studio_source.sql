-- Portable studio document and file metadata.
-- Postgres is the hosted source of truth for the document.
-- File bytes do not belong in these rows. They belong in S3-compatible object storage.
create table if not exists studio_documents (
  id text primary key,
  schema_version integer not null,
  checksum text not null,
  document jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists object_metadata (
  storage_ref text primary key,
  asset_key text not null,
  version integer not null,
  checksum text not null,
  media_type text not null,
  byte_length integer not null,
  rights_status text not null,
  created_at timestamptz not null default now()
);

create index if not exists object_metadata_asset_key_idx on object_metadata (asset_key);
