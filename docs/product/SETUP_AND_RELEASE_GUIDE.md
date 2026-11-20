# MediWorld BD — সেটআপ ও রিলিজ গাইড

## ১. Firebase প্রকল্প ও Web App

1. Firebase Console-এ নতুন `mediworld-bd-test` প্রকল্প (অথবা আপনার নির্ধারিত নতুন project ID) খুলুন। পুরোনো `sohojtech-pharmacy` প্রকল্প ব্যবহার করবেন না।
2. Project settings → General → Your apps থেকে Web App তৈরি করে Firebase-এর দেওয়া config-টি `sohojtech/js/config.js`-এর `APP_CONFIG.firebase`-এ বসান:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `storageBucket`
   - `messagingSenderId`
   - `appId`
3. `APP_CONFIG.OWNER_UID`-এ Owner-এর Firebase Authentication UID এবং `APP_CONFIG.OWNER_EMAIL`-এ একই অ্যাকাউন্টের verified email বসান। Config-এ placeholder থাকলে Owner লগইন হবে না।
4. Authentication → Sign-in method-এ Google provider চালু করুন। OAuth-এর অনুমোদিত domain-এ আপনার Hosting domain যোগ করুন।
5. Firestore Database তৈরি করুন। Cloud Functions, billing upgrade বা paid API এই অ্যাপের জন্য আবশ্যক নয়।

## ২. Owner, Branch ও Staff provision

Owner প্রথমে Google দিয়ে লগইন করে Firebase Authentication-এ UID তৈরি করুন। Firestore Console → Data-তে Owner-কে হাতে provision করুন:

```text
owners/{OWNER_UID}
  uid: "{OWNER_UID}"
  email: "{verified Google email}"
  role: "owner"
```

Owner-এর অন্তত একটি Branch তৈরি করুন:

```text
branches/{branchId}
  ownerUid: "{OWNER_UID}"
  name: "প্রধান শাখা"
  active: true
```

প্রতিটি কর্মীর Google Authentication UID অনুযায়ী `staff/{staffUid}` তৈরি করুন। `role` হবে `manager` বা `cashier`; `active: true`, `status: "active"`, `assignedBranchIds: ["branchId"]`, এবং প্রয়োজনমতো `permissions` map দিন। শাখা assignment ফাঁকা রাখবেন না। Google login নিজে Owner বা Staff অনুমতি দেয় না।

## ৩. Rules ও Hosting রিলিজ

`sohojtech/`-কে Firebase CLI project directory হিসেবে ব্যবহার করুন। `.firebaserc`-এ নতুন project ID ঠিক করে নিন, তারপর review শেষে চালান:

```sh
firebase deploy --only firestore:rules,hosting
```

এই কমান্ড এখানে চালানো হয়নি। রিলিজের আগে অবশ্যই `sohojtech/firestore.rules`, project alias, Firebase config, OAuth domain এবং Hosting public directory আবার যাচাই করুন। Hosting-এ শুধুমাত্র নতুন MediWorld BD project ব্যবহার করুন।

## ৪. Offline, queue ও OCR আচরণ

- Firestore persistence এবং app-shell PWA cache অনলাইন অবস্থায় চালু হয়; POS/ক্রয় queue IndexedDB-তে বর্তমান UID ও Branch ID-সহ রাখা হয়।
- Staff-এর queued write sync করার আগে বর্তমান staff assignment, সক্রিয় Branch এবং work session server থেকে পুনরায় যাচাই হয়। Owner/Staff পরিচয় বা Branch আর বৈধ না হলে write আটকে থাকবে—সঠিক অ্যাকাউন্ট/Branch নিয়ে পুনরায় চেষ্টা করুন।
- আগের সংস্করণের এমন queue যেগুলোর UID বা Branch পরিচয় নিরাপদে নির্ধারণ করা যায় না, সেগুলো অন্য পরিচয়ে auto-migrate বা sync করা হবে না। গুরুত্বপূর্ণ legacy entry থাকলে মুছবেন না; release-এর আগে হাতে reconcile করুন।
- Invoice OCR Tesseract.js-কে CDN থেকে প্রথমবার লোড করে এবং `eng+ben` ভাষা ব্যবহার করে; invoice image ব্রাউজারেই process হয়, OCR text/image কোনো AI endpoint-এ পাঠানো হয় না। OCR library/language data প্রথমবার পেতে ইন্টারনেট লাগতে পারে; OCR ব্যর্থ বা offline হলে ম্যানুয়াল purchase entry ব্যবহার করুন।
- OCR কেবল প্রস্তাবিত সারি তৈরি করে। পর্যালোচনা-সারণিতে ব্যবহারকারীর স্পষ্ট সম্মতি ছাড়া তথ্য form-এ যাবে না; form-এ গেলেও stock/payable সেভ হয় না যতক্ষণ না মূল “ক্রয় নিশ্চিত করুন” বোতাম চাপা হয়।

## ৫. Smoke test — production data ছাড়া

1. Test project-এ Owner login, Branch creation/selection এবং Staff assignment যাচাই করুন।
2. Unassigned staff-কে login/branch access দিতে না পারে; assigned staff-কে অনুমোদিত Branch-এ POS ও purchase চালাতে দিন।
3. Browser network offline করে test sale/purchase queue করুন; sync panel-এ status ও Branch দেখুন। Network ফেরার পর সঠিক Branch সক্রিয় করে একবার sync হয়েছে কিনা যাচাই করুন।
4. Staff assignment বন্ধ বা work session শেষ করে reconnect দিন—queued write যেন server-এ না যায়।
5. স্পষ্ট ও ঝাপসা invoice image দিন। OCR ফল edit, catalog suggestion বাছাই, low-confidence flag দেখা, review checkbox ছাড়া apply বন্ধ থাকা এবং apply-এর পরও আলাদা purchase confirmation থাকা যাচাই করুন।
6. OCR library অনুপলব্ধ/offline অবস্থায় ম্যানুয়াল purchase চালিয়ে দেখুন।
7. PWA install, offline shell, reload, service-worker update prompt, print receipt ও Bengali mobile layout পরীক্ষা করুন।
8. Firebase Emulator থাকলে rules tests চালান; deploy-এর আগে `firebase.json` ও Hosting output directory নিশ্চিত করুন।

## সীমাবদ্ধতা ও পরবর্তী যাচাই

- Browser OCR English ও Bengali model-নির্ভর, invoice layout অনুযায়ী extraction অসম্পূর্ণ/ভুল হতে পারে; confidence কেবল সতর্কতার সংকেত, নির্ভুলতার নিশ্চয়তা নয়।
- Tesseract.js ও trained data CDN থেকে আসে। প্রথম download-এ নেটওয়ার্ক দরকার এবং third-party static asset fetch হয়; invoice content পাঠানো হয় না।
- IndexedDB/browser storage স্থায়ী backup নয়; ব্যবহারকারী browser data মুছে ফেললে unsynced entry হারাতে পারে। Queue-র export/restore এখনো আলাদা disaster-recovery ব্যবস্থা নয়।
- আগে অনুমোদিত Branch-এর Firestore তথ্য ওই browser-এ cache হয়ে থাকলে, access revoke হওয়ার মুহূর্তে সম্পূর্ণ offline অবস্থায় cache মুছে ফেলার নিশ্চয়তা নেই। Reconnect হলে নতুন server rules/assignment কার্যকর হবে; shared device-এ screen lock ও sign-out ব্যবহার করুন।
- Rules Emulator, বাস্তব ব্রাউজার, একাধিক tab/device, offline/online race, legacy IndexedDB migration ও OCR invoice corpus-এ QA ছাড়া production release করবেন না।
