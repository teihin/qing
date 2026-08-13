(() => {
  "use strict";

  const DEFAULT_CONFIG = Object.freeze({
    siteName: "8L 官方下载",
    gameName: "8L",
    versionText: "官方最新版",
    androidApkUrl: "./downloads/8L.apk",
    iosProfileUrl: "./downloads/8L.mobileconfig",
    iosGameUrl: "https://154-37-155-17.sslip.io/"
  });

  const state = {
    config: { ...DEFAULT_CONFIG },
    device: null,
    toastTimer: 0,
    activeSheet: null
  };

  const elements = {
    primaryAction: document.getElementById("primaryAction"),
    primaryLabel: document.getElementById("primaryLabel"),
    primarySubLabel: document.getElementById("primarySubLabel"),
    primaryMark: document.getElementById("primaryMark"),
    actionNote: document.getElementById("actionNote"),
    androidAction: document.getElementById("androidAction"),
    iosAction: document.getElementById("iosAction"),
    deviceIcon: document.getElementById("deviceIcon"),
    downloadTitle: document.getElementById("download-title"),
    browserBadge: document.getElementById("browserBadge"),
    installTip: document.getElementById("installTip"),
    versionText: document.getElementById("versionText"),
    particles: document.getElementById("particles"),
    iosSheet: document.getElementById("iosSheet"),
    browserSheet: document.getElementById("browserSheet"),
    sheetBackdrop: document.getElementById("sheetBackdrop"),
    downloadProfileAction: document.getElementById("downloadProfileAction"),
    copyAddressAction: document.getElementById("copyAddressAction"),
    browserSheetText: document.getElementById("browserSheetText"),
    browserRoute: document.getElementById("browserRoute"),
    toast: document.getElementById("toast")
  };

  function detectDevice() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const touchPoints = navigator.maxTouchPoints || 0;
    const query = new URLSearchParams(window.location.search);
    const forcedPlatform = (query.get("platform") || "").toLowerCase();
    const forcedBrowser = (query.get("browser") || "").toLowerCase();

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

    const isWeChat = /MicroMessenger/i.test(ua);
    const isQQ = /QQ\//i.test(ua) || /MQQBrowser/i.test(ua);
    const isWeibo = /Weibo/i.test(ua);
    const isDouyin = /aweme|BytedanceWebview|ToutiaoMicroApp/i.test(ua);
    const isAlipay = /AlipayClient/i.test(ua);
    const isEmbedded = isWeChat || isQQ || isWeibo || isDouyin || isAlipay;
    const isCriOS = /CriOS/i.test(ua);
    const isFxiOS = /FxiOS/i.test(ua);
    const isEdgeIOS = /EdgiOS/i.test(ua);
    const isOperaIOS = /OPiOS/i.test(ua);
    let isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS|Android/i.test(ua);

    if (forcedBrowser === "safari") {
      isSafari = true;
    }

    let browserName = "系统浏览器";
    if (isWeChat) browserName = "微信内置浏览器";
    else if (isQQ) browserName = "QQ内置浏览器";
    else if (isWeibo) browserName = "微博内置浏览器";
    else if (isDouyin) browserName = "抖音内置浏览器";
    else if (isAlipay) browserName = "支付宝内置浏览器";
    else if (isSafari) browserName = "Safari";
    else if (isCriOS || /Chrome/i.test(ua)) browserName = "Chrome";
    else if (isFxiOS || /Firefox/i.test(ua)) browserName = "Firefox";
    else if (isEdgeIOS || /Edg/i.test(ua)) browserName = "Edge";
    else if (isOperaIOS || /OPR/i.test(ua)) browserName = "Opera";

    return {
      isIOS,
      isAndroid,
      isDesktop: !isIOS && !isAndroid,
      isSafari,
      isEmbedded,
      browserName,
      embeddedName: isWeChat ? "微信" : isQQ ? "QQ" : isWeibo ? "微博" : isDouyin ? "抖音" : isAlipay ? "支付宝" : "当前应用",
      isStandalone: window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches
    };
  }

  async function loadConfig() {
    try {
      const response = await fetch(`site-config.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const loaded = await response.json();
      state.config = { ...DEFAULT_CONFIG, ...loaded };
    } catch (error) {
      console.warn("下载配置读取失败，使用内置默认值。", error);
      state.config = { ...DEFAULT_CONFIG };
    }
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

    if (device.isIOS) {
      elements.deviceIcon.classList.add("is-ios");
      elements.downloadTitle.textContent = "iPhone / iPad";
      elements.primaryLabel.textContent = device.isSafari && !device.isEmbedded ? "安装 iPhone 版" : "使用 Safari 打开";
      elements.primarySubLabel.textContent = device.isSafari && !device.isEmbedded ? "下载8L桌面描述文件" : "苹果安装需通过Safari完成";
      elements.actionNote.textContent = device.isStandalone ? "当前已从桌面模式打开" : "安装后可从手机桌面全屏进入游戏";
      setInstallTip("苹果安装提示", device.isSafari && !device.isEmbedded ? "下载后前往“设置 → 已下载描述文件”完成安装。" : "请复制本页地址并切换到Safari浏览器打开。 ");
    } else if (device.isAndroid) {
      elements.deviceIcon.classList.add("is-android");
      elements.downloadTitle.textContent = "Android 手机";
      elements.primaryLabel.textContent = device.isEmbedded ? "使用浏览器打开" : "下载 Android 版";
      elements.primarySubLabel.textContent = device.isEmbedded ? `当前位于${device.embeddedName}内置浏览器` : "下载官方APK安装包";
      elements.actionNote.textContent = device.isEmbedded ? "请从右上角菜单选择“在浏览器打开”" : "下载完成后按系统提示允许安装";
      setInstallTip("安卓安装提示", device.isEmbedded ? "内置浏览器可能拦截APK，请切换系统浏览器。" : "如系统提示未知来源，请仅对当前浏览器授权。 ");
    } else {
      elements.downloadTitle.textContent = "电脑浏览器";
      elements.primaryLabel.textContent = "选择手机版本";
      elements.primarySubLabel.textContent = "支持 Android 与 iPhone / iPad";
      elements.actionNote.textContent = "建议直接使用手机打开本页面下载";
      setInstallTip("电脑访问提示", "请选择下方平台，或将本页地址发送到手机打开。 ");
    }

    elements.primaryAction.disabled = false;
  }

  function absoluteUrl(value) {
    try {
      return new URL(value, window.location.href).href;
    } catch (_error) {
      return value;
    }
  }

  function startAndroidDownload() {
    if (state.device.isEmbedded) {
      openBrowserGuide("android");
      return;
    }
    showToast("正在开始下载Android安装包…");
    window.setTimeout(() => {
      window.location.assign(absoluteUrl(state.config.androidApkUrl));
    }, 180);
  }

  function startIOSInstall() {
    if (state.device.isEmbedded || (state.device.isIOS && !state.device.isSafari)) {
      openBrowserGuide("ios");
      return;
    }
    openSheet(elements.iosSheet);
  }

  function openBrowserGuide(targetPlatform) {
    const isIOSGuide = targetPlatform === "ios" || state.device.isIOS;
    elements.browserSheetText.textContent = isIOSGuide
      ? "苹果描述文件需要使用Safari下载。请复制本页地址，再切换到Safari粘贴打开。"
      : "当前应用的内置浏览器可能拦截APK下载。请点击右上角菜单，选择在系统浏览器中打开。";
    elements.browserRoute.textContent = isIOSGuide ? "复制地址　→　打开 Safari　→　粘贴访问" : "右上角菜单　→　在浏览器中打开";
    openSheet(elements.browserSheet);
  }

  function openSheet(sheet) {
    closeSheets(true);
    state.activeSheet = sheet;
    elements.sheetBackdrop.hidden = false;
    sheet.hidden = false;
    document.body.classList.add("sheet-open");
    window.requestAnimationFrame(() => {
      elements.sheetBackdrop.classList.add("is-open");
      sheet.classList.add("is-open");
      const focusTarget = sheet.querySelector("button");
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    });
  }

  function closeSheets(immediate = false) {
    const sheets = [elements.iosSheet, elements.browserSheet];
    sheets.forEach((sheet) => sheet.classList.remove("is-open"));
    elements.sheetBackdrop.classList.remove("is-open");
    document.body.classList.remove("sheet-open");
    state.activeSheet = null;

    const finish = () => {
      sheets.forEach((sheet) => { sheet.hidden = true; });
      elements.sheetBackdrop.hidden = true;
    };
    if (immediate) finish();
    else window.setTimeout(finish, 220);
  }

  async function copyPageAddress() {
    const address = window.location.href;
    try {
      await navigator.clipboard.writeText(address);
      showToast("本页地址已复制，请在系统浏览器中打开");
      return;
    } catch (_error) {
      const input = document.createElement("textarea");
      input.value = address;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      showToast(copied ? "本页地址已复制，请在系统浏览器中打开" : "请长按浏览器地址栏复制本页地址");
    }
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
  }

  function handlePrimaryAction() {
    if (state.device.isIOS) {
      startIOSInstall();
    } else if (state.device.isAndroid) {
      startAndroidDownload();
    } else {
      showToast("请在下方选择 Android 或 iPhone 版本");
      elements.androidAction.focus();
    }
  }

  function bindEvents() {
    elements.primaryAction.addEventListener("click", handlePrimaryAction);
    elements.androidAction.addEventListener("click", startAndroidDownload);
    elements.iosAction.addEventListener("click", startIOSInstall);
    elements.sheetBackdrop.addEventListener("click", () => closeSheets());
    document.querySelectorAll("[data-close-sheet]").forEach((button) => button.addEventListener("click", () => closeSheets()));
    elements.downloadProfileAction.addEventListener("click", () => {
      showToast("正在下载8L描述文件…");
      window.setTimeout(() => window.location.assign(absoluteUrl(state.config.iosProfileUrl)), 160);
    });
    elements.copyAddressAction.addEventListener("click", copyPageAddress);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.activeSheet) closeSheets();
    });
    window.addEventListener("offline", () => showToast("网络已断开，请恢复网络后重试"));
    window.addEventListener("online", () => showToast("网络已恢复"));
  }

  async function boot() {
    state.device = detectDevice();
    createParticles();
    bindEvents();
    await loadConfig();
    renderDevice();
  }

  boot();
})();
