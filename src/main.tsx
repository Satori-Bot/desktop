import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css";
import "@fontsource-variable/geist";
import "./styles.css";
import App from "./App";
const theme = createTheme({
  primaryColor: "teal",
  primaryShade: 8,
  fontFamily:
    "Geist Variable, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  headings: {
    fontFamily:
      "Geist Variable, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  },
  defaultRadius: "md",
  colors: {
    teal: [
      "#e6faf5",
      "#c5efe4",
      "#9cdece",
      "#6bcdb4",
      "#41be9f",
      "#29b28f",
      "#1ba180",
      "#0b8d70",
      "#047d62",
      "#006c52",
    ],
  },
  components: {
    Button: { defaultProps: { fw: 600 } },
    TextInput: { defaultProps: { size: "md" } },
    Select: { defaultProps: { size: "md" } },
    PasswordInput: { defaultProps: { size: "md" } },
  },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
