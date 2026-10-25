// Small UI toolkit: escaping, formatting, dialogs, status badges and the column chart.

/** Escapes text for HTML. Every value from the server goes through this. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Tagged template: interpolations are escaped unless wrapped with raw(). */
export function html(strings, ...values) {
  return strings.reduce((out, s, i) => {
    if (i === 0) return s;
    const v = values[i - 1];
    const text = v instanceof Raw ? v.value : Array.isArray(v) ? v.map((x) => (x instanceof Raw ? x.value : esc(x))).join("") : esc(v);
    return out + text + s;
  }, "");
}
class Raw {
  constructor(value) {
    this.value = value;
  }
}
export const raw = (value) => new Raw(value);

// ----- Formatting ---------------------------------------------------------------------
export const num = (n) => Number(n ?? 0).toLocaleString();
export const money = (cents) => (Number(cents ?? 0) / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
export function date(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}
export function dateTime(value) {
  return value ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}
export function ago(value) {
  if (!value) return "never";
  const s = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d < 60 ? `${d} d ago` : date(value);
}
export const daysSince = (value) => (value ? (Date.now() - new Date(value).getTime()) / 86_400_000 : Infinity);
export const label = (s) => String(s ?? "").replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// ----- Status badges (icon + label, never color alone) ---------------------------------
const STATUS_ICON = { good: "●", warning: "▲", serious: "◆", critical: "■", neutral: "○", info: "★" };
export function badge(text, status = "neutral") {
  return html`<span class="badge badge-${status}"><span aria-hidden="true">${STATUS_ICON[status] ?? ""}</span>${text}</span>`;
}

// ----- Feedback ----------------------------------------------------------------------
export function toast(message, isError = false) {
  const el = document.createElement("div");
  el.className = `toast${isError ? " toast-error" : ""}`;
  el.setAttribute("role", isError ? "alert" : "status");
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), isError ? 7000 : 3500);
}

/**
 * Modal form. fields: [{name, label, type: text|textarea|select|date|email, options, value, required, help}].
 * confirmText: the user must type this exactly (guardrail for destructive actions).
 * Resolves to the values, or null if cancelled.
 */
export function dialog({ title, message = "", fields = [], submit = "Confirm", danger = false, confirmText = null }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "modal";
    const fieldHtml = fields.map((f) => {
      const id = `f-${f.name}`;
      const req = f.required ? "required" : "";
      let input;
      if (f.type === "textarea") input = html`<textarea id="${id}" name="${f.name}" rows="3" maxlength="${f.max ?? 1000}" ${raw(req)}>${f.value ?? ""}</textarea>`;
      else if (f.type === "select") input = html`<select id="${id}" name="${f.name}" ${raw(req)}>${raw(f.options.map((o) => html`<option value="${o.value}" ${raw(o.value === f.value ? "selected" : "")}>${o.label}</option>`).join(""))}</select>`;
      else input = html`<input id="${id}" name="${f.name}" type="${f.type ?? "text"}" value="${f.value ?? ""}" maxlength="${f.max ?? 300}" ${raw(req)} autocomplete="off">`;
      return html`<label for="${id}">${f.label}</label>${raw(input)}${raw(f.help ? html`<p class="help">${f.help}</p>` : "")}`;
    }).join("");
    const confirmHtml = confirmText
      ? html`<label for="f-confirm">Type <strong>${confirmText}</strong> to confirm</label><input id="f-confirm" name="__confirm" autocomplete="off" required>`
      : "";
    d.innerHTML = html`<form method="dialog" class="stack">
      <h2>${title}</h2>
      ${raw(message ? html`<p>${message}</p>` : "")}
      ${raw(fieldHtml)}${raw(confirmHtml)}
      <div class="row end">
        <button type="button" class="btn" data-cancel>Cancel</button>
        <button type="submit" class="btn ${danger ? "btn-danger" : "btn-primary"}" ${raw(confirmText ? "disabled" : "")}>${submit}</button>
      </div></form>`;
    document.body.append(d);
    const form = d.querySelector("form");
    const submitBtn = form.querySelector("[type=submit]");
    const confirmInput = form.querySelector("#f-confirm");
    confirmInput?.addEventListener("input", () => (submitBtn.disabled = confirmInput.value.trim() !== confirmText));
    const finish = (value) => {
      d.close();
      d.remove();
      resolve(value);
    };
    form.querySelector("[data-cancel]").addEventListener("click", () => finish(null));
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(null);
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (confirmText && confirmInput.value.trim() !== confirmText) return;
      const values = Object.fromEntries(new FormData(form).entries());
      delete values.__confirm;
      finish(values);
    });
    d.showModal();
    form.querySelector("input, textarea, select")?.focus();
  });
}

/** Runs an admin action with a busy state and a toast; returns the result or null on error. */
export async function run(button, task, success) {
  if (button) button.disabled = true;
  try {
    const result = await task();
    if (success) toast(typeof success === "function" ? success(result) : success);
    return result ?? true;
  } catch (e) {
    toast(e.message ?? String(e), true);
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

// ----- Column chart (single series; dataviz mark specs) -------------------------------
// Columns ≤ 24px with a 4px rounded cap and a square base on one baseline, 1px solid
// gridlines, clean ticks, a per-column hover tooltip with a hit target wider than the mark,
// the latest value labelled on its cap, and a table view of every value.
function niceMax(max) {
  if (max <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= max) return m * step;
  return 10 * step;
}

export function columnChart({ title, points, valueLabel }) {
  // points: [{ label, value }]
  const w = 360, h = 170, left = 28, right = 6, top = 16, bottom = 24;
  const plotW = w - left - right, plotH = h - top - bottom;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const band = plotW / points.length;
  const barW = Math.min(24, band * 0.6);
  const y = (v) => top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const id = `c${Math.random().toString(36).slice(2, 8)}`;
  const grid = ticks.map((t) => `<line class="grid" x1="${left}" x2="${w - right}" y1="${y(t)}" y2="${y(t)}"/>
    <text class="tick" x="${left - 6}" y="${y(t) + 4}" text-anchor="end">${esc(num(t))}</text>`).join("");
  const bars = points.map((p, i) => {
    const x = left + band * i + (band - barW) / 2;
    const bh = (p.value / max) * plotH;
    const r = Math.min(4, bh, barW / 2);
    const y0 = top + plotH;
    // Rounded top corners only; square at the baseline.
    const path = bh <= 0 ? "" : `M${x},${y0} V${y0 - bh + r} Q${x},${y0 - bh} ${x + r},${y0 - bh} H${x + barW - r} Q${x + barW},${y0 - bh} ${x + barW},${y0 - bh + r} V${y0} Z`;
    const isLast = i === points.length - 1;
    const showLabel = i % 2 === (points.length - 1) % 2;
    return `<g class="col" data-i="${i}" tabindex="0" aria-label="${esc(`${p.label}: ${num(p.value)} ${valueLabel}`)}">
      <rect class="hit" x="${left + band * i}" y="${top}" width="${band}" height="${plotH}"/>
      ${path ? `<path class="bar" d="${path}"/>` : ""}
      ${isLast && p.value > 0 ? `<text class="cap" x="${x + barW / 2}" y="${y0 - bh - 4}" text-anchor="middle">${esc(num(p.value))}</text>` : ""}
      ${showLabel ? `<text class="tick" x="${x + barW / 2}" y="${h - 8}" text-anchor="middle">${esc(p.label)}</text>` : ""}
    </g>`;
  }).join("");
  const rows = points.map((p) => html`<tr><td>${p.label}</td><td class="numcol">${num(p.value)}</td></tr>`).join("");
  return html`<figure class="viz card">
    <figcaption><h3>${title}</h3></figcaption>
    <div class="viz-plot" id="${id}">
      <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}">${raw(grid)}<line class="axis" x1="${left}" x2="${w - right}" y1="${top + plotH}" y2="${top + plotH}"/>${raw(bars)}</svg>
      <div class="viz-tip" hidden></div>
    </div>
    <details><summary>Table view</summary><table class="table"><thead><tr><th>Week of</th><th class="numcol">${label(valueLabel)}</th></tr></thead><tbody>${raw(rows)}</tbody></table></details>
  </figure>`;
}

/** Wires hover/focus tooltips for every chart rendered by columnChart. */
export function bindCharts(root, series) {
  root.querySelectorAll(".viz-plot").forEach((plot, chartIndex) => {
    const tip = plot.querySelector(".viz-tip");
    const { points, valueLabel } = series[chartIndex];
    const show = (g) => {
      const p = points[Number(g.dataset.i)];
      tip.innerHTML = html`<strong>${num(p.value)}</strong> ${valueLabel}<br><span class="muted">Week of ${p.label}</span>`;
      tip.hidden = false;
      const box = g.querySelector(".hit").getBoundingClientRect();
      const host = plot.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(box.left - host.left + box.width / 2, 60), host.width - 60)}px`;
      plot.querySelectorAll(".col").forEach((c) => c.classList.toggle("dim", c !== g));
    };
    const hide = () => {
      tip.hidden = true;
      plot.querySelectorAll(".col").forEach((c) => c.classList.remove("dim"));
    };
    plot.querySelectorAll(".col").forEach((g) => {
      g.addEventListener("pointerenter", () => show(g));
      g.addEventListener("focus", () => show(g));
      g.addEventListener("blur", hide);
    });
    plot.addEventListener("pointerleave", hide);
  });
}
