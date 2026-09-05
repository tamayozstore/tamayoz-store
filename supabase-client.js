(function () {
  const DEFAULT_CONFIG = {
    supabaseUrl: "https://mcqfkkgskpiwjcqzcuxr.supabase.co",
    supabaseAnonKey: "sb_publishable_aiRU2MY_9yy-UYXUlnRA2Q_VeB7Ov4F",
    whatsappNumber: "201011703785"
  };

  window.TAMAYOZ_CONFIG = Object.assign({}, DEFAULT_CONFIG, window.TAMAYOZ_CONFIG || {});
  window.TAMAYOZ_SUPABASE_READY = false;
  window.TAMAYOZ_SUPABASE_ERROR = null;
  window.storeDb = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find((s) => s.src === src);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error(`فشل تحميل ${src}`)), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = resolve;
      script.onerror = () => reject(new Error(`فشل تحميل مكتبة Supabase من ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureSupabaseLibrary() {
    if (window.supabase?.createClient) return;

    const sources = [
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
      "https://unpkg.com/@supabase/supabase-js@2"
    ];

    let lastError = null;
    for (const src of sources) {
      try {
        await loadScript(src);
        if (window.supabase?.createClient) return;
      } catch (error) {
        lastError = error;
        console.warn(error);
      }
    }
    throw lastError || new Error("مكتبة Supabase لم يتم تحميلها");
  }

  async function initSupabase() {
    const cfg = window.TAMAYOZ_CONFIG || {};
    const hasRealConfig = Boolean(
      cfg.supabaseUrl &&
      cfg.supabaseAnonKey &&
      /^https:\/\/.+\.supabase\.co$/i.test(cfg.supabaseUrl) &&
      !cfg.supabaseUrl.includes("YOUR_PROJECT_ID") &&
      !cfg.supabaseAnonKey.includes("YOUR_PUBLISHABLE")
    );

    if (!hasRealConfig) {
      throw new Error("بيانات Project URL أو Publishable Key غير صحيحة");
    }

    await ensureSupabaseLibrary();

    window.storeDb = window.supabase.createClient(
      cfg.supabaseUrl,
      cfg.supabaseAnonKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    window.TAMAYOZ_SUPABASE_READY = true;
    return window.storeDb;
  }

  window.TAMAYOZ_SUPABASE_PROMISE = initSupabase().catch((error) => {
    window.TAMAYOZ_SUPABASE_ERROR = error;
    window.TAMAYOZ_SUPABASE_READY = false;
    window.storeDb = null;
    console.error("Tamayoz Store: Supabase init failed", error);
    return null;
  });
})();
