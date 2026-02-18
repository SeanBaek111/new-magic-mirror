-- Magic Mirror: Supabase schema
-- Run this in the Supabase SQL Editor to set up the database.

-- Words table: stores sign language word metadata + reference landmark data
create table words (
  id text primary key,
  name text not null,
  category text default 'Uncategorised',
  video_url text,
  ref_data jsonb,
  created_at timestamptz default now()
);

-- Enable Row Level Security and allow public access via anon key
alter table words enable row level security;

create policy "Allow public select" on words for select using (true);
create policy "Allow public insert" on words for insert with check (true);
create policy "Allow public update" on words for update using (true) with check (true);
create policy "Allow public delete" on words for delete using (true);
