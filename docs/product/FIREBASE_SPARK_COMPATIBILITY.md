# Firebase Spark Compatibility

## Deployment

- `sohojtech/firestore.rules`: deployment-ready Firestore rules।
- `sohojtech/firebase.json`: Firebase Hosting এবং Firestore rules config।
- Deploy command: `firebase deploy --only firestore:rules,hosting`
- কোনো Cloud Function প্রয়োজন নেই।
- কোনো paid plan entitlement check নেই।
- কোনো trial/subscription logic নেই।

## Spark-safe design

- Firestore SDK reads/writes এবং rules only।
- Google Authentication।
- Offline persistence browser-side।
- IndexedDB browser-side।
- No Functions triggers, scheduled functions, server secrets বা billing APIs।

## Manual setup

1. নতুন Firebase project (Free/Spark) তৈরি করুন।
2. Web app config `sohojtech/js/config.js`-এ paste করুন।
3. Authentication → Google provider enable করুন।
4. Firebase Console থেকে Owner UID নিয়ে provisioning করুন।
5. Console-এর Firestore Data section-এ তৈরি করুন:
   - `owners/{ownerUid}`: `uid`, `email`, `role`
   - `branches/{branchId}`: `ownerUid`, `name`, `active`
   - `staff/{staffUid}`: Owner UID, email, role, assigned branches, permissions, active/status
6. Firebase CLI দিয়ে rules/hosting deploy করুন।

## Audit and transfer protection

- `audits/*`: signed-in actor create only, update/delete disabled।
- `transfers/*`: actor create, but update/delete disabled; owner read।
