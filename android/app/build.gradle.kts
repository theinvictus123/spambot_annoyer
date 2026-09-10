plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dustin.spamcalltimewaster"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.dustin.spamcalltimewaster"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }
}

