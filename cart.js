// أسعار الشحن الرسمية للمتجر
const shippingRates = {
  "cairo_giza": { name: "القاهرة والجيزة", fee: 70 },
  "bahary": { name: "الوجه البحري (إسكندرية، القليوبية، الدلتا، القناة)", fee: 80 },
  "beheira": { name: "البحيرة", fee: 90 },
  "qebly": { name: "الوجه القبلي وصعيد مصر", fee: 90 },
  "new_valley": { name: "الوادي الجديد", fee: 110 },
  "hurghada": { name: "الغردقة", fee: 110 },
  "matrouh": { name: "مطروح", fee: 140 },
  "sinai": { name: "شمال وجنوب سيناء", fee: 150 },
  "sharm": { name: "شرم الشيخ", fee: 160 }
};

let cart = JSON.parse(localStorage.getItem('tamayoz_cart')) || [];

function saveCart() {
  localStorage.setItem('tamayoz_cart', JSON.stringify(cart));
  updateCartUI();
}

function addToCart(title, price, img) {
  const cleanPrice = parseFloat(price);
  const existing = cart.find(item => item.title === title);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ title, price: cleanPrice, img, qty: 1 });
  }
  saveCart();
  openCart();
}

function changeQty(index, delta) {
  cart[index].qty += delta;
  if (cart[index].qty <= 0) {
    cart.splice(index, 1);
  }
  saveCart();
}

function updateCartUI() {
  const countBadge = document.getElementById('cart-count');
  const cartItems = document.getElementById('cart-items');
  const subtotalEl = document.getElementById('cart-subtotal');
  const shippingEl = document.getElementById('cart-shipping');
  const totalEl = document.getElementById('cart-total');
  const zoneSelect = document.getElementById('shipping-zone');

  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
  if(countBadge) countBadge.innerText = totalQty;

  if (!cartItems) return;

  if (cart.length === 0) {
    cartItems.innerHTML = '<div style="text-align:center; padding:40px 10px; color:#888;">السلة فارغة حالياً 🛒</div>';
    if(subtotalEl) subtotalEl.innerText = "0 ج.م";
    if(shippingEl) shippingEl.innerText = "0 ج.م";
    if(totalEl) totalEl.innerText = "0 ج.م";
    return;
  }

  cartItems.innerHTML = cart.map((item, idx) => `
    <div class="cart-item">
      <img src="${item.img}" alt="${item.title}">
      <div class="cart-item-info">
        <h4>${item.title}</h4>
        <div class="cart-item-price">${item.price} ج.م</div>
        <div class="cart-qty-ctrl">
          <button onclick="changeQty(${idx}, -1)">-</button>
          <span>${item.qty}</span>
          <button onclick="changeQty(${idx}, 1)">+</button>
        </div>
      </div>
      <button class="remove-btn" onclick="changeQty(${idx}, -${item.qty})">✕</button>
    </div>
  `).join('');

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const selectedZone = zoneSelect ? zoneSelect.value : "";
  const shippingFee = selectedZone && shippingRates[selectedZone] ? shippingRates[selectedZone].fee : 0;
  const total = subtotal + shippingFee;

  if(subtotalEl) subtotalEl.innerText = `${subtotal} ج.م`;
  if(shippingEl) shippingEl.innerText = selectedZone ? `${shippingFee} ج.م` : "حددي المنطقة";
  if(totalEl) totalEl.innerText = `${total} ج.م`;
}

function openCart() {
  document.getElementById('cart-drawer').classList.add('open');
  document.getElementById('cart-overlay').classList.add('open');
}

function closeCart() {
  document.getElementById('cart-drawer').classList.remove('open');
  document.getElementById('cart-overlay').classList.remove('open');
}

function checkoutWhatsApp() {
  if (cart.length === 0) {
    alert("السلة فارغة!");
    return;
  }
  const name = document.getElementById('cust-name').value.trim();
  const phone = document.getElementById('cust-phone').value.trim();
  const address = document.getElementById('cust-address').value.trim();
  const zoneSelect = document.getElementById('shipping-zone');
  const zoneKey = zoneSelect.value;

  if (!name || !phone || !address || !zoneKey) {
    alert("برجاء إكمال الاسم، ورقم الهاتف، والمنطقة، وتفاصيل العنوان لحساب الإجمالي.");
    return;
  }

  const zone = shippingRates[zoneKey];
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const total = subtotal + zone.fee;

  let msg = `*طلب جديد من موقع التميز ستور* 🛍️\n\n`;
  msg += `*بيانات العميل:*\n`;
  msg += `• الاسم: ${name}\n`;
  msg += `• الهاتف: ${phone}\n`;
  msg += `• المنطقة: ${zone.name}\n`;
  msg += `• العنوان بالتفصيل: ${address}\n\n`;
  msg += `*تفاصيل الفاتورة:*\n`;

  cart.forEach(item => {
    msg += `▫️ ${item.title} × ${item.qty} = ${item.price * item.qty} ج.م\n`;
  });

  msg += `\n------------------\n`;
  msg += `• مجموع المنتجات: ${subtotal} ج.م\n`;
  msg += `• مصاريف الشحن: ${zone.fee} ج.م\n`;
  msg += `• *الإجمالي المطلوب عند الاستلام: ${total} ج.م*`;

  window.open(`https://wa.me/201110715438?text=${encodeURIComponent(msg)}`, '_blank');
}

document.addEventListener('DOMContentLoaded', () => {
  updateCartUI();
  const zoneSelect = document.getElementById('shipping-zone');
  if(zoneSelect) {
    zoneSelect.addEventListener('change', updateCartUI);
  }
});