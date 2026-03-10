# DroidLink Android App - Building Instructions

## Quick Start

### Prerequisites
1. **Install Android Studio** (Arctic Fox 2020.3.1 or later)
   - Download from: https://developer.android.com/studio
   - Include Android SDK, SDK Platform, and SDK Build-Tools

2. **Install JDK 8 or later**
   - On macOS: `brew install openjdk@11`
   - On Ubuntu: `sudo apt install openjdk-11-jdk`
   - On Windows: Download from Oracle or use OpenJDK

3. **Set ANDROID_HOME environment variable**
   ```bash
   # On macOS/Linux (add to ~/.bashrc or ~/.zshrc)
   export ANDROID_HOME=$HOME/Library/Android/sdk  # macOS
   export ANDROID_HOME=$HOME/Android/Sdk          # Linux
   export PATH=$PATH:$ANDROID_HOME/tools
   export PATH=$PATH:$ANDROID_HOME/platform-tools

   # On Windows (System Properties > Environment Variables)
   ANDROID_HOME=C:\Users\YourUsername\AppData\Local\Android\Sdk
   ```

### Building with Android Studio

1. **Open the project**
   ```bash
   cd android
   # Launch Android Studio and select "Open an Existing Project"
   # Navigate to the android directory
   ```

2. **Sync Gradle**
   - Android Studio will prompt you to sync Gradle
   - Click "Sync Now" or File > Sync Project with Gradle Files
   - Wait for dependencies to download (first time may take several minutes)

3. **Connect your Android device**
   - Enable Developer Options on your device
   - Enable USB Debugging
   - Connect via USB
   - Accept the debugging prompt on your device

4. **Build and Run**
   - Click the green "Run" button in Android Studio
   - Or use the menu: Run > Run 'app'
   - Select your device from the deployment target dialog

### Building from Command Line

1. **Initialize Gradle Wrapper** (first time only)
   ```bash
   cd android
   gradle wrapper --gradle-version 8.0
   ```

2. **Make gradlew executable** (macOS/Linux)
   ```bash
   chmod +x gradlew
   ```

3. **Build Debug APK**
   ```bash
   ./gradlew assembleDebug
   ```
   Output: `app/build/outputs/apk/debug/app-debug.apk`

4. **Build Release APK** (requires signing)
   ```bash
   ./gradlew assembleRelease
   ```
   Output: `app/build/outputs/apk/release/app-release.apk`

5. **Install directly to device**
   ```bash
   adb devices
   ./gradlew installDebug
   # Or manually:
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

### Building without Android Studio

If you don't have Android Studio but have the Android SDK:

1. **Install Android SDK Command Line Tools**
   - Download from: https://developer.android.com/studio#command-tools
   - Extract to a directory (e.g., `~/android-sdk`)

2. **Install required SDK packages**
   ```bash
   sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
   ```

3. **Set ANDROID_HOME and follow command-line build steps above**

## Build Variants

### Debug Build
- Includes debugging symbols
- Not optimized
- Signed with debug keystore
- Suitable for development and testing

```bash
./gradlew assembleDebug
```

### Release Build
- Optimized and minified (if ProGuard is enabled)
- Requires release keystore for signing
- Suitable for production

```bash
./gradlew assembleRelease
```

## Signing the Release Build

For production release, you need to sign the APK:

1. **Create a keystore** (first time only)
   ```bash
   keytool -genkey -v -keystore droidlink-release.keystore \
     -alias droidlink -keyalg RSA -keysize 2048 -validity 10000
   ```

2. **Create `keystore.properties` file**
   ```properties
   storePassword=your_store_password
   keyPassword=your_key_password
   keyAlias=droidlink
   storeFile=../droidlink-release.keystore
   ```

3. **Build signed release APK**
   ```bash
   ./gradlew assembleRelease
   ```

## Testing the Build

After building and installing:

1. **Launch the app**
   ```bash
   adb shell am start -n com.droidlink.companion/.MainActivity
   ```

2. **Grant permissions** (on device)
   - Allow all requested permissions

3. **Start the service** (tap button in app)

4. **Test data export via ADB**
   ```bash
   adb shell am broadcast -a com.droidlink.EXPORT_CONTACTS \
     --es output_path '/data/local/tmp/.droidlink_contacts.json' \
     -n com.droidlink.companion/.data.DataExportReceiver
   sleep 1
   adb pull /data/local/tmp/.droidlink_contacts.json /tmp/
   cat /tmp/.droidlink_contacts.json | head -c 500
   ```

## Troubleshooting

### "SDK location not found"
Create a `local.properties` file in the android directory:
```properties
sdk.dir=/path/to/your/android/sdk
```

### "Gradle sync failed"
- Check internet connection (Gradle needs to download dependencies)
- Try: `./gradlew clean build --refresh-dependencies`
- Check JDK version: `java -version` (should be 8 or higher)

### Build fails with resource errors
```bash
./gradlew clean
./gradlew assembleDebug
```

### "adb: device not found"
```bash
adb devices
# If device not listed:
# 1. USB debugging enabled on device
# 2. USB cable connected properly
# 3. Accept debugging prompt on device
adb kill-server
adb start-server
```

## Icon Files

The project requires icon files in various resolutions. To generate proper icons:

1. **Create a launcher icon**
   - Use Android Studio: Right-click `res` > New > Image Asset
   - Or use online tools

2. **Required icon files**
   - `res/mipmap-mdpi/ic_launcher.png` (48x48)
   - `res/mipmap-hdpi/ic_launcher.png` (72x72)
   - `res/mipmap-xhdpi/ic_launcher.png` (96x96)
   - `res/mipmap-xxhdpi/ic_launcher.png` (144x144)
   - `res/mipmap-xxxhdpi/ic_launcher.png` (192x192)

## Performance Optimization

### Enable R8/ProGuard for release builds
Edit `app/build.gradle.kts`:
```kotlin
buildTypes {
    release {
        isMinifyEnabled = true
        proguardFiles(
            getDefaultProguardFile("proguard-android-optimize.txt"),
            "proguard-rules.pro"
        )
    }
}
```

## Continuous Integration

### Example GitHub Actions workflow
```yaml
name: Android Build

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up JDK 11
        uses: actions/setup-java@v3
        with:
          java-version: '11'
          distribution: 'temurin'
      - name: Build with Gradle
        run: |
          cd android
          chmod +x gradlew
          ./gradlew assembleDebug
      - name: Upload APK
        uses: actions/upload-artifact@v3
        with:
          name: app-debug
          path: android/app/build/outputs/apk/debug/app-debug.apk
```

## Additional Resources

- [Android Developer Guide](https://developer.android.com/guide)
- [Gradle Build Tool](https://gradle.org/)
- [Kotlin Documentation](https://kotlinlang.org/docs/home.html)
- [Jetpack Compose](https://developer.android.com/jetpack/compose)
