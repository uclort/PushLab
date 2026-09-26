# PushLab

**PushLab** 是一个基于 [Electrobun](https://github.com/blackboardsh/electrobun) 的 macOS APNs 推送调试工具，用于向指定设备发送 Apple Push Notification Service 测试推送，并快速定位凭据、环境、Token、Payload 或请求参数问题。

## 背景

APNs 调试通常发生在 iOS / macOS App 开发过程中。开发者需要在开发环境、生产环境、不同 Bundle ID、不同设备 Token、不同 Payload 结构之间反复切换，并确认客户端证书或 Auth Key 是否可用。

本项目参考了开源工具 [SmartPush](https://github.com/shaojiankui/SmartPush) 的核心工作流，重新实现为现代跨平台桌面应用架构。SmartPush 是一个经典且实用的 macOS APNs 调试工具，其原实现基于 AppKit、Keychain 和 `NSURLSession`，详细迁移分析和核心链路拆解见 [`docs/SMARTPUSH_ANALYSIS.md`](docs/SMARTPUSH_ANALYSIS.md)。

## 参考项目

- [SmartPush](https://github.com/shaojiankui/SmartPush)
  - 核心参考项目，提供 APNs 推送调试的核心工作流和证书使用思路。
- [Electrobun](https://github.com/blackboardsh/electrobun)
  - 本项目使用的桌面应用框架，负责窗口、WebView、原生菜单、构建与打包。

## 功能

### 认证方式

- **macOS 钥匙串**
  - 自动读取包含私钥的 Apple 推送证书
  - 显示证书名称、环境、Bundle ID、Team ID、组织、创建时间、过期时间和指纹
  - 直接使用钥匙串中的证书身份完成 TLS 客户端认证
  - 私钥不导出、不持久化
- **证书文件**
  - 支持 `.p12` / `.pfx` / `.pem` / `.cer`
  - 支持独立私钥文件
  - 支持证书密码
  - 显示证书关键信息
- **Auth Key**
  - 支持 `.p8`
  - 支持 Team ID / Key ID
  - 使用 ES256 生成 Provider Token

### 推送配置

- APNs 开发环境 / 生产环境切换
- Bundle ID 自动从证书反显，不允许手动编辑，避免误改导致发送失败
- Device Token 自动清理空格和尖括号
- Device Token 历史记录，最多 10 条，支持清空
- Push Type：
  - `alert`
  - `background`
  - `voip`
  - `liveactivity`
  - `complication`
  - `fileprovider`
  - `mdm`
  - `pushtotalk`
  - `location`
- Priority 5 / 10
- Collapse ID
- Expiration

### Payload

- 默认模板
- 后台静默推送模板
- Live Activity 更新模板
- JSON 格式化
- Payload 大小检查
  - `alert`：4 KB
  - `voip`：5 KB
- 自动校验 JSON 和 `aps` 结构
- 保存最近 50 条 Payload 历史
- 历史去重，重复 Payload 移动到顶部
- 选择历史后恢复对应推送配置
- 支持清空历史

### 发送结果

- HTTP 状态码
- APNs ID
- APNs Host
- 请求耗时
- 常见 APNs 错误类型
- 错误原因
- 建议处理方式
- 本地请求失败与 APNs 错误分类展示
- 网络超时单独分类提示

### 其他

- HTTP/2 直连 APNs
- 中文原生菜单和编辑菜单
- 右键编辑菜单
- 空白区域屏蔽默认 WebView 右键菜单
- 保存非敏感配置
- 私钥内容与证书密码不持久化
- 自定义 PushLab 应用图标

## 项目结构

```text
src/
├── bun/           # 主进程
│   ├── apns.ts    # APNs HTTP/2 请求、TLS、认证与校验
│   ├── keychain.ts # macOS 钥匙串证书枚举
│   └── index.ts   # 窗口、菜单、RPC、历史记录
├── mainview/      # WebView UI
│   ├── index.ts   # 页面逻辑
│   ├── index.html # 页面结构
│   └── index.css  # 页面样式
└── shared/        # 共享类型和错误映射
```

## 开发

安装依赖：

```bash
hutch install
```

启动开发模式：

```bash
hutch run dev
```

运行测试：

```bash
hutch run test
```

构建 macOS arm64 版本：

```bash
hutch run build
```

## 下载

请前往 [Releases](../../releases) 下载 macOS arm64 版本。

当前 Release：

- `PushLab-macos-arm64.dmg`

系统要求：

- macOS Apple Silicon
- 首次使用钥匙串证书发送时，macOS 可能会弹出钥匙串授权窗口

## 说明

- 单独 `.cer` 文件通常不包含私钥，需要同时选择对应 `.key` / `.pem` 私钥文件。
- macOS 钥匙串模式只在 macOS 上可用。
- 本项目仅用于开发和调试 APNs，不提供未经授权批量发送能力。
