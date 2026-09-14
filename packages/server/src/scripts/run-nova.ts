/**
 * Drive Nova end to end from the command line.
 *
 * This is the brief's "test task": one command that creates a research task,
 * runs it against the real model, and prints everything the run produced and
 * cost. It exists because the agent runtime has to be provable on its own,
 * before any of it is wired into the visual world.
 *
 *   npm run agent:nova
 *   npm run agent:nova -- "Research the top competitors in my market"
 *   npm run agent:nova -- --dry-run          # no API call, checks the wiring
 *
 * It writes to the configured database, so the run also shows up in the app's
 * history afterwards. It never prints the API key.
 */
import { config, hasAgentCredentials } from '../config.js';
import { openDatabase } from '../db/sqlite.js';
import { createSqliteRepositories } from '../repositories/sqlite/index.js';
import type { Repositories } from '../repositories/types.js';
import { WorkflowService } from '../services/workflow.service.js';
import { TaskExecutionService } from '../services/task-execution.service.js';
import { buildAgentRunners } from '../services/agents/claude/runners.js';
import { RESEARCH_DEFAULTS } from '../services/agents/claude/nova.js';
import type { Agent, Project, Task } from '@ai-islands/shared';

const PROJECT_NAME = 'Nova trial run';
const DEFAULT_TASK = 'Research the top competitors in my market and create a summary';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const title = args.filter((a) => !a.startsWith('--')).join(' ').trim() || DEFAULT_TASK;

function line(label: string, value: string | number): void {
  console.log(`  ${label.padEnd(14)} ${value}`);
}

/**
 * Find or create the trial project and its researcher.
 *
 * Reused across runs so repeated invocations build up a history on one island
 * rather than littering the world with near-identical projects.
 */
function ensureProject(repos: Repositories, workflow: WorkflowService): {
  project: Project;
  agent: Agent;
} {
  const existing = repos.projects.list().find((p) => p.name === PROJECT_NAME);
  const project =
    existing ??
    workflow.createProject({
      name: PROJECT_NAME,
      description: 'A scratch project for exercising the real research agent.',
      team: ['researcher'],
    }).project;

  const researcher = repos.agents
    .findByProject(project.id)
    .find((a) => a.archetype === 'researcher');
  const agent = researcher ?? workflow.hireAgent(project.id, 'researcher', 'Nova').agent;

  // A trial run should use the documented limits even if this agent was
  // created before they existed, or was edited since.
  const ready =
    repos.agents.update(agent.id, {
      maxExecutionMs: RESEARCH_DEFAULTS.maxExecutionMs,
      maxOutputTokens: RESEARCH_DEFAULTS.maxOutputTokens,
      requiresApproval: RESEARCH_DEFAULTS.requiresApproval,
      tools: ['web_search'],
    }) ?? agent;

  return { project, agent: ready };
}

async function main(): Promise<number> {
  console.log(`\nAI Islands — research agent trial\n`);
  line('database', config.databasePath);
  line('model', config.agentModel);
  line('credentials', hasAgentCredentials() ? 'ANTHROPIC_API_KEY is set' : 'not configured');

  if (!hasAgentCredentials() && !dryRun) {
    console.error(
      [
        '',
        'No API key configured, so there is nothing to run against.',
        '',
        '  1. Copy packages/server/.env.example to packages/server/.env',
        '  2. Put your key in it:  ANTHROPIC_API_KEY=sk-ant-...',
        '  3. Run this again.',
        '',
        'Get a key at https://console.anthropic.com/settings/keys.',
        'Pass --dry-run to check the wiring without calling the API.',
      ].join('\n'),
    );
    return 1;
  }

  const db = openDatabase(config.databasePath);
  const repos = createSqliteRepositories(db);
  const workflow = new WorkflowService(repos);

  const { project, agent } = ensureProject(repos, workflow);
  const { task } = workflow.createTask({
    projectId: project.id,
    title,
    description: 'Created by npm run agent:nova.',
    type: 'research',
    needsApproval: true,
    agentId: agent.id,
  });

  console.log('');
  line('project', `${project.name} (${project.id})`);
  line('agent', `${agent.name} — ${agent.role} (${agent.id})`);
  line('task', `${task.title} (${task.id})`);
  line('limits', `${agent.maxExecutionMs / 1000}s, ${agent.maxOutputTokens} output tokens, ${config.agentMaxSearches} searches`);
  line('tools', agent.tools.join(', '));

  const execution = new TaskExecutionService(repos, {
    runners: buildAgentRunners(),
    publish: () => {},
    maxSearches: config.agentMaxSearches,
    onEvent: (event) => {
      switch (event.type) {
        case 'started':
          console.log(`\n▸ running on ${event.model}`);
          break;
        case 'searching':
          console.log(`  · searching: ${event.query}`);
          break;
        case 'structuring':
          console.log('  · organising the findings');
          break;
        case 'finished':
          console.log('  · done');
          break;
        default:
          break;
      }
    },
  });

  if (dryRun) {
    console.log('\nDry run: the task was created and the run was not started.');
    line('executable', String(execution.canExecute(task.id)));
    db.close();
    return 0;
  }

  // Ctrl-C stops the run the same way the API's stop endpoint does, which is
  // also the quickest way to see cancellation behave.
  const onSigint = (): void => {
    console.log('\nStopping the run…');
    execution.cancel(task.id);
  };
  process.on('SIGINT', onSigint);

  const startedAt = Date.now();
  let exitCode = 0;

  try {
    const result = await execution.execute(task.id);
    const finished = repos.tasks.findById(task.id) as Task;

    if (!result) {
      console.log(`\n✗ The run did not produce a result.`);
      line('status', finished.status);
      line('reason', finished.blocker ?? 'unknown');
      exitCode = 1;
    } else {
      console.log(`\n${result.report ? '✓' : '⚠'} ${result.summary}\n`);

      if (result.report) {
        const report = result.report;
        console.log(`  confidence: ${report.confidence}\n`);

        console.log('  Findings');
        for (const finding of report.findings) {
          console.log(`   [${finding.kind}] ${finding.statement}`);
          for (const url of finding.sourceUrls) console.log(`         ${url}`);
        }

        console.log('\n  Sources');
        for (const source of report.sources) {
          console.log(`   - ${source.title}\n     ${source.url}`);
        }

        if (report.openQuestions.length) {
          console.log('\n  Open questions');
          for (const question of report.openQuestions) console.log(`   - ${question}`);
        }
      } else {
        console.log(result.rawText.slice(0, 2000));
      }

      console.log('\n  Run');
      line('task status', finished.status);
      line('stop reason', result.stopReason ?? '—');
      line('searches', result.usage.webSearches);
      line('tokens', `${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
      line('duration', `${(result.durationMs / 1000).toFixed(1)}s`);
      line('result id', result.id);

      const pending = repos.approvals.list({ status: 'pending' }).filter((a) => a.taskId === task.id);
      if (pending.length) {
        console.log('\n  Waiting for your approval. Approve it in the app, or with:');
        console.log(`    curl -X POST localhost:${config.port}/api/approvals/${pending[0]!.id}/approve`);
      }
    }

    // Anything the agent over-claimed is printed rather than buried, because
    // an honest failure is the point of the check that produced it.
    const warnings = repos.activity
      .list({ taskId: task.id })
      .filter((e) => e.eventType === 'system');
    if (warnings.length) {
      console.log('\n  Warnings');
      for (const warning of warnings) console.log(`   - ${warning.message}`);
    }
  } finally {
    process.off('SIGINT', onSigint);
    execution.cancelAll();
    console.log(`\nTotal wall clock: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    db.close();
  }

  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
