-- Tamayoz Store - safe repair (does not delete products/orders and does not overwrite product data)
-- Run this file ONCE in Supabase > SQL Editor.

-- 1) Storage first. No explicit BEGIN/COMMIT, so a later schema issue cannot roll this bucket back.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'products',
  'products',
  true,
  10485760,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admin can read product files" on storage.objects;
create policy "Admin can read product files"
on storage.objects for select
to authenticated
using (bucket_id = 'products');

drop policy if exists "Admin can upload product files" on storage.objects;
create policy "Admin can upload product files"
on storage.objects for insert
to authenticated
with check (bucket_id = 'products');

drop policy if exists "Admin can update product files" on storage.objects;
create policy "Admin can update product files"
on storage.objects for update
to authenticated
using (bucket_id = 'products')
with check (bucket_id = 'products');

drop policy if exists "Admin can delete product files" on storage.objects;
create policy "Admin can delete product files"
on storage.objects for delete
to authenticated
using (bucket_id = 'products');

-- 2) Create the tables the current site expects, ONLY if they do not already exist.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null,
  price numeric(10,2) not null check (price >= 0),
  old_price numeric(10,2) check (old_price is null or old_price >= 0),
  category text not null default 'uncategorized',
  image_url text not null,
  description text not null default '',
  featured boolean not null default false,
  active boolean not null default true,
  in_stock boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  customer_name text not null,
  phone text not null,
  address text not null,
  shipping_zone text not null,
  shipping_name text not null,
  shipping_fee numeric(10,2) not null default 0,
  subtotal numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  items jsonb not null default '[]'::jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

-- Add expected columns if an older copy of the tables exists.
alter table public.products add column if not exists sku text;
alter table public.products add column if not exists name text;
alter table public.products add column if not exists price numeric(10,2);
alter table public.products add column if not exists old_price numeric(10,2);
alter table public.products add column if not exists category text default 'uncategorized';
alter table public.products add column if not exists image_url text;
alter table public.products add column if not exists description text default '';
alter table public.products add column if not exists featured boolean default false;
alter table public.products add column if not exists active boolean default true;
alter table public.products add column if not exists in_stock boolean default true;
alter table public.products add column if not exists sort_order integer default 0;
alter table public.products add column if not exists created_at timestamptz default now();
alter table public.products add column if not exists updated_at timestamptz default now();

-- Unique SKU, but don't fail if an older table already contains duplicate SKUs.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass and conname = 'products_sku_key'
  ) then
    begin
      alter table public.products add constraint products_sku_key unique (sku);
    exception when unique_violation then
      raise notice 'Skipped products_sku_key because duplicate legacy SKUs exist.';
    end;
  end if;
end $$;

-- 3) Normalize only category values; no product rows are deleted and prices/names/images are untouched.
alter table public.products drop constraint if exists products_category_check;
update public.products
set category = '1-2.5'
where category in ('1-2-5', '1-2-5-years', '1-2.5-years', '1-2');
update public.products
set category = 'uncategorized'
where category is null
   or category not in ('0-12','1-2.5','3-5','6-11','uncategorized');
alter table public.products
  add constraint products_category_check
  check (category in ('0-12','1-2.5','3-5','6-11','uncategorized'));

-- 4) updated_at trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

-- 5) RLS / grants expected by the storefront and admin.
alter table public.products enable row level security;
alter table public.orders enable row level security;

revoke all on table public.products from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
grant select on table public.products to anon;
grant select, insert, update, delete on table public.products to authenticated;
grant insert on table public.orders to anon, authenticated;
grant select, update on table public.orders to authenticated;

do $$
begin
  if to_regclass('public.orders_id_seq') is not null then
    execute 'grant usage, select on sequence public.orders_id_seq to anon, authenticated';
  end if;
end $$;

drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products"
on public.products for select to anon
using (coalesce(active, true) = true);

drop policy if exists "Admin can read all products" on public.products;
create policy "Admin can read all products"
on public.products for select to authenticated using (true);

drop policy if exists "Admin can add products" on public.products;
create policy "Admin can add products"
on public.products for insert to authenticated with check (true);

drop policy if exists "Admin can edit products" on public.products;
create policy "Admin can edit products"
on public.products for update to authenticated using (true) with check (true);

drop policy if exists "Admin can delete products" on public.products;
create policy "Admin can delete products"
on public.products for delete to authenticated using (true);

drop policy if exists "Visitors can create orders" on public.orders;
create policy "Visitors can create orders"
on public.orders for insert to anon, authenticated with check (true);

drop policy if exists "Admin can read orders" on public.orders;
create policy "Admin can read orders"
on public.orders for select to authenticated using (true);

drop policy if exists "Admin can update orders" on public.orders;
create policy "Admin can update orders"
on public.orders for update to authenticated using (true) with check (true);

-- 6) Final check. Both values should be TRUE.
select
  to_regclass('public.products') is not null as products_table_ready,
  exists(select 1 from storage.buckets where id = 'products') as bucket_ready;

select category, count(*) as products_count
from public.products
group by category
order by category;
