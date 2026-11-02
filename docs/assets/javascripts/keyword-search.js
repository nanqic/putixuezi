/**
 * 关键词搜索（后端 workers/search-api，由 hdcx 的 fayu-api 移植）
 * - 搜索页：docs/search.md 中的 #kw-search，接口地址取自其 data-api；查询状态存于 URL（?q=&c=&page=）
 * - 文章页：结果链接带 ?p=段落号&hl=关键词，打开后滚动到该段并高亮关键词
 *   段落号规则须与 workers/search-api/scripts/import.mjs 的 UNIT_SELECTOR 一致：
 *   正文 article 中这些元素里不再包含同类元素的（叶子）依次编号，从 1 起
 */
(function () {
  var UNIT_SELECTOR = "p, li, dt, dd, td, th, h2, h3, h4, h5, h6";

  function siteUrl(path) {
    var scope = (window.__md_scope && window.__md_scope.href) || location.origin + "/";
    return new URL(path.replace(/^\//, ""), scope).toString();
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  // 按接口给出的区间 [起, 止) 高亮
  function highlighted(text, ranges) {
    var frag = document.createDocumentFragment();
    var pos = 0;
    (ranges || []).forEach(function (r) {
      if (r[0] > pos) frag.appendChild(document.createTextNode(text.slice(pos, r[0])));
      frag.appendChild(el("mark", null, text.slice(r[0], r[1])));
      pos = r[1];
    });
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    return frag;
  }

  /* ---------- 搜索页 ---------- */

  function initSearchPage() {
    var root = document.getElementById("kw-search");
    if (!root || root.dataset.ready === "1") return;
    root.dataset.ready = "1";
    var api = root.dataset.api.replace(/\/$/, "");

    var form = el("form", "kw-search__form");
    var input = el("input", "kw-search__input");
    input.type = "search";
    input.placeholder = "请输入关键词，多个词用空格分隔";
    input.autofocus = true;
    var button = el("button", "md-button md-button--primary kw-search__button", "搜索");
    button.type = "submit";
    form.append(input, button);
    var info = el("div", "kw-search__info");
    var facets = el("div", "kw-search__facets");
    var list = el("div", "kw-search__results");
    var pager = el("div", "kw-search__pager");
    root.replaceChildren(form, info, facets, list, pager);

    var state = { q: "", cats: [], page: 1 };
    var seq = 0;

    function readUrl() {
      var p = new URLSearchParams(location.search);
      state.q = p.get("q") || "";
      state.cats = (p.get("c") || "").split(",").filter(Boolean);
      state.page = Math.max(1, parseInt(p.get("page"), 10) || 1);
      input.value = state.q;
    }

    function writeUrl(push) {
      var p = new URLSearchParams();
      if (state.q) p.set("q", state.q);
      if (state.cats.length) p.set("c", state.cats.join(","));
      if (state.page > 1) p.set("page", String(state.page));
      var url = location.pathname + (p.toString() ? "?" + p : "");
      history[push ? "pushState" : "replaceState"](null, "", url);
    }

    function go(changes) {
      Object.assign(state, changes);
      writeUrl(true);
      run();
    }

    function renderFacets(data) {
      facets.replaceChildren();
      var names = Object.keys(data.facets || {});
      if (names.length < 2 && !state.cats.length) return;
      var all = el("button", "kw-search__facet" + (state.cats.length ? "" : " is-active"), "全部");
      all.type = "button";
      all.onclick = function () { go({ cats: [], page: 1 }); };
      facets.appendChild(all);
      names.forEach(function (name) {
        var b = el("button", "kw-search__facet" + (state.cats.indexOf(name) >= 0 ? " is-active" : ""), name + " " + data.facets[name]);
        b.type = "button";
        b.onclick = function () {
          var i = state.cats.indexOf(name);
          var cats = state.cats.slice();
          if (i >= 0) cats.splice(i, 1);
          else cats.push(name);
          go({ cats: cats, page: 1 });
        };
        facets.appendChild(b);
      });
    }

    function renderResults(data) {
      list.replaceChildren();
      var hl = data.terms.join(" ");
      data.results.forEach(function (r) {
        var card = el("section", "kw-search__card");
        var head = el("div", "kw-search__head");
        var title = el("a", "kw-search__title", r.title);
        title.href = siteUrl(r.url);
        var meta = el("span", "kw-search__meta", (r.groupLabel !== r.title ? r.groupLabel + " · " : "") + "出现 " + r.count + " 次");
        head.append(title, meta);
        card.appendChild(head);
        r.groups.forEach(function (g) {
          g.forEach(function (line) {
            var a = el("a", "kw-search__line");
            a.href = siteUrl(r.url) + "?p=" + line.p + "&hl=" + encodeURIComponent(hl);
            if (line.head) a.appendChild(document.createTextNode("…"));
            a.appendChild(highlighted(line.text, line.hl));
            if (line.tail) a.appendChild(document.createTextNode("…"));
            card.appendChild(a);
          });
        });
        list.appendChild(card);
      });
    }

    function renderPager(data) {
      pager.replaceChildren();
      var pages = Math.ceil(data.total / data.pageSize);
      if (pages < 2) return;
      function btn(label, page, disabled) {
        var b = el("button", "md-button kw-search__page", label);
        b.type = "button";
        b.disabled = disabled;
        b.onclick = function () { go({ page: page }); window.scrollTo(0, 0); };
        return b;
      }
      pager.append(btn("上一页", state.page - 1, state.page <= 1), el("span", null, state.page + " / " + pages), btn("下一页", state.page + 1, state.page >= pages));
    }

    function run() {
      var mine = ++seq;
      facets.replaceChildren();
      list.replaceChildren();
      pager.replaceChildren();
      if (!state.q) {
        info.textContent = "";
        return;
      }
      info.textContent = "正在搜索…";
      var p = new URLSearchParams({ q: state.q, page: String(state.page) });
      if (state.cats.length) p.set("c", state.cats.join(","));
      fetch(api + "/search?" + p)
        .then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok) throw new Error(data.error || "搜索暂不可用，请稍后重试");
            return data;
          });
        })
        .then(function (data) {
          if (mine !== seq) return;
          info.textContent = data.total ? "找到 " + data.total + " 篇，关键词共出现 " + data.matches + " 次" : "没有找到相关内容";
          renderFacets(data);
          renderResults(data);
          renderPager(data);
        })
        .catch(function (err) {
          if (mine !== seq) return;
          info.textContent = err.message || "搜索暂不可用，请稍后重试";
        });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      go({ q: input.value.trim(), page: 1 });
    });
    window.addEventListener("popstate", function () {
      readUrl();
      run();
    });
    readUrl();
    run();
  }

  /* ---------- 文章页：跳到 ?p= 段落并高亮 ---------- */

  function markTerms(node, terms) {
    if (!terms.length) return;
    var re = new RegExp(terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|"), "gi");
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    var texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach(function (t) {
      var s = t.nodeValue;
      re.lastIndex = 0;
      if (!re.test(s)) return;
      re.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var pos = 0;
      s.replace(re, function (m, at) {
        if (at > pos) frag.appendChild(document.createTextNode(s.slice(pos, at)));
        frag.appendChild(el("mark", null, m));
        pos = at + m.length;
      });
      if (pos < s.length) frag.appendChild(document.createTextNode(s.slice(pos)));
      t.parentNode.replaceChild(frag, t);
    });
  }

  function jumpToParagraph() {
    var params = new URLSearchParams(location.search);
    var p = parseInt(params.get("p"), 10);
    var article = document.querySelector("article.md-content__inner");
    if (!p || !article || article.dataset.kwJumped === "1") return;
    article.dataset.kwJumped = "1";
    var n = 0;
    var target = null;
    article.querySelectorAll(UNIT_SELECTOR).forEach(function (node) {
      if (target || node.querySelector(UNIT_SELECTOR)) return;
      if (++n === p) target = node;
    });
    if (!target) return;
    var details = target.closest("details");
    while (details) {
      details.open = true;
      details = details.parentElement && details.parentElement.closest("details");
    }
    markTerms(target, (params.get("hl") || "").split(/\s+/).filter(Boolean));
    target.classList.add("kw-search__target");
    target.scrollIntoView({ block: "center" });
  }

  function init() {
    initSearchPage();
    jumpToParagraph();
  }

  document.addEventListener("DOMContentLoaded", init);
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(init);
  }
})();
