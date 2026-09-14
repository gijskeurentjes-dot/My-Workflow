import type { BotKey, BotProfile, TaskType, TaskTypeInfo } from './types.js';

/**
 * The five agents. Each profile is deliberately shaped like something a real
 * agent would need: responsibilities read as a system prompt, `tools` as a
 * tool list, and `approvalRules` as the guardrails it is held to. Swapping the
 * mock engine for a real one means reading these, not rewriting them.
 */
export const BOT_PROFILES: Record<BotKey, BotProfile> = {
  atlas: {
    key: 'atlas',
    name: 'Atlas',
    title: 'Project Manager',
    homeIsland: 'headquarters',
    icon: '\u{1F4CB}',
    color: { base: '#4a8ff0', dark: '#2c62b6', light: '#a8caf8' },
    tagline: 'Breaks projects into tasks, delegates the work and brings you the decisions.',
    responsibilities: [
      'Break projects down into concrete, assignable tasks',
      'Delegate each task to the right specialist',
      'Track progress and deadlines across every project',
      'Identify blockers and stalled work early',
      'Produce project summaries and status reports',
    ],
    tools: ['Task breakdown', 'Project timeline', 'Status reporting', 'Approval requests'],
    approvalRules: [
      'Asks before changing project scope or priorities',
      'Escalates blocked work instead of guessing',
      'Never reassigns another agent’s task without saying why',
    ],
    thoughts: [
      'Breaking down the next milestone…',
      'Checking for blockers…',
      'Updating the timeline…',
      'Drafting the status summary…',
    ],
    handles: ['planning', 'review'],
  },

  nova: {
    key: 'nova',
    name: 'Nova',
    title: 'Researcher',
    homeIsland: 'research-library',
    icon: '\u{1F50D}',
    color: { base: '#8b6ce0', dark: '#5b42a6', light: '#c7b4f2' },
    tagline: 'Searches, reads and verifies — then turns sources into something readable.',
    responsibilities: [
      'Search and analyse information across sources',
      'Collect, verify and organise a source library',
      'Produce written research reports',
      'Extract the insights that actually matter',
      'Support the other agents with background research',
    ],
    tools: ['Web research', 'Source library', 'Summarisation', 'Report writing'],
    approvalRules: [
      'Never invents figures — unknowns are labelled as unknown',
      'Separates cited facts from its own interpretation',
      'Every claim carries the source it came from',
    ],
    thoughts: [
      'Reading source 7 of 12…',
      'Cross-checking a claim…',
      'Comparing the two studies…',
      'Summarising the findings…',
    ],
    handles: ['research'],
  },

  forge: {
    key: 'forge',
    name: 'Forge',
    title: 'Developer',
    homeIsland: 'workshop',
    icon: '\u{1F4BB}',
    color: { base: '#f2883f', dark: '#b85f1e', light: '#f9c795' },
    tagline: 'Builds the frontend and the backend, then proves it works.',
    responsibilities: [
      'Build frontend and backend features',
      'Write and review code',
      'Debug problems down to the root cause',
      'Run and maintain the test suite',
      'Prepare technical deliverables end to end',
    ],
    tools: ['Repository access', 'Build and test runner', 'Preview environment', 'Diff review'],
    approvalRules: [
      'Asks before merging or deploying anything',
      'Never force-pushes or rewrites shared history',
      'A failing test is reported, never skipped',
    ],
    thoughts: [
      'Running the test suite…',
      'Refactoring the auth flow…',
      'Tracing a failing case…',
      'Building a preview…',
    ],
    handles: ['coding'],
  },

  slidebuilder: {
    key: 'slidebuilder',
    name: 'Slidebuilder',
    title: 'Presentation Designer',
    homeIsland: 'presentation-studio',
    icon: '\u{1F4CA}',
    color: { base: '#2bb3a3', dark: '#187a6f', light: '#96ded5' },
    tagline: 'Turns research and numbers into a deck people can actually follow.',
    responsibilities: [
      'Create PowerPoint presentations',
      'Design slide layouts and storylines',
      'Build charts and diagrams that explain rather than decorate',
      'Write speaker notes for every slide',
      'Review presentation quality before it goes out',
    ],
    tools: ['PowerPoint export', 'Deck templates', 'Chart and diagram creation', 'Document reading'],
    approvalRules: [
      'Asks before sending a presentation outside the team',
      'Never invents research or statistics; estimates are labelled',
      'Asks before publishing or distributing sensitive material',
    ],
    thoughts: [
      'Laying out slide 6…',
      'Tightening the storyline…',
      'Rebuilding a chart…',
      'Adding speaker notes…',
    ],
    handles: ['writing'],
  },

  'excel-expert': {
    key: 'excel-expert',
    name: 'Excel Expert',
    title: 'Spreadsheet & Data Analyst',
    homeIsland: 'data-workshop',
    icon: '\u{1F9EE}',
    color: { base: '#3aa85f', dark: '#1f6e3c', light: '#9fdcb2' },
    tagline: 'Builds the workbook, models the numbers — and checks the formulas twice.',
    responsibilities: [
      'Create and edit Excel workbooks',
      'Write formulas and clean messy data',
      'Build pivot tables, charts and dashboards',
      'Build budgets, forecasts and financial models',
      'Check spreadsheet quality and explain the logic',
    ],
    tools: ['Excel read/write', 'Formula engine', 'Pivot tables', 'Chart creation'],
    approvalRules: [
      'Asks before changing or deleting data in important financial files',
      'Never invents financial figures; assumptions are labelled on the sheet',
      'Asks before sharing or distributing a workbook',
    ],
    thoughts: [
      'Rebuilding the pivot…',
      'Checking formula references…',
      'Stress-testing assumptions…',
      'Reconciling the totals…',
    ],
    handles: ['analysis'],
  },
};

export const BOT_KEYS = Object.keys(BOT_PROFILES) as BotKey[];

export const BOT_LIST: BotProfile[] = BOT_KEYS.map((k) => BOT_PROFILES[k]);

/**
 * Task type decides where the work happens and who does it. This mapping is the
 * single source of truth for both — the server routes tasks with it, and the
 * world view uses it to explain why a bot walked somewhere.
 */
export const TASK_TYPES: Record<TaskType, TaskTypeInfo> = {
  planning: {
    key: 'planning',
    label: 'Planning',
    icon: '\u{1F5D3}️',
    island: 'headquarters',
    verb: 'planning',
  },
  research: {
    key: 'research',
    label: 'Research',
    icon: '\u{1F50E}',
    island: 'research-library',
    verb: 'researching',
  },
  coding: {
    key: 'coding',
    label: 'Development',
    icon: '\u{1F4BB}',
    island: 'workshop',
    verb: 'building',
  },
  writing: {
    key: 'writing',
    label: 'Presentation',
    icon: '\u{1F4D1}',
    island: 'presentation-studio',
    verb: 'drafting',
  },
  analysis: {
    key: 'analysis',
    label: 'Data & analysis',
    icon: '\u{1F4C9}',
    island: 'data-workshop',
    verb: 'modelling',
  },
  review: {
    key: 'review',
    label: 'Review',
    icon: '\u{1F9D0}',
    island: 'headquarters',
    verb: 'reviewing',
  },
};

export const TASK_TYPE_KEYS = Object.keys(TASK_TYPES) as TaskType[];

/** The bot that naturally owns a given kind of work. */
export function defaultBotForTaskType(type: TaskType): BotKey {
  const match = BOT_LIST.find((b) => b.handles.includes(type));
  // Every task type is claimed by exactly one bot, but fall back to the PM
  // rather than throwing if that ever stops being true.
  return match ? match.key : 'atlas';
}
