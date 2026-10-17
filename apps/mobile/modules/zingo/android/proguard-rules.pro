# Consumer R8 rules for the zingolib Binding Layer, applied to the app that
# links this module (release builds run with android.enableMinifyInReleaseBuilds).
# The binding AAR carries none of its own.

# UniFFI's generated Kotlin (uniffi.zingo, uniffi.zingo_nym_proxy_ffi) binds
# every native symbol by method name through JNA's Native.register and reads
# RustBuffer / call-status Structure fields reflectively. R8 cannot see either
# use, so without this it renames or strips them and the first binding call
# fails at run time.
-keep class uniffi.** { *; }

# JNA itself: reflective Structure, Callback and native-method lookups.
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# JNA references desktop AWT classes that Android does not ship.
-dontwarn java.awt.**
