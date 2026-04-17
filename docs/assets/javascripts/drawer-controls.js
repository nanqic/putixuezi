(function () {
  var MOON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="m17.75 4.09-2.53 1.94.91 3.06-2.63-1.81-2.63 1.81.91-3.06-2.53-1.94L12.44 4l1.06-3 1.06 3zm3.5 6.91-1.64 1.25.59 1.98-1.7-1.17-1.7 1.17.59-1.98L15.75 11l2.06-.05L18.5 9l.69 1.95zm-2.28 4.95c.83-.08 1.72 1.1 1.19 1.85-.32.45-.66.87-1.08 1.27C15.17 23 8.84 23 4.94 19.07c-3.91-3.9-3.91-10.24 0-14.14.4-.4.82-.76 1.27-1.08.75-.53 1.93.36 1.85 1.19-.27 2.86.69 5.83 2.89 8.02a9.96 9.96 0 0 0 8.02 2.89m-1.64 2.02a12.08 12.08 0 0 1-7.8-3.47c-2.17-2.19-3.33-5-3.49-7.82-2.81 3.14-2.7 7.96.31 10.98 3.02 3.01 7.84 3.12 10.98.31"/></svg>';
  var SUN_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 7a5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3m0-7 2.39 3.42C13.65 5.15 12.84 5 12 5s-1.65.15-2.39.42zM3.34 7l4.16-.35A7.2 7.2 0 0 0 5.94 8.5c-.44.74-.69 1.5-.83 2.29zm.02 10 1.76-3.77a7.131 7.131 0 0 0 2.38 4.14zM20.65 7l-1.77 3.79a7.02 7.02 0 0 0-2.38-4.15zm-.01 10-4.14.36c.59-.51 1.12-1.14 1.54-1.86.42-.73.69-1.5.83-2.29zM12 22l-2.41-3.44c.74.27 1.55.44 2.41.44.82 0 1.63-.17 2.37-.44z"/></svg>';
  var MINUS_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 13H5v-2h14z"/></svg>';
  var PLUS_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>';

  function getPaletteInputs() {
    return Array.from(
      document.querySelectorAll('input.md-option[name="__palette"][data-md-color-scheme]')
    );
  }

  function readPaletteColor(input) {
    if (!input) return null;
    return {
      media: input.getAttribute("data-md-color-media"),
      scheme: input.getAttribute("data-md-color-scheme"),
      primary: input.getAttribute("data-md-color-primary"),
      accent: input.getAttribute("data-md-color-accent")
    };
  }

  function persistPalette(color) {
    if (!color || typeof window.__md_set !== "function") return;
    try {
      window.__md_set("__palette", { color: color });
    } catch (_err) {
      // Ignore persistence failures.
    }
  }

  function applyPaletteColor(color) {
    if (!color) return;
    Object.keys(color).forEach(function (key) {
      if (color[key] !== null && color[key] !== undefined) {
        document.body.setAttribute("data-md-color-" + key, color[key]);
      }
    });
    persistPalette(color);
  }

  function pickNextPaletteInput(inputs) {
    if (!inputs.length) return null;

    var scheme = currentScheme();
    var current = inputs.find(function (input) {
      return input.getAttribute("data-md-color-scheme") === scheme;
    });
    if (!current) {
      current = inputs.find(function (input) {
        return input.checked;
      });
    }
    if (!current) return inputs[0];

    var currentIndex = inputs.indexOf(current);
    if (currentIndex < 0) return inputs[0];
    return inputs[(currentIndex + 1) % inputs.length];
  }

  function togglePalette() {
    var inputs = getPaletteInputs();
    if (inputs.length < 2) return;

    var next = pickNextPaletteInput(inputs);
    if (!next) return;

    next.checked = true;
    applyPaletteColor(readPaletteColor(next));
    next.dispatchEvent(new Event("change", { bubbles: true }));
    next.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function currentScheme() {
    return document.body.getAttribute("data-md-color-scheme") || "default";
  }

  function updateThemeButton(button) {
    if (!button) return;
    if (currentScheme() === "slate") {
      button.innerHTML = SUN_SVG;
      button.setAttribute("title", "切换到日间模式");
      button.setAttribute("aria-label", "切换到日间模式");
    } else {
      button.innerHTML = MOON_SVG;
      button.setAttribute("title", "切换到夜间模式");
      button.setAttribute("aria-label", "切换到夜间模式");
    }
  }

  function makeButton(extraClass, label, html) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "md-icon lsyh-drawer-btn " + extraClass;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.innerHTML = html;
    return button;
  }

  function swallowLabelClick(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function addDrawerControls() {
    var title = document.querySelector('.md-nav--primary .md-nav__title[for="__drawer"]');
    if (!title) return;

    var logo = title.querySelector(".md-logo");
    if (logo) {
      logo.remove();
    }

    var themeBtn = title.querySelector(".lsyh-drawer-theme-left-btn");
    if (!themeBtn) {
      themeBtn = makeButton("lsyh-drawer-theme-left-btn", "切换主题", MOON_SVG);
      themeBtn.addEventListener("click", swallowLabelClick);
      themeBtn.addEventListener("click", function () {
        togglePalette();
        updateThemeButton(themeBtn);
      });
      title.insertBefore(themeBtn, title.firstChild);
    }

    var controls = document.createElement("span");
    var existing = title.querySelector(".lsyh-drawer-controls");
    if (existing) {
      controls = existing;
      controls.innerHTML = "";
    } else {
      controls.className = "lsyh-drawer-controls";
      title.appendChild(controls);
    }

    var minusBtn = makeButton("lsyh-drawer-font-btn", "缩小字体", MINUS_SVG);
    minusBtn.setAttribute("data-lsyh-font-step", "-1");

    var plusBtn = makeButton("lsyh-drawer-font-btn", "放大字体", PLUS_SVG);
    plusBtn.setAttribute("data-lsyh-font-step", "1");

    [minusBtn, plusBtn].forEach(function (button) {
      button.addEventListener("click", swallowLabelClick);
      controls.appendChild(button);
    });
    updateThemeButton(themeBtn);

    if (window.__lsyhRefreshFontButtons) {
      window.__lsyhRefreshFontButtons();
    } else {
      document.dispatchEvent(new Event("lsyh:font-controls-refresh"));
    }
  }

  function watchThemeChange() {
    if (document.body.dataset.lsyhThemeObserverBound === "1") return;
    document.body.dataset.lsyhThemeObserverBound = "1";

    var observer = new MutationObserver(function () {
      var btn = document.querySelector(".lsyh-drawer-theme-left-btn");
      updateThemeButton(btn);
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-md-color-scheme"]
    });
  }

  function initDrawerControls() {
    addDrawerControls();
    watchThemeChange();
  }

  document.addEventListener("DOMContentLoaded", initDrawerControls);
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(initDrawerControls);
  }
})();
