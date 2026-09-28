# Tauri 重构记录

日期：2026-09-28

## 重构原则

本次迁移没有在旧桌面框架上做增量替换，而是重新建立 Tauri 工程。旧工程只用于盘点功能、用户数据格式和必要资产，不复用其运行时代码。

## 已移除

- Electrobun 主进程与 WebView RPC
- Bun API、Bun FFI 和 Bun 测试
- Hutch Devkit、锁文件和构建入口
- Sparkle.framework、Updater 辅助应用和 Appcast
- Objective-C 钥匙串动态库
- Electrobun 打包、DMG 和 macOS Bundle 修补脚本
- 旧前端 HTML、CSS 和 TypeScript

## 新实现

- Tauri 2 应用生命周期、窗口、菜单和权限
- Rust APNs HTTP/2 客户端
- Rust ES256 Provider Token
- Rust X.509 解析
- Rust + Security.framework 钥匙串身份读取与 PKCS#12 导出
- TypeScript + Vite 全新前端
- Tauri Updater 与 Minisign 更新签名
- GitHub Actions Release 与 `latest.json`

## 数据兼容

应用标识和三个 JSON 文件名保持不变。迁移不会保存证书密码或私钥内容。

## 发布迁移

Sparkle EdDSA 签名与 Tauri Minisign 更新签名格式不同，不能复用旧私钥。新的 Tauri 私钥保存在开发机的 `~/.tauri/pushlab-updater.key`，密码保存在 macOS 钥匙串。首次 Tauri 版本发布后，后续版本必须持续使用同一把私钥。
