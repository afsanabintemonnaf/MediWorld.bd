# Security and Permission Specification

## Single Owner

- একটিমাত্র Super Admin থাকবে: exact manually provisioned UID এবং verified email।
- Google login নিজে কোনো Owner বা staff entitlement দেয় না।
- Owner document: `owners/{ownerUid}`।
- `ownerUid`, `email`, এবং `role == "owner"` তিনটিই মিলতে হবে।
- Owner document/user fields Firebase client থেকে create/update/delete করা যাবে না।
- কোনো email string বা custom claim স্বয়ংক্রিয় promotion source নয়।

## Branch model

```text
branches/{branchId}
staff/{staffUid}
workSessions/{sessionId}
```

`staff/{staffUid}` minimum fields:

- `ownerUid`
- `email`
- `displayName`
- `role`: `manager` বা `cashier`
- `assignedBranchIds`: explicit array
- `permissions`: granular boolean map
- `active`
- `status`

অ্যাসাইনকৃত কোনো branch না থাকলে staff login denied। কোনো branchকে wildcard assignment allowed নয়।

## Permission rules

- Owner: সকল branch ও admin/action।
- Active staff: শুধুমাত্র `assignedBranchIds`-এর branch।
- Manager: Branch inventory/purchase/customer/supplier এবং permission-map অনুযায়ী write।
- Cashier: POS/payment এবং permission-map অনুযায়ী write।
- Sales/audit/transfer create records immutable; update/delete default বন্ধ।
- Work session: নিজ UID-এর session create/update; owner read; staff delete forbidden।
- Firestore rules হলো authority; UI visibility defense-in-depth মাত্র।
