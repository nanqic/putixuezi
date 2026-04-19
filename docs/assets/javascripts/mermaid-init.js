document$.subscribe(() => {
  const mermaidBlocks = document.querySelectorAll("pre code.language-mermaid");

  if (!mermaidBlocks.length || typeof mermaid === "undefined") {
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose"
  });

  mermaidBlocks.forEach((block, index) => {
    const pre = block.parentElement;
    if (!pre || pre.dataset.mermaidProcessed === "true") {
      return;
    }

    const container = document.createElement("div");
    container.className = "mermaid";
    container.textContent = block.textContent || "";
    container.id = `mermaid-${index}-${Math.random().toString(36).slice(2, 8)}`;

    pre.replaceWith(container);
    pre.dataset.mermaidProcessed = "true";
  });

  mermaid.run({
    querySelector: ".mermaid"
  });
});
