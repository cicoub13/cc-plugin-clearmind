export type StepStatus = 'pending' | 'in_progress' | 'completed'

/** One step of the plan the model keeps with TodoWrite or TaskCreate/TaskUpdate. */
export type Step = { key: string; title: string; status: StepStatus }

export type ActionState = 'runs' | 'done' | 'failed'

/** One line of the journal; actions carry the step that was in progress when they ran. */
export type Entry =
  | { kind: 'action'; id: string; text: string; state: ActionState; stepKey: string | null }
  | { kind: 'note'; text: string }
  | { kind: 'milestone'; text: string; stepKey: string }
  | { kind: 'end'; text: string }

declare module 'claude-code' {
  interface PluginState {
    clearmind: { prompt: string; plan: Step[]; entries: Entry[] }
  }
}
