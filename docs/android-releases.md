# Releasing an Android update

The Hasanath APK checks `https://hasanath.vercel.app/android/version.json` when
it opens (at most every 6 hours) and offers any newer version in-app.

To ship an update:

1. Raise `android:versionCode` (must go up by at least 1) and `versionName` in
   the Android project's `AndroidManifest.xml`, and the same two numbers in
   `build.sh`. Build and sign with the **same** key (`hasanath-release.jks`).
   Android refuses an update signed with any other key.
2. Copy the signed APK to `public/android/Hasanath-<version>.apk`.
3. Update `public/android/version.json`:
   - `versionCode` / `versionName`: the new numbers
   - `apkUrl`: the new file's URL
   - `sha256`: output of `sha256sum public/android/Hasanath-<version>.apk`
   - `notes`: one change per line, shown in the update dialog
   - `minSupportedVersionCode`: raise it to force an update (no "Later")
     for anyone below that version
4. Commit and push. Phones pick it up the next time the app opens.

Keep older APK files out of the repo once no one needs them.
