set -e
AJ=${ANDROID_JAR:?set ANDROID_JAR to an API 34 android.jar}
rm -rf build && mkdir -p build/res build/gen build/classes build/dex
aapt2 compile --dir res -o build/res/res.zip
aapt2 link -o build/base.apk -I $AJ --manifest AndroidManifest.xml --java build/gen build/res/res.zip --min-sdk-version 23 --target-sdk-version 34 --version-code 1 --version-name 1.0
javac -source 8 -target 8 -bootclasspath $AJ -classpath $AJ -d build/classes -nowarn -Xlint:-options $(find src build/gen -name "*.java")
dalvik-exchange --dex --min-sdk-version=23 --output=build/dex/classes.dex build/classes
cp build/base.apk build/unsigned.apk && (cd build/dex && zip -q -j ../unsigned.apk classes.dex)
zipalign -f -p 4 build/unsigned.apk build/aligned.apk
