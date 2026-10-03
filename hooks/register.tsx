import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallInput } from 'claude-code'

import type { ActionState, Entry, Step } from '../types'

const PANE = 'clearmind'
const TITLE = 'ClearMind'
const MAX_ENTRIES = 300

const promptAtom = atom({ plugin: 'clearmind', key: 'prompt' } as const, '')
const planAtom = atom({ plugin: 'clearmind', key: 'plan' } as const, [])
const entriesAtom = atom({ plugin: 'clearmind', key: 'entries' } as const, [])

// Plan bookkeeping and tool discovery: shown through the plan, not as actions.
const SILENT_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'ToolSearch'])

const ICON: Record<ActionState, string> = { runs: '…', done: '✓', failed: '✗' }
const COLOR: Record<ActionState, string> = { runs: 'yellow', done: 'green', failed: 'red' }
const STEP_ICON: Record<Step['status'], string> = { pending: '○', in_progress: '●', completed: '✓' }

function arg(e: object, name: string): string | undefined {
  const value = (e as Record<string, unknown>)[name]

  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

function describe(e: ToolCallInput): string {
  const tool = String(e.tool)
  const path = arg(e, 'file_path') ?? arg(e, 'notebook_path')
  if (path !== undefined) {
    return `${tool} ${path.split('/').slice(-2).join('/')}`
  }
  const detail =
    arg(e, 'description') ?? arg(e, 'command') ?? arg(e, 'pattern') ?? arg(e, 'query') ?? arg(e, 'url') ?? arg(e, 'skill')
  const name = tool.startsWith('mcp__') ? tool.slice(5).replace('__', ':') : tool

  return detail === undefined ? name : `${name} · ${firstLine(detail)}`
}

async function push($: EngineInterface, entry: Entry): Promise<void> {
  await update($, entriesAtom, list => [...list, entry].slice(-MAX_ENTRIES))
}

async function reset($: EngineInterface, prompt: string): Promise<void> {
  await update($, promptAtom, () => prompt)
  await update($, planAtom, () => [])
  await update($, entriesAtom, () => [])
}

// Replaces the plan and journals each step that just became completed.
async function setPlan($: EngineInterface, change: (plan: Step[]) => Step[]): Promise<void> {
  const before = await read($, planAtom)
  const after = change(before)
  await update($, planAtom, () => after)
  for (const step of after) {
    const was = before.find(one => one.key === step.key)
    if (step.status === 'completed' && was?.status !== 'completed') {
      await push($, { kind: 'milestone', text: step.title, stepKey: step.key })
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'clearmind',
      description: 'Open or close the ClearMind progress pane',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'clearmind' }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })

      return { text: 'ClearMind pane closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'ClearMind pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (isPerson && e.turnId === undefined) {
      await reset($, firstLine(e.text))
    } else if (isPerson) {
      await push($, { kind: 'note', text: `↳ ${firstLine(e.text)}` })
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await reset($, '')
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // A subagent's own calls stay out: its Agent call already stands for it.
    if (e.agentId !== undefined) {
      return next(e)
    }

    if (e.tool === 'TodoWrite') {
      const ran = await next(e)
      if (ran.deny === undefined && ran.isError !== true) {
        await setPlan($, () => e.todos.map(todo => ({ key: todo.content, title: todo.content, status: todo.status })))
      }

      return ran
    }

    if (e.tool === 'TaskCreate') {
      const ran = await next(e)
      const task = (ran.result as { task?: { id: string } } | undefined)?.task
      if (ran.deny === undefined && ran.isError !== true && task !== undefined) {
        await setPlan($, plan => [...plan, { key: task.id, title: e.subject, status: 'pending' }])
      }

      return ran
    }

    if (e.tool === 'TaskUpdate') {
      const ran = await next(e)
      const { taskId, status, subject } = e
      if (ran.deny === undefined && ran.isError !== true) {
        await setPlan($, plan =>
          status === 'deleted'
            ? plan.filter(step => step.key !== taskId)
            : plan.map(step =>
                step.key === taskId ? { ...step, title: subject ?? step.title, status: status ?? step.status } : step,
              ),
        )
      }

      return ran
    }

    if (SILENT_TOOLS.has(String(e.tool))) {
      return next(e)
    }

    const plan = await read($, planAtom)
    const id = e.tool_use_id
    const stepKey = plan.find(step => step.status === 'in_progress')?.key ?? null
    await push($, { kind: 'action', id, text: describe(e), state: 'runs', stepKey })

    const ran = await next(e)
    const state: ActionState = ran.deny === undefined && ran.isError !== true ? 'done' : 'failed'
    await update($, entriesAtom, list =>
      list.map(entry => (entry.kind === 'action' && entry.id === id ? { ...entry, state } : entry)),
    )

    return ran
  })

  // Claude's visible messages (text blocks only) read as its decisions and progress notes.
  on('session.append', { door: 'response' }, async ($, e, next) => {
    if (e.agentId === undefined && e.message.type === 'assistant') {
      for (const block of e.message.content) {
        const text = block.type === 'text' && typeof block.text === 'string' ? firstLine(block.text) : ''
        if (text !== '') {
          await push($, { kind: 'note', text })
        }
      }
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const seconds = Math.round(e.durationMs / 1000)
      const text = e.isAborted ? `Interrupted after ${seconds}s` : e.reason === 'answer' ? `Done in ${seconds}s` : `Stopped (${e.reason})`
      await push($, { kind: 'end', text })
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const prompt = await read($, promptAtom)
    const plan = await read($, planAtom)
    const entries = await read($, entriesAtom)

    const completed = new Set(plan.filter(step => step.status === 'completed').map(step => step.key))
    const actionsPerStep = new Map<string, number>()
    for (const entry of entries) {
      if (entry.kind === 'action' && entry.stepKey !== null) {
        actionsPerStep.set(entry.stepKey, (actionsPerStep.get(entry.stepKey) ?? 0) + 1)
      }
    }

    // A completed step's actions fold into its milestone line.
    const journal = entries.filter(
      entry => !(entry.kind === 'action' && entry.stepKey !== null && completed.has(entry.stepKey)),
    )
    const rows = e.viewport?.rows ?? 24
    const room = Math.max(3, rows - 4 - (plan.length > 0 ? plan.length + 2 : 0))

    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          ❯ {prompt === '' ? 'Waiting for a prompt' : prompt}
        </Text>
        {plan.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>
              Plan {completed.size}/{plan.length}
            </Text>
            {plan.map(step => (
              <Text
                wrap="truncate-end"
                bold={step.status === 'in_progress'}
                dimColor={step.status === 'completed'}
                color={step.status === 'in_progress' ? 'yellow' : undefined}
              >
                {STEP_ICON[step.status]} {step.title}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          {journal.length === 0 && <Text dimColor>Nothing yet.</Text>}
          {journal.slice(-room).map(entry => {
            if (entry.kind === 'action') {
              return (
                <Text wrap="truncate-end" color={COLOR[entry.state]}>
                  {ICON[entry.state]} {entry.text}
                </Text>
              )
            }
            if (entry.kind === 'milestone') {
              const count = actionsPerStep.get(entry.stepKey) ?? 0
              return (
                <Text wrap="truncate-end" color="green" bold>
                  ✔ {entry.text}
                  {count > 0 ? ` (${count} action${count > 1 ? 's' : ''})` : ''}
                </Text>
              )
            }
            if (entry.kind === 'note') {
              return (
                <Text wrap="truncate-end" italic>
                  › {entry.text}
                </Text>
              )
            }
            return <Text dimColor>■ {entry.text}</Text>
          })}
        </Box>
      </Box>
    )
  })
}
