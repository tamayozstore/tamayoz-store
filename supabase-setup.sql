-- Tamayoz Store - Supabase setup
-- شغّل الملف بالكامل مرة واحدة من Supabase Dashboard > SQL Editor.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null,
  price numeric(10,2) not null check (price >= 0),
  old_price numeric(10,2) check (old_price is null or old_price >= 0),
  category text not null default 'uncategorized'
    check (category in ('0-12','1-2.5','3-5','6-11','uncategorized')),
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
  status text not null default 'new'
    check (status in ('new','confirmed','shipped','delivered','cancelled')),
  created_at timestamptz not null default now()
);

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

-- أقل صلاحيات ممكنة للواجهة العامة ولوحة الإدارة.
alter table public.products enable row level security;
alter table public.orders enable row level security;

revoke all on table public.products from anon, authenticated;
revoke all on table public.orders from anon, authenticated;

grant select on table public.products to anon;
grant select, insert, update, delete on table public.products to authenticated;

grant insert on table public.orders to anon, authenticated;
grant select, update on table public.orders to authenticated;
grant usage, select on sequence public.orders_id_seq to anon, authenticated;

drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products"
on public.products for select
to anon
using (active = true);

drop policy if exists "Admin can read all products" on public.products;
create policy "Admin can read all products"
on public.products for select
to authenticated
using (true);

drop policy if exists "Admin can add products" on public.products;
create policy "Admin can add products"
on public.products for insert
to authenticated
with check (true);

drop policy if exists "Admin can edit products" on public.products;
create policy "Admin can edit products"
on public.products for update
to authenticated
using (true)
with check (true);

drop policy if exists "Admin can delete products" on public.products;
create policy "Admin can delete products"
on public.products for delete
to authenticated
using (true);

drop policy if exists "Visitors can create orders" on public.orders;
create policy "Visitors can create orders"
on public.orders for insert
to anon, authenticated
with check (
  char_length(customer_name) between 2 and 100
  and char_length(phone) between 10 and 20
  and char_length(address) between 3 and 500
  and total >= 0
);

drop policy if exists "Admin can read orders" on public.orders;
create policy "Admin can read orders"
on public.orders for select
to authenticated
using (true);

drop policy if exists "Admin can update orders" on public.orders;
create policy "Admin can update orders"
on public.orders for update
to authenticated
using (true)
with check (true);

-- Bucket عام للصور: العرض متاح للجميع، والرفع/الحذف للمستخدم المسجل فقط.
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

-- المنتجات الموجودة بالفعل في الملفات التي أرسلتها.
-- المنتجات المميزة غير الموجودة في صفحة 0-12 تُحفظ بدون فئة بدل افتراض عمر غير مذكور في المصدر.
insert into public.products
  (sku, name, price, old_price, category, image_url, description, featured, active, in_stock, sort_order)
values
  ('legacy-0-12-001', 'سجادة مائية حسية (دائرة)', 220, null, '0-12', 'IMG_٢٠٢٦٠٩٠١_٢١٥١٤٠.jpg', '', true, true, true, 1),
  ('legacy-0-12-002', 'باكت شخاليل 10 قطع', 240, 290, '0-12', 'IMG_٢٠٢٦٠٨١٧_٢١٣٦٤٥.png', '', false, true, true, 2),
  ('legacy-0-12-003', 'فيل صوت ونور', 150, 190, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٢٨٤٧.jpg', '', false, true, true, 3),
  ('legacy-0-12-004', 'شخليلة سوفت', 100, 130, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٢٩٠٢.jpg', '', false, true, true, 4),
  ('legacy-0-12-005', 'سجادة بيانو', 600, 650, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٢٩١٨.jpg', '', false, true, true, 5),
  ('legacy-0-12-006', 'كور سيليكون 8 قطع', 400, null, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٢٩٣٢.jpg', '', false, true, true, 6),
  ('legacy-0-12-007', 'شخليلة سوفت طويلة', 120, 150, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٠٠٧.jpg', '', false, true, true, 7),
  ('legacy-0-12-008', 'ريموت سيليكون', 180, 220, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٠٣٠.jpg', '', false, true, true, 8),
  ('legacy-0-12-009', 'كروت أبيض وأسود', 150, 180, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٠٤٧.jpg', '', false, true, true, 9),
  ('legacy-0-12-010', 'كتاب قماش', 55, 75, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣١٠٩.jpg', '', false, true, true, 10),
  ('legacy-0-12-011', 'باونسر', 1300, 1500, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣١٢٠.jpg', '', false, true, true, 11),
  ('legacy-0-12-012', 'مشاية وترابيزة', 1300, 1500, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٢٥٩.jpg', '', false, true, true, 12),
  ('legacy-0-12-013', 'رولي بولي', 180, 220, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٣٢٥.jpg', '', false, true, true, 13),
  ('legacy-0-12-014', 'شبكة بط', 40, 60, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٣٣٣.jpg', '', false, true, true, 14),
  ('legacy-0-12-015', 'كابوريا', 180, 220, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٣٤٨.jpg', '', false, true, true, 15),
  ('legacy-0-12-016', 'قطار بطة', 180, 220, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٤٠٢.jpg', '', false, true, true, 16),
  ('legacy-0-12-017', 'باكت شخاليل 7 قطع', 200, 240, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٤٢٠.jpg', '', false, true, true, 17),
  ('legacy-0-12-018', 'شخليلة سوفت رمادي', 100, 130, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٤٤٤.jpg', '', false, true, true, 18),
  ('legacy-0-12-019', 'أساور يد بيبي', 140, 170, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٤٥٣.jpg', '', false, true, true, 19),
  ('legacy-0-12-020', 'عمود حلقات بلاستيك', 120, 150, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٥٠٧.jpg', '', false, true, true, 20),
  ('legacy-0-12-021', 'عضاضة فواكه', 75, 90, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٥١٤.jpg', '', false, true, true, 21),
  ('legacy-0-12-022', 'مطرقة مرحة', 270, 300, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٥٢٣.jpg', '', false, true, true, 22),
  ('legacy-0-12-023', 'سجادة فوم لوكس (١٨٠×٢٠٠ سم، سمك ١ سم)', 800, null, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٥٤٠.jpg', '', false, true, true, 23),
  ('legacy-0-12-024', 'برج تدحرج', 230, 260, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٦٠٨.jpg', '', false, true, true, 24),
  ('legacy-0-12-025', 'بيض تطابق 6 قطع', 120, 150, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٦٢٠.jpg', '', false, true, true, 25),
  ('legacy-0-12-026', 'بوكس شخاليل 11 قطعة', 300, 330, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٦٣٣.jpg', '', false, true, true, 26),
  ('legacy-0-12-027', 'ببرونة لعبة', 230, 260, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٦٤٦.jpg', '', false, true, true, 27),
  ('legacy-0-12-028', 'بيت كور مع 50 كرة', 520, 600, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٦٥٨.jpg', '', false, true, true, 28),
  ('legacy-0-12-029', 'عضاضة شكل فاكهة', 75, 90, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٧١٢.jpg', '', false, true, true, 29),
  ('legacy-0-12-030', 'عضاضة مائية', 65, 85, '0-12', 'IMG_٢٠٢٦٠٩٠٥_٠٠٣٧٣٠.jpg', '', false, true, true, 30),
  ('legacy-featured-001', 'مكعبات بناء ١٠٠٠ قطعة', 600, null, 'uncategorized', 'IMG_٢٠٢٦٠٩٠١_٢١٥١٢٨.jpg', '', true, true, true, 2),
  ('legacy-featured-002', 'بوتي سلم لتدريب الحمام', 600, null, 'uncategorized', 'IMG_٢٠٢٦٠٩٠١_٢١٥١٠١.jpg', '', true, true, true, 3),
  ('legacy-featured-003', 'بوكس خرز للإكسسوارات', 220, null, 'uncategorized', 'IMG_٢٠٢٦٠٩٠١_٢١٥٠٥٢.jpg', '', true, true, true, 4),
  ('legacy-featured-004', 'صلصال فوم (١٢ قطعة)', 50, null, 'uncategorized', 'IMG_٢٠٢٦٠٩٠١_٢١٥٠٣٩.jpg', '', true, true, true, 5),
  ('legacy-featured-005', 'بيت كور حيوانات + ٥٠ كرة', 520, null, 'uncategorized', 'IMG_٢٠٢٦٠٩٠١_٢١٥٠٢٦.jpg', '', true, true, true, 6)
on conflict (sku) do update set
  name = excluded.name,
  price = excluded.price,
  old_price = excluded.old_price,
  category = excluded.category,
  image_url = excluded.image_url,
  description = excluded.description,
  featured = excluded.featured,
  active = excluded.active,
  in_stock = excluded.in_stock,
  sort_order = excluded.sort_order;


-- منتجات إضافية موجودة حاليًا في GitHub.
-- image_url هنا هو اسم الملف المحلي فقط: الصور القديمة تظل على GitHub كما هي.
insert into public.products
  (sku, name, price, old_price, category, image_url, description, featured, active, in_stock, sort_order)
values
  ('legacy-0-12-031', '4 كتب قماش إنجليزي', 350, 400, '0-12', '4كتب قماش انجليزي.png', '', false, true, true, 31),
  ('legacy-0-12-032', 'أرنب سوفت', 200, 240, '0-12', 'ارنب سوفت.png', '', false, true, true, 32),
  ('legacy-0-12-033', 'سجادة فوم (١٨٠×١٥٠ سم)', 350, 400, '0-12', 'سجادة فوم.png', '', false, true, true, 33),
  ('legacy-0-12-034', 'طقم طعام سيليكون', 420, 450, '0-12', 'طقم طعام سليكون.png', '', false, true, true, 34),
  ('legacy-0-12-035', 'فون عضاضة', 180, 220, '0-12', 'فون عضاضة.png', '', false, true, true, 35),
  ('legacy-0-12-036', 'كروت الطفل', 90, 120, '0-12', 'كروت الطفل.jpg', '', false, true, true, 36),
  ('legacy-0-12-037', 'ملاهي سرير', 650, 850, '0-12', 'ملاهي سرير.png', '', false, true, true, 37)
on conflict (sku) do nothing;

-- Marker داخلي: بعده الموقع يعتمد على Supabase للبيانات، بينما الصور القديمة تظل ملفات GitHub.
insert into public.products
  (sku, name, price, old_price, category, image_url, description, featured, active, in_stock, sort_order)
values
  ('__system_legacy_import_v2__', '__SYSTEM_LEGACY_IMPORT_V2__', 0, null, 'uncategorized', 'about:blank', 'System marker - do not edit', false, true, false, -999999)
on conflict (sku) do nothing;

-- فحص سريع
select count(*) as products_count from public.products where sku not like '__system_%';
