(function () {
  function bindHeaderTitleHome() {
    var title = document.querySelector(".md-header__title");
    if (!title || title.dataset.homeBound === "1") return;

    var logoLink = document.querySelector(".md-header__button.md-logo");
    var homeHref = (logoLink && logoLink.getAttribute("href")) || "/";

    title.style.cursor = "pointer";
    title.setAttribute("title", "返回首页");
    title.addEventListener("click", function () {
      window.location.href = homeHref;
    });

    title.dataset.homeBound = "1";
  }

  document.addEventListener("DOMContentLoaded", bindHeaderTitleHome);
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(bindHeaderTitleHome);
  }
})();
