// Notifications for newly detected changes. Only high-signal or A1-relevant events alert.
//   SLACK_WEBHOOK_URL=https://hooks.slack.com/...   post to Slack
//   NOTIFY=1                                        macOS desktop notification (local server only)
//   DASHBOARD_URL=https://...                       link included in Slack messages
import { spawn } from 'node:child_process';
import { loadConfig, allTargets } from './store.mjs';

export async function alert(events) {
  const important = events.filter((e) => e.significance === 'high' || e.a1?.length);
  if (!important.length) return;
  const name = Object.fromEntries(allTargets(loadConfig()).map((c) => [c.id, c.name]));

  if (process.env.NOTIFY && process.platform === 'darwin') {
    const e = important[0];
    const text = `${name[e.competitor]}: ${e.title}`.replace(/["\\]/g, '');
    spawn('osascript', ['-e', `display notification "${text}" with title "Competitor change" subtitle "${important.length} high-signal change(s)"`]);
  }

  if (process.env.SLACK_WEBHOOK_URL) {
    const lines = important.slice(0, 8).map((e) =>
      `• *${name[e.competitor]}* — ${e.title}${e.a1?.length ? `  _(${e.a1.join('; ')})_` : ''}\n  <${e.url}|${e.pageType} page>`);
    const more = important.length > 8 ? `\n…and ${important.length - 8} more` : '';
    const link = process.env.DASHBOARD_URL ? `\n<${process.env.DASHBOARD_URL}|Open the tracker>` : '';
    try {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `:rotating_light: Competitor changes detected\n${lines.join('\n')}${more}${link}` }),
      });
    } catch (e) { console.log('Slack alert failed:', e.message); }
  }
}
