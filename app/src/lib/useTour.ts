import { computed, reactive, ref, shallowReactive, shallowRef, watch, type InjectionKey } from "vue";
import { api, type FileDiff, type FileStat, type GenerationState, type Located, type Problem } from "./api";
import { anchorsIn, skippedBy, uncoveredHunks } from "./coverage";
import { anchorWindow, parseFile, type DiffWindow, type ParsedDiff, type Row } from "./diff";
import type { HighlightedLines } from "./highlight";
import { highlightFile } from "./highlighter";
import { DEFAULT_PREFERENCES, onPreferencesChanged, readPreferences, SIDEBAR_WIDTH, writePreferences, type DiffView, type Preferences } from "./preferences";
import { progressKey, readProgress, writeProgress } from "./progress";
import { entryMatches, searchQuery, type CodeOf } from "./search";
import { applyTheme, type ThemeChoice } from "./theme";
import { anchoredFiles, entries, filesOf, isStep, parseTour } from "./tour";
import { highlightKey, type Answers, type Anchor, type AnchorKey, type CommitId, type EntryId, type HighlightKey, type HunkIndex, type Progress, type ProgressKey, type RepoFile, type Side, type StepId, type Tour } from "./types";

/** The agent's time limit and a minute's grace, as the generator allows it. */
const ANSWER_GIVES_UP_AFTER_MS = 21 * 60 * 1000;
/** git processes reading diffs at once. More stay queued, current page first. */
const PARALLEL_DIFFS = 8;
/** Writing a tour touches the folder several times in a row; reload once. */
const RELOAD_DEBOUNCE_MS = 120;

export type DiffState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; diff: ParsedDiff };

const LOADING: DiffState = { status: "loading" };

export function createTourState() {
  const status = ref("Looking for a tour…");
  /** The start window, opened without a repository or when one couldn't be opened. */
  const choosing = ref(false);
  const writing = ref(false);
  /** No tour and none being written: one can be started here. */
  const missing = ref(false);
  const generation = ref<GenerationState>({ running: false, lines: [], failure: null });
  const located = shallowRef<Located | null>(null);
  /** Every file the tour's commits change, with its size; null until read. */
  const stat = shallowRef<FileStat[] | null>(null);
  /** Files open as tabs beside the tour, and the one shown; null shows the tour. */
  const tabs = ref<RepoFile[]>([]);
  const activeTab = ref<RepoFile | null>(null);
  // Tours never change in place: a new file means a new object, so nothing inside needs tracking.
  const tour = shallowRef<Tour | null>(null);
  const tip = ref<CommitId | null>(null);
  const problems = ref<Problem[]>([]);
  /** The tour itself is wrong; the reviewer should know, the agent should fix it. */
  const tourProblems = computed(() => problems.value.filter((p) => p.kind === "tour").map((p) => p.message));
  /** Changes the tour doesn't account for; "Not in the tour" shows them. */
  const coverageGaps = computed(() => problems.value.filter((p) => p.kind === "coverage").length);
  const closelyOnly = ref(false);
  const progress = ref<Progress>({ done: {}, current: "overview" });
  // Parsed diffs can hold thousands of rows each; only the map itself is reactive.
  const diffs = shallowReactive(new Map<RepoFile, DiffState>());
  const windows = new Map<AnchorKey, DiffWindow>();
  // Coloured lines per file side, filled in by the highlighting worker as it gets to them.
  const highlights = shallowReactive(new Map<HighlightKey, HighlightedLines>());
  const preferences = ref<Preferences>(DEFAULT_PREFERENCES);
  const query = ref("");
  const answers = shallowRef<Answers>({ version: 1, entries: [] });
  const askError = ref<string | null>(null);
  const sending = ref(false);

  let key: ProgressKey | null = null;
  let loadNumber = 0;
  let queue: RepoFile[] = [];
  let active = 0;

  const list = computed(() => (tour.value ? entries(tour.value, closelyOnly.value) : []));
  const current = computed(() => list.value.find((e) => e.id === progress.value.current) ?? list.value[0]);
  const stale = computed(() => Boolean(tip.value && tour.value && tip.value !== tour.value.head_sha));

  /** The lines an anchor shows when its page opens, once its diff has loaded. */
  const codeOf: CodeOf = (anchor) => {
    const state = diffs.get(anchor.file);
    if (state?.status !== "ready") return null;
    const window = anchorWindow(state.diff.rows, anchor);
    return window ? state.diff.rows.slice(window.lo, window.hi + 1).map((r) => r.text) : [];
  };
  const searched = computed(() => searchQuery(query.value));
  /** The entries that match the search, or null while there is no search. */
  const matching = computed(() => {
    const reviewed = tour.value;
    const wanted = searched.value;
    if (!reviewed || !wanted) return null;
    return new Set(list.value.filter((e) => entryMatches(reviewed, e, wanted, codeOf)).map((e) => e.id));
  });

  /** Goes to the next entry that matches the search, after the current one. */
  function nextMatch(delta = 1) {
    const found = matching.value;
    if (!found?.size) return;
    const count = list.value.length;
    const at = list.value.findIndex((e) => e.id === progress.value.current);
    for (let step = 1; step <= count; step++) {
      const entry = list.value[(((at + step * delta) % count) + count) % count];
      if (found.has(entry.id)) return go(entry.id);
    }
  }

  function setPreferences(change: Partial<Preferences>) {
    preferences.value = { ...preferences.value, ...change };
    void writePreferences(preferences.value);
  }

  const setDiffView = (diffView: DiffView) => setPreferences({ diffView });
  const toggleDiffView = () => setDiffView(preferences.value.diffView === "split" ? "unified" : "split");
  const toggleWrap = () => setPreferences({ wrap: !preferences.value.wrap });
  const THEMES: ThemeChoice[] = ["system", "light", "dark"];
  const cycleTheme = () => setPreferences({ theme: THEMES[(THEMES.indexOf(preferences.value.theme) + 1) % THEMES.length] });
  const clampWidth = (width: number) => Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));
  const setSidebarWidth = (width: number) => setPreferences({ sidebarWidth: clampWidth(width) });
  const toggleChat = () => setPreferences({ chatOpen: !preferences.value.chatOpen });

  /** Answers about this tour's commit; questions about an older tour of the branch stay in the file. */
  const currentAnswers = computed(() => answers.value.entries.filter((e) => e.head_sha === tour.value?.head_sha));
  /**
   * Whether a question is being answered. One the agent hasn't answered after
   * its time limit was abandoned, e.g. by quitting the app.
   */
  const asking = computed(() => {
    const cutoff = Date.now() - ANSWER_GIVES_UP_AFTER_MS;
    return sending.value || answers.value.entries.some((e) => e.status === "pending" && Date.parse(e.asked_at) > cutoff);
  });

  async function loadAnswers() {
    try {
      answers.value = await api.readAnswers();
    } catch {
      // A window without a tour has no answers.
    }
  }

  async function askQuestion(step: StepId, question: string): Promise<boolean> {
    if (!question.trim() || asking.value) return false;
    sending.value = true;
    askError.value = null;
    try {
      await api.ask(step, question);
      await loadAnswers();
      return true;
    } catch (e) {
      askError.value = String(e);
      return false;
    } finally {
      sending.value = false;
    }
  }

  function setProgress(change: Partial<Progress>) {
    progress.value = { ...progress.value, ...change };
    if (key) void writeProgress(key, progress.value);
  }

  function go(id: EntryId) {
    activeTab.value = null;
    setProgress({ current: id });
  }

  function openTab(file: RepoFile) {
    if (!tabs.value.includes(file)) tabs.value = [...tabs.value, file];
    activeTab.value = file;
    request([file], true);
  }

  function closeTab(file: RepoFile) {
    const at = tabs.value.indexOf(file);
    tabs.value = tabs.value.filter((f) => f !== file);
    if (activeTab.value === file) activeTab.value = tabs.value[Math.min(at, tabs.value.length - 1)] ?? null;
  }

  /** Steps the tour by one tab, the tour itself being the first. */
  function moveTab(delta: number) {
    const all = [null, ...tabs.value];
    const at = all.indexOf(activeTab.value);
    activeTab.value = all[(at + delta + all.length) % all.length];
  }

  function move(delta: number) {
    const at = Math.max(0, list.value.findIndex((e) => e.id === progress.value.current));
    const next = list.value[Math.min(list.value.length - 1, Math.max(0, at + delta))];
    if (next) go(next.id);
  }

  function toggleDone(id: EntryId) {
    if (!isStepId(id)) return;
    const done = { ...progress.value.done };
    if (done[id]) delete done[id];
    else done[id] = true;
    setProgress({ done });
  }

  function toggleFilter() {
    closelyOnly.value = !closelyOnly.value;
    if (!list.value.some((e) => e.id === progress.value.current)) go("overview");
  }

  function windowFor(anchorKey: AnchorKey, rows: Row[], anchor: Anchor): DiffWindow | null {
    let window = windows.get(anchorKey);
    if (!window) {
      const fresh = anchorWindow(rows, anchor);
      if (!fresh) return null;
      window = reactive(fresh);
      windows.set(anchorKey, window);
    }
    return window;
  }

  /** A window over one whole hunk, for the uncovered page. */
  function hunkWindowFor(key: AnchorKey, rows: Row[], hunk: HunkIndex): DiffWindow | null {
    let window = windows.get(key);
    if (!window) {
      const first = rows.findIndex((r) => r.hunk === hunk);
      if (first < 0) return null;
      const last = rows.findLastIndex((r) => r.hunk === hunk);
      window = reactive({ lo: first, hi: last, open: new Set() } as DiffWindow);
      windows.set(key, window);
    }
    return window;
  }

  /**
   * The changes no step or concern points at: whole files the tour never
   * mentions, and hunks of mentioned files no anchor overlaps. A mentioned
   * file only shows up once its diff has loaded.
   */
  const uncovered = computed(() => {
    const reviewed = tour.value;
    if (!reviewed || !stat.value) return null;
    return stat.value.flatMap((entry) => {
      if (skippedBy(reviewed, entry.file)) return [];
      const anchors = anchorsIn(reviewed, entry.file);
      const state = diffs.get(entry.file);
      if (anchors.length === 0) return [{ ...entry, hunks: state?.status === "ready" ? state.diff.hunks.map((_, i) => i as HunkIndex) : null }];
      if (state?.status !== "ready") return [];
      const hunks = uncoveredHunks(state.diff.hunks, anchors);
      return hunks.length ? [{ ...entry, hunks }] : [];
    });
  });

  /** Queues diffs to read; `urgent` ones jump ahead of everything queued. */
  function request(files: RepoFile[], urgent: boolean) {
    const fresh = [...new Set(files)].filter((f) => !diffs.has(f));
    for (const file of fresh) diffs.set(file, LOADING);
    if (urgent) {
      const ahead = new Set([...files.filter((f) => queue.includes(f)), ...fresh]);
      queue = [...ahead, ...queue.filter((f) => !ahead.has(f))];
    } else {
      queue.push(...fresh);
    }
    pump();
  }

  function pump() {
    const at = located.value;
    const reviewed = tour.value;
    if (!at || !reviewed) return;
    while (active < PARALLEL_DIFFS && queue.length) {
      const file = queue.shift()!;
      const loadedFor = loadNumber;
      active++;
      api
        .fileDiff(at.root, reviewed.base_sha, reviewed.head_sha, file)
        .then(
          (read) => {
            if (loadedFor !== loadNumber) return;
            diffs.set(file, toDiffState(read));
            highlight(file, "new", read.lines, loadedFor);
            highlight(file, "old", read.base_lines, loadedFor);
          },
          (e) => {
            if (loadedFor === loadNumber) diffs.set(file, { status: "error", message: String(e) });
          },
        )
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  function highlight(file: RepoFile, side: Side, code: string | null, loadedFor: number) {
    if (code === null) return;
    void highlightFile(file, code).then((lines) => {
      if (lines && loadedFor === loadNumber) highlights.set(highlightKey(file, side), lines);
    });
  }

  async function load() {
    const at = located.value;
    if (!at) return;
    const loading = ++loadNumber;
    queue = [];
    const file = await api.readTour(at.path);
    if (loading !== loadNumber) return;
    writing.value = file.writing;
    missing.value = file.text === null && !file.writing;
    if (file.text === null) {
      tour.value = null;
      status.value = file.writing
        ? `Writing the tour for ${at.branch}… It shows here when it's ready.`
        : `No tour yet for ${at.branch}. Run /pr-tour in its session, or pr-tour in a terminal.`;
      return;
    }
    const parsed = parseTour(file.text);
    if ("problem" in parsed) {
      tour.value = null;
      status.value = parsed.problem;
      return;
    }
    const next = parsed.tour;
    const nextKey = progressKey(at.root, next.branch ?? at.branch, next.head_sha);
    const [nextTip, saved] = await Promise.all([api.branchTip(at.root, next.branch ?? at.branch), readProgress(nextKey)]);
    if (loading !== loadNumber) return;

    diffs.clear();
    windows.clear();
    highlights.clear();
    stat.value = null;
    problems.value = [];
    key = nextKey;
    tip.value = nextTip;
    progress.value = saved;
    tour.value = next;
    if (!list.value.some((e) => e.id === progress.value.current)) go(list.value[0].id);

    request([...(current.value ? filesOf(next, current.value) : []), ...tabs.value], true);
    request(anchoredFiles(next), false);
    void api.diffStat(at.root, next.base_sha, next.head_sha).then(
      (found) => {
        if (loading === loadNumber) stat.value = found;
      },
      () => {},
    );
    void api.validateTour(at.root, at.path).then((found) => {
      if (loading === loadNumber) problems.value = found;
    });
  }

  async function showStart() {
    const content = await api.windowContent();
    if (content.kind === "start") status.value = content.message ?? "Choose a repository to review the branch checked out in it.";
  }

  async function startPreferences() {
    await onPreferencesChanged((changed) => (preferences.value = changed));
    preferences.value = await readPreferences();
  }

  watch(
    () => preferences.value.theme,
    (theme) => applyTheme(theme),
  );

  async function start() {
    await startPreferences();
    const content = await api.windowContent();
    if (content.kind === "start") {
      choosing.value = true;
      await api.onStartChanged(showStart);
      await showStart();
      return;
    }
    located.value = content.located;
    let pending: ReturnType<typeof setTimeout> | undefined;
    await api.onTourChanged(() => {
      clearTimeout(pending);
      pending = setTimeout(load, RELOAD_DEBOUNCE_MS);
    });
    await api.onAnswersChanged(loadAnswers);
    // Listen before asking, so no update falls between the two.
    await api.onGeneration((state) => (generation.value = state));
    generation.value = await api.generationState();
    await Promise.all([load(), loadAnswers()]);
  }

  async function chooseRepo(repo: string) {
    status.value = "Opening…";
    try {
      await api.openRepo(repo);
    } catch (e) {
      status.value = String(e);
    }
  }

  /** `rewrite` replaces a tour that already covers the branch's commit. */
  function writeTour(rewrite = false) {
    void api.startGeneration(rewrite).catch((e) => (generation.value = { running: false, lines: [], failure: String(e) }));
  }

  watch([current, stat], ([entry]) => {
    if (!entry || !tour.value) return;
    if (entry.id === "uncovered") request(uncoveredFiles(), true);
    else request(filesOf(tour.value, entry), true);
  });

  /** The files the uncovered page shows whole, which nothing else loads. */
  const uncoveredFiles = () =>
    (stat.value ?? []).map((s) => s.file).filter((f) => tour.value && !skippedBy(tour.value, f) && anchorsIn(tour.value, f).length === 0);

  return {
    status,
    choosing,
    writing,
    missing,
    generation,
    tour,
    stat,
    uncovered,
    hunkWindowFor,
    tabs,
    activeTab,
    openTab,
    closeTab,
    moveTab,
    highlights,
    preferences,
    setDiffView,
    toggleDiffView,
    toggleWrap,
    cycleTheme,
    clampWidth,
    setSidebarWidth,
    currentAnswers,
    asking,
    askError,
    askQuestion,
    toggleChat,
    query,
    searched,
    matching,
    nextMatch,
    tip,
    stale,
    tourProblems,
    coverageGaps,
    closelyOnly,
    progress,
    diffs,
    list,
    current,
    isStep,
    start,
    chooseRepo,
    writeTour,
    stopWriting: () => void api.cancelGeneration(),
    go,
    move,
    toggleDone,
    toggleFilter,
    windowFor,
  };
}

const isStepId = (id: EntryId): id is StepId => id !== "overview" && id !== "concerns" && id !== "uncovered";

function toDiffState(file: FileDiff): DiffState {
  if ("Err" in file.diff) return { status: "error", message: file.diff.Err };
  return { status: "ready", diff: parseFile(file.diff.Ok, file.lines) };
}

export type TourState = ReturnType<typeof createTourState>;
export const TOUR: InjectionKey<TourState> = Symbol("tour");
