// Apply the saved preference before paint. Storage may be unavailable in private mode.
try {
  const savedTheme = localStorage.getItem('jinyuan-theme');
  document.documentElement.dataset.theme = savedTheme === 'dark' ? 'dark' : 'light';
} catch (_) { document.documentElement.dataset.theme = 'light'; }
