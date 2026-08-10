# Push + Helm APK — FCM IAM unblock (2026-08-04)

## Root cause (proven with Expo receipts)

Expo ticket = OK, but FCM receipt fails:

```
Permission 'cloudmessaging.messages.create' denied on resource
'//cloudresourcemanager.googleapis.com/projects/helm-push-969711'
→ Expo wraps as DeveloperError
```

`check-helm-fcm.sh` only verifies a key **exists** on EAS — not that IAM allows send.

EC2 is healthy: ngrok → `3.209.54.228`, app up, 2 Expo tokens, thousands of in-app `notifications` rows. OS banners fail at FCM IAM.

## Fix (manual, Google Cloud — required)

1. Open [IAM for helm-push-969711](https://console.cloud.google.com/iam-admin/iam?project=helm-push-969711)
2. Find the service account used for FCM V1 (usually `firebase-adminsdk-…@helm-push-969711.iam.gserviceaccount.com`)
3. Grant role: **Firebase Cloud Messaging API Admin** (or Firebase Admin)
4. Enable API: [Firebase Cloud Messaging API](https://console.cloud.google.com/apis/library/fcm.googleapis.com?project=helm-push-969711)
5. Verify:
   ```bash
   node scripts/push-doctor.mjs --token "ExponentPushToken[NK2My_EfWOtxh_jclMdrEj]"
   ```
   Expect `✅ RECEIPT OK` and a phone banner.

If you generate a **new** service-account key, remove the old FCM key in Expo credentials first, then:
`bash scripts/upload-helm-fcm.sh ~/Downloads/*firebase-adminsdk*.json`

## Helm APK / chat UnknownHost

- Live URL (correct): `https://retype-engross-strike.ngrok-free.dev` → EC2
- Phone `UnknownHostException` = DNS on device; open the same URL in Chrome on the phone first
- After APK install: Settings → enable push → "שלח בדיקה"
