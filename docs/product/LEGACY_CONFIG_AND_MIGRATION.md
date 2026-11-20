# Legacy Config and Migration

## পুরোনো শনাক্তকারী ও credential inventory

নিচের inventory বর্তমান cloned workspace `sohojtech/`-এর scan থেকে। এটি পুরোনো production Firebase/Apps Script project স্পর্শ করে না।

| পুরোনো মান/শনাক্তকারী | Exact occurrences |
|---|---|
| `sohojtech-pharmacy` project ID/authDomain/storageBucket | `sohojtech/js/config.js:9-13` পুরোনো ছিল; এখন README অনুযায়ী placeholder। Legacy scan-এ পুরোনো মানগুলো config-এর হার্ডকোডে ছিল। |
| Firebase API key `AIzaSyA7XWSz2nM_24QSabkORPIuJQqRc3IaTFU` | পুরোনো occurrence: `sohojtech/js/config.js:8`; এখন `YOUR_NEW_FIREBASE_API_KEY`। |
| `messagingSenderId: 405516727183` | পুরোনো occurrence: `sohojtech/js/config.js:12`; এখন `YOUR_NEW_MESSAGING_SENDER_ID`। |
| `appId: 1:405516727183:web:044be2b31a7d09f98911fa` | পুরোনো occurrence: `sohojtech/js/config.js:13`; এখন `YOUR_NEW_FIREBASE_APP_ID`। |
| `authDomain: sohojtech-pharmacy.firebaseapp.com` | পুরোনো occurrence: `sohojtech/js/config.js:9`; এখন `mediworld-bd-test.firebaseapp.com`। |
| `storageBucket: sohojtech-pharmacy.firebasestorage.app` | পুরোনো occurrence: `sohojtech/js/config.js:11`; এখন `mediworld-bd-test.firebasestorage.app`। |
| `SohojTech` / `SohojTech Pharmacy` branding | `sohojtech/index.html:6,75,89`; `manifest.json:2-3`; `terms.html:6,22,37,41,108`; `privacy.html:6,22,37,112`; `unsubscribe.html:6,25,41`; `Code.gs:10,261`; `js/config.js:4,34`; `js/modules/reviewPrompt.js:75`; subscription/contact/admin এবং পুরোনো comments। বর্তমান মূল UI/PWA branding MediWorld BD। |
| `Code.gs` endpoint references | `sohojtech/Code.gs` (legacy server script); comments: `js/state.js:5`, `js/api-client.js:1208`, `js/modules/purchase.js:952`, `firestore_ruled.md:240`; এখন নতুন deployment বাস্তবায়নে Apps Script Cloud proxy dependency নেই। |
| `AiProxy.gs` / AI endpoint references | `sohojtech/AiProxy.gs`; comments: `js/modules/admin.js:92`, `js/modules/purchase.js:952`, `js/api-client.js`। পুরোনো AI proxy fallback SaaS architecture অংশ; Slice 1-এর auth scope থেকে সরানো হয়েছে। |

অন্যান্য পুরোনো branding/credential scan exact:

- `sohojtech/terms.html:100` এবং `privacy.html:103`: পুরোনো admin email/মেইল লিংক `nazmul2ahmed@gmail.com` ছিল; এখন `OWNER_EMAIL_FROM_FIREBASE_AUTH` placeholder।
- `sohojtech/AiProxy.gs:96`: পুরোনো `AI_ADMIN_EMAIL` ছিল `nazmul2ahmed@gmail.com`; এখন স্বয়ংক্রিয় admin email binding অপসারণ।
- `sohojtech/firestore_ruled.md:26`: পুরোনো হ্রিত email admin fallback ছিল।
- `sohojtech/js/db-indexeddb.js:9`: পুরোনো `sohojtech-sync-db`; এখন `mediworld-bd-sync-db`।
- `sohojtech/service-worker.js:1,15,21`: পুরোনো cache/SaaS precache references ছিল; cache নাম এখন `mediworld-bd-shell-v1` এবং subscription module precache বাদ।
- `sohojtech/firebase.json:9-10`: legacy Apps Script filenames hosting ignore তালিকায় রাখা, deployed hosting হিসেবে নয়।

## Firebase Console থেকে পুরোনো মান মুছে paste checklist

`sohojtech/js/config.js:7-19` এ নিচের মানগুলো set করুন:

- [ ] `apiKey`: Firebase Console → Project settings → Your apps → Web app → `apiKey`
- [ ] `authDomain`: একই Web app config-এর `authDomain`
- [ ] `projectId`: নতুন Firebase project ID, মানে `mediworld-bd-test`
- [ ] `storageBucket`: Web app config-এর `storageBucket`
- [ ] `messagingSenderId`: Web app config-এর `messagingSenderId`
- [ ] `appId`: Web app config-এর `appId`
- [ ] `OWNER_UID`: Firebase Console → Authentication → Users → Owner-এর exact UID
- [ ] `OWNER_EMAIL`: সেই Owner UID-এর verified Google email

নতুন Firebase Console project তৈরি হলে আগে Google Authentication provider enable ও Authorized domains সেট করুন। একবার Owner provisioning শেষে `owners/{OWNER_UID}` document-এ এই fields লাগবে:

```text
uid: "<OWNER_UID>"
email: "<OWNER_EMAIL>"
role: "owner"
```
