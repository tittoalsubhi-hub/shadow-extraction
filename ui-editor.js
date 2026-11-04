// Edit Control Layout: drag, resize and set opacity of each touch control; separate portrait/landscape layouts.
import { CONTROL_DEFS, CONTROL_IDS, defaultLayouts, mirrorLayout, controlVisible } from './input-layout.js';

export class LayoutEditor {
  constructor(app) { this.app = app; this.active = false; this.sel = 'stick'; this.preview = false; this.visible = null; }
  open() {
    const app = this.app;
    this.active = true;
    this.orient = app.orientation();
    this.work = JSON.parse(JSON.stringify(app.layouts[this.orient]));
    if (app.settings.leftHanded) this.work = mirrorLayout(this.work);
    app.input.setEnabled(false);
    document.body.classList.add('editing');
    this.panel = document.createElement('div');
    this.panel.className = 'editor-panel';
    document.getElementById('app').appendChild(this.panel);
    this.handlers = [];
    for (const id of CONTROL_IDS) {
      const el = app.input.els[id];
      const down = (e) => this.onDown(e, id, el);
      el.addEventListener('pointerdown', down, true);
      this.handlers.push([el, down]);
      el.classList.add('editable');
      el.style.display = '';
      el.classList.remove('hidden');
    }
    this.render();
    this.apply();
  }
  close(save) {
    const app = this.app;
    if (save) {
      let l = this.work;
      if (app.settings.leftHanded) l = mirrorLayout(l);
      app.layouts[this.orient] = l;
      app.saveLayouts();
    }
    for (const [el, h] of this.handlers) { el.removeEventListener('pointerdown', h, true); el.classList.remove('editable', 'selected', 'overlap'); }
    this.panel.remove();
    document.body.classList.remove('editing');
    this.active = false;
    app.input.setEnabled(true);
    app.relayout();
  }
  apply() {
    const app = this.app;
    const safe = app.safeRect();
    const s = { ...app.settings, aimStick: true };
    app.input.applyLayout(this.work, safe, s);
    // show every control of the current scheme (including the optional aim stick)
    this.visible = CONTROL_IDS.filter(id => controlVisible(id, s));
    for (const id of CONTROL_IDS) { const el = app.input.els[id]; el.style.display = this.visible.includes(id) ? '' : 'none'; el.classList.remove('hidden'); el.classList.toggle('selected', id === this.sel); }
    this.markOverlaps();
  }
  markOverlaps() {
    const els = (this.visible || CONTROL_IDS).map(id => [id, this.app.input.els[id].getBoundingClientRect()]);
    const hud = document.querySelector('.hud-top')?.getBoundingClientRect();
    for (const [id, r] of els) {
      let bad = false;
      for (const [id2, r2] of els) {
        if (id === id2) continue;
        if (id === 'aim' || id2 === 'aim') continue; // aim stick is optional and may share space
        const ix = Math.min(r.right, r2.right) - Math.max(r.left, r2.left), iy = Math.min(r.bottom, r2.bottom) - Math.max(r.top, r2.top);
        if (ix > 6 && iy > 6) bad = true;
      }
      this.app.input.els[id].classList.toggle('overlap', bad);
    }
  }
  onDown(e, id, el) {
    e.preventDefault(); e.stopPropagation();
    if (e.target.closest('.chip')) { /* group drag */ }
    this.sel = id;
    this.render();
    const app = this.app;
    const safe = app.safeRect();
    const W = safe.w - safe.l - safe.r, H = safe.h - safe.t - safe.b;
    const start = { x: e.clientX, y: e.clientY, cx: this.work[id].x, cy: this.work[id].y };
    const move = (ev) => {
      const nx = start.cx + (ev.clientX - start.x) / W, ny = start.cy + (ev.clientY - start.y) / H;
      this.work[id].x = Math.min(0.97, Math.max(0.03, nx));
      this.work[id].y = Math.min(0.98, Math.max(0.14, ny));
      this.apply();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
  render() {
    const c = this.work[this.sel];
    const def = CONTROL_DEFS[this.sel];
    this.panel.classList.toggle('preview', this.preview);
    this.panel.innerHTML = this.preview ? `<button data-e="preview">Exit preview</button>` : `
      <div class="ep-h"><b>Edit Control Layout</b> <span class="muted">${this.orient.toUpperCase()} · rotate the device to edit the other orientation</span></div>
      <div class="ep-sel">Selected: <b>${def.label.replace('\n', ' ')}</b>${def.optional ? ' <span class="muted">(shown when enabled in Settings)</span>' : ''}</div>
      <label>Size <input type="range" min="0.6" max="1.8" step="0.05" value="${c.s}" data-e="s"></label>
      <label>Opacity <input type="range" min="0.2" max="1" step="0.05" value="${c.o}" data-e="o"></label>
      <div class="ep-row">
        <button data-e="mirror">Mirror (left-handed)</button><button data-e="reset">Reset to default</button><button data-e="preview">Preview</button>
      </div>
      <div class="ep-row"><button data-e="cancel">Cancel</button><button class="primary" data-e="done">Save</button></div>
      <div class="muted small">Drag any control to move it. Red outline = overlapping.</div>`;
    for (const inp of this.panel.querySelectorAll('input[data-e]')) inp.addEventListener('input', () => { this.work[this.sel][inp.dataset.e] = parseFloat(inp.value); this.apply(); });
    for (const b of this.panel.querySelectorAll('button[data-e]')) b.addEventListener('click', () => {
      const a = b.dataset.e;
      if (a === 'mirror') { this.work = mirrorLayout(this.work); this.apply(); }
      else if (a === 'reset') { this.work = defaultLayouts()[this.orient]; if (this.app.settings.leftHanded) this.work = mirrorLayout(this.work); this.apply(); this.render(); }
      else if (a === 'preview') { this.preview = !this.preview; this.render(); }
      else if (a === 'cancel') this.close(false);
      else if (a === 'done') this.close(true);
    });
  }
  onResize() {
    if (!this.active) return;
    const o = this.app.orientation();
    if (o !== this.orient) {
      // save the current orientation's edits and switch
      let l = this.work; if (this.app.settings.leftHanded) l = mirrorLayout(l);
      this.app.layouts[this.orient] = l;
      this.orient = o;
      this.work = JSON.parse(JSON.stringify(this.app.layouts[o]));
      if (this.app.settings.leftHanded) this.work = mirrorLayout(this.work);
      this.render();
    }
    this.apply();
  }
}
