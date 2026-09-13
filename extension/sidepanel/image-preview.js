// 全屏图片简历预览窗口：支持切换与关闭。
// 两种数据来源：
//  - { images, index }：临时预览（未保存图片，压缩后的 dataUrl）；
//  - { profileId, imageIndex }：已保存图片 → 直接从 storage.local 读取方案，
//    不经过 storage.session（避免多张/大图超过 session 10MB 配额导致无法打开）。
const PREVIEW_KEY = 'bht_img_preview';

(async () => {
  const stored = (await chrome.storage.session.get(PREVIEW_KEY))[PREVIEW_KEY] || {};
  let images = Array.isArray(stored.images) ? stored.images.filter((i) => i && i.dataUrl) : [];
  let requestedIndex = Number(stored.index) || 0;
  if (!images.length && stored.profileId) {
    try {
      const { bht_resumes: resumes } = await chrome.storage.local.get('bht_resumes');
      const profile = (resumes?.profiles || []).find((p) => p.id === stored.profileId);
      images = Array.isArray(profile?.images) ? profile.images.filter((i) => i && i.dataUrl) : [];
      requestedIndex = Number(stored.imageIndex) || 0;
    } catch (_) {
      // 读取失败则按空列表处理，页面显示「没有可预览的图片」
    }
  }
  let index = Math.min(Math.max(0, requestedIndex), Math.max(0, images.length - 1));

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
