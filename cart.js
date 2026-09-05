const shippingRates = {
  cairo_giza: { name: "القاهرة والجيزة", fee: 70 },
  bahary: { name: "الوجه البحري (إسكندرية، القليوبية، الدلتا، القناة)", fee: 80 },
  beheira: { name: "البحيرة", fee: 90 },
  qebly: { name: "الوجه القبلي وصعيد مصر", fee: 90 },
  new_valley: { name: "الوادي الجديد", fee: 110 },
  hurghada: { name: "الغردقة", fee: 110 },
  matrouh: { name: "مطروح", fee: 140 },
  sinai: { name: "شمال وجنوب سيناء", fee: 150 },
  sharm: { name: "شرم الشيخ", fee: 160 }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeDigits(value) {
  return String(value || "")
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
}

let cart = [];
try {
  const saved = JSON.parse(localStorage.getItem("tamayoz_cart"));
  if (Array.isArray(saved)) cart = saved;
} catch (_) {}

cart = cart.map((item, index) => ({
  id: item.id || `legacy-${index}-${String(item.title || item.name || "item")}`,
  name: item.name || item.title || "منتج",
  price: Number(item.price) || 0,
  image_url: item.image_url || item.img || "",
  qty: Math.max(1, Number(item.qty) || 1)
}));

function saveCart() {
  localStorage.setItem("tamayoz_cart", JSON.stringify(cart));
  updateCartUI();
}

function addToCart(productOrName, price, imageUrl) {
  const product = typeof productOrName === "object"
    ? productOrName
    : {
        id: `legacy-${String(productOrName)}`,
        name: productOrName,
        price,
        image_url: imageUrl
      };

  const item = {
    id: String(product.id || product.sku || product.name),
    name: String(product.name || "منتج"),
    price: Number(product.price) || 0,
    image_url: String(product.image_url || "")
  };

  const existing = cart.find((row) => row.id === item.id);
  if (existing) existing.qty += 1;
  else cart.push({ ...item, qty: 1 });

  saveCart();
  openCart();
}

function changeQty(index, delta) {
  if (!cart[index]) return;
  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  saveCart();
}

function injectCartUI() {
  const root = document.getElementById("cart-root");
  if (!root || root.dataset.ready === "true") return;

  root.dataset.ready = "true";
  root.innerHTML = `
    <div class="cart-overlay" id="cart-overlay" aria-hidden="true"></div>
    <aside class="cart-drawer" id="cart-drawer" aria-label="سلة المشتريات">
      <div class="cart-header">
        <h3>سلة المشتريات</h3>
        <button class="close-cart" id="close-cart-btn" type="button" aria-label="إغلاق السلة">✕</button>
      </div>
      <div class="cart-items" id="cart-items"></div>
      <div class="cart-checkout">
        <div class="form-group">
          <label for="cust-name">الاسم بالكامل</label>
          <input type="text" id="cust-name" autocomplete="name" placeholder="اكتبي اسمك هنا">
        </div>
        <div class="form-group">
          <label for="cust-phone">رقم الموبايل</label>
          <input type="tel" id="cust-phone" inputmode="tel" autocomplete="tel" placeholder="01xxxxxxxxx">
        </div>
        <div class="form-group">
          <label for="shipping-zone">منطقة الشحن</label>
          <select id="shipping-zone">
            <option value="">-- اختاري المحافظة/المنطقة --</option>
            <option value="cairo_giza">القاهرة والجيزة (70 ج.م)</option>
            <option value="bahary">الوجه البحري والقناة (80 ج.م)</option>
            <option value="beheira">البحيرة (90 ج.م)</option>
            <option value="qebly">الوجه القبلي والصعيد (90 ج.م)</option>
            <option value="new_valley">الوادي الجديد (110 ج.م)</option>
            <option value="hurghada">الغردقة (110 ج.م)</option>
            <option value="matrouh">مطروح (140 ج.م)</option>
            <option value="sinai">شمال وجنوب سيناء (150 ج.م)</option>
            <option value="sharm">شرم الشيخ (160 ج.م)</option>
          </select>
        </div>
        <div class="form-group">
          <label for="cust-address">العنوان بالتفصيل</label>
          <textarea id="cust-address" rows="2" autocomplete="street-address" placeholder="الشارع، رقم العمارة والشقة، علامة مميزة"></textarea>
        </div>
        <div class="bill-row"><span>المجموع:</span><span id="cart-subtotal">0 ج.م</span></div>
        <div class="bill-row"><span>الشحن:</span><span id="cart-shipping">0 ج.م</span></div>
        <div class="bill-row bill-total"><span>الإجمالي:</span><span id="cart-total">0 ج.م</span></div>
        <button class="whatsapp-submit" id="checkout-btn" type="button">تأكيد الطلب عبر واتساب 💬</button>
        <p class="checkout-note">لو Supabase متوصل، الطلب بيتسجل في لوحة الإدارة كمان.</p>
      </div>
    </aside>
  `;

  document.getElementById("cart-overlay").addEventListener("click", closeCart);
  document.getElementById("close-cart-btn").addEventListener("click", closeCart);
  document.getElementById("shipping-zone").addEventListener("change", updateCartUI);
  document.getElementById("checkout-btn").addEventListener("click", checkoutWhatsApp);
  updateCartUI();
}

function updateCartUI() {
  document.querySelectorAll("[data-cart-count]").forEach((badge) => {
    badge.textContent = cart.reduce((sum, item) => sum + item.qty, 0);
  });

  const cartItems = document.getElementById("cart-items");
  if (!cartItems) return;

  const subtotalEl = document.getElementById("cart-subtotal");
  const shippingEl = document.getElementById("cart-shipping");
  const totalEl = document.getElementById("cart-total");
  const zoneSelect = document.getElementById("shipping-zone");

  if (!cart.length) {
    cartItems.innerHTML = '<div class="empty-state" style="margin:20px 0;padding:24px 10px">السلة فارغة حالياً 🛒</div>';
    if (subtotalEl) subtotalEl.textContent = "0 ج.م";
    if (shippingEl) shippingEl.textContent = "0 ج.م";
    if (totalEl) totalEl.textContent = "0 ج.م";
    return;
  }

  cartItems.innerHTML = cart.map((item, idx) => `
    <div class="cart-item">
      <img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" loading="lazy">
      <div class="cart-item-info">
        <h4>${escapeHtml(item.name)}</h4>
        <div class="cart-item-price">${Number(item.price).toLocaleString("ar-EG")} ج.م</div>
        <div class="cart-qty-ctrl">
          <button type="button" data-cart-change="${idx}" data-delta="-1">−</button>
          <span>${item.qty}</span>
          <button type="button" data-cart-change="${idx}" data-delta="1">+</button>
        </div>
      </div>
      <button class="remove-btn" type="button" data-cart-remove="${idx}" aria-label="حذف المنتج">✕</button>
    </div>
  `).join("");

  cartItems.querySelectorAll("[data-cart-change]").forEach((button) => {
    button.addEventListener("click", () => changeQty(Number(button.dataset.cartChange), Number(button.dataset.delta)));
  });
  cartItems.querySelectorAll("[data-cart-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const idx = Number(button.dataset.cartRemove);
      if (cart[idx]) changeQty(idx, -cart[idx].qty);
    });
  });

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const selectedZone = zoneSelect ? zoneSelect.value : "";
  const shippingFee = selectedZone && shippingRates[selectedZone] ? shippingRates[selectedZone].fee : 0;
  const total = subtotal + shippingFee;

  if (subtotalEl) subtotalEl.textContent = `${subtotal.toLocaleString("ar-EG")} ج.م`;
  if (shippingEl) shippingEl.textContent = selectedZone ? `${shippingFee.toLocaleString("ar-EG")} ج.م` : "حددي المنطقة";
  if (totalEl) totalEl.textContent = `${total.toLocaleString("ar-EG")} ج.م`;
}

function openCart() {
  document.getElementById("cart-drawer")?.classList.add("open");
  document.getElementById("cart-overlay")?.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeCart() {
  document.getElementById("cart-drawer")?.classList.remove("open");
  document.getElementById("cart-overlay")?.classList.remove("open");
  document.body.style.overflow = "";
}

async function saveOrder(order) {
  try {
    if (window.TAMAYOZ_SUPABASE_PROMISE) await window.TAMAYOZ_SUPABASE_PROMISE;
    if (!window.storeDb || !window.TAMAYOZ_SUPABASE_READY) return { saved: false };
    const { error } = await window.storeDb.from("orders").insert(order);
    if (error) throw error;
    return { saved: true };
  } catch (error) {
    console.error("Could not save order:", error);
    return { saved: false, error };
  }
}

async function checkoutWhatsApp() {
  if (!cart.length) return alert("السلة فارغة!");

  const name = document.getElementById("cust-name")?.value.trim() || "";
  const phone = normalizeDigits(document.getElementById("cust-phone")?.value.trim() || "").replace(/\s+/g, "");
  const address = document.getElementById("cust-address")?.value.trim() || "";
  const zoneKey = document.getElementById("shipping-zone")?.value || "";

  if (!name || !phone || !address || !zoneKey) {
    return alert("برجاء إكمال الاسم، رقم الهاتف، المنطقة، والعنوان بالتفصيل.");
  }
  if (!/^01[0125]\d{8}$/.test(phone)) {
    return alert("رقم الموبايل غير صحيح. اكتبيه بالشكل 01xxxxxxxxx");
  }

  const zone = shippingRates[zoneKey];
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const total = subtotal + zone.fee;
  const orderItems = cart.map((item) => ({
    id: item.id,
    name: item.name,
    price: item.price,
    qty: item.qty,
    line_total: item.price * item.qty
  }));

  const button = document.getElementById("checkout-btn");
  if (button) { button.disabled = true; button.textContent = "جاري تجهيز الطلب..."; }

  await saveOrder({
    customer_name: name,
    phone,
    address,
    shipping_zone: zoneKey,
    shipping_name: zone.name,
    shipping_fee: zone.fee,
    subtotal,
    total,
    items: orderItems
  });

  let msg = `*طلب جديد من موقع التميز ستور* 🛍️\n\n`;
  msg += `*بيانات العميل:*\n`;
  msg += `• الاسم: ${name}\n`;
  msg += `• الهاتف: ${phone}\n`;
  msg += `• المنطقة: ${zone.name}\n`;
  msg += `• العنوان بالتفصيل: ${address}\n\n`;
  msg += `*تفاصيل الفاتورة:*\n`;
  orderItems.forEach((item) => { msg += `▫️ ${item.name} × ${item.qty} = ${item.line_total} ج.م\n`; });
  msg += `\n------------------\n`;
  msg += `• مجموع المنتجات: ${subtotal} ج.م\n`;
  msg += `• مصاريف الشحن: ${zone.fee} ج.م\n`;
  msg += `• *الإجمالي المطلوب عند الاستلام: ${total} ج.م*`;

  const whatsapp = (window.TAMAYOZ_CONFIG?.whatsappNumber || "201011703785").replace(/\D/g, "");
  window.open(`https://wa.me/${whatsapp}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");

  if (button) { button.disabled = false; button.textContent = "تأكيد الطلب عبر واتساب 💬"; }
}

document.addEventListener("DOMContentLoaded", () => {
  injectCartUI();
  document.querySelectorAll("[data-open-cart]").forEach((button) => button.addEventListener("click", openCart));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeCart(); });
});
