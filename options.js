const $ = id => document.getElementById(id);
function toggleEndpoint() {
  $('endpointLabel').style.display = $('provider').value === 'custom' ? 'block' : 'none';
}
chrome.storage.local.get(['apiKey', 'model', 'focus', 'provider', 'endpoint'], r => {
  $('provider').value = r.provider || 'zhipu';
  $('apiKey').value = r.apiKey || '';
  $('model').value = r.model || '';
  $('endpoint').value = r.endpoint || '';
  $('focus').value = r.focus || '';
  toggleEndpoint();
});
$('provider').addEventListener('change', toggleEndpoint);
$('save').addEventListener('click', () => {
  chrome.storage.local.set({
    provider: $('provider').value,
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim(),
    endpoint: $('endpoint').value.trim(),
    focus: $('focus').value.trim()
  });
  $('msg').textContent = '✓ 已保存';
});
