import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './hooks/useAuth';
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import LoginPage from './pages/LoginPage';
import OAuthCallback from './pages/OAuthCallback';
import DashboardPage from './pages/DashboardPage';
import OrdersListPage from './pages/OrdersListPage';
import OrderDetailPage from './pages/OrderDetailPage';
import SuppliersPage from './pages/SuppliersPage';
import AlertsPage from './pages/AlertsPage';
import ProfilePage from './pages/ProfilePage';
import PreferencesPage from './pages/PreferencesPage';
import AdminLayout from './components/Admin/AdminLayout';
import UsersManagementPage from './pages/Admin/UsersManagementPage';
import LogsPage from './pages/Admin/LogsPage';
import SyncSAPPage from './pages/Admin/SyncSAPPage';
import MLModelsPage from './pages/Admin/MLModelsPage';
import CreateOrderPage from './pages/CreateOrderPage';

function ProtectedLayout() {
  const { user, loading } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const newVal = !prev;
      localStorage.setItem('sidebar-collapsed', String(newVal));
      return newVal;
    });
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen w-full bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:from-[#0a0e27] dark:via-[#0f1633] dark:to-[#1a2a52]">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-cyan-400" />
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Chargement de SmartOrder...</p>
      </div>
    </div>
  );
  // Toujours rediriger vers /login si non authentifié, même en mode XSUAA
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0a0e27] dark:text-[#e4e8f5] transition-colors duration-300">
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <main className={`flex-1 flex flex-col min-h-screen ${sidebarCollapsed ? 'lg:pl-[84px]' : 'lg:pl-[292px]'} transition-[padding] duration-300`}>
        <Header />
        <div className="flex-1 p-4 lg:p-6 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function AdminRoute() {
  const { hasRole } = useAuth();
  if (!hasRole('ADMIN')) return <Navigate to="/" replace />;
  return <Outlet />;
}

function ManagerRoute() {
  const { hasRole } = useAuth();
  if (!hasRole('MANAGER')) return <Navigate to="/orders" replace />;
  return <Outlet />;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  // Si déjà authentifié → aller directement au dashboard
  if (!loading && user) return <Navigate to="/" replace />;
  // Toujours afficher la page de login (mock ou XSUAA) — jamais de bypass auto
  return <LoginPage />;
}

function HomeRedirect() {
  const { hasRole } = useAuth();
  if (hasRole('MANAGER')) return <Navigate to="/dashboard" replace />;
  return <Navigate to="/orders" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />

          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<HomeRedirect />} />

            <Route element={<ManagerRoute />}>
              <Route path="/dashboard" element={<DashboardPage />} />
            </Route>

            <Route path="/orders" element={<OrdersListPage />} />
            <Route path="/orders/:id" element={<OrderDetailPage />} />

            {/* Création de commande — MANAGER et ADMIN uniquement */}
            <Route element={<ManagerRoute />}>
              <Route path="/orders/new" element={<CreateOrderPage />} />
            </Route>
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/preferences" element={<PreferencesPage />} />

            <Route element={<AdminRoute />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="/admin/users" replace />} />
                <Route path="users" element={<UsersManagementPage />} />
                <Route path="logs" element={<LogsPage />} />
                <Route path="sync" element={<SyncSAPPage />} />
                <Route path="ml" element={<MLModelsPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
