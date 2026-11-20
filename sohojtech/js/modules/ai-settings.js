'use strict';

const AI_PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini', hint: 'Gemini API key', placeholder: 'AIza...' },
  { id: 'openai', label: 'OpenAI', hint: 'OpenAI API key', placeholder: 'sk-...' },
  { id: 'openrouter', label: 'OpenRouter / Compatible', hint: 'OpenRouter বা compatible API key', placeholder: 'sk-or-...' },
];

function renderAiSettingsModule() {
  const c = document.getElementById('aiSettings-content');
  if (!c) return;
  if (!APP_STATE.isOwner) {
    c.innerHTML = '<div class="bg-white dark:bg-slate-800 rounded-xl p-8 text-center border border-red-200 dark:border-red-800"><i class="fa-solid fa-user-shield text-2xl text-red-500 mb-3"></i><p class="text-sm font-semibold text-red-600">শুধু মালিক AI BYOK key ও endpoint দেখতে, সেভ, পরীক্ষা বা reset করতে পারবেন।</p></div>';
    return;
  }

  const config = getAiByokConfig() || { proxyUrl: '', provider: 'gemini', apiKey: '' };
  c.innerHTML = `
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-4">
      <h5 class="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1"><i class="fa-solid fa-user-shield text-brand mr-2"></i>BYOK — নিজের API key</h5>
      <p class="text-[11px] text-amber-700 dark:text-amber-400 mb-4">কোনো shared/server key নেই। নিজের key দিয়ে প্রথমে সরাসরি provider-এ কল হবে; ব্যর্থ হলে নিজের URL অথবা কনফিগার করা optional fallback URL ব্যবহার হবে। key এই ডিভাইসের localStorage-এ থাকে এবং প্রতিটি request-এ কেবল আপনার key পাঠানো হয়।</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-semibold text-slate-500 mb-1">Apps Script Web App URL (ঐচ্ছিক fallback)</label>
          <input id="ai-byok-proxy-url" type="url" value="${esc(config.proxyUrl)}" placeholder="https://script.google.com/macros/s/.../exec"
            class="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"/>
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-500 mb-1">Provider</label>
          <select id="ai-byok-provider" class="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700">
            ${AI_PROVIDERS.map(p => `<option value="${p.id}" ${config.provider === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="mt-3">
        <label class="block text-xs font-semibold text-slate-500 mb-1">নিজের API key</label>
        <div class="flex gap-2">
          <input id="ai-byok-api-key" type="password" value="" placeholder="${esc(AI_PROVIDERS.find(p => p.id === config.provider)?.placeholder || 'API key')}"
            class="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"/>
          <button type="button" onclick="toggleAiByokKeyVisibility()" class="btn-icon" title="দেখুন/লুকান"><i class="fa-solid fa-eye"></i></button>
          <button type="button" onclick="testAndSaveAiByok()" class="btn btn-primary btn-sm whitespace-nowrap"><i class="fa-solid fa-plug mr-1"></i>টেস্ট ও সেভ</button>
        </div>
        ${config.apiKey ? '<p class="text-xs text-emerald-600 mt-2"><i class="fa-solid fa-circle-check mr-1"></i>বর্তমান key local device-এ সেভ করা আছে। নিরাপত্তার জন্য পুরোনো key এখানে দেখানো হয় না।</p>' : '<p class="text-xs text-slate-400 mt-2">Key এখনো সেট করা নেই।</p>'}
        <div id="ai-byok-status" class="text-xs mt-2"></div>
      </div>
      <button type="button" onclick="clearAiByok()" class="btn btn-secondary btn-sm mt-4"><i class="fa-solid fa-trash mr-1"></i>লোকাল key মুছুন</button>
    </div>`;
}

function toggleAiByokKeyVisibility() {
  if (guardOwnerOnly()) return;
  const input = document.getElementById('ai-byok-api-key');
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
}

async function testAndSaveAiByok() {
  if (guardOwnerOnly()) return;
  const status = document.getElementById('ai-byok-status');
  const proxyUrl = document.getElementById('ai-byok-proxy-url')?.value || '';
  const provider = document.getElementById('ai-byok-provider')?.value || 'gemini';
  const apiKey = document.getElementById('ai-byok-api-key')?.value || '';
  if (!apiKey.trim()) { status.innerHTML = '<span class="text-red-500">নিজের API key দিন। সরাসরি সংযোগের জন্য Web App URL দরকার নেই।</span>'; return; }
  status.innerHTML = '<span class="text-slate-500"><i class="fa-solid fa-spinner fa-spin mr-1"></i>সংযোগ যাচাই হচ্ছে...</span>';
  try {
    saveAiByokConfig({ proxyUrl, provider, apiKey });
    const result = await testAiProviderConnection(provider);
    status.innerHTML = `<span class="text-emerald-600"><i class="fa-solid fa-circle-check mr-1"></i>${esc(result.message || 'সংযোগ সফল।')}</span>`;
    document.getElementById('ai-byok-api-key').value = '';
  } catch (err) {
    status.innerHTML = `<span class="text-red-500"><i class="fa-solid fa-circle-xmark mr-1"></i>${esc(humanizeError(err))}</span>`;
  }
}

function clearAiByok() {
  if (guardOwnerOnly()) return;
  clearAiByokConfig();
  toast('লোকাল BYOK key সরানো হয়েছে।', 's');
  renderAiSettingsModule();
}
