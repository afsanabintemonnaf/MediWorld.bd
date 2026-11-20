'use strict';

function renderShortListModule() {
  const c = document.getElementById('short-list-content');
  if (!c) return;
  c.innerHTML = `
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-4">
      <div class="short-list-form grid grid-cols-1 md:grid-cols-[1fr_1fr_2fr_auto] gap-2 items-end">
        <div><label class="block text-xs font-semibold text-slate-500 mb-1">ওষুধের নাম *</label><input id="short-name" placeholder="উদাহরণ: Napa 500 mg" class="w-full border rounded-lg px-3 py-2 text-sm"/></div>
        <div><label class="block text-xs font-semibold text-slate-500 mb-1">কোম্পানি/শক্তি (ঐচ্ছিক)</label><input id="short-context" placeholder="কোম্পানি • শক্তি" class="w-full border rounded-lg px-3 py-2 text-sm"/></div>
        <div><label class="block text-xs font-semibold text-slate-500 mb-1">নোট (ঐচ্ছিক)</label><input id="short-note" placeholder="গ্রাহক/সংলাপ/নির্দেশনা" class="w-full border rounded-lg px-3 py-2 text-sm"/></div>
        <button onclick="addShortListRequest()" class="btn btn-primary btn-sm"><i class="fa-solid fa-plus mr-1"></i>যোগ করুন</button>
      </div>
    </div>
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <div id="short-list-body"></div>
    </div>`;
  renderShortListTable();
}

async function addShortListRequest(existing) {
  if (guardReadOnly()) return;
  const name = existing?.name || document.getElementById('short-name')?.value.trim();
  if (!name) return toast('ওষুধের নাম দিন।', 'w');
  const context = existing?.context || document.getElementById('short-context')?.value.trim() || '';
  const note = existing?.note || document.getElementById('short-note')?.value.trim() || '';
  const normalized = normalizeMedicineDemandName(name);
  const med = APP_STATE.medicines.find(m => normalizedMedicineKey(`${m.brand || ''} ${m.doseForm || ''} ${m.strength || ''}`) === normalizedMedicineKey(name));
  const found = APP_STATE.shortList.find(r => r.status !== 'resolved' && (med?.id && r.medId === med.id || normalizedMedicineKey(r.name) === normalizedMedicineKey(name)));
  let payload = found || null;
  if (found) {
    found.requestCount = (found.requestCount || 1) + 1;
    found.lastRequestedAt = new Date().toISOString();
    found.status = 'open';
    found.context = found.context || context;
    found.note = note ? (found.note ? found.note + '\n' + note : note) : found.note;
  } else {
    const foundObj = {
      id: 'SHORT-' + Date.now(), name:name.trim(), normalizedName: normalized,
      medId: med?.id || '', context, note, status:'open', requestCount:1,
      lastRequestedAt:new Date().toISOString(), branchId:APP_STATE.activeBranchId,
      createdByUid:APP_STATE.currentUser?.uid || null
    };
    APP_STATE.shortList.push(foundObj);
    payload = foundObj;
  }
  const res = await apiSaveShortList(payload);
  if (!res.success) {
    if (found) found.requestCount = Math.max(1, found.requestCount - 1);
    return toast(res.message, 'w');
  }
  document.getElementById('short-name') && (document.getElementById('short-name').value = '');
  document.getElementById('short-context') && (document.getElementById('short-context').value = '');
  document.getElementById('short-note') && (document.getElementById('short-note').value = '');
  toast(found ? 'দাবির সংখ্যা বাড়ানো হয়েছে।' : 'Short List-এ যোগ হয়েছে।', 's');
  renderShortListTable();
}

function normalizedMedicineKey(name) {
  return normalizeMedicineDemandName(name);
}

function renderShortListTable() {
  const box = document.getElementById('short-list-body');
  if (!box) return;
  const list = (APP_STATE.shortList || []).filter(r => r.status !== 'resolved').sort((a,b) => (b.requestCount||0)-(a.requestCount||0) || String(b.lastRequestedAt||'').localeCompare(String(a.lastRequestedAt||'')));
  if (!list.length) { box.innerHTML = '<div class="p-8 text-center text-sm text-slate-400">কোনো open customer demand নেই।</div>'; return; }
  box.innerHTML = `<div class="overflow-x-auto"><table class="short-list-table w-full text-sm"><thead class="bg-slate-50 text-[11px] uppercase"><tr><th class="p-3 text-left">ওষুধ</th><th class="p-3 text-center">অনুরোধ</th><th class="p-3 text-left">শেষ অনুরোধ</th><th class="p-3 text-left">নোট</th><th class="p-3 text-center">অ্যাকশন</th></tr></thead><tbody>${list.map(r=>`
    <tr class="border-t"><td class="p-3"><b>${esc(r.name)}</b><div class="text-[11px] text-slate-400">${esc(r.context || '')}</div></td><td class="p-3 text-center font-bold ${r.requestCount>1?'text-red-600':''}">${r.requestCount||1} বার</td><td class="p-3 text-xs">${esc(r.lastRequestedAt ? String(r.lastRequestedAt).replace('T',' ').slice(0,16) : '—')}</td><td class="p-3 text-xs whitespace-pre-wrap">${esc(r.note||'—')}</td><td class="short-list-actions p-3 text-center whitespace-nowrap"><button onclick="incrementShortList('${esc(r.id)}')" class="text-brand text-xs mr-2">+ অনুরোধ</button><button onclick="resolveShortList('${esc(r.id)}')" class="text-emerald-600 text-xs mr-2">Resolved</button><button onclick="removeShortList('${esc(r.id)}')" class="text-red-500 text-xs">মুছুন</button></td></tr>`).join('')}</tbody></table></div>`;
}

async function incrementShortList(id) {
  const r = APP_STATE.shortList.find(x => x.id === id); if (!r) return;
  r.requestCount=(r.requestCount||1)+1; r.lastRequestedAt=new Date().toISOString();
  const res=await apiSaveShortList(r); if(!res.success)return toast(res.message,'w'); renderShortListTable();
}

async function resolveShortList(id) {
  const r = APP_STATE.shortList.find(x => x.id === id); if (!r) return;
  r.status='resolved'; r.resolvedAt=new Date().toISOString();
  const res=await apiSaveShortList(r); if(!res.success)return toast(res.message,'w'); renderShortListTable();
}

async function removeShortList(id) {
  if (!confirm('এই Short List রেকর্ড মুছবেন?')) return;
  const res=await apiDeleteShortList(id); if(!res.success)return toast(res.message,'w');
  APP_STATE.shortList=APP_STATE.shortList.filter(x=>x.id!==id); renderShortListTable();
}
