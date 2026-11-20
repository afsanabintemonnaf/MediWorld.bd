'use strict';

function renderAdminModule() {
  const c = document.getElementById('admin-content');
  if (!c) return;
  if (!APP_STATE.isOwner) {
    c.innerHTML = '<div class="bg-white dark:bg-slate-800 rounded-xl p-8 text-center text-red-500">শুধু Super Admin এই পেজ দেখতে পারবেন।</div>';
    return;
  }
  c.innerHTML = `
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
      <h5 class="text-sm font-semibold mb-3"><i class="fa-solid fa-shield-halved mr-2 text-brand"></i>Super Admin পরিচালনা</h5>
      <p class="text-sm text-slate-500">Owner binding: Firebase UID ও verified email শুধুমাত্র <code>owners/{ownerUid}</code> document থেকে অনুমোদিত।</p>
      <ul class="mt-3 text-sm text-slate-500 list-disc pl-5 space-y-1">
        <li>Staff provisionিং: Firebase Authentication + <code>staff/{staffUid}</code></li>
        <li>প্রতিটি staff-কে explicit <code>assignedBranchIds</code> দিতে হবে</li>
        <li>Branch তৈরি, তথ্য পরিবর্তন, সক্রিয়/নিষ্ক্রিয় করা ও staff assignment <code>টিম</code> ট্যাব থেকে পরিচালনা করুন</li>
        <li>নিষ্ক্রিয় Branch-এর ডেটা মুছে যায় না; Owner Branch selector থেকে সেটি পরিদর্শন করতে পারবেন</li>
      </ul>
    </div>`;
}
