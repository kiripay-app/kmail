import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(<FluentProvider theme={webLightTheme} style={{ height: "100%" }}><App /></FluentProvider>);
