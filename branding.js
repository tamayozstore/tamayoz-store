(function () {
  const cfg = window.TAMAYOZ_CONFIG || {};
  if (!cfg.supabaseUrl) return;

  const base = cfg.supabaseUrl.replace(/\/$/, "");
  const logoUrl = `${base}/storage/v1/object/public/products/branding/logo.webp?v=${Date.now()}`;

  function removeOldBrandExtras() {
    document.querySelectorAll(".brand-icon, .logo-text, .hero-brand-display").forEach((el) => el.remove());
  }

  function mountLogo(container, className, fallback) {
    if (!container || container.querySelector("[data-tamayoz-logo]")) return;
    const img = document.createElement("img");
    img.className = className;
    img.alt = "التميز ستور";
    img.hidden = true;
    img.dataset.tamayozLogo = "true";
    img.onload = () => {
      img.hidden = false;
      if (fallback) fallback.hidden = true;
    };
    img.onerror = () => {
      img.hidden = true;
      if (fallback) fallback.hidden = false;
    };
    img.src = logoUrl;
    container.prepend(img);
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Prevent old placeholders/text from appearing beside the real uploaded logo.
    removeOldBrandExtras();

    document.querySelectorAll(".nav-logo").forEach((container) => {
      mountLogo(container, "brand-logo-img", null);
    });

    const hero = document.querySelector(".hero-visual");
    if (hero) mountLogo(hero, "hero-logo-img", null);

    document.querySelectorAll(".site-footer").forEach((footer) => {
      const fallback = footer.querySelector(".footer-brand");
      mountLogo(footer, "footer-logo-img", fallback);
    });
  });
})();
