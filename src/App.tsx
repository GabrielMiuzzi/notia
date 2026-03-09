import { NotiaMenu } from './components/notia/NotiaMenu'
import { ConfirmationEngineProvider } from './context/confirmation/ConfirmationEngine'
import './styles/notia.css'

export default function App() {
  return (
    <ConfirmationEngineProvider>
      <NotiaMenu />
    </ConfirmationEngineProvider>
  )
}
