import { Provider } from 'react-redux'
import { store } from './store/index'
import { NotiaMenu } from './components/notia/NotiaMenu'
import { ConfirmationEngineProvider } from './context/confirmation/ConfirmationEngine'
import { useLazyPreloadOnIdle } from './components/notia/hooks/useLazyPreloadOnIdle'
import { useEffect } from 'react'
import { useAppSelector } from './store/hooks'
import { selectQwen3AsrSettings, selectQwen3TtsSettings } from './features/preferences/preferencesSelectors'
import { prepareSpeechModel } from './services/speech/speechService'
import { prepareQwen3Tts } from './services/qwen3Tts/qwen3TtsRuntime'
import './styles/notia.css'

function NotiaApp() {
  useLazyPreloadOnIdle()
  const asr = useAppSelector(selectQwen3AsrSettings)
  const tts = useAppSelector(selectQwen3TtsSettings)

  useEffect(() => {
    void Promise.allSettled([
      prepareSpeechModel(asr),
      prepareQwen3Tts(tts),
    ])
  }, [asr, tts])

  return (
    <NotiaMenu />
  )
}

export default function App() {
  return (
    <Provider store={store}>
      <ConfirmationEngineProvider>
        <NotiaApp />
      </ConfirmationEngineProvider>
    </Provider>
  )
}
