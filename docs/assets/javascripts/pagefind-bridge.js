(function () {
  var state = {
    loadPromise: null,
    token: 0,
  };

  function getBasePath() {
    if (window.__md_scope && window.__md_scope.pathname) {
      return window.__md_scope.pathname;
    }
    var base = document.querySelector("base");
    if (base && base.getAttribute("href")) {
      return base.getAttribute("href");
    }
    return "/";
  }

  function normalizeBasePath(path) {
    if (!path) return "/";
    return path.endsWith("/") ? path : path + "/";
  }

  function getPagefindModuleUrl() {
    var basePath = normalizeBasePath(getBasePath());
    return new URL(basePath + "pagefind/pagefind.js", window.location.origin).toString();
  }

  function resolveResultUrl(url) {
    var value = String(url || "");
    if (!value) return "#";
    if (/^https?:\/\//i.test(value)) return value;

    var basePath = normalizeBasePath(getBasePath());
    if (value.startsWith("/")) {
      if (value.startsWith(basePath)) return value;
      return basePath + value.replace(/^\/+/, "");
    }

    return value;
  }

  function loadPagefind() {
    if (state.loadPromise) return state.loadPromise;

    state.loadPromise = import(getPagefindModuleUrl()).then(function (mod) {
      if (!mod || typeof mod.search !== "function") {
        throw new Error("Pagefind module loaded but search API is unavailable.");
      }
      return mod;
    });

    return state.loadPromise;
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clearResults(listEl) {
    listEl.innerHTML = "";
  }

  function setMeta(metaEl, text) {
    metaEl.textContent = text;
  }

  function formatBreadcrumbSegment(segment) {
    var decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch (_err) {
      decoded = segment;
    }
    return decoded.replace(/[-_]+/g, " ");
  }

  function buildBreadcrumb(url) {
    var resolved = resolveResultUrl(url);
    var pathname = "";

    try {
      pathname = new URL(resolved, window.location.origin).pathname;
    } catch (_err) {
      return "";
    }

    var basePath = normalizeBasePath(getBasePath());
    if (pathname.startsWith(basePath)) {
      pathname = pathname.slice(basePath.length);
    } else {
      pathname = pathname.replace(/^\/+/, "");
    }

    pathname = pathname.replace(/index\.html$/i, "").replace(/\/+$/, "");
    if (!pathname) return "";

    var segments = pathname.split("/").filter(Boolean);
    if (segments.length > 1) segments.pop();
    if (!segments.length) return "";

    return segments.map(formatBreadcrumbSegment).join(" / ");
  }

  function renderItems(listEl, items) {
    var html = items
      .map(function (item) {
        var href = resolveResultUrl(item.url);
        var title =
          (item.meta && item.meta.title && String(item.meta.title)) || String(item.url);
        var excerpt = item.excerpt || "";
        var breadcrumb = buildBreadcrumb(item.url);
        var breadcrumbHtml = breadcrumb
          ? '<p class="md-search-result__breadcrumb">' + escapeHtml(breadcrumb) + "</p>"
          : "";
        return [
          '<li class="md-search-result__item">',
          '<article class="md-search-result__article">',
          breadcrumbHtml,
          '<a href="' + escapeHtml(href) + '" class="md-search-result__link">' + escapeHtml(title) + '</a>',
          '<p class="md-search-result__teaser">' + excerpt + '</p>',
          '</article>',
          '</li>',
        ].join("");
      })
      .join("");

    listEl.innerHTML = html;
  }

  function createController(root) {
    var form = root.querySelector(".md-search__form");
    var queryEl = root.querySelector("[data-pagefind-query]");
    var metaEl = root.querySelector("[data-pagefind-meta]");
    var listEl = root.querySelector("[data-pagefind-results]");

    if (!form || !queryEl || !metaEl || !listEl) return null;

    var initialText = (metaEl.textContent || "").trim() || "输入以开始搜索";
    var timer = null;

    async function runSearch(rawQuery, token) {
      var query = rawQuery.trim();

      if (!query) {
        clearResults(listEl);
        setMeta(metaEl, initialText);
        return;
      }

      setMeta(metaEl, "正在搜索...");

      try {
        var pagefind = await loadPagefind();
        var search = await pagefind.search(query);

        if (token !== state.token) return;

        var resultEntries = (search && search.results) || [];
        if (!resultEntries.length) {
          clearResults(listEl);
          setMeta(metaEl, "未找到相关结果");
          return;
        }

        var limited = resultEntries.slice(0, 50);
        var docs = await Promise.all(
          limited.map(function (entry) {
            return entry.data();
          })
        );

        if (token !== state.token) return;

        renderItems(listEl, docs);
        setMeta(metaEl, "找到 " + resultEntries.length + " 条结果");
      } catch (error) {
        if (token !== state.token) return;
        clearResults(listEl);
        setMeta(metaEl, "搜索暂时不可用，请稍后重试");
        console.error("[pagefind-bridge] Search failed:", error);
      }
    }

    queryEl.addEventListener("input", function () {
      state.token += 1;
      var currentToken = state.token;
      if (timer) clearTimeout(timer);

      timer = setTimeout(function () {
        runSearch(queryEl.value, currentToken);
      }, 120);
    });

    form.addEventListener("reset", function () {
      state.token += 1;
      if (timer) clearTimeout(timer);
      clearResults(listEl);
      setMeta(metaEl, initialText);
      window.setTimeout(function () {
        queryEl.focus();
      }, 0);
    });

    return {
      focus: function () {
        queryEl.focus();
      },
    };
  }

  function initPagefindBridge() {
    var root = document.querySelector(".md-search--pagefind");
    if (!root || root.dataset.pagefindBound === "1") return;

    var controller = createController(root);
    if (!controller) return;

    root.dataset.pagefindBound = "1";

    var searchToggle = document.getElementById("__search");
    if (searchToggle) {
      searchToggle.addEventListener("change", function () {
        if (searchToggle.checked) {
          window.setTimeout(function () {
            controller.focus();
          }, 20);
        }
      });
    }
  }

  document.addEventListener("DOMContentLoaded", initPagefindBridge);
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(initPagefindBridge);
  }
})();
