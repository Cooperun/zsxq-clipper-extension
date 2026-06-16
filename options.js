const $ = id => document.getElementById(id);
chrome.storage.local.get(['apiKey', 'model', 'focus'], r => {
  $('apiKey').value = r.apiKey || '';
  $('model').value = r.model || 'glm-4-flash';
  $('focus').value = r.focus || '';
});
$('save').addEventListener('click', () => {
  chrome.storage.local.set({ apiKey: $('apiKey').value.trim(), model: $('model').value.trim() || 'glm-4-flash', focus: $('focus').value.trim() });
  $('msg').textContent = '✓ 已保存';
});
