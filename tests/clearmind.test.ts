import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'clearmind',
  component: 'Pane',
  requestId: 'clearmind',
  props: {
    title: 'ClearMind',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
  viewport: { columns: 160, rows: 40, isFullscreen: true },
} as const

const PERSON = { kind: 'composer' } as const

const todos = (first: 'in_progress' | 'completed', second: 'pending' | 'in_progress') => [
  { content: 'Reproduce the bug', status: first, activeForm: 'Reproducing the bug' },
  { content: 'Patch the parser', status: second, activeForm: 'Patching the parser' },
]

test('a new prompt starts a fresh journal whose finished steps fold their actions', async ($, on) => {
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash' && e.command === 'npm run lint') {
      return { result: {}, text: 'lint failed', isError: true }
    }

    return { result: {} }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))

  await $.prompt.submit({ text: 'Old prompt', wait: false, origin: PERSON })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/old.ts' })

  await $.prompt.submit({ text: 'Fix the parser\nwith more details', wait: false, origin: PERSON })
  await $.tool.call({ tool: 'TodoWrite', todos: todos('in_progress', 'pending') })
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
  // Nothing in a test stores a row (an answer without next is skipped), so the
  // call rejects once the plugin's hook has read the row.
  await $.session
    .append({
      message: {
        type: 'assistant',
        role: 'assistant',
        content: [{ type: 'text', text: 'The tokenizer drops the last character.\nHidden second line' }],
      },
      door: 'response',
      origin: { kind: 'model', model: 'claude-opus-5-5' },
      uuid: 'row-1',
    })
    .catch(() => undefined)
  await $.tool.call({ tool: 'TodoWrite', todos: todos('completed', 'in_progress') })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/parser.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm run lint' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ text: 'Fix the parser' })).toBeDefined()
    expect(await ui.find({ text: 'with more details' })).toBeUndefined()
    expect(await ui.find({ text: 'Old prompt' })).toBeUndefined()
    expect(await ui.find({ text: 'old.ts' })).toBeUndefined()

    expect(await ui.find({ text: 'Plan 1/2' })).toBeDefined()
    expect(await ui.find({ text: '● Patch the parser' })).toBeDefined()
    expect(await ui.find({ text: '✔ Reproduce the bug (1 action)' })).toBeDefined()
    expect(await ui.find({ text: 'Run the tests' })).toBeUndefined()

    expect(await ui.find({ text: '› The tokenizer drops the last character.' })).toBeDefined()
    expect(await ui.find({ text: 'Hidden second line' })).toBeUndefined()
    expect(await ui.find({ text: '✓ Edit src/parser.ts' })).toBeDefined()
    expect(await ui.find({ text: '✗ Bash · npm run lint' })).toBeDefined()

    await ui.unmount()
  }
})
