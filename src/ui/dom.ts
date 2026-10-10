// A tiny DOM helper: el('div', { class: 'card' }, child, 'text'). Text is always set as text, never HTML.
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') n.addEventListener(k.replace(/^on/, ''), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, String(v));
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k);
  return n;
}
export const clear = (n: Element) => { while (n.firstChild) n.firstChild.remove(); return n; };
