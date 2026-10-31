import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { applyTheme, cachedTheme } from "./lib/theme";

applyTheme(cachedTheme());

createApp(App).mount("#app");
