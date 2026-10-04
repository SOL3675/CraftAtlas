import { localeCatalogs } from './locale-catalogs.js';

export const LOCALE_STORAGE_KEY = 'craftatlas.locale';
export const msg = (key, params = {}) => ({ key, params });

export function createLocalizer(catalogs = localeCatalogs) {
  const registered = new Map(catalogs.map(catalog => [catalog.id.toLowerCase(), { ...catalog, id: catalog.id.toLowerCase() }]));
  if (registered.size !== catalogs.length) throw new Error('Locale IDs must be unique');
  if (!registered.has('en')) throw new Error('An English fallback catalog is required');
  let locale = 'en';
  const match = candidate => {
    if (typeof candidate !== 'string') return undefined;
    const parts = candidate.toLowerCase().replaceAll('_', '-').split('-');
    while (parts.length) {
      const id = parts.join('-');
      if (registered.has(id)) return id;
      parts.pop();
    }
    return undefined;
  };
  const translate = message => {
    if (!message || typeof message !== 'object' || !message.key) return String(message ?? '');
    const lookup = messages => Object.hasOwn(messages, message.key) ? messages[message.key] : undefined;
    const template = lookup(registered.get(locale).messages) ?? lookup(registered.get('en').messages) ?? message.key;
    return template.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(message.params, key) ? translate(message.params[key]) : token);
  };
  return {
    catalogs: [...registered.values()],
    get locale() { return locale; },
    match,
    translate,
    select(candidate, storage) {
      locale = match(candidate) ?? 'en';
      try { storage?.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* Storage may be blocked or full. */ }
      return locale;
    },
    initialize(storage, preferences = []) {
      let saved;
      try { saved = storage?.getItem(LOCALE_STORAGE_KEY); } catch { /* Private browsing can deny access. */ }
      // A saved but unsupported choice falls back to English. No preference is overwritten on startup.
      locale = saved ? match(saved) ?? 'en' : preferences.map(match).find(Boolean) ?? 'en';
      return locale;
    },
  };
}

export const localizer = createLocalizer();
export const value = token => Object.hasOwn(localeCatalogs.find(catalog => catalog.id === 'en').messages, `value.${token}`) ? msg(`value.${token}`) : token;
const bindings = new WeakMap();

// Keep existing nodes and listeners (including the graph camera) while translating.
export function localize(node, message, attribute = 'textContent', maxLength) {
  const marker = attribute === 'textContent' ? 'data-i18n' : `data-i18n-${attribute}`;
  // Promote markup to a binding once, so raw data can replace placeholders permanently.
  node.removeAttribute(marker);
  let entries = bindings.get(node);
  if (!entries) { entries = new Map(); bindings.set(node, entries); }
  if (message && typeof message === 'object' && message.key) {
    entries.set(attribute, { message, maxLength });
    node.setAttribute('data-localized', '');
  } else {
    entries.delete(attribute);
    if (!entries.size) node.removeAttribute('data-localized');
  }
  const translated = localizer.translate(message);
  const text = maxLength && translated.length > maxLength ? translated.slice(0, maxLength - 2) + '…' : translated;
  if (attribute === 'textContent') node.textContent = text;
  else node.setAttribute(attribute, text);
}

export function refreshLocale(root = document) {
  root.documentElement.lang = localizer.locale;
  for (const attribute of ['textContent', 'aria-label', 'placeholder']) {
    const marker = attribute === 'textContent' ? 'data-i18n' : `data-i18n-${attribute}`;
    root.querySelectorAll(`[${marker}]`).forEach(node => localize(node, msg(node.getAttribute(marker)), attribute));
  }
  root.querySelectorAll('[data-localized]').forEach(node => {
    bindings.get(node)?.forEach(({ message, maxLength }, attribute) => localize(node, message, attribute, maxLength));
  });
}

function browserStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function initializeLocale(selector) {
  const storage = browserStorage();
  localizer.initialize(storage, navigator.languages?.length ? navigator.languages : [navigator.language]);
  for (const catalog of localizer.catalogs) {
    const option = document.createElement('option'); option.value = catalog.id; option.textContent = catalog.name; option.lang = catalog.id;
    selector.append(option);
  }
  selector.value = localizer.locale;
  selector.onchange = () => {
    localizer.select(selector.value, storage); selector.value = localizer.locale;
    refreshLocale();
  };
  refreshLocale();
}

export function edgeLabel(edge) {
  if (edge.role === 'input') return msg('edgeInput', {
    slot: (edge.slot ?? 0) + 1, alternative: (edge.alternative ?? 0) + 1, amount: edge.amount, unit: edge.unit,
    tag: edge.tag ? ` #${edge.tag}` : '', consumption: edge.consumption ? msg('parenthesized', { value: value(edge.consumption) }) : '',
  });
  if (edge.role === 'output') return msg('edgeOutput', { amount: edge.amount, unit: edge.unit, probability: edge.probability ?? '?' });
  return msg({ equipment: 'edgeEquipment', stage: 'edgeStage', dimension: 'edgeDimension', context: 'edgeContext', opaque: 'edgeOpaque' }[edge.role] ?? 'edgeOpaque');
}

export function nodeLabel(node) {
  // Resource names come from captured game data. Only generated predicate scaffolding is localized.
  if (node.kind === 'predicate' && node.label === 'uninterpreted ingredient') return msg('predicateIngredient');
  if (node.kind === 'predicate' && node.condition) {
    const prefix = `${node.condition.kind}: `;
    return msg('predicateCondition', { kind: edgeLabel({ role: node.condition.kind }), condition: node.label.startsWith(prefix) ? node.label.slice(prefix.length) : node.label });
  }
  return node.label;
}

export function errorMessage(error) {
  if (error.message === 'Start serve with --before to view a diff') return msg('noBefore');
  if (error instanceof TypeError && ['Failed to fetch', 'fetch failed', 'Load failed'].includes(error.message)) return msg('networkError');
  // Server and analysis details are evidence; retain their original text inside a translated UI message.
  return msg('requestError', { message: error.message });
}
