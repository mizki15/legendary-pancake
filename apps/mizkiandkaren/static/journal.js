const root = document.body.dataset.root;
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const seasons = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const money = new Intl.NumberFormat('ja-JP');
const DAY = 86400000;
function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== '') element.textContent = text;
  return element;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ class: 'icon', width: '20', height: '20', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
}
function button(text, symbol, className = 'button quiet') {
  const element = node('button', className); element.type = 'button';
  if (symbol) element.append(icon(symbol));
  if (text) element.append(document.createTextNode(text));
  return element;
}
function link(text, href, className = '') {
  const element = node('a', className, text); element.href = href; return element;
}
function externalLink(text, href, className = '') {
  const element = link(text, href, className); element.target = '_blank'; element.rel = 'noopener noreferrer'; return element;
}
function mapLink(place) { return externalLink(place, `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`, 'place-link'); }
function seasonLabel(values) { return values.length === 4 ? 'いつでも' : values.map(value => seasons[value]).join('・'); }
function budgetLabel(value) { return value === null ? '' : `${money.format(value)}円／人`; }
function dayLabel(value) { return value ? value.replaceAll('-', '.') : ''; }
function todayJST() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = name => parts.find(p => p.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function busy(element, value) { element.disabled = value; element.setAttribute('aria-busy', String(value)); }
async function api(path = '', { method = 'GET', data, form } = {}) {
  const options = { method, headers: { 'X-CSRF-Token': csrf }, credentials: 'same-origin', cache: 'no-store' };
  if (form) options.body = form;
  else if (data !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(data); }
  let response;
  try { response = await fetch(`${root}api/ideas${path}`, options); }
  catch { throw new Error('通信できませんでした。接続を確認して、もう一度試してください。'); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || '操作できませんでした。少し待ってから、もう一度試してください。');
    error.conflict = response.status === 409; error.login = response.status === 401; throw error;
  }
  return payload;
}
function photo(url, alt, className) {
  const img = node('img', className); img.src = url; img.alt = alt; img.loading = 'lazy'; img.decoding = 'async';
  img.width = 600; img.height = 400;
  img.addEventListener('error', () => { const message = node('p', 'muted', '写真を読み込めませんでした。画面を更新してみてください。'); img.replaceWith(message); }, { once: true });
  return img;
}
function metadata(idea) {
  const meta = node('div', 'card-meta');
  if (idea.place) { const place = mapLink(idea.place); place.prepend(icon('pin')); meta.append(place); }
  if (idea.reference_url) meta.append(externalLink('参考ページ', idea.reference_url));
  if (idea.budget !== null) meta.append(node('span', 'num', budgetLabel(idea.budget)));
  if (idea.seasons.length) meta.append(node('span', '', seasonLabel(idea.seasons)));
  return meta;
}
function startCountdown() {
  const sheet = $('.anniversary-sheet');
  const start = new Date(sheet.dataset.anniversary);
  if (!sheet.dataset.anniversary || !Number.isFinite(start.getTime())) return;
  const jst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = jst.formatToParts(start);
  const get = name => Number(parts.find(p => p.type === name).value);
  const startYear = get('year'), month = get('month'), day = get('day'), hour = get('hour'), minute = get('minute');
  const yearFormat = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', year: 'numeric' });
  const inYear = year => Date.UTC(year, month - 1, day, hour - 9, minute);
  function tick() {
    const now = Date.now();
    let year = Number(yearFormat.format(new Date(now)));
    let target = inYear(year);
    if (now >= target + DAY) { year++; target = inYear(year); }
    const remaining = Math.max(0, target - now);
    const values = { days: Math.floor(remaining / DAY), hours: Math.floor(remaining % DAY / 3600000), minutes: Math.floor(remaining % 3600000 / 60000), seconds: Math.floor(remaining % 60000 / 1000) };
    for (const [unit, value] of Object.entries(values)) $(`#countdown-${unit}`).textContent = String(value).padStart(2, '0');
    $('#anniversary-number').textContent = String(year - startYear);
    $('#anniversary-label').textContent = remaining ? '周年記念日まで' : '周年記念日';
    $('#anniversary-status').hidden = remaining > 0;
    $('#anniversary-status').textContent = '今日はふたりの記念日。';
    $('.countdown').setAttribute('aria-label', `${year}年${month}月${day}日の記念日まで、${values.days}日${values.hours}時間${values.minutes}分${values.seconds}秒`);
  }
  let timer;
  function resume() { clearInterval(timer); tick(); if (!document.hidden) timer = setInterval(tick, 1000); }
  document.addEventListener('visibilitychange', resume);
  resume();
}

async function home() {
  startCountdown();
  const container = $('#home-memories');
  const load = async () => {
    container.setAttribute('aria-busy', 'true');
    const status = node('span', 'visually-hidden', '思い出を読み込んでいます…');
    const skeletons = Array.from({ length: 2 }, () => { const row = node('div', 'memory-loading'); row.setAttribute('aria-hidden', 'true'); row.append(node('span'), node('span')); return row; });
    container.replaceChildren(status, ...skeletons);
    try {
      const { ideas } = await api();
      const memories = ideas.filter(idea => !idea.deleted_at && idea.completed_on).sort((a, b) => b.completed_on.localeCompare(a.completed_on)).slice(0, 3);
      container.replaceChildren();
      container.dataset.count = String(memories.length);
      if (!memories.length) {
        const empty = node('div', 'memory-empty');
        empty.append(node('p', '', 'デートを達成したら、ここにふたりの思い出が並びます。'), link('最初の「行きたい」を書く', `${root}date_idea`, 'text-link'));
        container.append(empty); return;
      }
      for (const idea of memories) {
        const entry = link('', `${root}date_idea?view=archive&open=${encodeURIComponent(idea.id)}`, 'home-memory');
        const image = idea.memory_photo_url || idea.idea_photo_url;
        if (image) entry.append(photo(image, idea.title, ''));
        const text = node('div'); text.append(node('h3', '', idea.title), node('p', 'num', dayLabel(idea.completed_on)));
        entry.append(text); container.append(entry);
      }
    } catch (error) {
      container.replaceChildren(node('p', 'form-error', error.message));
      if (error.login) container.append(link('ログインし直す', `${root}login`, 'text-link'));
      else { const retry = button('もう一度読み込む'); retry.addEventListener('click', load); container.append(retry); }
    } finally { container.setAttribute('aria-busy', 'false'); }
  };
  await load();
}
function ideasApp() {
  const form = $('#idea-form'), filters = $('#filters'), editor = $('#editor');
  const state = { ideas: [], loaded: false, loading: false, stale: false, view: 'ideas', editing: null, mode: 'edit', dirty: false, random: null, lastLoaded: 0, undo: null, notificationTimer: null, previewUrls: {}, removedPhotos: new Set() };
  const url = new URL(location.href);
  const validViews = ['ideas', 'archive', 'trash'];
  state.view = validViews.includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'ideas';
  for (const key of ['q', 'place', 'min', 'max']) if (url.searchParams.has(key)) filters.elements[key].value = url.searchParams.get(key);
  for (const input of $$('[name="season"]', filters)) input.checked = url.searchParams.getAll('season').includes(input.value);
  $('#favorite-filter').setAttribute('aria-pressed', String(url.searchParams.get('favorite') === '1'));
  function isFavoriteFilter() { return $('#favorite-filter').getAttribute('aria-pressed') === 'true'; }
  function serializeURL() {
    const params = new URLSearchParams();
    if (state.view !== 'ideas') params.set('view', state.view);
    for (const key of ['q', 'place', 'min', 'max']) if (filters.elements[key].value.trim()) params.set(key, filters.elements[key].value.trim());
    if (isFavoriteFilter()) params.set('favorite', '1');
    for (const input of $$('[name="season"]:checked', filters)) params.append('season', input.value);
    history.replaceState(null, '', `${location.pathname}${params.size ? '?' + params : ''}`);
  }
  const normalize = value => (value || '').normalize('NFKC').toLocaleLowerCase('ja');
  function inView(idea) {
    if (idea.deleted_at && Date.parse(idea.deleted_at) + 30 * DAY <= Date.now()) return false;
    if (state.view === 'trash') return Boolean(idea.deleted_at);
    return !idea.deleted_at && (state.view === 'archive' ? Boolean(idea.completed_on) : !idea.completed_on);
  }
  function filtered() {
    const query = normalize(filters.elements.q.value.trim());
    const place = normalize(filters.elements.place.value.trim());
    const min = filters.elements.min.value, max = filters.elements.max.value;
    const selectedSeasons = $$('[name="season"]:checked', filters).map(input => input.value);
    if (!filters.checkValidity() || (min && max && Number(min) > Number(max))) return [];
    return state.ideas.filter(idea => inView(idea)
      && (!query || normalize([idea.title, idea.note, idea.place, idea.memory].join(' ')).includes(query))
      && (!place || normalize(idea.place).includes(place))
      && (!isFavoriteFilter() || idea.favorite)
      && (!min || (idea.budget !== null && idea.budget >= Number(min)))
      && (!max || (idea.budget !== null && idea.budget <= Number(max)))
      && (!selectedSeasons.length || selectedSeasons.some(s => idea.seasons.includes(s))))
      .sort((a, b) => state.view === 'archive' ? b.completed_on.localeCompare(a.completed_on) || b.created_at.localeCompare(a.created_at) : state.view === 'trash' ? b.deleted_at.localeCompare(a.deleted_at) : b.created_at.localeCompare(a.created_at));
  }
  function updateLocal(idea) {
    const index = state.ideas.findIndex(row => row.id === idea.id);
    if (index < 0) state.ideas.unshift(idea); else state.ideas[index] = idea;
    render();
  }
  function notify(message, undoAction = null, login = false) {
    clearTimeout(state.notificationTimer); state.undo = undoAction;
    const notification = $('#notification'); $('span', notification).textContent = message;
    $$('a', notification).forEach(el => el.remove());
    if (login) notification.append(link('ログインし直す', `${root}login?next=${encodeURIComponent(location.pathname)}`, 'text-link'));
    $('#undo').hidden = !undoAction; notification.hidden = false;
    if (undoAction) state.notificationTimer = setTimeout(() => { $('#undo').hidden = true; state.undo = null; }, 10000);
  }
  function report(error) { notify(error.message, null, error.login); }
  async function patch(idea, data, control) {
    if (control) busy(control, true);
    try {
      const response = await api(`/${idea.id}`, { method: 'PATCH', data: { ...data, version: idea.version } });
      updateLocal(response.idea); return response.idea;
    } catch (error) { report(error); if (error.conflict) await load(); return null; }
    finally { if (control) busy(control, false); }
  }
  async function move(idea, action, control) {
    busy(control, true);
    try {
      const response = await api(`/${idea.id}/${action}`, { method: 'POST', data: { version: idea.version } });
      updateLocal(response.idea);
      if (action === 'trash') notify('ゴミ箱に移しました。30日間は戻せます。', async () => {
        const current = state.ideas.find(row => row.id === response.idea.id);
        if (current) await move(current, 'restore', $('#undo'));
      });
      else { $('#notification').hidden = true; state.undo = null; }
      $('#result-count').focus({ preventScroll: true });
    } catch (error) { report(error); if (error.conflict) await load(); }
    finally { busy(control, false); }
  }
  function card(idea) {
    const article = node('article', 'idea-card'); article.dataset.id = idea.id;
    const heading = node('div', 'card-heading'), title = node('h2', 'card-title');
    if (state.view === 'trash') title.textContent = idea.title;
    else { const open = link(idea.title, `?view=${state.view}&open=${encodeURIComponent(idea.id)}`); open.addEventListener('click', event => { event.preventDefault(); openEditor(idea); }); title.append(open); }
    heading.append(title);
    if (state.view !== 'trash') {
      const favorite = button('', 'heart', 'icon-button'); favorite.setAttribute('aria-label', `${idea.title}のお気に入りを${idea.favorite ? '解除' : '登録'}`); favorite.setAttribute('aria-pressed', String(idea.favorite));
      favorite.dataset.action = 'favorite'; favorite.addEventListener('click', async () => { await patch(idea, { favorite: !idea.favorite }, favorite); focusAfterRender(idea.id, 'favorite'); }); heading.append(favorite);
    }
    article.append(heading);
    const image = state.view === 'archive' ? idea.memory_photo_url || idea.idea_photo_url : idea.idea_photo_url;
    if (image) article.append(photo(image, idea.title, 'card-photo'));
    const note = state.view === 'archive' ? idea.memory || idea.note : idea.note;
    if (note) article.append(node('p', 'card-note', note));
    if (idea.completed_on) article.append(node('p', 'card-date num', `${dayLabel(idea.completed_on)} の思い出`));
    const meta = metadata(idea); if (meta.childNodes.length) article.append(meta);
    const bottom = node('div', 'card-bottom'), actions = node('div', 'card-actions');
    if (state.view === 'trash') {
      const restore = button('元に戻す', 'back'); restore.addEventListener('click', () => move(idea, 'restore', restore));
      const days = Math.max(0, Math.ceil((Date.parse(idea.deleted_at) + 30 * DAY - Date.now()) / DAY));
      bottom.append(restore, node('span', 'muted', `あと${days}日`));
    } else {
      if (state.view === 'archive') {
        const unarchive = button('行きたいに戻す', 'back', 'button quiet'); unarchive.addEventListener('click', async () => { await patch(idea, { completed_on: null }, unarchive); $('#result-count').focus({ preventScroll: true }); }); bottom.append(unarchive);
      } else {
        const complete = button('行ってきた', 'check', 'button completion-button'); complete.dataset.action = 'complete'; complete.addEventListener('click', () => openEditor(idea, 'complete')); bottom.append(complete);
      }
      const edit = button('', 'edit', 'icon-button'); edit.setAttribute('aria-label', `${idea.title}を編集`); edit.addEventListener('click', () => openEditor(idea));
      const trash = button('', 'trash', 'icon-button'); trash.setAttribute('aria-label', `${idea.title}をゴミ箱へ`); trash.addEventListener('click', () => move(idea, 'trash', trash));
      actions.append(edit, trash); bottom.append(actions);
    }
    article.append(bottom); return article;
  }
  function focusAfterRender(id, action) {
    const target = $(`[data-id="${id}"] [data-action="${action}"]`) || $('#result-count');
    target.focus({ preventScroll: true });
  }
  function render() {
    for (const item of $$('[data-view]')) { if (item.dataset.view === state.view) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); }
    const counts = { ideas: 0, archive: 0, trash: 0 };
    for (const idea of state.ideas) {
      if (idea.deleted_at) { if (Date.parse(idea.deleted_at) + 30 * DAY > Date.now()) counts.trash++; }
      else counts[idea.completed_on ? 'archive' : 'ideas']++;
    }
    for (const element of $$('[data-count]')) element.textContent = String(counts[element.dataset.count]);
    const result = filtered();
    const list = $('#idea-list'); list.replaceChildren(...result.map(card)); list.setAttribute('aria-busy', String(state.loading));
    const invalidBudget = !filters.checkValidity() || (filters.elements.min.value && filters.elements.max.value && Number(filters.elements.min.value) > Number(filters.elements.max.value));
    $('#result-count').textContent = invalidBudget ? '予算の下限・上限を確認してください。' : `${result.length}件${state.stale ? '（前回の表示です）' : ''}`;
    $('#result-count').tabIndex = -1;
    $('#empty-state').hidden = !state.loaded || result.length > 0 || state.stale;
    const anyFilter = filters.elements.q.value || filters.elements.place.value || filters.elements.min.value || filters.elements.max.value || isFavoriteFilter() || $$('[name="season"]:checked', filters).length;
    const extraCount = Number(Boolean(filters.elements.place.value)) + Number(Boolean(filters.elements.min.value || filters.elements.max.value)) + Number(Boolean($$('[name="season"]:checked', filters).length));
    $('#filter-count').textContent = extraCount ? ` (${extraCount})` : '';
    $('#empty-title').textContent = anyFilter ? 'A little change of plans?' : state.view === 'ideas' ? 'Our next little adventure' : state.view === 'archive' ? 'Our memories start here' : 'Nothing left behind';
    $('#empty-copy').textContent = anyFilter ? '条件に合う案はまだありません。少し条件を変えてみよう。' : state.view === 'ideas' ? '最初の「行ってみたい」を書いてみよう。' : state.view === 'archive' ? '「行ってきた」を押すと、ここに思い出が残ります。' : 'ゴミ箱は空です。削除した案は30日間、ここから戻せます。';
    const emptyAction = $('#empty-action'); emptyAction.hidden = !anyFilter && state.view !== 'ideas'; emptyAction.replaceChildren(...(anyFilter ? [] : [icon('plus')]), document.createTextNode(anyFilter ? '条件をクリア' : 'デート案を追加する'));
    $('#trash-note').hidden = state.view !== 'trash';
    $('#random-button').hidden = state.view !== 'ideas'; $('#random-button').disabled = !state.loaded || !result.length || state.loading || state.stale;
    $('#random-button').title = !result.length ? '絞り込み条件に合う案を追加してください' : '表示中の案からランダムに選ぶ';
  }
  async function load() {
    if (state.loading) return;
    state.loading = true; $('#idea-list').setAttribute('aria-busy', 'true'); busy($('#refresh'), true); $('#load-error').hidden = true;
    try {
      const response = await api(); state.ideas = response.ideas; state.loaded = true; state.stale = false; state.lastLoaded = Date.now();
    } catch (error) {
      state.stale = true; $('#load-error').hidden = false; $('p', $('#load-error')).textContent = error.message;
      $$('a', $('#load-error')).forEach(el => el.remove());
      if (error.login) $('#load-error').append(link('ログインし直す', `${root}login?next=${encodeURIComponent(location.pathname)}`, 'text-link'));
    } finally { state.loading = false; busy($('#refresh'), false); render(); }
  }
  function clearFilters() { filters.reset(); $('#favorite-filter').setAttribute('aria-pressed', 'false'); serializeURL(); render(); }
  function setView(view) { state.view = view; serializeURL(); render(); }
  function resetPreviews() {
    for (const value of Object.values(state.previewUrls)) URL.revokeObjectURL(value);
    state.previewUrls = {};
    state.removedPhotos.clear();
    for (const feedback of $$('[data-photo-feedback]')) feedback.hidden = true;
    for (const kind of ['idea', 'memory']) { const preview = $(`#${kind}-photo-preview`); preview.hidden = true; $('img', preview)?.remove(); }
  }
  function previewImage(kind, url) {
    const preview = $(`#${kind}-photo-preview`);
    let img = $('img', preview);
    if (!img) { img = node('img'); img.width = 160; img.height = 120; img.alt = kind === 'idea' ? 'デート案の写真' : '思い出の写真'; preview.prepend(img); }
    img.src = url; preview.hidden = false;
  }
  function openEditor(idea = null, mode = 'edit') {
    if (editor.open) return;
    form.reset(); resetPreviews(); state.editing = idea ? { ...idea } : null; state.mode = mode; state.dirty = false;
    form.dataset.mode = mode; $('#editor-conflict').hidden = true; $('#editor-error').textContent = '';
    for (const field of ['title', 'note', 'place', 'reference_url', 'memory', 'budget', 'completed_on']) form.elements[field].value = idea?.[field] ?? '';
    form.elements.favorite.checked = idea?.favorite ?? false;
    for (const input of $$('[name="season"]', form)) input.checked = idea?.seasons.includes(input.value) ?? false;
    form.elements.completed_on.max = todayJST();
    const showMemory = mode === 'complete' || Boolean(idea?.completed_on);
    $('#memory-fields').hidden = !showMemory; form.elements.completed_on.required = showMemory;
    if (mode === 'complete') form.elements.completed_on.value = todayJST();
    for (const kind of ['idea', 'memory']) if (idea?.[`${kind}_photo_url`]) { previewImage(kind, idea[`${kind}_photo_url`]); }
    $('#editor-heading').textContent = mode === 'complete' ? 'A day to remember' : idea ? 'A little plan' : 'A new idea';
    $('#editor-caption').textContent = mode === 'complete' ? idea.title : idea ? '気になることを、少しずつ書き足そう。' : 'タイトルだけでも、気軽に。';
    $('#save-idea').textContent = mode === 'complete' ? '思い出に残す' : '保存する';
    editor.showModal();
    (mode === 'complete' ? form.elements.completed_on : form.elements.title).focus();
  }
  function requestClose() {
    if ($('#save-idea').disabled) return;
    if (state.dirty) { $('#confirm-dialog').showModal(); $('#keep-editing').focus(); }
    else editor.close();
  }
  editor.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
  editor.addEventListener('close', () => { resetPreviews(); state.dirty = false; });
  form.addEventListener('input', () => { state.dirty = true; });
  form.addEventListener('change', () => { state.dirty = true; });
  $('#keep-editing').addEventListener('click', () => $('#confirm-dialog').close());
  $('#discard-edit').addEventListener('click', () => { $('#confirm-dialog').close(); state.dirty = false; editor.close(); });
  for (const dialog of $$('dialog')) {
    for (const close of $$('[data-close]', dialog)) close.addEventListener('click', () => dialog === editor ? requestClose() : dialog.close());
    dialog.addEventListener('click', event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) { if (dialog === editor) requestClose(); else dialog.close(); } });
  }
  window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  for (const kind of ['idea', 'memory']) {
    const input = form.elements[`${kind}_photo`];
    $(`[data-remove-photo="${kind}"]`).addEventListener('click', () => {
      input.value = ''; input.setCustomValidity('');
      state.removedPhotos.add(kind); state.dirty = true;
      if (state.previewUrls[kind]) { URL.revokeObjectURL(state.previewUrls[kind]); delete state.previewUrls[kind]; }
      const preview = $(`#${kind}-photo-preview`); preview.hidden = true; $('img', preview)?.remove();
      const feedback = $(`[data-photo-feedback="${kind}"]`);
      feedback.hidden = !state.editing?.[`${kind}_photo_url`];
      (feedback.hidden ? input : $('button', feedback)).focus();
    });
    $(`[data-restore-photo="${kind}"]`).addEventListener('click', () => {
      state.removedPhotos.delete(kind); state.dirty = true;
      $(`[data-photo-feedback="${kind}"]`).hidden = true;
      if (state.editing?.[`${kind}_photo_url`]) previewImage(kind, state.editing[`${kind}_photo_url`]);
      $(`[data-remove-photo="${kind}"]`).focus();
    });
    input.addEventListener('change', () => {
      input.setCustomValidity('');
      const file = input.files[0], preview = $(`#${kind}-photo-preview`);
      if (state.previewUrls[kind]) { URL.revokeObjectURL(state.previewUrls[kind]); delete state.previewUrls[kind]; }
      if (file?.size > 12000000) { input.setCustomValidity('写真は12MB以内で選んでください。'); input.reportValidity(); return; }
      if (file) { const value = URL.createObjectURL(file); state.previewUrls[kind] = value; previewImage(kind, value); state.removedPhotos.delete(kind); $(`[data-photo-feedback="${kind}"]`).hidden = true; }
      else if (!state.removedPhotos.has(kind) && state.editing?.[`${kind}_photo_url`]) { previewImage(kind, state.editing[`${kind}_photo_url`]); }
      else preview.hidden = true;
    });
  }
  $('#all-seasons').addEventListener('click', () => { for (const input of $$('[name="season"]', form)) input.checked = true; state.dirty = true; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const submit = $('#save-idea'); busy(submit, true); $('#editor-error').textContent = '';
    const completed = state.mode === 'complete' || Boolean(state.editing?.completed_on);
    const data = state.mode === 'complete' ? { completed_on: form.elements.completed_on.value, memory: form.elements.memory.value } : {
      title: form.elements.title.value, note: form.elements.note.value, place: form.elements.place.value, reference_url: form.elements.reference_url.value,
      budget: form.elements.budget.value === '' ? null : Number(form.elements.budget.value), favorite: form.elements.favorite.checked,
      seasons: $$('[name="season"]:checked', form).map(input => input.value),
      completed_on: completed ? form.elements.completed_on.value : null, memory: form.elements.memory.value,
    };
    data.version = state.editing?.version ?? 0;
    data.remove_photos = ['idea', 'memory'].filter(kind => state.removedPhotos.has(kind) && (state.mode !== 'complete' || kind === 'memory'));
    const body = new FormData(); body.set('data', JSON.stringify(data));
    for (const kind of ['idea', 'memory']) { const file = form.elements[`${kind}_photo`].files[0]; if (file && !data.remove_photos.includes(kind) && (state.mode !== 'complete' || kind === 'memory')) body.append(`${kind}_photo`, file); }
    try {
      const response = await api(state.editing ? `/${state.editing.id}` : '', { method: state.editing ? 'PATCH' : 'POST', form: body });
      const isNew = !state.editing, celebrate = state.mode === 'complete';
      state.dirty = false; editor.close(); updateLocal(response.idea);
      if (isNew) { clearFilters(); setView('ideas'); }
      if (celebrate) {
        $('#celebration').hidden = false; setTimeout(() => { $('#celebration').hidden = true; }, 2400);
        notify('思い出に残しました。', async () => { const current = state.ideas.find(row => row.id === response.idea.id); if (current) { await patch(current, { completed_on: null }, $('#undo')); $('#notification').hidden = true; } });
      }
      $('#result-count').focus({ preventScroll: true });
    } catch (error) {
      $('#editor-error').textContent = error.message; $('#editor-conflict').hidden = !error.conflict;
      if (error.conflict) await load();
      if (error.login) { const login = link('ログインし直す', `${root}login`, 'text-link'); $('#editor-error').append(' ', login); }
    } finally { busy(submit, false); }
  });
  $('#quick-add').addEventListener('submit', async event => {
    event.preventDefault(); const input = $('#quick-title'), submit = $('button', event.currentTarget);
    $('#quick-error').textContent = ''; busy(submit, true);
    try { const response = await api('', { method: 'POST', data: { title: input.value } }); updateLocal(response.idea); input.value = ''; clearFilters(); setView('ideas'); input.focus(); }
    catch (error) { $('#quick-error').textContent = error.message; if (error.login) report(error); }
    finally { busy(submit, false); }
  });
  $('#open-editor').addEventListener('click', () => openEditor());
  $('#empty-action').addEventListener('click', () => { const hasFilter = new URL(location.href).searchParams.size > (state.view === 'ideas' ? 0 : 1); if (hasFilter) clearFilters(); else openEditor(); });
  $('#view-nav').addEventListener('click', event => { const target = event.target.closest('[data-view]'); if (target) { event.preventDefault(); setView(target.dataset.view); } });
  filters.addEventListener('submit', event => event.preventDefault());
  let filterTimer;
  filters.addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => { serializeURL(); render(); }, 200); });
  filters.addEventListener('change', () => { clearTimeout(filterTimer); serializeURL(); render(); });
  $('#favorite-filter').addEventListener('click', () => { $('#favorite-filter').setAttribute('aria-pressed', String(!isFavoriteFilter())); serializeURL(); render(); });
  $('#toggle-filters').addEventListener('click', () => { const expanded = $('#extra-filters').hidden; $('#extra-filters').hidden = !expanded; $('#toggle-filters').setAttribute('aria-expanded', String(expanded)); });
  $('#clear-filters').addEventListener('click', clearFilters);
  $('#refresh').addEventListener('click', load); $('#retry').addEventListener('click', load);
  $('#undo').addEventListener('click', async () => { const action = state.undo; if (!action) return; clearTimeout(state.notificationTimer); state.undo = null; busy($('#undo'), true); try { await action(); } finally { busy($('#undo'), false); } });
  $('#dismiss-notification').addEventListener('click', () => { $('#notification').hidden = true; state.undo = null; clearTimeout(state.notificationTimer); });
  function chooseRandom() {
    let options = filtered(); if (!options.length || state.view !== 'ideas') return;
    if (options.length > 1 && state.random) options = options.filter(idea => idea.id !== state.random.id);
    const array = new Uint32Array(1); crypto.getRandomValues(array); const ceiling = Math.floor(4294967296 / options.length) * options.length;
    while (array[0] >= ceiling) crypto.getRandomValues(array);
    const idea = options[array[0] % options.length]; state.random = idea;
    const result = $('#random-result'); result.replaceChildren(node('h3', '', idea.title));
    if (idea.idea_photo_url) result.append(photo(idea.idea_photo_url, idea.title, 'card-photo'));
    if (idea.note) result.append(node('p', '', idea.note)); result.append(metadata(idea));
    $('#reroll').disabled = filtered().length < 2;
  }
  $('#random-button').addEventListener('click', () => { chooseRandom(); if (state.random) $('#random-dialog').showModal(); });
  $('#reroll').addEventListener('click', chooseRandom);
  $('#random-open').addEventListener('click', () => { $('#random-dialog').close(); if (state.random) openEditor(state.random); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !editor.open && Date.now() - state.lastLoaded > 60000) load(); });
  window.addEventListener('focus', () => { if (!editor.open && Date.now() - state.lastLoaded > 60000) load(); });
  const extra = Boolean(filters.elements.place.value || filters.elements.min.value || filters.elements.max.value || $$('[name="season"]:checked', filters).length);
  $('#extra-filters').hidden = !extra; $('#toggle-filters').setAttribute('aria-expanded', String(extra));
  load().then(() => { const id = url.searchParams.get('open'); if (id) { const idea = state.ideas.find(row => row.id === id && !row.deleted_at); if (idea) openEditor(idea); } });
}
if (document.body.dataset.page === 'home') home();
if (document.body.dataset.page === 'ideas') ideasApp();
