# UZ Auto Life — Android ilova (APK)

Bu papka o'yinni Android ilovaga aylantiradi. APK'ni GitHub o'zining serverlarida **bepul** yig'ib beradi (~5–8 daqiqa).

## 1. GitHub'da repo ochish
1. github.com ga kiring (akkaunt: iamanbaev39-byte).
2. O'ng yuqorida **+** → **New repository**.
3. Nomi: `UZAutoLife-android`, **Public** yoki **Private** — farqi yo'q. **Create repository**.

## 2. Fayllarni yuklash
1. Yangi repo sahifasida **uploading an existing file** havolasini bosing.
2. Shu ZIP ichidagi **hamma narsani** (papkalar bilan birga) brauzer oynasiga sudrab tashlang:
   `app`, `.github`, `build.gradle`, `settings.gradle`, `gradle.properties`, `.gitignore`, `README.md`.
3. Pastda **Commit changes** ni bosing.

> ⚠️ `.github` papkasi ko'rinmay qolsa (ba'zi kompyuterlarda nuqta bilan boshlangan papka yashirin bo'ladi):
> **Add file → Create new file**, nomiga `.github/workflows/build-apk.yml` deb yozing va shu fayl ichidagi matnni nusxalab qo'ying → **Commit**.

## 3. APK'ni yig'ish
1. Repo'da yuqoridagi **Actions** bo'limini oching.
2. "APK yigʻish" ishi o'zi boshlanadi (sariq aylana). Boshlanmasa: chapda **APK yigʻish** → **Run workflow**.
3. Yashil ✔ bo'lgach, o'sha ishni oching → pastda **Artifacts** → **UZ-Auto-Life-APK** ni yuklab oling.
4. ZIP ichida `app-debug.apk` — telefonga shuni o'rnating.

## 4. Telefonga o'rnatish
1. `app-debug.apk` ni telefonga o'tkazing (Telegram "Saqlangan xabarlar" orqali qulay).
2. Ochganda "Noma'lum manbalardan o'rnatish" so'raladi → **Ruxsat berish**.
3. Ilova "UZ Auto Life" nomi bilan chiqadi, gorizontal ekranda ishlaydi.

## Play Market uchun (keyinroq)
Play Market `.aab` faylini va **imzo kaliti**ni talab qiladi. Kalit tayyor bo'lganda repo **Settings → Secrets and variables → Actions** ga quyidagilarni qo'shasiz:
`UZ_KEYSTORE_BASE64`, `UZ_KEYSTORE_PASSWORD`, `UZ_KEY_ALIAS`, `UZ_KEY_PASSWORD`.
Shunda Artifacts ichida imzolangan `app-release.aab` ham chiqadi. Kalitni hech kimga bermang va repo'ga yuklamang.

## O'yinni yangilash
O'yin fayllari `app/src/main/assets/www/` ichida. O'zgartirilgan fayllarni o'sha joyga qayta yuklasangiz, Actions yangi APK'ni o'zi yig'adi. Play Market'ga yangi versiya chiqarishda `app/build.gradle` dagi `versionCode` ni 1 taga oshiring.
