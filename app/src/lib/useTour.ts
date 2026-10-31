import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, reactive, ref, shallowReactive, shallowRef, watch, type InjectionKey } from "vue";
import { api, type FileDiff, type Located } from "./api";
import { anchorWindow, parseFile, type DiffWindow, type ParsedDiff, type Row } from "./diff";
import { progressKey, readProgress, writeProgress } from "./progress";
import { anchoredFiles, entries, filesOf, isStep, parseTour } from "./tour";
import type { Anchor, AnchorKey, CommitId, EntryId, Progress, ProgressKey, RepoFile, Tour } from "./types";

/** git processes reading diffs at once. More stay queued, current page first. */
const PARALLEL_DIFFS = 8;
/** Writing a tour touches the folder several times in a row; reload once. */
const RELOAD_DEBOUNCE_MS = 120;

export type DiffState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; diff: ParsedDiff };

const LOADING: DiffState = { status: "loading" };

export function createTourState() {
  const status = ref("Looking for a tour…");
  const located = shallowRef<Located | null>(null);
  // Tours never change in place: a new file means a new object, so nothing inside needs tracking.
  const tour = shallowRef<Tour | null>(null);
  const tip = ref<CommitId | null>(null);
  const problems = ref<string[]>([]);
  const closelyOnly = ref(false);
  const progress = ref<Progress>({ done: {}, current: "overview" });
  // Parsed diffs can hold thousands of rows each; only the map itself is reactive.
  const diffs = shallowReactive(new Map<RepoFile, DiffState>());
  const windows = new Map<AnchorKey, DiffWindow>();

  let key: ProgressKey | null = null;
  let generation = 0;
  let queue: RepoFile[] = [];
  let active = 0;

  const list = computed(() => (tour.value ? entries(tour.value, closelyOnly.value) : []));
  const current = computed(() => list.value.find((e) => e.id === progress.value.current) ?? list.value[0]);
  const stale = computed(() => Boolean(tip.value && tour.value && tip.value !== tour.value.head_sha));

  function setProgress(change: Partial<Progress>) {
    progress.value = { ...progress.value, ...change };
    if (key) void writeProgress(key, progress.value);
  }

  function go(id: EntryId) {
    setProgress({ current: id });
  }

  function move(delta: number) {
    const at = Math.max(0, list.value.findIndex((e) => e.id === progress.value.current));
    const next = list.value[Math.min(list.value.length - 1, Math.max(0, at + delta))];
    if (next) go(next.id);
  }

  function toggleDone(id: EntryId) {
    if (id === "overview" || id === "concerns") return;
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
      const loadedFor = generation;
      active++;
      api
        .fileDiff(at.root, reviewed.base_sha, reviewed.head_sha, file)
        .then(toDiffState, (e): DiffState => ({ status: "error", message: String(e) }))
        .then((state) => {
          if (loadedFor === generation) diffs.set(file, state);
        })
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  async function load() {
    const at = located.value;
    if (!at) return;
    const loading = ++generation;
    queue = [];
    const file = await api.readTour(at.path);
    if (loading !== generation) return;
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
    if (loading !== generation) return;

    diffs.clear();
    windows.clear();
    problems.value = [];
    key = nextKey;
    tip.value = nextTip;
    progress.value = saved;
    tour.value = next;
    if (!list.value.some((e) => e.id === progress.value.current)) go(list.value[0].id);

    request(current.value ? filesOf(next, current.value) : [], true);
    request(anchoredFiles(next), false);
    void api.validateTour(at.root, at.path).then((found) => {
      if (loading === generation) problems.value = found;
    });
  }

  async function start() {
    const launch = await api.launch();
    if (launch.problem) {
      status.value = launch.problem;
      return;
    }
    if (!launch.repo) {
      status.value = "Start PR Tour from a repository: pr-tour [branch] [--repo <path>]";
      return;
    }
    try {
      located.value = await api.locate(launch.repo, launch.branch, launch.tour);
    } catch (e) {
      status.value = String(e);
      return;
    }
    void getCurrentWindow().setTitle(`Tour · ${located.value.branch}`);
    let pending: ReturnType<typeof setTimeout> | undefined;
    await api.onTourChanged(() => {
      clearTimeout(pending);
      pending = setTimeout(load, RELOAD_DEBOUNCE_MS);
    });
    await api.watchTour(located.value.path);
    await load();
  }

  watch(current, (entry) => {
    if (entry && tour.value) request(filesOf(tour.value, entry), true);
  });

  return { status, tour, tip, stale, problems, closelyOnly, progress, diffs, list, current, isStep, start, go, move, toggleDone, toggleFilter, windowFor };
}

function toDiffState(file: FileDiff): DiffState {
  if ("Err" in file.diff) return { status: "error", message: file.diff.Err };
  return { status: "ready", diff: parseFile(file.diff.Ok, file.lines) };
}

export type TourState = ReturnType<typeof createTourState>;
export const TOUR: InjectionKey<TourState> = Symbol("tour");
