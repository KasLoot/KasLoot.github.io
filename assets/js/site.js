// Small progressive enhancements: diagram notes, chart tooltips, reduced-motion video.

// Interactive diagrams: hovering, focusing or tapping a node shows its note beside the diagram.
document.querySelectorAll("[data-diagram]").forEach((root) => {
  const note = root.querySelector(".diagram-note");
  const initial = note.innerHTML;
  const nodes = root.querySelectorAll(".node");
  let pinned = null;
  const show = (node) => {
    nodes.forEach((n) => n.classList.toggle("on", n === node));
    if (!node) { note.innerHTML = initial; return; }
    const h = document.createElement("h4");
    h.textContent = node.dataset.title;
    note.replaceChildren(h, ...node.dataset.body.split("|").map((t) => {
      const p = document.createElement("p"); p.textContent = t.trim(); return p;
    }));
  };
  nodes.forEach((node) => {
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", node.dataset.title);
    node.addEventListener("mouseenter", () => show(node));
    node.addEventListener("mouseleave", () => show(pinned));
    node.addEventListener("focus", () => show(node));
    node.addEventListener("click", () => { pinned = pinned === node ? null : node; show(pinned || node); });
    node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); node.click(); } });
  });
});

// Chart tooltips: every bar carries data-tip ("Title|detail").
document.querySelectorAll(".chart").forEach((chart) => {
  const tip = chart.querySelector(".tip");
  if (!tip) return;
  chart.querySelectorAll("[data-tip]").forEach((el) => {
    const on = () => {
      const [title, body] = el.dataset.tip.split("|");
      const b = document.createElement("b"); b.textContent = title;
      tip.replaceChildren(b, document.createTextNode(body || ""));
      const r = el.getBoundingClientRect(), c = chart.getBoundingClientRect();
      tip.style.left = Math.min(r.left - c.left, c.width - 290) + "px";
      tip.style.top = (r.bottom - c.top + 8) + "px";
      tip.classList.add("show");
    };
    el.addEventListener("mouseenter", on); el.addEventListener("focus", on);
    el.addEventListener("mouseleave", () => tip.classList.remove("show"));
    el.addEventListener("blur", () => tip.classList.remove("show"));
  });
});

// Respect reduced motion: stop autoplaying loops and show their controls instead.
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.querySelectorAll("video[autoplay]").forEach((v) => { v.pause(); v.removeAttribute("autoplay"); v.controls = true; });
}
