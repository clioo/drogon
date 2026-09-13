const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus = false) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) tab.focus();
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const index = tabs.indexOf(tab);
    const target = {ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1}[event.key];
    if (target !== undefined) { event.preventDefault(); selectTab(tabs[target], true); }
  });
}
const copyButton = document.getElementById('copy-command');
const photo = document.getElementById('drogon-photo');
function photoFailed() {
  photo.hidden = true;
  document.getElementById('image-unavailable').hidden = false;
}
photo.addEventListener('error', photoFailed);
if (photo.complete && !photo.naturalWidth) photoFailed();
copyButton.addEventListener('click', async () => {
  const status = document.getElementById('copy-status');
  try {
    await navigator.clipboard.writeText(document.getElementById('install-command').textContent);
    status.textContent = 'Installation command copied.';
  } catch {
    status.textContent = 'Could not copy. Select the command above to copy it manually.';
  }
});
