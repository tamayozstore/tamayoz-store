-- Tamayoz Store - one-time repair
-- آمن على المنتجات والطلبات الموجودة: لا يمسح أي داتا ولا يعيد إدخال المنتجات القديمة.
-- شغّل الملف بالكامل مرة واحدة من Supabase Dashboard > SQL Editor > Run.

begin;

-- 1) إنشاء/إصلاح Storage bucket الذي تستخدمه صور المنتجات واللوجو.
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

-- صلاحيات القراءة/الرفع/التعديل/الحذف للمستخدم المسجل في لوحة الأدمن.
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

-- 2) إصلاح أي تسمية قديمة لفئة "من سنة لسنتين ونص" بدون فقد المنتجات.
update public.products
set category = '1-2.5'
where category in ('1-2-5', '1-2-5-years', '1-2.5-years', '1-2');

-- أي قيمة فئة غريبة تفضل محفوظة كمنتج لكن تنتقل لـ "غير مصنف" بدل ما تختفي من المتجر.
update public.products
set category = 'uncategorized'
where category is null
   or category not in ('0-12','1-2.5','3-5','6-11','uncategorized');

-- تثبيت القيم المسموح بها للفئات.
alter table public.products drop constraint if exists products_category_check;
alter table public.products
  add constraint products_category_check
  check (category in ('0-12','1-2.5','3-5','6-11','uncategorized'));

commit;

-- فحص بعد التنفيذ: المفروض bucket_ready = true.
select exists(
  select 1 from storage.buckets where id = 'products'
) as bucket_ready;

-- فحص عدد المنتجات في كل فئة بدون تعديل أي بيانات إضافية.
select category, count(*) as products_count
from public.products
group by category
order by category;
