(() => {
  "use strict";

  const DEFAULT_CONFIG = Object.freeze({
    siteName: "BF 官方下载",
    gameName: "BF",
    versionText: "官方最新版",
    iosInstallUrl: "https://dgwsd.yycdzx.com/UMuGWv",
    androidInstallUrl: "https://www.gulubase.com/bf888"
  });

  const state = {
    config: { ...DEFAULT_CONFIG },
    device: null,
    toastTimer: 0,
    navigating: false
  };

  const elements = {
    primaryAction: document.getElementById("primaryAction"),
    primaryLabel: document.getElementById("primaryLabel"),
    primarySubLabel: document.getElementById("primarySubLabel"),
    actionNote: document.getElementById("actionNote"),
    androidAction: document.getElementById("androidAction"),
    iosAction: document.getElementById("iosAction"),
    platformDivider: document.querySelector(".platform-divider"),
    platformOptions: document.querySelector(".platform-options"),
    deviceIcon: document.getElementById("deviceIcon"),
    downloadTitle: document.getElementById("download-title"),
    browserBadge: document.getElementById("browserBadge"),
    flowDeviceText: document.getElementById("flowDeviceText"),
    installTip: document.getElementById("installTip"),
    versionText: document.getElementById("versionText"),
    particles: document.getElementById("particles"),
    toast: document.getElementById("toast")
  };

  function detectDevice() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const touchPoints = navigator.maxTouchPoints || 0;
    const query = new URLSearchParams(window.location.search);
    const forcedPlatform = (query.get("platform") || "").toLowerCase();

    const ipadDesktopMode = platform === "MacIntel" && touchPoints > 1;
    let isIOS = /iPhone|iPad|iPod/i.test(ua) || ipadDesktopMode;
    let isAndroid = /Android/i.test(ua);

    if (forcedPlatform === "ios") {
      isIOS = true;
      isAndroid = false;
    } else if (forcedPlatform === "android") {
      isAndroid = true;
      isIOS = false;
    } else if (forcedPlatform === "desktop") {
      isAndroid = false;
      isIOS = false;
    }

    let browserName = "系统浏览器";
    if (/MicroMessenger/i.test(ua)) browserName = "微信内置浏览器";
    else if (/QQ\//i.test(ua) || /MQQBrowser/i.test(ua)) browserName = "QQ内置浏览器";
    else if (/Weibo/i.test(ua)) browserName = "微博内置浏览器";
    else if (/aweme|BytedanceWebview|ToutiaoMicroApp/i.test(ua)) browserName = "抖音内置浏览器";
    else if (/AlipayClient/i.test(ua)) browserName = "支付宝内置浏览器";
    else if (/CriOS/i.test(ua) || /Chrome/i.test(ua)) browserName = "Chrome";
    else if (/FxiOS/i.test(ua) || /Firefox/i.test(ua)) browserName = "Firefox";
    else if (/EdgiOS/i.test(ua) || /Edg/i.test(ua)) browserName = "Edge";
    else if (/OPiOS/i.test(ua) || /OPR/i.test(ua)) browserName = "Opera";
    else if (/Safari/i.test(ua)) browserName = "Safari";

    return {
      isIOS,
      isAndroid,
      isDesktop: !isIOS && !isAndroid,
      browserName
    };
  }

  async function loadConfig() {
    try {
      const response = await fetch(`site-config.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const loaded = await response.json();
      state.config = { ...DEFAULT_CONFIG, ...loaded };
    } catch (error) {
      console.warn("安装地址读取失败，使用内置默认值。", error);
      state.config = { ...DEFAULT_CONFIG };
    }
  }

  // 后台「系统配置 → 游戏推广下载地址」里配的两个跳转地址。
  // 页面只在同一个目录下要 links.json（Caddy 内部转到后台只读接口），
  // 也拿不到（后台没配、接口挂了、或不是 https）就静默保留站点自带的 site-config.json。
  async function loadRemoteLinks() {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(`links.json?v=${Date.now()}`, {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const data = payload && payload.data ? payload.data : payload;
      const links = {};
      if (data && safeHttpsUrl(data.iosUrl)) links.iosInstallUrl = data.iosUrl.trim();
      if (data && safeHttpsUrl(data.androidUrl)) links.androidInstallUrl = data.androidUrl.trim();
      return links;
    } catch (error) {
      console.warn("后台跳转配置读取失败，继续使用站点配置。", error);
      return {};
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function refreshRemoteLinks() {
    const links = await loadRemoteLinks();
    if (!links.iosInstallUrl && !links.androidInstallUrl) return;
    state.config = { ...state.config, ...links };
  }

  function createParticles() {
    if (!elements.particles || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 24; index += 1) {
      const particle = document.createElement("span");
      const sideDrift = index % 2 === 0 ? 1 : -1;
      particle.style.setProperty("--x", `${(index * 37 + 11) % 100}%`);
      particle.style.setProperty("--size", `${1 + (index % 3)}px`);
      particle.style.setProperty("--alpha", `${0.18 + (index % 5) * 0.08}`);
      particle.style.setProperty("--duration", `${8 + (index % 7) * 1.3}s`);
      particle.style.setProperty("--delay", `${-1 * (index % 11)}s`);
      particle.style.setProperty("--drift", `${sideDrift * (14 + (index % 4) * 8)}px`);
      fragment.appendChild(particle);
    }
    elements.particles.appendChild(fragment);
  }

  function setInstallTip(title, message) {
    const titleNode = elements.installTip.querySelector("strong");
    const messageNode = elements.installTip.querySelector("span");
    titleNode.textContent = title;
    messageNode.textContent = message;
  }

  function renderDevice() {
    const device = state.device;
    const config = state.config;
    document.title = config.siteName;
    elements.versionText.textContent = config.versionText;
    elements.browserBadge.textContent = device.browserName;
    elements.deviceIcon.classList.remove("is-ios", "is-android");
    elements.androidAction.classList.toggle("is-current", device.isAndroid);
    elements.iosAction.classList.toggle("is-current", device.isIOS);
    elements.androidAction.setAttribute("aria-current", device.isAndroid ? "true" : "false");
    elements.iosAction.setAttribute("aria-current", device.isIOS ? "true" : "false");
    elements.platformDivider.hidden = !device.isDesktop;
    elements.platformOptions.hidden = !device.isDesktop;

    if (device.isIOS) {
      elements.deviceIcon.classList.add("is-ios");
      elements.downloadTitle.textContent = "iPhone / iPad";
      elements.primaryLabel.textContent = "前往苹果安装页";
      elements.primarySubLabel.textContent = "点击后前往安装";
      elements.actionNote.textContent = "点击按钮跳转到苹果安装页面";
      elements.flowDeviceText.textContent = "已识别 iPhone / iPad";
      setInstallTip("苹果安装提示", "点击上方按钮前往苹果安装页面，按页面提示完成安装。");
    } else if (device.isAndroid) {
      elements.deviceIcon.classList.add("is-android");
      elements.downloadTitle.textContent = "Android 手机";
      elements.primaryLabel.textContent = "前往安卓下载页";
      elements.primarySubLabel.textContent = "点击后前往下载安装";
      elements.actionNote.textContent = "点击按钮跳转到安卓下载页面";
      elements.flowDeviceText.textContent = "已识别 Android 设备";
      setInstallTip("安卓安装提示", "点击上方按钮前往下载页面，按页面提示完成安装。");
    } else {
      elements.downloadTitle.textContent = "电脑浏览器";
      elements.primaryLabel.textContent = "选择手机版本";
      elements.primarySubLabel.textContent = "支持 Android 与苹果安装";
      elements.actionNote.textContent = "建议直接使用手机打开本页面";
      elements.flowDeviceText.textContent = "请选择 Android 或苹果安装";
      setInstallTip("电脑访问提示", "请选择下方平台，或把本页地址发到手机上打开。");
    }

    elements.primaryAction.disabled = false;
  }

  // 只接受 https 目标：落地页本身是 http，配置一旦被改写成 http 地址就拒绝，避免把玩家送去可被劫持的下载源。
  function safeHttpsUrl(value) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return "";
    let parsed;
    try {
      parsed = new URL(text, window.location.href);
    } catch (_error) {
      return "";
    }
    if (parsed.protocol !== "https:") {
      console.warn("已忽略非 HTTPS 安装地址:", text);
      return "";
    }
    return parsed.href;
  }

  function installUrlFor(platform) {
    const isIOS = platform === "ios";
    const configured = safeHttpsUrl(isIOS ? state.config.iosInstallUrl : state.config.androidInstallUrl);
    if (configured) return configured;
    return safeHttpsUrl(isIOS ? DEFAULT_CONFIG.iosInstallUrl : DEFAULT_CONFIG.androidInstallUrl);
  }

  function goToInstallPage(platform) {
    const target = installUrlFor(platform);
    if (!target) {
      showToast("安装地址暂不可用，请稍后重试");
      return;
    }
    if (state.navigating) return;
    state.navigating = true;
    showToast(platform === "ios" ? "正在打开苹果安装页面…" : "正在打开安卓下载页面…");
    window.setTimeout(() => window.location.assign(target), 120);
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
  }

  function handlePrimaryAction() {
    if (state.device.isIOS) {
      goToInstallPage("ios");
    } else if (state.device.isAndroid) {
      goToInstallPage("android");
    } else {
      showToast("请在下方选择 Android 或苹果安装");
      elements.androidAction.focus();
    }
  }

  function bindEvents() {
    elements.primaryAction.addEventListener("click", handlePrimaryAction);
    elements.androidAction.addEventListener("click", () => goToInstallPage("android"));
    elements.iosAction.addEventListener("click", () => goToInstallPage("ios"));
    window.addEventListener("offline", () => showToast("网络已断开，请恢复网络后重试"));
    window.addEventListener("online", () => showToast("网络已恢复"));
  }

  async function boot() {
    state.device = detectDevice();
    createParticles();
    bindEvents();
    await loadConfig();
    renderDevice();
    void refreshRemoteLinks();
  }

  boot();
})();
