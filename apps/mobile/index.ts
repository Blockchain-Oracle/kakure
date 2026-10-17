// The app entry: Web API fills first (the shared packages need them at import time), then Expo Router.
import "./src/lib/polyfills";
import "expo-router/entry";
