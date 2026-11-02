import Sidebar from './Sidebar';

interface Props {
  children: React.ReactNode;
}

export default function AppShell({ children }: Props) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="page-content">
        {children}
      </div>
    </div>
  );
}
