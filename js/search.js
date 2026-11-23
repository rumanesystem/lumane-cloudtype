/* ================================================================
   채팅 내 검색
================================================================ */

let matches     = [];
let currentIdx  = -1;
let searchOpen  = false;

export function toggleSearch() {
  searchOpen ? closeSearch() : openSearch();
}

function openSearch() {
  searchOpen = true;
  const bar = document.getElementById('searchBar');
  if (!bar) return;
  bar.style.display = 'flex';
  bar.querySelector('#searchInput')?.focus();
}

export function closeSearch() {
  searchOpen = false;
  clearHighlights();
  matches = [];
  currentIdx = -1;
  const bar = document.getElementById('searchBar');
  if (bar) bar.style.display = 'none';
  const inp = document.getElementById('searchInput');
  if (inp) inp.value = '';
  updateCounter(0, 0);
}

export function initSearch() {
  const inp  = document.getElementById('searchInput');
  const prev = document.getElementById('searchPrev');
  const next = document.getElementById('searchNext');
  const cls  = document.getElementById('searchClose');
  if (!inp) return;

  inp.addEventListener('input', () => runSearch(inp.value.trim()));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); step(e.shiftKey ? -1 : 1); }  // 한글 조합 중 Enter 는 글자 확정용
    if (e.key === 'Escape') closeSearch();
  });
  prev?.addEventListener('click', () => step(-1));
  next?.addEventListener('click', () => step(1));
  cls?.addEventListener('click', closeSearch);
}

function runSearch(query) {
  clearHighlights();
  matches = [];
  currentIdx = -1;

  if (!query) { updateCounter(0, 0); return; }

  const bubbles = document.querySelectorAll('#messages .bubble');
  const lq = query.toLowerCase();

  bubbles.forEach(b => {
    const text = b.textContent;
    if (text.toLowerCase().includes(lq)) {
      /* 하이라이트 */
      b.innerHTML = b.innerHTML.replace(
        new RegExp(escReg(query), 'gi'),
        m => `<mark class="search-hl">${m}</mark>`
      );
      const marks = b.querySelectorAll('.search-hl');
      marks.forEach(m => matches.push(m));
    }
  });

  updateCounter(matches.length > 0 ? 1 : 0, matches.length);
  if (matches.length > 0) { currentIdx = 0; scrollToMatch(0); }
}

function step(dir) {
  if (!matches.length) return;
  matches[currentIdx]?.classList.remove('search-hl-active');
  currentIdx = (currentIdx + dir + matches.length) % matches.length;
  matches[currentIdx]?.classList.add('search-hl-active');
  scrollToMatch(currentIdx);
  updateCounter(currentIdx + 1, matches.length);
}

function scrollToMatch(idx) {
  matches[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function clearHighlights() {
  document.querySelectorAll('.search-hl').forEach(el => {
    el.replaceWith(document.createTextNode(el.textContent)); // mark 제거, 텍스트만 남김
  });
}

function updateCounter(cur, total) {
  const el = document.getElementById('searchCount');
  if (el) el.textContent = total > 0 ? `${cur} / ${total}` : (total === 0 && cur === 0 ? '결과 없음' : '');
}

function escReg(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
