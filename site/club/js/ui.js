// Small UI toolkit for the club portal: escaping, formatting, dialogs, toasts and badges.

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
export const money = (cents) => (Number(cents ?? 0) / 100).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
export function dateTime(value, tz) {
  return value ? new Date(value).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz || undefined }) : "—";
}
export function day(value, tz) {
  return value ? new Date(value).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: tz || undefined }) : "—";
}
export const daysSince = (value) => (value ? (Date.now() - new Date(value).getTime()) / 86_400_000 : Infinity);
export const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

/** "6" → "6th"; anything else as typed ("U12", "JV"). Same rule as the app's ClubGrouping. */
export function gradeLabel(grade) {
  if (!grade) return null;
  const n = Number.parseInt(grade, 10);
  if (String(n) !== String(grade).trim()) return grade;
  const suffix = [11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th"][n % 10];
  return `${n}${suffix}`;
}
export function gradeSection(grade) {
  const label = gradeLabel(grade);
  if (!label) return "Other teams";
  return String(Number.parseInt(grade, 10)) === String(grade).trim() ? `${label} Grade` : label;
}
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const groupingLine = (t) => [gradeLabel(t.grade), cap(t.gender), t.level].filter(Boolean).join(" · ");

// ----- Status badges (icon + label, never color alone) ---------------------------------
const STATUS_ICON = { good: "●", warning: "▲", critical: "■", neutral: "○", info: "★" };
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

export async function copy(text, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(what);
  } catch {
    toast("Couldn't copy. Select the text and copy it yourself.", true);
  }
}

/**
 * Modal form. fields: [{name, label, type: text|textarea|select|email|datetime-local|checkbox, options, value, required, help}].
 * confirmText: the user must type this exactly (guardrail for destructive actions).
 * Resolves to the values, or null if cancelled.
 */
export function dialog({ title, message = "", fields = [], submit = "Save", danger = false, confirmText = null, cancel = "Cancel" }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "modal";
    const fieldHtml = fields.map((f) => {
      const id = `f-${f.name}`;
      const req = f.required ? "required" : "";
      let input;
      if (f.type === "textarea") input = html`<textarea id="${id}" name="${f.name}" rows="${f.rows ?? 4}" maxlength="${f.max ?? 2000}" ${raw(req)}>${f.value ?? ""}</textarea>`;
      else if (f.type === "select") input = html`<select id="${id}" name="${f.name}" ${raw(req)}>${raw(f.options.map((o) => html`<option value="${o.value}" ${raw(o.value === f.value ? "selected" : "")}>${o.label}</option>`).join(""))}</select>`;
      else if (f.type === "checkbox") return html`<label class="check"><input type="checkbox" name="${f.name}" ${raw(f.value ? "checked" : "")}> ${f.label}</label>${raw(f.help ? html`<p class="help">${f.help}</p>` : "")}`;
      else input = html`<input id="${id}" name="${f.name}" type="${f.type ?? "text"}" value="${f.value ?? ""}" maxlength="${f.max ?? 300}" ${raw(req)} autocomplete="off">`;
      return html`<label for="${id}">${f.label}</label>${raw(input)}${raw(f.help ? html`<p class="help">${f.help}</p>` : "")}`;
    }).join("");
    const confirmHtml = confirmText
      ? html`<label for="f-confirm">Type <strong>${confirmText}</strong> to confirm</label><input id="f-confirm" name="__confirm" autocomplete="off" required>`
      : "";
    d.innerHTML = html`<form method="dialog" class="stack">
      <h2>${title}</h2>
      ${raw(message ? html`<div class="dialog-msg">${raw(message)}</div>` : "")}
      ${raw(fieldHtml)}${raw(confirmHtml)}
      <div class="row end">
        ${raw(cancel ? html`<button type="button" class="btn" data-cancel>${cancel}</button>` : "")}
        ${raw(submit ? html`<button type="submit" class="btn ${danger ? "btn-danger" : "btn-primary"}" ${raw(confirmText ? "disabled" : "")}>${submit}</button>` : "")}
      </div></form>`;
    document.body.append(d);
    const form = d.querySelector("form");
    const submitBtn = form.querySelector("[type=submit]");
    const confirmInput = form.querySelector("#f-confirm");
    const norm = (s) => s.trim().toLowerCase();
    confirmInput?.addEventListener("input", () => (submitBtn.disabled = norm(confirmInput.value) !== norm(confirmText)));
    const finish = (value) => {
      d.close();
      d.remove();
      resolve(value);
    };
    form.querySelector("[data-cancel]")?.addEventListener("click", () => finish(null));
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(null);
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (confirmText && norm(confirmInput.value) !== norm(confirmText)) return;
      const values = Object.fromEntries(new FormData(form).entries());
      for (const f of fields) if (f.type === "checkbox") values[f.name] = form.elements[f.name].checked;
      delete values.__confirm;
      finish(values);
    });
    // Buttons inside the message (e.g. Copy) work without closing the dialog.
    d.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy, "Copied")));
    d.showModal();
    form.querySelector("input, textarea, select")?.focus();
  });
}

/** Runs an action with a busy state and a toast; returns the result, or null on error. */
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

/** datetime-local value ("2026-11-07T09:00") for an ISO time, in the browser's zone. */
export function localInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
