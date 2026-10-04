import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const { createLocalizer, localizer, msg, value, localize, refreshLocale, edgeLabel, nodeLabel, errorMessage, LOCALE_STORAGE_KEY } = await import(new URL('../packages/web/public/localization.js', import.meta.url).href);
const { localeCatalogs } = await import(new URL('../packages/web/public/locale-catalogs.js', import.meta.url).href);
const catalogs: { id: string; name: string; messages: Record<string, string> }[] = localeCatalogs;
const english = catalogs.find(c => c.id === 'en')!;

test('English and Japanese catalogs cover every UI key with matching parameters', () => {
  const parameters = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const catalog of catalogs) {
    assert.deepEqual(Object.keys(catalog.messages).sort(), Object.keys(english.messages).sort(), catalog.id);
    for (const [key, text] of Object.entries(english.messages)) {
      assert.ok(catalog.messages[key].length, `${catalog.id}: ${key}`);
      assert.deepEqual(parameters(catalog.messages[key]), parameters(text), `${catalog.id}: ${key}`);
    }
  }
  const publicRoot = new URL('../packages/web/public/', import.meta.url);
  const scripts = [...readdirSync(publicRoot).filter(file => file.endsWith('.js') && file !== 'locale-catalogs.js')];
  for (const file of ['index.html', ...scripts]) {
    const source = readFileSync(new URL(file, publicRoot), 'utf8');
    const keys = [...source.matchAll(/data-i18n(?:-aria-label|-placeholder)?="([^"]+)"|msg\('([^']+)'/g)].map(match => match[1] ?? match[2]);
    for (const key of keys) assert.ok(Object.hasOwn(english.messages, key), `${file}: ${key}`);
    assert.doesNotMatch(source, /[ぁ-んァ-ン一-龯]/, `${file}: untranslated UI text`);
  }
});

test('locale preference negotiation and unsupported choices fall back predictably', () => {
  const l = createLocalizer();
  assert.equal(l.initialize(undefined, ['fr-FR', 'ja-JP', 'en-US']), 'ja');
  assert.equal(l.translate(msg('language')), '言語');
  assert.equal(l.initialize(undefined, ['EN_us']), 'en');
  assert.equal(l.initialize(undefined, []), 'en');
  assert.equal(l.initialize(undefined, ['fr']), 'en');
  assert.equal(l.select('unsupported'), 'en');
  assert.equal(l.select(null), 'en');
  assert.equal(l.select('JA-jp'), 'ja');
  for (const key of ['missingKey', 'toString', '__proto__']) assert.equal(l.translate(msg(key)), key);
  assert.equal(l.translate(msg('resourceCount', { total: 45, start: 31, end: 45 })), '45 資源 · 31–45');
  l.select('en');
  assert.equal(l.translate(msg('reachability', { status: msg('value.unknown') })), 'Reachability: Unknown');
  assert.equal(l.translate('<img onerror=alert(1)>'), '<img onerror=alert(1)>');
});

test('saved selection overrides browser preference, survives reload and tolerates storage failure', () => {
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key), setItem: (key: string, val: string) => memory.set(key, val) };
  const first = createLocalizer();
  assert.equal(first.initialize(storage, ['ja-JP']), 'ja');
  assert.equal(memory.size, 0, 'initial browser preference is not persisted as an explicit choice');
  first.select('en', storage);
  assert.equal(memory.get(LOCALE_STORAGE_KEY), 'en');
  const reload = createLocalizer();
  assert.equal(reload.initialize(storage, ['ja-JP']), 'en');
  reload.select('ja', storage);
  assert.equal(createLocalizer().initialize(storage, ['en-US']), 'ja');
  memory.set(LOCALE_STORAGE_KEY, 'removed-locale');
  assert.equal(createLocalizer().initialize(storage, ['ja-JP']), 'en');
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(reload.initialize(denied, ['ja-JP']), 'ja');
  assert.equal(reload.select('en', denied), 'en');
});

test('a registered additional locale uses partial catalogs with English fallback', () => {
  const l = createLocalizer([...catalogs, { id: 'fr', name: 'Français', messages: { language: 'Langue', reachability: 'Accessibilité : {status}' } }]);
  assert.deepEqual(l.catalogs.map((c: { id: string }) => c.id), ['en', 'ja', 'fr']);
  assert.equal(l.initialize(undefined, ['fr-CA']), 'fr');
  assert.equal(l.translate(msg('language')), 'Langue');
  assert.equal(l.translate(msg('fitGraph')), 'Fit graph');
  assert.equal(l.translate(msg('reachability', { status: msg('value.reachable') })), 'Accessibilité : Reachable');
  assert.throws(() => createLocalizer([]), /English fallback/);
  assert.throws(() => createLocalizer([...catalogs, english]), /unique/);
  const regional = createLocalizer([english, { id: 'zh-Hant', name: '繁體中文', messages: { language: '語言' } }]);
  assert.equal(regional.initialize(undefined, ['zh-Hant-TW']), 'zh-hant');
  assert.equal(regional.catalogs[1].id, 'zh-hant');
  assert.equal(regional.translate(msg('language')), '語言');
});

class Node {
  attributes = new Map<string, string>();
  textContent = '';
  setAttribute(key: string, val: string) { this.attributes.set(key, val); }
  getAttribute(key: string) { return this.attributes.get(key); }
  removeAttribute(key: string) { this.attributes.delete(key); }
}

test('switching updates existing text and accessible names, retaining raw values and node identity', () => {
  const selected = new Node(), identity = new Node(), count = new Node(), button = new Node(), caption = new Node();
  selected.setAttribute('data-i18n', 'selectResource');
  identity.setAttribute('data-i18n', 'loadingSnapshot');
  count.setAttribute('data-i18n', 'resources');
  button.setAttribute('data-i18n-aria-label', 'searchAction');
  const nodes = [selected, identity, count, button, caption];
  const root = { documentElement: { lang: '' }, querySelectorAll: (selector: string) => nodes.filter(n => n.attributes.has(selector.slice(1, -1))) };
  localizer.select('en'); refreshLocale(root);
  assert.equal(selected.textContent, 'Select a resource');
  assert.equal(button.getAttribute('aria-label'), 'Search');
  localize(selected, 'minecraft:diamond');
  localize(identity, msg('identity', { snapshot: 'snapshot-id', generation: 3, hash: 'abcdef' }));
  localize(count, msg('resourceCount', { total: 50, start: 31, end: 50 }));
  localize(caption, msg('graphHint'), 'textContent', 26);
  for (const locale of ['ja', 'en', 'ja']) {
    localizer.select(locale); refreshLocale(root);
    assert.equal(selected.textContent, 'minecraft:diamond');
    assert.match(identity.textContent, /snapshot-id.*3.*abcdef/);
    assert.match(count.textContent, /50.*31–50/);
    assert.ok(caption.textContent.length <= 26);
    assert.equal(root.documentElement.lang, locale);
  }
  assert.equal(button.getAttribute('aria-label'), '検索');
  assert.equal(nodes[0], selected);
  localize(count, ''); localizer.select('en'); refreshLocale(root);
  assert.equal(count.textContent, '', 'cleared text does not resurrect its old translation');
});

test('graph labels use structured fields while captured names, units and evidence remain unchanged', () => {
  const input = { role: 'input', slot: 0, alternative: 1, amount: 2, unit: 'item', tag: 'atlas:materials', consumption: 'consumed', label: 'stale label' };
  const resource = { kind: 'resource', label: '採取された名前 / Captured name' };
  const condition = { kind: 'predicate', label: 'context: atlas:context = {"foo":true}', condition: { kind: 'context' } };
  for (const locale of ['en', 'ja']) {
    localizer.select(locale);
    const text = localizer.translate(edgeLabel(input));
    assert.match(text, /1 \/ OR 2 ×2 item #atlas:materials/);
    assert.doesNotMatch(text, /stale label/);
    assert.equal(localizer.translate(nodeLabel(resource)), resource.label);
    assert.match(localizer.translate(nodeLabel(condition)), /atlas:context = \{"foo":true\}/);
    assert.notEqual(localizer.translate(edgeLabel({ role: 'equipment' })), 'edgeEquipment');
    assert.notEqual(localizer.translate(nodeLabel({ kind: 'predicate', label: 'uninterpreted ingredient' })), 'predicateIngredient');
    for (const token of ['confirmed', 'unknown', 'executable', 'display', 'unconfirmed', 'supported', 'opaque', 'primary', 'byproduct', 'returned', 'deterministic', 'expectation', 'mean-flow']) {
      assert.notEqual(localizer.translate(value(token)), token, `${locale}: ${token}`);
    }
    assert.equal(localizer.translate(value('custom:status')), 'custom:status');
    assert.match(localizer.translate(errorMessage(new Error('raw server detail'))), /raw server detail/);
  }
  localizer.select('en');
  assert.equal(localizer.translate(errorMessage(new Error('Start serve with --before to view a diff'))), 'Start serve with --before to view a diff');
  assert.equal(localizer.translate(errorMessage(new TypeError('Failed to fetch'))), 'Cannot connect to the local server.');
});
