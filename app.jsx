const { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, Fragment } = React;

const tinyBtnStyle = { padding: "3px 8px", border: "1px solid oklch(0.82 0.01 270)", background: "transparent", borderRadius: 5, fontSize: 11, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" };

/* =========================================================
   SHAPE LIBRARY — used as clip/mask for color blobs
   Each shape is an SVG <path> in a 0..100 viewBox
   ========================================================= */
const SHAPES = [
{ id: "circle", d: "M50 2 a48 48 0 1 0 0.01 0 Z" },
{ id: "blob", d: "M50 4 C78 6 96 28 92 56 C88 84 60 98 38 92 C14 86 2 58 10 32 C18 10 34 4 50 4 Z" },
{ id: "flower", d: "M50 10 C60 10 68 22 60 32 C72 26 84 34 82 46 C88 54 82 68 70 68 C76 78 68 90 58 86 C56 96 44 96 42 86 C32 90 24 78 30 68 C18 68 12 54 18 46 C16 34 28 26 40 32 C32 22 40 10 50 10 Z" },
{ id: "leaf", d: "M50 6 C76 14 92 40 78 70 C68 90 46 94 30 86 C14 78 10 56 20 38 C28 22 38 12 50 6 Z M20 80 C30 70 50 50 80 30" },
{ id: "star", d: "M50 4 L60 36 L94 38 L66 58 L78 92 L50 72 L22 92 L34 58 L6 38 L40 36 Z" },
{ id: "heart", d: "M50 88 C10 62 10 24 32 18 C42 16 50 24 50 32 C50 24 58 16 68 18 C90 24 90 62 50 88 Z" },
{ id: "diamond", d: "M50 4 L92 50 L50 96 L8 50 Z" },
{ id: "moon", d: "M60 10 a42 42 0 1 0 0 80 a32 32 0 1 1 0 -80 Z" }];

const SHAPE_BY_ID = Object.fromEntries(SHAPES.map((s) => [s.id, s]));

/* =========================================================
   GRAPH MODEL
   Node types:
     color    -> { color: hex } emits "c"
     shape    -> { x,y,size,softness } + input c -> emits "blob" (drawable)
     noise    -> { amount, scale } emits "grain"
     blur     -> input blob, radius -> emits blob
     blend    -> inputs a,b, mode -> emits blob
     math     -> inputs a,b, op (mix,mult,add) amount -> emits blob
     output   -> inputs blobs[] (any #) -> renders
   ========================================================= */

const uid = (() => {let n = 100;return () => String(++n);})();

const INITIAL_NODES = [
{ id: "n1", type: "color", x: 60, y: 100, data: { color: "#ffb199", label: "coral" } },
{ id: "n2", type: "color", x: 60, y: 310, data: { color: "#9dc6ff", label: "sky" } },
{ id: "n3", type: "color", x: 60, y: 520, data: { color: "#ffe7a8", label: "butter" } },
{ id: "n4", type: "shape", x: 300, y: 80, data: { cx: 0.28, cy: 0.32, size: 0.75, softness: 0.85, shape: "blob" } },
{ id: "n5", type: "shape", x: 300, y: 290, data: { cx: 0.72, cy: 0.48, size: 0.65, softness: 0.9, shape: "flower" } },
{ id: "n6", type: "shape", x: 300, y: 500, data: { cx: 0.55, cy: 0.85, size: 0.55, softness: 0.8, shape: "leaf" } },
{ id: "n8", type: "noise", x: 560, y: 470, data: { amount: 0.12, scale: 1.4 } },
{ id: "na", type: "animation", x: 560, y: 640, data: { style: "ripple", speed: 1 } },
{ id: "n9", type: "output", x: 820, y: 120, data: { w: 420, h: 640 } }];


const INITIAL_EDGES = [
// colors → shapes
{ id: "e1", from: { n: "n1", p: "c" }, to: { n: "n4", p: "color" } },
{ id: "e2", from: { n: "n2", p: "c" }, to: { n: "n5", p: "color" } },
{ id: "e3", from: { n: "n3", p: "c" }, to: { n: "n6", p: "color" } },
// shapes → output
{ id: "e4", from: { n: "n5", p: "blob" }, to: { n: "n9", p: "in" } },
{ id: "e5", from: { n: "n4", p: "blob" }, to: { n: "n9", p: "in" } },
{ id: "e7", from: { n: "n6", p: "blob" }, to: { n: "n9", p: "in" } },
{ id: "e8", from: { n: "n8", p: "grain" }, to: { n: "n9", p: "grain" } },
{ id: "e9", from: { n: "na", p: "anim" }, to: { n: "n9", p: "anim" } }];


/* Port definitions per node type. Inputs on left, outputs on right. */
const PORTS = {
  color: { in: [], out: [{ id: "c", label: "color", kind: "color" }] },
  shape: { in: [{ id: "color", label: "color", kind: "color" }, { id: "grain", label: "grain", kind: "grain" }],
    out: [{ id: "blob", label: "blob", kind: "blob" }] },
  noise: { in: [], out: [{ id: "grain", label: "grain", kind: "grain" }] },
  animation: { in: [], out: [{ id: "anim", label: "anim", kind: "anim" }] },
  blend: { in: [{ id: "a", label: "a", kind: "blob" }, { id: "b", label: "b", kind: "blob" }],
    out: [{ id: "blob", label: "out", kind: "blob" }] },
  math: { in: [{ id: "a", label: "a", kind: "blob" }, { id: "b", label: "b", kind: "blob" }],
    out: [{ id: "blob", label: "out", kind: "blob" }] },
  output: { in: [{ id: "in", label: "in", kind: "blob", multi: true },
    { id: "grain", label: "grain", kind: "grain" },
    { id: "anim", label: "anim", kind: "anim" }],
    out: [] }
};

const ANIM_STYLES = ["ripple", "breathe", "drift", "float", "shimmer", "wave"];

const NODE_META = {
  color: { title: "Color", hue: 25, accent: "var(--accent-a)" },
  shape: { title: "Shape", hue: 220, accent: "var(--accent-b)" },
  noise: { title: "Grain", hue: 60, accent: "var(--accent-d)" },
  animation: { title: "Anim", hue: 145, accent: "var(--accent-c)" },
  blend: { title: "Blend", hue: 310, accent: "var(--accent-e)" },
  math: { title: "Mix", hue: 145, accent: "var(--accent-c)" },
  output: { title: "Output", hue: 0, accent: "oklch(0.35 0.03 270)" }
};

/* ========== helpers ========== */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 };
};

/* Approximate bezier path length for uniform dot speed */
function bezierLen(x1, y1, x2, y2) {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
  const pts = [[x1,y1],[x1+dx,y1],[x2-dx,y2],[x2,y2]];
  let len = 0, prev = pts[0];
  for (let i = 1; i <= 14; i++) {
    const t = i/14, u = 1-t;
    const x = u*u*u*pts[0][0]+3*u*u*t*pts[1][0]+3*u*t*t*pts[2][0]+t*t*t*pts[3][0];
    const y = u*u*u*pts[0][1]+3*u*u*t*pts[1][1]+3*u*t*t*pts[2][1]+t*t*t*pts[3][1];
    len += Math.hypot(x-prev[0], y-prev[1]); prev = [x, y];
  }
  return len;
}

/* Trace an edge back to the originating color-node hex, for connector coloring */
function traceColor(nodeId, allNodes, allEdges, depth = 0) {
  if (depth > 8) return null;
  const node = allNodes.find((n) => n.id === nodeId);
  if (!node) return null;
  if (node.type === "color") return node.data.color;
  // walk back through the first upstream blob/color edge
  const upEdge = allEdges.find((e) => e.to.n === nodeId && (e.to.p === "color" || e.to.p === "in" || e.to.p === "a"));
  if (upEdge) return traceColor(upEdge.from.n, allNodes, allEdges, depth + 1);
  return null;
}

/* ========== App ========== */
function App() {
  const [nodes, setNodes] = useState(INITIAL_NODES);
  const [edges, setEdges] = useState(INITIAL_EDGES);
  const [selected, setSelected] = useState(null); // node id
  const [zOrder, setZOrder] = useState(() => INITIAL_NODES.map((n) => n.id));
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragConn, setDragConn] = useState(null); // {fromNode, fromPort, kind, x, y}
  const [portPositions, setPortPositions] = useState({}); // id -> {x,y}

  const bringToFront = useCallback((id) => {
    setZOrder((prev) => [...prev.filter((i) => i !== id), id]);
  }, []);

  /* inject animation keyframes once */
  useEffect(() => {
    if (document.getElementById("aura-keyframes")) return;
    const s = document.createElement("style");
    s.id = "aura-keyframes";
    s.textContent = `
      @keyframes aura-blob-ripple  {0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
      @keyframes aura-blob-breathe {0%,100%{opacity:.65}50%{opacity:1}}
      @keyframes aura-blob-drift   {0%,100%{transform:translate(0,0)}33%{transform:translate(12px,-8px)}66%{transform:translate(-8px,10px)}}
      @keyframes aura-blob-float   {0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
      @keyframes aura-blob-shimmer {0%,100%{filter:hue-rotate(0deg)}50%{filter:hue-rotate(28deg)}}
      @keyframes aura-blob-wave    {0%,100%{transform:skewX(0deg) scaleX(1)}25%{transform:skewX(4deg) scaleX(1.04)}75%{transform:skewX(-4deg) scaleX(0.96)}}
      @keyframes port-pulse        {0%{opacity:.5;transform:scale(1)}100%{opacity:1;transform:scale(1.18)}}
    `;
    document.head.appendChild(s);
  }, []);

  /* ---------- node operations ---------- */
  const moveNode = (id, x, y) => setNodes((ns) => ns.map((n) => n.id === id ? { ...n, x, y } : n));
  const updateNodeData = (id, patch) => setNodes((ns) => ns.map((n) => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
  const deleteNode = (id) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.from.n !== id && e.to.n !== id));
    setZOrder((prev) => prev.filter((i) => i !== id));
    if (selected === id) setSelected(null);
  };
  const deleteEdge = (id) => setEdges((es) => es.filter((e) => e.id !== id));
  const addNode = (type, x, y) => {
    const id = "n" + uid();
    const defaults = {
      color: { color: "#c8b6ff", label: "new" },
      shape: { cx: 0.5, cy: 0.5, size: 0.6, softness: 0.85, shape: "blob" },
      noise: { amount: 0.1, scale: 1.2 },
      animation: { style: "ripple", speed: 1 },
      blend: { mode: "screen" },
      math: { op: "mix", amount: 0.5 }
    };
    setNodes((ns) => [...ns, { id, type, x, y, data: defaults[type] || {} }]);
    setZOrder((prev) => [...prev, id]);
  };

  /* ---------- GRAPH EVALUATION ----------
     Produce a list of blobs for Output + grain settings.
  */
  const evaluated = useMemo(() => {
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    // Map node -> inputs from edges
    const incoming = {};
    edges.forEach((e) => {
      (incoming[e.to.n] ||= []).push({ port: e.to.p, src: byId[e.from.n], srcPort: e.from.p });
    });
    const memo = {};
    function evalOut(nodeId, portId) {
      const key = nodeId + ":" + portId;
      if (memo[key] !== undefined) return memo[key];
      const n = byId[nodeId];if (!n) return null;
      let res = null;
      if (n.type === "color") {
        res = { kind: "color", color: n.data.color };
      } else if (n.type === "shape") {
        const inC = (incoming[nodeId] || []).find((i) => i.port === "color");
        const inG = (incoming[nodeId] || []).find((i) => i.port === "grain");
        let color = "#ffffff";
        if (inC) {
          const up = evalOut(inC.src.id, inC.srcPort);
          if (up && up.kind === "color") color = up.color;
        }
        let shapeGrain = null;
        if (inG) {
          const up = evalOut(inG.src.id, inG.srcPort);
          if (up && up.kind === "grain") shapeGrain = up;
        }
        res = { kind: "blob", layers: [{ cx: n.data.cx, cy: n.data.cy, size: n.data.size, softness: n.data.softness, color, blur: 0, op: "source-over", opacity: 1, shape: n.data.shape || "blob", sourceNodeId: nodeId, grain: shapeGrain }] };
      } else if (n.type === "blend") {
        const ia = (incoming[nodeId] || []).find((i) => i.port === "a");
        const ib = (incoming[nodeId] || []).find((i) => i.port === "b");
        const la = ia ? evalOut(ia.src.id, ia.srcPort) : null;
        const lb = ib ? evalOut(ib.src.id, ib.srcPort) : null;
        const layers = [
        ...(la && la.kind === "blob" ? la.layers : []),
        ...(lb && lb.kind === "blob" ? lb.layers.map((l) => ({ ...l, op: n.data.mode || "screen" })) : [])];

        res = { kind: "blob", layers };
      } else if (n.type === "math") {
        const ia = (incoming[nodeId] || []).find((i) => i.port === "a");
        const ib = (incoming[nodeId] || []).find((i) => i.port === "b");
        const la = ia ? evalOut(ia.src.id, ia.srcPort) : null;
        const lb = ib ? evalOut(ib.src.id, ib.srcPort) : null;
        const amount = n.data.amount ?? 0.5;
        const layers = [];
        if (la && la.kind === "blob") layers.push(...la.layers.map((l) => ({ ...l, opacity: (l.opacity ?? 1) * (1 - amount) })));
        if (lb && lb.kind === "blob") layers.push(...lb.layers.map((l) => ({ ...l, opacity: (l.opacity ?? 1) * amount })));
        res = { kind: "blob", layers };
      } else if (n.type === "noise") {
        res = { kind: "grain", amount: n.data.amount, scale: n.data.scale };
      } else if (n.type === "animation") {
        res = { kind: "anim", style: n.data.style || "breathe", speed: n.data.speed || 1 };
      }
      memo[key] = res;
      return res;
    }

    const outputNode = nodes.find((n) => n.type === "output");
    let blobLayers = [];
    let grain = null;
    let anim = null;
    if (outputNode) {
      (incoming[outputNode.id] || []).forEach((i) => {
        const up = evalOut(i.src.id, i.srcPort);
        if (!up) return;
        if (i.port === "in" && up.kind === "blob") blobLayers.push(...up.layers);
        if (i.port === "grain" && up.kind === "grain") grain = up;
        if (i.port === "anim" && up.kind === "anim") anim = up;
      });
    }
    // Layer order in output matches z-order in graph: lower zOrder index = drawn first (bottom)
    blobLayers.sort((a, b) => {
      const ai = zOrder.indexOf(a.sourceNodeId || "");
      const bi = zOrder.indexOf(b.sourceNodeId || "");
      return ai - bi;
    });
    return { layers: blobLayers, grain, anim, outputNode };
  }, [nodes, edges, zOrder]);

  /* ---------- port position registry ---------- */
  const registerPort = useCallback((key, x, y) => {
    setPortPositions((pp) => {
      const cur = pp[key];
      if (cur && Math.abs(cur.x - x) < 0.5 && Math.abs(cur.y - y) < 0.5) return pp;
      return { ...pp, [key]: { x, y } };
    });
  }, []);

  /* ---------- connection drag ---------- */
  const surfaceRef = useRef(null);
  const onPortDragStart = (nodeId, portId, kind, side, e) => {
    e.stopPropagation();
    if (side === "in") {
      // If clicking input, detach existing edge to it (re-drag from source)
      const existing = edges.find((ed) => ed.to.n === nodeId && ed.to.p === portId);
      if (existing) {
        setEdges((es) => es.filter((ed) => ed.id !== existing.id));
        const srcKey = existing.from.n + ":out:" + existing.from.p;
        const sp = portPositions[srcKey];
        if (sp) setDragConn({ fromNode: existing.from.n, fromPort: existing.from.p, kind, x: e.clientX, y: e.clientY, startX: sp.x, startY: sp.y });
        return;
      }
      return;
    }
    const key = nodeId + ":out:" + portId;
    const sp = portPositions[key];
    if (!sp) return;
    setDragConn({ fromNode: nodeId, fromPort: portId, kind, x: e.clientX, y: e.clientY, startX: sp.x, startY: sp.y });
  };

  useEffect(() => {
    if (!dragConn) return;
    const mm = (e) => setDragConn((d) => d ? { ...d, x: e.clientX, y: e.clientY } : d);
    const mu = (e) => {
      // find input port under cursor
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const portEl = el && el.closest("[data-port-in]");
      if (portEl) {
        const [nodeId, portId, kind] = portEl.getAttribute("data-port-in").split("|");
        // same kind check
        if (kind === dragConn.kind || dragConn.kind === "color" && kind === "color" || dragConn.kind === "blob" && kind === "blob" || dragConn.kind === "grain" && kind === "grain") {
          // Remove existing edge to this input unless multi
          const targetMeta = PORTS[nodes.find((n) => n.id === nodeId).type].in.find((p) => p.id === portId);
          setEdges((es) => {
            let next = es;
            if (!targetMeta?.multi) next = next.filter((ed) => !(ed.to.n === nodeId && ed.to.p === portId));
            // no self-loop
            if (dragConn.fromNode === nodeId) return next;
            return [...next, { id: "e" + uid(), from: { n: dragConn.fromNode, p: dragConn.fromPort }, to: { n: nodeId, p: portId } }];
          });
        }
      }
      setDragConn(null);
    };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
    return () => {window.removeEventListener("mousemove", mm);window.removeEventListener("mouseup", mu);};
  }, [dragConn, nodes]);

  /* ---------- generate gradient ---------- */
  const generateGradient = useCallback(() => {
    // Curated templates — each blob has {color, cx, cy, size, soft, shape}
    // Positions near edges/corners + high softness = airy mesh gradient look
    const TEMPLATES = [
      // Lavender + peach — soft 2-color diagonal
      { blobs: [
        { color: "#d2c4f8", cx: 0.05, cy: 0.12, size: 1.55, soft: 0.96 },
        { color: "#ffd0be", cx: 0.92, cy: 0.85, size: 1.45, soft: 0.94 },
        { color: "#ffe8d4", cx: 0.55, cy: 0.5,  size: 1.0,  soft: 0.97 },
      ], grain: 0.09 },
      // Sky + warm yellow corners
      { blobs: [
        { color: "#b0ccf4", cx: 0.1,  cy: 0.85, size: 1.6,  soft: 0.95 },
        { color: "#ffe8a8", cx: 0.88, cy: 0.1,  size: 1.5,  soft: 0.95 },
        { color: "#c8dcf8", cx: 0.5,  cy: 0.45, size: 1.1,  soft: 0.97 },
      ], grain: 0.08 },
      // Teal 3-blob mesh
      { blobs: [
        { color: "#9ed4cc", cx: 0.08, cy: 0.3,  size: 1.4,  soft: 0.95 },
        { color: "#a8dcd4", cx: 0.9,  cy: 0.72, size: 1.3,  soft: 0.94 },
        { color: "#fff4e8", cx: 0.5,  cy: 0.5,  size: 1.2,  soft: 0.97 },
      ], grain: 0.07 },
      // Warm peach dominant — peachy wash
      { blobs: [
        { color: "#f8c0a0", cx: 0.25, cy: 0.2,  size: 1.7,  soft: 0.96 },
        { color: "#fce8d4", cx: 0.75, cy: 0.65, size: 1.4,  soft: 0.95 },
        { color: "#f4b0a0", cx: 0.5,  cy: 0.88, size: 1.0,  soft: 0.95 },
      ], grain: 0.1 },
      // Rose + sky — pastel duo
      { blobs: [
        { color: "#f4c4d4", cx: 0.12, cy: 0.15, size: 1.5,  soft: 0.96 },
        { color: "#b8d4f8", cx: 0.85, cy: 0.82, size: 1.5,  soft: 0.95 },
        { color: "#f8dce8", cx: 0.45, cy: 0.5,  size: 0.9,  soft: 0.97 },
      ], grain: 0.08 },
      // Cool blue wash
      { blobs: [
        { color: "#a8c8f4", cx: 0.3,  cy: 0.15, size: 1.6,  soft: 0.96 },
        { color: "#c0d8f8", cx: 0.72, cy: 0.78, size: 1.4,  soft: 0.95 },
        { color: "#d8e8fc", cx: 0.1,  cy: 0.75, size: 1.1,  soft: 0.97 },
      ], grain: 0.07 },
      // Mint + blush 4-blob
      { blobs: [
        { color: "#b4e8d4", cx: 0.07, cy: 0.08, size: 1.3,  soft: 0.95 },
        { color: "#fcd4d4", cx: 0.93, cy: 0.1,  size: 1.3,  soft: 0.95 },
        { color: "#b8e4cc", cx: 0.07, cy: 0.92, size: 1.3,  soft: 0.95 },
        { color: "#fce0e0", cx: 0.92, cy: 0.88, size: 1.3,  soft: 0.95 },
      ], grain: 0.09 },
      // Warm orange + teal (more saturated, like reference)
      { blobs: [
        { color: "#f4a870", cx: 0.15, cy: 0.15, size: 1.3,  soft: 0.93 },
        { color: "#70c4b8", cx: 0.82, cy: 0.78, size: 1.4,  soft: 0.94 },
        { color: "#fcd8b8", cx: 0.6,  cy: 0.3,  size: 1.0,  soft: 0.96 },
      ], grain: 0.11 },
    ];

    const tmpl = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
    const outputNode = nodes.find((n) => n.type === "output") ||
      { id: "nout", type: "output", x: 820, y: 120, data: { w: 420, h: 640 } };

    const newNodes = [];
    const newEdges = [];

    tmpl.blobs.forEach((b, i) => {
      const cid = "ng" + uid();
      const sid = "ng" + uid();
      newNodes.push({ id: cid, type: "color", x: 60,  y: 80 + i * 210,
        data: { color: b.color, label: `c${i + 1}` } });
      newNodes.push({ id: sid, type: "shape", x: 310, y: 60 + i * 210,
        data: { cx: b.cx, cy: b.cy, size: b.size, softness: b.soft, shape: "blob" } });
      newEdges.push({ id: "eg" + uid(), from: { n: cid, p: "c" }, to: { n: sid, p: "color" } });
      newEdges.push({ id: "eg" + uid(), from: { n: sid, p: "blob" }, to: { n: outputNode.id, p: "in" } });
    });

    // grain node
    const gid = "ng" + uid();
    newNodes.push({ id: gid, type: "noise", x: 560, y: 60 + tmpl.blobs.length * 210,
      data: { amount: tmpl.grain, scale: 1.2 + Math.random() * 0.4 } });
    newEdges.push({ id: "eg" + uid(), from: { n: gid, p: "grain" }, to: { n: outputNode.id, p: "grain" } });

    const allNodes = [...newNodes, outputNode];
    setNodes(allNodes);
    setEdges(newEdges);
    setZOrder(allNodes.map((n) => n.id));
    setSelected(null);
  }, [nodes]);

  /* ---------- right-click context menu ---------- */
  const [contextMenu, setContextMenu] = useState(null); // {clientX, clientY, nodeX, nodeY}
  const onSurfaceContextMenu = (e) => {
    e.preventDefault();
    if (e.target.closest && e.target.closest("[data-node-card]")) return;
    const rect = surfaceRef.current.getBoundingClientRect();
    setContextMenu({
      clientX: e.clientX, clientY: e.clientY,
      nodeX: e.clientX - rect.left - pan.x,
      nodeY: e.clientY - rect.top - pan.y,
    });
  };
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  /* ---------- pan ---------- */
  const [panning, setPanning] = useState(null);
  const onSurfaceMouseDown = (e) => {
    closeContextMenu();
    if (e.target.closest && e.target.closest("[data-no-drag]")) return;
    setSelected(null);
    setPanning({ sx: e.clientX, sy: e.clientY, pX: pan.x, pY: pan.y });
  };
  useEffect(() => {
    if (!panning) return;
    const mm = (e) => setPan({ x: panning.pX + (e.clientX - panning.sx), y: panning.pY + (e.clientY - panning.sy) });
    const mu = () => setPanning(null);
    window.addEventListener("mousemove", mm);window.addEventListener("mouseup", mu);
    return () => {window.removeEventListener("mousemove", mm);window.removeEventListener("mouseup", mu);};
  }, [panning]);

  /* ---------- delete key ---------- */
  useEffect(() => {
    const kd = (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) {
        const n = nodes.find((n) => n.id === selected);
        if (n && n.type !== "output") deleteNode(selected);
      }
    };
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, [selected, nodes]);

  /* ---------- render ---------- */
  const bgStyle = useMemo(() => (
  { backgroundImage: `radial-gradient(oklch(0.92 0.006 270) 1px, transparent 1px)`, backgroundSize: "22px 22px", backgroundPosition: `${pan.x}px ${pan.y}px` }),
  [pan]);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <div
        ref={surfaceRef}
        className="surface-bg"
        onMouseDown={onSurfaceMouseDown}
        onContextMenu={onSurfaceContextMenu}
        style={{
          position: "absolute", inset: 0, overflow: "hidden",
          cursor: panning ? "grabbing" : "grab",
          background: "var(--bg)", ...bgStyle
        }}>

        {/* pan container */}
        <div style={{ position: "absolute", inset: 0, transform: `translate(${pan.x}px, ${pan.y}px)`, pointerEvents: "none" }}>
          <ConnectionLayer
            edges={edges} nodes={nodes} portPositions={portPositions}
            style="bezier" dragConn={dragConn} pan={pan}
            onDeleteEdge={deleteEdge} />

          <div style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}>
            {nodes.map((n) =>
            <NodeCard
              key={n.id}
              node={n}
              selected={selected === n.id}
              zIndex={zOrder.indexOf(n.id)}
              onSelect={() => { setSelected(n.id); bringToFront(n.id); }}
              onMove={moveNode}
              onChange={updateNodeData}
              onDelete={deleteNode}
              onPortDragStart={onPortDragStart}
              registerPort={registerPort}
              nodeShape="rounded"
              evaluated={evaluated}
              edges={edges}
              nodes={nodes}
              pan={pan}
              dragConn={dragConn} />

            )}
          </div>
        </div>

        {/* Generate button — fixed bottom-center, outside pan transform */}
        <div style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 10, pointerEvents: "auto" }}>
          <button
            data-no-drag
            onMouseDown={(e) => e.stopPropagation()}
            onClick={generateGradient}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 22px", borderRadius: 99,
              background: "oklch(0.995 0.003 85 / .88)",
              border: "1px solid var(--hair-strong)",
              backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
              boxShadow: "0 2px 12px oklch(0.2 0.02 270 / .10), 0 1px 3px oklch(0.2 0.02 270 / .06)",
              fontSize: 13, fontWeight: 500, cursor: "pointer", color: "var(--ink)",
              letterSpacing: "-0.01em", userSelect: "none"
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "oklch(0.995 0.003 85 / .98)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "oklch(0.995 0.003 85 / .88)"}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M8 2v4M8 10v4M2 8h4M10 8h4" opacity=".5" />
              <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
              <path d="M4.5 4.5l2.1 2.1M9.4 9.4l2.1 2.1M11.5 4.5l-2.1 2.1M6.6 9.4l-2.1 2.1" opacity=".4" />
            </svg>
            Generate
          </button>
        </div>
        {contextMenu &&
        <ContextMenu
          clientX={contextMenu.clientX} clientY={contextMenu.clientY}
          onAdd={(type) => { addNode(type, contextMenu.nodeX, contextMenu.nodeY); closeContextMenu(); }}
          onClose={closeContextMenu} />
        }
      </div>
    </div>);

}

/* ===============================================================
   CONTEXT MENU (right-click to add node)
   =============================================================== */
const NODE_TYPES = [
  ["color", "Color"],
  ["shape", "Shape"],
  ["noise", "Grain"],
  ["animation", "Anim"],
  ["blend", "Blend"],
  ["math", "Mix"],
];

function ContextMenu({ clientX, clientY, onAdd, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mousedown", down); window.removeEventListener("keydown", key); };
  }, [onClose]);

  // Clamp so menu doesn't go off screen
  const menuW = 170, menuH = NODE_TYPES.length * 34 + 8;
  const left = Math.min(clientX, window.innerWidth - menuW - 8);
  const top = Math.min(clientY, window.innerHeight - menuH - 8);

  return (
    <div ref={ref} data-no-drag onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed", left, top, zIndex: 200,
        background: "var(--node-bg-solid)", border: "1px solid var(--hair)",
        borderRadius: 10, padding: 4, minWidth: menuW,
        boxShadow: "var(--shadow-md)", backdropFilter: "blur(12px)"
      }}>
      {NODE_TYPES.map(([t, label]) =>
      <button key={t} onClick={() => onAdd(t)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          width: "100%", padding: "7px 10px", border: "none",
          background: "transparent", borderRadius: 6, cursor: "pointer", textAlign: "left"
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "oklch(0.96 0.008 270)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
        <NodeGlyph type={t} size={13} />
        <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
        <span className="mono" style={{ marginLeft: "auto", color: "var(--ink-faint)", fontSize: 10 }}>{t}</span>
      </button>
      )}
    </div>);
}

/* ===============================================================
   TOP BAR (unused — kept for reference)
   =============================================================== */
function TopBar({ nodeCount, edgeCount, onAdd }) {
  const [open, setOpen] = useState(false);
  const types = [
  ["color", "Color"],
  ["shape", "Shape"],
  ["noise", "Grain"],
  ["animation", "Anim"],
  ["blend", "Blend"],
  ["math", "Mix"]];

  return (
    <div style={{
      position: "relative", zIndex: 5, height: 56, display: "flex", alignItems: "center",
      padding: "0 20px", borderBottom: "1px solid var(--hair)", background: "oklch(0.995 0.003 85 / .7)",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)"
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ width: 20, height: 20, borderRadius: 6, background: "conic-gradient(from 0deg, #ffb199, #ffe7a8, #9dc6ff, #c8b6ff, #ffb199)", boxShadow: "inset 0 0 0 1px oklch(1 0 0 / .5)" }} />
        <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: 22, fontStyle: "italic", letterSpacing: "-0.01em" }}>Aura</div>
        <div className="mono" style={{ color: "var(--ink-faint)", marginLeft: 6 }}>gradient.graph</div>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="mono" style={{ color: "var(--ink-faint)" }}>{nodeCount} nodes · {edgeCount} edges</div>
        <div style={{ width: 1, height: 20, background: "var(--hair-strong)" }} />
        <div style={{ position: "relative" }}>
          <button onClick={() => setOpen((o) => !o)} style={{
            background: "var(--ink)", color: "var(--bg)", border: "none", padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6
          }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Add node
          </button>
          {open &&
          <div onMouseLeave={() => setOpen(false)} style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, background: "var(--node-bg-solid)",
            border: "1px solid var(--hair)", borderRadius: 10, padding: 4, minWidth: 160, boxShadow: "var(--shadow-md)"
          }}>
              {types.map(([t, label]) =>
            <button key={t} onClick={() => {onAdd(t, 200 - (typeof window !== "undefined" ? 0 : 0) + Math.random() * 40, 200 + Math.random() * 40);setOpen(false);}} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px", border: "none",
              background: "transparent", borderRadius: 6, cursor: "pointer", textAlign: "left"
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "oklch(0.96 0.008 270)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              
                  <NodeGlyph type={t} size={14} />
                  <span>{label}</span>
                  <span className="mono" style={{ marginLeft: "auto", color: "var(--ink-faint)" }}>{t}</span>
                </button>
            )}
            </div>
          }
        </div>
      </div>
    </div>);

}

/* ===============================================================
   LEGEND
   =============================================================== */
function Legend() {
  return (
    <div style={{
      position: "absolute", left: 20, bottom: 20, display: "flex", gap: 14, alignItems: "center",
      background: "oklch(0.995 0.003 85 / .72)", border: "1px solid var(--hair)", borderRadius: 10, padding: "8px 12px",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", zIndex: 3
    }}>
      <span className="mono" style={{ color: "var(--ink-faint)" }}>drag · to connect · ⌫ delete</span>
    </div>);

}
function LegendDot({ c, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: c }} />
      <span className="mono" style={{ color: "var(--ink-soft)" }}>{label}</span>
    </div>);

}

/* ===============================================================
   NODE GLYPH (icon per type)
   =============================================================== */
function NodeGlyph({ type, size = 16, color }) {
  const s = size;
  if (type === "color") return <div style={{ width: s, height: s, borderRadius: 4, background: color || "conic-gradient(from 0deg, #ffb199, #ffe7a8, #9dc6ff, #c8b6ff, #ffb199)", boxShadow: "inset 0 0 0 1px oklch(0 0 0 / .06)" }} />;
  if (type === "shape") return (
    <svg width={s} height={s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="8" cy="8" r="2" fill="currentColor" /></svg>);

  if (type === "noise") return (
    <svg width={s} height={s} viewBox="0 0 16 16"><g fill="currentColor">{Array.from({ length: 14 }).map((_, i) => <circle key={i} cx={i * 3.1 % 15 + 0.5} cy={i * 5.7 % 15 + 0.5} r="0.7" />)}</g></svg>);

  if (type === "blend") return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="6" cy="8" r="4" /><circle cx="10" cy="8" r="4" /></svg>);

  if (type === "math") return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 8h10M8 3v10" /></svg>);

  if (type === "animation") return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <path d="M8 3 C5 3 3 5.5 3 8 C3 10.5 5 13 8 13 C11 13 13 10.5 13 8" />
      <path d="M11 5.5 L13 8 L15 5.5" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </svg>);
  if (type === "output") return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" /><path d="M5 7l3 3 3-3" /></svg>);

  return null;
}

/* ===============================================================
   NODE CARD
   =============================================================== */
function NodeCard({ node, selected, zIndex, onSelect, onMove, onChange, onDelete, onPortDragStart, registerPort, nodeShape, evaluated, edges, nodes, pan, dragConn }) {
  const meta = NODE_META[node.type];
  const ports = PORTS[node.type];
  const [drag, setDrag] = useState(null);

  const onMouseDown = (e) => {
    e.stopPropagation(); // always stop — prevents surface pan from starting on node click
    if (e.target.closest("[data-no-drag]")) return;
    if (e.target.closest("[data-port]")) return;
    onSelect();
    setDrag({ sx: e.clientX, sy: e.clientY, nx: node.x, ny: node.y });
  };
  useEffect(() => {
    if (!drag) return;
    const mm = (e) => onMove(node.id, drag.nx + (e.clientX - drag.sx), drag.ny + (e.clientY - drag.sy));
    const mu = () => setDrag(null);
    window.addEventListener("mousemove", mm);window.addEventListener("mouseup", mu);
    return () => {window.removeEventListener("mousemove", mm);window.removeEventListener("mouseup", mu);};
  }, [drag, node.id]);

  const radius = nodeShape === "sharp" ? 3 : 12;
  const isOutput = node.type === "output";
  const width = isOutput ? node.data.w + 40 : 196;

  return (
    <div
      style={{
        position: "absolute",
        left: node.x, top: node.y, width,
        zIndex: selected ? 9999 : zIndex,
        background: "var(--node-bg)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        border: `1px solid ${selected ? "oklch(0.7 0.03 270)" : "var(--hair)"}`,
        borderRadius: radius,
        boxShadow: selected ?
        "0 0 0 3px oklch(0.85 0.02 270 / .45), var(--shadow-md)" :
        "var(--shadow-sm)",
        userSelect: "none", cursor: drag ? "grabbing" : "grab",
        transition: "border-color .12s ease, box-shadow .12s ease, z-index 0s"
      }}
      onMouseDown={onMouseDown}>
      
      {/* HEADER */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
        borderBottom: `1px solid var(--hair)`, color: meta.accent
      }}>
        <NodeGlyph type={node.type} size={13} />
        <span style={{ color: "var(--ink)", fontWeight: 500, fontSize: 12 }}>{meta.title}</span>
        <span style={{ marginLeft: "auto" }} />
        {isOutput &&
        <div data-no-drag style={{ display: "flex", gap: 4 }}>
            <button style={tinyBtnStyle}>PNG</button>
            <button style={tinyBtnStyle}>SVG</button>
            <button style={{ ...tinyBtnStyle, background: "oklch(0.22 0.02 270)", color: "oklch(0.985 0.005 85)", borderColor: "oklch(0.22 0.02 270)" }}>Export</button>
          </div>
        }
        {!isOutput &&
        <button data-no-drag onClick={(e) => {e.stopPropagation();onDelete(node.id);}} style={{
          background: "transparent", border: "none", color: "var(--ink-faint)", cursor: "pointer", padding: 0, marginLeft: 4, lineHeight: 1, fontSize: 14
        }}>×</button>
        }
      </div>

      {/* BODY */}
      <div style={{ position: "relative", padding: isOutput ? 10 : "10px 12px" }}>
        <NodeBody node={node} onChange={onChange} evaluated={evaluated} nodes={nodes} edges={edges} />
        {/* PORTS */}
        <PortRail side="in" ports={ports.in.filter(p => !(p.kind === "anim" && !(nodes||[]).some(n => n.type === "animation")))} nodeId={node.id} nodeType={node.type} registerPort={registerPort} onPortDragStart={onPortDragStart} edges={edges} nodes={nodes} hideLabel={isOutput} dragConn={dragConn} />
        <PortRail side="out" ports={ports.out} nodeId={node.id} nodeType={node.type} registerPort={registerPort} onPortDragStart={onPortDragStart} edges={edges} nodes={nodes} hideLabel={isOutput} dragConn={dragConn} />
      </div>
    </div>);

}

/* Port markers on left (in) and right (out) edges */
function PortRail({ side, ports, nodeId, nodeType, registerPort, onPortDragStart, edges, nodes, hideLabel, dragConn }) {
  return (
    <>
      {ports.map((p, i) =>
      <Port key={p.id} side={side} port={p} idx={i} total={ports.length} nodeType={nodeType}
      nodeId={nodeId} registerPort={registerPort} onPortDragStart={onPortDragStart} edges={edges} nodes={nodes} hideLabel={hideLabel} dragConn={dragConn} />
      )}
    </>);

}

/* Cohesive per-type port/connector colors — muted to match the airy palette */
const NODE_PORT_COLOR = {
  color:     "oklch(0.68 0.10 25)",   // muted coral
  shape:     "oklch(0.68 0.09 220)",  // muted sky
  noise:     "oklch(0.72 0.09 80)",   // warm gold
  animation: "oklch(0.68 0.08 145)",  // sage green
  blend:     "oklch(0.68 0.09 310)",  // soft lilac
  math:      "oklch(0.68 0.08 145)",  // sage
  output:    "oklch(0.60 0.03 270)",  // neutral slate
};

function Port({ side, port, idx, total, nodeId, nodeType, registerPort, onPortDragStart, edges, nodes, hideLabel, dragConn }) {
  const ref = useRef(null);
  const [hovered, setHovered] = useState(false);
  // Use the traced upstream color-node hex so port dot matches its connector
  const connectedEdge = edges.find((e) => side === "in"
    ? e.to.n === nodeId && e.to.p === port.id
    : e.from.n === nodeId && e.from.p === port.id);
  const tracedHex = connectedEdge
    ? traceColor(side === "in" ? connectedEdge.from.n : nodeId, nodes || [], edges)
    : null;
  const kindColor = tracedHex || NODE_PORT_COLOR[nodeType] || "oklch(0.65 0.04 270)";
  const hasEdge = !!connectedEdge;
  // During drag: highlight compatible destination ports
  const isDragTarget = dragConn && side === "in" && dragConn.kind === port.kind && dragConn.fromNode !== nodeId;
  const showRing = hovered || isDragTarget;

  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const parent = ref.current.closest("[style*='position: absolute']")?.parentElement?.parentElement;
    // Use document-space - pan. We'll compute center of port relative to the pan container.
    // Actually: we compute relative to the inner pan container by using offsetLeft/Top chain. Simpler: compute from surface.
    const surface = document.querySelector(".surface-bg");
    const sRect = surface.getBoundingClientRect();
    // Pan-relative coords (we subtract pan transform via data-pan)
    const panX = parseFloat(surface.getAttribute("data-panx") || "0");
    const panY = parseFloat(surface.getAttribute("data-pany") || "0");
    const x = r.left + r.width / 2 - sRect.left - panX;
    const y = r.top + r.height / 2 - sRect.top - panY;
    registerPort(nodeId + ":" + (side === "in" ? "in" : "out") + ":" + port.id, x, y);
  });

  const attrs = side === "in" ?
  { "data-port-in": `${nodeId}|${port.id}|${port.kind}` } :
  { "data-port-out": `${nodeId}|${port.id}|${port.kind}` };

  // positioning: stack vertically within node body; shape/output body starts with extras so push ports below
  const baseY = nodeType === "shape" ? 36 : nodeType === "output" ? 30 : 6;
  const yOffset = baseY + idx * 22;

  return (
    <div
      data-port
      {...attrs}
      onMouseDown={(e) => onPortDragStart(nodeId, port.id, port.kind, side, e)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        [side === "in" ? "left" : "right"]: -14,
        top: yOffset - 7,
        padding: "7px 8px",
        display: "flex", alignItems: "center", gap: 6,
        flexDirection: side === "in" ? "row" : "row-reverse",
        cursor: "crosshair"
      }}>

      <div style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
        <div ref={ref} style={{
          borderRadius: 99,
          background: hasEdge ? kindColor : `${kindColor}55`,
          transition: "background .15s ease",
          width: "8px", height: "8px"
        }} />
        {showRing && <div style={{
          position: "absolute",
          inset: -5,
          borderRadius: 99,
          border: `1.5px solid ${kindColor}`,
          opacity: isDragTarget ? 0.9 : 0.6,
          animation: isDragTarget ? "port-pulse .7s ease-in-out infinite alternate" : "none",
          pointerEvents: "none"
        }} />}
      </div>
      <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)", marginLeft: side == "in" ? 2 : 0, marginRight: side == "out" ? 2 : 0, transform: side == "in" ? "translateX(4px)" : "translateX(-4px)", display: "none" }}>{port.label}</span>
    </div>);

}

/* ===============================================================
   NODE BODY — custom UI per node type
   =============================================================== */
function NodeBody({ node, onChange, evaluated, nodes, edges }) {
  if (node.type === "color") return <ColorBody node={node} onChange={onChange} />;
  if (node.type === "shape") return <ShapeBody node={node} onChange={onChange} nodes={nodes} edges={edges} />;
  if (node.type === "noise") return <NoiseBody node={node} onChange={onChange} />;
  if (node.type === "animation") return <AnimationBody node={node} onChange={onChange} />;
  if (node.type === "blend") return <BlendBody node={node} onChange={onChange} />;
  if (node.type === "math") return <MathBody node={node} onChange={onChange} />;
  if (node.type === "output") return <OutputBody node={node} evaluated={evaluated} />;
  return null;
}

/* ---------- Color ---------- */
function ColorBody({ node, onChange }) {
  const [showPicker, setShowPicker] = useState(false);
  return (
    <div style={{ paddingLeft: 16, paddingRight: 10 }}>
      <div data-no-drag style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div onClick={() => setShowPicker((p) => !p)} style={{
          width: 40, height: 40, borderRadius: 8, background: node.data.color,
          boxShadow: "inset 0 0 0 1px oklch(0 0 0 / .08), 0 2px 6px oklch(0 0 0 / .08)",
          cursor: "pointer"
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <input data-no-drag value={node.data.label} onChange={(e) => onChange(node.id, { label: e.target.value })} style={{
            width: "100%", border: "none", background: "transparent", outline: "none", fontSize: 12, color: "var(--ink)", padding: 0
          }} />
          <input data-no-drag value={node.data.color} onChange={(e) => onChange(node.id, { color: e.target.value })} className="mono" style={{
            width: "100%", border: "none", background: "transparent", outline: "none", color: "var(--ink-soft)", padding: 0
          }} />
        </div>
      </div>
      {showPicker &&
      <div data-no-drag style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 4 }}>
          {["#ffb199", "#ffcda8", "#ffe7a8", "#d8f0b4", "#a8e5c6", "#9dc6ff", "#c8b6ff", "#f9c4d2",
        "#ff8f6b", "#f59f6b", "#f5d06b", "#a6d86b", "#6bd4a8", "#6ba4d8", "#a686f5", "#f58fb2",
        "#ffffff", "#f2efe9", "#d9d5cd", "#1f1b18"].map((c) =>
        <button key={c} onClick={() => onChange(node.id, { color: c })} style={{
          width: "100%", aspectRatio: "1", borderRadius: 4, background: c, border: `1px solid ${c === node.data.color ? "var(--ink)" : "transparent"}`, cursor: "pointer", padding: 0
        }} />
        )}
        </div>
      }
    </div>);

}

/* ---------- Shape (blob with draggable center + shape picker) ---------- */
function ShapeBody({ node, onChange, nodes, edges }) {
  const ref = useRef(null);
  const [draggingPt, setDraggingPt] = useState(false);
  // Trace incoming color through edges (color input)
  let incomingColor = null;
  if (nodes && edges) {
    const colorEdge = edges.find((e) => e.to.n === node.id && e.to.p === "color");
    if (colorEdge) {
      const src = nodes.find((n) => n.id === colorEdge.from.n);
      if (src && src.type === "color") incomingColor = src.data.color;
    }
  }
  const previewColor = incomingColor || "#c1b4da";
  const onDragPt = (e) => {
    e.stopPropagation();
    const rect = ref.current.getBoundingClientRect();
    setDraggingPt(true);
    const mm = (ev) => {
      const x = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((ev.clientY - rect.top) / rect.height, 0, 1);
      onChange(node.id, { cx: x, cy: y });
    };
    const mu = () => {setDraggingPt(false);window.removeEventListener("mousemove", mm);window.removeEventListener("mouseup", mu);};
    window.addEventListener("mousemove", mm);window.addEventListener("mouseup", mu);
  };
  const shape = SHAPE_BY_ID[node.data.shape || "blob"] || SHAPE_BY_ID.blob;
  const cycleShape = (e) => {
    e.stopPropagation();
    const idx = SHAPES.findIndex((s) => s.id === (node.data.shape || "blob"));
    const next = SHAPES[(idx + 1) % SHAPES.length];
    onChange(node.id, { shape: next.id });
  };
  const blurId = "blur_" + node.id;
  return (
    <div data-no-drag style={{ paddingLeft: 16, paddingRight: 10 }}>
      {/* preview with draggable position — shape softened by its own silhouette */}
      <div ref={ref} onMouseDown={onDragPt} style={{
        position: "relative", height: 80, width: "100%", borderRadius: 8, overflow: "hidden", cursor: draggingPt ? "grabbing" : "grab",
        background: "oklch(0.975 0.004 85)", border: "1px solid var(--hair)"
      }}>
        {/* cycle-shape refresh icon */}
        <button data-no-drag onMouseDown={(e) => e.stopPropagation()} onClick={cycleShape} title={`shape: ${shape.id} (click to cycle)`} style={{
          position: "absolute", top: 6, right: 6, zIndex: 2,
          width: 22, height: 22, borderRadius: 6, border: "1px solid var(--hair)",
          background: "oklch(0.995 0.003 85 / .9)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          color: "var(--ink-soft)", padding: 0
        }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9" />
            <path d="M12 2v3h-3" />
            <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9" />
            <path d="M4 14v-3h3" />
          </svg>
        </button>
        <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <defs>
            <filter id={blurId} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation={2 + node.data.softness * 6} />
            </filter>
          </defs>
          <g transform={`translate(${node.data.cx * 100} ${node.data.cy * 100}) scale(${node.data.size * 0.6}) translate(-50 -50)`}>
            <path d={shape.d} fill={previewColor} opacity={0.9} filter={`url(#${blurId})`} />
          </g>
        </svg>
        <div style={{
          position: "absolute", left: `${node.data.cx * 100}%`, top: `${node.data.cy * 100}%`,
          width: 9, height: 9, borderRadius: 99, background: "white",
          border: "1.5px solid oklch(0.72 0.01 270)",
          transform: "translate(-50%, -50%)", pointerEvents: "none",
          boxSizing: "border-box"
        }} />
      </div>
      <Slider node={node} field="size" min={0.1} max={1.6} step={0.01} onChange={onChange} label="size" />
      <Slider node={node} field="softness" min={0} max={1} step={0.01} onChange={onChange} label="blur" />
    </div>);

}

/* ---------- Blur ---------- */
/* ---------- Noise ---------- */
function NoiseBody({ node, onChange }) {
  return (
    <div data-no-drag style={{ paddingLeft: 16, paddingRight: 10 }}>
      <div style={{
        height: 64, borderRadius: 8, marginBottom: 8, overflow: "hidden",
        background: "oklch(0.97 0.005 85)", position: "relative"
      }}>
        <div style={{
          position: "absolute", inset: 0, opacity: node.data.amount * 4,
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${0.9 / Math.max(0.3, node.data.scale)}' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`
        }} />
      </div>
      <Slider node={node} field="amount" min={0} max={0.35} step={0.01} onChange={onChange} label="amount" />
      <Slider node={node} field="scale" min={0.3} max={3} step={0.05} onChange={onChange} label="scale" />
    </div>);

}

/* ---------- Blend ---------- */
function BlendBody({ node, onChange }) {
  const modes = ["screen", "multiply", "overlay", "soft-light", "lighten"];
  return (
    <div data-no-drag style={{ paddingLeft: 16, paddingRight: 10 }}>
      <div className="mono" style={{ color: "var(--ink-faint)", marginBottom: 6 }}>mode</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {modes.map((m) =>
        <button key={m} onClick={() => onChange(node.id, { mode: m })} style={{
          padding: "3px 7px", border: `1px solid ${node.data.mode === m ? "var(--ink)" : "var(--hair-strong)"}`,
          background: node.data.mode === m ? "var(--ink)" : "transparent", color: node.data.mode === m ? "var(--bg)" : "var(--ink)",
          borderRadius: 5, fontSize: 10, fontFamily: "'JetBrains Mono',monospace", cursor: "pointer"
        }}>{m}</button>
        )}
      </div>
    </div>);

}

/* ---------- Math / Mix ---------- */
function MathBody({ node, onChange }) {
  return (
    <div data-no-drag style={{ paddingLeft: 16, paddingRight: 10 }}>
      <div className="mono" style={{ color: "var(--ink-faint)", marginBottom: 4 }}>op</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        {["mix", "add", "mult"].map((op) =>
        <button key={op} onClick={() => onChange(node.id, { op })} style={{
          padding: "3px 8px", border: `1px solid ${node.data.op === op ? "var(--ink)" : "var(--hair-strong)"}`,
          background: node.data.op === op ? "var(--ink)" : "transparent", color: node.data.op === op ? "var(--bg)" : "var(--ink)",
          borderRadius: 5, fontSize: 10, fontFamily: "'JetBrains Mono',monospace", cursor: "pointer"
        }}>{op}</button>
        )}
      </div>
      <Slider node={node} field="amount" min={0} max={1} step={0.01} onChange={onChange} label="t" />
    </div>);

}

/* ---------- Animation ---------- */
function AnimationBody({ node, onChange }) {
  const style = node.data.style || "ripple";
  const speed = node.data.speed || 1;
  const dur = (4 / speed).toFixed(1) + "s";
  const durHalf = (4 / speed / 2).toFixed(1) + "s";

  const cycleStyle = (e) => {
    e.stopPropagation();
    const idx = ANIM_STYLES.indexOf(style);
    onChange(node.id, { style: ANIM_STYLES[(idx + 1) % ANIM_STYLES.length] });
  };

  // Two mini blobs in the preview, each with their phase-offset animation
  const blobAnim = (delay) => `aura-blob-${style} ${dur} ease-in-out -${delay}s infinite`;

  return (
    <div data-no-drag style={{ paddingLeft: 16, paddingRight: 10 }}>
      {/* animated preview — two blobs animate at phase offset */}
      <div style={{ position: "relative", height: 72, borderRadius: 8, overflow: "hidden",
        background: "oklch(0.975 0.004 85)", border: "1px solid var(--hair)", marginBottom: 2 }}>
        <div style={{
          position: "absolute", top: "10%", left: "10%", width: "55%", height: "80%", borderRadius: "50%",
          background: "#d4c8f8cc", filter: "blur(10px)",
          transformBox: "fill-box", transformOrigin: "50% 50%",
          animation: blobAnim(0)
        }} />
        <div style={{
          position: "absolute", top: "15%", left: "38%", width: "50%", height: "75%", borderRadius: "50%",
          background: "#ffd4c0cc", filter: "blur(10px)",
          transformBox: "fill-box", transformOrigin: "50% 50%",
          animation: blobAnim(durHalf)
        }} />
        {/* cycle button */}
        <button data-no-drag onMouseDown={(e) => e.stopPropagation()} onClick={cycleStyle}
          title={`style: ${style} (click to cycle)`}
          style={{ position: "absolute", top: 5, right: 5, zIndex: 2,
            width: 22, height: 22, borderRadius: 6, border: "1px solid var(--hair)",
            background: "oklch(0.995 0.003 85 / .9)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "var(--ink-soft)", padding: 0 }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9" /><path d="M12 2v3h-3" />
            <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9" /><path d="M4 14v-3h3" />
          </svg>
        </button>
        {/* style name */}
        <div className="mono" style={{ position: "absolute", bottom: 5, left: 8,
          fontSize: 10, color: "var(--ink-soft)", pointerEvents: "none" }}>{style}</div>
      </div>
      <Slider node={node} field="speed" min={0.2} max={3} step={0.1} onChange={onChange} label="speed" />
    </div>);
}

/* ---------- Slider primitive ---------- */
function Slider({ node, field, min, max, step, onChange, label, unit = "" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "5px 0 0", minWidth: 0 }}>
      <span className="mono" style={{ width: 30, color: "var(--ink-faint)", flexShrink: 0, fontSize: 10 }}>{label}</span>
      <input data-no-drag type="range" min={min} max={max} step={step} value={node.data[field]}
      onChange={(e) => onChange(node.id, { [field]: parseFloat(e.target.value) })}
      style={{ flex: 1, minWidth: 0, height: 14 }} />
      
    </div>);

}

/* ===============================================================
   OUTPUT — renders the actual gradient (shape-clipped)
   =============================================================== */
function OutputBody({ node, evaluated }) {
  const { layers = [], grain, anim } = evaluated || {};
  // Duration per blob (speed slider scales it)
  const animDurNum = anim ? 4 / (anim.speed || 1) : 4;
  const w = node.data.w,h = node.data.h;
  return (
    <div data-no-drag style={{ paddingLeft: 0 }}>
      <div style={{
        width: w, height: h, borderRadius: 8, overflow: "hidden", position: "relative",
        background: "oklch(0.985 0.003 85)",
        boxShadow: "inset 0 0 0 1px oklch(0 0 0 / .06)"
      }}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width={w} height={h}
        style={{ position: "absolute", inset: 0, display: "block" }}>
          <defs>
            {layers.map((l, i) => {
              const blurSd = (l.blur || 0) * 0.6 + (l.softness ?? 0.8) * 55;
              const sh = SHAPE_BY_ID[l.shape || "blob"] || SHAPE_BY_ID.blob;
              const size = l.size * Math.max(w, h);
              const cx = l.cx * w, cy = l.cy * h;
              return (
                <Fragment key={i}>
                  <filter id={`fblur-${node.id}-${i}`} x="-200%" y="-200%" width="500%" height="500%">
                    <feGaussianBlur stdDeviation={blurSd} />
                  </filter>
                  {l.grain && <>
                    <filter id={`fgrain-${node.id}-${i}`} x="0%" y="0%" width="100%" height="100%">
                      <feTurbulence type="fractalNoise" baseFrequency={0.9 / Math.max(0.3, l.grain.scale)} numOctaves="2" stitchTiles="stitch" result="noise" />
                      <feColorMatrix type="saturate" values="0" in="noise" result="gray" />
                      <feBlend in="SourceGraphic" in2="gray" mode="overlay" />
                    </filter>
                    <clipPath id={`clip-${node.id}-${i}`}>
                      <path d={sh.d} transform={`translate(${cx} ${cy}) scale(${size / 100}) translate(-50 -50)`} />
                    </clipPath>
                  </>}
                </Fragment>);
            })}
          </defs>
          {layers.map((l, i) => {
            const sh = SHAPE_BY_ID[l.shape || "blob"] || SHAPE_BY_ID.blob;
            const size = l.size * Math.max(w, h);
            const cx = l.cx * w, cy = l.cy * h;
            const phaseDelay = anim
              ? -((i * animDurNum) / Math.max(layers.length, 1)).toFixed(2)
              : 0;
            const blobAnim = anim
              ? `aura-blob-${anim.style} ${animDurNum.toFixed(1)}s ease-in-out ${phaseDelay}s infinite`
              : "none";
            return (
              <Fragment key={i}>
                <g transform={`translate(${cx} ${cy}) scale(${size / 100}) translate(-50 -50)`}
                filter={`url(#fblur-${node.id}-${i})`}
                style={{ mixBlendMode: l.op && l.op !== "source-over" ? l.op : "normal" }}>
                  <path d={sh.d} fill={l.color} opacity={l.opacity ?? 1}
                    style={{ transformBox: "fill-box", transformOrigin: "50% 50%", animation: blobAnim }} />
                </g>
                {l.grain && <rect x="0" y="0" width={w} height={h}
                  clipPath={`url(#clip-${node.id}-${i})`}
                  filter={`url(#fgrain-${node.id}-${i})`}
                  opacity={l.grain.amount * 5}
                  style={{ mixBlendMode: "overlay", pointerEvents: "none" }} />}
              </Fragment>);
          })}
        </svg>
        {grain &&
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          opacity: grain.amount * 4,
          mixBlendMode: "overlay",
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${0.9 / Math.max(0.3, grain.scale)}' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`
        }} />
        }
      </div>
    </div>);

}
// (tinyBtnStyle hoisted to top)

/* ===============================================================
   CONNECTION LAYER
   =============================================================== */
function ConnectionLayer({ edges, nodes, portPositions, style, dragConn, pan, onDeleteEdge }) {
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);

  const pathFor = (x1, y1, x2, y2) => {
    if (style === "straight") return `M ${x1} ${y1} L ${x2} ${y2}`;
    if (style === "step") {
      const mx = (x1 + x2) / 2;
      return `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
    }
    // bezier
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  // Try to use the actual upstream color-node hex; fall back to type-color
  const edgeColor = (e) => {
    const hex = traceColor(e.from.n, nodes, edges);
    if (hex) {
      // Use the hex but muted (blend toward white a bit for a soft look)
      return hex;
    }
    const srcNode = nodes.find((n) => n.id === e.from.n);
    return NODE_PORT_COLOR[srcNode?.type] || "oklch(0.65 0.04 270)";
  };

  return (
    <svg ref={svgRef} style={{ position: "absolute", left: 0, top: 0, width: "200vw", height: "200vh", overflow: "visible", pointerEvents: "none" }}>
      {edges.map((e) => {
        const src = portPositions[e.from.n + ":out:" + e.from.p];
        const dst = portPositions[e.to.n + ":in:" + e.to.p];
        if (!src || !dst) return null;
        const c = edgeColor(e);
        const d = pathFor(src.x, src.y, dst.x, dst.y);
        const isHover = hover === e.id;
        const dur = (bezierLen(src.x, src.y, dst.x, dst.y) / 150).toFixed(2) + "s";
        return (
          <g key={e.id} style={{ pointerEvents: "auto" }} onMouseEnter={() => setHover(e.id)} onMouseLeave={() => setHover(null)} onDoubleClick={() => onDeleteEdge(e.id)}>
            <path d={d} fill="none" stroke="transparent" strokeWidth="14" />
            <path d={d} fill="none" stroke={c} strokeOpacity={isHover ? 0.9 : 0.5} strokeWidth={isHover ? 2 : 1.4} />
            {/* static endpoint dots */}
            <circle cx={src.x} cy={src.y} r="2" fill={c} opacity="0.7" />
            <circle cx={dst.x} cy={dst.y} r="2" fill={c} opacity="0.7" />
            {/* flow dot — uniform speed */}
            <circle r="3" fill={c} opacity="0.75">
              <animateMotion dur={dur} repeatCount="indefinite" path={d} />
            </circle>
          </g>);

      })}
      {dragConn && (() => {
        const surface = document.querySelector(".surface-bg");
        const sRect = surface.getBoundingClientRect();
        const x2 = dragConn.x - sRect.left - pan.x;
        const y2 = dragConn.y - sRect.top - pan.y;
        const d = pathFor(dragConn.startX, dragConn.startY, x2, y2);
        const dragSrcNode = nodes.find((n) => n.id === dragConn.fromNode);
        const dragC = NODE_PORT_COLOR[dragSrcNode?.type] || "oklch(0.65 0.04 270)";
        return <path d={d} fill="none" stroke={dragC} strokeDasharray="4 4" strokeWidth="1.5" opacity="0.8" />;
      })()}
    </svg>);

}

/* ===============================================================
   MOUNT
   =============================================================== */
// Expose pan to DOM for port coord computation
const origRender = ReactDOM.createRoot;
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);

// Observe pan CSS to stash panX/panY for port coord math
const panWatcher = new MutationObserver(() => {
  document.querySelectorAll(".surface-bg").forEach((el) => {
    const inner = el.firstElementChild;
    if (!inner) return;
    const t = inner.style.transform || "";
    const m = t.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    if (m) {
      el.setAttribute("data-panx", m[1]);
      el.setAttribute("data-pany", m[2]);
    }
  });
});
// Attach after render tick
setTimeout(() => {
  const s = document.querySelector(".surface-bg");
  if (s) panWatcher.observe(s, { subtree: true, attributes: true, attributeFilter: ["style"] });
}, 100);