import { Provider } from 'react-redux'
import { store } from './store/index'
import { NotiaMenu } from './components/notia/NotiaMenu'
import { ConfirmationEngineProvider } from './context/confirmation/ConfirmationEngine'
import { useLazyPreloadOnIdle } from './components/notia/hooks/useLazyPreloadOnIdle'
import './styles/notia.css'

function NotiaApp() {
  useLazyPreloadOnIdle()

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
