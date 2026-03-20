plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.droidlink.companion"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.droidlink.companion"
        minSdk = 26
        targetSdk = 34

        // =====================================================================
        // Android 版本号管理 / Android Version Number Management
        // =====================================================================
        //
        // Android 有两个版本字段 / Android has two version fields:
        //   - versionCode: 整数，Google Play 强制要求每次发布必须递增。
        //                  Integer, Google Play requires strict increase on each release.
        //                  用于内部比较，用户不可见。
        //                  Used for internal comparison, not visible to users.
        //   - versionName: 字符串，用户可见的版本号显示。
        //                  String, user-facing version display.
        //
        // CI 构建时通过 gradle 属性注入 / CI injects via gradle properties:
        //   gradle assembleRelease -PciVersionCode=42 -PciVersionName="2.0.0.42"
        //
        // 本地开发时使用下方默认值 / Local dev uses defaults below:
        //   versionCode = 2 (本地开发的占位值 / placeholder for local dev)
        //   versionName = "2.0.0" (基础语义版本 / base semantic version)
        //
        // CI 生成规则 / CI generation rules:
        //   versionCode = git commit count (每次提交自动递增 / auto-increments per commit)
        //   versionName = "${BASE_VERSION}.${COMMIT_COUNT}" 例如 "2.0.0.42"
        //
        // @see .github/workflows/build.yml - CI 版本号生成逻辑
        //                                    CI version generation logic
        // @see CompanionVersion.kt - 协议版本号 (与此处的 versionCode/Name 无关)
        //                            Protocol version (independent from versionCode/Name)
        // =====================================================================
        versionCode = (project.findProperty("ciVersionCode") as? String)?.toIntOrNull() ?: 2
        versionName = (project.findProperty("ciVersionName") as? String) ?: "2.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    signingConfigs {
        create("companion") {
            storeFile = file("../droidlink-companion.p12")
            storePassword = "droidlink2024"
            keyAlias = "droidlink-companion"
            keyPassword = "droidlink2024"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("companion")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("companion")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }

    buildFeatures {
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.4"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // AndroidX Core
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")

    // Lifecycle
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.lifecycle:lifecycle-service:2.7.0")

    // Jetpack Compose
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation(platform("androidx.compose:compose-bom:2023.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")

    // Gson for JSON
    implementation("com.google.code.gson:gson:2.10.1")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Testing
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    androidTestImplementation(platform("androidx.compose:compose-bom:2023.10.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
