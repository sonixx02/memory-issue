import './App.css';
import AppShell from './components/Layout/AppShell.jsx';
import { ThemeProvider } from './theme/ThemeContext.jsx';

function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

export default App
