const AI_PROXY_URL = 'https://script.google.com/macros/s/AKfycbwDsU7EaQP2J7F1vWaYuO5nOntu6CTv07xQfX9dFFXpWyFCOkjNkyw9M6XyKucAp4Ey/exec';

async function callAiTask(task, payload) {
  const user = firebase.auth().currentUser;
  if (!user) throw new Error('লগইন করা নেই।');
  if (!['purchaseInvoiceReader', 'prescriptionAssist', 'dashboardInsight'].includes(task)) {
    throw new Error('এই AI task অনুমোদিত নয়।');
  }
  payload = payload || {};
  if (task === 'purchaseInvoiceReader') {
    const images = payload.imagesBase64 || (payload.imageBase64 ? [payload.imageBase64] : []);
    if (!Array.isArray(images) || !images.length || images.length > 4 ||
        images.some(img => typeof img !== 'string' || !img || img.length > 700000)) {
      throw new Error('ছবির সংখ্যা বা আকার অনুমোদিত সীমার বাইরে।');
    }
  } else if (task === 'prescriptionAssist') {
    const image = payload.imageBase64 || '';
    if (!image || image.length > 700000) throw new Error('প্রেসক্রিপশন ছবির আকার অনুমোদিত সীমার বাইরে।');
  }

  const idToken = await user.getIdToken();
  const ownerUid = APP_STATE.tenantUid || user.uid;
  const branchId = APP_STATE.activeBranchId || '';

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 25000) : null;
  let resp;
  try {
    resp = await fetch(AI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ idToken, ownerUid, branchId, task, payload }),
      signal: controller ? controller.signal : undefined,
    });
  } catch (err) {
    throw new Error('AI অনুরোধ টাইমআউট বা নেট সংযোগ সমস্যা; আবার চেষ্টা করুন।');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!resp.ok) throw new Error('AI সার্ভিস সাময়িকভাবে উপলব্ধ নয়।');
  const result = await resp.json();
  if (!result.success) throw new Error(result.message || 'AI সার্ভিস ব্যর্থ হয়েছে।');
  return result;
}

// ✅ Step 3 — নির্দিষ্ট provider সরাসরি টেস্ট করার জন্য (fallback chain বাদ দিয়ে)
async function testAiProviderConnection(providerId) {
  const user = firebase.auth().currentUser;
  if (!user) throw new Error('লগইন করা নেই।');

  const idToken = await user.getIdToken();
  const ownerUid = APP_STATE.tenantUid || user.uid;

  const resp = await fetch(AI_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ idToken, ownerUid, testProvider: providerId }),
  });

  return await resp.json(); // { success, message? }
}

// ব্যবহার উদাহরণ:
// const res = await callAiTask('purchaseInvoiceReader', { imageBase64 });
// console.log(res.data.items);
