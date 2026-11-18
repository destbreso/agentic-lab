// Fills every [data-topo] element with the grid for that topology, state and surface.
for (const el of document.querySelectorAll("[data-topo]")) {
  const T = TopoGrid, d = el.dataset;
  let def = d.arm ? TOPO.arms[d.arm] : d.sight ? TOPO[d.topo](TOPO[d.sight], d.lints === "1") : TOPO[d.topo];
  if (d.nosight) def = { ...def, sight: null };
  const st = d.state ? TOPO[d.state] : {};
  const g = d.layout === "strip" ? T.strip(def, TOPO.strips[d.strip]) : (d.layout === "vertical" ? T.vertical : T.horizontal)(def, st);
  const body = d.mode === "term" ? T.ansiToHTML(T.toANSI(g)) : T.toHTML(g);
  el.innerHTML = (d.cmd ? `<span class="prompt">$ ${d.cmd}</span>\n` : "") + body;
}
