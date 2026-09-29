import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import "./style.css";
import type {
  AuthMode,
  CredentialInfo,
  CredentialKind,
  DeviceTokenHistoryItem,
  Environment,
  KeychainCertificate,
  PayloadHistoryItem,
  PushRequest,
  PushResult,
  PushSettings,
} from "./types";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div class="app-shell">
    <header class="masthead">
      <div class="window-drag-region" data-tauri-drag-region aria-hidden="true"></div>
      <div class="brand">
        <div class="brand-mark">
          <img src="/pushlab-icon.png" alt="" />
          <span class="signal signal-a"></span>
          <span class="signal signal-b"></span>
        </div>
        <div>
          <p class="eyebrow">APPLE PUSH LABORATORY</p>
          <h1>PushLab</h1>
        </div>
      </div>
      <div class="environment-control" role="group" aria-label="APNs 环境">
        <span class="environment-label">APNs 网络</span>
        <div class="segmented">
          <button class="environment-button active" data-environment="development">开发</button>
          <button class="environment-button" data-environment="production">生产</button>
        </div>
      </div>
      <div class="header-status">
        <div id="connection-state" class="connection-state idle">
          <span class="status-dot"></span>
          <div><strong>待机</strong><small>等待发送任务</small></div>
        </div>
        <div id="update-progress" class="update-progress hidden" aria-live="polite">
          <div class="update-progress-text">
            <strong id="update-progress-title">下载更新</strong>
            <small id="update-progress-detail">正在连接更新服务</small>
          </div>
          <div class="update-progress-bar"><span id="update-progress-fill"></span></div>
        </div>
      </div>
    </header>

    <main class="workspace">
      <section class="setup-column">
        <article class="panel credential-panel">
          <div class="panel-heading">
            <div><span class="step-number">01</span><div><p>凭据</p><h2>选择认证方式</h2></div></div>
            <span class="privacy-badge">仅本机读取</span>
          </div>

          <div class="auth-tabs" role="tablist">
            <button class="auth-tab" data-auth="certificate"><span>证书</span><small>.p12 / PEM</small></button>
            <button class="auth-tab" data-auth="keychain"><span>钥匙串</span><small>macOS Identity</small></button>
            <button class="auth-tab active" data-auth="token"><span>Auth Key</span><small>JWT · ES256</small></button>
          </div>

          <div id="token-auth" class="auth-panel">
            <button id="pick-token-key" class="file-drop">
              <span class="file-symbol">KEY</span>
              <span class="file-copy"><strong id="token-key-name">选择 AuthKey.p8</strong><small id="token-key-path">Apple Developer 下载的私钥</small></span>
              <span class="file-action">浏览</span>
            </button>
            <div class="field-grid three">
              <label>Team ID<input id="team-id" autocomplete="off" placeholder="ABCDE12345" /></label>
              <label>Key ID<input id="key-id" autocomplete="off" placeholder="1A2BC3D4E5" /></label>
              <label>Bundle ID<input id="token-topic" autocomplete="off" placeholder="com.example.app" /></label>
            </div>
          </div>

          <div id="keychain-auth" class="auth-panel hidden">
            <label>推送证书
              <div class="inline-picker">
                <select id="keychain-certificate"><option value="">正在读取钥匙串…</option></select>
                <button id="refresh-keychain" class="subtle-button">刷新</button>
              </div>
            </label>
            <p id="keychain-certificate-info" class="field-note">仅显示包含私钥的 Apple 推送证书</p>
          </div>

          <div id="certificate-auth" class="auth-panel hidden">
            <button id="pick-certificate" class="file-drop">
              <span class="file-symbol">CRT</span>
              <span class="file-copy"><strong id="certificate-name">选择客户端证书</strong><small id="certificate-path">支持 .p12 / .pfx / .pem / .cer / .crt</small></span>
              <span class="file-action">浏览</span>
            </button>
            <div class="field-grid two">
              <button id="pick-private-key" class="subtle-button tall">选择独立私钥（可选）</button>
              <label>证书 / 私钥密码<input id="certificate-passphrase" type="password" autocomplete="new-password" placeholder="仅本次使用，不保存" /></label>
            </div>
            <p id="private-key-path" class="field-note"></p>
          </div>

          <div id="credential-details" class="credential-details hidden">
            <div class="credential-title"><span>已载入</span><strong id="credential-title"></strong></div>
            <dl id="credential-fields"></dl>
          </div>
        </article>

        <article class="panel target-panel">
          <div class="panel-heading">
            <div><span class="step-number">02</span><div><p>目标</p><h2>设备与投递参数</h2></div></div>
          </div>

          <label>Device Token
            <textarea id="device-token" rows="3" spellcheck="false" placeholder="粘贴 Token；空格和尖括号会自动清理"></textarea>
          </label>
          <div class="history-row">
            <select id="device-token-history" aria-label="Device Token 历史"><option value="">Token 历史</option></select>
            <button id="clear-device-token-history" class="clear-button" disabled>清空</button>
          </div>

          <div class="field-grid two target-fields">
            <label>Push Type<select id="push-type">
              <option>alert</option><option>background</option><option>voip</option>
              <option>liveactivity</option><option>complication</option>
              <option>fileprovider</option><option>mdm</option>
              <option>pushtotalk</option><option>location</option>
            </select></label>
            <label>Priority<select id="priority"><option value="10">10 · 立即</option><option value="5">5 · 节能</option></select></label>
            <label>Collapse ID<input id="collapse-id" maxlength="64" placeholder="可选" /></label>
            <label>Expiration<input id="expiration" inputmode="numeric" placeholder="0 或 Unix 秒级时间戳" /></label>
          </div>

          <details class="help-drawer">
            <summary>查看全部参数与取值说明</summary>
            <div class="help-list">
              <div><b>Device Token</b><span>64 位十六进制设备令牌；粘贴后自动删除空格和尖括号。</span></div>
              <div><b>环境</b><span>开发：本地开发包和 Sandbox；生产：TestFlight、App Store 包和 Production。</span></div>
              <div><b>Push Type</b><span>指定系统投递行为；Payload 结构和后台限制也会随之变化。</span></div>
              <div class="help-values">
                <b>alert</b><span>可见通知，显示提醒、横幅或通知中心内容。</span>
                <b>background</b><span>后台唤醒，用户不可见；Payload 需包含 content-available，Priority 必须为 5。</span>
                <b>voip</b><span>VoIP 呼叫控制；要求使用专用 VoIP 证书，Payload 上限 5 KB。</span>
                <b>liveactivity</b><span>实时活动更新；Payload 需包含 timestamp、event 和 content-state。</span>
                <b>complication</b><span>表盘复杂功能更新。</span>
                <b>fileprovider</b><span>File Provider 扩展触发的文件同步通知。</span>
                <b>mdm</b><span>MDM 设备管理指令通知。</span>
                <b>pushtotalk</b><span>Push-to-Talk 扩展的通话或频道通知。</span>
                <b>location</b><span>位置相关触发通知。</span>
              </div>
              <div><b>Priority</b><span>10：立即投递，适合可见通知；5：节能模式，适合后台和按系统条件投递。background 只允许 5。</span></div>
              <div><b>Collapse ID</b><span>可选，1 到 64 字符；相同 ID 的待投递消息会被最新一条替换。</span></div>
              <div><b>Expiration</b><span>0 表示设备离线后不保留；留空表示由 APNs 默认处理；填 Unix 秒级时间戳表示保留到该时刻。</span></div>
            </div>
          </details>
        </article>
      </section>

      <section class="work-column">
        <article class="panel payload-panel">
          <div class="panel-heading payload-heading">
            <div><span class="step-number">03</span><div><p>内容</p><h2>编辑 JSON Payload</h2></div></div>
            <span id="payload-size" class="size-meter">0 B / 4 KB</span>
          </div>
          <div class="payload-toolbar">
            <select id="payload-template" aria-label="Payload 模板">
              <option value="default">默认通知</option>
              <option value="simple">简洁通知</option>
              <option value="background">后台静默</option>
              <option value="liveactivity">Live Activity</option>
              <option value="custom" disabled>自定义 / 历史</option>
            </select>
            <select id="payload-history" aria-label="Payload 历史"><option value="">历史消息</option></select>
            <button id="clear-payload-history" class="clear-button" disabled>清空</button>
            <button id="format-json" class="toolbar-button">格式化</button>
          </div>
          <div class="editor-frame">
            <div id="line-gutter" class="line-gutter" aria-hidden="true">1</div>
            <textarea id="payload" spellcheck="false" aria-label="JSON Payload"></textarea>
          </div>
          <div class="editor-footer">
            <span id="payload-error" class="validation-message"></span>
          </div>
        </article>

        <article class="panel result-panel">
          <div class="panel-heading">
            <div><span class="step-number">04</span><div><p>响应</p><h2>APNs 返回结果</h2></div></div>
            <button id="clear-result" class="text-button">清空</button>
          </div>
          <div id="empty-result" class="empty-result">
            <div class="radar"><span></span><i></i></div>
            <div><strong>尚未发送请求</strong><p>APNs 状态码、ID 与诊断建议会显示在这里。</p></div>
          </div>
          <div id="result-content" class="result-content hidden">
            <div class="result-hero">
              <span id="result-icon" class="result-icon"></span>
              <div><strong id="result-title"></strong><small id="result-time"></small></div>
              <code id="result-status"></code>
            </div>
            <dl class="response-grid">
              <div><dt>APNs ID</dt><dd id="result-apns-id">—</dd></div>
              <div><dt>Host</dt><dd id="result-host">—</dd></div>
            </dl>
            <div id="result-error-details" class="error-analysis">
              <div><span>错误类型</span><strong id="result-reason">—</strong></div>
              <div><span>原因</span><p id="result-reason-message">—</p></div>
              <div><span>建议</span><p id="result-reason-suggestion">—</p></div>
            </div>
          </div>
        </article>
      </section>
    </main>

    <div id="preferences-overlay" class="preferences-overlay hidden">
      <section class="preferences-dialog" role="dialog" aria-modal="true" aria-labelledby="preferences-title">
        <div class="preferences-heading">
          <div>
            <p>外观与字体</p>
            <h2 id="preferences-title">偏好设置</h2>
          </div>
          <button id="close-preferences" class="preferences-close" aria-label="关闭偏好设置">×</button>
        </div>

        <div class="preferences-content">
          <div class="preferences-theme-section">
            <div class="preferences-section-heading">
              <b>外观模式</b>
              <span>同时控制 App 内容与 macOS 窗口外观</span>
            </div>
            <div class="theme-mode-grid" role="group" aria-label="外观模式">
              <button type="button" class="theme-mode-option" data-color-mode="system">
                <span class="theme-preview theme-preview-system"><i></i><i></i></span>
                <strong>跟随系统</strong>
                <small>随 macOS 自动切换</small>
              </button>
              <button type="button" class="theme-mode-option" data-color-mode="light">
                <span class="theme-preview theme-preview-light"><i></i></span>
                <strong>浅色</strong>
                <small>始终使用明亮外观</small>
              </button>
              <button type="button" class="theme-mode-option" data-color-mode="dark">
                <span class="theme-preview theme-preview-dark"><i></i></span>
                <strong>深色</strong>
                <small>始终使用深色外观</small>
              </button>
            </div>
          </div>

          <div class="preferences-font-grid">
            <label>界面字体
              <select id="ui-font">
                <option value="avenir">Avenir Next</option>
                <option value="pingfang">苹方</option>
                <option value="system">macOS 系统字体</option>
              </select>
            </label>
            <label>标题字体
              <select id="heading-font">
                <option value="avenir-condensed">Avenir Next Condensed</option>
                <option value="avenir">Avenir Next</option>
                <option value="pingfang">苹方</option>
              </select>
            </label>
            <label>等宽字体
              <select id="mono-font">
                <option value="sfmono">SF Mono</option>
                <option value="menlo">Menlo</option>
                <option value="monaco">Monaco</option>
              </select>
            </label>
          </div>

          <div class="preferences-scale-list">
            <label class="scale-control">
              <span><b>整体字号</b><output id="interface-scale-value">112%</output></span>
              <input id="interface-scale" type="range" min="90" max="135" step="1" value="112" />
            </label>
            <label class="scale-control">
              <span><b>标题字号</b><output id="heading-scale-value">100%</output></span>
              <input id="heading-scale" type="range" min="90" max="135" step="1" value="100" />
            </label>
            <label class="scale-control">
              <span><b>代码编辑器字号</b><output id="code-scale-value">105%</output></span>
              <input id="code-scale" type="range" min="90" max="150" step="1" value="105" />
            </label>
          </div>

          <div class="preferences-preview">
            <span>界面文字预览</span>
            <strong>APNs 推送调试工具</strong>
            <code>{"aps":{"alert":"字体预览"}}</code>
          </div>
        </div>

        <div class="preferences-actions">
          <button id="reset-preferences" class="subtle-button">恢复默认</button>
          <button id="done-preferences" class="toolbar-button">完成</button>
        </div>
      </section>
    </div>

    <footer class="command-bar">
      <div class="command-summary">
        <span>READY TO DISPATCH</span>
        <strong id="send-summary">开发环境 · alert · Priority 10</strong>
        <small id="topic-summary">等待选择 Bundle ID</small>
      </div>
      <button id="send-button" class="send-button">
        <span class="send-orbit"></span>
        <span id="send-button-label">发送到 APNs</span>
      </button>
    </footer>
  </div>
`;

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少界面元素：${id}`);
  return element as T;
};

type ColorMode = "system" | "light" | "dark";

type AppearancePreferences = {
  colorMode: ColorMode;
  uiFont: "avenir" | "pingfang" | "system";
  headingFont: "avenir-condensed" | "avenir" | "pingfang";
  monoFont: "sfmono" | "menlo" | "monaco";
  interfaceScale: number;
  headingScale: number;
  codeScale: number;
};

const appearanceStorageKey = "pushlab-appearance-preferences";
const defaultAppearancePreferences: AppearancePreferences = {
  colorMode: "system",
  uiFont: "avenir",
  headingFont: "avenir-condensed",
  monoFont: "sfmono",
  interfaceScale: 112,
  headingScale: 100,
  codeScale: 105,
};

const fontFamilies = {
  ui: {
    avenir: '"Avenir Next", "PingFang SC", sans-serif',
    pingfang: '"PingFang SC", "Avenir Next", sans-serif',
    system: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  },
  heading: {
    "avenir-condensed": '"Avenir Next Condensed", "PingFang SC", sans-serif',
    avenir: '"Avenir Next", "PingFang SC", sans-serif',
    pingfang: '"PingFang SC", "Avenir Next", sans-serif',
  },
  mono: {
    sfmono: '"SFMono-Regular", "SF Mono", Menlo, monospace',
    menlo: 'Menlo, "SFMono-Regular", monospace',
    monaco: 'Monaco, "SFMono-Regular", monospace',
  },
} as const;

const systemColorScheme = window.matchMedia("(prefers-color-scheme: dark)");
let appliedNativeColorMode: ColorMode | undefined;

function isColorMode(value: unknown): value is ColorMode {
  return value === "system" || value === "light" || value === "dark";
}

function resolvedTheme(colorMode: ColorMode): "light" | "dark" {
  return colorMode === "system" ? (systemColorScheme.matches ? "dark" : "light") : colorMode;
}

function numericPreference(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
}

function loadAppearancePreferences(): AppearancePreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(appearanceStorageKey) ?? "{}") as Partial<AppearancePreferences>;
    return {
      colorMode: isColorMode(stored.colorMode) ? stored.colorMode : defaultAppearancePreferences.colorMode,
      uiFont: stored.uiFont && stored.uiFont in fontFamilies.ui ? stored.uiFont : defaultAppearancePreferences.uiFont,
      headingFont:
        stored.headingFont && stored.headingFont in fontFamilies.heading
          ? stored.headingFont
          : defaultAppearancePreferences.headingFont,
      monoFont:
        stored.monoFont && stored.monoFont in fontFamilies.mono
          ? stored.monoFont
          : defaultAppearancePreferences.monoFont,
      interfaceScale: numericPreference(stored.interfaceScale, defaultAppearancePreferences.interfaceScale, 90, 135),
      headingScale: numericPreference(stored.headingScale, defaultAppearancePreferences.headingScale, 90, 135),
      codeScale: numericPreference(stored.codeScale, defaultAppearancePreferences.codeScale, 90, 150),
    };
  } catch {
    return { ...defaultAppearancePreferences };
  }
}

let appearancePreferences = loadAppearancePreferences();

function applyAppearancePreferences(preferences: AppearancePreferences, persist = false): void {
  const root = document.documentElement;
  const theme = resolvedTheme(preferences.colorMode);
  root.dataset["theme"] = theme;
  root.style.setProperty("--ui-font-family", fontFamilies.ui[preferences.uiFont]);
  root.style.setProperty("--heading-font-family", fontFamilies.heading[preferences.headingFont]);
  root.style.setProperty("--mono-font-family", fontFamilies.mono[preferences.monoFont]);
  root.style.setProperty("--app-font-scale", String(preferences.interfaceScale / 100));
  root.style.setProperty("--heading-font-scale", String(preferences.headingScale / 100));
  root.style.setProperty("--code-font-scale", String(preferences.codeScale / 100));
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    "content",
    theme === "dark" ? "#0c1425" : "#f4f8ff",
  );
  if (appliedNativeColorMode !== preferences.colorMode) {
    appliedNativeColorMode = preferences.colorMode;
    void getCurrentWindow()
      .setTheme(preferences.colorMode === "system" ? null : preferences.colorMode)
      .catch(() => {});
  }
  if (persist) localStorage.setItem(appearanceStorageKey, JSON.stringify(preferences));
}

function syncAppearanceControls(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-color-mode]").forEach((button) => {
    const active = button.dataset["colorMode"] === appearancePreferences.colorMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $<HTMLSelectElement>("ui-font").value = appearancePreferences.uiFont;
  $<HTMLSelectElement>("heading-font").value = appearancePreferences.headingFont;
  $<HTMLSelectElement>("mono-font").value = appearancePreferences.monoFont;
  $<HTMLInputElement>("interface-scale").value = String(appearancePreferences.interfaceScale);
  $<HTMLInputElement>("heading-scale").value = String(appearancePreferences.headingScale);
  $<HTMLInputElement>("code-scale").value = String(appearancePreferences.codeScale);
  $("interface-scale-value").textContent = `${appearancePreferences.interfaceScale}%`;
  $("heading-scale-value").textContent = `${appearancePreferences.headingScale}%`;
  $("code-scale-value").textContent = `${appearancePreferences.codeScale}%`;
}

function openPreferences(): void {
  syncAppearanceControls();
  $("preferences-overlay").classList.remove("hidden");
  window.setTimeout(
    () => document.querySelector<HTMLButtonElement>(`[data-color-mode="${appearancePreferences.colorMode}"]`)?.focus(),
    0,
  );
}

function closePreferences(): void {
  $("preferences-overlay").classList.add("hidden");
}

function updateAppearancePreferences(): void {
  appearancePreferences = {
    colorMode: appearancePreferences.colorMode,
    uiFont: $<HTMLSelectElement>("ui-font").value as AppearancePreferences["uiFont"],
    headingFont: $<HTMLSelectElement>("heading-font").value as AppearancePreferences["headingFont"],
    monoFont: $<HTMLSelectElement>("mono-font").value as AppearancePreferences["monoFont"],
    interfaceScale: Number($<HTMLInputElement>("interface-scale").value),
    headingScale: Number($<HTMLInputElement>("heading-scale").value),
    codeScale: Number($<HTMLInputElement>("code-scale").value),
  };
  syncAppearanceControls();
  applyAppearancePreferences(appearancePreferences, true);
}

applyAppearancePreferences(appearancePreferences);

systemColorScheme.addEventListener("change", () => {
  if (appearancePreferences.colorMode === "system") {
    applyAppearancePreferences(appearancePreferences);
  }
});

const templates: Record<string, object> = {
  default: { aps: { alert: { title: "PushLab", body: "这是一条测试推送" }, sound: "default", badge: 1 } },
  simple: { aps: { alert: "这是一条测试推送" } },
  background: { aps: { "content-available": 1 } },
  liveactivity: {
    aps: {
      timestamp: Math.floor(Date.now() / 1000),
      event: "update",
      "content-state": { status: "running" },
    },
  },
};

let environment: Environment = "development";
let authMode: AuthMode = "token";
let tokenKeyPath = "";
let certificatePath = "";
let privateKeyPath = "";
let keychainIdentity = "";
let keychainIdentityId = "";
let keychainCertificates: KeychainCertificate[] = [];
let payloadHistory: PayloadHistoryItem[] = [];
let deviceTokenHistory: DeviceTokenHistoryItem[] = [];
let saveTimer: number | undefined;
let checkingUpdate = false;

const payload = $<HTMLTextAreaElement>("payload");
const pushType = $<HTMLSelectElement>("push-type");
const priority = $<HTMLSelectElement>("priority");
const sendButton = $<HTMLButtonElement>("send-button");

function matchingTemplate(value: unknown): string {
  const normalized = JSON.stringify(value);
  for (const key of Object.keys(templates)) {
    const template = templates[key];
    if (template && JSON.stringify(template) === normalized) return key;
  }
  return "custom";
}

function syncPayloadTemplate(): void {
  try {
    $<HTMLSelectElement>("payload-template").value = matchingTemplate(JSON.parse(payload.value));
  } catch {
    $<HTMLSelectElement>("payload-template").value = "custom";
  }
}

function topic(): string {
  if (authMode === "token") return $<HTMLInputElement>("token-topic").value.trim();
  if (authMode === "keychain") {
    return keychainCertificates.find((certificate) => certificate.id === keychainIdentityId)?.topic ?? "";
  }
  return $("credential-fields").querySelector("dd[data-field='Bundle ID']")?.textContent?.trim() === "未识别"
    ? ""
    : $("credential-fields").querySelector("dd[data-field='Bundle ID']")?.textContent?.trim() ?? "";
}

function readSettings(): PushSettings {
  return {
    environment,
    authMode,
    teamId: $<HTMLInputElement>("team-id").value.trim(),
    keyId: $<HTMLInputElement>("key-id").value.trim(),
    topic: topic(),
    tokenKeyPath,
    certificatePath,
    privateKeyPath,
    keychainIdentity,
    keychainIdentityId,
    deviceToken: $<HTMLTextAreaElement>("device-token").value.trim(),
    pushType: pushType.value,
    priority: Number(priority.value) as 5 | 10,
    collapseId: $<HTMLInputElement>("collapse-id").value.trim(),
    expiration: $<HTMLInputElement>("expiration").value.trim(),
    payload: payload.value,
  };
}

function applySettings(settings: PushSettings): void {
  environment = settings.environment;
  authMode = settings.authMode;
  tokenKeyPath = settings.tokenKeyPath;
  certificatePath = settings.certificatePath;
  privateKeyPath = settings.privateKeyPath;
  keychainIdentity = settings.keychainIdentity;
  keychainIdentityId = settings.keychainIdentityId;
  $<HTMLInputElement>("team-id").value = settings.teamId;
  $<HTMLInputElement>("key-id").value = settings.keyId;
  $<HTMLInputElement>("token-topic").value = settings.topic;
  $<HTMLTextAreaElement>("device-token").value = settings.deviceToken;
  pushType.value = settings.pushType;
  priority.value = String(settings.priority);
  $<HTMLInputElement>("collapse-id").value = settings.collapseId;
  $<HTMLInputElement>("expiration").value = settings.expiration;
  payload.value = settings.payload;
  syncPayloadTemplate();
  updateFileLabel("token-key", tokenKeyPath, "选择 AuthKey.p8", "Apple Developer 下载的私钥");
  updateFileLabel("certificate", certificatePath, "选择客户端证书", "支持 .p12 / .pfx / .pem / .cer / .crt");
  $("private-key-path").textContent = privateKeyPath ? `独立私钥：${privateKeyPath}` : "";
  refreshTabs();
  refreshPayloadState();
  refreshSummary();
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void invoke("save_settings", { settings: readSettings() });
  }, 350);
}

function updateFileLabel(prefix: "token-key" | "certificate", path: string, title: string, note: string): void {
  $(`${prefix}-name`).textContent = path ? path.split(/[\\/]/).pop() || path : title;
  $(`${prefix}-path`).textContent = path || note;
}

function refreshTabs(): void {
  document.querySelectorAll<HTMLButtonElement>(".environment-button").forEach((button) => {
    button.classList.toggle("active", button.dataset["environment"] === environment);
  });
  document.querySelectorAll<HTMLButtonElement>(".auth-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset["auth"] === authMode);
  });
  $("token-auth").classList.toggle("hidden", authMode !== "token");
  $("keychain-auth").classList.toggle("hidden", authMode !== "keychain");
  $("certificate-auth").classList.toggle("hidden", authMode !== "certificate");
}

function renderCredentialDetails(info: CredentialInfo | null): void {
  const container = $("credential-details");
  const fields = $("credential-fields");
  fields.replaceChildren();
  if (!info?.title || !info.fields.length) {
    container.classList.add("hidden");
    refreshSummary();
    return;
  }
  container.classList.remove("hidden");
  $("credential-title").textContent = info.title;
  for (const field of info.fields) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = field.label;
    value.textContent = field.value;
    value.dataset["field"] = field.label;
    row.append(term, value);
    fields.append(row);
  }
  refreshSummary();
}

async function refreshCredentialDetails(): Promise<void> {
  try {
    if (authMode === "keychain") {
      if (!keychainIdentityId) return renderCredentialDetails(null);
      renderCredentialDetails(await invoke<CredentialInfo>("inspect_credential", {
        kind: "keychain",
        value: keychainIdentityId,
      }));
      return;
    }
    if (authMode === "certificate") {
      if (!certificatePath) return renderCredentialDetails(null);
      renderCredentialDetails(await invoke<CredentialInfo>("inspect_credential", {
        kind: "certificate",
        value: certificatePath,
        passphrase: $<HTMLInputElement>("certificate-passphrase").value,
      }));
      return;
    }
    if (!tokenKeyPath) return renderCredentialDetails(null);
    renderCredentialDetails(await invoke<CredentialInfo>("inspect_credential", {
      kind: "token",
      value: tokenKeyPath,
    }));
  } catch (error) {
    renderCredentialDetails(null);
    setConnectionState("error", "凭据读取失败", String(error));
  }
}

function certificateDescription(certificate: KeychainCertificate): string {
  const environmentName =
    certificate.environment === "development" ? "开发" : certificate.environment === "production" ? "生产" : "通用";
  const expiration = certificate.expiresAt ? new Date(certificate.expiresAt).toLocaleDateString() : "有效期未知";
  return `${certificate.name} · ${environmentName} · ${expiration}`;
}

function applyKeychainCertificate(certificate?: KeychainCertificate): void {
  if (!certificate) {
    keychainIdentity = "";
    keychainIdentityId = "";
    renderCredentialDetails(null);
    $("keychain-certificate-info").textContent = keychainCertificates.length
      ? "请选择一张推送证书"
      : "未找到包含私钥的 Apple 推送证书";
    refreshSummary();
    return;
  }
  keychainIdentity = certificate.name;
  keychainIdentityId = certificate.id;
  if (certificate.environment !== "both") environment = certificate.environment;
  $("keychain-certificate-info").textContent = certificate.topic
    ? `Bundle ID：${certificate.topic}`
    : "证书中未识别到 Bundle ID";
  refreshTabs();
  refreshSummary();
  void refreshCredentialDetails();
}

async function loadKeychainCertificates(): Promise<void> {
  const select = $<HTMLSelectElement>("keychain-certificate");
  const refreshButton = $<HTMLButtonElement>("refresh-keychain");
  refreshButton.disabled = true;
  select.disabled = true;
  select.replaceChildren(new Option("正在读取钥匙串…", ""));
  try {
    keychainCertificates = await invoke<KeychainCertificate[]>("list_keychain_certificates");
    select.replaceChildren(new Option(keychainCertificates.length ? "请选择推送证书" : "未找到推送证书", ""));
    for (const certificate of keychainCertificates) {
      select.add(new Option(certificateDescription(certificate), certificate.id));
    }
    const saved =
      keychainCertificates.find((certificate) => certificate.id === keychainIdentityId) ??
      keychainCertificates.find((certificate) => certificate.name === keychainIdentity);
    select.value = saved?.id ?? "";
    if (authMode === "keychain") applyKeychainCertificate(saved);
  } catch (error) {
    select.replaceChildren(new Option("读取钥匙串失败", ""));
    $("keychain-certificate-info").textContent = String(error);
  } finally {
    refreshButton.disabled = false;
    select.disabled = false;
  }
}

async function pickCredential(kind: CredentialKind): Promise<void> {
  const filters = {
    tokenKey: [{ name: "APNs Auth Key", extensions: ["p8", "pem"] }],
    certificate: [{ name: "推送证书", extensions: ["p12", "pfx", "pem", "cer", "crt"] }],
    privateKey: [{ name: "私钥", extensions: ["key", "pem", "p8"] }],
  } satisfies Record<CredentialKind, Array<{ name: string; extensions: string[] }>>;
  const selected = await open({
    multiple: false,
    directory: false,
    filters: filters[kind],
  });
  if (typeof selected !== "string") return;
  if (kind === "tokenKey") {
    tokenKeyPath = selected;
    updateFileLabel("token-key", selected, "", "");
  } else if (kind === "certificate") {
    certificatePath = selected;
    updateFileLabel("certificate", selected, "", "");
  } else {
    privateKeyPath = selected;
    $("private-key-path").textContent = `独立私钥：${selected}`;
  }
  scheduleSave();
  await refreshCredentialDetails();
}

function refreshPayloadState(): void {
  const bytes = new TextEncoder().encode(payload.value).length;
  const limit = pushType.value === "voip" ? 5120 : 4096;
  const size = $("payload-size");
  size.textContent = `${bytes.toLocaleString()} B / ${(limit / 1024).toFixed(0)} KB`;
  size.classList.toggle("over-limit", bytes > limit);
  try {
    const value = JSON.parse(payload.value) as Record<string, unknown>;
    $("payload-error").textContent = value["aps"] && typeof value["aps"] === "object" ? "" : "Payload 必须包含 aps 对象";
  } catch {
    $("payload-error").textContent = "JSON 格式错误";
  }
  const lineCount = Math.max(1, payload.value.split("\n").length);
  $("line-gutter").innerHTML = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("<br>");
}

function refreshSummary(): void {
  const environmentName = environment === "development" ? "开发环境" : "生产环境";
  $("send-summary").textContent = `${environmentName} · ${pushType.value} · Priority ${priority.value}`;
  $("topic-summary").textContent = topic() ? `Topic · ${topic()}` : "等待填写或识别 Bundle ID";
}

function setConnectionState(
  state: "idle" | "sending" | "success" | "error",
  title: string,
  detail = "",
): void {
  const element = $("connection-state");
  element.className = `connection-state ${state}`;
  element.querySelector("strong")!.textContent = title;
  element.querySelector("small")!.textContent = detail || {
    idle: "等待发送任务",
    sending: "正在连接 Apple Push Notification service",
    success: "APNs 已接收请求",
    error: "请查看响应详情",
  }[state];
}

function historyTime(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadPayloadHistory(): Promise<void> {
  payloadHistory = await invoke<PayloadHistoryItem[]>("load_payload_history");
  const select = $<HTMLSelectElement>("payload-history");
  select.replaceChildren(new Option(`历史消息（${payloadHistory.length}/50）`, ""));
  for (const item of payloadHistory) {
    select.add(new Option(`${historyTime(item.createdAt)} · ${item.pushType} · ${item.topic || "无 Topic"}`, item.id));
  }
  resetClearButton($<HTMLButtonElement>("clear-payload-history"), payloadHistory.length > 0);
}

async function loadDeviceTokenHistory(): Promise<void> {
  deviceTokenHistory = await invoke<DeviceTokenHistoryItem[]>("load_device_token_history");
  const select = $<HTMLSelectElement>("device-token-history");
  select.replaceChildren(new Option(`Token 历史（${deviceTokenHistory.length}/10）`, ""));
  for (const item of deviceTokenHistory) {
    const environmentName = item.environment === "development" ? "开发" : "生产";
    select.add(new Option(`${environmentName} · …${item.token.slice(-8)}`, item.id));
  }
  resetClearButton($<HTMLButtonElement>("clear-device-token-history"), deviceTokenHistory.length > 0);
}

function resetClearButton(button: HTMLButtonElement, enabled: boolean): void {
  button.textContent = "清空";
  button.dataset["confirming"] = "false";
  button.disabled = !enabled;
}

async function clearHistory(
  button: HTMLButtonElement,
  command: "clear_payload_history" | "clear_device_token_history",
  reload: () => Promise<void>,
): Promise<void> {
  if (button.dataset["confirming"] !== "true") {
    button.dataset["confirming"] = "true";
    button.textContent = "确认清空";
    window.setTimeout(() => resetClearButton(button, true), 3000);
    return;
  }
  button.disabled = true;
  button.textContent = "清空中…";
  try {
    await invoke(command);
    await reload();
    setConnectionState("success", "历史已清空");
  } catch (error) {
    resetClearButton(button, true);
    setConnectionState("error", "清空失败", String(error));
  }
}

function applyPayloadHistory(item: PayloadHistoryItem): void {
  payload.value = item.payload;
  pushType.value = item.pushType;
  priority.value = String(item.priority);
  $<HTMLInputElement>("collapse-id").value = item.collapseId;
  $<HTMLInputElement>("expiration").value = item.expiration;
  $<HTMLSelectElement>("payload-template").value = "custom";
  refreshPayloadState();
  refreshSummary();
  scheduleSave();
}

function showResult(result: PushResult): void {
  $("empty-result").classList.add("hidden");
  const content = $("result-content");
  content.className = `result-content ${result.ok ? "success" : "error"}`;
  $("result-icon").textContent = result.ok ? "✓" : "!";
  $("result-title").textContent = result.ok ? "推送已被 APNs 接收" : "推送发送失败";
  $("result-time").textContent = `${new Date().toLocaleTimeString()} · ${result.durationMs} ms`;
  $("result-status").textContent = result.status ? `HTTP ${result.status}` : "LOCAL";
  $("result-apns-id").textContent = result.apnsId || "—";
  $("result-host").textContent = result.host || "—";
  $("result-error-details").classList.toggle("hidden", result.ok);
  if (!result.ok) {
    const timeout = result.reason.includes("超时") || /timeout/i.test(result.reason);
    $("result-reason").textContent = result.reasonInfo?.code ?? (timeout ? "网络超时" : "本地请求失败");
    $("result-reason-message").textContent = result.reasonInfo?.message ?? result.reason;
    $("result-reason-suggestion").textContent =
      result.reasonInfo?.suggestion ??
      (timeout ? "请检查网络、代理或 APNs 可达性后重试。" : "请检查凭据、网络和输入配置。");
  }
}

async function send(): Promise<void> {
  if (sendButton.disabled) return;
  const startedAt = performance.now();
  refreshPayloadState();
  if ($("payload-error").textContent) {
    payload.focus();
    return;
  }
  const request: PushRequest = {
    ...readSettings(),
    certificatePassphrase: $<HTMLInputElement>("certificate-passphrase").value,
  };
  sendButton.disabled = true;
  sendButton.classList.add("loading");
  $("send-button-label").textContent = "正在发送";
  setConnectionState("sending", "连接中");
  try {
    const result = await invoke<PushResult>("send_push", { request });
    showResult(result);
    setConnectionState(result.ok ? "success" : "error", result.ok ? "发送成功" : "发送失败");
  } catch (error) {
    const reason = String(error);
    showResult({
      ok: false,
      status: 0,
      reason,
      apnsId: "",
      host: environment === "development" ? "api.sandbox.push.apple.com" : "api.push.apple.com",
      durationMs: Math.round(performance.now() - startedAt),
      responseBody: "",
    });
    setConnectionState("error", "发送失败", reason);
  } finally {
    sendButton.disabled = false;
    sendButton.classList.remove("loading");
    $("send-button-label").textContent = "发送到 APNs";
    void Promise.all([loadPayloadHistory(), loadDeviceTokenHistory()]);
  }
}

async function checkForUpdates(): Promise<void> {
  if (checkingUpdate) return;
  checkingUpdate = true;
  try {
    const update = await check();
    if (!update) {
      await message("当前已经是最新版本。", { title: "PushLab 更新", kind: "info" });
      return;
    }
    const accepted = await ask(
      `发现 PushLab ${update.version}。${update.body ? `\n\n${update.body}` : ""}\n\n是否下载并安装？`,
      { title: "发现新版本", kind: "info", okLabel: "安装更新", cancelLabel: "稍后" },
    );
    if (!accepted) return;
    await installUpdate(update);
  } catch (error) {
    const errorText = String(error);
    const missingManifest =
      errorText.includes("Could not fetch a valid release JSON") ||
      errorText.includes("404") ||
      errorText.includes("Not Found");
    await message(
      missingManifest
        ? "更新服务尚未发布可用的 Tauri 更新清单。首次发布 Tauri 版本并上传 latest.json 后即可正常检查更新。"
        : `检查更新失败：${errorText}`,
      { title: "PushLab 更新", kind: "error" },
    );
  } finally {
    checkingUpdate = false;
  }
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(value / 1024))} KB`;
}

async function installUpdate(update: NonNullable<Awaited<ReturnType<typeof check>>>): Promise<void> {
  const progress = $("update-progress");
  const fill = $("update-progress-fill");
  const title = $("update-progress-title");
  const detail = $("update-progress-detail");
  progress.classList.remove("hidden");
  fill.style.width = "0%";
  fill.classList.remove("indeterminate");
  title.textContent = "下载更新";
  detail.textContent = `PushLab ${update.version} · 正在连接更新服务`;
  let received = 0;
  let total = 0;
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
        detail.textContent = total
          ? `PushLab ${update.version} · 0% · 0 B / ${formatBytes(total)}`
          : `PushLab ${update.version} · 正在下载`;
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        const percent = total ? Math.min(100, Math.round((received / total) * 100)) : null;
        fill.style.width = percent === null ? "100%" : `${percent}%`;
        fill.classList.toggle("indeterminate", percent === null);
        detail.textContent = percent === null
          ? `PushLab ${update.version} · 已下载 ${formatBytes(received)}`
          : `PushLab ${update.version} · ${percent}% · ${formatBytes(received)} / ${formatBytes(total)}`;
      } else {
        fill.style.width = "100%";
        fill.classList.remove("indeterminate");
        title.textContent = "安装更新";
        detail.textContent = `PushLab ${update.version} · 准备重新启动`;
      }
    });
    await relaunch();
  } catch (error) {
    progress.classList.add("hidden");
    throw error;
  }
}

document.querySelectorAll<HTMLButtonElement>(".environment-button").forEach((button) => {
  button.addEventListener("click", () => {
    environment = button.dataset["environment"] as Environment;
    refreshTabs();
    refreshSummary();
    scheduleSave();
  });
});

document.querySelectorAll<HTMLButtonElement>(".auth-tab").forEach((button) => {
  button.addEventListener("click", () => {
    authMode = button.dataset["auth"] as AuthMode;
    refreshTabs();
    refreshSummary();
    void refreshCredentialDetails();
    if (authMode === "keychain" && !keychainCertificates.length) void loadKeychainCertificates();
    scheduleSave();
  });
});

$("pick-token-key").addEventListener("click", () => void pickCredential("tokenKey"));
$("pick-certificate").addEventListener("click", () => void pickCredential("certificate"));
$("pick-private-key").addEventListener("click", () => void pickCredential("privateKey"));
$("refresh-keychain").addEventListener("click", () => void loadKeychainCertificates());
$("send-button").addEventListener("click", () => void send());
$("clear-result").addEventListener("click", () => {
  $("result-content").classList.add("hidden");
  $("empty-result").classList.remove("hidden");
  setConnectionState("idle", "待机");
});

$<HTMLSelectElement>("keychain-certificate").addEventListener("change", (event) => {
  const selected = keychainCertificates.find(
    (certificate) => certificate.id === (event.target as HTMLSelectElement).value,
  );
  applyKeychainCertificate(selected);
  scheduleSave();
});

$<HTMLSelectElement>("payload-template").addEventListener("change", (event) => {
  const key = (event.target as HTMLSelectElement).value;
  if (key === "custom") return;
  payload.value = JSON.stringify(templates[key], null, 2);
  $<HTMLSelectElement>("payload-history").value = "";
  if (key === "background") {
    pushType.value = "background";
    priority.value = "5";
  } else if (key === "liveactivity") {
    pushType.value = "liveactivity";
    priority.value = "10";
  } else {
    pushType.value = "alert";
    priority.value = "10";
  }
  refreshPayloadState();
  refreshSummary();
  scheduleSave();
});

$<HTMLSelectElement>("payload-history").addEventListener("change", (event) => {
  const item = payloadHistory.find((entry) => entry.id === (event.target as HTMLSelectElement).value);
  if (item) applyPayloadHistory(item);
});

$<HTMLSelectElement>("device-token-history").addEventListener("change", (event) => {
  const item = deviceTokenHistory.find((entry) => entry.id === (event.target as HTMLSelectElement).value);
  if (!item) return;
  $<HTMLTextAreaElement>("device-token").value = item.token;
  environment = item.environment;
  refreshTabs();
  refreshSummary();
  scheduleSave();
});

$<HTMLButtonElement>("clear-payload-history").addEventListener("click", (event) => {
  void clearHistory(event.currentTarget as HTMLButtonElement, "clear_payload_history", loadPayloadHistory);
});
$<HTMLButtonElement>("clear-device-token-history").addEventListener("click", (event) => {
  void clearHistory(event.currentTarget as HTMLButtonElement, "clear_device_token_history", loadDeviceTokenHistory);
});

$("format-json").addEventListener("click", () => {
  try {
    const parsed = JSON.parse(payload.value) as unknown;
    const history = $<HTMLSelectElement>("payload-history");
    payload.value = JSON.stringify(parsed, null, 2);
    $<HTMLSelectElement>("payload-template").value = history.value ? "custom" : matchingTemplate(parsed);
    history.value = "";
    refreshPayloadState();
    scheduleSave();
  } catch {
    $("payload-error").textContent = "无法格式化：JSON 格式错误";
  }
});

payload.addEventListener("input", () => {
  $<HTMLSelectElement>("payload-template").value = "custom";
  $<HTMLSelectElement>("payload-history").value = "";
  refreshPayloadState();
  scheduleSave();
});

pushType.addEventListener("change", () => {
  if (pushType.value === "background") priority.value = "5";
  refreshPayloadState();
  refreshSummary();
  scheduleSave();
});

priority.addEventListener("change", () => {
  refreshSummary();
  scheduleSave();
});

document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((element) => {
  if (element.id === "payload" || element.id === "certificate-passphrase") return;
  element.addEventListener("input", () => {
    refreshSummary();
    scheduleSave();
  });
});

$<HTMLInputElement>("certificate-passphrase").addEventListener("change", () => void refreshCredentialDetails());

for (const id of ["ui-font", "heading-font", "mono-font"]) {
  $<HTMLSelectElement>(id).addEventListener("change", updateAppearancePreferences);
}
document.querySelectorAll<HTMLButtonElement>("[data-color-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const colorMode = button.dataset["colorMode"];
    if (!isColorMode(colorMode)) return;
    appearancePreferences = { ...appearancePreferences, colorMode };
    syncAppearanceControls();
    applyAppearancePreferences(appearancePreferences, true);
  });
});
for (const id of ["interface-scale", "heading-scale", "code-scale"]) {
  $<HTMLInputElement>(id).addEventListener("input", updateAppearancePreferences);
}
$("close-preferences").addEventListener("click", closePreferences);
$("done-preferences").addEventListener("click", closePreferences);
$("reset-preferences").addEventListener("click", () => {
  appearancePreferences = { ...defaultAppearancePreferences };
  syncAppearanceControls();
  applyAppearancePreferences(appearancePreferences, true);
});
$("preferences-overlay").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closePreferences();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("preferences-overlay").classList.contains("hidden")) {
    event.preventDefault();
    closePreferences();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void send();
  }
});

document.addEventListener(
  "contextmenu",
  (event) => {
    const target = event.target as HTMLElement | null;
    const editable =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      Boolean(target?.isContentEditable);
    if (!editable && !window.getSelection()?.toString()) event.preventDefault();
  },
  { capture: true },
);

async function initialize(): Promise<void> {
  await listen("pushlab://check-update", () => void checkForUpdates());
  await listen("pushlab://open-preferences", openPreferences);
  syncAppearanceControls();
  try {
    const settings = await invoke<PushSettings>("load_settings");
    applySettings(settings);
    await Promise.all([loadKeychainCertificates(), loadPayloadHistory(), loadDeviceTokenHistory()]);
    await refreshCredentialDetails();
  } catch (error) {
    applySettings({
      environment: "development",
      authMode: "token",
      teamId: "",
      keyId: "",
      topic: "",
      tokenKeyPath: "",
      certificatePath: "",
      privateKeyPath: "",
      keychainIdentity: "",
      keychainIdentityId: "",
      deviceToken: "",
      pushType: "alert",
      priority: 10,
      collapseId: "",
      expiration: "0",
      payload: JSON.stringify(templates["default"], null, 2),
    });
    setConnectionState("error", "初始化失败", String(error));
  }
}

void initialize();
