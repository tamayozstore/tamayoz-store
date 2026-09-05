const CATEGORY_META = {
  "0-12": { title: "ألعاب من 0 لـ 12 شهر 👶", subtitle: "ألعاب آمنة ومختارة بعناية لتنمية مهارات طفلك الحسية والحركية في عامه الأول" },
  "1-2.5": { title: "ألعاب من سنة لسنتين ونص 🧸", subtitle: "اختيارات مناسبة لمرحلة الحركة والاستكشاف وتنمية المهارات الأساسية" },
  "3-5": { title: "ألعاب من 3 لـ 5 سنين 🎨", subtitle: "ألعاب تساعد على الخيال والتركيز والتعلم باللعب" },
  "6-11": { title: "ألعاب من 6 لـ 11 سنة 🎒", subtitle: "ألعاب وتحديات مناسبة للأطفال الأكبر سنًا" },
  "uncategorized": { title: "منتجات أخرى", subtitle: "منتجات لم يتم تحديد فئتها العمرية بعد" }
};

const STORE_CATEGORY_ALIASES = {
  "1-2-5": "1-2.5",
  "1-2-5-years": "1-2.5",
  "1-2.5-years": "1-2.5",
  "1-2": "1-2.5"
};

function normalizeStoreCategory(value) {
  const raw = String(value || "uncategorized").trim();
  const normalized = STORE_CATEGORY_ALIASES[raw] || raw;
  return CATEGORY_META[normalized] ? normalized : "uncategorized";
}

function storeCategoryQueryValues(value) {
  const normalized = normalizeStoreCategory(value);
  if (normalized === "1-2.5") return ["1-2.5", "1-2-5", "1-2-5-years", "1-2.5-years", "1-2"];
  return [normalized];
}

let currentProducts = [];
let currentCategory = null;

function safeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fallbackProducts(filters = {}) {
  let rows = Array.isArray(window.TAMAYOZ_FALLBACK_PRODUCTS) ? [...window.TAMAYOZ_FALLBACK_PRODUCTS] : [];
  if (filters.featured) rows = rows.filter((p) => p.featured && p.active);
  if (filters.category) {
    const wanted = normalizeStoreCategory(filters.category);
    rows = rows.filter((p) => normalizeStoreCategory(p.category) === wanted && p.active);
  }
  rows.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return filters.limit ? rows.slice(0, filters.limit) : rows;
}

async function fetchProducts(filters = {}) {
  try {
    if (window.TAMAYOZ_SUPABASE_PROMISE) await window.TAMAYOZ_SUPABASE_PROMISE;
    if (!window.storeDb || !window.TAMAYOZ_SUPABASE_READY) return fallbackProducts(filters);
    let query = window.storeDb
      .from("products")
      .select("id,sku,name,price,old_price,category,image_url,description,featured,active,in_stock,sort_order,created_at")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (filters.featured) query = query.eq("featured", true);
    if (filters.category) query = query.in("category", storeCategoryQueryValues(filters.category));
    if (filters.limit) query = query.limit(filters.limit);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    const fallback = fallbackProducts(filters);

    // لو قاعدة البيانات اتعملت جديد ولسه المنتجات القديمة ما اتعملهاش import،
    // ما نخليش الفئة تظهر فاضية: نعرض داتا GitHub القديمة مؤقتًا بجانب أي منتجات جديدة.
    if (filters.category && fallback.length) {
      const normalized = normalizeStoreCategory(filters.category);
      const legacyPrefix = `legacy-${normalized}-`;
      const dbAlreadyOwnsLegacyCatalog = rows.some((product) => String(product.sku || "").startsWith(legacyPrefix));

      if (!dbAlreadyOwnsLegacyCatalog) {
        const seen = new Set(rows.map((product) => String(product.sku || `${product.name}|${product.image_url}`)));
        const missingFallback = fallback.filter((product) => {
          const key = String(product.sku || `${product.name}|${product.image_url}`);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const merged = [...rows, ...missingFallback];
        merged.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        return filters.limit ? merged.slice(0, filters.limit) : merged;
      }
    }

    if (!rows.length && fallback.length) return fallback;
    return rows;
  } catch (error) {
    console.error("Products fetch failed; using fallback:", error);
    return fallbackProducts(filters);
  }
}

function productCardTemplate(product) {
  const price = Number(product.price || 0);
  const oldPrice = product.old_price == null ? null : Number(product.old_price);
  const soldOut = product.in_stock === false;
  return `
    <article class="product-card">
      <div class="product-image-wrap">
        ${product.featured ? '<span class="product-badge">مميز</span>' : ""}
        <img src="${safeText(product.image_url)}" alt="${safeText(product.name)}" loading="lazy" decoding="async" data-lightbox-src="${safeText(product.image_url)}">
      </div>
      <div class="product-body">
        <h3>${safeText(product.name)}</h3>
        ${product.description ? `<p class="product-description">${safeText(product.description)}</p>` : ""}
        <p class="product-price">
          ${oldPrice && oldPrice > price ? `<span class="old-price">${oldPrice.toLocaleString("ar-EG")} ج.م</span>` : ""}
          <span class="new-price">${price.toLocaleString("ar-EG")} ج.م</span>
        </p>
        <button class="add-cart-btn" type="button" data-product-id="${safeText(product.id || product.sku)}" ${soldOut ? "disabled" : ""}>
          ${soldOut ? "نفد من المخزون" : "أضيفي للسلة 🛒"}
        </button>
      </div>
    </article>`;
}

function renderProducts(container, products) {
  if (!container) return;
  currentProducts = products;
  if (!products.length) {
    container.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><strong>مفيش منتجات في الفئة دي لسه.</strong><br>تقدري تضيفيها من لوحة الإدارة من غير تعديل الكود.</div>';
    return;
  }

  container.innerHTML = products.map(productCardTemplate).join("");
  bindProductInteractions(container, products);
}

function bindProductInteractions(container, products) {
  const map = new Map(products.map((p) => [String(p.id || p.sku), p]));
  container.querySelectorAll("[data-product-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = map.get(button.dataset.productId);
      if (product) addToCart(product);
    });
  });
  container.querySelectorAll("[data-lightbox-src]").forEach((image) => {
    image.addEventListener("click", () => openLightbox(image.dataset.lightboxSrc, image.alt));
  });
}

function openLightbox(src, alt = "صورة المنتج") {
  const lightbox = document.getElementById("lightbox");
  const image = document.getElementById("lightbox-img");
  if (!lightbox || !image) return;
  image.src = src;
  image.alt = alt;
  lightbox.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  const lightbox = document.getElementById("lightbox");
  if (!lightbox) return;
  lightbox.classList.remove("active");
  document.body.style.overflow = "";
}

async function initFeatured() {
  const grid = document.getElementById("featured-grid");
  if (!grid) return;
  grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">جاري تحميل المنتجات...</div>';
  const products = await fetchProducts({ featured: true, limit: 6 });
  renderProducts(grid, products);
}

async function initProductsPage() {
  const grid = document.getElementById("products-grid");
  if (!grid) return;

  const params = new URLSearchParams(location.search);
  currentCategory = normalizeStoreCategory(params.get("category") || "0-12");
  const meta = CATEGORY_META[currentCategory] || CATEGORY_META.uncategorized;
  document.getElementById("category-title").textContent = meta.title;
  document.getElementById("category-subtitle").textContent = meta.subtitle;
  document.title = `${meta.title.replace(/ [^\w\u0600-\u06FF].*$/, "")} - التميز ستور`;

  grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">جاري تحميل المنتجات...</div>';
  const products = await fetchProducts({ category: currentCategory });
  renderProducts(grid, products);

  const search = document.getElementById("product-search");
  if (search) {
    search.addEventListener("input", () => {
      const q = search.value.trim().toLocaleLowerCase("ar");
      const filtered = !q ? products : products.filter((p) => `${p.name} ${p.description || ""}`.toLocaleLowerCase("ar").includes(q));
      renderProducts(grid, filtered);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initFeatured();
  initProductsPage();
  document.getElementById("lightbox")?.addEventListener("click", (event) => {
    if (event.target.id === "lightbox" || event.target.closest("[data-close-lightbox]")) closeLightbox();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeLightbox(); });
});
