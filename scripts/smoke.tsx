import { renderToString } from "react-dom/server";
import { createElement } from "react";
import App from "../src/App";
const html = renderToString(createElement(App));
const must = ["回网同步", "层流台", "放行", "待下一班确认", "审计日志", "原始采样", "AN-5001", "B-005"];
const missing = must.filter((m) => !html.includes(m));
if (missing.length) { console.error("缺少内容:", missing); process.exit(1); }
console.log("首屏渲染正常，关键区块齐全（长度", html.length, "）");
