(async () => {
  try {
    const response = await fetch('./latest.json', { cache: 'no-store' });
    if (!response.ok) return;
    const release = await response.json();
    const url = new URL(release.url);
    if (url.protocol !== 'https:' || !['voidbelt.com', 'api.voidbelt.com'].includes(url.hostname)) return;
    if (!/^\d+(\.\d+){1,3}$/.test(release.version) || !Number.isFinite(release.size)) return;
    document.querySelector('#download').href = url.href;
    document.querySelector('#release').textContent = `Windows 10 / 11 · 64 bits · v${release.version} · ${Math.round(release.size / 1048576)} Mo`;

    // L'empreinte n'apparait que si le manifeste en annonce une : la page
    // ne peut donc pas afficher celle d'une version deja remplacee.
    const sha = String(release.sha256 || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha)) return;
    document.querySelector('#sha').textContent = `${sha.slice(0, 20)}…${sha.slice(-8)}`;
    document.querySelector('#checksum').hidden = false;

    const copy = document.querySelector('#copy');
    if (!navigator.clipboard) { copy.hidden = true; return; }
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(sha);
        copy.textContent = 'Copié';
        setTimeout(() => { copy.textContent = 'Copier'; }, 2000);
      } catch { copy.textContent = 'Échec'; }
    });
  } catch { /* The static download link stays usable if metadata is unavailable. */ }
})();
