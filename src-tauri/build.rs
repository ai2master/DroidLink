use std::path::Path;

fn main() {
    // 将 Android companion APK 复制到资源目录 (如果存在)
    // Copy Android companion APK to resources directory (if it exists)
    let android_apk = Path::new("../android/app/build/outputs/apk/release/app-release.apk");
    let android_apk_debug = Path::new("../android/app/build/outputs/apk/debug/app-debug.apk");
    let target = Path::new("resources/companion/DroidLinkCompanion.apk");

    // Prefer release APK, fallback to debug
    let source = if android_apk.exists() {
        Some(android_apk)
    } else if android_apk_debug.exists() {
        Some(android_apk_debug)
    } else {
        None
    };

    if let Some(src) = source {
        if let Err(e) = std::fs::copy(src, target) {
            println!("cargo:warning=Failed to copy companion APK: {}", e);
        } else {
            println!("cargo:warning=Companion APK copied from {:?}", src);
        }
    } else {
        // Create a placeholder if APK not built yet (dev mode)
        if !target.exists() {
            println!("cargo:warning=Companion APK not found. Build the Android project first: cd android && ./gradlew assembleRelease");
            let _ = std::fs::create_dir_all(target.parent().unwrap());
            let _ = std::fs::write(target, b"");
        }
    }

    tauri_build::build()
}
