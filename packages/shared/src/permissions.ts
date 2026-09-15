import type { ApprovalRequest } from './types.js';

/**
 * What an agent must ask about before it does it.
 *
 * The rule this file exists to make true: **an agent never takes an action with
 * an effect you did not agree to.** Everything with a consequence outside the
 * work itself — money, mail, deletion, deployment, production data, another
 * project's files — stops and waits for a person.
 *
 * The categories are here in the shared package because both halves of the app
 * need them for different reasons: the server decides with them, and the
 * interface has to explain them. One list, so the explanation and the decision
 * can never drift apart.
 */

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_TONE: Record<RiskLevel, string> = {
  low: 'info',
  medium: 'warn',
  high: 'bad',
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'Low risk',
  medium: 'Needs a careful look',
  high: 'High risk',
};

export const APPROVAL_CATEGORY_KEYS = [
  'send_email',
  'external_message',
  'spend_money',
  'delete_files',
  'destructive_command',
  'deploy_production',
  'production_data',
  'sensitive_data',
  'outside_project',
  'configured',
  'deliverable',
] as const;

export type ApprovalCategory = (typeof APPROVAL_CATEGORY_KEYS)[number];

export interface ApprovalCategoryInfo {
  key: ApprovalCategory;
  label: string;
  icon: string;
  /** What this covers, in a sentence a person can check the request against. */
  description: string;
  /** How bad it is if this happens when it should not have. */
  defaultRisk: RiskLevel;
  /**
   * Whether the effect can be undone.
   *
   * Shown to the reader because it is the thing that actually decides how much
   * care a request deserves: a sent email cannot be unsent.
   */
  reversible: boolean;
}

export const APPROVAL_CATEGORIES: Record<ApprovalCategory, ApprovalCategoryInfo> = {
  send_email: {
    key: 'send_email',
    label: 'Send an email',
    icon: '\u{2709}\u{FE0F}',
    description: 'Mail leaving this system, to anyone.',
    defaultRisk: 'high',
    reversible: false,
  },
  external_message: {
    key: 'external_message',
    label: 'Message someone outside',
    icon: '\u{1F4AC}',
    description: 'Any message to a person or service outside this workspace.',
    defaultRisk: 'high',
    reversible: false,
  },
  spend_money: {
    key: 'spend_money',
    label: 'Spend money',
    icon: '\u{1F4B3}',
    description: 'Buying data, services or capacity — anything with a bill attached.',
    defaultRisk: 'high',
    reversible: false,
  },
  delete_files: {
    key: 'delete_files',
    label: 'Delete files',
    icon: '\u{1F5D1}\u{FE0F}',
    description: 'Removing or overwriting a file that already exists.',
    defaultRisk: 'high',
    reversible: false,
  },
  destructive_command: {
    key: 'destructive_command',
    label: 'Run a destructive command',
    icon: '\u{26A0}\u{FE0F}',
    description: 'A command that changes or removes something it cannot put back.',
    defaultRisk: 'high',
    reversible: false,
  },
  deploy_production: {
    key: 'deploy_production',
    label: 'Deploy to production',
    icon: '\u{1F680}',
    description: 'Shipping a change to a system real people are using.',
    defaultRisk: 'high',
    reversible: false,
  },
  production_data: {
    key: 'production_data',
    label: 'Change production data',
    icon: '\u{1F5C3}\u{FE0F}',
    description: 'Writing to live records rather than a copy.',
    defaultRisk: 'high',
    reversible: false,
  },
  sensitive_data: {
    key: 'sensitive_data',
    label: 'Use sensitive data',
    icon: '\u{1F510}',
    description: 'Reading or moving confidential material — deal documents, personal data, keys.',
    defaultRisk: 'high',
    reversible: true,
  },
  outside_project: {
    key: 'outside_project',
    label: 'Reach outside this project',
    icon: '\u{1F6AB}',
    description: 'Touching anything belonging to another project.',
    defaultRisk: 'high',
    reversible: true,
  },
  configured: {
    key: 'configured',
    label: 'An action you marked as needing approval',
    icon: '\u{1F511}',
    description: 'Something this agent or this task was configured to ask about.',
    defaultRisk: 'medium',
    reversible: true,
  },
  deliverable: {
    key: 'deliverable',
    label: 'Deliver finished work',
    icon: '\u{1F4E6}',
    description: 'Finished work waiting for your sign-off before it is delivered.',
    defaultRisk: 'low',
    reversible: true,
  },
};

export const APPROVAL_CATEGORY_LIST = APPROVAL_CATEGORY_KEYS.map((k) => APPROVAL_CATEGORIES[k]);

/**
 * Every category here needs approval. That is the point of the list: it is not
 * a menu of options, it is the set of things no agent may do on its own.
 */
export const requiresApprovalCategory = (category: ApprovalCategory): boolean =>
  APPROVAL_CATEGORY_KEYS.includes(category);

/**
 * What an agent is asking to do.
 *
 * Every field is here because a person cannot make this decision without it:
 * what the action is, why the agent wants it, which tools it would use, what
 * happens if it goes wrong, and what it would touch.
 */
export interface ProposedAction {
  category: ApprovalCategory;
  /** The action itself, as an imperative: "Send the IC pack to the client". */
  action: string;
  /** Why the agent wants to do it. */
  reason: string;
  /** Tools it would use. Drawn from the agent's own allow-list. */
  tools: string[];
  /** What could happen if this is wrong — the reason to read carefully. */
  impact: string;
  /** Files or records it would touch. */
  files: string[];
  /** Overrides the category's default, where the agent knows better. */
  risk?: RiskLevel;
}

/** The default impact sentence for a category, when an agent offers none. */
export function defaultImpact(category: ApprovalCategory): string {
  const info = APPROVAL_CATEGORIES[category];
  return info.reversible
    ? `${info.description} This can be undone, but it should still be deliberate.`
    : `${info.description} This cannot be undone once it happens.`;
}

/**
 * Words that mean an action destroys something.
 *
 * Used to classify a proposed command when nothing more specific is known. It
 * is deliberately eager: a false positive costs one approval click, a false
 * negative costs whatever the command deleted.
 */
const DESTRUCTIVE_HINTS = [
  'rm ',
  'rm -',
  'rmdir',
  'drop table',
  'drop database',
  'truncate',
  'delete from',
  'format ',
  'mkfs',
  'shutdown',
  'kill -9',
  'git push --force',
  'git reset --hard',
  'chmod 777',
  'dd if=',
  '> /dev/',
];

/**
 * Which category a raw command or action falls into, if any.
 *
 * Returns null when nothing about it is recognisably gated — which is not the
 * same as "safe". A tool an agent may not use is refused by the allow-list
 * before this is ever consulted.
 */
export function classifyAction(text: string): ApprovalCategory | null {
  const t = text.toLowerCase();

  if (DESTRUCTIVE_HINTS.some((hint) => t.includes(hint))) return 'destructive_command';
  if (/\b(email|smtp|sendmail|mailto:)\b/.test(t)) return 'send_email';
  if (/\b(slack|sms|whatsapp|webhook|post to|publish to|notify)\b/.test(t)) return 'external_message';
  if (/\b(purchase|buy|subscribe|invoice|charge|payment|billing)\b/.test(t)) return 'spend_money';
  if (/\b(deploy|release to prod|ship to production)\b/.test(t)) return 'deploy_production';
  if (/\b(production database|prod db|live records|production data)\b/.test(t)) {
    return 'production_data';
  }
  if (/\b(delete|remove|overwrite|replace) .*(file|workbook|document|deck)\b/.test(t)) {
    return 'delete_files';
  }
  return null;
}

/**
 * Build a complete request from whatever the caller actually knows.
 *
 * Every field has a defensible default, so a caller that only has a summary
 * still produces a request a person can read — and the shape is identical
 * whether it came from the simulation, a live run, or a gated tool call.
 */
export function buildApprovalRequest(input: {
  id: string;
  taskId: string;
  agentId: string;
  summary: string;
  requestedAt: number;
  category?: ApprovalCategory;
  action?: string;
  reason?: string;
  tools?: string[];
  impact?: string;
  files?: string[];
  risk?: RiskLevel;
  blocking?: boolean;
}): ApprovalRequest {
  const category = input.category ?? 'deliverable';
  return {
    id: input.id,
    taskId: input.taskId,
    agentId: input.agentId,
    summary: input.summary,
    category,
    action: input.action ?? input.summary,
    reason: input.reason ?? '',
    tools: input.tools ?? [],
    impact: input.impact ?? defaultImpact(category),
    files: input.files ?? [],
    risk: input.risk ?? APPROVAL_CATEGORIES[category].defaultRisk,
    blocking: input.blocking ?? false,
    status: 'pending',
    requestedAt: input.requestedAt,
    decidedAt: null,
    note: null,
  };
}
