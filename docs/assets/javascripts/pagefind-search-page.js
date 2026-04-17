(function () {
  var state = {
    loading: null,
    loaded: false,
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

  function getAssetUrl(fileName) {
    var basePath = normalizeBasePath(getBasePath());
    return new URL(basePath + "pagefind/" + fileName, window.location.origin).toString();
  }

  function loadStylesheetOnce(href) {
    if (document.querySelector('link[data-pagefind-ui="1"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-pagefind-ui", "1");
    document.head.appendChild(link);
  }

  function loadScriptOnce(src) {
    return new Promise(function (resolve, reject) {
      if (window.PagefindUI) {
        resolve();
        return;
      }

      var existing = document.querySelector('script[data-pagefind-ui="1"]');
      if (existing) {
        existing.addEventListener("load", function () {
          resolve();
        });
        existing.addEventListener("error", function () {
          reject(new Error("Failed to load Pagefind UI script"));
        });
        return;
      }

      var script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.setAttribute("data-pagefind-ui", "1");
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        reject(new Error("Failed to load Pagefind UI script"));
      };
      document.head.appendChild(script);
    });
  }

  function ensurePagefindUiLoaded() {
    if (state.loaded) return Promise.resolve();
    if (state.loading) return state.loading;

    var cssUrl = getAssetUrl("pagefind-ui.css");
    var jsUrl = getAssetUrl("pagefind-ui.js");
    loadStylesheetOnce(cssUrl);

    state.loading = loadScriptOnce(jsUrl).then(function () {
      state.loaded = true;
    });

    return state.loading;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function hasChinese(text) {
    return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(String(text || ""));
  }

  function shouldDelayNonChineseSearch(value) {
    var normalized = normalizeText(value);
    if (!normalized) return false;
    return !hasChinese(normalized);
  }

  function pickHighlightText(container, linkEl) {
    var input = container.querySelector(".pagefind-ui__search-input");
    var query = normalizeText(input && input.value);
    if (query) return query.slice(0, 80);

    var resultItem = linkEl && linkEl.closest(".pagefind-ui__result");
    if (resultItem) {
      var mark = resultItem.querySelector("mark");
      if (mark) {
        var marked = normalizeText(mark.textContent);
        if (marked) return marked.slice(0, 80);
      }
    }

    return "";
  }

  function encodeTextFragmentExpression(value) {
    return String(value || "")
      .split(",")
      .map(function (part) {
        return encodeURIComponent(part.trim());
      })
      .filter(Boolean)
      .join(",");
  }

  function withTextFragmentHash(rawUrl, highlightText) {
    if (!rawUrl || !highlightText) return rawUrl;

    var url;
    try {
      url = new URL(rawUrl, window.location.origin);
    } catch (_err) {
      return rawUrl;
    }

    if (url.origin !== window.location.origin) return rawUrl;

    var encoded = encodeTextFragmentExpression(highlightText);
    if (!encoded) return rawUrl;

    var hash = url.hash ? url.hash.slice(1) : "";
    // Preserve existing anchor and append/replace native text fragment.
    if (hash.indexOf(":~:text=") >= 0) {
      hash = hash.replace(/:~:text=[^&]*/g, ":~:text=" + encoded);
    } else if (!hash) {
      hash = ":~:text=" + encoded;
    } else {
      hash = hash + ":~:text=" + encoded;
    }

    url.hash = hash;
    return url.pathname + url.search + url.hash;
  }

  function patchResultLinksWithTextFragment(container) {
    if (container.dataset.pagefindHighlightBound === "1") return;
    container.dataset.pagefindHighlightBound = "1";

    function handleActivate(event) {
      var link = event.target && event.target.closest(".pagefind-ui__result-link");
      if (!link) return;

      var highlight = pickHighlightText(container, link);
      if (!highlight) return;

      var currentHref = link.getAttribute("href");
      var nextHref = withTextFragmentHash(currentHref, highlight);
      if (nextHref && nextHref !== currentHref) {
        link.setAttribute("href", nextHref);
      }
    }

    container.addEventListener("click", handleActivate, true);
    container.addEventListener("auxclick", handleActivate, true);
  }

  function patchInputDebounceForNonChinese(container, pagefindUi) {
    if (!pagefindUi || container.dataset.pagefindInputBound === "1") return;

    var input = container.querySelector(".pagefind-ui__search-input");
    if (!input) return;

    container.dataset.pagefindInputBound = "1";

    var timer = null;
    var ticket = 0;
    var isComposing = false;

    function clearTimer() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    }

    function scheduleNonChineseSearch(snapshotRaw, snapshotNormalized) {
      ticket += 1;
      var currentTicket = ticket;
      clearTimer();

      timer = setTimeout(function () {
        timer = null;

        var latestRaw = String(input.value || "");
        var latest = normalizeText(input.value);
        if (currentTicket !== ticket) return;
        if (isComposing) return;
        if (latestRaw !== snapshotRaw) return;
        if (latest !== snapshotNormalized) return;
        if (!shouldDelayNonChineseSearch(latest)) return;

        pagefindUi.triggerSearch(input.value);
      }, 2000);
    }

    input.addEventListener(
      "compositionstart",
      function () {
        isComposing = true;
        clearTimer();
      },
      true
    );

    input.addEventListener(
      "compositionend",
      function () {
        isComposing = false;
      },
      true
    );

    input.addEventListener(
      "input",
      function (event) {
        var current = normalizeText(input.value);

        if (!current) {
          clearTimer();
          return;
        }

        if (!shouldDelayNonChineseSearch(current)) {
          clearTimer();
          return;
        }

        // Block Pagefind's default immediate/debounced request for non-Chinese.
        event.stopImmediatePropagation();
        if (isComposing || event.isComposing) {
          clearTimer();
          return;
        }
        scheduleNonChineseSearch(String(input.value || ""), current);
      },
      true
    );
  }

  function sanitizeResultText(text) {
    var value = String(text || "");
    if (!value) return value;
    return value
      .replace(/(^|[\s>])(?:跳转至|Jump to)\s*/gi, "$1")
      .replace(/\s{2,}/g, " ");
  }

  function sanitizeResultData(result) {
    if (!result || typeof result !== "object") return result;

    var next = Object.assign({}, result);
    if (next.excerpt) {
      next.excerpt = sanitizeResultText(next.excerpt);
    }

    if (next.meta && typeof next.meta === "object") {
      next.meta = Object.assign({}, next.meta);
      if (next.meta.title) {
        next.meta.title = sanitizeResultText(next.meta.title).trim();
      }
    }

    if (Array.isArray(next.sub_results)) {
      next.sub_results = next.sub_results.map(function (item) {
        if (!item || typeof item !== "object") return item;
        var cleaned = Object.assign({}, item);
        if (cleaned.title) cleaned.title = sanitizeResultText(cleaned.title).trim();
        if (cleaned.excerpt) cleaned.excerpt = sanitizeResultText(cleaned.excerpt);
        return cleaned;
      });
    }

    return next;
  }

  function initPagefindSearchPage() {
    var container = document.getElementById("pagefind-search");
    if (!container || container.dataset.pagefindReady === "1") return;

    container.dataset.pagefindReady = "1";
    container.textContent = "正在加载搜索...";

    ensurePagefindUiLoaded()
      .then(function () {
        container.textContent = "";
        if (!window.PagefindUI) {
          container.textContent = "搜索组件加载失败，请稍后重试";
          return;
        }

        patchResultLinksWithTextFragment(container);

        var pagefindUi = new window.PagefindUI({
          element: "#pagefind-search",
          showSubResults: false,
          excerptLength: 20,
          resetStyles: false,
          processResult: sanitizeResultData,
          autofocus: true,
          translations: {
            placeholder: "请输入搜索关键字...",
            clear_search: "清除",
            load_more: "加载更多",
            search_label: "搜索",
            zero_results: "没有找到相关内容",
            many_results: "找到 [COUNT] 条结果",
            one_result: "找到 1 条结果",
            alt_search: "结果 [FROM] 到 [TO]"
          }
        });

        patchInputDebounceForNonChinese(container, pagefindUi);
      })
      .catch(function (error) {
        container.dataset.pagefindReady = "0";
        container.textContent = "搜索组件加载失败，请稍后重试";
        console.error("[pagefind-search-page]", error);
      });
  }

  document.addEventListener("DOMContentLoaded", initPagefindSearchPage);
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(initPagefindSearchPage);
  }
})();
