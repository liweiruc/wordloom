import { useEffect, useRef } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { AppProvider } from './lib/app-context'
import ImportPage from './pages/Import'
import Library from './pages/Library'
import Lookup from './pages/Lookup'
import SettingsPage from './pages/Settings'
import Stats from './pages/Stats'
import Study from './pages/Study'
import Today from './pages/Today'
import WordDetail from './pages/WordDetail'

function Shell(): React.JSX.Element {
  const { pathname } = useLocation()
  const main = useRef<HTMLElement>(null)
  // Pages share one scrolling area: each one starts at the top.
  useEffect(() => {
    main.current?.scrollTo(0, 0)
  }, [pathname])
  return (
    <div className="flex h-full">
      <Sidebar />
      <main ref={main} className="min-w-0 flex-1 overflow-y-auto">
        <Routes>
          {/* The app opens on 查词. */}
          <Route path="/" element={<Navigate to="/lookup" replace />} />
          <Route path="/lookup" element={<Lookup />} />
          <Route path="/review" element={<Today />} />
          <Route path="/library" element={<Library />} />
          <Route path="/words/:id" element={<WordDetail />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <AppProvider>
      <Routes>
        {/* Studying takes the whole window: no sidebar, nothing else to look at. */}
        <Route path="/study" element={<Study />} />
        <Route path="*" element={<Shell />} />
      </Routes>
    </AppProvider>
  )
}
