document.getElementById('copy-command').addEventListener('click', async () => {
  const status = document.getElementById('copy-status');
  try {
    await navigator.clipboard.writeText(document.getElementById('install-command').textContent);
    status.textContent = 'Installation command copied.';
  } catch {
    status.textContent = 'Could not copy. Select the command above to copy it manually.';
  }
});
