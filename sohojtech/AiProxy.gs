'use strict';

// BYOK-only Apps Script Web App
// Paste this file into a brand-new Apps Script project.
// Deploy: Execute as: Me | Who has access: Anyone

const AI_PROXY_MAX_REQUEST = 2200000;
const AI_PROXY_MAX_IMAGES = 4;
const AI_PROXY_ALLOWED_TASKS = {
  purchaseInvoiceReader: true,
  prescriptionAssist: true,
  dashboardInsight: true,
  connectionTest: true,
};

function doGet(e) {
  return jsonResponse({
    success: true,
    status: 'ok',
    mode: 'BYOK-only',
    cors: 'Apps Script normal CORS response',
    providers: ['gemini', 'openai', 'openrouter'],
    tasks: ['purchaseInvoiceReader', 'prescriptionAssist', 'dashboardInsight', 'connectionTest'],
  });
}

function doPost(e) {
  let requestApiKey = '';
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return aiError('INVALID_REQUEST', 'রিকোয়েস্ট বডি অনুপস্থিত।');
    }
    if (e.postData.contents.length > AI_PROXY_MAX_REQUEST) {
      return aiError('REQUEST_TOO_LARGE', 'রিকোয়েস্টের আকার অনুমোদিত সীমা ছাড়িয়েছে।');
    }

    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return aiError('INVALID_REQUEST', 'অবৈধ JSON রিকোয়েস্ট।');
    }

    const apiKey = String(body.apiKey || (e.headers && (e.headers['X-API-Key'] || e.headers['x-api-key'])) || '').trim();
    requestApiKey = apiKey;
    if (!apiKey) return aiError('MISSING_KEY', 'নিজের API key প্রয়োজন।');

    const task = String(body.task || '');
    if (!AI_PROXY_ALLOWED_TASKS[task]) {
      return aiError('INVALID_TASK', 'এই AI task অনুমোদিত নয়।');
    }

    const provider = String(body.provider || 'gemini').trim().toLowerCase();
    if (!['gemini', 'openai', 'openrouter'].includes(provider)) {
      return aiError('INVALID_PROVIDER', 'Provider Gemini, OpenAI বা OpenRouter হতে হবে।');
    }

    const payload = body.payload || {};
    if (task === 'connectionTest') {
      const response = callProvider(provider, apiKey, 'connectionTest', payload);
      return jsonResponse({ success: true, provider: provider, data: response, message: 'সংযোগ সফল।' });
    }

    validateMediaForTask(task, payload);
    const response = callProvider(provider, apiKey, task, payload);
    return jsonResponse({ success: true, provider: provider, data: response });
  } catch (err) {
    const code = err && err.code ? err.code : 'PROVIDER_ERROR';
    const message = err && err.message
      ? String(err.message).replace(requestApiKey ? new RegExp(requestApiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : /$^/, '[REDACTED]')
      : 'Provider রিকোয়েস্ট ব্যর্থ হয়েছে।';
    return aiError(code, message);
  }
}

// Apps Script Web Apps normally add CORS responses at runtime. This also
// keeps the JSON API shape explicit for non-browser callers.
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function aiError(code, message) {
  return jsonResponse({ success: false, code: code, message: message });
}

function apiKeyFromError(err) {
  return '';
}

function validateMediaForTask(task, payload) {
  if (task === 'dashboardInsight') return;
  const images = task === 'purchaseInvoiceReader'
    ? (payload.imagesBase64 || (payload.imageBase64 ? [payload.imageBase64] : []))
    : (payload.imageBase64 ? [payload.imageBase64] : []);
  if (!Array.isArray(images) || images.length < 1 || images.length > AI_PROXY_MAX_IMAGES) {
    throw makeAiError('INVALID_MEDIA', '১ থেকে ৪টি ছবি বা PDF পাঠাতে হবে।');
  }
  for (const image of images) {
    if (typeof image !== 'string' || !image || image.length > 700000) {
      throw makeAiError('INVALID_MEDIA', 'ছবি/PDF আকার বা ফরম্যাট অনুমোদিত সীমার বাইরে।');
    }
  }
}

function makeAiError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function callProvider(provider, apiKey, task, payload) {
  const prompt = buildPrompt(task, payload);
  let raw;
  if (provider === 'gemini') raw = callGemini(apiKey, prompt);
  else if (provider === 'openai') raw = callOpenAI(apiKey, prompt);
  else raw = callOpenRouter(apiKey, prompt);
  if (task === 'connectionTest') return { connected: true };
  return normalizeJson(raw);
}

function buildPrompt(task, payload) {
  if (task === 'connectionTest') {
    return { text: 'Return only valid JSON: {"connected":true}', media: [] };
  }
  if (task === 'purchaseInvoiceReader') {
    const media = payload.imagesBase64 || (payload.imageBase64 ? [payload.imageBase64] : []);
    return {
      text: `তুমি বিশেষজ্ঞ বাংলাদেশি ফার্মেসি ইনভয়েস OCR। ছবি/inline PDF থেকে শুধু ট্রান্সক্রিপশন করো।
নিজে গুণ/যোগ/ভাগ/হিসাব করবে না। MM/YYYY expiry দাও।
শুধু raw JSON দাও:
{"company_name":null,"invoice_no":null,"invoice_date":null,"invoice_total":null,"items":[
{"brand":"","generic":null,"strength":null,"doseForm":null,"batch_no":null,"expiry_date":null,"unit_type":null,
"invoiced_qty":null,"base_units_per_pack":null,"unit_tp":null,"unit_vat":null,"mrp":null,"line_total_printed":null,"confidence":0}
]}`,
      media: media.map(item => ({ data: item, mimeType: String(payload.mimeType || 'image/jpeg') })),
    };
  }
  if (task === 'prescriptionAssist') {
    return {
      text: `তুমি মেডিকেল prescription handwriting reader। চিকিৎসাগত সিদ্ধান্ত দিও না। শুধু দৃশ্যমান লেখাই ট্রান্সক্রাইব করো।
প্রয়োজন হলে low confidence বা unclear দাও। JSON দাও:
{"patientNotes":null,"doctorNotes":null,"suggestions":[
{"possibleName":"","generic":"","strength":"","doseForm":"","frequencySig":"","duration":"","quantity":null,
"confidence":"high|medium|low","unclear":false,"rawText":""}
]} না পড়া গেলে empty suggestions দাও; অনুমান কোরো না।`,
      media: [{ data: payload.imageBase64, mimeType: String(payload.mimeType || 'image/jpeg') }],
    };
  }
  if (task === 'dashboardInsight') {
    return {
      text: `তুমি ফার্মেসি ব্যবসার বাংলা বোঝায়। নিচের verified deterministic JSON-এ শুধু দেওয়া সংখ্যাই ব্যাখ্যা করবে।
কোনো stock, expiry, profit, margin, due বা total নিজে হিসাব করবে না। অপরিচিত সংখ্যা বানাবে না।
কার্যকরী নিরাপদ পরামর্শ ৬-৭টি বাক্যে দাও।
{"tips":["এক বাক্যে পরামর্শ","..."]}

VERIFIED_DATA=${JSON.stringify(payload.summary || {})}`,
      media: [],
    };
  }
  throw makeAiError('INVALID_TASK', 'এই AI task অনুমোদিত নয়।');
}

function providerHttpError(provider, status, data) {
  const msg = String((data && data.error && (data.error.message || data.error)) || 'Provider ব্যর্থ হয়েছে।');
  if (status === 429) throw makeAiError('RATE_LIMIT', provider + ' rate limit/কোটা শেষ।');
  if (status === 401 || status === 403 || /invalid.*key|api key/i.test(msg)) {
    throw makeAiError('INVALID_KEY', provider + ' API key অবৈধ।');
  }
  throw makeAiError('PROVIDER_ERROR', provider + ' provider error: ' + msg);
}

function parseResponse(resp) {
  const status = resp.getResponseCode();
  let data;
  try { data = JSON.parse(resp.getContentText()); } catch (err) { data = {}; }
  return { status: status, data: data };
}

function callGemini(apiKey, prompt) {
  const model = 'gemini-2.0-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const parts = [{ text: prompt.text }];
  prompt.media.forEach(media => parts.push({ inlineData: { mimeType: media.mimeType, data: media.data } }));
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    muteHttpExceptions: true,
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: parts }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }),
  });
  const result = parseResponse(resp);
  if (result.status < 200 || result.status >= 300) providerHttpError('Gemini', result.status, result.data);
  return result.data.candidates && result.data.candidates[0] &&
    result.data.candidates[0].content && result.data.candidates[0].content.parts &&
    result.data.candidates[0].content.parts.map(p => p.text || '').join('');
}

function callOpenAI(apiKey, prompt) {
  const content = [{ type: 'text', text: prompt.text }];
  prompt.media.forEach(media => {
    content.push({ type: 'image_url', image_url: { url: 'data:' + media.mimeType + ';base64,' + media.data } });
  });
  return callChatCompletions('OpenAI', 'https://api.openai.com/v1/chat/completions', apiKey, 'gpt-4o-mini', content);
}

function callOpenRouter(apiKey, prompt) {
  const content = [{ type: 'text', text: prompt.text }];
  prompt.media.forEach(media => {
    content.push({ type: 'image_url', image_url: { url: 'data:' + media.mimeType + ';base64,' + media.data } });
  });
  return callChatCompletions('OpenRouter', 'https://openrouter.ai/api/v1/chat/completions', apiKey, 'google/gemini-2.0-flash-001', content);
}

function callChatCompletions(providerName, url, apiKey, model, content) {
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      model: model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: content }],
    }),
  });
  const result = parseResponse(resp);
  if (result.status < 200 || result.status >= 300) providerHttpError(providerName, result.status, result.data);
  return result.data.choices && result.data.choices[0] && result.data.choices[0].message &&
    result.data.choices[0].message.content;
}

function normalizeJson(rawText) {
  if (!rawText) throw makeAiError('INVALID_RESPONSE', 'AI থেকে কোনো টেক্সট পাওয়া যায়নি।');
  const cleaned = String(rawText).replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw makeAiError('INVALID_RESPONSE', 'AI রেসপন্স বৈধ JSON নয়।');
  }
}
