import { useEffect, useState } from 'react';
import { ConnectPage } from './pages/Connect';
import { SessionPage } from './pages/Session';
import type { SessionConfig } from './protocol/config';

type View = { name: 'connect' } | { name: 'session'; config: SessionConfig };

export default function App() {
  const [view, setView] = useState<View>({ name: 'connect' });

  useEffect(() => {
    document.title = 'RustDesk Web · 远程协助';
  }, []);

  if (view.name === 'connect') {
    return <ConnectPage onConnect={(config) => setView({ name: 'session', config })} />;
  }
  return (
    <SessionPage
      config={view.config}
      onExit={() => setView({ name: 'connect' })}
    />
  );
}