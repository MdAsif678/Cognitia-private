/**
 * Shared page behaviour: scroll reveals, header state and the mobile menu.
 * Content is only hidden for reveal when JS is running (html.js is set inline in <head>),
 * so the page is fully readable if this script fails to load.
 */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initReveal(root: ParentNode = document) {
  const targets = root.querySelectorAll<HTMLElement>('[data-reveal]:not(.in)');
  // Children of a [data-stagger] container rise one after another.
  root.querySelectorAll<HTMLElement>('[data-stagger]').forEach((group) => {
    Array.from(group.children).forEach((child, i) => (child as HTMLElement).style.setProperty('--i', String(i)));
  });
  if (reduceMotion || !('IntersectionObserver' in window)) {
    targets.forEach((t) => t.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  targets.forEach((t) => io.observe(t));
}

function initHeader() {
  const header = document.querySelector<HTMLElement>('.site-header');
  if (!header) return;
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const toggle = header.querySelector<HTMLButtonElement>('.menu-toggle');
  const nav = header.querySelector<HTMLElement>('.nav');
  if (!toggle || !nav) return;
  const close = () => { header.classList.remove('menu-open'); toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', () => {
    const open = !header.classList.contains('menu-open');
    header.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a')) close(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

initHeader();
initReveal();
document.documentElement.classList.add('ready');
