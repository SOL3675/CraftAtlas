export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;
const PADDING = 20;

// Coordinates are CSS pixels, so 100% keeps labels readable regardless of node count.
export class GraphCamera {
  constructor(contentWidth, contentHeight) {
    this.contentWidth = contentWidth;
    this.contentHeight = contentHeight;
    this.width = 0; this.height = 0;
    this.scale = 1; this.x = 0; this.y = 0;
    this.mode = 'reset';
  }
  resize(width, height) {
    if (width <= 0 || height <= 0) return;
    this.x += (width - this.width) / 2;
    this.y += (height - this.height) / 2;
    this.width = width; this.height = height;
    if (this.mode === 'fit') this.fit();
    else if (this.mode === 'reset') this.reset();
  }
  reset() {
    this.mode = 'reset'; this.scale = 1;
    this.x = Math.max(PADDING, (this.width - this.contentWidth) / 2); this.y = PADDING;
  }
  fit() {
    this.mode = 'fit';
    this.scale = Math.max(MIN_ZOOM, Math.min(1, (this.width - PADDING * 2) / this.contentWidth, (this.height - PADDING * 2) / this.contentHeight));
    this.x = (this.width - this.contentWidth * this.scale) / 2;
    this.y = (this.height - this.contentHeight * this.scale) / 2;
  }
  zoom(factor, anchorX = this.width / 2, anchorY = this.height / 2) {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.scale * factor));
    this.x = anchorX - (anchorX - this.x) * next / this.scale;
    this.y = anchorY - (anchorY - this.y) * next / this.scale;
    this.scale = next; this.mode = 'manual';
  }
  pan(dx, dy) { this.x += dx; this.y += dy; this.mode = 'manual'; }
}

export function graphViewport(svg, content, toolbar, contentWidth, contentHeight) {
  const camera = new GraphCamera(contentWidth, contentHeight);
  const output = document.createElement('output');
  output.setAttribute('aria-label', 'グラフの表示倍率'); output.setAttribute('aria-live', 'polite');
  const button = (label, action) => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
    node.onclick = () => { action(); render(); }; return node;
  };
  const out = button('− 縮小', () => camera.zoom(1 / 1.25));
  const into = button('＋ 拡大', () => camera.zoom(1.25));
  toolbar.append(out, output, into, button('リセット (100%)', () => camera.reset()), button('全体表示', () => camera.fit()));
  function render() {
    svg.setAttribute('viewBox', `0 0 ${camera.width} ${camera.height}`);
    content.setAttribute('transform', `translate(${camera.x},${camera.y}) scale(${camera.scale})`);
    output.value = `${Math.round(camera.scale * 100)}%`;
    out.disabled = camera.scale <= MIN_ZOOM; into.disabled = camera.scale >= MAX_ZOOM;
  }
  const observer = new ResizeObserver(() => {
    const { width, height } = svg.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    camera.resize(width, height); render();
  });
  observer.observe(svg);
  let drag = null, suppressClick = false;
  svg.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
  });
  svg.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    if (!drag.moved) {
      drag.moved = true; svg.setPointerCapture(event.pointerId); svg.classList.add('panning');
    }
    camera.pan(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX; drag.y = event.clientY;
    render();
  });
  const endDrag = () => {
    if (drag?.moved) suppressClick = true;
    const id = drag?.id;
    drag = null; svg.classList.remove('panning');
    if (id !== undefined && svg.hasPointerCapture(id)) svg.releasePointerCapture(id);
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('lostpointercapture', endDrag);
  svg.addEventListener('pointerleave', () => { if (!drag?.moved) endDrag(); });
  svg.addEventListener('click', event => {
    if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  svg.addEventListener('reveal-node', event => {
    const node = event.target.getBoundingClientRect(), viewport = svg.getBoundingClientRect();
    camera.pan(viewport.left + viewport.width / 2 - (node.left + node.width / 2), viewport.top + viewport.height / 2 - (node.top + node.height / 2));
    render();
  });
  svg.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    camera.zoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.01), event.clientX - rect.left, event.clientY - rect.top);
    render();
  }, { passive: false });
  svg.addEventListener('keydown', event => {
    if (event.target !== svg || event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case '+': case '=': camera.zoom(1.25); break;
      case '-': camera.zoom(1 / 1.25); break;
      case '0': case 'Home': camera.reset(); break;
      case 'f': case 'F': camera.fit(); break;
      case 'ArrowLeft': camera.pan(40, 0); break;
      case 'ArrowRight': camera.pan(-40, 0); break;
      case 'ArrowUp': camera.pan(0, 40); break;
      case 'ArrowDown': camera.pan(0, -40); break;
      default: return;
    }
    event.preventDefault(); render();
  });
  return () => { observer.disconnect(); endDrag(); };
}
