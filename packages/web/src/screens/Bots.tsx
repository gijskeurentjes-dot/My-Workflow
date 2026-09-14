import { Link } from 'react-router-dom';
import { PLOTS } from '@ai-islands/shared';
import { Avatar, ProgressBar, StatusPill } from '../components/ui.js';
import { useWorld } from '../world/WorldProvider.js';
import { useAnimationClock } from '../world/useAnimationClock.js';
import { allBotDisplays } from '../world/selectors.js';

/** The team, as a list. The accessible twin of the agents in the world view. */
export function Bots() {
  const world = useWorld();
  const clock = useAnimationClock();
  const displays = allBotDisplays(world, clock);

  return (
    <div className="page">
      <header className="page-head">
        <h1>The team</h1>
        <p>
          Five agents, each with a home island, a set of responsibilities and the rules it will
          always check with you about.
        </p>
      </header>

      <div className="grid-cards">
        {displays.map((d) => (
          <Link key={d.bot.id} to={`/bots/${d.bot.id}`} className="list-card">
            <div className="row">
              <Avatar botKey={d.bot.key} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="bot-name">{d.bot.name}</div>
                <div className="bot-role">{d.profile.title}</div>
              </div>
              <StatusPill status={d.bot.status} />
            </div>

            <p className="muted" style={{ marginTop: 10 }}>
              {d.profile.tagline}
            </p>

            <div className="bot-line" style={{ color: 'var(--ink-2)' }}>
              {d.doing}
            </div>
            <div className="bot-line" style={{ marginTop: 4, color: 'var(--ink-3)' }}>
              {d.island.name} ·{' '}
              {d.bot.movement
                ? `walking to the ${PLOTS[d.bot.movement.toKey].label}`
                : `at the ${PLOTS[d.bot.locationKey].label}`}
            </div>

            {d.task && d.task.status !== 'completed' && (
              <ProgressBar
                percent={d.task.progress}
                tone={
                  d.bot.status === 'failed' ? 'bad' : d.bot.status === 'paused' ? 'info' : 'ok'
                }
                note={d.task.title}
              />
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
