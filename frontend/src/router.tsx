import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { TargetDetail } from './components/detail/TargetDetail';
import { LabView } from './components/lab/LabView';
import { MyAnalyses } from './components/pages/MyAnalyses';
import { RecordDetail } from './components/pages/RecordDetail';
import { SharedRecord } from './components/pages/SharedRecord';
import { Settings } from './components/pages/Settings';
import { AdminDashboard } from './components/pages/AdminDashboard';
import { HomePage } from './components/pages/HomePage';
import { TessIntroPage } from './components/pages/TessIntroPage';
import { KmtnetIntroPage } from './components/pages/KmtnetIntroPage';
import { ObservatorySelectPage } from './components/pages/ObservatorySelectPage';
import { KmtnetExplorerPage } from './components/pages/KmtnetExplorerPage';
import { SkyExplorerPage } from './components/pages/SkyExplorerPage';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/tess', element: <TessIntroPage /> },
      { path: '/kmtnet', element: <KmtnetIntroPage /> },
      { path: '/kmtnet/sites', element: <ObservatorySelectPage /> },
      { path: '/kmtnet/explorer', element: <KmtnetExplorerPage /> },
      { path: '/explorer', element: <SkyExplorerPage /> },
      { path: '/target/:targetId', element: <TargetDetail /> },
      { path: '/lab/:targetId', element: <LabView /> },
      { path: '/my', element: <MyAnalyses /> },
      { path: '/records/:recordId', element: <RecordDetail /> },
      { path: '/shared/:token', element: <SharedRecord /> },
      { path: '/settings', element: <Settings /> },
      { path: '/admin', element: <AdminDashboard /> },
    ],
  },
]);
