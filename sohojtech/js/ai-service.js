'use strict';

const AI_BYOK_STORAGE_KEY = 'mediworld.byok.ai.v2';

function isAiOwnerAccessAllowed() {
  if (typeof APP_STATE === 'undefined') return true;
  const superAdmin = APP_STATE.isSuperAdmin === true &&
    (typeof isSuperAdminUser !== 'function' || isSuperAdminUser());
  if (superAdmin) return true;
  return APP_STATE.isOwner === true &&
    APP_STATE.isStaffMember !== true &&
    APP_STATE.readOnly !== true &&
    (typeof platformAccessState !== 'function' ||
      platformAccessState(APP_STATE.platformEntitlement).active);
}

function getAiByokConfig() {
  if (!isAiOwnerAccessAllowed()) return null;
  try {
    const raw = localStorage.getItem(AI_BYOK_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function saveAiByokConfig(config) {
  if (typeof guardOwnerOnly === 'function' && guardOwnerOnly()) {
    throw new Error('শুধু মালিক AI BYOK settings সেভ করতে পারবেন।');
  }
  const clean = {
    proxyUrl: String(config.proxyUrl || '').trim(),
    provider: String(config.provider || 'gemini').trim().toLowerCase(),
    apiKey: String(config.apiKey || '').trim(),
  };
  const validation = validateAiByokKey(clean.provider, clean.apiKey);
  if (!validation.valid) throw new Error(validation.message);
  if (clean.proxyUrl && !/^https:\/\/.+/i.test(clean.proxyUrl)) {
    throw new Error('Apps Script proxy URL বৈধ HTTPS URL হতে হবে।');
  }
  localStorage.setItem(AI_BYOK_STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

function getAiProxyFallbackUrl(config) {
  const defaultUrl = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.aiProxyFallbackUrl : '';
  return String(config?.proxyUrl || defaultUrl || '').trim();
}

function clearAiByokConfig() {
  if (typeof guardOwnerOnly === 'function' && guardOwnerOnly()) {
    throw new Error('শুধু মালিক AI BYOK settings reset করতে পারবেন।');
  }
  localStorage.removeItem(AI_BYOK_STORAGE_KEY);
}

function requireAiByokConfig() {
  if (!isAiOwnerAccessAllowed()) {
    throw new Error(`Approval / Payment Required — ${APP_CONFIG.PLATFORM_NAME || 'Platform'} approval ও active billing — AI ব্যবহারের আগে Super Admin অনুমোদন প্রয়োজন।`);
  }
  const config = getAiByokConfig();
  if (!config || !validateAiByokKey(config.provider, config.apiKey).valid) {
    throw new Error('BYOK নয়—AI Settings-এ নিজের API key দিন।');
  }
  return config;
}

function validateAiByokKey(provider, apiKey) {
  const key = String(apiKey || '').trim();
  provider = String(provider || 'gemini').toLowerCase();
  if (!['gemini', 'openai', 'openrouter'].includes(provider)) {
    return { valid: false, message: 'Provider Gemini, OpenAI বা OpenRouter হতে হবে।' };
  }
  if (key.length < 20) return { valid: false, message: 'API key খুব ছোট বা অসম্পূর্ণ।' };
  if (/^(sk-|AIza|sk-or-)/.test(key) || key.length >= 20) {
    return { valid: true, message: 'API key ফরম্যাট গ্রহণযোগ্য।' };
  }
  return { valid: false, message: 'সঠিক API key দিন।' };
}

function normalizeAiMedia(media) {
  return String(media || '').replace(/^data:[^;]+;base64,/, '').trim();
}

async function callDirectProvider(config, task, payload) {
  const prompt = aiPromptForTask(task, payload);
  prompt.signal = payload?.signal;
  const text = prompt.text;
  const media = prompt.media || [];
  if (config.provider === 'gemini') {
    const model = 'gemini-2.0-flash';
    const parts = [{ text }];
    media.forEach(item => parts.push({ inlineData: { mimeType: item.mimeType, data: item.data } }));
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }),
      signal: prompt.signal,
    });
    const data = await response.json();
    if (!response.ok) throw directProviderError(data);
    const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
    return normalizeAiJson(raw);
  }

  const openRouter = config.provider === 'openrouter';
  const content = [{ type: 'text', text }];
  media.forEach(item => content.push({ type: 'image_url', image_url: { url: `data:${item.mimeType};base64,${item.data}` } }));
  const response = await fetch(openRouter ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: openRouter ? 'google/gemini-2.0-flash-001' : 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    }),
    signal: prompt.signal,
  });
  const data = await response.json();
  if (!response.ok) throw directProviderError(data);
  return normalizeAiJson(data.choices?.[0]?.message?.content);
}

function directProviderError(data) {
  const message = String(data?.error?.message || data?.error || 'Provider সংযোগ ব্যর্থ।');
  if (/quota|rate|429/i.test(message)) return new Error('RATE_LIMIT: Provider quota/rate limit শেষ।');
  if (/api.?key|401|403/i.test(message)) return new Error('INVALID_KEY: API key অবৈধ বা অনুমোদিত নয়।');
  return new Error('PROVIDER_ERROR: ' + message);
}

function normalizeAiJson(raw) {
  const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
  if (!cleaned) throw new Error('AI থেকে কোনো টেক্সট পাওয়া যায়নি।');
  try { return JSON.parse(cleaned); } catch (err) { throw new Error('INVALID_RESPONSE: AI রেসপন্স বৈধ JSON নয়।'); }
}

function aiPromptForTask(task, payload) {
  const media = [];
  if (task === 'purchaseInvoiceReader') {
    const images = payload.imagesBase64 || (payload.imageBase64 ? [payload.imageBase64] : []);
    images.forEach(item => media.push({ mimeType: payload.mimeType || 'image/jpeg', data: normalizeAiMedia(item) }));
  } else if (task === 'prescriptionAssist' && payload.imageBase64) {
    media.push({ mimeType: payload.mimeType || 'image/jpeg', data: normalizeAiMedia(payload.imageBase64) });
  }
  let text = '';
  if (task === 'dashboardInsight') text = `নিচের verified deterministic JSON-এর নির্ভরযোগ্য সংখ্যাই ব্যাখ্যা করবে। কোনো হিসাব করবে না বা নতুন সংখ্যা বানাবে না। ৬-৭টি actionable বাংলা পরামর্শ JSON-এ {"tips":["..."]} আকারে দাও। VERIFIED_DATA=${JSON.stringify(payload.summary || {})}`;
  if (task === 'prescriptionAssist') text = 'তুমি prescription handwriting reader। চিকিৎসাগত সিদ্ধান্ত দিও না। দেখা লিখা শুধু ট্রান্সক্রাইব করো। JSON: {"patientNotes":null,"doctorNotes":null,"suggestions":[{"possibleName":"","brand":"","generic":"","strength":"","doseForm":"","frequencySig":"","duration":"","quantity":null,"confidence":"high|medium|low","unclear":false,"rawText":""}]}';
  if (task === 'purchaseInvoiceReader') text = 'তুমি ফার্মেসি ইনভয়েস OCR। নিজে হিসাব করবে না। raw JSON: {"company_name":null,"invoice_no":null,"invoice_date":null,"invoice_total":null,"items":[{"brand":"","generic":null,"strength":null,"doseForm":null,"batch_no":null,"expiry_date":null,"unit_type":null,"invoiced_qty":null,"base_units_per_pack":null,"unit_tp":null,"unit_vat":null,"mrp":null,"line_total_printed":null,"confidence":0}]}';
  if (task === 'connectionTest') text = 'শুধু valid JSON দাও: {"connected":true}';
  return { text, media };
}

async function callAiTask(task, payload) {
  const config = requireAiByokConfig();
  if (!['purchaseInvoiceReader', 'prescriptionAssist', 'dashboardInsight'].includes(task)) {
    throw new Error('এই AI task অনুমোদিত নয়।');
  }
  let directError;
  const directController = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const directTimer = directController ? setTimeout(() => directController.abort(), 30000) : null;
  try {
    // Direct BYOK is the primary path; it requires no Apps Script deployment.
    const direct = await callDirectProvider(config, task, { ...(payload || {}), signal: directController?.signal });
    return { success: true, provider: config.provider, data: direct };
  } catch (err) {
    directError = err;
  } finally {
    if (directTimer) clearTimeout(directTimer);
  }
  const proxyUrl = getAiProxyFallbackUrl(config);
  if (!proxyUrl) throw directError;
  const body = {
    task,
    provider: config.provider,
    apiKey: config.apiKey,
    payload: payload || {},
  };
  let resp;
  const fallbackController = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const fallbackTimer = fallbackController ? setTimeout(() => fallbackController.abort(), 30000) : null;
  try {
    resp = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: fallbackController?.signal,
    });
  } catch (err) {
    throw new Error('AI অনুরোধ টাইমআউট বা নেট সংযোগ সমস্যা; আবার চেষ্টা করুন।');
  } finally {
    if (fallbackTimer) clearTimeout(fallbackTimer);
  }

  let result;
  try {
    result = await resp.json();
  } catch (err) {
    throw new Error('AI proxy থেকে বৈধ রেসপন্স পাওয়া যায়নি।');
  }
  if (!resp.ok || !result.success) {
    throw new Error(result.message || 'AI সার্ভিস ব্যর্থ হয়েছে।');
  }
  return result;
}

async function testAiProviderConnection(providerId) {
  if (typeof guardOwnerOnly === 'function' && guardOwnerOnly()) {
    throw new Error('শুধু মালিক AI BYOK সংযোগ পরীক্ষা করতে পারবেন।');
  }
  const config = getAiByokConfig();
  if (!config || !config.apiKey) {
    throw new Error('নিজের API key দিন।');
  }
  const provider = providerId || config.provider;
  const validation = validateAiByokKey(provider, config.apiKey);
  if (!validation.valid) throw new Error(validation.message);
  let directError;
  try {
    const direct = await callDirectProvider({ ...config, provider }, 'connectionTest', {});
    return { success: true, provider, data: direct, message: 'Provider সংযোগ সফল।' };
  } catch (err) {
    directError = err;
  }
  const proxyUrl = getAiProxyFallbackUrl(config);
  if (!proxyUrl) throw directError;
  const resp = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      task: 'connectionTest',
      provider: providerId || config.provider,
      apiKey: config.apiKey,
      payload: {},
    }),
  });
  const result = await resp.json();
  if (!resp.ok || !result.success) {
    throw new Error(result.message || 'Provider সংযোগ ব্যর্থ।');
  }
  return result;
}
