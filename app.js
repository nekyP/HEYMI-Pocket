(() => {
  "use strict";

  const STORAGE_KEY = "heymi-pocket-state-v1";
  const TOKEN_KEY = "heymi-remote-token-v1";
  const DEVICE_KEY = "heymi-remote-device-v1";
  const REMOTE_ORIGIN_KEY = "heymi-remote-origin-v1";
  const BACKUP_FORMAT = "heymi-pocket-backup";
  const BACKUP_VERSION = 1;
  const MAX_BACKUP_BYTES = 256 * 1024;
  const CACHE_PREFIX = "heymi-pocket-";
  const IS_NATIVE_RUNTIME = location.protocol === "capacitor:" || Boolean(window.Capacitor?.isNativePlatform?.());
  const IS_PUBLIC_WEB = document.documentElement.dataset.release === "public";
  const IS_STANDALONE = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const PETS = {
    origin: { name: "Origin Mascot", short: "Origin", image: "./assets/origin.png" },
    default: { name: "Spark Keeper", short: "Spark", image: "./assets/default.png" },
    dragon: { name: "Spiked Drake", short: "Drake", image: "./assets/dragon.png" },
    cat: { name: "Cipher Familiar", short: "Cipher", image: "./assets/cat.png" },
  };
  const AURAS = {
    gold: "Moon gold",
    teal: "Signal teal",
    violet: "Dream violet",
    moss: "Moss green",
    rose: "Bloom rose",
  };
  const OUTFITS = { none: "", star: "★", satchel: "▣", crown: "♛" };
  const FISH = [
    { id: "silver-dart", name: "Silver Dart", rarity: "Common", coins: 4, weight: 30 },
    { id: "moss-fin", name: "Moss Fin", rarity: "Common", coins: 5, weight: 25 },
    { id: "lantern-koi", name: "Lantern Koi", rarity: "Uncommon", coins: 8, weight: 18 },
    { id: "cloud-ray", name: "Cloud Ray", rarity: "Uncommon", coins: 9, weight: 14 },
    { id: "moon-eel", name: "Moon Eel", rarity: "Rare", coins: 15, weight: 9 },
    { id: "starling-fish", name: "Starling Fish", rarity: "Mythic", coins: 30, weight: 4 },
  ];
  const CROPS = ["glowcap", "moonbean", "starroot", "dewberry"];
  const CROP_LABELS = { glowcap: "Glowcap", moonbean: "Moonbean", starroot: "Starroot", dewberry: "Dewberry" };
  const PET_REACTIONS = [
    "You came back!",
    "The moon looks close tonight.",
    "I saved this spot for you.",
    "Can we find something shiny?",
    "That made my ears happy.",
  ];
  const QUESTS = [
    { id: "first-catch", title: "Moonpond hello", copy: "Catch one fish", target: (s) => s.activities.fishCaught >= 1 },
    { id: "first-harvest", title: "Window gardener", copy: "Harvest one crop", target: (s) => s.activities.cropsHarvested >= 1 },
    { id: "fresh-look", title: "Tiny stylist", copy: "Try a new look", target: (s) => s.activities.styleChanges >= 1 },
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));
  const todayKey = () => new Date().toLocaleDateString("en-CA");

  function createDefaultState() {
    const now = Date.now();
    return {
      version: 2,
      profile: { keeperName: "My HEYMI", petName: "Mimi", streak: 1, lastVisitDay: todayKey() },
      appearance: { pet: "origin", aura: "gold", outfit: "none" },
      stats: { happiness: 76, energy: 82, hunger: 72, cleanliness: 90, bond: 8, updatedAt: now },
      inventory: { coins: 40, treats: 3, crops: {} },
      activities: {
        day: todayKey(), careToday: 0, dailyClaimed: false, giftClaimed: false,
        fishCaught: 0, cropsHarvested: 0, styleChanges: 0, petTaps: 0,
        questRewards: {},
      },
      farm: {
        nextCropIndex: 0,
        plots: [
          { crop: "glowcap", plantedAt: now - 60_000, watered: true },
          { crop: null, plantedAt: 0, watered: false },
          { crop: "moonbean", plantedAt: now - 4_000, watered: false },
        ],
      },
      collections: { fish: [], crops: [], outfits: ["none"] },
      settings: { haptics: true, reducedMotion: false, highContrast: false, onboardingComplete: false },
    };
  }

  function mergeState(saved) {
    const base = createDefaultState();
    if (!saved || typeof saved !== "object") return base;
    return {
      ...base,
      ...saved,
      profile: { ...base.profile, ...(saved.profile || {}) },
      appearance: { ...base.appearance, ...(saved.appearance || {}) },
      stats: { ...base.stats, ...(saved.stats || {}) },
      inventory: { ...base.inventory, ...(saved.inventory || {}), crops: { ...base.inventory.crops, ...(saved.inventory?.crops || {}) } },
      activities: { ...base.activities, ...(saved.activities || {}), questRewards: { ...base.activities.questRewards, ...(saved.activities?.questRewards || {}) } },
      farm: {
        ...base.farm,
        ...(saved.farm || {}),
        plots: Array.isArray(saved.farm?.plots) && saved.farm.plots.length === 3
          ? saved.farm.plots.map((plot, index) => ({ ...base.farm.plots[index], ...(plot || {}) }))
          : base.farm.plots,
      },
      collections: {
        ...base.collections,
        ...(saved.collections || {}),
        fish: Array.isArray(saved.collections?.fish) ? saved.collections.fish : base.collections.fish,
        crops: Array.isArray(saved.collections?.crops) ? saved.collections.crops : base.collections.crops,
        outfits: Array.isArray(saved.collections?.outfits) ? saved.collections.outfits : base.collections.outfits,
      },
      settings: { ...base.settings, ...(saved.settings || {}) },
    };
  }

  function safeNumber(value, fallback, minimum, maximum, integer = false) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    const bounded = Math.max(minimum, Math.min(maximum, number));
    return integer ? Math.round(bounded) : bounded;
  }

  function safeText(value, fallback, maxLength) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) || fallback : fallback;
  }

  function readLocalValue(key) {
    try { return localStorage.getItem(key) || ""; }
    catch { return ""; }
  }

  function writeLocalValue(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch { return false; }
  }

  function removeLocalValue(key) {
    try { localStorage.removeItem(key); }
    catch { /* Storage may be unavailable in private or restricted browsing modes. */ }
  }

  function knownValues(values, allowed, fallback = []) {
    if (!Array.isArray(values)) return [...fallback];
    return [...new Set(values.filter((value) => allowed.includes(value)))];
  }

  function normalizeState(saved) {
    const base = createDefaultState();
    const merged = mergeState(saved);
    const now = Date.now();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(merged.activities.day) ? merged.activities.day : todayKey();
    const lastVisitDay = /^\d{4}-\d{2}-\d{2}$/.test(merged.profile.lastVisitDay) ? merged.profile.lastVisitDay : todayKey();
    const questRewards = Object.fromEntries(QUESTS.map((quest) => [quest.id, Boolean(merged.activities.questRewards?.[quest.id])]));
    const crops = Object.fromEntries(CROPS.map((crop) => [crop, safeNumber(merged.inventory.crops?.[crop], 0, 0, 9999, true)]));
    const plots = base.farm.plots.map((fallbackPlot, index) => {
      const source = merged.farm.plots[index] || fallbackPlot;
      const crop = CROPS.includes(source.crop) ? source.crop : null;
      return {
        crop,
        plantedAt: crop ? safeNumber(source.plantedAt, now, 0, now) : 0,
        watered: crop ? Boolean(source.watered) : false,
      };
    });
    return {
      version: 2,
      profile: {
        keeperName: safeText(merged.profile.keeperName, base.profile.keeperName, 28),
        petName: safeText(merged.profile.petName, base.profile.petName, 18),
        streak: safeNumber(merged.profile.streak, base.profile.streak, 1, 9999, true),
        lastVisitDay,
      },
      appearance: {
        pet: Object.hasOwn(PETS, merged.appearance.pet) ? merged.appearance.pet : base.appearance.pet,
        aura: Object.hasOwn(AURAS, merged.appearance.aura) ? merged.appearance.aura : base.appearance.aura,
        outfit: Object.hasOwn(OUTFITS, merged.appearance.outfit) ? merged.appearance.outfit : base.appearance.outfit,
      },
      stats: {
        happiness: safeNumber(merged.stats.happiness, base.stats.happiness, 0, 100),
        energy: safeNumber(merged.stats.energy, base.stats.energy, 0, 100),
        hunger: safeNumber(merged.stats.hunger, base.stats.hunger, 0, 100),
        cleanliness: safeNumber(merged.stats.cleanliness, base.stats.cleanliness, 0, 100),
        bond: safeNumber(merged.stats.bond, base.stats.bond, 0, 9999),
        updatedAt: safeNumber(merged.stats.updatedAt, now, 0, now),
      },
      inventory: {
        coins: safeNumber(merged.inventory.coins, base.inventory.coins, 0, 999999, true),
        treats: safeNumber(merged.inventory.treats, base.inventory.treats, 0, 9999, true),
        crops,
      },
      activities: {
        day,
        careToday: safeNumber(merged.activities.careToday, 0, 0, 9999, true),
        dailyClaimed: Boolean(merged.activities.dailyClaimed),
        giftClaimed: Boolean(merged.activities.giftClaimed),
        fishCaught: safeNumber(merged.activities.fishCaught, 0, 0, 999999, true),
        cropsHarvested: safeNumber(merged.activities.cropsHarvested, 0, 0, 999999, true),
        styleChanges: safeNumber(merged.activities.styleChanges, 0, 0, 999999, true),
        petTaps: safeNumber(merged.activities.petTaps, 0, 0, 999999, true),
        questRewards,
      },
      farm: {
        nextCropIndex: safeNumber(merged.farm.nextCropIndex, 0, 0, 999999, true),
        plots,
      },
      collections: {
        fish: knownValues(merged.collections.fish, FISH.map((fish) => fish.id)),
        crops: knownValues(merged.collections.crops, CROPS),
        outfits: knownValues(merged.collections.outfits, Object.keys(OUTFITS), ["none"]),
      },
      settings: {
        haptics: typeof merged.settings.haptics === "boolean" ? merged.settings.haptics : base.settings.haptics,
        reducedMotion: Boolean(merged.settings.reducedMotion),
        highContrast: Boolean(merged.settings.highContrast),
        onboardingComplete: typeof saved?.settings?.onboardingComplete === "boolean" ? saved.settings.onboardingComplete : Boolean(saved),
      },
    };
  }

  function loadState() {
    try { return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch { return createDefaultState(); }
  }

  let state = loadState();
  let toastTimer = 0;
  let moodTimer = 0;
  let gardenTimer = 0;
  let deferredInstallPrompt = null;
  let dialogAction = null;
  let storageSaveFailed = false;

  function prepareDailyState() {
    const today = todayKey();
    if (state.activities.day !== today) {
      state.activities.day = today;
      state.activities.careToday = 0;
      state.activities.dailyClaimed = false;
      state.activities.giftClaimed = false;
      const previous = new Date(`${state.profile.lastVisitDay || today}T12:00:00`);
      const current = new Date(`${today}T12:00:00`);
      const dayGap = Math.round((current - previous) / DAY_MS);
      state.profile.streak = dayGap === 1 ? Math.max(1, state.profile.streak + 1) : dayGap > 1 ? 1 : state.profile.streak;
      state.profile.lastVisitDay = today;
    }
    const elapsedHours = clamp((Date.now() - Number(state.stats.updatedAt || Date.now())) / 3_600_000, 0, 72);
    if (elapsedHours >= 1) {
      state.stats.hunger = clamp(state.stats.hunger - elapsedHours * 1.25);
      state.stats.energy = clamp(state.stats.energy - elapsedHours * .55);
      state.stats.cleanliness = clamp(state.stats.cleanliness - elapsedHours * .35);
      state.stats.happiness = clamp(state.stats.happiness - elapsedHours * .4);
      state.stats.updatedAt = Date.now();
    }
  }

  function saveState({ silent = false } = {}) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageSaveFailed = false;
      const warning = $("#save-warning");
      if (warning) warning.hidden = true;
      return true;
    } catch {
      const firstFailure = !storageSaveFailed;
      storageSaveFailed = true;
      const warning = $("#save-warning");
      if (warning) warning.hidden = false;
      if (!silent && firstFailure) showToast("Progress is not saving", "Export a backup before closing HEYMI Pocket.", "!");
      return false;
    }
  }

  function markStatsUpdated() {
    state.stats.updatedAt = Date.now();
  }

  function haptic(pattern = 12) {
    if (state.settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
  }

  function showToast(title, copy, icon = "✦") {
    $("#toast-title").textContent = title;
    $("#toast-copy").textContent = copy;
    $("#toast-icon").textContent = icon;
    $("#toast").classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => $("#toast").classList.remove("is-visible"), 2800);
  }

  function openDialog({ icon = "✦", kicker = "HEYMI POCKET", title, content, actionLabel = "Done", onAction = null }) {
    $("#dialog-icon").textContent = icon;
    $("#dialog-kicker").textContent = kicker;
    $("#dialog-title").textContent = title;
    const copy = $("#dialog-copy");
    copy.replaceChildren();
    if (typeof content === "string") copy.textContent = content;
    else if (content) copy.append(content);
    $("#pocket-dialog .dialog-action").textContent = actionLabel;
    dialogAction = onAction;
    const dialog = $("#pocket-dialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog(runAction = false) {
    const action = dialogAction;
    dialogAction = null;
    const dialog = $("#pocket-dialog");
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    if (runAction && action) action();
  }

  function levelForBond() { return Math.max(1, 1 + Math.floor(state.stats.bond / 20)); }

  function moodForStats() {
    const minimum = Math.min(state.stats.happiness, state.stats.energy, state.stats.hunger, state.stats.cleanliness);
    if (minimum < 25) return { label: "Needs care", copy: "A little care would help", tone: "low" };
    if (state.stats.energy < 45) return { label: "Sleepy", copy: "A cozy rest sounds nice", tone: "low" };
    if (state.stats.hunger < 45) return { label: "Peckish", copy: "Maybe one small treat?", tone: "low" };
    if (state.stats.happiness > 88) return { label: "Delighted", copy: "Your bond is glowing", tone: "high" };
    return { label: "Curious", copy: "Tap to say hello", tone: "steady" };
  }

  function setProgress(id, value) {
    const element = $(id);
    if (element) element.value = Math.round(value);
  }

  function renderPet() {
    const pet = PETS[state.appearance.pet] || PETS.origin;
    const petName = state.profile.petName || "Mimi";
    const level = levelForBond();
    const accessory = OUTFITS[state.appearance.outfit] || "";
    $("#home-pet-name").textContent = petName;
    $("#studio-pet-name").textContent = petName;
    $("#profile-pet-name").textContent = petName;
    $("#home-pet-stage").setAttribute("aria-label", `Interact with ${petName}`);
    $("#pet-touch-target").setAttribute("aria-label", `Pet ${petName}`);
    $("#home-pet-image").src = pet.image;
    $("#home-pet-image").alt = `${petName}, your HEYMI companion`;
    $("#studio-pet-image").src = pet.image;
    $("#studio-pet-image").alt = `${petName} in the ${pet.name} appearance`;
    $("#studio-pet-kind").textContent = pet.name;
    $("#home-pet-accessory").textContent = accessory;
    $("#studio-pet-accessory").textContent = accessory;
    $("#hero-level").textContent = level;
    $("#studio-level").textContent = level;
    $("#bond-value").textContent = Math.round(state.stats.bond);
    $("#profile-bond-value").textContent = Math.round(state.stats.bond);
    $("#pet-count-label").textContent = `${Object.keys(PETS).indexOf(state.appearance.pet) + 1} / ${Object.keys(PETS).length}`;
    $$("[data-pet]").forEach((button) => {
      const selected = button.dataset.pet === state.appearance.pet;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $$("[data-aura]").forEach((button) => {
      const selected = button.dataset.aura === state.appearance.aura;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    $$("[data-outfit]").forEach((button) => {
      const selected = button.dataset.outfit === state.appearance.outfit;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $("#aura-label").textContent = AURAS[state.appearance.aura] || AURAS.gold;
    document.documentElement.dataset.aura = state.appearance.aura;
  }

  function renderStats() {
    const values = {
      happiness: state.stats.happiness,
      energy: state.stats.energy,
      hunger: state.stats.hunger,
      cleanliness: state.stats.cleanliness,
    };
    for (const [key, value] of Object.entries(values)) {
      setProgress(`#detail-${key}`, value);
      const detailValue = $(`#detail-${key}-value`);
      if (detailValue) detailValue.textContent = Math.round(value);
      if (key !== "cleanliness") {
        setProgress(`#home-${key}`, value);
        $(`#home-${key}-value`).textContent = `${Math.round(value)}%`;
      }
    }
    $("#feed-count").textContent = `${state.inventory.treats} treat${state.inventory.treats === 1 ? "" : "s"}`;
    const mood = moodForStats();
    $("#pet-mood-label").textContent = mood.label;
    $("#pet-state-copy").textContent = mood.copy;
    $("#care-summary").textContent = `${Object.values(values).filter((value) => value >= 55).length} needs steady`;
  }

  function checkQuestRewards(showReward = false) {
    let rewarded = 0;
    for (const quest of QUESTS) {
      if (quest.target(state) && !state.activities.questRewards[quest.id]) {
        state.activities.questRewards[quest.id] = true;
        state.inventory.coins += 10;
        rewarded += 10;
      }
    }
    if (rewarded && showReward) showToast("Mini quest complete", `+${rewarded} pocket coins`, "✓");
    return rewarded;
  }

  function renderDaily() {
    const care = Math.min(3, state.activities.careToday);
    $("#daily-progress").value = care;
    $("#daily-progress-label").textContent = `${care} / 3`;
    $("#daily-claim-button").disabled = care < 3 || state.activities.dailyClaimed;
    $("#daily-claim-button").textContent = state.activities.dailyClaimed ? "Done" : "+25";
    $("#daily-quest-title").textContent = state.activities.dailyClaimed ? "Bond kept bright" : `Make ${state.profile.petName} smile`;
    $("#daily-quest-copy").textContent = state.activities.dailyClaimed ? "Come back tomorrow for another ritual." : `Care for ${state.profile.petName} 3 times today.`;
    $("#daily-gift-button").classList.toggle("is-claimed", state.activities.giftClaimed);
  }

  function plotStatus(plot) {
    if (!plot?.crop) return "empty";
    if (plot.watered && Date.now() - Number(plot.plantedAt || 0) >= 20_000) return "ready";
    return "growing";
  }

  function renderGarden() {
    const grid = $("#garden-grid");
    grid.replaceChildren();
    let readyCount = 0;
    state.farm.plots.forEach((plot, index) => {
      const status = plotStatus(plot);
      if (status === "ready") readyCount += 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `garden-plot is-${status}`;
      button.dataset.plot = String(index);
      let label = "Empty plot";
      let sublabel = "Plant · 2 coins";
      if (status === "growing") {
        label = CROP_LABELS[plot.crop] || "Seedling";
        if (!plot.watered) sublabel = "Tap to water";
        else sublabel = `${Math.max(1, Math.ceil((20_000 - (Date.now() - plot.plantedAt)) / 1000))}s to bloom`;
      } else if (status === "ready") {
        label = CROP_LABELS[plot.crop] || "Glowcap";
        sublabel = "Ready · tap to harvest";
      }
      button.setAttribute("aria-label", `${label}. ${sublabel}`);
      button.innerHTML = `<div class="garden-pot"><i class="plant-sprout"></i></div><span>${label}</span><small>${sublabel}</small>`;
      grid.append(button);
    });
    $("#garden-ready-count").textContent = readyCount ? `${readyCount} ready` : "Growing gently";
  }

  function renderCollections() {
    $("#fish-collection-count").textContent = `${state.collections.fish.length} / ${FISH.length}`;
    $("#crop-collection-count").textContent = `${state.collections.crops.length} / ${CROPS.length}`;
    $("#style-collection-count").textContent = `${state.collections.outfits.length} / ${Object.keys(OUTFITS).length}`;
    const total = state.collections.fish.length + state.collections.crops.length + state.collections.outfits.length;
    $("#profile-collection-count").textContent = total;
  }

  function renderQuests() {
    const list = $("#quest-list");
    list.replaceChildren();
    let complete = 0;
    QUESTS.forEach((quest) => {
      const done = quest.target(state);
      if (done) complete += 1;
      const row = document.createElement("div");
      row.className = `quest-row${done ? " is-complete" : ""}`;
      row.innerHTML = `<span class="quest-check">${done ? "✓" : "·"}</span><div><b>${quest.title}</b><small>${quest.copy}</small></div><span>${done ? "DONE" : "+10"}</span>`;
      list.append(row);
    });
    $("#quest-complete-count").textContent = `${complete} / ${QUESTS.length}`;
  }

  function renderProfile() {
    $$("[data-coin-count]").forEach((element) => { element.textContent = Math.floor(state.inventory.coins); });
    $("#profile-name").textContent = state.profile.keeperName;
    $("#profile-streak").textContent = state.profile.streak;
    $("#haptics-setting").checked = state.settings.haptics;
    $("#motion-setting").checked = state.settings.reducedMotion;
    $("#contrast-setting").checked = state.settings.highContrast;
    document.documentElement.classList.toggle("reduce-motion", state.settings.reducedMotion);
    document.documentElement.classList.toggle("high-contrast", state.settings.highContrast);
  }

  function renderAll() {
    renderPet();
    renderStats();
    renderDaily();
    renderGarden();
    renderCollections();
    renderQuests();
    renderProfile();
  }

  function switchTab(tabName, updateUrl = true) {
    const next = $(`[data-view="${tabName}"]`);
    if (!next) return;
    $$("[data-view]").forEach((view) => {
      const active = view === next;
      view.hidden = !active;
      view.classList.toggle("is-active", active);
    });
    $$("[data-tab]").forEach((button) => {
      const active = button.dataset.tab === tabName;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0, behavior: state.settings.reducedMotion ? "auto" : "smooth" });
    if (updateUrl) {
      const url = new URL(location.href);
      if (tabName === "home") url.searchParams.delete("tab");
      else url.searchParams.set("tab", tabName);
      history.replaceState(null, "", url);
    }
  }

  function showMood(message) {
    const bubble = $("#mood-bubble");
    clearTimeout(moodTimer);
    bubble.textContent = message;
    bubble.classList.remove("is-hidden");
    moodTimer = window.setTimeout(() => bubble.classList.add("is-hidden"), 2600);
  }

  function handlePetTap() {
    state.activities.petTaps += 1;
    state.stats.happiness = clamp(state.stats.happiness + 1.5);
    if (state.activities.petTaps % 3 === 0) state.stats.bond = clamp(state.stats.bond + 1, 0, 999);
    const target = $("#pet-touch-target");
    target.classList.remove("is-reacting");
    requestAnimationFrame(() => target.classList.add("is-reacting"));
    window.setTimeout(() => target.classList.remove("is-reacting"), 600);
    showMood(PET_REACTIONS[state.activities.petTaps % PET_REACTIONS.length]);
    haptic(8);
    markStatsUpdated();
    saveState();
    renderStats();
    renderPet();
  }

  function careForPet(action) {
    const changes = {
      feed: { hunger: 18, happiness: 3, energy: 1, cleanliness: -1, bond: 1, message: "That hit the spot.", title: "Treat shared", icon: "◇" },
      play: { hunger: -4, happiness: 16, energy: -9, cleanliness: -3, bond: 2, message: "We made a tiny memory.", title: "Playtime", icon: "✦" },
      rest: { hunger: -3, happiness: 2, energy: 24, cleanliness: 1, bond: 1, message: "A quiet little recharge.", title: "Cozy rest", icon: "☾" },
    }[action];
    if (!changes) return;
    if (action === "feed") {
      if (state.inventory.treats <= 0) return showToast("No treats left", "Find more in daily gifts and activities.", "◇");
      state.inventory.treats -= 1;
    }
    if (action === "play" && state.stats.energy < 9) return showToast("Too sleepy to play", "Let your companion rest first.", "☾");
    for (const key of ["hunger", "happiness", "energy", "cleanliness"]) state.stats[key] = clamp(state.stats[key] + (changes[key] || 0));
    state.stats.bond = clamp(state.stats.bond + changes.bond, 0, 999);
    state.activities.careToday += 1;
    markStatsUpdated();
    saveState();
    renderAll();
    showMood(changes.message);
    showToast(changes.title, `Bond +${changes.bond}`, changes.icon);
    haptic([10, 35, 12]);
  }

  function claimDaily() {
    if (state.activities.careToday < 3 || state.activities.dailyClaimed) return;
    state.activities.dailyClaimed = true;
    state.inventory.coins += 25;
    state.stats.bond = clamp(state.stats.bond + 3, 0, 999);
    saveState();
    renderAll();
    showToast("Daily bond complete", "+25 pocket coins · bond +3", "✦");
    haptic([12, 30, 12]);
  }

  function claimGift() {
    if (state.activities.giftClaimed) return showToast("Gift already opened", "Another one arrives tomorrow.", "◇");
    state.activities.giftClaimed = true;
    state.inventory.coins += 20;
    state.inventory.treats += 2;
    saveState();
    renderAll();
    openDialog({ icon: "◇", kicker: "DAILY GIFT", title: "A warm little bundle", content: "+20 pocket coins and 2 moon treats were tucked inside.", actionLabel: "Keep them" });
    haptic([15, 35, 15]);
  }

  function weightedFish() {
    let roll = Math.random() * FISH.reduce((sum, fish) => sum + fish.weight, 0);
    for (const fish of FISH) {
      roll -= fish.weight;
      if (roll <= 0) return fish;
    }
    return FISH[0];
  }

  function castLine() {
    if (state.stats.energy < 8) return showToast("Not enough energy", "Rest before another Moonpond cast.", "☾");
    const button = $("#cast-button");
    const card = $("#fishing-card");
    button.disabled = true;
    button.querySelector("span").textContent = "Listening for a nibble…";
    card.classList.add("is-casting");
    haptic(8);
    window.setTimeout(() => {
      const fish = weightedFish();
      const isNew = !state.collections.fish.includes(fish.id);
      state.stats.energy = clamp(state.stats.energy - 8);
      state.stats.happiness = clamp(state.stats.happiness + 4);
      state.inventory.coins += fish.coins;
      state.activities.fishCaught += 1;
      if (isNew) state.collections.fish.push(fish.id);
      checkQuestRewards();
      markStatsUpdated();
      saveState();
      renderAll();
      card.classList.remove("is-casting");
      button.disabled = false;
      button.querySelector("span").textContent = "Cast again";
      openDialog({
        icon: fish.rarity === "Mythic" ? "✦" : "◒",
        kicker: `${fish.rarity.toUpperCase()} CATCH`,
        title: fish.name,
        content: `${isNew ? "New collection find. " : "A familiar shimmer. "}+${fish.coins} pocket coins.`,
        actionLabel: "Keep fishing",
      });
      haptic([15, 40, 20]);
    }, 1050);
  }

  function handleGardenPlot(index) {
    const plot = state.farm.plots[index];
    if (!plot) return;
    const status = plotStatus(plot);
    if (status === "empty") {
      if (state.inventory.coins < 2) return showToast("Need 2 pocket coins", "A seed pouch costs just a little.", "♧");
      const crop = CROPS[state.farm.nextCropIndex % CROPS.length];
      state.farm.nextCropIndex += 1;
      state.inventory.coins -= 2;
      state.farm.plots[index] = { crop, plantedAt: Date.now(), watered: false };
      showToast(`${CROP_LABELS[crop]} planted`, "Tap it once more to water.", "♧");
    } else if (status === "growing" && !plot.watered) {
      plot.watered = true;
      plot.plantedAt = Date.now();
      showToast("Plot watered", `${CROP_LABELS[plot.crop]} will bloom in 20 seconds.`, "⌁");
      haptic(10);
    } else if (status === "growing") {
      const seconds = Math.max(1, Math.ceil((20_000 - (Date.now() - plot.plantedAt)) / 1000));
      return showToast("Still growing", `${seconds} second${seconds === 1 ? "" : "s"} until harvest.`, "♧");
    } else {
      const crop = plot.crop;
      state.inventory.crops[crop] = (state.inventory.crops[crop] || 0) + 1;
      state.inventory.coins += 7;
      state.activities.cropsHarvested += 1;
      if (!state.collections.crops.includes(crop)) state.collections.crops.push(crop);
      state.farm.plots[index] = { crop: null, plantedAt: 0, watered: false };
      checkQuestRewards();
      showToast(`${CROP_LABELS[crop]} harvested`, "+7 pocket coins", "♧");
      haptic([12, 25, 12]);
    }
    saveState();
    renderAll();
  }

  function selectPet(petId) {
    if (!PETS[petId] || state.appearance.pet === petId) return;
    state.appearance.pet = petId;
    state.activities.styleChanges += 1;
    checkQuestRewards(true);
    saveState();
    renderAll();
    showToast(`${PETS[petId].short} joined you`, "Your care progress stays together.", "♥");
  }

  function selectAura(aura) {
    if (!AURAS[aura]) return;
    const changed = state.appearance.aura !== aura;
    state.appearance.aura = aura;
    if (changed) state.activities.styleChanges += 1;
    checkQuestRewards(changed);
    saveState();
    renderAll();
  }

  function selectOutfit(outfit) {
    if (!(outfit in OUTFITS)) return;
    const changed = state.appearance.outfit !== outfit;
    state.appearance.outfit = outfit;
    if (!state.collections.outfits.includes(outfit)) state.collections.outfits.push(outfit);
    if (changed) state.activities.styleChanges += 1;
    checkQuestRewards(changed);
    saveState();
    renderAll();
    if (changed) showToast("Look saved", outfit === "none" ? "Back to the simple look." : "A tiny treasure, perfectly placed.", OUTFITS[outfit] || "—");
  }

  function showCollections() {
    const container = document.createElement("div");
    const fishNames = state.collections.fish.map((id) => FISH.find((fish) => fish.id === id)?.name).filter(Boolean);
    const cropNames = state.collections.crops.map((id) => CROP_LABELS[id]).filter(Boolean);
    const parts = [
      `<b>Moonpond:</b> ${fishNames.length ? fishNames.join(", ") : "No catches yet"}`,
      `<b>Garden:</b> ${cropNames.length ? cropNames.join(", ") : "No harvests yet"}`,
      `<b>Wardrobe:</b> ${state.collections.outfits.length} of ${Object.keys(OUTFITS).length} looks tried`,
    ];
    const list = document.createElement("ul");
    parts.forEach((part) => { const item = document.createElement("li"); item.innerHTML = part; list.append(item); });
    container.append(list);
    openDialog({ icon: "◇", kicker: "POCKET COLLECTION", title: "Things we've found", content: container });
  }

  function renameProfile() {
    const container = document.createElement("div");
    const keeper = document.createElement("input");
    const pet = document.createElement("input");
    keeper.value = state.profile.keeperName;
    keeper.maxLength = 28;
    keeper.setAttribute("aria-label", "Keeper name");
    keeper.className = "dialog-input";
    pet.value = state.profile.petName;
    pet.maxLength = 18;
    pet.setAttribute("aria-label", "Pet name");
    pet.className = "dialog-input";
    container.append(keeper, pet);
    openDialog({
      icon: "♥", kicker: "NAMES", title: "Make it personal", content: container, actionLabel: "Save names",
      onAction: () => {
        state.profile.keeperName = keeper.value.trim().slice(0, 28) || "My HEYMI";
        state.profile.petName = pet.value.trim().slice(0, 18) || "Mimi";
        saveState(); renderAll(); showToast("Names saved", `${state.profile.petName} is listening.`, "♥");
      },
    });
    window.setTimeout(() => keeper.focus(), 60);
  }

  function createDetailList(items) {
    const list = document.createElement("div");
    list.className = "dialog-detail-list";
    items.forEach(({ title, copy }) => {
      const item = document.createElement("div");
      const heading = document.createElement("b");
      const detail = document.createElement("span");
      heading.textContent = title;
      detail.textContent = copy;
      item.append(heading, detail);
      list.append(item);
    });
    return list;
  }

  function showOnboarding() {
    if (state.settings.onboardingComplete) return;
    const container = document.createElement("div");
    const intro = document.createElement("span");
    intro.textContent = "Choose your names, then begin with one small care ritual.";
    const keeper = document.createElement("input");
    keeper.className = "dialog-input";
    keeper.value = state.profile.keeperName;
    keeper.maxLength = 28;
    keeper.autocomplete = "nickname";
    keeper.setAttribute("aria-label", "Your keeper name");
    const pet = document.createElement("input");
    pet.className = "dialog-input";
    pet.value = state.profile.petName;
    pet.maxLength = 18;
    pet.setAttribute("aria-label", "Your companion's name");
    container.append(
      intro,
      keeper,
      pet,
      createDetailList([
        { title: "Care", copy: "Feed, play, rest, and tap your companion to grow your bond." },
        { title: "Make it yours", copy: "Choose a companion form, aura, and little wardrobe treasures." },
        { title: "Play gently", copy: "Fish, tend three garden plots, and finish pocket quests at your pace." },
      ])
    );
    openDialog({
      icon: "♥",
      kicker: "WELCOME, KEEPER",
      title: `Meet ${state.profile.petName}`,
      content: container,
      actionLabel: "Start caring",
      onAction: () => {
        state.profile.keeperName = safeText(keeper.value, "My HEYMI", 28);
        state.profile.petName = safeText(pet.value, "Mimi", 18);
        state.settings.onboardingComplete = true;
        saveState();
        renderAll();
        showMood("I saved this spot for you.");
        showToast("Your pocket is ready", `${state.profile.petName} is listening.`, "♥");
      },
    });
    window.setTimeout(() => keeper.select(), 80);
  }

  function showPrivacy() {
    const storedHereCopy = IS_PUBLIC_WEB
      ? "Names, settings, pet progress, and collections stay in this browser's local storage."
      : "Names, settings, pet progress, collections, and optional Desktop Link credentials stay in this browser's local storage.";
    openDialog({
      icon: "◇",
      kicker: "BETA 1.0 · YOUR DATA",
      title: "Private by default",
      content: createDetailList([
        { title: "Stored here", copy: storedHereCopy },
        { title: "No account or trackers", copy: "This beta has no account, advertising, analytics, or third-party scripts. The web host may retain ordinary access logs." },
        { title: "Backups", copy: "Exported JSON backups are unencrypted and include names and game progress, but never Desktop Link credentials." },
        { title: "Your control", copy: "Reset game progress separately, or erase all HEYMI data and offline caches from this browser." },
      ]),
      actionLabel: "Got it",
    });
  }

  function showInstallInstructions() {
    const iphoneSteps = [
      { title: "1. Open in Safari", copy: "Use Safari on your iPhone, not an in-app browser." },
      { title: "2. Tap Share", copy: "Open the Share menu, then choose Add to Home Screen." },
      { title: "3. Open as Web App", copy: "Leave Open as Web App enabled, then tap Add." },
    ];
    const otherSteps = [
      { title: "Browser menu", copy: "Look for Install app or Add to Home Screen in your browser's menu." },
      { title: "Return anytime", copy: "Your progress remains in this browser, so export a backup before switching devices." },
    ];
    openDialog({
      icon: "↗",
      kicker: "INSTALL HEYMI POCKET",
      title: "Keep your companion close",
      content: createDetailList(/iPad|iPhone|iPod/.test(navigator.userAgent) ? iphoneSteps : otherSteps),
      actionLabel: "Done",
    });
  }

  function exportPocketData() {
    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      state: normalizeState(state),
    };
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `heymi-pocket-backup-${todayKey()}.json`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Backup prepared", "Save the JSON file somewhere private.", "↓");
  }

  async function importPocketData(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("That file is too large to be a HEYMI Pocket backup.");
      const backup = JSON.parse(await file.text());
      if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION || !backup.state) {
        throw new Error("Choose a HEYMI Pocket backup JSON file.");
      }
      const importedState = normalizeState(backup.state);
      openDialog({
        icon: "↑",
        kicker: "RESTORE BACKUP",
        title: `Restore ${importedState.profile.petName}?`,
        content: "This replaces the game progress currently stored in this browser. Desktop Link authorization is not changed.",
        actionLabel: "Restore progress",
        onAction: () => {
          state = importedState;
          prepareDailyState();
          saveState();
          renderAll();
          switchTab("home");
          showToast("Backup restored", `${state.profile.petName} is back.`, "✓");
        },
      });
    } catch (error) {
      showToast("Backup not restored", error.message || "The selected file could not be read.", "!");
    } finally {
      input.value = "";
    }
  }

  function resetPocketData() {
    openDialog({
      icon: "↺", kicker: "GAME PROGRESS", title: "Start the game fresh?",
      content: "This resets care, activities, collections, appearance, and names. Accessibility settings and Desktop Link authorization are left alone.",
      actionLabel: "Reset game progress",
      onAction: () => {
        const currentSettings = { ...state.settings, onboardingComplete: true };
        removeLocalValue(STORAGE_KEY);
        state = createDefaultState();
        state.settings = currentSettings;
        saveState();
        renderAll();
        switchTab("home");
        showToast("Pocket reset", "Mimi is ready for a new beginning.", "↺");
      },
    });
  }

  async function clearPocketCaches() {
    if (!("caches" in window)) return;
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)));
  }

  function eraseAllHeymiData() {
    openDialog({
      icon: "!",
      kicker: "ALL LOCAL DATA",
      title: "Erase HEYMI from this browser?",
      content: "This removes game progress, names, settings, saved Desktop Link credentials, and HEYMI Pocket offline caches. Export a backup first if you may want the progress later.",
      actionLabel: "Erase all data",
      onAction: () => void (async () => {
        if (remoteToken && !IS_PUBLIC_WEB) {
          try { await remoteApi("/api/session", { method: "DELETE" }); }
          catch { /* The PC may be offline; local credentials are still removed. */ }
        }
        for (const key of [STORAGE_KEY, TOKEN_KEY, DEVICE_KEY, REMOTE_ORIGIN_KEY]) {
          removeLocalValue(key);
        }
        await clearPocketCaches().catch(() => {});
        remoteToken = "";
        remoteOrigin = "";
        state = createDefaultState();
        saveState({ silent: true });
        renderAll();
        switchTab("home");
        if (!IS_PUBLIC_WEB) showRemotePairing("Desktop Link data was removed.", false);
        showToast("HEYMI data erased", "This browser has a fresh pocket.", "✓");
        window.setTimeout(showOnboarding, 350);
      })(),
    });
  }

  function updateGreeting() {
    const hour = new Date().getHours();
    $("#greeting-label").textContent = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    $("#day-label").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date()).toUpperCase();
  }

  // Connected PC / Remote Link
  let remoteToken = IS_PUBLIC_WEB ? "" : readLocalValue(TOKEN_KEY);
  let remoteOrigin = IS_NATIVE_RUNTIME ? readLocalValue(REMOTE_ORIGIN_KEY) : "";
  let remotePermissions = {};
  let remotePollTimer = 0;
  let remoteAvailable = null;
  let pendingMove = { dx: 0, dy: 0 };
  let moveTimer = 0;
  let pendingScroll = 0;
  let scrollTimer = 0;
  let pointerMap = new Map();
  let clickTimer = 0;
  let lastTapAt = 0;

  $("#device-name").value = readLocalValue(DEVICE_KEY) || "My phone";
  document.documentElement.classList.toggle("native-runtime", IS_NATIVE_RUNTIME);
  $("#pc-address").value = remoteOrigin;
  if (IS_NATIVE_RUNTIME) {
    $("#pair-instructions").textContent = "Start Remote Link in HEYMI on your PC. Enter the address and six-digit code it shows, then approve this phone on the desktop.";
    $("#install-card").hidden = true;
  }

  function normalizeRemoteOrigin(value) {
    let candidate = String(value || "").trim();
    if (!candidate) throw new Error("Enter the PC address shown by HEYMI Remote Link.");
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) candidate = `http://${candidate}`;
    let url;
    try { url = new URL(candidate); }
    catch { throw new Error("Enter a valid PC address, including its port."); }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("The PC address must begin with http:// or https://.");
    const host = url.hostname.toLowerCase();
    const privateIpv4 = /^(?:10\.|127\.|169\.254\.|192\.168\.)/.test(host)
      || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
    const privateName = host === "localhost" || host.endsWith(".local");
    const privateIpv6 = host === "::1" || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host);
    if (url.protocol === "http:" && !privateIpv4 && !privateName && !privateIpv6) {
      throw new Error("For safety, an HTTP PC address must be on your private network.");
    }
    return url.origin;
  }

  function remoteUrl(path) {
    if (!IS_NATIVE_RUNTIME) return path;
    if (!remoteOrigin) throw new Error("Enter the PC address shown by HEYMI Remote Link.");
    return new URL(path, `${remoteOrigin}/`).href;
  }

  function setRemoteMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle("is-error", isError);
  }

  async function remoteApi(path, options = {}) {
    const response = await fetch(remoteUrl(path), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(remoteToken ? { Authorization: `Bearer ${remoteToken}` } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Remote Link is unavailable here.");
    return payload;
  }

  function updateRemoteChrome(online, deviceName = "") {
    $("#header-link-button").classList.toggle("is-online", online);
    $("#header-link-label").textContent = online ? "PC linked" : "PC offline";
    $("[data-tab=remote]").classList.toggle("is-linked", online);
    $("#remote-state-pill").classList.toggle("is-online", online);
    $("#remote-state-pill b").textContent = online ? "Linked" : "Offline";
    $("#profile-link-title").textContent = online ? (deviceName || "PC linked") : "No PC linked";
    $("#profile-link-copy").textContent = online ? "Remote controls are ready on this private network." : "Pair over private Wi-Fi to use your phone as a remote.";
  }

  function renderPermissions() {
    const strip = $("#permission-strip");
    strip.replaceChildren();
    for (const [key, enabled] of Object.entries(remotePermissions)) {
      if (!enabled) continue;
      const pill = document.createElement("span");
      pill.className = "permission-pill";
      pill.textContent = key.toUpperCase();
      strip.append(pill);
    }
    const mousePanelAvailable = Boolean(remotePermissions.mouse);
    const keysPanelAvailable = Boolean(remotePermissions.keyboard || remotePermissions.clipboard);
    const mouseTab = $("[data-remote-mode=mouse]");
    const keysTab = $("[data-remote-mode=keys]");
    mouseTab.hidden = !mousePanelAvailable;
    keysTab.hidden = !keysPanelAvailable;
    $("#text-command").hidden = !(remotePermissions.keyboard && remotePermissions.clipboard);
    $("#key-grid").hidden = !remotePermissions.keyboard;
    if (!mousePanelAvailable && keysPanelAvailable) switchRemoteMode("keys");
    else if (mousePanelAvailable) switchRemoteMode("mouse");
    else setRemoteMessage($("#control-status"), "No usable control permission was approved.", true);
  }

  function showRemoteControls(status) {
    remotePermissions = status.permissions || {};
    const name = status.deviceName || $("#device-name").value;
    $("#connected-name").textContent = name;
    $("#pair-screen").hidden = true;
    $("#control-screen").hidden = false;
    $("#pair-button").disabled = false;
    updateRemoteChrome(true, name);
    renderPermissions();
    if (!$("[data-view=remote]").hidden) window.scrollTo({ top: 0, behavior: "auto" });
  }

  function showRemotePairing(message = "Phone and PC must be on the same private network.", clearToken = true) {
    if (clearToken) {
      remoteToken = "";
      removeLocalValue(TOKEN_KEY);
    }
    clearTimeout(remotePollTimer);
    $("#pair-screen").hidden = false;
    $("#control-screen").hidden = true;
    $("#pair-button").disabled = false;
    updateRemoteChrome(false);
    setRemoteMessage($("#pair-status"), message, false);
  }

  async function detectRemoteAvailability() {
    if (IS_NATIVE_RUNTIME && !remoteOrigin) {
      remoteAvailable = null;
      setRemoteMessage($("#pair-status"), "Enter the PC address and code shown by HEYMI Remote Link.");
      return;
    }
    try {
      await remoteApi("/api/device");
      remoteAvailable = true;
    } catch {
      remoteAvailable = false;
      if (!remoteToken) setRemoteMessage($("#pair-status"), "Open the /phone address shown by HEYMI Remote Link on your PC to pair.");
    }
  }

  async function restoreRemoteSession() {
    await detectRemoteAvailability();
    if (!remoteToken) return showRemotePairing($("#pair-status").textContent, false);
    try { showRemoteControls(await remoteApi("/api/status")); }
    catch { showRemotePairing("This phone's PC session expired. Pair it again."); }
  }

  async function pollPairing(requestId) {
    clearTimeout(remotePollTimer);
    try {
      const result = await remoteApi(`/api/pair/${encodeURIComponent(requestId)}`);
      if (result.status === "approved" && result.token) {
        remoteToken = result.token;
        writeLocalValue(TOKEN_KEY, remoteToken);
        showRemoteControls({ deviceName: $("#device-name").value, permissions: result.permissions });
        setRemoteMessage($("#control-status"), "Remote input ready.");
        showToast("PC linked", "Your approved controls are ready.", "✓");
        haptic([12, 30, 12]);
        return;
      }
      if (result.status === "rejected") {
        $("#pair-button").disabled = false;
        return setRemoteMessage($("#pair-status"), "The desktop rejected this request.", true);
      }
      setRemoteMessage($("#pair-status"), "Request received. Approve this phone on the desktop.");
      remotePollTimer = window.setTimeout(() => pollPairing(requestId), 1200);
    } catch (error) {
      $("#pair-button").disabled = false;
      setRemoteMessage($("#pair-status"), error.message, true);
    }
  }

  async function requestPairing() {
    const code = $("#pair-code").value.replace(/\D/g, "").slice(0, 6);
    const name = $("#device-name").value.trim().slice(0, 48) || "Phone controller";
    if (IS_NATIVE_RUNTIME) {
      try {
        remoteOrigin = normalizeRemoteOrigin($("#pc-address").value);
        $("#pc-address").value = remoteOrigin;
        writeLocalValue(REMOTE_ORIGIN_KEY, remoteOrigin);
        remoteAvailable = null;
      } catch (error) {
        return setRemoteMessage($("#pair-status"), error.message, true);
      }
    }
    if (code.length !== 6) return setRemoteMessage($("#pair-status"), "Enter the six-digit code shown on your PC.", true);
    if (!IS_NATIVE_RUNTIME && remoteAvailable === false) return setRemoteMessage($("#pair-status"), "This preview is not connected to HEYMI Remote Link. Open the phone address shown by the desktop app.", true);
    $("#pair-button").disabled = true;
    writeLocalValue(DEVICE_KEY, name);
    setRemoteMessage($("#pair-status"), "Sending pairing request…");
    try {
      const result = await remoteApi("/api/pair", { method: "POST", body: JSON.stringify({ code, deviceName: name }) });
      pollPairing(result.requestId);
    } catch (error) {
      $("#pair-button").disabled = false;
      setRemoteMessage($("#pair-status"), error.message, true);
    }
  }

  async function disconnectRemote() {
    try { await remoteApi("/api/session", { method: "DELETE" }); }
    catch { /* Older desktop builds do not expose self-revocation. */ }
    showRemotePairing("Disconnected. If your desktop is on an older build, revoke this phone there too.");
    showToast("Phone disconnected", "Remote controls are off on this phone.", "✓");
  }

  async function sendInput(input, quiet = false) {
    try {
      await remoteApi("/api/input", { method: "POST", body: JSON.stringify(input) });
      if (!quiet) setRemoteMessage($("#control-status"), "Command sent.");
      return true;
    } catch (error) {
      setRemoteMessage($("#control-status"), error.message, true);
      if (/authorized|session|expired/i.test(error.message)) showRemotePairing("Desktop authorization was revoked.");
      return false;
    }
  }

  function flushMove() {
    moveTimer = 0;
    const move = pendingMove;
    pendingMove = { dx: 0, dy: 0 };
    if (Math.abs(move.dx) + Math.abs(move.dy) >= .5) void sendInput({ type: "move", dx: move.dx, dy: move.dy }, true);
  }

  function queueMove(dx, dy) {
    pendingMove.dx += dx;
    pendingMove.dy += dy;
    if (!moveTimer) moveTimer = window.setTimeout(flushMove, 42);
  }

  function flushScroll() {
    scrollTimer = 0;
    const delta = pendingScroll;
    pendingScroll = 0;
    if (Math.abs(delta) >= 1) void sendInput({ type: "scroll", delta: Math.round(delta) }, true);
  }

  function queueScroll(delta) {
    pendingScroll += delta;
    if (!scrollTimer) scrollTimer = window.setTimeout(flushScroll, 48);
  }

  function queueTapClick() {
    const now = performance.now();
    if (clickTimer && now - lastTapAt < 330) {
      clearTimeout(clickTimer);
      clickTimer = 0;
      lastTapAt = 0;
      void sendInput({ type: "click", button: "left", count: 2 }, true);
      haptic(10);
      return;
    }
    lastTapAt = now;
    clickTimer = window.setTimeout(() => {
      clickTimer = 0;
      void sendInput({ type: "click", button: "left", count: 1 }, true);
      haptic(7);
    }, 330);
  }

  function switchRemoteMode(mode) {
    $$("[data-remote-mode]").forEach((button) => {
      const active = button.dataset.remoteMode === mode;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-selected", String(active));
    });
    $$("[data-remote-panel]").forEach((panel) => {
      const active = panel.dataset.remotePanel === mode;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
  }

  const touchpad = $("#touchpad");
  touchpad.addEventListener("pointerdown", (event) => {
    pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY, startedAt: performance.now(), moved: 0 });
    touchpad.setPointerCapture(event.pointerId);
    touchpad.classList.add("is-active");
    event.preventDefault();
  });
  touchpad.addEventListener("pointermove", (event) => {
    const pointer = pointerMap.get(event.pointerId);
    if (!pointer) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.moved += Math.abs(dx) + Math.abs(dy);
    if (pointerMap.size >= 2) {
      pointerMap.forEach((item) => { item.moved = Math.max(item.moved, 20); });
      queueScroll(-dy * 10);
    } else {
      const gain = Number($("#sensitivity").value) || 1;
      queueMove(dx * gain, dy * gain);
    }
    event.preventDefault();
  });

  function finishTouchPointer(event, cancelled = false) {
    const pointer = pointerMap.get(event.pointerId);
    if (!pointer) return;
    pointerMap.delete(event.pointerId);
    if (!pointerMap.size) touchpad.classList.remove("is-active");
    const wasTap = !cancelled && pointer.moved < 12 && performance.now() - pointer.startedAt < 420;
    if (wasTap && !pointerMap.size) queueTapClick();
    event.preventDefault();
  }
  touchpad.addEventListener("pointerup", (event) => finishTouchPointer(event, false));
  touchpad.addEventListener("pointercancel", (event) => finishTouchPointer(event, true));

  async function sendTypedText() {
    const input = $("#text-input");
    const text = input.value.slice(0, 1000);
    if (!text) return;
    if (await sendInput({ type: "text", text })) input.value = "";
  }

  // Event wiring
  $$("[data-tab]").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  $$("[data-open-tab]").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.openTab)));
  $$("[data-care]").forEach((button) => button.addEventListener("click", () => careForPet(button.dataset.care)));
  $$("[data-pet]").forEach((button) => button.addEventListener("click", () => selectPet(button.dataset.pet)));
  $$("[data-aura]").forEach((button) => button.addEventListener("click", () => selectAura(button.dataset.aura)));
  $$("[data-outfit]").forEach((button) => button.addEventListener("click", () => selectOutfit(button.dataset.outfit)));
  $$("[data-remote-mode]").forEach((button) => button.addEventListener("click", () => switchRemoteMode(button.dataset.remoteMode)));
  $("#pet-touch-target").addEventListener("click", handlePetTap);
  $("#daily-claim-button").addEventListener("click", claimDaily);
  $("#daily-gift-button").addEventListener("click", claimGift);
  $("#cast-button").addEventListener("click", castLine);
  $("#garden-grid").addEventListener("click", (event) => {
    const plot = event.target.closest("[data-plot]");
    if (plot) handleGardenPlot(Number(plot.dataset.plot));
  });
  $("#clear-outfit-button").addEventListener("click", () => selectOutfit("none"));
  $("#collection-button").addEventListener("click", showCollections);
  $("#rename-button").addEventListener("click", renameProfile);
  $("#about-button").addEventListener("click", showPrivacy);
  $("#privacy-button").addEventListener("click", showPrivacy);
  $("#export-data-button").addEventListener("click", exportPocketData);
  $("#import-data-button").addEventListener("click", () => $("#import-data-file").click());
  $("#import-data-file").addEventListener("change", importPocketData);
  $("#reset-data-button").addEventListener("click", resetPocketData);
  $("#erase-data-button").addEventListener("click", eraseAllHeymiData);
  $("#photo-button").addEventListener("click", () => { showToast("Look remembered", `${state.profile.petName} looks wonderful.`, "✦"); haptic(8); });
  $$("[data-world]").forEach((button) => button.addEventListener("click", () => {
    switchTab("remote");
    showToast(remoteToken ? "Remote ready" : "Connect your PC", remoteToken ? `Use the remote to continue to ${button.dataset.world}.` : "Pair first to reach your desktop world.", "H");
  }));
  $("#haptics-setting").addEventListener("change", (event) => { state.settings.haptics = event.target.checked; saveState(); if (event.target.checked) haptic(10); });
  $("#motion-setting").addEventListener("change", (event) => { state.settings.reducedMotion = event.target.checked; saveState(); renderProfile(); });
  $("#contrast-setting").addEventListener("change", (event) => { state.settings.highContrast = event.target.checked; saveState(); renderProfile(); });
  $("#pocket-dialog .dialog-close").addEventListener("click", () => closeDialog(false));
  $("#pocket-dialog .dialog-action").addEventListener("click", () => closeDialog(true));
  $("#pocket-dialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeDialog(false); });

  $("#pair-button").addEventListener("click", requestPairing);
  $("#pair-code").addEventListener("input", (event) => { event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6); });
  $("#disconnect-button").addEventListener("click", disconnectRemote);
  $("#left-click").addEventListener("click", () => sendInput({ type: "click", button: "left", count: 1 }));
  $("#right-click").addEventListener("click", () => sendInput({ type: "click", button: "right", count: 1 }));
  $("#key-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-key]");
    if (button) void sendInput({ type: "key", key: button.dataset.key });
  });
  $("#send-text").addEventListener("click", sendTypedText);
  $("#text-input").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void sendTypedText(); } });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $("#install-button").disabled = false;
    $("#install-button").textContent = "Add to home screen";
  });
  $("#install-button").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return showInstallInstructions();
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $("#install-button").disabled = true;
    $("#install-button").textContent = "Installed or dismissed";
  });
  window.addEventListener("appinstalled", () => { $("#install-card").hidden = true; });
  if (IS_STANDALONE || IS_NATIVE_RUNTIME) $("#install-card").hidden = true;
  else {
    $("#install-button").disabled = false;
    $("#install-button").textContent = /iPad|iPhone|iPod/.test(navigator.userAgent) ? "iPhone install steps" : "How to install";
  }

  prepareDailyState();
  checkQuestRewards();
  saveState();
  updateGreeting();
  renderAll();
  const initialTab = new URL(location.href).searchParams.get("tab");
  const availableTabs = IS_PUBLIC_WEB ? ["home", "pet", "play", "you"] : ["home", "pet", "play", "remote", "you"];
  switchTab(availableTabs.includes(initialTab) ? initialTab : "home", false);
  if (!IS_PUBLIC_WEB) void restoreRemoteSession();
  gardenTimer = window.setInterval(renderGarden, 1000);
  window.setTimeout(showOnboarding, 320);

  function refreshAfterResume() {
    prepareDailyState();
    checkQuestRewards();
    saveState({ silent: true });
    renderAll();
    updateGreeting();
  }
  window.addEventListener("pageshow", refreshAfterResume);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAfterResume(); });

  if ("serviceWorker" in navigator && window.isSecureContext && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" }).catch(() => {});
  }
  window.addEventListener("beforeunload", () => {
    clearInterval(gardenTimer);
    clearTimeout(remotePollTimer);
    clearTimeout(moveTimer);
    clearTimeout(scrollTimer);
    clearTimeout(clickTimer);
  });
})();
