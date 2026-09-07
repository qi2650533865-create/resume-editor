const STORAGE_KEY = "resumepage:v1";
const MAX_UNDO_STEPS = 100;
const EDIT_GROUP_DELAY = 800;
const AUTO_SAVE_DELAY = 450;
const AVATAR_WIDTH = 380;
const AVATAR_HEIGHT = 476;
const MAX_AVATAR_FILE_SIZE = 10 * 1024 * 1024;
const DENSITY_LEVELS = ["normal", "compact", "tight", "ultra"];
const SECTION_TITLES = ["工作经历", "项目经历", "校园经历", "奖项经历", "其他经历"];
const TYPE_LABELS = {
  work: "工作",
  project: "项目",
  campus: "校园",
  award: "奖项",
  other: "其他"
};
const TYPE_TO_SECTION = {
  work: "工作经历",
  project: "项目经历",
  campus: "校园经历",
  award: "奖项经历",
  other: "其他经历"
};

const refs = {
  profileSelect: document.querySelector("#profileSelect"),
  statusText: document.querySelector("#statusText"),
  resumePage: document.querySelector("#resumePage"),
  fitStatus: document.querySelector("#fitStatus"),
  avatarInput: document.querySelector("#avatarInput")
};

let state = loadState();
let activeProfileId = state.profiles[0]?.id || "";
let dirty = false;
let fitTimer = 0;
let skipNextRender = false;
let selectedBullet = null;
let copiedBullet = null;
let bulletPointerDrag = null;
let undoStack = [];
let historyState = createHistorySnapshot();
let lastHistoryGroup = "";
let lastHistoryTime = 0;
let autoSaveTimer = 0;
let isRestoringHistory = false;

init();

function init() {
  renderAll();
  bindEvents();
  initTooltips();
  scheduleFit();
  setStatus("自动保存已开启");
}

function bindEvents() {
  // 自定义版本下拉：点击切换
  const selectTrigger = document.querySelector("#profileSelectTrigger");
  const selectWrap = document.querySelector("#profileSelectWrap");
  selectTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    selectWrap.classList.toggle("open");
  });
  // 版本项：单击切换，点编辑或删除图标管理版本
  const profileList = document.querySelector("#profileSelectList");
  
  profileList.addEventListener("click", (event) => {
    // 点击删除图标：删除指定版本
    const deleteBtn = event.target.closest(".item-delete");
    if (deleteBtn) {
      event.stopPropagation();
      deleteProfile(deleteBtn.dataset.deleteProfile);
      return;
    }
    // 点击编辑图标：重命名
    const editBtn = event.target.closest(".item-edit");
    if (editBtn) {
      event.stopPropagation();
      const profileId = editBtn.dataset.editProfile;
      const item = editBtn.closest(".custom-select-item");
      const labelEl = item.querySelector(".item-label");
      startRenameProfile(profileId, labelEl);
      return;
    }
    // 点击版本项：切换版本
    const item = event.target.closest(".custom-select-item");
    if (!item) return;
    if (item.querySelector(".rename-input")) return;
    activeProfileId = item.dataset.profileId;
    selectWrap.classList.remove("open");
    renderAll();
  });
  document.querySelector("#saveBtn").addEventListener("click", saveToBrowser);
  document.querySelector("#pdfBtn").addEventListener("click", exportPdf);
  document.querySelector("#printBtn").addEventListener("click", printResume);
  document.querySelector("#fitBtn").addEventListener("click", fitResume);
  document.querySelector("#layoutBtn").addEventListener("click", autoLayout);
  refs.avatarInput.addEventListener("change", handleAvatarUpload);

  // 下拉菜单：点击按钮切换
  document.querySelectorAll(".dropdown > button").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const dropdown = btn.closest(".dropdown");
      const wasOpen = dropdown.classList.contains("open");
      closeAllDropdowns();
      if (!wasOpen) dropdown.classList.add("open");
    });
  });

  // 点击其他地方关闭下拉菜单
  document.addEventListener("click", () => closeAllDropdowns());

  // 直接编辑：contenteditable 的 input 事件
  document.addEventListener("input", (event) => {
    const target = event.target.closest("[data-path][contenteditable='true']");
    if (!target) return;
    handleDirectEdit(target);
  });

  // 要点：点击选中、直接拖拽排序
  document.addEventListener("click", (event) => {
    const bullet = event.target.closest(".resume-bullet");
    if (!bullet) return;
    selectBullet(bullet);
    if (event.target === bullet) bullet.focus();
  });
  document.addEventListener("focusin", (event) => {
    const bullet = event.target.closest(".resume-bullet");
    if (bullet) selectBullet(bullet);
  });
  document.addEventListener("pointerdown", handleBulletPointerDown);
  document.addEventListener("pointermove", handleBulletPointerMove);
  document.addEventListener("pointerup", handleBulletPointerUp);
  document.addEventListener("pointercancel", cancelBulletPointerDrag);

  // 操作按钮
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    handleAction(button.dataset.action, button.dataset);
  });

  // 文本编辑及要点快捷键
  document.addEventListener("keydown", (event) => {
    const avatarTrigger = event.target.closest("[data-action='upload-avatar']");
    if (avatarTrigger && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openAvatarPicker();
      return;
    }
    const target = event.target.closest("[data-path][contenteditable='true']");
    const bullet = event.target.closest(".resume-bullet");
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      undoLastChange();
      return;
    }
    if (target && event.key === "Enter" && target.dataset.single === "true") {
      event.preventDefault();
      target.blur();
      return;
    }
    if (target && bullet && event.key === "Escape") {
      event.preventDefault();
      target.blur();
      bullet.focus();
      selectBullet(bullet);
      return;
    }
    if (!target && bullet && event.key === "Enter") {
      event.preventDefault();
      bullet.querySelector("[contenteditable='true']")?.focus();
      return;
    }
    handleBulletShortcut(event, target);
  });

  window.addEventListener("beforeunload", (event) => {
    if (dirty) persistState();
  });
  window.addEventListener("pagehide", () => {
    if (dirty) persistState();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty) persistState();
  });
  window.addEventListener("resize", scheduleFit);
  window.addEventListener("beforeprint", fitResume);
}

function closeAllDropdowns() {
  document.querySelectorAll(".dropdown.open").forEach((d) => d.classList.remove("open"));
  document.querySelectorAll(".custom-select.open").forEach((d) => d.classList.remove("open"));
}

// ===== 要点拖拽与快捷键 =====
function bulletMeta(element) {
  return {
    profileId: activeProfileId,
    entryIndex: Number(element.dataset.entry),
    bulletIndex: Number(element.dataset.bullet)
  };
}

function selectBullet(element) {
  document.querySelectorAll(".resume-bullet.is-selected").forEach((item) => item.classList.remove("is-selected"));
  element.classList.add("is-selected");
  selectedBullet = bulletMeta(element);
}

function getSelectedBullet() {
  if (!selectedBullet || selectedBullet.profileId !== activeProfileId) return null;
  const profile = getProfile();
  const entry = profile.entries[selectedBullet.entryIndex];
  if (!entry) return null;
  const item = resolveEntry(entry);
  const value = item.bullets?.[selectedBullet.bulletIndex];
  return typeof value === "string" ? { profile, entry, value, ...selectedBullet } : null;
}

function focusSelectedBullet() {
  if (!selectedBullet || selectedBullet.profileId !== activeProfileId) return;
  window.requestAnimationFrame(() => {
    const element = document.querySelector(`.resume-bullet[data-entry="${selectedBullet.entryIndex}"][data-bullet="${selectedBullet.bulletIndex}"]`);
    if (element) {
      selectBullet(element);
      element.focus();
    }
  });
}

function handleBulletShortcut(event, editableTarget) {
  const selected = getSelectedBullet();
  if (!selected) return;
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  const selection = window.getSelection();
  const hasTextSelection = Boolean(selection && !selection.isCollapsed && selection.toString());

  if (modifier && key === "c") {
    if (editableTarget && hasTextSelection) {
      copiedBullet = null;
      return;
    }
    event.preventDefault();
    copiedBullet = selected.value;
    setStatus("已复制要点，按 Ctrl+V 粘贴");
    return;
  }

  if (modifier && key === "v" && copiedBullet !== null) {
    event.preventDefault();
    ensureEntryCustomized(selected.profile, selected.entryIndex);
    const bullets = selected.profile.entries[selected.entryIndex].overrides.bullets;
    bullets.splice(selected.bulletIndex + 1, 0, copiedBullet);
    selectedBullet = { ...selectedBullet, bulletIndex: selected.bulletIndex + 1 };
    refreshAfterMutation("已粘贴要点");
    focusSelectedBullet();
    return;
  }

  if (event.key === "Delete" && !(editableTarget && hasTextSelection)) {
    event.preventDefault();
    ensureEntryCustomized(selected.profile, selected.entryIndex);
    const bullets = selected.profile.entries[selected.entryIndex].overrides.bullets;
    bullets.splice(selected.bulletIndex, 1);
    if (bullets.length) {
      selectedBullet = {
        ...selectedBullet,
        bulletIndex: Math.min(selected.bulletIndex, bullets.length - 1)
      };
    } else {
      selectedBullet = null;
    }
    refreshAfterMutation("已删除要点");
    focusSelectedBullet();
  }
}

function handleBulletPointerDown(event) {
  if (event.button !== 0) return;
  const bullet = event.target.closest(".resume-bullet");
  if (!bullet) return;
  bulletPointerDrag = {
    ...bulletMeta(bullet),
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    targetIndex: Number(bullet.dataset.bullet),
    insertAfter: false
  };
  bullet.setPointerCapture?.(event.pointerId);
}

function handleBulletPointerMove(event) {
  if (!bulletPointerDrag || event.pointerId !== bulletPointerDrag.pointerId) return;
  const distance = Math.hypot(event.clientX - bulletPointerDrag.startX, event.clientY - bulletPointerDrag.startY);
  if (!bulletPointerDrag.active && distance < 6) return;
  bulletPointerDrag.active = true;
  event.preventDefault();
  window.getSelection()?.removeAllRanges();
  document.body.classList.add("is-dragging-bullet");
  const source = document.querySelector(`.resume-bullet[data-entry="${bulletPointerDrag.entryIndex}"][data-bullet="${bulletPointerDrag.bulletIndex}"]`);
  source?.classList.add("is-dragging");
  clearBulletDropIndicators();
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".resume-bullet");
  if (!target || Number(target.dataset.entry) !== bulletPointerDrag.entryIndex) return;
  const rect = target.getBoundingClientRect();
  const after = event.clientY >= rect.top + rect.height / 2;
  target.classList.add(after ? "drop-after" : "drop-before");
  bulletPointerDrag.targetIndex = Number(target.dataset.bullet);
  bulletPointerDrag.insertAfter = after;
}

function handleBulletPointerUp(event) {
  if (!bulletPointerDrag || event.pointerId !== bulletPointerDrag.pointerId) return;
  const drag = bulletPointerDrag;
  bulletPointerDrag = null;
  document.body.classList.remove("is-dragging-bullet");
  document.querySelectorAll(".resume-bullet.is-dragging").forEach((item) => item.classList.remove("is-dragging"));
  clearBulletDropIndicators();
  if (!drag.active) return;
  event.preventDefault();
  const profile = getProfile();
  const entryIndex = drag.entryIndex;
  const fromIndex = drag.bulletIndex;
  let insertIndex = drag.targetIndex + (drag.insertAfter ? 1 : 0);
  ensureEntryCustomized(profile, entryIndex);
  const bullets = profile.entries[entryIndex]?.overrides?.bullets;
  if (!bullets) return;
  const [moved] = bullets.splice(fromIndex, 1);
  if (fromIndex < insertIndex) insertIndex -= 1;
  insertIndex = Math.max(0, Math.min(insertIndex, bullets.length));
  bullets.splice(insertIndex, 0, moved);
  selectedBullet = { profileId: activeProfileId, entryIndex, bulletIndex: insertIndex };
  refreshAfterMutation("已调整要点顺序");
  focusSelectedBullet();
}

function cancelBulletPointerDrag() {
  bulletPointerDrag = null;
  document.body.classList.remove("is-dragging-bullet");
  document.querySelectorAll(".resume-bullet.is-dragging").forEach((item) => item.classList.remove("is-dragging"));
  clearBulletDropIndicators();
}

function clearBulletDropIndicators() {
  document.querySelectorAll(".resume-bullet.drop-before, .resume-bullet.drop-after")
    .forEach((item) => item.classList.remove("drop-before", "drop-after"));
}

// ===== 版本拖拽排序 =====
let dragProfileIndex = null;

function bindProfileDragEvents() {
  const items = document.querySelectorAll("#profileSelectList .custom-select-item");
  items.forEach((item) => {
    item.addEventListener("dragstart", (event) => {
      dragProfileIndex = Number(item.dataset.index);
      item.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      document.querySelectorAll("#profileSelectList .custom-select-item").forEach((i) => i.classList.remove("drag-over"));
      item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const targetIndex = Number(item.dataset.index);
      if (dragProfileIndex !== null && dragProfileIndex !== targetIndex) {
        moveProfile(dragProfileIndex, targetIndex);
      }
      item.classList.remove("drag-over");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      document.querySelectorAll("#profileSelectList .custom-select-item").forEach((i) => i.classList.remove("drag-over"));
      dragProfileIndex = null;
    });
  });
}

function moveProfile(fromIndex, toIndex) {
  const [moved] = state.profiles.splice(fromIndex, 1);
  state.profiles.splice(toIndex, 0, moved);
  markDirty("已调整版本顺序");
  renderProfileSelect();
  scheduleFit();
}

// ===== 双击重命名版本 =====
function startRenameProfile(profileId, labelEl) {
  const profile = state.profiles.find((p) => p.id === profileId);
  if (!profile) return;
  
  // 创建输入框
  const input = document.createElement("input");
  input.type = "text";
  input.value = profile.label;
  input.className = "rename-input";
  input.style.width = "100%";
  input.style.padding = "4px 6px";
  input.style.border = "1px solid var(--accent-2)";
  input.style.borderRadius = "4px";
  input.style.fontSize = "13px";
  input.style.outline = "none";
  
  // 替换文本
  labelEl.style.display = "none";
  labelEl.parentNode.insertBefore(input, labelEl.nextSibling);
  input.focus();
  input.select();
  
  const finishRename = (save) => {
    if (save) {
      const newName = input.value.trim();
      if (newName && newName !== profile.label) {
        profile.label = uniqueProfileLabel(newName, profile.id);
        markDirty("已重命名版本");
        if (profile.id === activeProfileId) {
          document.querySelector("#profileSelectLabel").textContent = profile.label;
        }
      }
    }
    input.remove();
    labelEl.style.display = "";
    renderProfileSelect();
  };
  
  input.addEventListener("blur", () => finishRename(true));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishRename(false);
    }
  });
}


// ===== Tooltip 功能提示（3秒延迟显示）=====
let tooltipTimer = 0;
let tooltipEl = null;

function initTooltips() {
  document.addEventListener("mouseover", (event) => {
    const target = event.target.closest("[data-tooltip]");
    if (!target) return;
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => showTooltip(target), 2000);
  });
  document.addEventListener("mouseout", (event) => {
    const target = event.target.closest("[data-tooltip]");
    if (!target) return;
    clearTimeout(tooltipTimer);
    hideTooltip();
  });
}

function showTooltip(target) {
  const text = target.dataset.tooltip;
  if (!text) return;
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "tooltip-bubble";
    document.body.appendChild(tooltipEl);
  }
  tooltipEl.textContent = text;
  const rect = target.getBoundingClientRect();
  tooltipEl.style.left = Math.max(8, rect.left + rect.width / 2 - tooltipEl.offsetWidth / 2) + "px";
  tooltipEl.style.top = (rect.bottom + 8) + "px";
  requestAnimationFrame(() => tooltipEl.classList.add("show"));
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.classList.remove("show");
}

// ===== 状态加载与迁移 =====
function loadState() {
  const fallback = migrateToV2(clone(window.RESUME_TOOL_INITIAL_DATA || {}));
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    return migrateToV2(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

function migrateToV2(input) {
  const data = Array.isArray(input) ? { version: 1, profiles: input } : clone(input || {});
  if (data.version === 2 && data.shared && data.library && Array.isArray(data.profiles)) {
    return normalizeV2State(data);
  }
  return migrateV1ToV2(data);
}

function migrateV1ToV2(input) {
  const sourceProfiles = Array.isArray(input.profiles) ? input.profiles : [];
  const normalizedProfiles = sourceProfiles.length
    ? sourceProfiles.map(normalizeV1Profile)
    : [normalizeV1Profile({ label: "默认简历" })];
  const first = normalizedProfiles[0];
  const libraryItems = [];
  const itemIdByKey = new Map();
  const profiles = normalizedProfiles.map((profile, profileIndex) => {
    const entries = [];
    (profile.sections || []).forEach((section) => {
      const sectionTitle = section.title || sectionTitleFromType("other");
      const type = typeFromSectionTitle(sectionTitle);
      (section.items || []).forEach((item) => {
        const normalizedItem = normalizeLibraryItem({ ...item, type });
        const key = libraryKey(normalizedItem);
        let libraryId = itemIdByKey.get(key);
        if (!libraryId) {
          libraryId = normalizedItem.id || uid("item");
          itemIdByKey.set(key, libraryId);
          libraryItems.push({ ...normalizedItem, id: libraryId });
        }
        entries.push({
          id: uid("entry"),
          libraryId,
          sectionTitle,
          enabled: true,
          customized: true,
          overrides: pickItemFields(normalizedItem)
        });
      });
    });
    return {
      id: profile.id || `profile-${profileIndex + 1}`,
      label: profile.label || `版本 ${profileIndex + 1}`,
      target: profile.target || "",
      sourcePdf: profile.sourcePdf || "",
      entries,
      skillOverrides: skillsEqual(profile.skills, first.skills) ? null : clone(profile.skills)
    };
  });
  return normalizeV2State({
    version: 2,
    updatedAt: input.updatedAt || new Date().toISOString(),
    shared: {
      basics: first.basics,
      education: first.education,
      skills: first.skills
    },
    library: {
      items: libraryItems
    },
    profiles
  });
}

function normalizeV1Profile(profile) {
  return {
    id: profile.id || "",
    label: profile.label || "",
    target: profile.target || "",
    sourcePdf: profile.sourcePdf || "",
    basics: {
      name: "",
      phone: "",
      email: "",
      wechat: "",
      availability: "",
      avatar: "",
      ...(profile.basics || {})
    },
    education: {
      school: "",
      degree: "",
      major: "",
      period: "",
      details: "",
      ...(profile.education || {})
    },
    sections: Array.isArray(profile.sections) ? profile.sections : [],
    skills: normalizeSkills(profile.skills)
  };
}

function normalizeV2State(input) {
  const next = clone(input || {});
  const shared = next.shared || {};
  const library = next.library || {};
  next.version = 2;
  next.updatedAt = next.updatedAt || new Date().toISOString();
  next.shared = {
    basics: {
      name: "",
      phone: "",
      email: "",
      wechat: "",
      availability: "",
      avatar: "",
      ...(shared.basics || {})
    },
    education: {
      school: "",
      degree: "",
      major: "",
      period: "",
      details: "",
      ...(shared.education || {})
    },
    skills: normalizeSkills(shared.skills)
  };
  next.library = {
    items: Array.isArray(library.items) ? library.items.map(normalizeLibraryItem) : []
  };
  next.profiles = Array.isArray(next.profiles) && next.profiles.length
    ? next.profiles.map(normalizeProfileV2)
    : [blankProfile("默认简历")];
  return next;
}

function normalizeProfileV2(profile, index = 0) {
  return {
    id: profile.id || `profile-${index + 1}`,
    label: profile.label || `版本 ${index + 1}`,
    target: profile.target || "",
    sourcePdf: profile.sourcePdf || "",
    entries: Array.isArray(profile.entries) ? profile.entries.map(normalizeEntry) : [],
    skillOverrides: Array.isArray(profile.skillOverrides) ? normalizeSkills(profile.skillOverrides) : null
  };
}

function normalizeEntry(entry) {
  return {
    id: entry.id || uid("entry"),
    libraryId: entry.libraryId || "",
    sectionTitle: entry.sectionTitle || "",
    enabled: entry.enabled !== false,
    customized: entry.customized === true,
    overrides: normalizeItemOverrides(entry.overrides || {})
  };
}

function normalizeLibraryItem(item) {
  return {
    id: item.id || uid("item"),
    type: item.type || "project",
    title: item.title || "",
    role: item.role || "",
    period: item.period || "",
    tags: Array.isArray(item.tags) ? item.tags : parseTags(item.tags || ""),
    bullets: Array.isArray(item.bullets) ? item.bullets.filter(Boolean) : splitLines(item.bullets || "")
  };
}

function normalizeItemOverrides(overrides) {
  const next = {};
  ["title", "role", "period"].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(overrides, field)) next[field] = overrides[field] || "";
  });
  if (Object.prototype.hasOwnProperty.call(overrides, "tags")) {
    next.tags = Array.isArray(overrides.tags) ? overrides.tags : parseTags(overrides.tags || "");
  }
  if (Object.prototype.hasOwnProperty.call(overrides, "bullets")) {
    next.bullets = Array.isArray(overrides.bullets) ? overrides.bullets.filter(Boolean) : splitLines(overrides.bullets || "");
  }
  return next;
}

// ===== 保存与输出 =====
function saveToBrowser() {
  persistState("已保存到浏览器");
}

function resetToInitial() {
  const ok = window.confirm("恢复初始数据会覆盖当前浏览器草稿。");
  if (!ok) return;
  state = migrateToV2(clone(window.RESUME_TOOL_INITIAL_DATA || {}));
  activeProfileId = state.profiles[0]?.id || "";
  localStorage.removeItem(STORAGE_KEY);
  markDirty("已恢复初始");
  renderAll();
  persistState("已恢复初始");
}

function exportPdf() {
  fitResume();
  persistState();
  const previousTitle = document.title;
  const date = new Date().toISOString().slice(0, 10);
  document.title = safeFilePart(`${getProfile().label}-简历-${date}`);
  setStatus("请在系统窗口选择“另存为 PDF”");
  try {
    window.print();
  } finally {
    document.title = previousTitle;
  }
}

function printResume() {
  fitResume();
  persistState();
  setStatus("请选择打印机完成打印");
  window.print();
}

// ===== 版本管理 =====
function createBlankProfile() {
  const label = window.prompt("新简历版本名称", "新岗位简历");
  if (!label) return;
  const profile = blankProfile(label.trim() || "新岗位简历");
  profile.id = uniqueProfileId(profile.id);
  profile.label = uniqueProfileLabel(profile.label);
  state.profiles.push(profile);
  activeProfileId = profile.id;
  refreshAfterMutation("已新建空白版本");
}

function duplicateCurrentProfile() {
  const current = getProfile();
  const label = window.prompt("复制后的版本名称", `${current.label} 副本`);
  if (!label) return;
  const copy = clone(current);
  copy.id = uniqueProfileId(uid("profile"));
  copy.label = uniqueProfileLabel(label.trim() || `${current.label} 副本`);
  copy.entries = copy.entries.map((entry) => ({ ...entry, id: uid("entry") }));
  state.profiles.push(copy);
  activeProfileId = copy.id;
  refreshAfterMutation("已复制当前版本");
}

function renameCurrentProfile() {
  const profile = getProfile();
  const label = window.prompt("版本新名称", profile.label);
  if (!label) return;
  profile.label = uniqueProfileLabel(label.trim() || profile.label, profile.id);
  refreshAfterMutation("已重命名版本");
}

function deleteProfile(profileId = activeProfileId) {
  if (state.profiles.length <= 1) {
    setStatus("至少保留一个简历版本");
    return;
  }
  const index = state.profiles.findIndex((item) => item.id === profileId);
  if (index < 0) return;
  const profile = state.profiles[index];
  const ok = window.confirm(`删除“${profile.label}”？这只会删除这个岗位版本，不会删除素材库。`);
  if (!ok) return;
  state.profiles.splice(index, 1);
  if (profileId === activeProfileId) {
    activeProfileId = state.profiles[Math.min(index, state.profiles.length - 1)]?.id || "";
  }
  closeAllDropdowns();
  refreshAfterMutation("已删除版本");
}

function deleteCurrentProfile() {
  deleteProfile(activeProfileId);
}

// ===== 渲染 =====
function renderAll() {
  renderProfileSelect();
  renderPreview();
  scheduleFit();
}

function renderProfileSelect() {
  const current = getProfile();
  document.querySelector("#profileSelectLabel").textContent = current.label;
  const list = document.querySelector("#profileSelectList");
  list.innerHTML = state.profiles
    .map((profile, index) => `
      <div class="custom-select-item ${profile.id === activeProfileId ? "active" : ""}"
           draggable="true"
           data-profile-id="${escapeAttr(profile.id)}"
           data-index="${index}">
        <span class="drag-handle">⋮⋮</span>
        <span class="item-label">${escapeHtml(profile.label)}</span>
        <button type="button" class="item-edit" data-edit-profile="${escapeAttr(profile.id)}" title="重命名">✎</button>
        <button type="button" class="item-delete" data-delete-profile="${escapeAttr(profile.id)}" title="删除版本" aria-label="删除${escapeAttr(profile.label)}">×</button>
        ${profile.id === activeProfileId ? '<span class="item-check">✓</span>' : ""}
      </div>
    `)
    .join("");
  bindProfileDragEvents();
}

function renderPreview() {
  const profile = getProfile();
  const resolved = resolveProfile(profile);

  refs.resumePage.innerHTML = `
    <div class="resume-inner">
      <header class="resume-header">
        <h1 class="resume-name" contenteditable="true" data-path="shared.basics.name" data-single="true">${escapeHtml(resolved.basics.name)}</h1>
        <div class="contact-grid">
          ${contactItem("手机号码", resolved.basics.phone, "shared.basics.phone")}
          ${contactItem("微信", resolved.basics.wechat, "shared.basics.wechat")}
          ${contactItem("邮箱", resolved.basics.email, "shared.basics.email")}
        </div>
        <div class="availability" contenteditable="true" data-path="shared.basics.availability">${escapeHtml(resolved.basics.availability || "")}</div>
        <div class="avatar-frame${resolved.basics.avatar ? "" : " avatar-placeholder"}" role="button" tabindex="0" data-action="upload-avatar" aria-label="上传简历照片，支持 PNG、JPG，单张不超过 10MB" data-tooltip="点击上传照片 · 支持 PNG/JPG · 单张不超过 10MB">
          ${resolved.basics.avatar
            ? `<img src="${escapeAttr(resolved.basics.avatar)}" alt="简历照片">`
            : '<span aria-label="照片占位">照片</span>'}
        </div>
      </header>
      <div class="resume-body">
        <main class="resume-flow">
          ${renderEducation(resolved.education)}
          ${renderResumeSections(resolved.sections, profile)}
          ${renderSkills(resolved.skills, profile)}
          <button class="add-section-btn" type="button" data-action="add-section">+ 添加新区块</button>
        </main>
      </div>
    </div>
  `;
}

function contactItem(label, value, path) {
  if (!value) {
    return `<span contenteditable="true" data-path="${path}" data-single="true" data-placeholder="${label}">${escapeHtml(label)}：</span>`;
  }
  return `<span contenteditable="true" data-path="${path}" data-single="true">${escapeHtml(label)}：${escapeHtml(value)}</span>`;
}

function renderEducation(education) {
  const details = splitLines(education.details);
  return `
    <section class="resume-section education-section" data-section-type="education">
      <h2 contenteditable="true" data-path="education.title" data-single="true">教育背景</h2>
      <article class="resume-item education-item">
        <div class="item-head">
          <div class="education-line">
            <div class="education-school"><span contenteditable="true" data-path="shared.education.school" data-single="true">${escapeHtml(education.school)}</span> <span contenteditable="true" data-path="shared.education.degree" data-single="true">${escapeHtml(education.degree)}</span></div>
            <div class="education-major" contenteditable="true" data-path="shared.education.major" data-single="true">${escapeHtml(education.major)}</div>
            <div class="education-period" contenteditable="true" data-path="shared.education.period" data-single="true">${escapeHtml(education.period)}</div>
          </div>
        </div>
        <div class="education-details">
          ${details.map((line, i) => `<p contenteditable="true" data-path="shared.education.details.${i}">${escapeHtml(line)}</p>`).join("")}
          <button class="add-item-btn" type="button" data-action="add-education-detail">+ 添加一行</button>
        </div>
      </article>
    </section>
  `;
}

function renderResumeSections(sections, profile) {
  return sections.map((section) => {
    const entryIndexes = getEntryIndexesForSection(profile, section.title);
    return `
      <section class="resume-section" data-section-title="${escapeAttr(section.title)}">
        <div class="section-hover-bar">
          <button type="button" data-action="rename-section" data-section-title="${escapeAttr(section.title)}">重命名</button>
          <button type="button" data-action="move-section" data-section-title="${escapeAttr(section.title)}" data-dir="-1">上移</button>
          <button type="button" data-action="move-section" data-section-title="${escapeAttr(section.title)}" data-dir="1">下移</button>
          <button type="button" class="danger" data-action="delete-section" data-section-title="${escapeAttr(section.title)}">删除区块</button>
        </div>
        <h2 contenteditable="true" data-path="section.title.${escapeAttr(section.title)}" data-single="true">${escapeHtml(section.title)}</h2>
        ${section.items.map((item, itemIndex) => renderResumeItem(item, section.title, entryIndexes[itemIndex])).join("")}
        <button class="add-item-btn" type="button" data-action="add-item" data-section-title="${escapeAttr(section.title)}">+ 添加经历</button>
      </section>
    `;
  }).join("");
}

function renderResumeItem(item, sectionTitle, entryIndex) {
  return `
    <article class="resume-item" data-entry-index="${entryIndex}">
      <div class="item-hover-bar">
        <button type="button" data-action="move-item" data-entry="${entryIndex}" data-dir="-1">上移</button>
        <button type="button" data-action="move-item" data-entry="${entryIndex}" data-dir="1">下移</button>
        <button type="button" data-action="duplicate-item" data-entry="${entryIndex}">复制</button>
        <button type="button" class="danger" data-action="delete-item" data-entry="${entryIndex}">删除</button>
      </div>
      <div class="item-head">
        <div class="item-line">
          <div class="item-period" contenteditable="true" data-path="entry.${entryIndex}.overrides.period" data-single="true">${escapeHtml(item.period || "")}</div>
          <div class="item-title-preview" contenteditable="true" data-path="entry.${entryIndex}.overrides.title" data-single="true">${escapeHtml(item.title || "")}</div>
          <div class="item-role-preview" contenteditable="true" data-path="entry.${entryIndex}.overrides.role" data-single="true">${escapeHtml(item.role || "")}</div>
        </div>
      </div>
      <ul>
        ${(item.bullets || []).filter(Boolean).map((bullet, bulletIndex) => `
          <li class="resume-bullet ${selectedBullet?.profileId === activeProfileId && selectedBullet.entryIndex === entryIndex && selectedBullet.bulletIndex === bulletIndex ? "is-selected" : ""}"
              tabindex="0" data-entry="${entryIndex}" data-bullet="${bulletIndex}"
              aria-label="要点 ${bulletIndex + 1}，可拖动排序" title="拖动排序；选中后 Ctrl+C/V 复制，Delete 删除">
            <span contenteditable="true" data-path="entry.${entryIndex}.overrides.bullets.${bulletIndex}">${formatBullet(bullet)}</span>
          </li>
        `).join("")}
      </ul>
      <button class="add-item-btn" type="button" data-action="add-bullet" data-entry="${entryIndex}">+ 添加要点</button>
    </article>
  `;
}

function renderSkills(skills, profile) {
  if (!skills || skills.length === 0) {
    return `
      <section class="resume-section skills-section">
        <h2>其他信息</h2>
        <button class="add-item-btn" type="button" data-action="add-skill">+ 添加一行</button>
      </section>
    `;
  }
  const skillPathPrefix = profile.skillOverrides ? "profile.skillOverrides" : "shared.skills";
  return `
    <section class="resume-section skills-section">
      <h2>其他信息</h2>
      <div class="skill-list">
        ${skills.map((skill, skillIndex) => `
          <div class="skill-item" data-skill="${skillIndex}">
            <div class="bullet-hover-bar" style="top:-2px;transform:translate(100%,-4px)">
              <button type="button" data-action="move-skill" data-skill="${skillIndex}" data-dir="-1">上</button>
              <button type="button" data-action="move-skill" data-skill="${skillIndex}" data-dir="1">下</button>
              <button type="button" class="danger" data-action="delete-skill" data-skill="${skillIndex}">删</button>
            </div>
            <strong contenteditable="true" data-path="${skillPathPrefix}.${skillIndex}.label" data-single="true">${escapeHtml(skill.label)}</strong>
            <span contenteditable="true" data-path="${skillPathPrefix}.${skillIndex}.text">${escapeHtml(skill.text)}</span>
          </div>
        `).join("")}
      </div>
      <button class="add-item-btn" type="button" data-action="add-skill">+ 添加一行</button>
    </section>
  `;
}

// ===== 直接编辑处理 =====
function handleDirectEdit(target) {
  const path = target.dataset.path;
  const value = target.innerText;
  const profile = getProfile();

  // 解析路径并更新数据
  if (path.startsWith("shared.basics.")) {
    const field = path.replace("shared.basics.", "");
    // 联系方式特殊处理：去掉前缀标签
    if (["phone", "wechat", "email"].includes(field)) {
      state.shared.basics[field] = stripContactLabel(value, field);
    } else {
      state.shared.basics[field] = value;
    }
  } else if (path.startsWith("shared.education.")) {
    const field = path.replace("shared.education.", "");
    if (field.startsWith("details.")) {
      const index = Number(field.split(".")[1]);
      const details = splitLines(state.shared.education.details);
      details[index] = value;
      state.shared.education.details = details.join("\n");
    } else if (field === "school") {
      // school 字段可能包含 degree，需要分离
      state.shared.education.school = value;
    } else {
      state.shared.education[field] = value;
    }
  } else if (path.startsWith("shared.skills.") || path.startsWith("profile.skillOverrides.")) {
    const prefix = path.startsWith("shared.skills.") ? "shared.skills" : "profile.skillOverrides";
    const rest = path.replace(prefix + ".", "");
    const index = Number(rest.split(".")[0]);
    const field = rest.split(".")[1];
    const skills = prefix === "shared.skills" ? state.shared.skills : profile.skillOverrides;
    if (skills && skills[index]) {
      skills[index][field] = value;
    }
  } else if (path.startsWith("entry.")) {
    const parts = path.split(".");
    const entryIndex = Number(parts[1]);
    const field = parts.slice(2).join(".");
    ensureEntryCustomized(profile, entryIndex);
    const entry = profile.entries[entryIndex];
    if (!entry) return;

    if (field.startsWith("overrides.bullets.")) {
      const bulletIndex = Number(field.replace("overrides.bullets.", ""));
      if (!entry.overrides.bullets) entry.overrides.bullets = [];
      // 处理 【...】 格式
      entry.overrides.bullets[bulletIndex] = stripBulletFormat(value);
    } else if (field.startsWith("overrides.")) {
      const overrideField = field.replace("overrides.", "");
      entry.overrides[overrideField] = value;
    } else if (field === "sectionTitle") {
      entry.sectionTitle = value;
    }
  } else if (path.startsWith("section.title.")) {
    const oldTitle = path.replace("section.title.", "");
    renameSection(oldTitle, value);
  } else if (path === "education.title") {
    // 教育背景标题固定，不处理
  }

  markDirty("有未保存修改", `edit:${path}`);
  scheduleFit();
}

function stripContactLabel(value, field) {
  const labels = { phone: "手机号码：", wechat: "微信：", email: "邮箱：" };
  const label = labels[field] || "";
  if (value.startsWith(label)) return value.slice(label.length);
  return value;
}

function stripBulletFormat(html) {
  // 移除 contenteditable 可能产生的 HTML 标签，保留 【...】 格式
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

function openAvatarPicker() {
  refs.avatarInput.value = "";
  refs.avatarInput.click();
}

async function handleAvatarUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const supportedType = file.type === "image/png" || file.type === "image/jpeg";
  const supportedExtension = extension === "png" || extension === "jpg" || extension === "jpeg";

  if (!supportedExtension || (file.type && !supportedType)) {
    window.alert("请选择 PNG、JPG 或 JPEG 格式的照片。");
    event.target.value = "";
    return;
  }
  if (file.size > MAX_AVATAR_FILE_SIZE) {
    window.alert("照片文件不能超过 10MB，请压缩后重试。");
    event.target.value = "";
    return;
  }

  setStatus("正在处理照片...");
  try {
    state.shared.basics.avatar = await resizeAvatar(file);
    refreshAfterMutation("照片已上传并自动适配");
  } catch {
    setStatus("照片读取失败，请换一张图片重试");
    window.alert("照片读取失败，请确认图片文件可以正常打开。");
  } finally {
    event.target.value = "";
  }
}

async function resizeAvatar(file) {
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_WIDTH;
  canvas.height = AVATAR_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");

  const scale = Math.max(AVATAR_WIDTH / image.naturalWidth, AVATAR_HEIGHT / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const x = (AVATAR_WIDTH - width) / 2;
  const y = (AVATAR_HEIGHT - height) / 2;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
  context.drawImage(image, x, y, width, height);

  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  return canvas.toDataURL(outputType, 0.9);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image decode failed"));
    image.src = source;
  });
}

function ensureEntryCustomized(profile, entryIndex) {
  const entry = profile.entries[entryIndex];
  if (!entry || entry.customized === true) return;
  entry.customized = true;
  entry.overrides = pickItemFields(resolveEntry({ ...entry, customized: false, overrides: {} }));
}

function getEntryIndexesForSection(profile, sectionTitle) {
  const indexes = [];
  profile.entries.forEach((entry, index) => {
    if (entry.enabled === false) return;
    const item = resolveEntry(entry);
    const title = entry.sectionTitle || sectionTitleFromType(item.type);
    if (title === sectionTitle) indexes.push(index);
  });
  return indexes;
}

// ===== 操作处理 =====
function handleAction(action, dataset) {
  const profile = getProfile();

  // 顶部工具栏操作
  if (action === "upload-avatar") { openAvatarPicker(); return; }
  if (action === "new-blank") { closeAllDropdowns(); createBlankProfile(); return; }
  if (action === "duplicate-profile") { closeAllDropdowns(); duplicateCurrentProfile(); return; }
  if (action === "rename-profile") { closeAllDropdowns(); renameCurrentProfile(); return; }
  if (action === "delete-profile") { closeAllDropdowns(); deleteCurrentProfile(); return; }
  if (action === "reset-data") { closeAllDropdowns(); resetToInitial(); return; }

  // 经历操作
  if (action === "add-item") {
    const sectionTitle = dataset.sectionTitle || "其他经历";
    const newEntry = {
      id: uid("entry"),
      libraryId: "",
      sectionTitle,
      enabled: true,
      customized: true,
      overrides: {
        title: "新经历",
        role: "",
        period: "",
        tags: [],
        bullets: ["填写这段经历的要点。"]
      }
    };
    // 插入到同区块的最后
    const sectionIndexes = getEntryIndexesForSection(profile, sectionTitle);
    const lastIndex = sectionIndexes.length ? sectionIndexes[sectionIndexes.length - 1] : profile.entries.length - 1;
    profile.entries.splice(lastIndex + 1, 0, newEntry);
    refreshAfterMutation("已添加经历");
    return;
  }

  if (action === "delete-item") {
    const entryIndex = Number(dataset.entry);
    const entry = profile.entries[entryIndex];
    if (!entry) return;
    const ok = window.confirm("删除这段经历？");
    if (!ok) return;
    profile.entries.splice(entryIndex, 1);
    refreshAfterMutation("已删除经历");
    return;
  }

  if (action === "move-item") {
    const entryIndex = Number(dataset.entry);
    const dir = Number(dataset.dir);
    // 在同区块内移动
    const entry = profile.entries[entryIndex];
    if (!entry) return;
    const sectionTitle = entry.sectionTitle;
    const sectionIndexes = getEntryIndexesForSection(profile, sectionTitle);
    const posInSection = sectionIndexes.indexOf(entryIndex);
    const targetPos = posInSection + dir;
    if (targetPos < 0 || targetPos >= sectionIndexes.length) return;
    const targetEntryIndex = sectionIndexes[targetPos];
    const [moved] = profile.entries.splice(entryIndex, 1);
    const newTargetIndex = profile.entries.indexOf(profile.entries.find(e => e.id === profile.entries[Math.min(entryIndex, targetEntryIndex)]?.id) || profile.entries[targetEntryIndex]);
    // 简化：直接在数组中交换位置
    const actualTarget = targetEntryIndex > entryIndex ? targetEntryIndex - 1 : targetEntryIndex;
    profile.entries.splice(actualTarget, 0, moved);
    refreshAfterMutation("已调整经历顺序");
    return;
  }

  if (action === "duplicate-item") {
    const entryIndex = Number(dataset.entry);
    const entry = profile.entries[entryIndex];
    if (!entry) return;
    const copy = clone(entry);
    copy.id = uid("entry");
    profile.entries.splice(entryIndex + 1, 0, copy);
    refreshAfterMutation("已复制经历");
    return;
  }

  // 要点操作
  if (action === "add-bullet") {
    const entryIndex = Number(dataset.entry);
    ensureEntryCustomized(profile, entryIndex);
    const entry = profile.entries[entryIndex];
    if (!entry) return;
    if (!entry.overrides.bullets) entry.overrides.bullets = [];
    entry.overrides.bullets.push("新要点");
    refreshAfterMutation("已添加要点");
    return;
  }

  if (action === "delete-bullet") {
    const entryIndex = Number(dataset.entry);
    const bulletIndex = Number(dataset.index);
    ensureEntryCustomized(profile, entryIndex);
    const entry = profile.entries[entryIndex];
    if (!entry || !entry.overrides.bullets) return;
    entry.overrides.bullets.splice(bulletIndex, 1);
    refreshAfterMutation("已删除要点");
    return;
  }

  if (action === "move-bullet") {
    const entryIndex = Number(dataset.entry);
    const bulletIndex = Number(dataset.index);
    const dir = Number(dataset.dir);
    ensureEntryCustomized(profile, entryIndex);
    const entry = profile.entries[entryIndex];
    if (!entry || !entry.overrides.bullets) return;
    moveArrayItem(entry.overrides.bullets, bulletIndex, dir);
    refreshAfterMutation("已调整要点顺序");
    return;
  }

  if (action === "duplicate-bullet") {
    const entryIndex = Number(dataset.entry);
    const bulletIndex = Number(dataset.index);
    ensureEntryCustomized(profile, entryIndex);
    const entry = profile.entries[entryIndex];
    if (!entry || !entry.overrides.bullets) return;
    entry.overrides.bullets.splice(bulletIndex + 1, 0, entry.overrides.bullets[bulletIndex] || "");
    refreshAfterMutation("已复制要点");
    return;
  }

  // 区块操作
  if (action === "add-section") {
    const title = window.prompt("新区块名称", "其他经历");
    if (!title) return;
    const newEntry = {
      id: uid("entry"),
      libraryId: "",
      sectionTitle: title.trim(),
      enabled: true,
      customized: true,
      overrides: {
        title: "新经历",
        role: "",
        period: "",
        tags: [],
        bullets: ["填写这段经历的要点。"]
      }
    };
    profile.entries.push(newEntry);
    refreshAfterMutation("已添加新区块");
    return;
  }

  if (action === "rename-section") {
    const oldTitle = dataset.sectionTitle;
    const newTitle = window.prompt("区块新名称", oldTitle);
    if (!newTitle) return;
    renameSection(oldTitle, newTitle.trim());
    refreshAfterMutation("已重命名区块");
    return;
  }

  if (action === "delete-section") {
    const sectionTitle = dataset.sectionTitle;
    const ok = window.confirm(`删除“${sectionTitle}”区块？该区块下的所有经历都会被删除。`);
    if (!ok) return;
    profile.entries = profile.entries.filter((entry) => {
      const item = resolveEntry(entry);
      const title = entry.sectionTitle || sectionTitleFromType(item.type);
      return title !== sectionTitle;
    });
    refreshAfterMutation("已删除区块");
    return;
  }

  if (action === "move-section") {
    const sectionTitle = dataset.sectionTitle;
    const dir = Number(dataset.dir);
    // 获取所有区块按当前顺序
    const sections = [];
    const seen = new Set();
    profile.entries.forEach((entry) => {
      if (entry.enabled === false) return;
      const item = resolveEntry(entry);
      const title = entry.sectionTitle || sectionTitleFromType(item.type);
      if (!seen.has(title)) {
        seen.add(title);
        sections.push(title);
      }
    });
    const pos = sections.indexOf(sectionTitle);
    const targetPos = pos + dir;
    if (targetPos < 0 || targetPos >= sections.length) return;
    const targetTitle = sections[targetPos];
    // 交换两个区块的所有 entry 位置
    const sectionEntries = sections.map((t) => profile.entries.filter((e) => {
      const item = resolveEntry(e);
      return (e.sectionTitle || sectionTitleFromType(item.type)) === t;
    }));
    const otherEntries = profile.entries.filter((e) => {
      const item = resolveEntry(e);
      const t = e.sectionTitle || sectionTitleFromType(item.type);
      return t !== sectionTitle && t !== targetTitle;
    });
    // 重建 entries 数组
    const newEntries = [];
    sections.forEach((t, i) => {
      if (t === sectionTitle) {
        newEntries.push(...sectionEntries[targetPos]);
      } else if (t === targetTitle) {
        newEntries.push(...sectionEntries[pos]);
      } else {
        newEntries.push(...sectionEntries[i]);
      }
    });
    // 把 disabled 的 entries 也加回来
    profile.entries.filter((e) => e.enabled === false).forEach((e) => newEntries.push(e));
    profile.entries = newEntries;
    refreshAfterMutation("已调整区块顺序");
    return;
  }

  // 其他信息操作
  if (action === "add-skill") {
    if (profile.skillOverrides) {
      profile.skillOverrides.push({ id: uid("skill"), label: "新标签", text: "填写内容" });
    } else {
      state.shared.skills.push({ id: uid("skill"), label: "新标签", text: "填写内容" });
    }
    refreshAfterMutation("已添加其他信息");
    return;
  }

  if (action === "delete-skill") {
    const skillIndex = Number(dataset.skill);
    const skills = profile.skillOverrides || state.shared.skills;
    skills.splice(skillIndex, 1);
    refreshAfterMutation("已删除其他信息");
    return;
  }

  if (action === "move-skill") {
    const skillIndex = Number(dataset.skill);
    const dir = Number(dataset.dir);
    const skills = profile.skillOverrides || state.shared.skills;
    moveArrayItem(skills, skillIndex, dir);
    refreshAfterMutation("已调整其他信息顺序");
    return;
  }

  // 教育背景详情
  if (action === "add-education-detail") {
    const details = splitLines(state.shared.education.details);
    details.push("新的一行");
    state.shared.education.details = details.join("\n");
    refreshAfterMutation("已添加教育背景详情");
    return;
  }
}

function renameSection(oldTitle, newTitle) {
  if (!newTitle || newTitle === oldTitle) return;
  const profile = getProfile();
  profile.entries.forEach((entry) => {
    const item = resolveEntry(entry);
    const title = entry.sectionTitle || sectionTitleFromType(item.type);
    if (title === oldTitle) {
      ensureEntryCustomized(profile, profile.entries.indexOf(entry));
      entry.sectionTitle = newTitle;
    }
  });
}

// ===== 数据解析 =====
function resolveProfile(profile) {
  const sectionMap = new Map();
  (profile.entries || []).forEach((entry) => {
    if (entry.enabled === false) return;
    const item = resolveEntry(entry);
    const title = entry.sectionTitle || sectionTitleFromType(item.type);
    if (!sectionMap.has(title)) sectionMap.set(title, { id: slug(title), title, items: [] });
    sectionMap.get(title).items.push(item);
  });
  const sections = Array.from(sectionMap.values()).sort((a, b) => sectionPriority(a.title) - sectionPriority(b.title));
  return {
    ...profile,
    basics: state.shared.basics,
    education: state.shared.education,
    sections,
    skills: profile.skillOverrides ? profile.skillOverrides : state.shared.skills
  };
}

function resolveEntry(entry) {
  const source = getLibraryItem(entry.libraryId) || blankLibraryItem();
  if (entry.customized !== true) return clone(source);
  const item = clone(source);
  const overrides = entry.overrides || {};
  ["title", "role", "period"].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(overrides, field)) item[field] = overrides[field] || "";
  });
  if (Object.prototype.hasOwnProperty.call(overrides, "tags")) {
    item.tags = Array.isArray(overrides.tags) ? overrides.tags : parseTags(overrides.tags || "");
  }
  if (Object.prototype.hasOwnProperty.call(overrides, "bullets")) {
    item.bullets = Array.isArray(overrides.bullets) ? overrides.bullets : splitLines(overrides.bullets || "");
  }
  return item;
}

function getProfile() {
  return state.profiles.find((profile) => profile.id === activeProfileId) || state.profiles[0];
}

function getActiveProfileIndex() {
  return Math.max(0, state.profiles.findIndex((profile) => profile.id === activeProfileId));
}

function getLibraryItem(id) {
  return state.library.items.find((item) => item.id === id);
}

function sectionPriority(title) {
  if (title.includes("工作") || title.includes("实习")) return 1;
  if (title.includes("项目")) return 2;
  if (title.includes("校园")) return 3;
  if (title.includes("奖")) return 4;
  return 5;
}

// ===== 适配一页 =====
function scheduleFit() {
  window.clearTimeout(fitTimer);
  fitTimer = window.setTimeout(() => {
    window.requestAnimationFrame(fitResume);
  }, 40);
}

function fitResume() {
  const page = refs.resumePage;
  page.classList.remove("overflowing");
  // 清除自定义排版样式
  page.style.cssText = "";
  for (const level of DENSITY_LEVELS) {
    page.dataset.density = level;
    if (page.scrollHeight <= page.clientHeight + 2) {
      refs.fitStatus.textContent = level === "normal" ? "一页模式" : `一页模式 · ${densityName(level)}`;
      return;
    }
  }
  page.dataset.density = "ultra";
  page.classList.add("overflowing");
  refs.fitStatus.textContent = `内容超出一页，建议删减：${overflowHint()}`;
}

// ===== 自适应排版：精细调整字体大小和间距，铺满整页 =====
function autoLayout() {
  const page = refs.resumePage;
  page.classList.remove("overflowing");
  
  // 先重置为默认密度，清除自定义样式
  page.dataset.density = "normal";
  page.style.cssText = "";
  
  // 强制重排
  void page.offsetHeight;
  
  const pageHeight = page.clientHeight;
  
  // 辅助函数：检查当前缩放是否能放进一页
  function fits(scale) {
    applyScale(page, scale);
    void page.offsetHeight;
    return page.scrollHeight <= pageHeight;
  }
  
  // 从大到小逐步尝试，找到第一个能放进一页的缩放比例
  let bestScale = 0.5;
  let found = false;
  for (let scale = 1.2; scale >= 0.5; scale -= 0.01) {
    if (fits(scale)) {
      bestScale = scale;
      found = true;
      break;
    }
  }
  
  // 应用最佳缩放比例
  applyScale(page, bestScale);
  void page.offsetHeight;
  
  // 最终检查
  if (page.scrollHeight > pageHeight + 2) {
    page.classList.add("overflowing");
    refs.fitStatus.textContent = `内容超出一页，建议删减：${overflowHint()}`;
  } else {
    const fillPercent = Math.round((page.scrollHeight / pageHeight) * 100);
    refs.fitStatus.textContent = `已排版 · 缩放 ${(bestScale * 100).toFixed(0)}% · 铺满 ${fillPercent}%`;
  }
  
  setStatus("已自动排版");
}

function applyScale(page, scale) {
  // 基准值（normal 密度）
  const base = {
    "--body-size": "8.65pt",
    "--small-size": "8pt",
    "--section-size": "13.2pt",
    "--name-size": "20pt",
    "--gap": "2.6mm",
    "--item-gap": "2.6mm",
    "--bullet-gap": "0.85mm"
  };
  
  Object.entries(base).forEach(([key, value]) => {
    const num = parseFloat(value);
    const unit = value.replace(/[0-9.]/g, "");
    page.style.setProperty(key, (num * scale).toFixed(2) + unit);
  });
}

function densityName(level) {
  return {
    compact: "紧凑",
    tight: "更紧凑",
    ultra: "极限压缩"
  }[level] || "标准";
}

function overflowHint() {
  const profile = resolveProfile(getProfile());
  const bullets = [];
  (profile.sections || []).forEach((section) => {
    section.items.forEach((item) => {
      (item.bullets || []).forEach((bullet) => {
        bullets.push({ title: item.title, length: countChars(bullet) });
      });
    });
  });
  bullets.sort((a, b) => b.length - a.length);
  const longest = bullets[0];
  if (!longest) return "减少经历数量或改成多页";
  return `${longest.title || "某段经历"}最长要点约 ${longest.length} 字`;
}

// ===== 工具函数 =====
function refreshAfterMutation(message) {
  markDirty(message || "有未保存修改");
  renderAll();
}

function createHistorySnapshot() {
  return JSON.stringify({ state, activeProfileId });
}

function recordHistoryStep(group = "") {
  if (isRestoringHistory) return;
  const current = createHistorySnapshot();
  if (current === historyState) return;
  const now = Date.now();
  const continuesGroup = Boolean(group) && group === lastHistoryGroup && now - lastHistoryTime <= EDIT_GROUP_DELAY;
  if (!continuesGroup) {
    undoStack.push(historyState);
    if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
  }
  historyState = current;
  lastHistoryGroup = group;
  lastHistoryTime = now;
}

function markDirty(message, historyGroup = "") {
  recordHistoryStep(historyGroup);
  dirty = true;
  setStatus(message || "有未保存修改");
  scheduleAutoSave();
}

function scheduleAutoSave() {
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => persistState("已自动保存"), AUTO_SAVE_DELAY);
}

function persistState(message = "") {
  window.clearTimeout(autoSaveTimer);
  try {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    dirty = false;
    historyState = createHistorySnapshot();
    if (message) setStatus(message);
    return true;
  } catch {
    dirty = true;
    if (message) setStatus("自动保存失败，请点击保存重试");
    return false;
  }
}

function undoLastChange() {
  if (!undoStack.length) {
    setStatus("没有可撤销的更改");
    return;
  }
  window.clearTimeout(autoSaveTimer);
  const previous = JSON.parse(undoStack.pop());
  isRestoringHistory = true;
  state = migrateToV2(previous.state);
  activeProfileId = state.profiles.some((profile) => profile.id === previous.activeProfileId)
    ? previous.activeProfileId
    : state.profiles[0]?.id || "";
  selectedBullet = null;
  cancelBulletPointerDrag();
  isRestoringHistory = false;
  lastHistoryGroup = "";
  lastHistoryTime = 0;
  historyState = createHistorySnapshot();
  renderAll();
  dirty = true;
  persistState("已撤销上一步并自动保存");
}

function setStatus(text) {
  refs.statusText.textContent = text;
}

function moveArrayItem(array, index, dir) {
  const to = index + dir;
  if (!Array.isArray(array) || to < 0 || to >= array.length) return;
  const [item] = array.splice(index, 1);
  array.splice(to, 0, item);
}

function blankProfile(label) {
  return {
    id: uid("profile"),
    label: label || "新岗位简历",
    target: "",
    sourcePdf: "",
    entries: [],
    skillOverrides: null
  };
}

function blankLibraryItem() {
  return {
    id: uid("item"),
    type: "project",
    title: "新经历",
    role: "",
    period: "",
    tags: [],
    bullets: ["填写这段经历中最能证明能力和结果的一条内容。"]
  };
}

function pickItemFields(item) {
  return {
    title: item.title || "",
    role: item.role || "",
    period: item.period || "",
    tags: Array.isArray(item.tags) ? clone(item.tags) : [],
    bullets: Array.isArray(item.bullets) ? clone(item.bullets) : []
  };
}

function normalizeSkills(skills) {
  return Array.isArray(skills)
    ? skills.map((skill) => ({
      id: skill.id || uid("skill"),
      label: skill.label || "",
      text: skill.text || ""
    }))
    : [];
}

function skillsEqual(left, right) {
  const clean = (skills) => normalizeSkills(skills).map((skill) => ({ label: skill.label, text: skill.text }));
  return JSON.stringify(clean(left)) === JSON.stringify(clean(right));
}

function typeFromSectionTitle(title) {
  if (title.includes("工作") || title.includes("实习")) return "work";
  if (title.includes("项目")) return "project";
  if (title.includes("校园")) return "campus";
  if (title.includes("奖")) return "award";
  return "other";
}

function sectionTitleFromType(type) {
  return TYPE_TO_SECTION[type] || TYPE_TO_SECTION.other;
}

function libraryKey(item) {
  return [item.type, item.title, item.role, item.period]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("|");
}

function countItemReferences(libraryId) {
  return state.profiles.reduce((sum, profile) => {
    return sum + profile.entries.filter((entry) => entry.libraryId === libraryId).length;
  }, 0);
}

function uniqueProfileId(seed) {
  let id = seed || uid("profile");
  while (state.profiles.some((profile) => profile.id === id)) id = uid("profile");
  return id;
}

function uniqueProfileLabel(label, currentId = "") {
  const base = label || "新岗位简历";
  let next = base;
  let index = 2;
  while (state.profiles.some((profile) => profile.id !== currentId && profile.label === next)) {
    next = `${base} ${index}`;
    index += 1;
  }
  return next;
}

function splitLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseTags(value) {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function countChars(value) {
  return String(value || "").replace(/\s/g, "").length;
}

function formatBullet(text) {
  const safe = escapeHtml(text || "");
  return safe.replace(/^【([^】]+)】/, "<strong>【$1】</strong>");
}

function safeFilePart(text) {
  return String(text || "简历")
    .replace(/[\\/:*?"<>|]/g, "-")
    .slice(0, 40);
}

function slug(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5-]/g, "") || uid("section");
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, "&#10;");
}
