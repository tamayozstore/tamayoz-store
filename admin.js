const ADMIN_CATEGORIES = [
  ["0-12", "0 - 12 شهر"],
  ["1-2.5", "سنة - سنتين ونص"],
  ["3-5", "3 - 5 سنين"],
  ["6-11", "6 - 11 سنة"],
  ["uncategorized", "غير مصنف"]
];

let batchDrafts = [];
let adminProducts = [];
let editingProduct = null;
let adminOrders = [];
let selectedProductIds = new Set();
let selectedOrderIds = new Set();
let productPage = 1;
let currentOrderId = null;
const PRODUCTS_PER_PAGE = 20;
const LEGACY_IMPORT_MARKER_SKU = "__system_legacy_import_v2__";
const ORDER_STATUSES = [
  ["new", "جديد"],
  ["confirmed", "تم التأكيد"],
  ["shipped", "تم الشحن"],
  ["delivered", "تم التسليم"],
  ["cancelled", "ملغي"]
];

function adminEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setMessage(id, text, type = "success") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `status-message show ${type}`;
}

function clearMessage(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = "";
  el.className = "status-message";
}

function showToast(text, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `admin-toast ${type}`;
  toast.innerHTML = `<span>${type === "error" ? "!" : "✓"}</span><div>${adminEscape(text)}</div>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 3300);
}

function categoryOptions(selected = "uncategorized") {
  return ADMIN_CATEGORIES.map(([value, label]) =>
    `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`
  ).join("");
}

function filenameToName(filename) {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function compressImage(file, maxWidth = 1600, quality = 0.82) {
  if (!file.type.startsWith("image/")) throw new Error("الملف مش صورة");

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("تعذر قراءة الصورة"));
      image.src = url;
    });

    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: true });
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("تعذر ضغط الصورة")), "image/webp", quality);
    });
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function randomStoragePath() {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `products/${id}.webp`;
}

async function uploadProductImage(file) {
  const compressed = await compressImage(file);
  const path = randomStoragePath();
  const { error } = await window.storeDb.storage.from("products").upload(path, compressed, {
    cacheControl: "31536000",
    contentType: "image/webp",
    upsert: false
  });
  if (error) throw error;

  const { data } = window.storeDb.storage.from("products").getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("لم أستطع إنشاء رابط الصورة");
  return data.publicUrl;
}

async function uploadStoreLogo() {
  clearMessage("store-logo-message");
  const input = document.getElementById("store-logo-file");
  const file = input?.files?.[0];
  if (!file) return setMessage("store-logo-message", "اختار صورة اللوجو الأول.", "error");

  const button = document.getElementById("upload-store-logo-btn");
  button.disabled = true;
  try {
    const compressed = await compressImage(file, 1200, 0.9);
    const path = "branding/logo.webp";
    const { error } = await window.storeDb.storage.from("products").upload(path, compressed, {
      cacheControl: "60",
      contentType: "image/webp",
      upsert: true
    });
    if (error) throw error;

    const { data } = window.storeDb.storage.from("products").getPublicUrl(path);
    const publicUrl = data?.publicUrl;
    if (!publicUrl) throw new Error("لم أستطع إنشاء رابط اللوجو");

    document.getElementById("store-logo-preview").src = `${publicUrl}?v=${Date.now()}`;
    input.value = "";
    setMessage("store-logo-message", "تم رفع اللوجو ✅ افتح المتجر واعمل Refresh.");
  } catch (error) {
    console.error(error);
    setMessage("store-logo-message", error.message || String(error), "error");
  } finally {
    button.disabled = false;
  }
}

function loadStoreLogoPreview() {
  const cfg = window.TAMAYOZ_CONFIG || {};
  const preview = document.getElementById("store-logo-preview");
  if (!preview || !cfg.supabaseUrl) return;
  preview.src = `${cfg.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/products/branding/logo.webp?v=${Date.now()}`;
}

function storagePathFromPublicUrl(url) {
  const marker = "/storage/v1/object/public/products/";
  const index = String(url || "").indexOf(marker);
  if (index < 0) return null;
  return decodeURIComponent(String(url).slice(index + marker.length));
}

async function removeStoredImage(url) {
  const path = storagePathFromPublicUrl(url);
  if (!path) return;
  const { error } = await window.storeDb.storage.from("products").remove([path]);
  if (error) console.warn("Could not remove old image:", error);
}

function renderBatchDrafts() {
  const list = document.getElementById("batch-list");
  if (!list) return;
  if (!batchDrafts.length) {
    list.innerHTML = '<div class="empty-state" style="margin:0">اختار صور المنتجات مرة واحدة، وهنا هتظهر خانات الاسم والسعر لكل صورة.</div>';
    return;
  }

  list.innerHTML = batchDrafts.map((draft, index) => `
    <div class="batch-row" data-draft-index="${index}">
      <img src="${draft.preview}" alt="معاينة">
      <div>
        <label>اسم المنتج</label>
        <input data-field="name" value="${adminEscape(draft.name)}" placeholder="اسم المنتج">
      </div>
      <div>
        <label>السعر</label>
        <input data-field="price" type="number" min="0" step="0.01" value="${draft.price}" placeholder="150">
      </div>
      <div>
        <label>السعر القديم</label>
        <input data-field="old_price" type="number" min="0" step="0.01" value="${draft.old_price}" placeholder="اختياري">
      </div>
      <div>
        <label>الفئة</label>
        <select data-field="category">${categoryOptions(draft.category)}</select>
      </div>
      <div class="checkbox-stack">
        <label><input type="checkbox" data-field="featured" ${draft.featured ? "checked" : ""}> مميز</label>
        <label><input type="checkbox" data-field="in_stock" ${draft.in_stock ? "checked" : ""}> متاح</label>
        <button class="small-btn delete" type="button" data-remove-draft="${index}">حذف</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll("[data-draft-index]").forEach((row) => {
    const index = Number(row.dataset.draftIndex);
    row.querySelectorAll("[data-field]").forEach((input) => {
      const eventName = input.type === "checkbox" ? "change" : "input";
      input.addEventListener(eventName, () => {
        const field = input.dataset.field;
        batchDrafts[index][field] = input.type === "checkbox" ? input.checked : input.value;
      });
    });
  });

  list.querySelectorAll("[data-remove-draft]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removeDraft);
      if (batchDrafts[index]?.preview) URL.revokeObjectURL(batchDrafts[index].preview);
      batchDrafts.splice(index, 1);
      renderBatchDrafts();
    });
  });
}

function handleBatchFiles(files) {
  batchDrafts.forEach((d) => d.preview && URL.revokeObjectURL(d.preview));
  const defaultCategory = document.getElementById("batch-default-category")?.value || "uncategorized";
  batchDrafts = [...files].filter((file) => file.type.startsWith("image/")).map((file) => ({
    file,
    preview: URL.createObjectURL(file),
    name: filenameToName(file.name),
    price: "",
    old_price: "",
    category: defaultCategory,
    featured: false,
    in_stock: true
  }));
  renderBatchDrafts();
}

async function uploadBatch() {
  clearMessage("batch-message");
  if (!batchDrafts.length) return setMessage("batch-message", "اختار صور الأول.", "error");

  for (const draft of batchDrafts) {
    if (!draft.name.trim() || draft.price === "" || Number(draft.price) < 0) {
      return setMessage("batch-message", "راجع اسم وسعر كل منتج قبل الحفظ.", "error");
    }
  }

  const button = document.getElementById("upload-batch-btn");
  button.disabled = true;
  let success = 0;

  try {
    for (let i = 0; i < batchDrafts.length; i++) {
      const draft = batchDrafts[i];
      setMessage("batch-message", `جاري رفع ${i + 1} من ${batchDrafts.length}: ${draft.name}`);
      const imageUrl = await uploadProductImage(draft.file);
      const payload = {
        name: draft.name.trim(),
        price: Number(draft.price),
        old_price: draft.old_price === "" ? null : Number(draft.old_price),
        category: draft.category,
        image_url: imageUrl,
        description: "",
        featured: Boolean(draft.featured),
        active: true,
        in_stock: Boolean(draft.in_stock),
        sort_order: 0
      };
      const { error } = await window.storeDb.from("products").insert(payload);
      if (error) {
        await removeStoredImage(imageUrl);
        throw error;
      }
      success++;
    }

    batchDrafts.forEach((d) => d.preview && URL.revokeObjectURL(d.preview));
    batchDrafts = [];
    document.getElementById("batch-files").value = "";
    renderBatchDrafts();
    setMessage("batch-message", `تم رفع وحفظ ${success} منتج بنجاح ✅`);
    await loadAdminProducts();
  } catch (error) {
    console.error(error);
    setMessage("batch-message", `تم حفظ ${success} منتج، وحصل خطأ بعدها: ${error.message || error}`, "error");
  } finally {
    button.disabled = false;
  }
}

function legacyCatalogRows() {
  const rows = Array.isArray(window.TAMAYOZ_FALLBACK_PRODUCTS) ? window.TAMAYOZ_FALLBACK_PRODUCTS : [];
  return rows.filter((p) => p?.sku && p.sku !== LEGACY_IMPORT_MARKER_SKU).map((p) => ({
    sku: p.sku,
    name: p.name,
    price: Number(p.price) || 0,
    old_price: p.old_price == null ? null : Number(p.old_price),
    category: p.category || "uncategorized",
    image_url: p.image_url || "",
    description: p.description || "",
    featured: Boolean(p.featured),
    active: p.active !== false,
    in_stock: p.in_stock !== false,
    sort_order: Number(p.sort_order) || 0
  }));
}

async function hasLegacyImportMarker() {
  const { data, error } = await window.storeDb
    .from("products")
    .select("id,sku")
    .eq("sku", LEGACY_IMPORT_MARKER_SKU)
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function writeLegacyImportMarker() {
  const marker = {
    sku: LEGACY_IMPORT_MARKER_SKU,
    name: "__SYSTEM_LEGACY_IMPORT_V2__",
    price: 0,
    old_price: null,
    category: "uncategorized",
    image_url: "about:blank",
    description: "System marker - do not edit",
    featured: false,
    active: true,
    in_stock: false,
    sort_order: -999999
  };
  const { error } = await window.storeDb.from("products").upsert(marker, { onConflict: "sku" });
  if (error) throw error;
}

async function syncLegacyCatalog({ force = false, silent = false } = {}) {
  const messageId = "legacy-data-message";
  if (!silent) clearMessage(messageId);
  const button = document.getElementById("sync-legacy-data-btn");
  if (button) button.disabled = true;

  try {
    const sourceRows = legacyCatalogRows();
    if (!sourceRows.length) {
      if (!silent) setMessage(messageId, "ملف بيانات المنتجات القديمة غير موجود.", "error");
      return { added: 0, skipped: true };
    }

    const markerExists = await hasLegacyImportMarker();
    if (markerExists && !force) {
      if (!silent) setMessage(messageId, `المنتجات القديمة متسجلة بالفعل ✅ (${sourceRows.length} منتج محفوظين كمرجع).`);
      return { added: 0, skipped: true };
    }

    const skus = sourceRows.map((p) => p.sku);
    const { data: existingRows, error: existingError } = await window.storeDb
      .from("products")
      .select("sku")
      .in("sku", skus);
    if (existingError) throw existingError;

    const existingSkus = new Set((existingRows || []).map((p) => p.sku));
    const missing = sourceRows.filter((p) => !existingSkus.has(p.sku));

    if (missing.length) {
      const { error: insertError } = await window.storeDb.from("products").insert(missing);
      if (insertError) throw insertError;
    }

    await writeLegacyImportMarker();

    if (!silent) {
      const text = missing.length
        ? `تم تسجيل ${missing.length} منتج قديم ناقص بدون رفع أي صورة ✅ الصور فضلت على GitHub زي ما هي.`
        : "كل بيانات المنتجات القديمة موجودة بالفعل ✅ لم يتم رفع أو نقل أي صورة.";
      setMessage(messageId, text);
      showToast(text);
    }
    return { added: missing.length, skipped: false };
  } catch (error) {
    console.error("Legacy catalog sync failed:", error);
    if (!silent) {
      const text = error.message || String(error);
      setMessage(messageId, text, "error");
      showToast(text, "error");
    }
    return { added: 0, error };
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadAdminProducts() {
  const tbody = document.getElementById("products-tbody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="table-loading">جاري تحميل المنتجات...</td></tr>';

  const { data, error } = await window.storeDb
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-error">خطأ: ${adminEscape(error.message)}</td></tr>`;
    return;
  }

  adminProducts = (data || []).filter((p) => p.sku !== LEGACY_IMPORT_MARKER_SKU);
  const validIds = new Set(adminProducts.map((p) => String(p.id)));
  selectedProductIds = new Set([...selectedProductIds].filter((id) => validIds.has(String(id))));
  renderAdminProducts();
  renderDashboardStats();
}

function productCategoryLabel(category) {
  return ADMIN_CATEGORIES.find(([value]) => value === category)?.[1] || category || "غير مصنف";
}

function getFilteredProducts() {
  const search = (document.getElementById("product-search")?.value || "").trim().toLowerCase();
  const category = document.getElementById("product-category-filter")?.value || "all";
  const visibility = document.getElementById("product-visibility-filter")?.value || "all";
  const stock = document.getElementById("product-stock-filter")?.value || "all";

  return adminProducts.filter((product) => {
    const haystack = `${product.name || ""} ${product.description || ""}`.toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (category !== "all" && product.category !== category) return false;
    if (visibility === "active" && !product.active) return false;
    if (visibility === "hidden" && product.active) return false;
    if (stock === "in" && !product.in_stock) return false;
    if (stock === "out" && product.in_stock) return false;
    return true;
  });
}

function getCurrentProductPageItems() {
  const filtered = getFilteredProducts();
  const maxPage = Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE));
  if (productPage > maxPage) productPage = maxPage;
  const start = (productPage - 1) * PRODUCTS_PER_PAGE;
  return { filtered, pageItems: filtered.slice(start, start + PRODUCTS_PER_PAGE), maxPage };
}

function renderAdminProducts() {
  const tbody = document.getElementById("products-tbody");
  if (!tbody) return;
  const { filtered, pageItems, maxPage } = getCurrentProductPageItems();

  if (!pageItems.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-table-state"><span>📦</span><strong>مفيش منتجات مطابقة</strong><small>جرّب تغيّر البحث أو الفلاتر.</small></div></td></tr>';
  } else {
    tbody.innerHTML = pageItems.map((p) => {
      const checked = selectedProductIds.has(String(p.id));
      const oldPrice = p.old_price ? `<small class="old-price-admin">${Number(p.old_price).toLocaleString("ar-EG")} ج.م</small>` : "";
      return `
        <tr class="${checked ? "selected-row" : ""}">
          <td class="select-col"><input type="checkbox" data-select-product="${p.id}" ${checked ? "checked" : ""} aria-label="تحديد ${adminEscape(p.name)}"></td>
          <td><img class="admin-thumb product-thumb-pro" src="${adminEscape(p.image_url)}" alt="" loading="lazy"></td>
          <td><div class="product-name-cell"><strong>${adminEscape(p.name)}</strong><small>#${adminEscape(p.id)}</small></div></td>
          <td><div class="price-cell"><strong>${Number(p.price).toLocaleString("ar-EG")} ج.م</strong>${oldPrice}</div></td>
          <td><span class="category-chip">${adminEscape(productCategoryLabel(p.category))}</span></td>
          <td><span class="pill ${p.featured ? "on" : ""}">${p.featured ? "★ مميز" : "عادي"}</span></td>
          <td><span class="pill ${p.active ? "on" : "off"}">${p.active ? "● ظاهر" : "مخفي"}</span></td>
          <td><span class="pill ${p.in_stock ? "on" : "off"}">${p.in_stock ? "متاح" : "نفد"}</span></td>
          <td class="actions-cell">
            <button class="small-btn edit" type="button" data-edit-product="${p.id}">تعديل</button>
            <button class="small-btn delete" type="button" data-delete-product="${p.id}">حذف</button>
          </td>
        </tr>`;
    }).join("");
  }

  tbody.querySelectorAll("[data-edit-product]").forEach((button) => {
    button.addEventListener("click", () => openEditor(button.dataset.editProduct));
  });
  tbody.querySelectorAll("[data-delete-product]").forEach((button) => {
    button.addEventListener("click", () => deleteProduct(button.dataset.deleteProduct));
  });
  tbody.querySelectorAll("[data-select-product]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = String(checkbox.dataset.selectProduct);
      if (checkbox.checked) selectedProductIds.add(id);
      else selectedProductIds.delete(id);
      renderAdminProducts();
    });
  });

  const countEl = document.getElementById("products-result-count");
  if (countEl) countEl.textContent = `${filtered.length.toLocaleString("ar-EG")} منتج`;
  const pageInfo = document.getElementById("products-page-info");
  if (pageInfo) pageInfo.textContent = `${productPage.toLocaleString("ar-EG")} / ${maxPage.toLocaleString("ar-EG")}`;
  const prev = document.getElementById("products-prev-page");
  const next = document.getElementById("products-next-page");
  if (prev) prev.disabled = productPage <= 1;
  if (next) next.disabled = productPage >= maxPage;

  updateProductsBulkBar(pageItems);
}

function updateProductsBulkBar(pageItems = getCurrentProductPageItems().pageItems) {
  const bar = document.getElementById("products-bulk-bar");
  const count = document.getElementById("products-selected-count");
  const filteredCount = document.getElementById("products-filtered-count");
  const help = document.getElementById("products-bulk-help");
  const selectedCount = selectedProductIds.size;
  if (count) count.textContent = selectedCount.toLocaleString("ar-EG");
  if (filteredCount) filteredCount.textContent = getFilteredProducts().length.toLocaleString("ar-EG");
  bar?.classList.toggle("inactive", selectedCount === 0);
  if (help) help.textContent = selectedCount
    ? `جاهز لتنفيذ أمر على ${selectedCount.toLocaleString("ar-EG")} منتج محدد.`
    : "حدد منتج أو أكتر من مربعات الاختيار، أو استخدم أزرار التحديد فوق.";

  bar?.querySelectorAll("button, select, input").forEach((control) => {
    control.disabled = selectedCount === 0;
  });

  const selectAll = document.getElementById("select-all-products");
  if (selectAll) {
    const pageIds = pageItems.map((p) => String(p.id));
    const checkedCount = pageIds.filter((id) => selectedProductIds.has(id)).length;
    selectAll.checked = pageIds.length > 0 && checkedCount === pageIds.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < pageIds.length;
  }
}

function toggleSelectAllProducts(checked) {
  const { pageItems } = getCurrentProductPageItems();
  pageItems.forEach((product) => {
    const id = String(product.id);
    if (checked) selectedProductIds.add(id);
    else selectedProductIds.delete(id);
  });
  renderAdminProducts();
}

function selectCurrentProductPage() {
  const { pageItems } = getCurrentProductPageItems();
  pageItems.forEach((product) => selectedProductIds.add(String(product.id)));
  renderAdminProducts();
  showToast(`تم تحديد ${pageItems.length.toLocaleString("ar-EG")} منتج في الصفحة`);
}

function invertCurrentProductPageSelection() {
  const { pageItems } = getCurrentProductPageItems();
  pageItems.forEach((product) => {
    const id = String(product.id);
    if (selectedProductIds.has(id)) selectedProductIds.delete(id);
    else selectedProductIds.add(id);
  });
  renderAdminProducts();
}

async function applyBulkPriceChange() {
  const ids = [...selectedProductIds];
  if (!ids.length) return showToast("حدد منتجات الأول.", "error");

  const mode = document.getElementById("bulk-price-mode")?.value || "set";
  const rawValue = Number(document.getElementById("bulk-price-value")?.value);
  if (!Number.isFinite(rawValue) || rawValue < 0) return showToast("اكتب قيمة صحيحة لتعديل السعر.", "error");

  const selected = adminProducts.filter((product) => selectedProductIds.has(String(product.id)));
  const labels = {
    set: "تعيين السعر",
    increase_percent: "زيادة السعر بنسبة",
    decrease_percent: "خصم نسبة من السعر",
    increase_amount: "زيادة مبلغ على السعر",
    decrease_amount: "خصم مبلغ من السعر"
  };
  if (!confirm(`${labels[mode] || "تعديل السعر"} على ${selected.length} منتج؟`)) return;

  const calcPrice = (price) => {
    const current = Number(price) || 0;
    let next = current;
    if (mode === "set") next = rawValue;
    if (mode === "increase_percent") next = current * (1 + rawValue / 100);
    if (mode === "decrease_percent") next = current * (1 - rawValue / 100);
    if (mode === "increase_amount") next = current + rawValue;
    if (mode === "decrease_amount") next = current - rawValue;
    return Math.max(0, Math.round(next * 100) / 100);
  };

  try {
    const results = await Promise.all(selected.map(async (product) => {
      const price = calcPrice(product.price);
      const { error } = await window.storeDb.from("products").update({ price }).eq("id", product.id);
      if (error) throw error;
      return price;
    }));
    document.getElementById("bulk-price-value").value = "";
    showToast(`تم تعديل أسعار ${results.length.toLocaleString("ar-EG")} منتج ✅`);
    setMessage("products-message", `تم تعديل أسعار ${results.length.toLocaleString("ar-EG")} منتج بنجاح ✅`);
    await loadAdminProducts();
  } catch (error) {
    console.error(error);
    showToast(error.message || String(error), "error");
  }
}

async function bulkProductAction(action, categoryValue = "") {
  const ids = [...selectedProductIds];
  if (!ids.length) return;
  clearMessage("products-message");

  let payload = null;
  let successText = "تم تحديث المنتجات المحددة ✅";
  if (action === "show") payload = { active: true };
  if (action === "hide") payload = { active: false };
  if (action === "stock") payload = { in_stock: true };
  if (action === "out") payload = { in_stock: false };
  if (action === "featured") payload = { featured: true };
  if (action === "unfeatured") payload = { featured: false };
  if (action === "category") {
    if (!categoryValue) return showToast("اختار الفئة الأول.", "error");
    payload = { category: categoryValue };
    successText = "تم نقل المنتجات للفئة الجديدة ✅";
  }

  try {
    if (action === "delete") {
      const productsToDelete = adminProducts.filter((p) => selectedProductIds.has(String(p.id)));
      const namesPreview = productsToDelete.slice(0, 3).map((p) => p.name).join("، ");
      const extra = productsToDelete.length > 3 ? ` + ${productsToDelete.length - 3} كمان` : "";
      if (!confirm(`هتحذف ${productsToDelete.length} منتج نهائيًا:\n${namesPreview}${extra}\n\nمتأكد؟`)) return;

      const { error } = await window.storeDb.from("products").delete().in("id", ids);
      if (error) throw error;

      const remainingUrls = new Set(adminProducts.filter((p) => !selectedProductIds.has(String(p.id))).map((p) => p.image_url));
      const urlsToRemove = [...new Set(productsToDelete.map((p) => p.image_url).filter((url) => url && !remainingUrls.has(url)))];
      await Promise.all(urlsToRemove.map((url) => removeStoredImage(url)));
      successText = `تم حذف ${productsToDelete.length} منتج ✅`;
    } else {
      const { error } = await window.storeDb.from("products").update(payload).in("id", ids);
      if (error) throw error;
    }

    selectedProductIds.clear();
    setMessage("products-message", successText);
    showToast(successText);
    await loadAdminProducts();
  } catch (error) {
    console.error(error);
    const text = error.message || String(error);
    setMessage("products-message", text, "error");
    showToast(text, "error");
  }
}

function openEditor(id) {
  editingProduct = adminProducts.find((p) => String(p.id) === String(id));
  if (!editingProduct) return;
  const panel = document.getElementById("edit-panel");
  panel.classList.remove("hidden");
  document.body.classList.add("modal-open");
  document.getElementById("edit-name").value = editingProduct.name || "";
  document.getElementById("edit-price").value = editingProduct.price ?? "";
  document.getElementById("edit-old-price").value = editingProduct.old_price ?? "";
  document.getElementById("edit-category").value = editingProduct.category || "uncategorized";
  document.getElementById("edit-description").value = editingProduct.description || "";
  document.getElementById("edit-featured").checked = Boolean(editingProduct.featured);
  document.getElementById("edit-active").checked = Boolean(editingProduct.active);
  document.getElementById("edit-stock").checked = Boolean(editingProduct.in_stock);
  document.getElementById("edit-image-preview").src = editingProduct.image_url || "";
  document.getElementById("edit-image").value = "";
  clearMessage("edit-message");
}

function closeEditor() {
  editingProduct = null;
  document.getElementById("edit-panel")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function saveEditor(event) {
  event.preventDefault();
  if (!editingProduct) return;
  clearMessage("edit-message");

  const name = document.getElementById("edit-name").value.trim();
  const price = Number(document.getElementById("edit-price").value);
  if (!name || Number.isNaN(price) || price < 0) return setMessage("edit-message", "راجع الاسم والسعر.", "error");

  const button = document.getElementById("save-edit-btn");
  button.disabled = true;
  let newImageUrl = null;
  try {
    const file = document.getElementById("edit-image").files[0];
    if (file) newImageUrl = await uploadProductImage(file);

    const payload = {
      name,
      price,
      old_price: document.getElementById("edit-old-price").value === "" ? null : Number(document.getElementById("edit-old-price").value),
      category: document.getElementById("edit-category").value,
      description: document.getElementById("edit-description").value.trim(),
      featured: document.getElementById("edit-featured").checked,
      active: document.getElementById("edit-active").checked,
      in_stock: document.getElementById("edit-stock").checked
    };
    if (newImageUrl) payload.image_url = newImageUrl;

    const oldUrl = editingProduct.image_url;
    const { error } = await window.storeDb.from("products").update(payload).eq("id", editingProduct.id);
    if (error) throw error;

    if (newImageUrl && oldUrl !== newImageUrl) {
      const usedElsewhere = adminProducts.some((p) => String(p.id) !== String(editingProduct.id) && p.image_url === oldUrl);
      if (!usedElsewhere) await removeStoredImage(oldUrl);
    }
    setMessage("edit-message", "تم حفظ التعديلات ✅");
    showToast("تم حفظ تعديل المنتج ✅");
    await loadAdminProducts();
    setTimeout(closeEditor, 450);
  } catch (error) {
    if (newImageUrl) await removeStoredImage(newImageUrl);
    setMessage("edit-message", error.message || String(error), "error");
  } finally {
    button.disabled = false;
  }
}

async function deleteProduct(id) {
  const product = adminProducts.find((p) => String(p.id) === String(id));
  if (!product || !confirm(`حذف المنتج "${product.name}" نهائيًا؟`)) return;

  const { error } = await window.storeDb.from("products").delete().eq("id", id);
  if (error) return showToast(`حصل خطأ: ${error.message}`, "error");
  const usedElsewhere = adminProducts.some((p) => String(p.id) !== String(id) && p.image_url === product.image_url);
  if (!usedElsewhere) await removeStoredImage(product.image_url);
  selectedProductIds.delete(String(id));
  showToast("تم حذف المنتج ✅");
  await loadAdminProducts();
}

async function loadOrders() {
  const tbody = document.getElementById("orders-tbody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="table-loading">جاري تحميل الطلبات...</td></tr>';

  const { data, error } = await window.storeDb
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-error">خطأ: ${adminEscape(error.message)}</td></tr>`;
    return;
  }

  adminOrders = data || [];
  const validIds = new Set(adminOrders.map((o) => String(o.id)));
  selectedOrderIds = new Set([...selectedOrderIds].filter((id) => validIds.has(String(id))));
  renderOrders();
  renderOrdersStats();
  renderDashboardStats();
}

function orderStatusLabel(status) {
  return ORDER_STATUSES.find(([value]) => value === status)?.[1] || status || "جديد";
}

function formatAdminMoney(value) {
  return `${(Number(value) || 0).toLocaleString("ar-EG")} ج.م`;
}

function isSameLocalDay(a, b = new Date()) {
  const d = new Date(a);
  return d.getFullYear() === b.getFullYear() && d.getMonth() === b.getMonth() && d.getDate() === b.getDate();
}

function getFilteredOrders() {
  const search = (document.getElementById("order-search")?.value || "").trim().toLowerCase();
  const status = document.getElementById("order-status-filter")?.value || "all";
  const period = document.getElementById("order-period-filter")?.value || "all";
  const now = new Date();

  return adminOrders.filter((order) => {
    const itemsText = (Array.isArray(order.items) ? order.items : []).map((item) => item.name || "").join(" ");
    const haystack = `${order.id || ""} ${order.customer_name || ""} ${order.phone || ""} ${order.address || ""} ${order.shipping_name || ""} ${itemsText}`.toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (status !== "all" && order.status !== status) return false;

    const created = new Date(order.created_at);
    if (period === "today" && !isSameLocalDay(created, now)) return false;
    if (period === "7" || period === "30") {
      const days = Number(period);
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - days);
      if (created < cutoff) return false;
    }
    return true;
  });
}

function renderOrdersStats() {
  const orders = adminOrders || [];
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set("orders-kpi-new", orders.filter((o) => o.status === "new").length.toLocaleString("ar-EG"));
  set("orders-kpi-confirmed", orders.filter((o) => o.status === "confirmed").length.toLocaleString("ar-EG"));
  set("orders-kpi-shipped", orders.filter((o) => o.status === "shipped").length.toLocaleString("ar-EG"));
  set("orders-kpi-delivered", orders.filter((o) => o.status === "delivered").length.toLocaleString("ar-EG"));
  set("orders-kpi-today", orders.filter((o) => isSameLocalDay(o.created_at)).length.toLocaleString("ar-EG"));
  const revenue = orders.filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  set("orders-kpi-revenue", formatAdminMoney(revenue));

  const newCount = orders.filter((o) => o.status === "new").length;
  const badge = document.getElementById("sidebar-new-orders-badge");
  if (badge) {
    badge.textContent = newCount > 99 ? "99+" : String(newCount);
    badge.classList.toggle("hidden", newCount === 0);
  }
}

function renderOrders() {
  const tbody = document.getElementById("orders-tbody");
  if (!tbody) return;
  const data = getFilteredOrders();

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-table-state"><span>🛍️</span><strong>مفيش طلبات مطابقة</strong><small>جرّب تغيّر البحث أو الفلاتر.</small></div></td></tr>';
  } else {
    tbody.innerHTML = data.map((o) => {
      const checked = selectedOrderIds.has(String(o.id));
      const date = new Date(o.created_at);
      return `
        <tr class="${checked ? "selected-row" : ""}">
          <td class="select-col"><input type="checkbox" data-select-order="${o.id}" ${checked ? "checked" : ""} aria-label="تحديد الطلب ${o.id}"></td>
          <td><button class="order-number-btn" type="button" data-view-order="${o.id}">#${o.id}</button></td>
          <td><div class="customer-cell"><strong>${adminEscape(o.customer_name)}</strong><small>${adminEscape(o.phone)}</small></div></td>
          <td><strong>${formatAdminMoney(o.total)}</strong></td>
          <td><span class="shipping-chip">${adminEscape(o.shipping_name)}</span></td>
          <td><small>${date.toLocaleDateString("ar-EG")}<br>${date.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</small></td>
          <td>
            <select class="order-status status-${adminEscape(o.status)}" data-order-id="${o.id}">
              ${ORDER_STATUSES.map(([v,l]) => `<option value="${v}" ${o.status === v ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </td>
          <td><div class="order-row-actions"><button class="small-btn" type="button" data-view-order="${o.id}">التفاصيل</button><button class="small-btn whatsapp-row-btn" type="button" data-whatsapp-order="${o.id}">واتساب</button></div></td>
        </tr>`;
    }).join("");
  }

  tbody.querySelectorAll("[data-order-id]").forEach((select) => {
    select.addEventListener("change", async () => {
      const oldValue = adminOrders.find((o) => String(o.id) === String(select.dataset.orderId))?.status;
      const ok = await updateOrderStatus(select.dataset.orderId, select.value, false);
      if (!ok) select.value = oldValue || "new";
    });
  });

  tbody.querySelectorAll("[data-select-order]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = String(checkbox.dataset.selectOrder);
      if (checkbox.checked) selectedOrderIds.add(id);
      else selectedOrderIds.delete(id);
      renderOrders();
    });
  });

  tbody.querySelectorAll("[data-view-order]").forEach((button) => {
    button.addEventListener("click", () => openOrderDetails(button.dataset.viewOrder));
  });
  tbody.querySelectorAll("[data-whatsapp-order]").forEach((button) => {
    button.addEventListener("click", () => {
      const order = adminOrders.find((o) => String(o.id) === String(button.dataset.whatsappOrder));
      if (order) openCustomerWhatsApp(order);
    });
  });

  const count = document.getElementById("orders-result-count");
  if (count) count.textContent = `${data.length.toLocaleString("ar-EG")} طلب من ${adminOrders.length.toLocaleString("ar-EG")}`;
  updateOrdersBulkBar(data);
}

function updateOrdersBulkBar(filtered = getFilteredOrders()) {
  const bar = document.getElementById("orders-bulk-bar");
  const count = document.getElementById("orders-selected-count");
  if (count) count.textContent = selectedOrderIds.size.toLocaleString("ar-EG");
  bar?.classList.toggle("hidden", selectedOrderIds.size === 0);

  const selectAll = document.getElementById("select-all-orders");
  if (selectAll) {
    const ids = filtered.map((o) => String(o.id));
    const checkedCount = ids.filter((id) => selectedOrderIds.has(id)).length;
    selectAll.checked = ids.length > 0 && checkedCount === ids.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < ids.length;
  }
}

function toggleSelectAllOrders(checked) {
  getFilteredOrders().forEach((order) => {
    const id = String(order.id);
    if (checked) selectedOrderIds.add(id);
    else selectedOrderIds.delete(id);
  });
  renderOrders();
}

async function updateOrderStatus(id, status, toast = true) {
  const order = adminOrders.find((o) => String(o.id) === String(id));
  if (!order) return false;
  const oldStatus = order.status;
  order.status = status;
  renderOrdersStats();
  renderDashboardStats();
  try {
    const { error } = await window.storeDb.from("orders").update({ status }).eq("id", id);
    if (error) throw error;
    if (toast) showToast(`تم تحديث الطلب #${id} إلى: ${orderStatusLabel(status)} ✅`);
    renderOrders();
    if (currentOrderId && String(currentOrderId) === String(id)) renderOrderDetails(order);
    return true;
  } catch (error) {
    order.status = oldStatus;
    renderOrders();
    renderOrdersStats();
    renderDashboardStats();
    showToast(error.message || String(error), "error");
    return false;
  }
}

async function applyBulkOrderStatus() {
  const status = document.getElementById("bulk-order-status")?.value || "";
  const ids = [...selectedOrderIds];
  if (!ids.length) return;
  if (!status) return showToast("اختار حالة الطلبات الأول.", "error");
  clearMessage("orders-message");

  const button = document.getElementById("apply-bulk-order-status");
  button.disabled = true;
  try {
    const { error } = await window.storeDb.from("orders").update({ status }).in("id", ids);
    if (error) throw error;
    adminOrders.forEach((order) => { if (selectedOrderIds.has(String(order.id))) order.status = status; });
    selectedOrderIds.clear();
    setMessage("orders-message", `تم تحديث ${ids.length} طلب ✅`);
    showToast(`تم تحديث ${ids.length} طلب ✅`);
    renderOrders();
    renderOrdersStats();
    renderDashboardStats();
  } catch (error) {
    setMessage("orders-message", error.message || String(error), "error");
    showToast(error.message || String(error), "error");
  } finally {
    button.disabled = false;
  }
}

function normalizeEgyptPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = `20${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("1")) digits = `20${digits}`;
  return digits;
}

function openCustomerWhatsApp(order) {
  const phone = normalizeEgyptPhone(order.phone);
  if (!phone) return showToast("رقم العميل غير صالح.", "error");
  const text = `أهلاً ${order.customer_name || ""}، بنتابع مع حضرتك طلب #${order.id} من التميز ستور.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

function renderOrderDetails(order) {
  const content = document.getElementById("order-detail-content");
  if (!content || !order) return;
  const items = Array.isArray(order.items) ? order.items : [];
  const created = new Date(order.created_at);
  document.getElementById("order-panel-title").textContent = `تفاصيل الطلب #${order.id}`;
  content.innerHTML = `
    <div class="order-detail-top">
      <div class="order-detail-id"><small>رقم الطلب</small><strong>#${order.id}</strong><span>${created.toLocaleString("ar-EG")}</span></div>
      <span class="order-status-badge status-${adminEscape(order.status)}">${adminEscape(orderStatusLabel(order.status))}</span>
    </div>
    <div class="order-detail-grid">
      <article><span>👤</span><div><small>العميل</small><strong>${adminEscape(order.customer_name)}</strong></div></article>
      <article><span>📱</span><div><small>رقم الهاتف</small><strong dir="ltr">${adminEscape(order.phone)}</strong></div></article>
      <article><span>🚚</span><div><small>منطقة الشحن</small><strong>${adminEscape(order.shipping_name)}</strong></div></article>
      <article class="order-address-card"><span>📍</span><div><small>العنوان بالتفصيل</small><strong>${adminEscape(order.address)}</strong></div></article>
    </div>
    <div class="order-items-card">
      <h3>تفاصيل المنتجات</h3>
      <div class="order-items-detail-list">
        ${items.length ? items.map((item) => `
          <div class="order-item-detail">
            <div><strong>${adminEscape(item.name)}</strong><small>${formatAdminMoney(item.price)} × ${Number(item.qty) || 1}</small></div>
            <strong>${formatAdminMoney(item.line_total ?? ((Number(item.price) || 0) * (Number(item.qty) || 1)))}</strong>
          </div>`).join("") : '<div class="empty-state">لا توجد تفاصيل منتجات محفوظة.</div>'}
      </div>
    </div>
    <div class="order-totals-card">
      <div><span>مجموع المنتجات</span><strong>${formatAdminMoney(order.subtotal)}</strong></div>
      <div><span>الشحن</span><strong>${formatAdminMoney(order.shipping_fee)}</strong></div>
      <div class="order-total-final"><span>الإجمالي</span><strong>${formatAdminMoney(order.total)}</strong></div>
    </div>`;

  const statusSelect = document.getElementById("order-detail-status");
  if (statusSelect) {
    statusSelect.innerHTML = ORDER_STATUSES.map(([v,l]) => `<option value="${v}" ${order.status === v ? "selected" : ""}>${l}</option>`).join("");
  }
}

function openOrderDetails(id) {
  const order = adminOrders.find((o) => String(o.id) === String(id));
  if (!order) return;
  currentOrderId = String(id);
  renderOrderDetails(order);
  document.getElementById("order-panel")?.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeOrderDetails() {
  currentOrderId = null;
  document.getElementById("order-panel")?.classList.add("hidden");
  if (document.getElementById("edit-panel")?.classList.contains("hidden")) document.body.classList.remove("modal-open");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportOrdersCsv() {
  const orders = getFilteredOrders();
  if (!orders.length) return showToast("مفيش طلبات لتصديرها.", "error");
  const headers = ["رقم الطلب", "التاريخ", "العميل", "الهاتف", "العنوان", "منطقة الشحن", "الشحن", "المجموع", "الإجمالي", "الحالة", "المنتجات"];
  const rows = orders.map((order) => {
    const items = (Array.isArray(order.items) ? order.items : []).map((item) => `${item.name} x${item.qty || 1}`).join(" | ");
    return [order.id, new Date(order.created_at).toLocaleString("ar-EG"), order.customer_name, order.phone, order.address, order.shipping_name, order.shipping_fee, order.subtotal, order.total, orderStatusLabel(order.status), items];
  });
  const csv = "\ufeff" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tamayoz-orders-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`تم تصدير ${orders.length} طلب ✅`);
}

function renderDashboardStats() {
  const products = adminProducts || [];
  const orders = adminOrders || [];
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set("stat-products", products.length.toLocaleString("ar-EG"));
  set("stat-visible", products.filter((p) => p.active).length.toLocaleString("ar-EG"));
  set("stat-out-stock", products.filter((p) => !p.in_stock).length.toLocaleString("ar-EG"));
  set("stat-new-orders", orders.filter((o) => o.status === "new").length.toLocaleString("ar-EG"));
  const revenue = orders.filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  set("stat-revenue", `${revenue.toLocaleString("ar-EG")} ج.م`);
  renderOrdersStats();
}

function clearBatchDrafts() {
  batchDrafts.forEach((draft) => draft.preview && URL.revokeObjectURL(draft.preview));
  batchDrafts = [];
  const input = document.getElementById("batch-files");
  if (input) input.value = "";
  renderBatchDrafts();
  clearMessage("batch-message");
}

async function refreshDashboard() {
  const button = document.getElementById("refresh-dashboard-btn");
  if (button) button.disabled = true;
  try {
    await Promise.all([loadAdminProducts(), loadOrders()]);
    showToast("تم تحديث لوحة الإدارة ✅");
  } finally {
    if (button) button.disabled = false;
  }
}

async function showDashboard(session) {
  document.getElementById("login-shell")?.classList.add("hidden");
  document.getElementById("login-card")?.classList.add("hidden");
  document.getElementById("dashboard")?.classList.remove("hidden");
  document.getElementById("admin-email").textContent = session?.user?.email || "Admin";
  await Promise.all([loadAdminProducts(), loadOrders()]);

  // أول دخول بعد التحديث: يسجل أي منتج قديم ناقص في قاعدة البيانات فقط.
  // الصور القديمة لا تتحرك من GitHub، والمنتجات الجديدة فقط صورها تروح Supabase.
  const syncResult = await syncLegacyCatalog({ silent: true });
  if (syncResult?.added) {
    await loadAdminProducts();
    showToast(`تم الحفاظ على ${syncResult.added} منتج قديم ناقص تلقائيًا ✅`);
  }
}

function showLogin() {
  document.getElementById("login-shell")?.classList.remove("hidden");
  document.getElementById("login-card")?.classList.remove("hidden");
  document.getElementById("dashboard")?.classList.add("hidden");
  closeEditor();
  closeOrderDetails();
}

async function login(event) {
  event.preventDefault();
  clearMessage("login-message");
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const button = document.getElementById("login-btn");
  button.disabled = true;
  try {
    const { data, error } = await window.storeDb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setMessage("login-message", "تم تسجيل الدخول ✅");
    await showDashboard(data.session);
  } catch (error) {
    setMessage("login-message", error.message || "تعذر تسجيل الدخول", "error");
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  await window.storeDb.auth.signOut();
  selectedProductIds.clear();
  selectedOrderIds.clear();
  showLogin();
}

function setupSidebarNavigation() {
  const links = [...document.querySelectorAll(".admin-sidebar-nav a")];
  links.forEach((link) => {
    link.addEventListener("click", () => {
      links.forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    });
  });

  if ("IntersectionObserver" in window) {
    const sections = [...document.querySelectorAll(".admin-section[id]")];
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      links.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${visible.target.id}`));
    }, { rootMargin: "-25% 0px -65% 0px", threshold: [0.01, 0.2] });
    sections.forEach((section) => observer.observe(section));
  }
}

async function initAdmin() {
  const warning = document.getElementById("setup-warning");
  warning?.classList.add("hidden");

  const db = await (window.TAMAYOZ_SUPABASE_PROMISE || Promise.resolve(window.storeDb));
  if (!db || !window.TAMAYOZ_SUPABASE_READY) {
    const reason = window.TAMAYOZ_SUPABASE_ERROR?.message || "تعذر إنشاء اتصال Supabase";
    warning?.classList.remove("hidden");
    if (warning) warning.innerHTML = `<strong>Supabase مش متوصل.</strong><br>${adminEscape(reason)}<br><small>النسخة دي فيها Project URL وPublishable Key بالفعل. جرّب Ctrl+Shift+R ولو المشكلة مستمرة راجع اتصال الإنترنت.</small>`;
    document.getElementById("login-card")?.classList.add("hidden");
    return;
  }

  loadStoreLogoPreview();
  const { data, error } = await window.storeDb.auth.getSession();
  if (error && warning) {
    warning.classList.remove("hidden");
    warning.innerHTML = `<strong>Supabase اتوصل لكن حصل خطأ في Auth.</strong><br>${adminEscape(error.message)}`;
  }
  if (data?.session) await showDashboard(data.session);
  else showLogin();

  window.storeDb.auth.onAuthStateChange((_event, session) => {
    if (session) {
      if (document.getElementById("dashboard")?.classList.contains("hidden")) showDashboard(session);
    } else {
      showLogin();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("login-form")?.addEventListener("submit", login);
  document.getElementById("logout-btn")?.addEventListener("click", logout);
  document.getElementById("upload-store-logo-btn")?.addEventListener("click", uploadStoreLogo);
  document.getElementById("sync-legacy-data-btn")?.addEventListener("click", async () => {
    const result = await syncLegacyCatalog({ force: true, silent: false });
    if (result?.added) await loadAdminProducts();
  });
  document.getElementById("batch-files")?.addEventListener("change", (event) => handleBatchFiles(event.target.files));
  document.getElementById("batch-default-category")?.addEventListener("change", (event) => {
    batchDrafts.forEach((draft) => draft.category = event.target.value);
    renderBatchDrafts();
  });
  document.getElementById("upload-batch-btn")?.addEventListener("click", uploadBatch);
  document.getElementById("clear-batch-btn")?.addEventListener("click", () => {
    if (batchDrafts.length && !confirm("مسح كل المنتجات الموجودة في قائمة الرفع قبل حفظها؟")) return;
    clearBatchDrafts();
  });

  document.getElementById("edit-form")?.addEventListener("submit", saveEditor);
  document.getElementById("cancel-edit-btn")?.addEventListener("click", closeEditor);
  document.querySelectorAll("[data-close-editor]").forEach((el) => el.addEventListener("click", closeEditor));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!document.getElementById("order-panel")?.classList.contains("hidden")) closeOrderDetails();
    else if (!document.getElementById("edit-panel")?.classList.contains("hidden")) closeEditor();
  });

  document.getElementById("refresh-products-btn")?.addEventListener("click", loadAdminProducts);
  document.getElementById("refresh-orders-btn")?.addEventListener("click", loadOrders);
  document.getElementById("refresh-dashboard-btn")?.addEventListener("click", refreshDashboard);

  ["product-search", "product-category-filter", "product-visibility-filter", "product-stock-filter"].forEach((id) => {
    const el = document.getElementById(id);
    const eventName = el?.tagName === "INPUT" ? "input" : "change";
    el?.addEventListener(eventName, () => { productPage = 1; renderAdminProducts(); });
  });
  document.getElementById("select-current-product-page")?.addEventListener("click", selectCurrentProductPage);
  document.getElementById("select-all-filtered-products")?.addEventListener("click", () => {
    const filtered = getFilteredProducts();
    filtered.forEach((product) => selectedProductIds.add(String(product.id)));
    renderAdminProducts();
    showToast(`تم تحديد كل النتائج: ${filtered.length.toLocaleString("ar-EG")} منتج`);
  });
  document.getElementById("invert-current-product-page")?.addEventListener("click", invertCurrentProductPageSelection);
  document.getElementById("clear-product-selection")?.addEventListener("click", () => {
    selectedProductIds.clear();
    renderAdminProducts();
    showToast("تم مسح التحديد");
  });
  document.getElementById("clear-product-filters")?.addEventListener("click", () => {
    document.getElementById("product-search").value = "";
    document.getElementById("product-category-filter").value = "all";
    document.getElementById("product-visibility-filter").value = "all";
    document.getElementById("product-stock-filter").value = "all";
    productPage = 1;
    renderAdminProducts();
  });
  document.getElementById("products-prev-page")?.addEventListener("click", () => { if (productPage > 1) { productPage--; renderAdminProducts(); } });
  document.getElementById("products-next-page")?.addEventListener("click", () => {
    const maxPage = getCurrentProductPageItems().maxPage;
    if (productPage < maxPage) { productPage++; renderAdminProducts(); }
  });
  document.getElementById("select-all-products")?.addEventListener("change", (event) => toggleSelectAllProducts(event.target.checked));
  document.querySelectorAll("[data-bulk-product-action]").forEach((button) => {
    button.addEventListener("click", () => bulkProductAction(button.dataset.bulkProductAction));
  });
  document.getElementById("apply-bulk-category")?.addEventListener("click", () => {
    bulkProductAction("category", document.getElementById("bulk-category-select")?.value || "");
  });
  document.getElementById("apply-bulk-price")?.addEventListener("click", applyBulkPriceChange);

  document.getElementById("order-search")?.addEventListener("input", renderOrders);
  document.getElementById("order-status-filter")?.addEventListener("change", renderOrders);
  document.getElementById("order-period-filter")?.addEventListener("change", renderOrders);
  document.getElementById("clear-order-filters")?.addEventListener("click", () => {
    document.getElementById("order-search").value = "";
    document.getElementById("order-status-filter").value = "all";
    document.getElementById("order-period-filter").value = "all";
    renderOrders();
  });
  document.getElementById("select-all-filtered-orders")?.addEventListener("click", () => {
    getFilteredOrders().forEach((order) => selectedOrderIds.add(String(order.id)));
    renderOrders();
    showToast(`تم تحديد ${selectedOrderIds.size} طلب`);
  });
  document.getElementById("clear-order-selection")?.addEventListener("click", () => {
    selectedOrderIds.clear();
    renderOrders();
  });
  document.getElementById("select-all-orders")?.addEventListener("change", (event) => toggleSelectAllOrders(event.target.checked));
  document.getElementById("apply-bulk-order-status")?.addEventListener("click", applyBulkOrderStatus);
  document.getElementById("export-orders-btn")?.addEventListener("click", exportOrdersCsv);
  document.getElementById("close-order-btn")?.addEventListener("click", closeOrderDetails);
  document.querySelectorAll("[data-close-order]").forEach((el) => el.addEventListener("click", closeOrderDetails));
  document.getElementById("order-detail-status")?.addEventListener("change", async (event) => {
    if (currentOrderId) await updateOrderStatus(currentOrderId, event.target.value);
  });
  document.getElementById("order-whatsapp-btn")?.addEventListener("click", () => {
    const order = adminOrders.find((o) => String(o.id) === String(currentOrderId));
    if (order) openCustomerWhatsApp(order);
  });

  renderBatchDrafts();
  setupSidebarNavigation();
  initAdmin();
});
