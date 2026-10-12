(() => {
  const toggle = document.querySelector('.theme-toggle');
  const syncLabel = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    if (toggle) {
      toggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
      toggle.setAttribute('title', `Switch to ${dark ? 'light' : 'dark'} theme`);
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#182126' : '#f2f5f7');
  };
  syncLabel();
  toggle?.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('jinyuan-theme', theme); } catch (_) {}
    syncLabel();
  });
  const header = document.querySelector('.site-header');
  const setHeader = () => header?.classList.toggle('scrolled', window.scrollY > 20);
  window.addEventListener('scroll', setHeader, { passive: true });
  setHeader();
  const sectionLinks = [...document.querySelectorAll('.nav-link[href^="#"]')];
  if ('IntersectionObserver' in window && sectionLinks.length) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) sectionLinks.forEach(link => {
          const active = link.getAttribute('href') === `#${entry.target.id}`;
          link.classList.toggle('active', active);
          if (active) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-15% 0px -60% 0px' });
    sectionLinks.forEach(link => { const section = document.querySelector(link.getAttribute('href')); if (section) observer.observe(section); });
  }
  document.querySelector('#print-cv')?.addEventListener('click', () => window.print());
})();
