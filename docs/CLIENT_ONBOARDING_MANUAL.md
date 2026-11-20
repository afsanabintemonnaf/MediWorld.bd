# MediWorld BD — ক্লায়েন্ট অনবোর্ডিং ম্যানুয়াল

এই নির্দেশিকা নতুন ফার্মেসির মালিক, স্টাফ এবং **SojojTech Pharmacy**-এর Platform Super Admin-এর জন্য। SojojTech Pharmacy MediWorld BD প্ল্যাটফর্মের মালিক ও পরিচালনাকারী; Platform User Management ও billing কেবল তাদের Super Admin পরিচালনা করেন। অনুমোদিত Owner শুধু নিজের ব্যবসার Branch ও Staff পরিচালনা করেন।

অ্যাপের **সহায়তা → আমাদের সম্পর্কে**-এ Platform Owner Info থেকে SojojTech Pharmacy ও যোগাযোগের তথ্য দেখা যায়। মূল workspace-এর ব্যবসা পরিচিতি এবং প্রতিটি invoice-এর শীর্ষে ক্লায়েন্টের establishment name, সংশ্লিষ্ট branch name ও address দেখানো হয়; platform attribution ক্লায়েন্টের ব্যবসায়িক পরিচয়ের বিকল্প নয়।

## ১. লগইন ও আবেদন

1. MediWorld BD URL খুলে **Google দিয়ে লগইন** করুন।
2. প্রথমবার লগইন করলে Platform user request `pending` অবস্থায় তৈরি হবে।
3. pending অবস্থায় ফার্মেসির মূল ফিচার বন্ধ থাকবে। **Settings**-এ Approval / Payment Required বার্তা, ফি ও Client Database Setup Guide দেখা যাবে।
4. আবেদন ও payment যাচাইয়ের জন্য SojojTech Pharmacy Super Admin-এর সঙ্গে যোগাযোগ করুন: **+8801346553350** · `afsanabintemonnaf@gmail.com`।

## ২. ফি ও Super Admin পরিচালনা

SojojTech Pharmacy Super Admin-এর নির্দিষ্ট Platform UID দিয়ে লগইন করলে **ইউজার ম্যানেজমেন্ট** ট্যাব দেখা যায়। নিয়মিত Owner বা Staff এই পেজ দেখতে বা এর handler চালাতে পারেন না।

| চার্জ | পরিমাণ |
|---|---:|
| এককালীন Setup fee | ৳১০,০০০ |
| ঐচ্ছিক Store setup assistance | +৳৫,০০০ (সর্বমোট ৳১৫,০০০) |
| মাসিক Maintenance | ৳১,৫০০/মাস |

Super Admin user card থেকে:

1. **Approve / Accept** দিয়ে আবেদন অনুমোদন করুন। Approval একাই access চালু করে না।
2. ঐচ্ছিক সহায়তা চালু করলে মোট setup fee ৳১৫,০০০ হবে; পরিবর্তিত fee পরিশোধ না হওয়া পর্যন্ত setup payment আবার unpaid থাকবে।
3. যাচাইকৃত এককালীন টাকা **paid** চিহ্নিত করুন। ভুল বা ফেরত payment হলে **unpaid** করুন।
4. **৳১,৫০০ payment record** দিয়ে পেমেন্টের reference/note লিখুন। প্রতিটি payment history-তে থাকবে এবং বৈধতার তারিখ এক মাস বাড়বে।
5. Access পেতে user-এর status `active`, setup fee paid এবং `validUntil` ভবিষ্যতের তারিখ হতে হবে। মেয়াদ পেরোলে `past_due`; unpaid বা pending অবস্থায়ও core features বন্ধ।
6. সমস্যা হলে **Revoke / Suspend** নির্বাচন করে কারণ লিখুন। বাতিলকৃত user-এর access বন্ধ থাকবে; পুনরায় অনুমোদন Super Admin করবেন।

সমস্ত billing action Firestore-এর `platformUsers/{uid}` রেকর্ডে সংরক্ষিত হয়। Owner-এর নিজের ব্যবসার Staff/Branch পরিচালনা এই Platform panel থেকে নয়—সক্রিয় হওয়ার পর Owner-এর **স্টাফ ম্যানেজমেন্ট** থেকে হবে।

## ৩. নিজের Firebase Project তৈরি

Owner অনুমোদনের আগেই Settings-এর **Client Database Setup Guide & Controls**-এ config পূরণ, validation ও connection test করতে পারেন। সেভ করা config এই ডিভাইসের `localStorage`-এ থাকে এবং UI-তে **Super Admin অনুমোদনের অপেক্ষায়** badge দেখায়। Approval, setup fee paid এবং active monthly entitlement না হওয়া পর্যন্ত saved config কার্যকর নয়।

1. [Firebase Console](https://console.firebase.google.com/) থেকে **Create a project** বেছে ফার্মেসির জন্য আলাদা project তৈরি করুন।
2. **Build → Firestore Database → Create database** থেকে Firestore চালু করুন।
3. **Build → Authentication → Get started → Sign-in method → Google** চালু করুন।
4. **Authentication → Settings → Authorized domains**-এ MediWorld app-এর বর্তমান host domain যোগ করুন (যেমন `username.github.io` বা নিজস্ব domain)।
5. **Project settings → Your apps → Web app (`</>`)** থেকে `firebaseConfig` নিন। Owner Settings-এর ছয়টি config field পূরণ করুন: API Key, Auth Domain, Project ID, Storage Bucket, Messaging Sender ID এবং App ID।
6. Settings-এর **সংযোগ টেস্ট** দিয়ে validation করুন। Rules permission error দেখালে Auth domain ও Firestore Rules যাচাই করে আবার টেস্ট করুন।

## ৪. Firestore Rules ও Owner/Staff

1. Project-এ **Firestore Database → Rules** খুলুন।
2. MediWorld `sohojtech/firestore.rules`-এর নিয়ম বসিয়ে **Publish** করুন।
3. Authentication → Users-এ মালিক ও স্টাফের Firebase Auth identity থাকতে হবে। Owner approval সম্পন্ন হলে Super Admin platform owner binding তৈরি করেন।
4. Entitlement সক্রিয় হওয়ার পর Owner নিজের workspace-এ Branch তৈরি ও Staff account/UID যোগ করবেন। প্রতিটি Staff-কে নির্দিষ্ট `assignedBranchIds` এবং প্রয়োজনীয় module permissions দিন।
5. Owner-এর entitlement pending, unpaid, revoked বা expired হলে Owner ও তার Staff-এর ব্যবসায়িক reads/writes Firestore Rules-এও বন্ধ থাকে।

## ৫. Transfer Ledger composite indexes

`js/modules/transfers.js`-এ Ledger দুইটি query চালায়—`sourceBranchId` বা `targetBranchId` দিয়ে `in` filter এবং `createdAt` descending order। তাই `firestore.indexes.json`-এ দুইটি composite index রয়েছে:

- `transfers`: `sourceBranchId` Ascending + `createdAt` Descending
- `transfers`: `targetBranchId` Ascending + `createdAt` Descending

Firebase CLI দিয়ে প্রকাশ করতে project root `sohojtech/` থেকে চালান:

```sh
firebase deploy --only firestore:indexes
```

অথবা Firebase Console → Firestore → **Indexes → Composite → Create index** থেকে দুইটি index তৈরি করুন। Build শেষ হলে Transfer Ledger query কাজ করবে।

## ৬. Owner-এর AI BYOK ও ঐচ্ছিক Apps Script fallback

1. Owner **AI Settings**-এ Gemini, OpenAI বা OpenRouter নির্বাচন করে নিজের API key দিন।
2. **টেস্ট ও সেভ** চাপুন। API key শুধু সেই ডিভাইসের `localStorage`-এ রাখা হয়।
3. AI request প্রথমে নির্বাচিত provider-এ সরাসরি যায়। Direct call ব্যর্থ হলে Owner-এর Apps Script Web App URL, অথবা `APP_CONFIG.aiProxyFallbackUrl`-এ কনফিগার করা optional fallback URL ব্যবহার হবে।
4. Apps Script fallback ব্যবহার করলে `AiProxy.gs` নতুন Apps Script project-এ বসিয়ে **Deploy → New deployment → Web app** করুন; Execute as `Me` এবং access `Anyone` দিন। URL-এর `/exec` অংশ AI Settings-এর ঐচ্ছিক fallback field-এ দিন।
5. কোনো shared/server API key কনফিগার করবেন না। Fallback request-এও কেবল ওই request করা Owner-এর BYOK key যায়; অন্য ব্যবহারকারীর key বা server key ব্যবহৃত হয় না।

## ৭. চালুর আগে যাচাই

- Super Admin approval হয়েছে কি?
- এককালীন ৳১০,০০০ (ঐচ্ছিক store setup থাকলে মোট ৳১৫,০০০) paid কি?
- ৳১,৫০০ মাসিক payment ও `validUntil` সচল কি?
- Firebase Authentication-এ Google ও Authorized domain চালু কি?
- Firestore Rules ও দুইটি Transfer Ledger index deploy হয়েছে কি?
- Owner Settings-এ saved config, approval badge ও connection test ঠিক আছে কি?
- Owner-এর নিজস্ব Branch ও Staff assignment যথাযথ কি?
- AI key নিজের এবং direct provider connection test সফল কি?
