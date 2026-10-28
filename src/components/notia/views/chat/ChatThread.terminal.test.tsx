// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'

// The thread's Markdown renderer (KaTeX) is not what these tests look at.
vi.mock('./ChatMarkdownMessage', () => ({ ChatMarkdownMessage: ({ source }: { source: string }) => <p>{source}</p> }))
vi.mock('./ChatAgentPanel', () => ({ ChatAgentAvatar: () => null }))
import { ChatThread } from './ChatThread'
import type { ChatTerminalRun } from '../../../../services/chat/aiChatRuntime'

// The thread copies the plan into its editor on every change: a stable one,
// as the chat view passes it.
const NO_PLAN: never[] = []

const run: ChatTerminalRun = {
  callId: 'c1',
  command: 'npm run build',
  shell: 'powershell',
  cwd: 'C:\\repo',
  output: 'compilando\n',
  partial: '50%',
  status: '',
}

function renderThread(streamingTerminal: ChatTerminalRun | null) {
  return render(
    <ChatThread
      messages={[{ role: 'user', content: 'Compilá el proyecto' }]}
      isSubmitting
      isChatLoading={false}
      isCheckingAiHealth={false}
      aiAvailabilityMessage={null}
      selectedChatFilePath="chat/chats/a.md"
      showHistoryPanel
      streamingThinking=""
      streamingAssistantMessage=""
      streamingTerminal={streamingTerminal}
      agentExecutionPlan={NO_PLAN}
      threadRef={createRef<HTMLDivElement>()}
    />,
  )
}

describe('ChatThread terminal', () => {
  afterEach(cleanup)

  it('shows the running command, where it runs and its output with the line being written', () => {
    renderThread(run)
    expect(screen.getByText('Terminal · ejecutando')).toBeTruthy()
    expect(screen.getByText('npm run build')).toBeTruthy()
    expect(screen.getByText('C:\\repo')).toBeTruthy()
    const output = screen.getByLabelText('Salida de la terminal')
    expect(output.textContent).toBe('compilando\n50%')
    // The output can be focused and scrolled without a pointer.
    expect(output.getAttribute('tabindex')).toBe('0')
    expect(screen.queryByText('Compila sin errores.')).toBeNull()
    // The thinking bubble gives way to the terminal.
    expect(screen.queryByRole('status', { name: 'Pensando' })).toBeNull()
  })

  it('shows what the light agent read in the live output', () => {
    renderThread({ ...run, status: 'Compila sin errores.' })
    expect(screen.getByText('Compila sin errores.').closest('[role="status"]')).toBeTruthy()
  })

  it('says when the command printed nothing yet and leaves once it ends', () => {
    const { rerender } = renderThread({ ...run, output: '', partial: '' })
    expect(screen.getByLabelText('Salida de la terminal').textContent).toBe('Todavía sin salida…')
    rerender(
      <ChatThread
        messages={[{ role: 'user', content: 'Compilá el proyecto' }]}
        isSubmitting
        isChatLoading={false}
        isCheckingAiHealth={false}
        aiAvailabilityMessage={null}
        selectedChatFilePath="chat/chats/a.md"
        showHistoryPanel
        streamingThinking=""
        streamingAssistantMessage=""
        streamingTerminal={null}
        agentExecutionPlan={NO_PLAN}
        threadRef={createRef<HTMLDivElement>()}
      />,
    )
    expect(screen.queryByLabelText('Salida de la terminal')).toBeNull()
    expect(screen.getByRole('status', { name: 'Pensando' })).toBeTruthy()
  })
})
