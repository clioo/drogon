import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startNativeThemeSync } from "./features/settings/native-theme-sync";
import {
  DataDirRefusalOverlay,
  readDataDirRefusalFromLocation,
} from "./features/shell/DataDirRefusalOverlay";
import "./assets/main.css";

const dataDirRefusal = readDataDirRefusalFromLocation(window.location.search);

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    {/* R16-BP: packaged daemon refused a data dir written by a newer build.
        Rendered above the app shell (which stays in its disconnected state)
        so the refusal reason is the first thing on screen, never a silent
        blank window. */}
    {dataDirRefusal ? <DataDirRefusalOverlay refusal={dataDirRefusal} /> : null}
  </>,
);
// R16-AD3 (#241): boots the nativeTheme relay after mount — resolves the
// "System" theme from main's shouldUseDarkColors, mirrors the stored theme
// into themeSource, and keeps live OS updates applied to the root class.
startNativeThemeSync();
