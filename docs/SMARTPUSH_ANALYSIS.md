# SmartPush 核心功能分析与 PushLab 第一版映射

分析基准：SmartPush `3.4`（仓库当前主分支提交 `21441f5`，2024-02-19）与 Electrobun `2.0.1`。

## 1. SmartPush 的真实核心链路

SmartPush 的核心不是“保持一条长连接”，而是下面这条请求链路：

1. 从 macOS Keychain 或 `.cer` 文件取得 `SecCertificateRef`。
2. 使用 `SecIdentityCreateWithCertificate` 在 Keychain 中找到证书对应的私钥，构造客户端身份。
3. 将身份交给 `NSURLSession`，在 TLS Challenge 中返回客户端证书。
4. 向开发或生产 APNs 地址发起 HTTP/2 `POST /3/device/{deviceToken}`。
5. 写入 `apns-topic`、`apns-priority`、`apns-push-type`、可选 `apns-collapse-id` 等请求头。
6. 请求体发送 JSON Payload，根据 HTTP 状态和 APNs `reason` 判断结果。

因此真正不可缺少的输入是：**认证凭据、环境、Topic、Device Token、Push Type、Priority、Payload**。证书下拉框、拖拽、模板和日志都是围绕这条链路的交互能力。

## 2. 原项目功能拆解

| 模块 | SmartPush 行为 | 是否属于核心 | PushLab 第一版 |
| --- | --- | --- | --- |
| 环境 | Sandbox / Production | 是 | 完整保留 |
| 认证 | Keychain 推送证书；可选择 `.cer` | 是 | macOS Keychain + `.p8` Token Auth + `.p12/.pfx/.pem/.cer` Certificate Auth |
| Topic | 从证书扩展字段读取 | 是 | 手动填写，避免跨平台证书解析差异 |
| Device Token | 文本输入并移除空格 | 是 | 保留，并兼容 `<...>` 格式与十六进制校验 |
| Payload | 文本编辑 + 3 个简单模板 | 是 | 保留，增加格式化、模板、JSON/大小校验 |
| Push Type | alert/background/voip 等 | 是 | 保留并补充常用新类型 |
| Priority | 5 / 10 | 是 | 保留；background 强制 5 |
| Collapse ID | 网络层支持但 UI 固定传空 | 有价值 | 第一版直接开放 |
| Expiration | 原项目未开放 | APNs 基础参数 | 第一版开放 |
| 响应 | 成功/失败弹窗和日志 | 是 | 状态码、APNs ID、Reason、Host、耗时 |
| 配置记忆 | Token、Payload、证书路径 | 体验核心 | 保存非敏感配置；证书密码不保存 |
| 拖拽证书 | 自定义 AppKit 控件 | 否 | 使用 Electrobun 原生文件选择器 |
| 帮助页 | 静态说明 | 否 | README 替代 |

## 3. 原实现中需要纠正的点

- `PushViewController` 仍保留旧版 Socket / SecureTransport 状态和“连接/断开”代码，但真正发送已经改为 `NSURLSession` HTTP/2；这部分不是当前发送链路的必要组成。
- 单独 `.cer` 通常只有公钥证书，没有私钥。SmartPush 能发送，是因为它通过证书在 macOS Keychain 中查找对应私钥。跨平台实现不能假设系统 Keychain 中存在私钥，因此 PushLab 对 `.cer` 明确要求额外 `.key/.pem`。
- `loadKeychain` 固定按开发证书读取，环境切换不重新筛选证书；第一版不复制这个行为。
- “连接服务器”按钮实际只准备身份和 Session，并没有验证 APNs 可达性。PushLab 采用一次发送一次连接的明确模型，避免伪连接状态。
- 原项目没有在发送前检查 JSON、Payload 大小、Device Token 格式以及 background/priority 组合；这些校验必须放在主进程信任边界再次执行。
- 原项目仅支持证书认证。PushLab 增加 Apple 当前常用的 `.p8` Provider Token 认证，同时保留证书方式。

## 4. PushLab 第一版架构

```text
WebView UI
  └─ typed RPC
      └─ Electrobun Bun Main Process
          ├─ 本地配置（userData/push-lab-settings.json）
          ├─ 原生凭据文件选择器
          ├─ ES256 Provider Token 签名
          ├─ TLS 客户端证书加载
          └─ node:http2 → APNs
```

- WebView 只负责表单、模板、展示和即时校验。
- macOS 下通过 `security` 读取钥匙串中的有效推送身份，通过系统 Secure Transport/curl 直接使用钥匙串私钥；私钥不可导出且不会进入应用内存。
- 主进程重新校验全部请求，读取凭据并发送，私钥内容不传入 WebView。
- `.p8` 使用 ES256 生成短期 JWT；证书方式通过 HTTP/2 TLS 客户端认证。
- APNs 返回值统一映射为 `PushResult`，UI 不依赖底层异常格式。

## 5. 第一版边界

以下能力不影响单条 APNs 调试的核心闭环，因此暂不加入：

- 批量 Token、发送历史、收藏 Payload；
- APNs 长连接池与并发发送；
- 远程团队凭据同步、云端代理服务；
- Windows/Linux 各发行包签名与自动更新配置。

当前版本已经覆盖 SmartPush 的单条推送核心闭环，并用现代 HTTP/2、Token Auth、严格校验和跨平台凭据模型替换了与 AppKit/Keychain 强绑定的实现。
