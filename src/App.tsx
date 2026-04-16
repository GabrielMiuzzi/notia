import { Provider } from 'react-redux'
import { store } from './store/index'
import { NotiaMenu } from './components/notia/NotiaMenu'
import { ConfirmationEngineProvider } from './context/confirmation/ConfirmationEngine'
import './styles/notia.css'

export default function App() {
  return (
    <Provider store={store}>
      <ConfirmationEngineProvider>
        <NotiaMenu />
      </ConfirmationEngineProvider>
    </Provider>
  )
}
