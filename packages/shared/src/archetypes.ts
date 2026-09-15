import { PLOTS } from './geometry.js';
import type { AgentArchetype, ArchetypeProfile, PlotKey, TaskType, TaskTypeInfo } from './types.js';

/**
 * The kinds of worker you can hire onto a project.
 *
 * An archetype is a starting point, not a cage: it sets how the agent looks,
 * what it naturally handles, and the brief it begins with. Name, role,
 * instructions and tools are all editable per agent afterwards, so two projects
 * can run very different Developers.
 *
 * The `responsibilities` and `approvalRules` here are what a new agent's
 * `instructions` are built from — the text a real engine sends as its system
 * prompt.
 */
/**
 * The Researcher's brief, in the operator's own words.
 *
 * Two lines of it are load-bearing rather than decorative: "do not claim to
 * have researched something unless you actually did it" is checked after every
 * live run by comparing the report's sources against the searches that actually
 * happened, and "stay within the assigned project and task" is enforced by what
 * the executor is allowed to load. It lives here, beside the archetype, so the
 * agent that gets hired is told exactly what the engine expects of it.
 */
export const RESEARCHER_SYSTEM_PROMPT = `You are Nova, a research specialist working inside AI Islands.
Your job is to research assigned topics, organize findings, distinguish facts from assumptions, and produce useful reports.
You must stay within the assigned project and task.
Do not claim to have researched something unless you actually did it.
Do not invent sources or results.
If you lack information, say so.
Ask for approval before taking sensitive actions.`;

export const ARCHETYPES: Record<AgentArchetype, ArchetypeProfile> = {
  pm: {
    key: 'pm',
    title: 'Project Manager',
    defaultName: 'Atlas',
    icon: '\u{1F4CB}',
    color: { base: '#4a8ff0', dark: '#2c62b6', light: '#a8caf8' },
    tagline: 'Breaks projects into tasks, delegates the work and brings you the decisions.',
    responsibilities: [
      'Break projects down into concrete, assignable tasks',
      'Delegate each task to the right specialist',
      'Track progress and deadlines across the project',
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
    home: 'hq',
  },

  researcher: {
    key: 'researcher',
    title: 'Researcher',
    defaultName: 'Nova',
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
    home: 'library',
    systemPrompt: RESEARCHER_SYSTEM_PROMPT,
  },

  developer: {
    key: 'developer',
    title: 'Developer',
    defaultName: 'Forge',
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
    home: 'workshop',
  },

  presenter: {
    key: 'presenter',
    title: 'Presentation Designer',
    defaultName: 'Slidebuilder',
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
    home: 'studio',
  },

  analyst: {
    key: 'analyst',
    title: 'Spreadsheet & Data Analyst',
    defaultName: 'Excel Expert',
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
    home: 'data',
  },
};

export const ARCHETYPE_KEYS = Object.keys(ARCHETYPES) as AgentArchetype[];

export const ARCHETYPE_LIST: ArchetypeProfile[] = ARCHETYPE_KEYS.map((k) => ARCHETYPES[k]);

/**
 * Task type decides where the work happens and who does it. This mapping is the
 * single source of truth for both — the server routes tasks with it, and the
 * world view uses it to explain why an agent walked somewhere.
 */
export const TASK_TYPES: Record<TaskType, TaskTypeInfo> = {
  planning: {
    key: 'planning',
    label: 'Planning',
    icon: '\u{1F5D3}️',
    building: 'hq',
    verb: 'planning',
    owner: 'pm',
  },
  research: {
    key: 'research',
    label: 'Research',
    icon: '\u{1F50E}',
    building: 'library',
    verb: 'researching',
    owner: 'researcher',
  },
  coding: {
    key: 'coding',
    label: 'Development',
    icon: '\u{1F4BB}',
    building: 'workshop',
    verb: 'building',
    owner: 'developer',
  },
  writing: {
    key: 'writing',
    label: 'Presentation',
    icon: '\u{1F4D1}',
    building: 'studio',
    verb: 'drafting',
    owner: 'presenter',
  },
  analysis: {
    key: 'analysis',
    label: 'Data & analysis',
    icon: '\u{1F4C9}',
    building: 'data',
    verb: 'modelling',
    owner: 'analyst',
  },
  review: {
    key: 'review',
    label: 'Review',
    icon: '\u{1F9D0}',
    building: 'hq',
    verb: 'reviewing',
    owner: 'pm',
  },
};

export const TASK_TYPE_KEYS = Object.keys(TASK_TYPES) as TaskType[];

/** Which building a kind of work is carried out at. */
export const buildingForTaskType = (type: TaskType): PlotKey => TASK_TYPES[type].building;

/** The archetype that naturally owns a given kind of work. */
export const archetypeForTaskType = (type: TaskType): AgentArchetype => TASK_TYPES[type].owner;

/**
 * Build a new agent's starting instructions from its archetype.
 *
 * This is the text a real engine sends as the system prompt, so it is assembled
 * rather than hardcoded: edit an agent afterwards and the stored value wins.
 */
export function defaultInstructions(profile: ArchetypeProfile): string {
  // An archetype with a written brief is sent that brief, word for word.
  if (profile.systemPrompt) return profile.systemPrompt;

  return [
    profile.tagline,
    '',
    'Responsibilities:',
    ...profile.responsibilities.map((r) => `- ${r}`),
    '',
    'Always check with the user before:',
    ...profile.approvalRules.map((r) => `- ${r}`),
  ].join('\n');
}

/** Where this archetype waits and works by default. */
export const homePlotFor = (archetype: AgentArchetype): PlotKey => {
  const home = ARCHETYPES[archetype].home;
  return PLOTS[home] ? home : 'rest';
};
