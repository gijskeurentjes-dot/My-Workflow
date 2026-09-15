import {
  APPROVAL_CATEGORIES,
  classifyAction,
  defaultImpact,
  type Agent,
  type ApprovalCategory,
  type Project,
  type ProposedAction,
  type RiskLevel,
  type Task,
} from '@ai-islands/shared';
import { FORBIDDEN_TOOLS } from './agents/claude/nova.js';

/**
 * Whether an agent may do a thing, and on whose authority.
 *
 * Three answers, and the middle one is the point of the whole file:
 *
 * - **allow** — inside what this agent was given; no one needs to be asked
 * - **deny** — outside it, and no approval can widen it; the tool is not the
 *   agent's to use and never will be within this run
 * - **approve** — permitted, but only once a person has said so
 *
 * The difference between `deny` and `approve` is not severity. It is whether
 * the capability exists at all: an agent with no shell cannot be granted a
 * shell by clicking Approve, and offering that button would be a lie about
 * what the system can do.
 */
export type PermissionVerdict =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | {
      decision: 'approve';
      category: ApprovalCategory;
      reason: string;
      risk: RiskLevel;
    };

/** An action an agent is about to take, described well enough to judge. */
export interface ActionRequest {
  /** The tool it would use, if any. Checked against the agent's allow-list. */
  tool?: string;
  /** A command or free-text description, classified when no category is given. */
  command?: string;
  /** An explicit category, where the caller already knows. */
  category?: ApprovalCategory;
  /** The project this action would touch, when it is not the task's own. */
  targetProjectId?: string;
  /** Files or records it would touch. */
  files?: string[];
}

const normalise = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

/**
 * The gatekeeper.
 *
 * Deliberately pure and synchronous: it decides, it does not act, and it has no
 * access to the model, the network or the database. Everything it needs is
 * passed in, which is what makes it cheap to test exhaustively — and a rule
 * that is cheap to test is a rule that stays true.
 */
export class PermissionService {
  /**
   * A tool no agent may use in this build, whatever its brief says.
   *
   * Separate from the allow-list because the two fail differently: an
   * unlisted tool is simply not this agent's, while a forbidden one is nobody's.
   */
  isForbiddenTool(tool: string): boolean {
    const wanted = normalise(tool);
    return FORBIDDEN_TOOLS.some((f) => normalise(f) === wanted);
  }

  /** Whether this agent was given this tool at all. */
  hasTool(agent: Agent, tool: string): boolean {
    const wanted = normalise(tool);
    return agent.tools.some((t) => normalise(t) === wanted);
  }

  check(input: {
    agent: Agent;
    project: Project;
    task: Task;
    action: ActionRequest;
  }): PermissionVerdict {
    const { agent, project, task, action } = input;

    // ── Project scope ──────────────────────────────────────────────────────
    // An agent works its own project. This is checked before anything else
    // because it is the boundary the rest of the rules assume.
    if (agent.projectId !== project.id || task.projectId !== project.id) {
      return {
        decision: 'deny',
        reason: `${agent.name} is not on ${project.name}, so cannot act on its work.`,
      };
    }

    if (action.targetProjectId && action.targetProjectId !== project.id) {
      return {
        decision: 'approve',
        category: 'outside_project',
        reason: `This would reach into another project. ${agent.name} is only on ${project.name}.`,
        risk: 'high',
      };
    }

    // ── Tools ──────────────────────────────────────────────────────────────
    if (action.tool) {
      if (this.isForbiddenTool(action.tool)) {
        return {
          decision: 'deny',
          reason: `“${action.tool}” is not available to any agent in this build.`,
        };
      }
      if (!this.hasTool(agent, action.tool)) {
        return {
          decision: 'deny',
          reason: `${agent.name} was not given “${action.tool}”. Add it to their brief first if they should have it.`,
        };
      }
    }

    // ── The gated categories ───────────────────────────────────────────────
    const category =
      action.category ?? (action.command ? classifyAction(action.command) : null);

    if (category) {
      const info = APPROVAL_CATEGORIES[category];
      return {
        decision: 'approve',
        category,
        reason: info.description,
        risk: info.defaultRisk,
      };
    }

    return { decision: 'allow' };
  }

  /**
   * Turn a verdict into the request a person will read.
   *
   * The caller supplies what only it knows — what the action is and why — and
   * this fills in everything that follows from the category, so no two call
   * sites can describe the same kind of action differently.
   */
  describe(input: {
    verdict: Extract<PermissionVerdict, { decision: 'approve' }>;
    action: string;
    reason?: string;
    tools?: string[];
    files?: string[];
    impact?: string;
  }): ProposedAction {
    return {
      category: input.verdict.category,
      action: input.action,
      reason: input.reason?.trim() || input.verdict.reason,
      tools: input.tools ?? [],
      impact: input.impact?.trim() || defaultImpact(input.verdict.category),
      files: input.files ?? [],
      risk: input.verdict.risk,
    };
  }
}

export const permissions = new PermissionService();
