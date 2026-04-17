(function () {
  var STORAGE_KEY = "lsyh_typeset_font_size";
  var FONT_SIZES = Array.from({ length: 21 }, function (_, i) {
    return 10 + 2 * i;
  });
  var DEFAULT_SIZE = 18;

  function normalizeSize(value) {
    var num = Number(value);
    if (!Number.isFinite(num)) return DEFAULT_SIZE;

    var closest = FONT_SIZES[0];
    for (var i = 1; i < FONT_SIZES.length; i += 1) {
      if (Math.abs(FONT_SIZES[i] - num) < Math.abs(closest - num)) {
        closest = FONT_SIZES[i];
      }
    }
    return closest;
  }

  function readStoredSize() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return DEFAULT_SIZE;
      return normalizeSize(saved);
    } catch (_err) {
      return DEFAULT_SIZE;
    }
  }

  function writeStoredSize(size) {
    try {
      localStorage.setItem(STORAGE_KEY, String(size));
    } catch (_err) {
      // Ignore persistence errors (private mode, blocked storage).
    }
  }

  function getCurrentSize() {
    var applied = document.documentElement.getAttribute("data-lsyh-font-size");
    if (applied) return normalizeSize(applied);
    return readStoredSize();
  }

  function applySize(size) {
    var resolved = normalizeSize(size);
    document.documentElement.style.setProperty("--lsyh-typeset-font-size", resolved + "px");
    document.documentElement.setAttribute("data-lsyh-font-size", String(resolved));
    writeStoredSize(resolved);
    updateButtons(resolved);
  }

  function updateButtons(size) {
    var controls = document.querySelectorAll("[data-lsyh-font-step]");
    var minSize = FONT_SIZES[0];
    var maxSize = FONT_SIZES[FONT_SIZES.length - 1];

    controls.forEach(function (button) {
      var step = Number(button.getAttribute("data-lsyh-font-step"));
      if (step < 0) {
        button.disabled = size <= minSize;
      } else if (step > 0) {
        button.disabled = size >= maxSize;
      }
    });
  }

  function stepSize(direction) {
    var current = getCurrentSize();
    var index = FONT_SIZES.indexOf(current);
    if (index < 0) index = FONT_SIZES.indexOf(DEFAULT_SIZE);

    var nextIndex = index + direction;
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= FONT_SIZES.length) nextIndex = FONT_SIZES.length - 1;

    applySize(FONT_SIZES[nextIndex]);
  }

  function bindButtons() {
    var controls = document.querySelectorAll("[data-lsyh-font-step]");
    controls.forEach(function (button) {
      if (button.dataset.lsyhBound === "1") return;
      button.dataset.lsyhBound = "1";

      button.addEventListener("click", function () {
        var step = Number(button.getAttribute("data-lsyh-font-step"));
        if (step < 0) {
          stepSize(-1);
        } else if (step > 0) {
          stepSize(1);
        }
      });
    });
  }

  function initFontSizeControls() {
    applySize(readStoredSize());
    bindButtons();
  }

  function refreshFontSizeControls() {
    bindButtons();
    updateButtons(getCurrentSize());
  }

  window.__lsyhRefreshFontButtons = refreshFontSizeControls;

  document.addEventListener("DOMContentLoaded", initFontSizeControls);
  document.addEventListener("lsyh:font-controls-refresh", refreshFontSizeControls);
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(initFontSizeControls);
  }
})();
