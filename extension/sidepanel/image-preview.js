// 全屏图片简历预览窗口：从 chrome.storage.session 读取图片列表，支持切换与关闭。
const PREVIEW_KEY = 'bht_img_preview';

(async () => {
  const stored = (await chrome.storage.session.get(PREVIEW_KEY))[PREVIEW_KEY] || {};
  const images = Array.isArray(stored.images) ? stored.images.filter((i) => i && i.dataUrl) : [];
  let index = Math.min(Math.max(0, Number(stored.index) || 0), Math.max(0, images.length - 1));

  const img = document.getElementById('preview');
  const info = document.getElementById('info');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');

  function render() {
    if (!images.length) {
      img.style.display = 'none';
      info.textContent = '没有可预览的图片';
      prevBtn.classList.remove('show');
      nextBtn.classList.remove('show');
      return;
    }
    img.style.display = '';
    img.src = images[index].dataUrl;
    info.textContent = `${index + 1} / ${images.length} · ${images[index].name || ''}`;
    document.title = `图片简历预览 ${index + 1}/${images.length}`;
    const multi = images.length > 1;
    prevBtn.classList.toggle('show', multi);
    nextBtn.classList.toggle('show', multi);
  }

  function step(delta) {
    if (images.length < 2) return;
    index = (index + delta + images.length) % images.length;
    render();
  }

  document.getElementById('closeBtn').addEventListener('click', () => window.close());
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.close();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  render();
})();
