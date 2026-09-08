import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startNativeThemeSync } from "./features/settings/native-theme-sync";
import "./assets/main.css";

createRoot(document.getElementById("root")!).render(<App />);
// R16-AD3 (#241): boots the nativeTheme relay after mount — resolves the
// "System" theme from main's shouldUseDarkColors, mirrors the stored theme
// into themeSource, and keeps live OS updates applied to the root class.
startNativeThemeSync();
